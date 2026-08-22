import assert from "node:assert/strict"
import test from "node:test"

import {createTestContext} from "../src/index.js"
import {PROTOCOL_MAJOR, TestRunner, runTests} from "../src/runner.js"

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise })
  return {promise, resolve}
}

test("runner executes inherited hooks in order and reports pass/fail", async () => {
  const context = createTestContext()
  const calls = []

  context.describe("outer", () => {
    context.beforeAll(() => calls.push("beforeAll"))
    context.afterAll(() => calls.push("afterAll"))
    context.beforeEach(() => calls.push("outer beforeEach"))
    context.afterEach(() => calls.push("outer afterEach"))
    context.describe("inner", () => {
      context.beforeAll(() => calls.push("inner beforeAll"))
      context.afterAll(() => calls.push("inner afterAll"))
      context.beforeEach(() => calls.push("inner beforeEach"))
      context.afterEach(() => calls.push("inner afterEach"))
      context.it("passes", () => calls.push("test"))
      context.it("fails", () => { throw new Error("boom") })
    })
  })

  const result = await runTests({context})

  assert.equal(result.protocolMajor, PROTOCOL_MAJOR)
  assert.deepEqual(result.counts, {total: 2, passed: 1, failed: 1, skipped: 0})
  assert.equal(result.tests[1].error.message, "boom")
  assert.deepEqual(calls, [
    "beforeAll",
    "inner beforeAll",
    "outer beforeEach", "inner beforeEach", "test", "inner afterEach", "outer afterEach",
    "outer beforeEach", "inner beforeEach", "inner afterEach", "outer afterEach",
    "inner afterAll",
    "afterAll"
  ])
})

test("cleanup runs after hook and setup failures", async () => {
  const context = createTestContext()
  const calls = []

  context.describe("cleanup", () => {
    context.beforeAll(() => { calls.push("beforeAll"); throw new Error("setup") })
    context.afterAll(() => calls.push("afterAll"))
    context.it("never runs", () => calls.push("test"))
  })

  const result = await runTests({context})
  assert.equal(result.counts.failed, 1)
  assert.deepEqual(calls, ["beforeAll", "afterAll"])
})

test("every afterEach runs in reverse order and aggregates failures after the primary error", async () => {
  const context = createTestContext()
  const calls = []
  context.describe("outer", () => {
    context.afterEach(() => { calls.push("outer afterEach"); throw new Error("outer teardown") })
    context.describe("inner", () => {
      context.afterEach(() => calls.push("inner first afterEach"))
      context.afterEach(() => { calls.push("inner second afterEach"); throw new Error("inner teardown") })
      context.it("fails", () => { calls.push("test"); throw new Error("primary failure") })
    })
  })

  const result = await runTests({context})
  assert.deepEqual(calls, ["test", "inner second afterEach", "inner first afterEach", "outer afterEach"])
  assert.deepEqual(result.counts, {total: 1, passed: 0, failed: 1, skipped: 0})
  assert.equal(result.tests[0].error.name, "AggregateError")
  assert.equal(result.tests[0].error.message, "primary failure")
  assert.deepEqual(result.tests[0].error.errors.map((error) => error.message), [
    "primary failure", "inner teardown", "outer teardown"
  ])
})

test("every afterAll runs in reverse order and aggregates every cleanup failure", async () => {
  const context = createTestContext()
  const calls = []
  context.describe("suite cleanup", () => {
    context.afterAll(() => { calls.push("first afterAll"); throw new Error("first cleanup") })
    context.afterAll(() => calls.push("middle afterAll"))
    context.afterAll(() => { calls.push("last afterAll"); throw new Error("last cleanup") })
    context.it("passes", () => calls.push("test"))
  })

  const result = await runTests({context})
  assert.deepEqual(calls, ["test", "last afterAll", "middle afterAll", "first afterAll"])
  assert.deepEqual(result.counts, {total: 1, passed: 1, failed: 0, skipped: 0})
  assert.equal(result.status, "failed")
  assert.equal(result.errors.length, 1)
  assert.deepEqual(result.errors[0].error.errors.map((error) => error.message), ["last cleanup", "first cleanup"])
})

test("timeout and afterAll failures preserve cleanup and accounting invariants", async () => {
  const context = createTestContext()
  const calls = []
  context.describe("timeout cleanup", () => {
    context.afterEach(() => calls.push("afterEach"))
    context.afterAll(() => { calls.push("afterAll"); throw new Error("after all failed") })
    context.it("hangs", {timeoutMs: 5}, async () => await new Promise(() => {}))
  })

  const result = await runTests({context})
  assert.deepEqual(calls, ["afterEach", "afterAll"])
  assert.equal(result.counts.total, result.counts.passed + result.counts.failed)
  assert.deepEqual(result.counts, {total: 1, passed: 0, failed: 1, skipped: 0})
  assert.equal(result.errors[0].phase, "afterAll")
  assert.equal(result.status, "failed")
})

test("an executor-owned timeout settles cleanup before the next test begins", async () => {
  const context = createTestContext()
  const cleanupStarted = deferred()
  const releaseCleanup = deferred()
  let cleanupFinished = false
  let secondTestStarted = false
  let receivedTimeoutMs

  context.describe("executor timeout ownership", () => {
    context.it("times out downstream", {timeoutMs: 5}, () => {})
    context.it("starts after cleanup", () => {})
  })

  const runner = new TestRunner({
    attemptExecutorOwnsTimeout: true,
    context,
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
      throw new Error("downstream timeout after cleanup")
    }
  })

  const runPromise = runner.run()
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
  assert.equal(result.tests[0].error.message, "downstream timeout after cleanup")
})

test("runner awaits asynchronous reporters before execution advances", async () => {
  const context = createTestContext()
  const reporterStarted = deferred()
  const releaseReporter = deferred()
  let testStarted = false

  context.describe("reporter ordering", () => {
    context.it("waits", () => { testStarted = true })
  })

  const runner = new TestRunner({
    context,
    reporter: {onEvent: async (event) => {
      if (event.type !== "run:start") return
      reporterStarted.resolve()
      await releaseReporter.promise
    }}
  })
  const runPromise = runner.run()

  await reporterStarted.promise
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(testStarted, false)
  releaseReporter.resolve()
  const result = await runPromise

  assert.deepEqual(result.counts, {total: 1, passed: 1, failed: 0, skipped: 0})
})

test("active suite cleanup is reverse-ordered and idempotent while setup is blocked", async () => {
  const context = createTestContext()
  const childSetupStarted = deferred()
  const releaseChildSetup = deferred()
  const calls = []

  context.describe("outer", () => {
    context.beforeAll(() => calls.push("outer beforeAll"))
    context.afterAll(() => calls.push("outer afterAll"))
    context.describe("child", () => {
      context.beforeAll(async () => {
        calls.push("child beforeAll")
        childSetupStarted.resolve()
        await releaseChildSetup.promise
      })
      context.afterAll(() => calls.push("child afterAll"))
      context.it("continues", () => calls.push("test"))
    })
  })

  const runner = new TestRunner({context})
  const runPromise = runner.run()
  await childSetupStarted.promise
  let cleanupError
  try {
    await runner.cleanupActiveSuites()
    await runner.cleanupActiveSuites()
  } catch (error) {
    cleanupError = error
  } finally {
    releaseChildSetup.resolve()
  }
  const result = await runPromise

  if (cleanupError) throw cleanupError
  assert.deepEqual(calls, [
    "outer beforeAll",
    "child beforeAll",
    "child afterAll",
    "outer afterAll",
    "test"
  ])
  assert.deepEqual(result.counts, {total: 1, passed: 1, failed: 0, skipped: 0})
})

test("suite lifecycle hooks honor inherited timeout configuration", async () => {
  const context = createTestContext()
  const calls = []
  context.describe("timed suite", {timeoutMs: 5}, () => {
    context.beforeAll(async () => await new Promise((resolve) => setTimeout(resolve, 20)))
    context.afterAll(() => calls.push("afterAll"))
    context.it("does not run", () => calls.push("test"))
  })

  const result = await runTests({context})
  assert.deepEqual(calls, ["afterAll"])
  assert.equal(result.counts.failed, 1)
  assert.match(result.tests[0].error.message, /Timed out after 5ms/)
})

test("retries, timeouts, console capture, events, and collaborators are structured", async () => {
  const context = createTestContext()
  const events = []
  let attempts = 0
  let executorCalls = 0

  context.describe("behavior", () => {
    context.it("retries", {retries: 1}, (argument) => {
      console.log("attempt", attempts + 1)
      attempts += 1
      assert.equal(argument, "resolved")
      if (attempts === 1) throw new Error("again")
    })
    context.it("times out", {timeoutMs: 5}, async () => await new Promise(() => {}))
  })

  const runner = new TestRunner({
    context,
    reporter: {onEvent: (event) => events.push(event)},
    testArgumentResolver: () => ["resolved"],
    attemptExecutor: async (input) => {
      executorCalls += 1
      return await input.defaultExecute()
    }
  })
  const result = await runner.run()

  assert.equal(result.counts.passed, 1)
  assert.equal(result.counts.failed, 1)
  assert.equal(result.tests[0].attempts.length, 2)
  assert.equal(result.tests[0].error, undefined)
  assert.match(result.tests[0].attempts[0].consoleOutput, /attempt 1/)
  assert.match(result.tests[1].error.message, /Timed out after 5ms/)
  assert.equal(executorCalls, 3)
  assert.ok(events.some((event) => event.type === "run:start"))
  assert.ok(events.some((event) => event.type === "test:finish"))
})

test("every falsy throw and rejection fails test bodies and lifecycle hooks", async () => {
  const context = createTestContext()
  const events = []
  const falsyValues = [undefined, null, false, 0, ""]
  const callbacks = [
    ["throw", (value) => () => { throw value }],
    ["reject", (value) => async () => await Promise.reject(value)]
  ]

  for (const [index, value] of falsyValues.entries()) {
    for (const [mode, callbackFor] of callbacks) {
      const callback = callbackFor(value)
      context.describe(`body ${mode} ${index}`, () => context.it("fails", callback))
      for (const hookName of ["beforeAll", "beforeEach", "afterEach", "afterAll"]) {
        context.describe(`${hookName} ${mode} ${index}`, () => {
          context[hookName](callback)
          context.it("is accounted", () => {})
        })
      }
    }
  }

  const result = await runTests({context, reporter: {onEvent: (event) => events.push(event)}})

  assert.equal(result.status, "failed")
  assert.deepEqual(result.counts, {total: 50, passed: 10, failed: 40, skipped: 0})
  assert.equal(result.errors.length, 10)
  assert.equal(result.tests.filter((entry) => entry.status === "failed").length, 40)
  assert.ok(result.tests.filter((entry) => entry.status === "failed").every((entry) => entry.error?.name === "Error"))
  assert.deepEqual(new Set(result.tests.filter((entry) => entry.error).map((entry) => entry.error.message)), new Set(["undefined", "null", "false", "0", ""]))
  assert.deepEqual(new Set(result.errors.map((entry) => entry.error.message)), new Set(["undefined", "null", "false", "0", ""]))
  assert.equal(events.filter((event) => event.type === "test:finish").length, 50)
  assert.deepEqual(events.at(-1).result.counts, result.counts)
  assert.equal(events.at(-1).result.status, "failed")
})

test("a falsy rejection retries and produces coherent attempt and finish events", async () => {
  const context = createTestContext()
  const events = []
  let invocations = 0
  context.describe("retry falsy", () => {
    context.it("passes second attempt", {retries: 1}, async () => {
      invocations += 1
      if (invocations === 1) await Promise.reject(false)
    })
  })

  const result = await runTests({context, reporter: {onEvent: (event) => events.push(event)}})

  assert.deepEqual(result.counts, {total: 1, passed: 1, failed: 0, skipped: 0})
  assert.equal(result.tests[0].status, "passed")
  assert.equal(result.tests[0].attempts.length, 2)
  assert.equal(result.tests[0].attempts[0].error.message, "false")
  assert.equal(result.tests[0].attempts[1].error, undefined)
  assert.equal(result.tests[0].error, undefined)
  assert.deepEqual(events.filter((event) => event.type === "attempt:finish").map((event) => event.attempt.error?.message), ["false", undefined])
  assert.equal(events.find((event) => event.type === "test:finish").test.status, "passed")
})

test("an empty AggregateError remains a failure", async () => {
  const context = createTestContext()
  context.describe("aggregate", () => {
    context.it("fails", () => { throw new AggregateError([], "empty aggregate") })
  })

  const result = await runTests({context})

  assert.deepEqual(result.counts, {total: 1, passed: 0, failed: 1, skipped: 0})
  assert.equal(result.tests[0].error.name, "AggregateError")
  assert.equal(result.tests[0].error.message, "empty aggregate")
  assert.deepEqual(result.tests[0].error.errors, [])
})

test("focus, tags, examples, and path-line filters select tests", async () => {
  let line = 30
  const context = createTestContext({declarationLocator: () => ({filePath: "/repo/tests/selection.test.js", line: line++})})
  context.describe("selection", {tags: ["unit"]}, () => {
    context.it("ordinary", () => {})
    context.fit("chosen", {tags: ["api"]}, () => {})
    context.fit("excluded", {tags: ["slow"]}, () => {})
  })

  const focused = await runTests({context, excludeTags: ["slow"]})
  assert.deepEqual(focused.tests.map((entry) => entry.fullName), ["selection chosen"])

  const byExample = await runTests({context, ignoreFocus: true, examples: [/ordinary/]})
  assert.deepEqual(byExample.tests.map((entry) => entry.fullName), ["selection ordinary"])

  const byIncludedTag = await runTests({context, ignoreFocus: true, includeTags: ["api"]})
  assert.deepEqual(byIncludedTag.tests.map((entry) => entry.fullName), ["selection chosen"])

  const chosenLine = context.registry.suites[0].tests[0].location.line
  const byLine = await runTests({context, ignoreFocus: true, lineFilters: {"/repo/tests/selection.test.js": [chosenLine]}})
  assert.deepEqual(byLine.tests.map((entry) => entry.fullName), ["selection ordinary"])
})

test("include tags support any-match mode and focused include bypass without bypassing exclusions", async () => {
  const anyContext = createTestContext()
  anyContext.describe("any tags", () => {
    anyContext.it("unit", {tags: ["unit"]}, () => {})
    anyContext.it("api", {tags: ["api"]}, () => {})
    anyContext.it("both", {tags: ["unit", "api"]}, () => {})
  })

  const defaultAll = await runTests({context: anyContext, includeTags: ["unit", "api"]})
  assert.deepEqual(defaultAll.tests.map((entry) => entry.fullName), ["any tags both"])

  const any = await runTests({context: anyContext, includeTags: ["unit", "api"], includeTagMode: "any"})
  assert.deepEqual(any.tests.map((entry) => entry.fullName), ["any tags unit", "any tags api", "any tags both"])

  const focusContext = createTestContext()
  focusContext.describe("focus bypass", () => {
    focusContext.fit("eligible", {tags: ["other"]}, () => {})
    focusContext.fit("still excluded", {tags: ["other", "slow"]}, () => {})
  })
  const focused = await runTests({
    context: focusContext,
    includeTags: ["api"],
    excludeTags: ["slow"],
    focusedTestsBypassIncludeTags: true
  })

  assert.deepEqual(focused.tests.map((entry) => entry.fullName), ["focus bypass eligible"])
})

test("an empty structural suite does not alter names or exact example and line selection", async () => {
  const filePath = "/repo/tests/adapter-root.test.js"
  let line = 40
  const context = createTestContext({declarationLocator: () => ({filePath, line: line++})})
  context.describe("", () => {
    context.describe("named", () => {
      context.it("works", () => {})
    })
  })
  const testLine = context.registry.suites[0].suites[0].tests[0].location.line

  const result = await runTests({
    context,
    examples: [/^named works$/u],
    lineFilters: {[filePath]: [testLine]}
  })

  assert.deepEqual(result.tests.map((entry) => entry.fullName), ["named works"])
})

test("an empty test name retains its separator and exact example behavior", async () => {
  const context = createTestContext()
  context.describe("suite", () => {
    context.it("", () => {})
  })

  const result = await runTests({context, examples: [/^suite $/u]})

  assert.deepEqual(result.tests.map((entry) => entry.fullName), ["suite "])
  assert.deepEqual(result.counts, {total: 1, passed: 1, failed: 0, skipped: 0})
})

test("example filters are repeatable with global and sticky expressions without changing lastIndex", async () => {
  const context = createTestContext()
  context.describe("matching examples", () => {
    context.it("first", () => {})
    context.it("second", () => {})
  })

  for (const expression of [/matching examples/gu, /matching examples/yu]) {
    expression.lastIndex = 3
    const first = await runTests({context, examples: [expression]})
    const second = await runTests({context, examples: [expression]})
    assert.deepEqual(first.tests.map((entry) => entry.fullName), ["matching examples first", "matching examples second"])
    assert.deepEqual(second.tests.map((entry) => entry.fullName), ["matching examples first", "matching examples second"])
    assert.equal(expression.lastIndex, 3)
  }
})

test("no matches fail explicitly and repeated invocations do not leak accounting", async () => {
  const context = createTestContext()
  context.describe("repeat", () => context.it("once", () => {}))
  const runner = new TestRunner({context})

  assert.deepEqual((await runner.run()).counts, {total: 1, passed: 1, failed: 0, skipped: 0})
  assert.deepEqual((await runner.run()).counts, {total: 1, passed: 1, failed: 0, skipped: 0})
  const empty = await runTests({context, examples: [/missing/]})
  assert.equal(empty.noMatches, true)
  assert.equal(empty.status, "failed")

  context.reset()
  assert.equal(context.registry.suites.length, 0)
})
