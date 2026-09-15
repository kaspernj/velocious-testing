import assert from "node:assert/strict"
import test from "node:test"

import {createJsonReporter} from "../src/reporters.js"

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

test("JSON reporter ignores intermediate events and writes each finished result exactly once", async () => {
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

test("JSON reporter awaits its writer", async () => {
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

test("JSON reporter propagates writer failures", async () => {
  const failure = new Error("writer failed")
  const reporter = createJsonReporter({write: async () => { throw failure }})

  await assert.rejects(
    reporter.onEvent({protocolMajor: 1, timestamp: 1, type: "run:finish", result: runResult()}),
    (error) => error === failure
  )
})

test("JSON reporter propagates serialization failures without calling the writer", async () => {
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
