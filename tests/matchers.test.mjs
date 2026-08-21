import assert from "node:assert/strict"
import {EventEmitter} from "node:events"
import test from "node:test"

import {arrayContaining, expect, objectContaining, waitForEvent} from "../src/index.js"

test("equality and representative failure messages are Velocious-compatible", () => {
  expect({id: 1, nested: ["a"]}).toEqual({id: 1, nested: ["a"]})
  expect(1).not.toEqual(2)

  assert.throws(() => expect(1).toEqual(2), {message: "1 wasn't equal to 2"})
  assert.throws(() => expect([1, 2]).not.toEqual([1, 2]), {message: "[1,2] was unexpected equal to [1,2]"})
  assert.throws(() => expect("hello").toContain("x"), {message: "\"hello\" doesn't contain \"x\""})
})

test("containing matchers compose and preserve duplicate requirements", () => {
  expect({name: "Ada", flags: ["a", "b"]}).toEqual(objectContaining({flags: arrayContaining(["b"])}))
  expect([{id: 1}, {id: 2}]).toEqual(arrayContaining([objectContaining({id: 2})]))

  assert.throws(() => expect([1]).toEqual(arrayContaining([1, 1])), {
    message: "Expected [1] to match [1,1] (diff: {\"$\":[[1,1],[1]]})"
  })
  assert.throws(() => expect({id: 2}).toEqual(objectContaining({id: 1})), {
    message: "Expected {\"id\":2} to match {\"id\":1} (diff: {\"id\":[1,2]})"
  })
  assert.throws(
    () => expect({id: 1}).not.toEqual(objectContaining({id: 1})),
    {message: "Expected {\"id\":1} not to match {\"id\":1}"}
  )
})

test("documented matcher surface handles values, promises, and change expectations", async () => {
  expect(2).toBeGreaterThan(1)
  expect(2).toBeGreaterThanOrEqual(2)
  expect(1).toBeLessThan(2)
  expect(1).toBeLessThanOrEqual(1)
  expect(0.1 + 0.2).toBeCloseTo(0.3)
  expect([1, 2]).toHaveLength(2)
  expect("value").toBeDefined()
  expect(new Error()).toBeInstanceOf(Error)
  expect(false).toBeFalse()
  expect(null).toBeNull()
  expect(undefined).toBeUndefined()
  expect(true).toBeTrue()
  expect(1).toBeTruthy()
  expect([1, {id: 2}]).toContainEqual({id: 2})
  expect("hello").toInclude("ell")
  expect("hello").toMatch(/^he/)
  expect({id: 1, name: "Ada"}).toMatchObject({id: 1})
  await expect(() => { throw new TypeError("bad") }).toThrow(TypeError)
  await expect(async () => { throw new Error("bad") }).toThrowError("bad")

  let count = 0
  await expect(async () => { count += 2 }).toChange(() => count).by(2).execute()

  let first = 0
  let second = 0
  await expect(() => { first += 1; second += 2 })
    .toChange(() => first).by(1)
    .andChange(() => second).by(2)
    .execute()
})

test("toThrow recognizes every falsy synchronous throw and asynchronous rejection", async () => {
  const falsyValues = [undefined, null, false, 0, ""]
  for (const thrownValue of falsyValues) {
    const synchronous = () => { throw thrownValue }
    const asynchronous = async () => await Promise.reject(thrownValue)

    await expect(synchronous).toThrow()
    await expect(asynchronous).toThrow()
    await expect(synchronous).toThrow(new RegExp(`^${String(thrownValue)}$`, "u"))
    await expect(asynchronous).toThrow(new RegExp(`^${String(thrownValue)}$`, "u"))
    await assert.rejects(expect(synchronous).not.toThrow(), /was unexpected to throw/)
    await assert.rejects(expect(asynchronous).not.toThrow(), /was unexpected to throw/)
    await expect(synchronous).not.toThrow(/^different$/u)
    await expect(asynchronous).not.toThrow(/^different$/u)
  }
})

test("toHaveAttributes uses ordinary positive and negated assertion behavior", () => {
  const record = {id: () => 7, name: () => "Ada"}

  expect(record).toHaveAttributes({id: 7, name: "Ada"})
  expect(record).not.toHaveAttributes({id: 8})
  assert.throws(() => expect(record).toHaveAttributes({id: 8}), /Object had different values/)
  assert.throws(() => expect(record).not.toHaveAttributes({id: 7}), /Object had unexpected values/)
})

test("toMatch is deterministic for global and sticky expressions without changing lastIndex", () => {
  for (const expression of [/hello/gu, /hello/yu]) {
    expression.lastIndex = 2
    expect("hello world").toMatch(expression)
    expect("hello world").toMatch(expression)
    assert.equal(expression.lastIndex, 2)
  }
})

test("waitForEvent filters, unwraps arguments, cleans listeners, and times out", async () => {
  const emitter = new EventEmitter()
  const waiting = waitForEvent(emitter, "ready", {filter: (value) => value === "yes", timeoutMs: 100})
  emitter.emit("ready", "no")
  emitter.emit("ready", "yes")

  assert.equal(await waiting, "yes")
  assert.equal(emitter.listenerCount("ready"), 0)
  await assert.rejects(waitForEvent(emitter, "never", {timeoutMs: 5}), /Timed out after 5ms waiting for event "never"/)
  assert.equal(emitter.listenerCount("never"), 0)
})
