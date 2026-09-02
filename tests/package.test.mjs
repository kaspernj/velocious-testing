import assert from "node:assert/strict"
import {execFile} from "node:child_process"
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises"
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
  for (const required of ["package.json", "build/index.js", "build/index.d.ts", "build/runner.js", "build/runner.d.ts", "build/node/index.js", "build/node/index.d.ts", "build/node/cli.js", "README.md", "LICENSE"]) {
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
