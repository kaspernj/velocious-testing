import assert from "node:assert/strict"
import test from "node:test"

import {withTestCleanup} from "../src/index.js"

test("withTestCleanup runs registered cleanups in FIFO order", async () => {
  const calls = []

  await withTestCleanup(async (after) => {
    calls.push("test")
    after(async () => {
      await Promise.resolve()
      calls.push("first cleanup")
    })
    after(() => calls.push("second cleanup"))
  })

  assert.deepEqual(calls, ["test", "first cleanup", "second cleanup"])
})

test("withTestCleanup runs every cleanup and aggregates failures in execution order", async () => {
  const primaryFailure = new Error("primary failure")
  const firstCleanupFailure = new TypeError("first cleanup failure")
  const secondCleanupFailure = "second cleanup failure"
  const calls = []

  await assert.rejects(withTestCleanup((after) => {
    after(() => {
      calls.push("first cleanup")
      throw firstCleanupFailure
    })
    after(async () => {
      calls.push("second cleanup")
      throw secondCleanupFailure
    })
    after(() => calls.push("third cleanup"))

    throw primaryFailure
  }), (error) => {
    assert.ok(error instanceof AggregateError)
    assert.deepEqual(error.errors, [primaryFailure, firstCleanupFailure, secondCleanupFailure])

    return true
  })

  assert.deepEqual(calls, ["first cleanup", "second cleanup", "third cleanup"])
})

test("withTestCleanup preserves a sole arbitrary thrown value", async () => {
  const primaryFailure = {kind: "primary"}
  const cleanupFailure = "cleanup failure"

  await assert.rejects(withTestCleanup(() => {
    throw primaryFailure
  }), (error) => error === primaryFailure)

  await assert.rejects(withTestCleanup((after) => {
    after(() => {
      throw cleanupFailure
    })
  }), (error) => error === cleanupFailure)
})
