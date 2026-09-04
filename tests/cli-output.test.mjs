import assert from "node:assert/strict"
import test from "node:test"

import {formatTestResultLine, installJsonStdoutRouting, withJsonConsoleRouting} from "../src/node/cli-output.js"

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

test("JSON console routing redirects stdout methods and restores their exact descriptors", async () => {
  const calls = []
  const target = {
    log: (...args) => calls.push(["original log", ...args]),
    info: (...args) => calls.push(["original info", ...args]),
    debug: (...args) => calls.push(["original debug", ...args]),
    warn: (...args) => calls.push(["warn", ...args]),
    error: (...args) => calls.push(["error", ...args])
  }
  Object.defineProperty(target, "info", {...Object.getOwnPropertyDescriptor(target, "info"), enumerable: false})
  const before = Object.fromEntries(["log", "info", "debug"].map((method) => [method, Object.getOwnPropertyDescriptor(target, method)]))
  const failure = new Error("callback failed")

  await assert.rejects(withJsonConsoleRouting(async () => {
    target.log("log output")
    target.info("info output")
    target.debug("debug output")
    target.warn("warn output")
    throw failure
  }, target), (error) => error === failure)

  assert.deepEqual(calls, [
    ["error", "log output"],
    ["error", "info output"],
    ["error", "debug output"],
    ["warn", "warn output"]
  ])
  for (const method of ["log", "info", "debug"]) {
    assert.deepEqual(Object.getOwnPropertyDescriptor(target, method), before[method])
  }
})

test("JSON stdout routing reserves the original writer and preserves redirected write semantics", () => {
  const stdoutCalls = []
  const stderrCalls = []
  const stdout = {
    write(...args) {
      stdoutCalls.push(args)
      return true
    }
  }
  const stderr = {
    write(...args) {
      stderrCalls.push(args)
      const callback = args.find((argument) => typeof argument === "function")
      callback?.()
      return false
    }
  }
  const descriptor = Object.getOwnPropertyDescriptor(stdout, "write")
  const routing = installJsonStdoutRouting(stdout, stderr)
  let callbacks = 0
  const callback = () => { callbacks += 1 }

  assert.equal(stdout.write("foreign output", "utf8", callback), false)
  assert.equal(callbacks, 1)
  assert.deepEqual(stderrCalls, [["foreign output", "utf8", callback]])
  assert.equal(routing.writeJson("json output"), true)
  assert.deepEqual(stdoutCalls, [["json output"]])

  routing.restore()
  routing.restore()
  assert.deepEqual(Object.getOwnPropertyDescriptor(stdout, "write"), descriptor)
  assert.equal(stdout.write("restored output"), true)
  assert.deepEqual(stdoutCalls, [["json output"], ["restored output"]])
})
