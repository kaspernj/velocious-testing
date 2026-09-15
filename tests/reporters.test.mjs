import assert from "node:assert/strict"
import {describe, it} from "node:test"

import {
  composeReporters,
  createConsoleReporter,
  createJsonReporter,
  formatTestError,
  formatTestResultLine,
  slowestTestResults
} from "../src/reporters.js"

function runResult(overrides = {}) {
  return {
    protocolMajor: 1,
    status: "passed",
    noMatches: false,
    counts: {total: 1, passed: 1, failed: 0, skipped: 0},
    tests: [],
    nonRunTests: [],
    errors: [],
    ...overrides
  }
}

describe("browser-safe reporters", () => {
it("JSON reporter ignores intermediate events and writes each finished result exactly once", async () => {
  const writes = []
  const reporter = createJsonReporter({write: (chunk) => writes.push(chunk)})
  const first = runResult()
  const second = runResult({status: "failed", noMatches: true})

  await reporter.onEvent({protocolMajor: 1, timestamp: 1, type: "run:start", total: 1})
  await reporter.onEvent({protocolMajor: 1, timestamp: 2, type: "test:finish", test: {}})
  await reporter.onEvent({protocolMajor: 1, timestamp: 3, type: "run:finish", result: first})
  await reporter.onEvent({protocolMajor: 1, timestamp: 4, type: "run:finish", result: second})

  assert.deepEqual(writes, [
    `${JSON.stringify(first)}\n`,
    `${JSON.stringify(second)}\n`
  ])
})

it("JSON reporter awaits its writer", async () => {
  let release
  const blocked = new Promise((resolve) => { release = resolve })
  let finished = false
  const reporter = createJsonReporter({write: async () => {
    await blocked
    finished = true
  }})

  const reporting = reporter.onEvent({protocolMajor: 1, timestamp: 1, type: "run:finish", result: runResult()})
  await Promise.resolve()
  assert.equal(finished, false)
  release()
  await reporting
  assert.equal(finished, true)
})

it("JSON reporter propagates writer failures", async () => {
  const failure = new Error("writer failed")
  const reporter = createJsonReporter({write: async () => { throw failure }})

  await assert.rejects(
    reporter.onEvent({protocolMajor: 1, timestamp: 1, type: "run:finish", result: runResult()}),
    (error) => error === failure
  )
})

it("JSON reporter propagates serialization failures without calling the writer", async () => {
  let writes = 0
  const reporter = createJsonReporter({write: () => { writes += 1 }})
  const circular = runResult()
  circular.self = circular

  await assert.rejects(
    reporter.onEvent({protocolMajor: 1, timestamp: 1, type: "run:finish", result: circular}),
    /circular/iu
  )
  assert.equal(writes, 0)
})

it("formats result durations and complete causal errors", () => {
  const passed = {
    fullName: "suite passes",
    status: "passed",
    attempts: [
      {attemptNumber: 1, durationMs: 750, consoleOutput: ""},
      {attemptNumber: 2, durationMs: 500, consoleOutput: ""}
    ],
    location: {}
  }
  const blocked = {
    fullName: "suite blocked",
    status: "failed",
    attempts: [],
    location: {}
  }
  const error = {
    name: "AggregateError",
    message: "primary",
    stack: "AggregateError: primary\n    at primary.js:1:1",
    cause: {name: "Error", message: "cause"},
    errors: [{name: "Error", message: "cleanup"}]
  }

  assert.equal(formatTestResultLine(passed), "✓ suite passes (1.250s)")
  assert.equal(formatTestResultLine(blocked), "✗ suite blocked (not run)")
  assert.equal(formatTestError(error), [
    "AggregateError: primary\n    at primary.js:1:1",
    "Caused by: Error: cause",
    "Related failure: Error: cleanup"
  ].join("\n"))
})

it("composes reporters in order and awaits each event delivery", async () => {
  const order = []
  const reporter = composeReporters([
    {onEvent: async () => { order.push("first:start"); await Promise.resolve(); order.push("first:end") }},
    {onEvent: () => { order.push("second") }}
  ])

  await reporter.onEvent({protocolMajor: 1, timestamp: 1, type: "run:start"})
  assert.deepEqual(order, ["first:start", "first:end", "second"])
})

it("writes generic test failures, bounded console output, suite errors, and summaries", async () => {
  const output = []
  const errors = []
  const reporter = createConsoleReporter({
    write: (chunk) => output.push(chunk),
    writeError: (chunk) => errors.push(chunk),
    failedConsoleOutputMaxLines: 2,
    colorize: false
  })
  const failedTest = {
    fullName: "suite fails",
    status: "failed",
    attempts: [{
      attemptNumber: 1,
      durationMs: 12,
      consoleOutput: "first\nsecond\nthird\n",
      error: {name: "Error", message: "failure", stack: "Error: failure\n    at test.js:1:1"}
    }],
    location: {},
    error: {name: "Error", message: "failure", stack: "Error: failure\n    at test.js:1:1"}
  }
  const result = runResult({
    status: "failed",
    counts: {total: 1, passed: 0, failed: 1, skipped: 0},
    tests: [failedTest],
    errors: [{phase: "afterAll", suite: "suite", error: {name: "Error", message: "cleanup"}}]
  })

  await reporter.onEvent({protocolMajor: 1, timestamp: 1, type: "test:finish", test: failedTest})
  await reporter.onEvent({protocolMajor: 1, timestamp: 2, type: "run:finish", result})

  assert.deepEqual(output, ["✗ suite fails (12ms)\n", "\n0 passed, 1 failed, 1 total\n"])
  assert.deepEqual(errors, [
    "Error: failure\n    at test.js:1:1\n",
    "second\nthird\n",
    "afterAll suite: Error: cleanup\n"
  ])
})

it("projects slowest executed tests without mutating the run result", () => {
  const result = runResult({tests: [
    {fullName: "fast", status: "passed", attempts: [{attemptNumber: 1, durationMs: 2, consoleOutput: ""}], location: {filePath: "a.js", line: 1}},
    {fullName: "retried", status: "passed", attempts: [{attemptNumber: 1, durationMs: 7, consoleOutput: ""}, {attemptNumber: 2, durationMs: 5, consoleOutput: ""}], location: {filePath: "b.js", line: 2}},
    {fullName: "blocked", status: "failed", attempts: [], location: {filePath: "c.js", line: 3}}
  ]})

  assert.deepEqual(slowestTestResults(result, {limit: 1}), [{
    fullName: "retried",
    durationMs: 12,
    filePath: "b.js",
    line: 2
  }])
  assert.deepEqual(result.tests.map(({fullName}) => fullName), ["fast", "retried", "blocked"])
})
})
