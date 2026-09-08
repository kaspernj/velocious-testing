import assert from "node:assert/strict"
import test from "node:test"

import {createTestContext} from "../src/index.js"
import {TestRunner} from "../src/runner.js"

for (const asynchronous of [false, true]) {
  test(`a terminal argument resolver ${asynchronous ? "rejection" : "throw"} completes run accounting without entering an attempt`, async () => {
    const context = createTestContext()
    const calls = []
    const events = []
    const primary = Object.assign(new Error("argument resource lost", {cause: new Error("resolver cause")}), {
      terminalResource: {scope: "run", name: "fixture"}
    })
    const originalStack = primary.stack
    const originalCause = primary.cause
    context.describe("resolver", () => {
      context.beforeAll(() => calls.push("beforeAll"))
      context.beforeEach(() => calls.push("beforeEach"))
      context.afterEach(() => calls.push("afterEach"))
      context.afterAll(() => calls.push("afterAll"))
      context.it("origin", {retries: 2}, () => calls.push("origin"))
      context.it("later", () => calls.push("later"))
      context.describe("unentered", () => {
        context.beforeAll(() => calls.push("child beforeAll"))
        context.afterAll(() => calls.push("child afterAll"))
        context.it("child", () => calls.push("child"))
      })
    })
    const runner = new TestRunner({
      context,
      reporter: {onEvent: (event) => events.push(event)},
      testArgumentResolver: () => {
        calls.push("resolve")
        if (asynchronous) return Promise.reject(primary)
        throw primary
      },
      attemptExecutor: async ({defaultExecute}) => { calls.push("execute"); await defaultExecute() }
    })
    const result = await runner.run()
    await runner.cleanupActiveSuites()
    assert.deepEqual(calls, ["beforeAll", "resolve", "afterAll"])
    assert.equal(result.status, "failed")
    assert.deepEqual(result.counts, {total: 3, passed: 0, failed: 1, skipped: 0, notRun: 2})
    assert.equal(result.tests[0].attempts.length, 1)
    assert.equal(result.tests[0].error.stack, originalStack)
    assert.equal(result.tests[0].error.cause.stack, originalCause.stack)
    assert.equal(primary.stack, originalStack)
    assert.equal(primary.cause, originalCause)
    assert.equal(result.terminalFailure.error, result.tests[0].error)
    assert.ok(result.nonRunTests.every((record) => record.reason === result.terminalFailure))
    assert.deepEqual(events.map((event) => event.type), [
      "run:start", "test:start", "attempt:finish", "test:finish", "test:not-run", "test:not-run", "run:finish"
    ])
    assert.equal(events[2].terminalFailure, result.terminalFailure)
    assert.equal(events[3].test, result.tests[0])
    assert.equal(events.at(-1).result, result)
  })

  test(`an ordinary argument resolver ${asynchronous ? "rejection" : "throw"} retains its existing rejection and cleanup behavior`, async () => {
    const context = createTestContext()
    const primary = new Error("ordinary resolver failure", {cause: new Error("ordinary cause")})
    const calls = []
    context.describe("ordinary resolver", () => {
      context.afterAll(() => calls.push("cleanup"))
      context.it("origin", {retries: 2}, () => calls.push("body"))
      context.it("later", () => calls.push("later"))
    })
    const runner = new TestRunner({context, testArgumentResolver: () => {
      calls.push("resolve")
      if (asynchronous) return Promise.reject(primary)
      throw primary
    }})
    await assert.rejects(runner.run(), (error) => error === primary)
    await runner.cleanupActiveSuites()
    assert.deepEqual(calls, ["resolve", "cleanup"])
  })
}
