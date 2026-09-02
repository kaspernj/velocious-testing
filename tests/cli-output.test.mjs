import assert from "node:assert/strict"
import test from "node:test"

import {formatTestResultLine} from "../src/node/cli-output.js"

/** @param {string} fullName @param {"passed" | "failed"} status @param {number[]} durations */
function testResult(fullName, status, durations) {
  return {
    fullName,
    status,
    attempts: durations.map((durationMs, index) => ({
      attemptNumber: index + 1,
      durationMs,
      consoleOutput: ""
    })),
    location: {}
  }
}

test("formats passed and failed test result lines with compact durations", () => {
  assert.equal(formatTestResultLine(testResult("calculator adds", "passed", [42])), "✓ calculator adds (42ms)")
  assert.equal(formatTestResultLine(testResult("calculator waits", "failed", [1234])), "✗ calculator waits (1.234s)")
})

test("formats the millisecond-to-second boundary exactly", () => {
  assert.equal(formatTestResultLine(testResult("boundary below", "passed", [999])), "✓ boundary below (999ms)")
  assert.equal(formatTestResultLine(testResult("boundary at", "passed", [1000])), "✓ boundary at (1.000s)")
})

test("sums every retry attempt duration", () => {
  assert.equal(formatTestResultLine(testResult("calculator retries", "passed", [900, 350])), "✓ calculator retries (1.250s)")
})

test("reports setup-blocked tests without attempts as not run", () => {
  assert.equal(formatTestResultLine(testResult("calculator setup-dependent test", "failed", [])), "✗ calculator setup-dependent test (not run)")
})
