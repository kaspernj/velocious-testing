import assert from "node:assert/strict"
import {EventEmitter} from "node:events"
import test from "node:test"

import {
  any as anyValue,
  anything,
  arrayContaining,
  createMockScope,
  expect,
  objectContaining,
  stringContaining,
  stringMatching,
  waitForEvent
} from "../src/index.js"

test("equality and representative failure messages are Velocious-compatible", () => {
  expect({id: 1, nested: ["a"]}).toEqual({id: 1, nested: ["a"]})
  expect(1).not.toEqual(2)

  assert.throws(() => expect(1).toEqual(2), {
    message: "1 wasn't equal to 2\nDiff:\n  $: expected 2, received 1"
  })
  assert.throws(() => expect([1, 2]).not.toEqual([1, 2]), {message: "[1,2] was unexpected equal to [1,2]"})
  assert.throws(() => expect("hello").toContain("x"), {message: "\"hello\" doesn't contain \"x\""})
})

test("containing matchers compose and preserve duplicate requirements", () => {
  expect({name: "Ada", flags: ["a", "b"]}).toEqual(objectContaining({flags: arrayContaining(["b"])}))
  expect([{id: 1}, {id: 2}]).toEqual(arrayContaining([objectContaining({id: 2})]))

  assert.throws(() => expect([1]).toEqual(arrayContaining([1, 1])), {
    message: "Expected [1] to match [1,1]\nDiff:\n  $: expected arrayContaining([1, 1]), received [1]"
  })
  assert.throws(() => expect({id: 2}).toEqual(objectContaining({id: 1})), {
    message: "Expected {\"id\":2} to match {\"id\":1}\nDiff:\n  $.id: expected 1, received 2"
  })
  assert.throws(
    () => expect({id: 1}).not.toEqual(objectContaining({id: 1})),
    {message: "Expected {\"id\":1} not to match {\"id\":1}"}
  )
})

test("asymmetric matchers compose through equality, containment, sets, and mock calls", () => {
  const scope = createMockScope()
  const implementation = scope.fn()

  expect({
    id: 7,
    optional: false,
    profile: {name: "Ada Lovelace", roles: ["admin", "author"]},
    values: new Set([1, "two"])
  }).toEqual({
    id: anyValue(Number),
    optional: anything(),
    profile: objectContaining({
      name: stringContaining("Lovelace"),
      roles: arrayContaining([stringMatching(/^adm/u)])
    }),
    values: new Set([anyValue(String), anyValue(Number)])
  })
  expect([null, undefined]).not.toContainEqual(anything())

  implementation({name: "Grace Hopper", enabled: true})
  expect(implementation).toHaveBeenCalledWith(objectContaining({
    name: stringMatching("Hopper$"),
    enabled: anyValue(Boolean)
  }))
})

test("asymmetric matcher factories validate inputs and preserve regular expression state", () => {
  const expression = /lovelace/giu
  expression.lastIndex = 3

  expect("Ada Lovelace").toEqual(stringMatching(expression))
  expect("Ada Lovelace").toEqual(stringMatching(expression))
  assert.equal(expression.lastIndex, 3)
  assert.throws(() => anyValue(null), {message: "any() requires a constructor function"})
  assert.throws(() => stringContaining(1), {message: "stringContaining() requires a string"})
  assert.throws(() => stringMatching({}), {message: "stringMatching() requires a string or RegExp"})
})

test("positive equality and partial-object failures include stable structural diffs", () => {
  const actual = {z: 3, a: {value: 2, extra: true}}
  const expected = {missing: undefined, a: {value: 1}}

  assert.throws(() => expect(actual).toEqual(expected), {
    message: [
      '{"z":3,"a":{"value":2,"extra":true}} wasn\'t equal to {"a":{"value":1}}',
      "Diff:",
      "  $.a.extra: expected <missing>, received true",
      "  $.a.value: expected 1, received 2",
      "  $.missing: expected undefined, received <missing>",
      "  $.z: expected <missing>, received 3"
    ].join("\n")
  })
  assert.throws(() => expect(actual).toMatchObject({a: {value: 1}}), {
    message: [
      'Expected {"z":3,"a":{"value":2,"extra":true}} to match {"a":{"value":1}}',
      "Diff:",
      "  $.a.value: expected 1, received 2"
    ].join("\n")
  })
})

test("structural diffs are cycle-safe, bounded, and select the closest mock call", () => {
  const actual = {name: "actual"}
  const expected = {name: "expected"}
  actual.self = actual
  expected.self = expected
  assert.throws(() => expect(actual).toEqual(expected), (error) => {
    assert.match(error.message, /\$\.name: expected "expected", received "actual"/u)
    assert.doesNotMatch(error.message, /Maximum call stack/u)
    return true
  })

  const scope = createMockScope()
  const implementation = scope.fn()
  implementation({id: 1, profile: {name: "far", active: false}})
  implementation({id: 2, profile: {name: "near", active: true}})
  assert.throws(() => expect(implementation).toHaveBeenCalledWith({
    id: 2,
    profile: {name: "wanted", active: true}
  }), {
    message: [
      'Expected mock to have been called with [{"id":2,"profile":{"name":"wanted","active":true}}], but actual calls were [[{"id":1,"profile":{"name":"far","active":false}}],[{"id":2,"profile":{"name":"near","active":true}}]]',
      "Closest call 2:",
      "Diff:",
      '  $[0].profile.name: expected "wanted", received "near"'
    ].join("\n")
  })

  const wideActual = Object.fromEntries(Array.from({length: 25}, (_, index) => [`key${index}`, index]))
  const wideExpected = Object.fromEntries(Array.from({length: 25}, (_, index) => [`key${index}`, index + 1]))
  assert.throws(() => expect(wideActual).toEqual(wideExpected), (error) => {
    assert.match(error.message, /\.\.\. 5 more differences$/u)
    assert.equal(error.message.split("\n").filter((line) => line.startsWith("  $.")).length, 20)
    return true
  })
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

test("promise chains apply matchers to the required settlement with negation", async () => {
  const resolvesAssertion = expect(Promise.resolve({id: 1})).resolves.toEqual(objectContaining({id: 1}))
  assert.equal(resolvesAssertion instanceof Promise, true)
  await resolvesAssertion
  await expect(Promise.resolve("ready")).resolves.not.toEqual("waiting")
  await expect(Promise.reject({code: "NOPE"})).rejects.toMatchObject({code: "NOPE"})
  await expect(Promise.reject("failure")).rejects.not.toEqual("other failure")
})

test("promise chains report wrong settlement and non-promise values deterministically", async () => {
  await assert.rejects(expect(Promise.reject(false)).resolves.toBe(false), {
    message: "Expected promise to resolve, but it rejected with false"
  })
  await assert.rejects(expect(Promise.resolve(undefined)).rejects.toBeUndefined(), {
    message: "Expected promise to reject, but it resolved with undefined"
  })
  assert.throws(() => expect(1).resolves, {
    name: "TypeError",
    message: "Promise assertions require a promise-like received value"
  })
  assert.throws(() => expect({then: true}).rejects, {
    name: "TypeError",
    message: "Promise assertions require a promise-like received value"
  })
})

test("rejects preserves falsy reasons and supports throw matching", async () => {
  for (const reason of [undefined, null, false, 0, ""]) {
    await expect(Promise.reject(reason)).rejects.toEqual(reason)
  }
  await expect(Promise.reject(new TypeError("bad input"))).rejects.toThrow(TypeError)
  await expect(Promise.reject("plain failure")).rejects.toThrow(/^plain failure$/u)
  await expect(Promise.reject(0)).rejects.not.toThrow(/^different$/u)
})

test("custom matchers receive a frozen browser-safe context and support negation", () => {
  const contexts = []
  expect.extend({
    toHavePublicId(received, expectedId) {
      contexts.push(this)
      return {
        pass: this.equals(received, objectContaining({id: expectedId})),
        message: () => this.isNot ?
          `Expected ${this.format(received)} not to have public id ${this.format(expectedId)}` :
          `Expected ${this.format(received)} to have public id ${this.format(expectedId)}\n${this.diff(received, {id: expectedId})}`
      }
    }
  })

  expect({id: 7, name: "Ada"}).toHavePublicId(7)
  expect({id: 7}).not.toHavePublicId(8)
  assert.throws(() => expect({id: 7}).toHavePublicId(8), {
    message: [
      'Expected {"id": 7} to have public id 8',
      "Diff:",
      "  $.id: expected 8, received 7"
    ].join("\n")
  })
  assert.throws(() => expect({id: 7}).not.toHavePublicId(7), {
    message: 'Expected {"id": 7} not to have public id 7'
  })
  assert.equal(contexts.every((context) => Object.isFrozen(context)), true)
  assert.deepEqual(Object.keys(contexts[0]).sort(), ["diff", "equals", "format", "isNot"])
})

test("custom matchers support asynchronous results and promise chains", async () => {
  expect.extend({
    async toBeEvenEventually(received) {
      await Promise.resolve()
      return {pass: received % 2 === 0, message: `Expected ${received} ${this.isNot ? "not " : ""}to be even`}
    }
  })

  await expect(4).toBeEvenEventually()
  await expect(3).not.toBeEvenEventually()
  await expect(Promise.resolve(4)).resolves.toBeEvenEventually()
  await expect(Promise.reject(3)).rejects.not.toBeEvenEventually()
  await assert.rejects(expect(Promise.resolve(3)).resolves.toBeEvenEventually(), {
    message: "Expected 3 to be even"
  })
})

test("expect.extend validates definitions and results atomically with stable errors", async () => {
  assert.throws(() => expect.extend(null), {
    name: "TypeError",
    message: "expect.extend() requires a plain object of matcher functions"
  })
  assert.throws(() => expect.extend([]), {
    name: "TypeError",
    message: "expect.extend() requires a plain object of matcher functions"
  })
  assert.throws(() => expect.extend({toEqual() {}}), {
    message: 'Custom matcher "toEqual" conflicts with an existing matcher'
  })

  let getterInvoked = false
  const accessorDefinitions = {}
  Object.defineProperty(accessorDefinitions, "toReadAccessorDefinition", {
    enumerable: true,
    get() { getterInvoked = true; return () => ({pass: true, message: "unused"}) }
  })
  assert.throws(() => expect.extend(accessorDefinitions), {
    message: 'Custom matcher "toReadAccessorDefinition" must be an own data-property function'
  })
  assert.equal(getterInvoked, false)

  const symbolDefinitions = {[Symbol("matcher")]: () => ({pass: true, message: "unused"})}
  assert.throws(() => expect.extend(symbolDefinitions), {message: "Custom matcher names must be strings"})

  assert.throws(() => expect.extend({
    toRemainUnregistered() { return {pass: true, message: "unused"} },
    toInvalidDefinition: true
  }), {message: 'Custom matcher "toInvalidDefinition" must be an own data-property function'})
  assert.equal(typeof expect(1).toRemainUnregistered, "undefined")

  expect.extend({toRejectDuplicate() { return {pass: true, message: "unused"} }})
  assert.throws(() => expect.extend({toRejectDuplicate() { return {pass: true, message: "unused"} }}), {
    message: 'Custom matcher "toRejectDuplicate" is already registered'
  })

  expect.extend({
    toReturnNothing() {},
    toReturnInvalidPass() { return {pass: "yes", message: "unused"} },
    toReturnInvalidMessage() { return {pass: false, message: 1} },
    toReturnInvalidLazyMessage() { return {pass: false, message: () => 1} }
  })
  assert.throws(() => expect(1).toReturnNothing(), {
    message: 'Custom matcher "toReturnNothing" must return an object'
  })
  assert.throws(() => expect(1).toReturnInvalidPass(), {
    message: 'Custom matcher "toReturnInvalidPass" result.pass must be a boolean'
  })
  assert.throws(() => expect(1).toReturnInvalidMessage(), {
    message: 'Custom matcher "toReturnInvalidMessage" result.message must be a string or function'
  })
  assert.throws(() => expect(1).toReturnInvalidLazyMessage(), {
    message: 'Custom matcher "toReturnInvalidLazyMessage" message() must return a string'
  })

  const synchronousError = new Error("synchronous custom failure")
  const asynchronousError = new Error("asynchronous custom failure")
  expect.extend({
    toPropagateSynchronousError() { throw synchronousError },
    async toPropagateAsynchronousError() { throw asynchronousError }
  })
  assert.throws(() => expect(1).toPropagateSynchronousError(), (error) => error === synchronousError)
  await assert.rejects(expect(1).toPropagateAsynchronousError(), (error) => error === asynchronousError)
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

test("call matchers inspect counts and arguments with existing deep and containing equality", () => {
  const scope = createMockScope()
  const implementation = scope.fn()

  expect(implementation).not.toHaveBeenCalled()
  expect(implementation).toHaveBeenCalledTimes(0)
  implementation({id: 1, name: "Ada"}, ["first", "second"])
  implementation({id: 2}, ["last"])

  expect(implementation).toHaveBeenCalled()
  expect(implementation).not.toHaveBeenCalledTimes(1)
  expect(implementation).toHaveBeenCalledTimes(2)
  expect(implementation).toHaveBeenCalledWith(
    objectContaining({id: 1}),
    arrayContaining(["second"])
  )
  expect(implementation).not.toHaveBeenCalledWith({id: 3})
  expect(implementation).toHaveBeenLastCalledWith({id: 2}, ["last"])
  expect(implementation).not.toHaveBeenLastCalledWith({id: 1}, ["first", "second"])
  expect(implementation).toHaveBeenNthCalledWith(1, {id: 1, name: "Ada"}, ["first", "second"])
  expect(implementation).not.toHaveBeenNthCalledWith(2, {id: 1})
})

test("call matchers provide useful positive and negated diagnostics", () => {
  const scope = createMockScope()
  const implementation = scope.fn()

  assert.throws(() => expect(implementation).toHaveBeenCalled(), {
    message: "Expected mock to have been called, but it was called 0 times"
  })
  implementation("actual", {id: 1})
  assert.throws(() => expect(implementation).not.toHaveBeenCalled(), {
    message: "Expected mock not to have been called, but actual calls were [[\"actual\",{\"id\":1}]]"
  })
  assert.throws(() => expect(implementation).toHaveBeenCalledTimes(2), {
    message: "Expected mock to have been called 2 times, but it was called 1 time"
  })
  assert.throws(() => expect(implementation).toHaveBeenCalledWith("wanted"), {
    message: [
      'Expected mock to have been called with ["wanted"], but actual calls were [["actual",{"id":1}]]',
      "Closest call 1:",
      "Diff:",
      "  $.length: expected 1, received 2",
      '  $[0]: expected "wanted", received "actual"',
      '  $[1]: expected <missing>, received {"id": 1}'
    ].join("\n")
  })
  assert.throws(() => expect(implementation).toHaveBeenLastCalledWith("wanted"), {
    message: [
      'Expected last mock call to equal ["wanted"], but it was ["actual",{"id":1}]',
      "Diff:",
      "  $.length: expected 1, received 2",
      '  $[0]: expected "wanted", received "actual"',
      '  $[1]: expected <missing>, received {"id": 1}'
    ].join("\n")
  })
  assert.throws(() => expect(implementation).toHaveBeenNthCalledWith(2, "wanted"), {
    message: "Expected mock call 2 to equal [\"wanted\"], but only 1 call was recorded"
  })
})

test("call matchers validate the received mock, call count, and one-based call index", () => {
  const implementation = createMockScope().fn()

  for (const assertion of [
    () => expect(() => {}).toHaveBeenCalled(),
    () => expect(() => {}).toHaveBeenCalledTimes(1),
    () => expect(() => {}).toHaveBeenCalledWith(),
    () => expect(() => {}).toHaveBeenLastCalledWith(),
    () => expect(() => {}).toHaveBeenNthCalledWith(1)
  ]) assert.throws(assertion, /Expected a mock function/)

  for (const count of [-1, 1.5, Number.NaN]) {
    assert.throws(() => expect(implementation).toHaveBeenCalledTimes(count), /non-negative integer/)
  }
  for (const index of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => expect(implementation).toHaveBeenNthCalledWith(index), /positive integer/)
  }
})
