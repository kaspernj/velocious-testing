import assert from "node:assert/strict"
import {spawn, spawnSync} from "node:child_process"
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, it} from "node:test"
import {pathToFileURL} from "node:url"

import {parseTimingManifestMergeArguments} from "../src/node/index.js"

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

describe("standalone Node CLI", () => {
it("CLI JSON reporter emits only one result document and preserves result exit semantics", async () => {
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

it("CLI JSON reporter keeps live console output on stderr", async () => {
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

it("CLI JSON reporter exclusively owns the stdout stream", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-json-stdout-"))
  try {
    await mkdir(path.join(root, "tests"))
    await writeFile(path.join(root, "tests", "stdout.test.mjs"), [
      'import {Console} from "node:console"',
      `import {describe, it} from ${JSON.stringify(packageEntry)}`,
      'const accepted = process.stdout.write("direct output\\n", "utf8", () => {',
      '  process.stdout.write("callback output\\n")',
      '})',
      'if (typeof accepted !== "boolean") throw new Error("stdout.write did not return a boolean")',
      'new Console({stdout: process.stdout, stderr: process.stderr}).log("separate console output")',
      'describe("stdout suite", () => it("passes", () => {}))'
    ].join("\n"))

    const run = runCli(root, ["--reporter", "json", "tests/stdout.test.mjs"])

    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(parseSingleJsonLine(run.stdout).counts, {total: 1, passed: 1, failed: 0, skipped: 0})
    assert.deepEqual(run.stderr.trimEnd().split("\n").sort(), [
      "callback output",
      "direct output",
      "separate console output"
    ])
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})

it("CLI JSON reporter keeps delayed unawaited console output off stdout", async () => {
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

it("CLI JSON reporter keeps work scheduled during beforeExit off stdout", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-json-before-exit-"))
  try {
    await mkdir(path.join(root, "tests"))
    await writeFile(path.join(root, "tests", "before-exit.test.mjs"), [
      `import {describe, it} from ${JSON.stringify(packageEntry)}`,
      'process.once("beforeExit", () => setImmediate(() => console.log("beforeExit output")))',
      'describe("beforeExit suite", () => it("passes", () => {}))'
    ].join("\n"))

    const run = runCli(root, ["--reporter", "json", "tests/before-exit.test.mjs"])

    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(parseSingleJsonLine(run.stdout).counts, {total: 1, passed: 1, failed: 0, skipped: 0})
    assert.equal(run.stderr, "beforeExit output\n")
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})

it("CLI JSON reporter keeps delayed console output off stdout after an import failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-json-delayed-import-"))
  try {
    await mkdir(path.join(root, "tests"))
    await writeFile(path.join(root, "tests", "broken.test.mjs"), [
      'setImmediate(() => console.log("delayed output"))',
      'throw new Error("import failed")'
    ].join("\n"))

    const run = runCli(root, ["--reporter", "json", "tests/broken.test.mjs"])

    assert.equal(run.status, 1)
    assert.equal(run.stdout, "")
    assert.equal(run.stderr, "import failed\ndelayed output\n")
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})

it("CLI JSON reporter reports import failures without waiting for persistent handles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-json-persistent-import-"))
  try {
    await mkdir(path.join(root, "tests"))
    await writeFile(path.join(root, "tests", "broken.test.mjs"), [
      'import net from "node:net"',
      "net.createServer().listen(0)",
      'setImmediate(() => process.stderr.write("fixture checkpoint\\n"))',
      'throw new Error("persistent import failed")'
    ].join("\n"))

    const child = spawn(process.execPath, [cliPath, "--reporter", "json", "tests/broken.test.mjs"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"]
    })
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    /** @type {() => void} */
    let checkpointReached
    const checkpoint = new Promise((resolve) => { checkpointReached = resolve })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
      if (stderr.includes("fixture checkpoint\n")) checkpointReached()
    })
    const exited = new Promise((resolve, reject) => {
      child.once("error", reject)
      child.once("exit", (code, signal) => resolve({code, signal}))
    })

    try {
      await Promise.race([
        checkpoint,
        exited.then(({code, signal}) => {
          throw new Error(`CLI exited before fixture checkpoint: code=${code} signal=${signal}`)
        })
      ])
      assert.equal(stdout, "")
      assert.equal(stderr, "persistent import failed\nfixture checkpoint\n")
    } finally {
      assert.equal(child.kill("SIGTERM"), true)
      assert.deepEqual(await exited, {code: null, signal: "SIGTERM"})
    }
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})

it("explicit default CLI output matches omitted reporter output", async () => {
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

it("CLI reporter argument failures stay on stderr and help stays on stdout", () => {
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

it("CLI JSON discovery and import failures stay on stderr without a result document", async () => {
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

it("runs deterministic standalone groups and rejects incomplete grouping options", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-cli-groups-"))
  try {
    await mkdir(path.join(root, "spec"))
    for (const name of ["a.test.mjs", "b.test.mjs"]) {
      await writeFile(path.join(root, "spec", name), [
        `import {describe, it} from ${JSON.stringify(packageEntry)}`,
        `describe(${JSON.stringify(name)}, () => it("passes", () => {}))`
      ].join("\n"))
    }

    const first = runCli(root, ["--groups", "4", "--group-number", "1", "spec"])
    const fourth = runCli(root, ["--groups=4", "--group-number=4", "spec"])
    const incomplete = runCli(root, ["--groups=4", "spec"])

    assert.equal(first.status, 0, first.stderr)
    assert.match(first.stdout, /Running group 1 of 4 \(1 files\)/u)
    assert.match(first.stdout, /1 passed, 0 failed, 1 total/u)
    assert.equal(fourth.status, 1)
    assert.match(fourth.stdout, /Running group 4 of 4 \(0 files\)/u)
    assert.match(fourth.stderr, /No tests matched/u)
    assert.equal(incomplete.status, 1)
    assert.match(incomplete.stderr, /provided together/u)
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})

it("profiles two shards, merges them non-destructively, and reuses the timing manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-cli-profile-"))
  try {
    await mkdir(path.join(root, "spec"))
    const profilePaths = [path.join(root, "profile-1.json"), path.join(root, "profile-2.json")]
    const manifestPath = path.join(root, "timings.json")
    for (const name of ["a.test.mjs", "b.test.mjs"]) {
      await writeFile(path.join(root, "spec", name), [
        `import {describe, it} from ${JSON.stringify(packageEntry)}`,
        `describe(${JSON.stringify(name)}, () => it("passes", async () => {}))`
      ].join("\n"))
    }
    for (const groupNumber of [1, 2]) {
      const result = runCli(root, [
        "--groups=2", `--group-number=${groupNumber}`,
        `--profile-json=${profilePaths[groupNumber - 1]}`, "spec"
      ])
      assert.equal(result.status, 0, result.stderr)
      const profile = JSON.parse(await (await import("node:fs/promises")).readFile(profilePaths[groupNumber - 1], "utf8"))
      assert.equal(profile.schema, "velocious.test-profile")
      assert.equal(profile.schemaVersion, 1)
      assert.equal(profile.status, "passed")
      assert.deepEqual(profile.selection.shard, {groups: 2, groupNumber})
      assert.equal(profile.selection.discoveredFileCount, 2)
      assert.equal(profile.selection.fileCount, 1)
      assert.equal(Object.keys(profile.timingManifest).length, 1)
    }

    await writeFile(manifestPath, "existing output\n")
    const incomplete = runCli(root, ["timing-manifest:merge", "--output", manifestPath, profilePaths[0]])
    assert.equal(incomplete.status, 1)
    assert.match(incomplete.stderr, /missing shard/iu)
    assert.equal(await (await import("node:fs/promises")).readFile(manifestPath, "utf8"), "existing output\n")

    const merged = runCli(root, [
      "timing-manifest:merge", `--output=${manifestPath}`, profilePaths[1], profilePaths[0]
    ])
    assert.equal(merged.status, 0, merged.stderr)
    assert.match(merged.stdout, /Merged 2 test profile shards/u)
    assert.deepEqual(Object.keys(JSON.parse(await (await import("node:fs/promises")).readFile(manifestPath, "utf8"))), [
      "spec/a.test.mjs", "spec/b.test.mjs"
    ])

    const reused = runCli(root, [
      "--groups=2", "--group-number=1", `--timing-manifest=${manifestPath}`, "spec"
    ])
    assert.equal(reused.status, 0, reused.stderr)
    assert.match(reused.stdout, /Timing manifest coverage: measured=2 heuristic=0 stale=0/u)
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})

it("strictly parses resolved merge arguments", () => {
  const cwd = path.resolve("/workspace/project")
  assert.deepEqual(parseTimingManifestMergeArguments([
    "profile-1.json", "--output=timings.json", "profile-2.json"
  ], {cwd}), {
    inputPaths: [path.join(cwd, "profile-1.json"), path.join(cwd, "profile-2.json")],
    outputPath: path.join(cwd, "timings.json")
  })
  assert.throws(() => parseTimingManifestMergeArguments(["one.json"], {cwd}), /--output is required/u)
  assert.throws(() => parseTimingManifestMergeArguments(["one.json", "--output", "one.json"], {cwd}), /must not overwrite/u)
  assert.throws(() => parseTimingManifestMergeArguments(["--wat"], {cwd}), /unknown argument/iu)
})
})
