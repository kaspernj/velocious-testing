import assert from "node:assert/strict"
import test from "node:test"
import {spawnSync} from "node:child_process"
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises"
import path from "node:path"
import {pathToFileURL} from "node:url"

import {createTestContext} from "../src/index.js"
import {TestRunner} from "../src/runner.js"

test("aggregation preserves the original aggregate stack, cause and terminal contract", async () => {
  const context = createTestContext()
  const primary = new AggregateError([new Error("command failure")], "original aggregate", {cause: new Error("original cause")})
  primary.terminalResource = {scope: "run", name: "shared-session"}
  const calls = []
  context.describe("owner", () => {
    context.afterEach(() => { throw new Error("secondary cleanup") })
    context.it("origin", () => { throw primary })
    context.it("later", () => calls.push("later"))
  })
  const result = await new TestRunner({context}).run()
  assert.deepEqual(calls, [])
  assert.equal(result.counts.notRun, 1)
  assert.equal(result.tests[0].error.cause.stack, primary.stack)
  assert.equal(result.tests[0].error.errors[0].cause.stack, primary.cause.stack)
})

test("terminal resource failure stops retries and later callbacks with honest not-run results", async () => {
  const context = createTestContext()
  const calls = []
  const events = []
  const cause = new Error("command deadline")
  const failure = new Error("resource cannot be reused", {cause})
  failure.terminalResource = {scope: "run", name: "shared-session"}
  const cleanupFailure = new Error("cleanup failed")
  context.describe("owner", () => {
    context.beforeEach(() => calls.push("beforeEach"))
    context.afterEach(() => { calls.push("afterEach"); throw cleanupFailure })
    context.afterAll(() => calls.push("afterAll"))
    context.it("origin", {retries: 2}, () => { calls.push("origin"); throw failure })
    context.it("later", () => calls.push("later"))
    context.it.skip("declared skip", () => calls.push("skip"))
    context.describe("unentered", () => {
      context.beforeAll(() => calls.push("unentered setup"))
      context.afterAll(() => calls.push("unentered cleanup"))
      context.it("child", () => calls.push("child"))
    })
  })
  context.describe("next suite", () => context.it("later", () => calls.push("next suite")))
  const runner = new TestRunner({context, reporter: {onEvent(event) { events.push(event) }}})
  const result = await runner.run()
  await runner.cleanupActiveSuites()

  assert.deepEqual(calls, ["beforeEach", "origin", "afterEach", "afterAll"])
  assert.equal(result.status, "failed")
  assert.deepEqual(result.counts, {total: 4, passed: 0, failed: 1, skipped: 1, notRun: 3})
  assert.equal(result.tests.length, 1)
  assert.equal(result.tests[0].attempts.length, 1)
  assert.equal(result.tests[0].error.errors[0].cause.stack, cause.stack)
  assert.equal(result.tests[0].error.errors[1].stack, cleanupFailure.stack)
  assert.equal(result.terminalFailure.fullName, "owner origin")
  const notRun = result.nonRunTests.filter((record) => record.status === "not-run")
  assert.deepEqual(notRun.map((record) => record.fullName), ["owner later", "owner unentered child", "next suite later"])
  assert.ok(notRun.every((record) => record.reason === result.terminalFailure))
  assert.equal(events.filter((event) => event.type === "test:start").length, 1)
  assert.equal(events.filter((event) => event.type === "test:not-run").length, 3)
  assert.equal(events.at(-1).type, "run:finish")
})

test("ordinary error causes survive serialization without making the resource terminal", async () => {
  const context = createTestContext()
  const cause = new Error("underlying failure")
  const failure = new Error("primary", {cause})
  context.describe("ordinary", () => {
    context.it("fails", () => { throw failure })
    context.it("continues", () => {})
  })
  const result = await new TestRunner({context}).run()
  assert.equal(result.tests[0].error.cause.stack, cause.stack)
  assert.equal(result.tests[1].status, "passed")
  assert.equal(result.terminalFailure, undefined)
})

test("terminal setup failure leaves descendants unexecuted and cleans only entered scopes once", async () => {
  const context = createTestContext()
  const calls = []
  const failure = new Error("setup resource lost")
  failure.terminalResource = {scope: "run", name: "fixture"}
  context.describe("setup", () => {
    context.beforeAll(() => { throw failure })
    context.afterAll(() => calls.push("cleanup"))
    context.it("blocked", () => calls.push("body"))
  })
  const runner = new TestRunner({context})
  const result = await runner.run()
  await runner.cleanupActiveSuites()
  assert.deepEqual(calls, ["cleanup"])
  assert.deepEqual(result.counts, {total: 1, passed: 0, failed: 0, skipped: 0, notRun: 1})
  assert.equal(result.status, "failed")
  assert.equal(result.errors[0].phase, "beforeAll")
  assert.equal(result.errors[0].error.stack, failure.stack)
})


test("terminal CLI runs exit nonzero and print not-run reasons plus complete causes", async () => {
  await mkdir("tmp", {recursive: true})
  const directory = await mkdtemp("tmp/terminal-cli-")
  const source = pathToFileURL(path.resolve("src/index.js")).href
  const fixture = path.join(directory, "terminal.test.mjs")
  try {
    await writeFile(fixture, [
      `import {describe, it, afterAll} from ${JSON.stringify(source)}`,
      'describe("terminal", () => {',
      '  afterAll(() => console.log("CLEANED ONCE"))',
      '  it("origin", () => {',
      '    const failure = new Error("resource unavailable", {cause: new Error("original command stack")})',
      '    failure.terminalResource = {scope: "run", name: "fixture"}',
      '    throw failure',
      '  })',
      '  it("later", () => console.log("LATER CALLBACK RAN"))',
      '})'
    ].join("\n"))
    const result = spawnSync(process.execPath, ["src/node/cli.js", fixture], {encoding: "utf8"})
    assert.equal(result.status, 1)
    assert.doesNotMatch(result.stdout + result.stderr, /LATER CALLBACK RAN/u)
    assert.match(result.stdout, /1 not run/u)
    assert.match(result.stdout, /terminal later.*not run.*terminal origin/u)
    assert.match(result.stderr, /original command stack/u)
    assert.match(result.stderr, /terminal\.test\.mjs\?velociousTestingRun=1:5/u)
    assert.equal(result.stdout.match(/CLEANED ONCE/gu).length, 1)
  } finally {
    await rm(directory, {recursive: true})
  }
})


test("terminal cleanup failures stop later suites and preserve cycle-safe causal records", async () => {
  const context = createTestContext()
  const failure = new Error("cleanup resource lost")
  failure.terminalResource = {scope: "run", name: "fixture"}
  failure.cause = failure
  let later = false
  context.describe("entered", () => {
    context.it("passes", () => {})
    context.afterAll(() => { throw failure })
  })
  context.describe("unentered", () => context.it("later", () => { later = true }))
  const result = await new TestRunner({context}).run()
  assert.equal(later, false)
  assert.equal(result.status, "failed")
  assert.deepEqual(result.counts, {total: 2, passed: 1, failed: 0, skipped: 0, notRun: 1})
  assert.equal(result.errors[0].error.cause.message, "[Circular error reference]")
  assert.equal(result.nonRunTests[0].reason.fullName, "entered")
})
