import assert from "node:assert/strict"
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {pathToFileURL} from "node:url"

import {createTestContext} from "../src/index.js"
import {discoverTestFiles, parseCliArguments, parsePathLine, runNodeTests} from "../src/node/index.js"

test("path:line parsing accepts POSIX and Windows-style candidates", () => {
  assert.deepEqual(parsePathLine("test/unit.test.js:42"), {path: "test/unit.test.js", line: 42})
  assert.deepEqual(parsePathLine("C:\\repo\\tests\\unit.test.js:17"), {path: "C:/repo/tests/unit.test.js", line: 17})
  assert.deepEqual(parsePathLine("C:\\repo\\tests\\unit.test.js"), {path: "C:/repo/tests/unit.test.js"})
})

test("conventional discovery is recursive, deterministic, and ignores non-tests", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-discovery-"))
  try {
    await mkdir(path.join(root, "tests", "nested"), {recursive: true})
    await writeFile(path.join(root, "tests", "z.spec.mjs"), "")
    await writeFile(path.join(root, "tests", "nested", "a.test.js"), "")
    await writeFile(path.join(root, "tests", "helper.js"), "")
    assert.deepEqual(await discoverTestFiles({cwd: root}), [
      path.join(root, "tests", "nested", "a.test.js"),
      path.join(root, "tests", "z.spec.mjs")
    ])
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})

test("CLI parser exposes v1 filters, setup, retry, timeout, and explicit candidates", () => {
  assert.deepEqual(parseCliArguments([
    "--include-tag", "unit", "--exclude-tag=slow", "--example", "works",
    "--setup", "test/setup.mjs", "--retries", "2", "--timeout", "500", "test/a.test.mjs:8"
  ]), {
    candidates: ["test/a.test.mjs:8"],
    includeTags: ["unit"],
    excludeTags: ["slow"],
    examples: ["works"],
    setupFiles: ["test/setup.mjs"],
    retries: 2,
    timeoutMs: 500
  })
})

test("runNodeTests imports setup and test files, captures locations, filters, and resets context", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-node-"))
  const context = createTestContext()
  const packageEntry = pathToFileURL(path.resolve("src/index.js")).href
  try {
    const setupPath = path.join(root, "setup.mjs")
    const testPath = path.join(root, "sample.test.mjs")
    await writeFile(setupPath, `import {configureTests} from ${JSON.stringify(packageEntry)}\nconfigureTests({excludeTags: ["default-skip"]})\n`)
    await writeFile(testPath, [
      `import {describe, it} from ${JSON.stringify(packageEntry)}`,
      "describe(\"node suite\", () => {",
      "  it(\"works\", {tags: [\"unit\"]}, () => {})",
      "  it(\"skipped\", {tags: [\"default-skip\"]}, () => { throw new Error(\"no\") })",
      "})"
    ].join("\n"))

    // The imported DSL uses the process-wide default context; this explicit context
    // proves the runner itself accepts isolated contexts independently.
    const first = await runNodeTests({cwd: root, candidates: [testPath], setupFiles: [setupPath]})
    assert.equal(first.counts.passed, 1)
    assert.equal(first.tests[0].location.filePath, testPath)
    assert.equal(first.tests[0].location.line, 3)

    const second = await runNodeTests({cwd: root, candidates: [`${testPath}:3`], examples: ["works"]})
    assert.deepEqual(second.counts, {total: 1, passed: 1, failed: 0, skipped: 1})

    context.describe("isolated", () => context.it("works", () => {}))
    const isolated = await runNodeTests({context, cwd: root, candidates: [], importer: async () => {}})
    assert.equal(isolated.noMatches, true)
    assert.equal(context.registry.suites.length, 0)
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})
