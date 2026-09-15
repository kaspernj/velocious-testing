import assert from "node:assert/strict"
import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {pathToFileURL} from "node:url"

import {createTestContext, defaultTestContext} from "../src/index.js"
import {discoverTestFiles, parseCliArguments, parsePathLine, runNodeTests} from "../src/node/index.js"

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise })
  return {promise, resolve}
}

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

test("CLI parser accepts explicit default and JSON reporter selection", () => {
  assert.equal(parseCliArguments(["--reporter", "default"]).reporter, "default")
  assert.equal(parseCliArguments(["--reporter=json"]).reporter, "json")
  assert.throws(() => parseCliArguments(["--reporter"]), /--reporter requires a value/u)
  assert.throws(
    () => parseCliArguments(["--reporter", "junit", "missing.test.js"]),
    /--reporter must be one of: default, json/u
  )
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

test("runNodeTests attributes generated table declarations to each callsites", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-node-each-location-"))
  const packageEntry = pathToFileURL(path.resolve("src/index.js")).href
  try {
    const testPath = path.join(root, "table.test.mjs")
    await writeFile(testPath, [
      `import {describe, it} from ${JSON.stringify(packageEntry)}`,
      'describe("locations", () => {',
      '  it.each([["first"], ["second"]])("test %# %s", () => {})',
      '  describe.each([["first"], ["second"]])("suite %# %s", () => it("child", () => {}))',
      '})'
    ].join("\n"))

    const result = await runNodeTests({cwd: root, candidates: [testPath]})

    assert.deepEqual(result.tests.map((entry) => entry.location), [
      {filePath: testPath, line: 3},
      {filePath: testPath, line: 3},
      {filePath: testPath, line: 4},
      {filePath: testPath, line: 4}
    ])
    const bySuiteCallsite = await runNodeTests({cwd: root, candidates: [`${testPath}:4`]})
    assert.deepEqual(bySuiteCallsite.tests.map((entry) => entry.fullName), [
      "locations suite 0 first child",
      "locations suite 1 second child"
    ])
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})

for (const kind of ["it", "test"]) {
  test(`runNodeTests selects stored ${kind}.each rows by the builder line instead of invocation lines`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-node-stored-tests-"))
    const packageEntry = pathToFileURL(path.resolve("src/index.js")).href
    try {
      const testPath = path.join(root, "stored.test.mjs")
      await writeFile(testPath, [
        `import {describe, expect, it, test} from ${JSON.stringify(packageEntry)}`,
        `const cases = ${kind}.each([[1, 2], [2, 4]])`,
        'describe("stored", () => {',
        '  cases("case %d", {tags: "table"}, (value, doubled) => expect(value * 2).toEqual(doubled))',
        '  cases("reused %d", (value, doubled) => expect(value * 2).toEqual(doubled))',
        '  it.each([[3, 6], [4, 8]])("inline %d", (value, doubled) => expect(value * 2).toEqual(doubled))',
        '  it("sibling", () => { throw new Error("sibling was selected") })',
        '})'
      ].join("\n"))

      const selected = await runNodeTests({cwd: root, candidates: [`${testPath}:2`]})
      assert.deepEqual(selected.tests.map((entry) => entry.fullName), [
        "stored case 1", "stored case 2", "stored reused 1", "stored reused 2"
      ])
      assert.equal(selected.status, "passed")
      assert.deepEqual(selected.counts, {total: 4, passed: 4, failed: 0, skipped: 3})
      for (const entry of selected.tests) assert.deepEqual(entry.location, {filePath: testPath, line: 2})
      assert.deepEqual(defaultTestContext.registry.suites[0].tests.map((entry) => entry.location.line), [2, 2, 2, 2, 6, 6, 7])

      for (const line of [4, 5]) {
        const invocation = await runNodeTests({cwd: root, candidates: [`${testPath}:${line}`]})
        assert.equal(invocation.noMatches, true)
        assert.equal(invocation.status, "failed")
        assert.deepEqual(invocation.tests, [])
      }

      const inline = await runNodeTests({cwd: root, candidates: [`${testPath}:6`]})
      assert.deepEqual(inline.tests.map((entry) => entry.fullName), ["stored inline 3", "stored inline 4"])
      assert.equal(inline.status, "passed")
      assert.deepEqual(inline.counts, {total: 2, passed: 2, failed: 0, skipped: 5})
      for (const entry of inline.tests) assert.deepEqual(entry.location, {filePath: testPath, line: 6})
    } finally {
      await rm(root, {recursive: true, force: true})
    }
  })
}

test("runNodeTests selects stored describe.each children through the suite builder line", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-node-stored-suites-"))
  const packageEntry = pathToFileURL(path.resolve("src/index.js")).href
  try {
    const testPath = path.join(root, "stored.test.mjs")
    await writeFile(testPath, [
      `import {describe, expect, it} from ${JSON.stringify(packageEntry)}`,
      'const suites = describe.each([[1, 2], [2, 4]])',
      'describe("stored", () => {',
      '  suites("suite %d", {tags: "table"}, (value, doubled) => {',
      '    it("child", () => expect(value * 2).toEqual(doubled))',
      '  })',
      '  describe.each([[3, 6], [4, 8]])("inline %d", (value, doubled) => {',
      '    it("direct child", () => expect(value * 2).toEqual(doubled))',
      '  })',
      '  describe("sibling", () => it("excluded", () => { throw new Error("sibling was selected") }))',
      '})'
    ].join("\n"))

    const selected = await runNodeTests({cwd: root, candidates: [`${testPath}:2`]})
    assert.deepEqual(selected.tests.map((entry) => entry.fullName), ["stored suite 1 child", "stored suite 2 child"])
    assert.equal(selected.status, "passed")
    assert.deepEqual(selected.counts, {total: 2, passed: 2, failed: 0, skipped: 3})
    for (const entry of selected.tests) assert.deepEqual(entry.location, {filePath: testPath, line: 5})
    const suites = defaultTestContext.registry.suites[0].suites
    assert.deepEqual(suites.map((entry) => entry.location), [
      {filePath: testPath, line: 2}, {filePath: testPath, line: 2},
      {filePath: testPath, line: 7}, {filePath: testPath, line: 7},
      {filePath: testPath, line: 10}
    ])
    for (const suite of suites.slice(0, 2)) assert.deepEqual(suite.tests[0].location, {filePath: testPath, line: 5})

    const invocation = await runNodeTests({cwd: root, candidates: [`${testPath}:4`]})
    assert.equal(invocation.noMatches, true)
    assert.equal(invocation.status, "failed")
    assert.deepEqual(invocation.tests, [])

    const child = await runNodeTests({cwd: root, candidates: [`${testPath}:5`]})
    assert.deepEqual(child.tests.map((entry) => entry.fullName), ["stored suite 1 child", "stored suite 2 child"])
    assert.equal(child.counts.passed, 2)

    const inline = await runNodeTests({cwd: root, candidates: [`${testPath}:7`]})
    assert.deepEqual(inline.tests.map((entry) => entry.fullName), ["stored inline 3 direct child", "stored inline 4 direct child"])
    assert.equal(inline.status, "passed")
    assert.deepEqual(inline.counts, {total: 2, passed: 2, failed: 0, skipped: 3})
    for (const entry of inline.tests) assert.deepEqual(entry.location, {filePath: testPath, line: 8})
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})

test("generated each declarations retain their user callsite and default runs reset declaration state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-node-each-"))
  const packageEntry = pathToFileURL(path.resolve("src/index.js")).href
  try {
    const testPath = path.join(root, "each.test.mjs")
    await writeFile(testPath, [
      `import {describe, it} from ${JSON.stringify(packageEntry)}`,
      'describe("locations", () => {',
      '  it.each([["first"], ["second"]])("case %s", () => {})',
      '  it.skip("later", () => { throw new Error("must not run") })',
      "})"
    ].join("\n"))

    const first = await runNodeTests({cwd: root, candidates: [testPath]})
    const second = await runNodeTests({cwd: root, candidates: [testPath]})

    for (const result of [first, second]) {
      assert.deepEqual(result.tests.map((entry) => entry.location), [
        {filePath: testPath, line: 3},
        {filePath: testPath, line: 3}
      ])
      assert.deepEqual(result.nonRunTests.map((entry) => entry.location), [{filePath: testPath, line: 4}])
      assert.deepEqual(result.counts, {total: 2, passed: 2, failed: 0, skipped: 1})
    }
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})

test("runNodeTests forwards any-match and focused include-tag selection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-node-selection-"))
  try {
    const testPath = path.join(root, "selection.test.mjs")
    await writeFile(testPath, "")

    const anyContext = createTestContext()
    const any = await runNodeTests({
      context: anyContext,
      cwd: root,
      candidates: [testPath],
      includeTags: ["unit", "api"],
      includeTagMode: "any",
      importer: async () => {
        anyContext.describe("node any tags", () => {
          anyContext.it("unit", {tags: ["unit"]}, () => {})
          anyContext.it("api", {tags: ["api"]}, () => {})
        })
      }
    })
    assert.deepEqual(any.tests.map((entry) => entry.fullName), ["node any tags unit", "node any tags api"])

    const focusContext = createTestContext()
    const focused = await runNodeTests({
      context: focusContext,
      cwd: root,
      candidates: [testPath],
      includeTags: ["api"],
      excludeTags: ["slow"],
      focusedTestsBypassIncludeTags: true,
      importer: async () => {
        focusContext.describe("node focus bypass", () => {
          focusContext.fit("eligible", {tags: ["other"]}, () => {})
          focusContext.fit("excluded", {tags: ["other", "slow"]}, () => {})
        })
      }
    })
    assert.deepEqual(focused.tests.map((entry) => entry.fullName), ["node focus bypass eligible"])
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})

test("runNodeTests forwards ignoreFocus to include focused and ordinary tests", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-node-ignore-focus-"))
  try {
    const testPath = path.join(root, "ignore-focus.test.mjs")
    await writeFile(testPath, "")
    const context = createTestContext()

    const result = await runNodeTests({
      context,
      cwd: root,
      candidates: [testPath],
      ignoreFocus: true,
      importer: async () => {
        context.describe("node ignore focus", () => {
          context.fit("focused", () => {})
          context.it("ordinary", () => {})
        })
      }
    })

    assert.deepEqual(result.tests.map((entry) => entry.fullName), [
      "node ignore focus focused",
      "node ignore focus ordinary"
    ])
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})

test("runNodeTests forwards explicit empty suite name omission", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-node-empty-suite-"))
  try {
    const testPath = path.join(root, "empty-suite.test.mjs")
    await writeFile(testPath, "")
    const context = createTestContext()

    const result = await runNodeTests({
      context,
      cwd: root,
      candidates: [testPath],
      omitEmptySuiteNames: true,
      examples: [/^named works$/u],
      importer: async () => {
        context.describe("", () => {
          context.describe("named", () => {
            context.it("works", () => {})
          })
        })
      }
    })

    assert.deepEqual(result.tests.map((entry) => entry.fullName), ["named works"])
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})

test("runNodeTests forwards executor-owned timeout without advancing before cleanup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-node-timeout-"))
  const cleanupStarted = deferred()
  const releaseCleanup = deferred()
  let cleanupFinished = false
  let secondTestStarted = false
  let receivedTimeoutMs
  try {
    const testPath = path.join(root, "timeout.test.mjs")
    await writeFile(testPath, "")
    const context = createTestContext()
    const runPromise = runNodeTests({
      context,
      cwd: root,
      candidates: [testPath],
      attemptExecutorOwnsTimeout: true,
      importer: async () => {
        context.describe("node timeout ownership", () => {
          context.it("times out downstream", {timeoutMs: 5}, () => {})
          context.it("starts after cleanup", () => {})
        })
      },
      attemptExecutor: async (input) => {
        if (input.test.name === "starts after cleanup") {
          secondTestStarted = true
          assert.equal(cleanupFinished, true)
          return
        }

        receivedTimeoutMs = input.timeoutMs
        await new Promise((resolve) => setTimeout(resolve, input.timeoutMs * 2))
        cleanupStarted.resolve()
        await releaseCleanup.promise
        cleanupFinished = true
        throw new Error("node downstream timeout after cleanup")
      }
    })

    await cleanupStarted.promise
    let orderingError
    try {
      assert.equal(secondTestStarted, false)
    } catch (error) {
      orderingError = error
    } finally {
      releaseCleanup.resolve()
    }
    const result = await runPromise

    if (orderingError) throw orderingError
    assert.equal(receivedTimeoutMs, 5)
    assert.equal(cleanupFinished, true)
    assert.equal(secondTestStarted, true)
    assert.deepEqual(result.counts, {total: 2, passed: 1, failed: 1, skipped: 0})
    assert.equal(result.tests[0].error.message, "node downstream timeout after cleanup")
  } finally {
    releaseCleanup.resolve()
    await rm(root, {recursive: true, force: true})
  }
})

test("runNodeTests forwards the suite hook executor", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-node-suite-hooks-"))
  try {
    const testPath = path.join(root, "suite-hooks.test.mjs")
    await writeFile(testPath, "")
    const context = createTestContext()
    const sentinel = {configuration: "node sentinel"}
    const phases = []

    const result = await runNodeTests({
      context,
      cwd: root,
      candidates: [testPath],
      importer: async () => {
        context.describe("node suite hooks", () => {
          context.beforeAll((argument) => assert.equal(argument, sentinel))
          context.afterAll((argument) => assert.equal(argument, sentinel))
          context.it("passes", () => {})
        })
      },
      suiteHookExecutor: async (input) => {
        phases.push(input.phase)
        await input.defaultExecute([sentinel])
      }
    })

    assert.equal(result.status, "passed")
    assert.deepEqual(phases, ["beforeAll", "afterAll"])
  } finally {
    await rm(root, {recursive: true, force: true})
  }
})
