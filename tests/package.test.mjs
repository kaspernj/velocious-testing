import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {promisify} from "node:util"
import test from "node:test"

import {build as bundle} from "esbuild"

const exec = promisify(execFile)
const TEST_DURATION_PATTERN = String.raw`\((?:\d+ms|\d+\.\d{3}s)\)`

/** @param {Record<string, any>} tree @returns {boolean} */
function hasVelociousDependency(tree) {
  if (Object.hasOwn(tree.dependencies || {}, "velocious")) return true
  return Object.values(tree.dependencies || {}).some((dependency) => hasVelociousDependency(dependency))
}

test("lockfile and package metadata contain no Velocious dependency", async () => {
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"))
  assert.equal(hasVelociousDependency(lock.packages?.[""] || {}), false)
  assert.equal(Object.keys(lock.packages || {}).some((name) => name === "node_modules/velocious"), false)
})

test("root and runner bundle for browsers without Node built-ins", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-bundle-"))
  try {
    for (const entry of ["src/index.js", "src/runner.js"]) {
      const result = await bundle({entryPoints: [entry], bundle: true, format: "esm", platform: "browser", write: false, metafile: true})
      assert.ok(result.outputFiles[0].text.length > 0)
      const inputPaths = Object.keys(result.metafile.inputs)
      if (entry === "src/index.js") assert.ok(inputPaths.includes("src/mocks.js"))
      assert.equal(inputPaths.some((input) => input.startsWith("node:")), false)
      assert.doesNotMatch(result.outputFiles[0].text, /\bimport\.meta\b/u)
      for (const inputPath of inputPaths) {
        assert.doesNotMatch(await readFile(inputPath, "utf8"), /\bimport\.meta\b/u, `${inputPath} contains raw import.meta`)
      }
    }
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})

test("packed tarball has explicit exports, resolvable maps, declarations, executable CLI, and works standalone", async () => {
  const artifactDirectory = path.resolve("tmp/package")
  const cacheDirectory = path.resolve("tmp/npm-cache")
  await mkdir(artifactDirectory, {recursive: true})
  const dry = JSON.parse((await exec("npm", ["pack", "--dry-run", "--json", "--cache", cacheDirectory], {cwd: process.cwd()})).stdout)[0]
  const names = dry.files.map((file) => file.path)
  for (const required of ["package.json", "build/index.js", "build/index.d.ts", "build/mocks.js", "build/mocks.d.ts", "build/runner.js", "build/runner.d.ts", "build/node/index.js", "build/node/index.d.ts", "build/node/cli.js", "docs/test-doubles.md", "README.md", "LICENSE"]) {
    assert.ok(names.includes(required), `missing ${required}`)
  }
  assert.ok(names.includes("src/index.js"))
  assert.ok(names.includes("src/node/index.js"))
  assert.equal(names.some((name) => name.startsWith("tests/")), false)
  const shippedPaths = new Set(names)
  for (const mapPath of names.filter((name) => name.endsWith(".map"))) {
    const map = JSON.parse(await readFile(mapPath, "utf8"))
    map.sources.forEach((source, index) => {
      if (typeof map.sourcesContent?.[index] === "string") return
      const resolvedSource = path.posix.normalize(path.posix.join(path.posix.dirname(mapPath), source))
      assert.ok(shippedPaths.has(resolvedSource), `${mapPath} references missing source ${resolvedSource}`)
    })
  }

  const packed = JSON.parse((await exec("npm", ["pack", "--json", "--pack-destination", artifactDirectory, "--cache", cacheDirectory], {cwd: process.cwd()})).stdout)[0]
  const tarball = path.join(artifactDirectory, packed.filename)
  const fixture = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-standalone-"))
  try {
    await writeFile(path.join(fixture, "package.json"), JSON.stringify({name: "standalone-smoke", private: true, type: "module"}))
    await exec("npm", ["install", "--ignore-scripts", "--cache", cacheDirectory, tarball], {cwd: fixture})
    const installedPackage = path.join(fixture, "node_modules", "@velocious", "testing")
    const rootDeclarations = await readFile(path.join(installedPackage, "build", "index.d.ts"), "utf8")
    const mockDeclarations = await readFile(path.join(installedPackage, "build", "mocks.d.ts"), "utf8")
    assert.match(rootDeclarations, /createMockScope, mock.*\.\/mocks\.js/u)
    for (const publicName of ["fn", "spyOn", "stub", "clearAll", "resetAll", "restoreAll"]) {
      assert.match(mockDeclarations, new RegExp(`\\b${publicName}\\b`, "u"))
    }
    const physicalCopy = path.join(fixture, "physical-copy")
    await cp(installedPackage, physicalCopy, {recursive: true})
    const compatibleCopies = await exec("node", ["--input-type=module", "--eval", [
      `const first = await import(${JSON.stringify(path.join(installedPackage, "build", "index.js"))});`,
      `const second = await import(${JSON.stringify(path.join(physicalCopy, "build", "index.js"))});`,
      'if (first.defaultTestContext !== second.defaultTestContext) throw new Error("schema-2 copies split the default context")',
      'first.describe("shared physical tree", () => first.it("visible", () => {}));',
      'if (second.defaultTestContext.registry.suites.at(-1)?.name !== "shared physical tree") throw new Error("registration was not shared")',
      'console.log(`${first.defaultTestContext.protocolMajor}/${first.defaultTestContext.schemaVersion}`)'
    ].join("\n")], {cwd: fixture})
    assert.equal(compatibleCopies.stdout.trim(), "1/2")
    await exec("node", ["--input-type=module", "--eval", [
      'globalThis[Symbol.for("@velocious/testing.default-context.v1")] = {protocolMajor: 1, schemaVersion: 1, registry: {suites: []}};',
      `await import(${JSON.stringify(path.join(physicalCopy, "build", "index.js"))}).then(`,
      '  () => { throw new Error("schema mismatch unexpectedly registered") },',
      '  (error) => { if (!/found protocol 1\\/schema 1, expected protocol 1\\/schema 2/.test(error.message)) throw error }',
      ')'
    ].join("\n")], {cwd: fixture})
    await mkdir(path.join(fixture, "tests"))
    await writeFile(path.join(fixture, "tests", "smoke.test.js"), [
      'import {describe, expect, it} from "@velocious/testing"',
      'describe("standalone", () => {',
      '  it("selected by line", () => expect(2 + 2).toEqual(4))',
      '  it("not selected by line", () => expect(true).toBeTrue())',
      '})'
    ].join("\n"))
    const cli = await exec(path.join(fixture, "node_modules", ".bin", "velocious-test"), [], {cwd: fixture})
    assert.match(cli.stdout, new RegExp(`^✓ standalone selected by line ${TEST_DURATION_PATTERN}$`, "mu"))
    assert.match(cli.stdout, new RegExp(`^✓ standalone not selected by line ${TEST_DURATION_PATTERN}$`, "mu"))
    assert.match(cli.stdout, /2 passed, 0 failed, 2 total/)
    const locationProbe = await exec("node", ["--input-type=module", "--eval", [
      'import {runNodeTests} from "@velocious/testing/node";',
      'const result = await runNodeTests({candidates: ["tests/smoke.test.js"]});',
      'console.log(JSON.stringify(result.tests.map((test) => test.location)));'
    ].join("\n")], {cwd: fixture})
    assert.deepEqual(JSON.parse(locationProbe.stdout), [
      {filePath: path.join(fixture, "tests", "smoke.test.js"), line: 3},
      {filePath: path.join(fixture, "tests", "smoke.test.js"), line: 4}
    ])
    const byLine = await exec(path.join(fixture, "node_modules", ".bin", "velocious-test"), ["tests/smoke.test.js:3"], {cwd: fixture})
    assert.match(byLine.stdout, new RegExp(`^✓ standalone selected by line ${TEST_DURATION_PATTERN}$`, "mu"))
    assert.doesNotMatch(byLine.stdout, /✓ standalone not selected by line/)
    assert.match(byLine.stdout, /1 passed, 0 failed, 1 total/)
    await writeFile(path.join(fixture, "tests", "falsy.test.js"), [
      'import {describe, it} from "@velocious/testing"',
      'describe("standalone falsy failure", () => {',
      '  it("fails", () => { throw undefined })',
      '})'
    ].join("\n"))
    await assert.rejects(
      exec(path.join(fixture, "node_modules", ".bin", "velocious-test"), ["tests/falsy.test.js"], {cwd: fixture}),
      (error) => error.code === 1 &&
        new RegExp(`^✗ standalone falsy failure fails ${TEST_DURATION_PATTERN}$`, "mu").test(error.stdout) &&
        /0 passed, 1 failed, 1 total/.test(error.stdout) && /undefined/.test(error.stderr)
    )
    await writeFile(path.join(fixture, "tests", "retry.test.js"), [
      'import {describe, it} from "@velocious/testing"',
      "let attempts = 0",
      'describe("standalone retry", () => {',
      '  it("passes after retry", {retries: 1}, () => {',
      "    attempts += 1",
      '    if (attempts === 1) throw new Error("retry")',
      "  })",
      "})"
    ].join("\n"))
    const retried = await exec(path.join(fixture, "node_modules", ".bin", "velocious-test"), ["tests/retry.test.js"], {cwd: fixture})
    assert.match(retried.stdout, new RegExp(`^✓ standalone retry passes after retry ${TEST_DURATION_PATTERN}$`, "mu"))
    assert.match(retried.stdout, /1 passed, 0 failed, 1 total/)
    await writeFile(path.join(fixture, "tests", "setup-blocked.test.js"), [
      'import {beforeAll, describe, it} from "@velocious/testing"',
      'describe("standalone setup", () => {',
      '  beforeAll(() => { throw new Error("setup blocked") })',
      '  it("does not run", () => {})',
      "})"
    ].join("\n"))
    await assert.rejects(
      exec(path.join(fixture, "node_modules", ".bin", "velocious-test"), ["tests/setup-blocked.test.js"], {cwd: fixture}),
      (error) => error.code === 1 &&
        /^✗ standalone setup does not run \(not run\)$/mu.test(error.stdout) &&
        /0 passed, 1 failed, 1 total/.test(error.stdout) && /setup blocked/.test(error.stderr)
    )
    await writeFile(path.join(fixture, "tests", "stage1.test.js"), [
      'import {describe, fdescribe, fit, it, test, xdescribe, xit, xtest} from "@velocious/testing"',
      'describe("focus", () => {',
      '  it("ordinary", () => {})',
      '  fit("fit", () => {})',
      '  it.only("it only", () => {})',
      '  xit("xit", () => { throw new Error("xit ran") })',
      '  xtest("xtest", () => { throw new Error("xtest ran") })',
      '  it.todo("todo")',
      '})',
      'fdescribe("table", () => {',
      '  test("test alias", () => {})',
      '  it.each([["array", 2], {kind: "object"}])("row %# %s", () => {})',
      '})',
      'xdescribe("skipped suite", () => {',
      '  it("child", () => { throw new Error("skipped suite ran") })',
      '})',
      'describe.todo("todo suite", () => {',
      '  it("child", () => { throw new Error("todo suite ran") })',
      '})'
    ].join("\n"))
    const stageOneProbe = await exec("node", ["--input-type=module", "--eval", [
      'import {runNodeTests} from "@velocious/testing/node";',
      'const focused = await runNodeTests({candidates: ["tests/stage1.test.js"]});',
      'const all = await runNodeTests({candidates: ["tests/stage1.test.js"], ignoreFocus: true});',
      'const view = (result) => ({status: result.status, counts: result.counts, tests: result.tests.map((entry) => entry.fullName), nonRuns: result.nonRunTests.map((entry) => [entry.fullName, entry.status])});',
      'console.log(JSON.stringify({focused: view(focused), all: view(all)}));'
    ].join("\n")], {cwd: fixture})
    assert.deepEqual(JSON.parse(stageOneProbe.stdout), {
      focused: {
        status: "passed",
        counts: {total: 5, passed: 5, failed: 0, skipped: 6},
        tests: ["focus fit", "focus it only", "table test alias", "table row 0 array", "table row 1 [object Object]"],
        nonRuns: []
      },
      all: {
        status: "passed",
        counts: {total: 6, passed: 6, failed: 0, skipped: 5},
        tests: ["focus ordinary", "focus fit", "focus it only", "table test alias", "table row 0 array", "table row 1 [object Object]"],
        nonRuns: [
          ["focus xit", "skipped"],
          ["focus xtest", "skipped"],
          ["focus todo", "todo"],
          ["skipped suite child", "skipped"],
          ["todo suite child", "todo"]
        ]
      }
    })
    await writeFile(path.join(fixture, "tests", "stage2.test.js"), [
      'import {createMockScope, describe, expect, it, mock} from "@velocious/testing"',
      'if (typeof mock.fn !== "function") throw new Error("default mock scope is missing")',
      'describe("stage2 doubles", () => {',
      '  it("records calls for matchers", () => {',
      '    const fn = createMockScope().fn().mockReturnValueOnce("first").mockReturnValue("later")',
      '    if (fn() !== "first" || fn() !== "later") throw new Error("mock behavior failed")',
      '    expect(fn).toHaveBeenCalledTimes(2)',
      '    expect(fn).toHaveBeenNthCalledWith(1)',
      '  })',
      '  it("restores exact properties", () => {',
      '    const scope = createMockScope()',
      '    const target = {method(value) { return value + 1 }}',
      '    const descriptor = Object.getOwnPropertyDescriptor(target, "method")',
      '    scope.spyOn(target, "method")',
      '    expect(target.method(2)).toBe(3)',
      '    scope.restoreAll()',
      '    expect(Object.getOwnPropertyDescriptor(target, "method")).toEqual(descriptor)',
      '  })',
      '})'
    ].join("\n"))
    const stageTwo = await exec(path.join(fixture, "node_modules", ".bin", "velocious-test"), ["tests/stage2.test.js"], {cwd: fixture})
    assert.match(stageTwo.stdout, new RegExp(`^✓ stage2 doubles records calls for matchers ${TEST_DURATION_PATTERN}$`, "mu"))
    assert.match(stageTwo.stdout, new RegExp(`^✓ stage2 doubles restores exact properties ${TEST_DURATION_PATTERN}$`, "mu"))
    assert.match(stageTwo.stdout, /2 passed, 0 failed, 2 total/)
    await assert.rejects(
      exec(path.join(fixture, "node_modules", ".bin", "velocious-test"), ["--example", "missing"], {cwd: fixture}),
      (error) => error.code === 1 && /No tests matched/.test(error.stderr)
    )
    await exec("node", ["--input-type=module", "--eval", [
      'import "@velocious/testing";',
      'import "@velocious/testing/runner";',
      'import "@velocious/testing/node";',
      'import {createRequire} from "node:module";',
      'const require = createRequire(import.meta.url);',
      'try { require.resolve("velocious"); process.exitCode = 2 } catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error }'
    ].join("\n")], {cwd: fixture})
    const tree = JSON.parse((await exec("npm", ["ls", "--all", "--json"], {cwd: fixture})).stdout)
    assert.equal(hasVelociousDependency(tree), false)
  } finally {
    await rm(fixture, {recursive: true, force: true})
    await rm(cacheDirectory, {recursive: true, force: true})
  }
})
