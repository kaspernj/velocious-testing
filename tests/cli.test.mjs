import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {pathToFileURL} from "node:url"

const cliPath = path.resolve("src/node/cli.js")
const packageEntry = pathToFileURL(path.resolve("src/index.js")).href

/** @param {string} cwd @param {string[]} args */
function runCli(cwd, args) {
  return spawnSync(process.execPath, [cliPath, ...args], {cwd, encoding: "utf8"})
}

/** @param {string} stdout */
function parseSingleJsonLine(stdout) {
  assert.equal(stdout.endsWith("\n"), true)
  assert.equal(stdout.trimEnd().split("\n").length, 1)
  return JSON.parse(stdout)
}

test("CLI JSON reporter emits only one result document and preserves result exit semantics", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-json-cli-"))
  try {
    await mkdir(path.join(root, "tests"))
    await writeFile(path.join(root, "tests", "passed.test.mjs"), [
      `import {describe, it} from ${JSON.stringify(packageEntry)}`,
      'describe("passed suite", () => it("works", () => {}))'
    ].join("\n"))
    await writeFile(path.join(root, "tests", "failed.test.mjs"), [
      `import {describe, it} from ${JSON.stringify(packageEntry)}`,
      'describe("failed suite", () => it("fails", () => { throw new Error("test failed") }))'
    ].join("\n"))
    await writeFile(path.join(root, "tests", "hooks.test.mjs"), [
      `import {afterAll, beforeAll, describe, it} from ${JSON.stringify(packageEntry)}`,
      'describe("hook suite", () => {',
      '  beforeAll(() => { throw new Error("setup failed") })',
      '  afterAll(() => { throw new Error("cleanup failed") })',
      '  it("is blocked", () => {})',
      '})'
    ].join("\n"))

    const passed = runCli(root, ["--reporter", "json", "tests/passed.test.mjs"])
    assert.equal(passed.status, 0, passed.stderr)
    assert.equal(passed.stderr, "")
    assert.deepEqual(parseSingleJsonLine(passed.stdout).counts, {total: 1, passed: 1, failed: 0, skipped: 0})

    const failed = runCli(root, ["--reporter=json", "tests/failed.test.mjs"])
    assert.equal(failed.status, 1)
    assert.equal(failed.stderr, "")
    const failedResult = parseSingleJsonLine(failed.stdout)
    assert.equal(failedResult.tests[0].error.message, "test failed")

    const noMatches = runCli(root, ["--reporter", "json", "--example", "missing", "tests/passed.test.mjs"])
    assert.equal(noMatches.status, 1)
    assert.equal(noMatches.stderr, "")
    assert.equal(parseSingleJsonLine(noMatches.stdout).noMatches, true)

    const hooks = runCli(root, ["--reporter", "json", "tests/hooks.test.mjs"])
    assert.equal(hooks.status, 1)
    assert.equal(hooks.stderr, "")
    const hooksResult = parseSingleJsonLine(hooks.stdout)
    assert.equal(hooksResult.tests[0].error.message, "setup failed")
    assert.equal(hooksResult.errors[0].error.message, "cleanup failed")
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})

test("CLI JSON reporter keeps live console output on stderr", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-json-live-"))
  try {
    await mkdir(path.join(root, "tests"))
    await writeFile(path.join(root, "tests", "live.test.mjs"), [
      `import {configureTests, describe, it} from ${JSON.stringify(packageEntry)}`,
      'configureTests({consoleOutput: "live"})',
      'describe("live suite", () => it("writes", () => {',
      '  console.log("live log")',
      '  console.info("live info")',
      '  console.debug("live debug")',
      '  console.warn("live warn")',
      '  console.error("live error")',
      '}))'
    ].join("\n"))

    const run = runCli(root, ["--reporter", "json", "tests/live.test.mjs"])

    assert.equal(run.status, 0, run.stderr)
    const result = parseSingleJsonLine(run.stdout)
    assert.equal(result.tests[0].attempts[0].consoleOutput, "live log\nlive info\nlive debug\nlive warn\nlive error\n")
    for (const output of ["live log", "live info", "live debug", "live warn", "live error"]) {
      assert.match(run.stderr, new RegExp(`^${output}$`, "mu"))
    }
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})

test("CLI JSON reporter keeps delayed unawaited console output off stdout", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-json-delayed-"))
  try {
    await mkdir(path.join(root, "tests"))
    await writeFile(path.join(root, "tests", "delayed.test.mjs"), [
      `import {describe, it} from ${JSON.stringify(packageEntry)}`,
      'describe("delayed suite", () => it("writes later", () => {',
      '  setImmediate(() => console.log("delayed output"))',
      '}))'
    ].join("\n"))

    const run = runCli(root, ["--reporter", "json", "tests/delayed.test.mjs"])

    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(parseSingleJsonLine(run.stdout).counts, {total: 1, passed: 1, failed: 0, skipped: 0})
    assert.equal(run.stderr, "delayed output\n")
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})

test("explicit default CLI output matches omitted reporter output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-default-cli-"))
  try {
    await mkdir(path.join(root, "tests"))
    await writeFile(path.join(root, "tests", "blocked.test.mjs"), [
      `import {beforeAll, describe, it} from ${JSON.stringify(packageEntry)}`,
      'describe("default suite", () => {',
      '  beforeAll(() => { throw new Error("blocked") })',
      '  it("does not run", () => {})',
      '})'
    ].join("\n"))

    const omitted = runCli(root, ["tests/blocked.test.mjs"])
    const explicit = runCli(root, ["--reporter", "default", "tests/blocked.test.mjs"])

    assert.equal(omitted.status, 1)
    assert.equal(explicit.status, omitted.status)
    assert.equal(explicit.stdout, omitted.stdout)
    assert.equal(explicit.stderr, omitted.stderr)
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})

test("CLI reporter argument failures stay on stderr and help stays on stdout", () => {
  const unsupported = runCli(process.cwd(), ["--reporter", "junit", "definitely-missing.test.mjs"])
  assert.equal(unsupported.status, 1)
  assert.equal(unsupported.stdout, "")
  assert.equal(unsupported.stderr, "--reporter must be one of: default, json\n")

  const missing = runCli(process.cwd(), ["--reporter"])
  assert.equal(missing.status, 1)
  assert.equal(missing.stdout, "")
  assert.equal(missing.stderr, "--reporter requires a value\n")

  const help = runCli(process.cwd(), ["--help"])
  assert.equal(help.status, 0)
  assert.match(help.stdout, /--reporter FORMAT  Use default or json output/u)
  assert.equal(help.stderr, "")
})

test("CLI JSON discovery and import failures stay on stderr without a result document", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-json-errors-"))
  try {
    const discovery = runCli(root, ["--reporter", "json", "missing.test.mjs"])
    assert.equal(discovery.status, 1)
    assert.equal(discovery.stdout, "")
    assert.match(discovery.stderr, /^Test path does not exist:/u)

    await mkdir(path.join(root, "tests"))
    await writeFile(path.join(root, "tests", "broken.test.mjs"), 'throw new Error("import failed")\n')
    const imported = runCli(root, ["--reporter", "json", "tests/broken.test.mjs"])
    assert.equal(imported.status, 1)
    assert.equal(imported.stdout, "")
    assert.equal(imported.stderr, "import failed\n")
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})
