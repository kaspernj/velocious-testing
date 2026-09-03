import assert from "node:assert/strict"
import test from "node:test"

import {createFakeTimers} from "../src/index.js"

const TIMER_PROPERTIES = ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"]

function timerTarget() {
  return {Date, setTimeout, clearTimeout, setInterval, clearInterval}
}

function descriptors(target) {
  return Object.fromEntries(TIMER_PROPERTIES.map((property) => [property, Object.getOwnPropertyDescriptor(target, property)]))
}

test("fake timers advance deterministically and restore exact globals", () => {
  const epoch = Date.UTC(2026, 0, 2, 3, 4, 5)
  const original = descriptors(globalThis)
  const timers = createFakeTimers({now: epoch})
  const calls = []

  timers.install()
  try {
    assert.equal(Date.now(), epoch)
    assert.equal(new Date().toISOString(), "2026-01-02T03:04:05.000Z")
    assert.equal(Date(), new Date(epoch).toString())

    const cancelled = setTimeout(() => calls.push("cancelled"), 5)
    clearInterval(cancelled)
    setTimeout(() => {
      calls.push(`outer:${Date.now() - epoch}`)
      setTimeout(() => calls.push(`nested:${Date.now() - epoch}`), 0)
    }, 10)
    setTimeout((value) => calls.push(`${value}:${Date.now() - epoch}`), 10, "peer")
    const interval = setInterval(() => {
      calls.push(`interval:${Date.now() - epoch}`)
      if (calls.filter((entry) => entry.startsWith("interval")).length === 2) clearTimeout(interval)
    }, 4)

    timers.advanceBy(10)

    assert.deepEqual(calls, ["interval:4", "interval:8", "outer:10", "peer:10", "nested:10"])
    assert.equal(timers.now, epoch + 10)
    assert.equal(timers.timerCount, 0)
  } finally {
    timers.restore()
  }

  assert.deepEqual(descriptors(globalThis), original)
  timers.restore()
})

test("runPending snapshots occurrences and setSystemTime does not change delays", () => {
  const timers = createFakeTimers({now: 1_000})
  const calls = []
  timers.install()
  try {
    const interval = setInterval(() => calls.push(`interval:${Date.now()}`), 5)
    setTimeout(() => {
      calls.push(`outer:${Date.now()}`)
      setTimeout(() => calls.push(`nested:${Date.now()}`), 0)
    }, 10)
    setTimeout(() => calls.push(`later:${Date.now()}`), 20)

    timers.runPending()
    assert.deepEqual(calls, ["interval:1005", "outer:1010", "later:1020"])
    clearInterval(interval)
    assert.equal(timers.timerCount, 1)

    timers.setSystemTime(new Date(5_000))
    timers.runPending()
    assert.deepEqual(calls, ["interval:1005", "outer:1010", "later:1020", "nested:5000"])

    setTimeout(() => calls.push(`delayed:${Date.now()}`), 10)
    timers.advanceBy(9)
    assert.equal(calls.includes("delayed:5009"), false)
    timers.advanceBy(1)
    assert.equal(calls.at(-1), "delayed:5010")
  } finally {
    timers.restore()
  }
})

test("scopes isolate targets, reject overlapping installs, and reset on reinstall", () => {
  const firstTarget = timerTarget()
  const secondTarget = timerTarget()
  const first = createFakeTimers({now: 100})
  const second = createFakeTimers({now: 200})
  const competing = createFakeTimers()
  const calls = []

  first.install(firstTarget)
  second.install(secondTarget)
  try {
    firstTarget.setTimeout(() => calls.push("first"), 5)
    secondTarget.setTimeout(() => calls.push("second"), 5)
    first.advanceBy(5)
    assert.deepEqual(calls, ["first"])
    assert.equal(firstTarget.Date.now(), 105)
    assert.equal(secondTarget.Date.now(), 200)
    assert.throws(() => competing.install(firstTarget), /already has fake timers installed/i)
  } finally {
    first.restore()
    second.restore()
  }

  first.install(firstTarget)
  try {
    assert.equal(first.now, 100)
    assert.equal(first.timerCount, 0)
  } finally {
    first.restore()
  }
})

test("advancement propagates callback failures and bounds recursive execution", () => {
  const target = timerTarget()
  const timers = createFakeTimers()
  timers.install(target)
  try {
    const startedAt = timers.now
    target.setTimeout(() => { throw new Error("callback failed") }, 5)
    target.setTimeout(() => {}, 10)
    assert.throws(() => timers.advanceBy(10), /callback failed/)
    assert.equal(timers.timerCount, 1)
    assert.equal(timers.now, startedAt + 5)

    const interval = target.setInterval(() => {}, 0)
    assert.throws(() => timers.advanceBy(0), /10,000 callbacks/)
    target.clearInterval(interval)
  } finally {
    timers.restore()
  }
})

test("timer controls reject unsupported state and invalid time values", () => {
  const timers = createFakeTimers({now: 0})
  assert.throws(() => timers.advanceBy(1), /not installed/i)
  assert.throws(() => timers.runPending(), /not installed/i)
  assert.throws(() => timers.setSystemTime(1), /not installed/i)
  assert.throws(() => createFakeTimers({now: Number.NaN}), /valid time/i)

  const target = timerTarget()
  timers.install(target)
  try {
    assert.throws(() => target.setTimeout(() => {}, Number.POSITIVE_INFINITY), /finite delay/i)
    assert.throws(() => timers.advanceBy(-1), /non-negative finite/i)
    assert.throws(() => timers.setSystemTime(new Date(Number.NaN)), /valid time/i)
  } finally {
    timers.restore()
  }
})
