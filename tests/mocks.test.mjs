import assert from "node:assert/strict"
import test from "node:test"

import * as testing from "../src/index.js"

test("mock functions record calls, return and throw results, and scope-global invocation order", () => {
  const scope = testing.createMockScope()
  const first = scope.fn(function (value) { return `${this?.prefix}:${value}` })
  const thrown = new Error("boom")
  const second = scope.fn(() => { throw thrown })

  assert.equal(first.call({prefix: "value"}, 1), "value:1")
  assert.throws(() => second("argument"), (error) => error === thrown)
  assert.equal(first(2), "undefined:2")

  assert.deepEqual(first.mock.calls, [[1], [2]])
  assert.deepEqual(first.mock.results, [
    {type: "return", value: "value:1"},
    {type: "return", value: "undefined:2"}
  ])
  assert.deepEqual(first.mock.instances, [])
  assert.deepEqual(first.mock.invocationCallOrder, [1, 3])
  assert.deepEqual(second.mock.calls, [["argument"]])
  assert.deepEqual(second.mock.results, [{type: "throw", value: thrown}])
  assert.deepEqual(second.mock.invocationCallOrder, [2])
})

test("persistent and FIFO one-shot helpers fall back after queue exhaustion", async () => {
  const scope = testing.createMockScope()
  const failure = new Error("rejected once")
  const implementation = scope.fn((value) => `persistent:${value}`)
    .mockImplementationOnce((value) => `implementation:${value}`)
    .mockReturnValueOnce("returned once")
    .mockResolvedValueOnce("resolved once")
    .mockRejectedValueOnce(failure)

  assert.equal(implementation("first"), "implementation:first")
  assert.equal(implementation("second"), "returned once")
  assert.equal(await implementation("third"), "resolved once")
  await assert.rejects(implementation("fourth"), (error) => error === failure)
  assert.equal(implementation("fifth"), "persistent:fifth")

  implementation.mockReturnValue("returned")
  assert.equal(implementation(), "returned")
  implementation.mockResolvedValue("resolved")
  assert.equal(await implementation(), "resolved")
  implementation.mockRejectedValue(failure)
  await assert.rejects(implementation(), (error) => error === failure)
  implementation.mockImplementation((value) => `replaced:${value}`)
  assert.equal(implementation("last"), "replaced:last")
})

test("rejected promises are recorded as returned promises rather than synchronous throws", async () => {
  const scope = testing.createMockScope()
  const rejection = new Error("async failure")
  const implementation = scope.fn(async () => await Promise.reject(rejection))

  const promise = implementation()

  assert.deepEqual(implementation.mock.calls, [[]])
  assert.equal(implementation.mock.results[0].type, "return")
  assert.equal(implementation.mock.results[0].value, promise)
  await assert.rejects(promise, (error) => error === rejection)
})

test("constructor calls record successful instances and constructor throws", () => {
  const scope = testing.createMockScope()
  function Person(name) { this.name = name }
  Person.prototype.greeting = function () { return `Hello ${this.name}` }
  const PersonDouble = scope.fn(Person)

  const person = new PersonDouble("Ada")

  assert.equal(person instanceof Person, true)
  assert.equal(person instanceof PersonDouble, true)
  assert.equal(person.greeting(), "Hello Ada")
  assert.deepEqual(PersonDouble.mock.calls, [["Ada"]])
  assert.deepEqual(PersonDouble.mock.instances, [person])
  assert.deepEqual(PersonDouble.mock.results, [{type: "return", value: person}])

  const constructed = {kind: "replacement"}
  const Returning = scope.fn(function () { return constructed })
  assert.equal(new Returning(), constructed)
  assert.deepEqual(Returning.mock.instances, [constructed])

  const helperConstructed = {kind: "helper replacement"}
  const HelperReturning = scope.fn().mockReturnValue(helperConstructed)
  assert.equal(new HelperReturning(), helperConstructed)
  assert.deepEqual(HelperReturning.mock.instances, [helperConstructed])

  const failure = new Error("constructor failed")
  const Throwing = scope.fn(function () { throw failure })
  assert.throws(() => new Throwing(), (error) => error === failure)
  assert.deepEqual(Throwing.mock.results, [{type: "throw", value: failure}])
  assert.deepEqual(Throwing.mock.instances, [])
})

test("constructor implementations consistently use the selected class prototype and reset to neutral", () => {
  const scope = testing.createMockScope()
  class Initial {
    constructor(name) { this.name = name }
    description() { return `initial:${this.name}` }
  }
  class Persistent {
    constructor(name) { this.name = name }
    description() { return `persistent:${this.name}` }
  }
  class OneShot {
    constructor(name) { this.name = name }
    description() { return `once:${this.name}` }
  }
  class Fallback {
    constructor(name) { this.name = name }
    description() { return `fallback:${this.name}` }
  }

  const InitialDouble = scope.fn(Initial)
  const initial = new InitialDouble("initial")
  assert.equal(initial instanceof Initial, true)
  assert.equal(initial instanceof InitialDouble, true)
  assert.equal(Object.getPrototypeOf(initial), Initial.prototype)
  assert.equal(initial.description(), "initial:initial")

  const PersistentDouble = scope.fn().mockImplementation(Persistent)
  const persistent = new PersistentDouble("configured")
  assert.equal(persistent instanceof Persistent, true)
  assert.equal(persistent instanceof PersistentDouble, true)
  assert.equal(Object.getPrototypeOf(persistent), Persistent.prototype)
  assert.equal(persistent.description(), "persistent:configured")

  const QueuedDouble = scope.fn(Fallback).mockImplementationOnce(OneShot)
  const once = new QueuedDouble("first")
  assert.equal(once instanceof OneShot, true)
  assert.equal(once instanceof QueuedDouble, true)
  assert.equal(Object.getPrototypeOf(once), OneShot.prototype)
  assert.equal(once.description(), "once:first")
  const fallback = new QueuedDouble("second")
  assert.equal(fallback instanceof Fallback, true)
  assert.equal(fallback instanceof QueuedDouble, true)
  assert.equal(Object.getPrototypeOf(fallback), Fallback.prototype)
  assert.equal(fallback.description(), "fallback:second")

  InitialDouble.mockReset()
  assert.notEqual(InitialDouble.prototype, Initial.prototype)
  const neutral = new InitialDouble("ignored")
  assert.equal(neutral instanceof Initial, false)
  assert.equal(neutral instanceof InitialDouble, true)
  assert.equal(Object.getPrototypeOf(neutral), InitialDouble.prototype)
  assert.equal("description" in neutral, false)
})

test("clear preserves behavior and stable history arrays while reset removes all behavior", () => {
  const scope = testing.createMockScope()
  const implementation = scope.fn((value) => `persistent:${value}`)
    .mockReturnValueOnce("queued")
  const calls = implementation.mock.calls
  const results = implementation.mock.results
  const orders = implementation.mock.invocationCallOrder

  assert.equal(implementation("before clear"), "queued")
  assert.equal(implementation.mockClear(), implementation)
  assert.equal(implementation.mock.calls, calls)
  assert.equal(implementation.mock.results, results)
  assert.equal(implementation.mock.invocationCallOrder, orders)
  assert.deepEqual(calls, [])
  assert.deepEqual(results, [])
  assert.deepEqual(orders, [])
  assert.equal(implementation("after clear"), "persistent:after clear")

  implementation.mockReturnValueOnce("discarded")
  assert.equal(implementation.mockReset(), implementation)
  assert.deepEqual(implementation.mock.calls, [])
  assert.equal(implementation("after reset"), undefined)
  assert.deepEqual(implementation.mock.results, [{type: "return", value: undefined}])
  assert.deepEqual(implementation.mock.invocationCallOrder, [3])
})

test("mock function APIs reject invalid implementations", () => {
  const scope = testing.createMockScope()

  assert.throws(() => scope.fn("invalid"), /implementation must be a function/i)
  const implementation = scope.fn()
  assert.throws(() => implementation.mockImplementation(null), /implementation must be a function/i)
  assert.throws(() => implementation.mockImplementationOnce({}), /implementation must be a function/i)
})

test("spies call through with the receiver and restore exact own descriptors after reassignment", () => {
  const scope = testing.createMockScope()
  const original = function (suffix) { return `${this.prefix}:${suffix}` }
  const target = {}
  Object.defineProperty(target, "method", {
    value: original,
    writable: true,
    enumerable: false,
    configurable: true
  })
  const before = Object.getOwnPropertyDescriptor(target, "method")

  const spy = scope.spyOn(target, "method")

  assert.equal(target.method.call({prefix: "receiver"}, "value"), "receiver:value")
  assert.deepEqual(spy.mock.calls, [["value"]])
  assert.deepEqual(Object.getOwnPropertyDescriptor(target, "method"), {...before, value: spy})
  target.method = () => "intervening"
  assert.equal(spy.mockRestore(), spy)
  assert.deepEqual(Object.getOwnPropertyDescriptor(target, "method"), before)
  assert.equal(target.method, original)
  assert.equal(spy.mockRestore(), spy)
})

test("stubs replace behavior and reset spies and stubs without restoring properties", () => {
  const scope = testing.createMockScope()
  const target = {
    spy(value) { return `original:${value}` },
    stub(value) { return `original stub:${value}` }
  }
  const originalSpy = target.spy
  const originalStub = target.stub
  const spy = scope.spyOn(target, "spy")
  const stub = scope.stub(target, "stub", (value) => `stubbed:${value}`)

  assert.equal(target.spy("first"), "original:first")
  assert.equal(target.stub("first"), "stubbed:first")
  spy.mockImplementation(() => "overridden")
  stub.mockReturnValue("returned")
  assert.equal(target.spy(), "overridden")
  assert.equal(target.stub(), "returned")

  spy.mockReset()
  stub.mockReset()
  assert.equal(target.spy(), undefined)
  assert.equal(target.stub(), undefined)
  assert.notEqual(target.spy, originalSpy)
  assert.notEqual(target.stub, originalStub)

  spy.mockRestore()
  stub.mockRestore()
  assert.equal(target.spy, originalSpy)
  assert.equal(target.stub, originalStub)
})

test("property doubles support symbols and constructors", () => {
  const scope = testing.createMockScope()
  const method = Symbol("method")
  function Person(name) { this.name = name }
  const target = {
    [method](value) { return value + 1 },
    Person
  }
  const originalSymbolMethod = target[method]

  const symbolSpy = scope.spyOn(target, method)
  const constructorSpy = scope.spyOn(target, "Person")
  const person = new target.Person("Ada")

  assert.equal(target[method](2), 3)
  assert.deepEqual(symbolSpy.mock.calls, [[2]])
  assert.equal(person instanceof Person, true)
  assert.deepEqual(constructorSpy.mock.instances, [person])
  scope.restoreAll()
  assert.equal(target[method], originalSymbolMethod)
  assert.equal(target.Person, Person)
})

test("inherited doubles create a removable own property and preserve source flags", () => {
  const scope = testing.createMockScope()
  const prototype = {}
  const original = function () { return this.value }
  Object.defineProperty(prototype, "method", {
    value: original,
    writable: false,
    enumerable: false,
    configurable: false
  })
  const target = Object.create(prototype)
  target.value = 7

  const spy = scope.spyOn(target, "method")

  assert.equal(Object.hasOwn(target, "method"), true)
  assert.deepEqual(Object.getOwnPropertyDescriptor(target, "method"), {
    value: spy,
    writable: false,
    enumerable: false,
    configurable: true
  })
  assert.equal(target.method(), 7)
  spy.mockRestore()
  assert.equal(Object.hasOwn(target, "method"), false)
  assert.equal(target.method, original)

  const sealedTarget = Object.preventExtensions(Object.create(prototype))
  assert.throws(() => scope.spyOn(sealedTarget, "method"), /not extensible/i)
})

test("writable non-configurable own methods can be doubled but immutable methods cannot", () => {
  const scope = testing.createMockScope()
  const writable = {}
  const original = () => "original"
  Object.defineProperty(writable, "method", {
    value: original,
    writable: true,
    enumerable: true,
    configurable: false
  })

  const spy = scope.spyOn(writable, "method")
  assert.deepEqual(Object.getOwnPropertyDescriptor(writable, "method"), {
    value: spy,
    writable: true,
    enumerable: true,
    configurable: false
  })
  assert.equal(writable.method(), "original")
  spy.mockRestore()
  assert.equal(writable.method, original)

  const immutable = {}
  Object.defineProperty(immutable, "method", {
    value: original,
    writable: false,
    configurable: false
  })
  assert.throws(() => scope.spyOn(immutable, "method"), /non-configurable.*non-writable/i)
})

test("property doubles reject invalid targets, keys, accessors, values, and duplicates without invoking getters", () => {
  const scope = testing.createMockScope()
  let getterCalls = 0
  const prototype = {}
  Object.defineProperty(prototype, "accessor", {
    get() { getterCalls += 1; return () => {} },
    configurable: true
  })
  const target = Object.create(prototype)
  target.value = 1
  target.method = () => "method"

  assert.throws(() => scope.spyOn(null, "method"), /target must be an object or function/i)
  assert.throws(() => scope.spyOn(1, "method"), /target must be an object or function/i)
  assert.throws(() => scope.spyOn(target, 1), /property key must be a string or symbol/i)
  assert.throws(() => scope.spyOn(target, "missing"), /property.*missing.*does not exist/i)
  assert.throws(() => scope.spyOn(target, "value"), /property.*value.*not a function/i)
  assert.throws(() => scope.spyOn(target, "accessor"), /property.*accessor.*accessor/i)
  assert.equal(getterCalls, 0)
  assert.throws(() => scope.stub(target, "method", "invalid"), /implementation must be a function/i)

  const spy = scope.spyOn(target, "method")
  assert.throws(() => scope.spyOn(target, "method"), /property.*method.*already has an active double/i)
  assert.throws(() => scope.stub(target, "method"), /property.*method.*already has an active double/i)
  spy.mockRestore()
  const next = scope.stub(target, "method")
  assert.equal(target.method(), undefined)
  next.mockRestore()
})

test("failed restoration remains registered and can be retried", () => {
  const scope = testing.createMockScope()
  const original = () => "original"
  const backing = {method: original}
  let failRestore = false
  const target = new Proxy(backing, {
    defineProperty(object, key, descriptor) {
      if (failRestore && key === "method" && descriptor.value === original) throw new Error("restore blocked")
      return Reflect.defineProperty(object, key, descriptor)
    }
  })
  const spy = scope.spyOn(target, "method")

  failRestore = true
  assert.throws(() => spy.mockRestore(), /restore blocked/)
  assert.equal(target.method, spy)
  assert.throws(() => scope.spyOn(target, "method"), /already has an active double/i)

  failRestore = false
  assert.equal(spy.mockRestore(), spy)
  assert.equal(target.method, original)
  assert.doesNotThrow(() => scope.spyOn(target, "method").mockRestore())
})

test("duplicate active property doubles are rejected across scopes", () => {
  const firstScope = testing.createMockScope()
  const secondScope = testing.createMockScope()
  const target = {method() { return "original" }}
  const first = firstScope.spyOn(target, "method")

  assert.throws(() => secondScope.stub(target, "method"), /already has an active double/i)
  first.mockRestore()
  assert.doesNotThrow(() => secondScope.spyOn(target, "method").mockRestore())
})

test("scoped clearAll and resetAll retain registrations while restoreAll only removes property doubles", () => {
  const scope = testing.createMockScope()
  const plain = scope.fn(() => "plain")
  const target = {method: () => "original"}
  const original = target.method
  const spy = scope.spyOn(target, "method")

  plain()
  target.method()
  scope.clearAll()
  assert.deepEqual(plain.mock.calls, [])
  assert.deepEqual(spy.mock.calls, [])
  assert.equal(plain(), "plain")
  assert.equal(target.method(), "original")

  scope.resetAll()
  assert.equal(plain(), undefined)
  assert.equal(target.method(), undefined)
  scope.restoreAll()
  assert.equal(target.method, original)

  spy.mockReturnValue("detached")
  const callsBeforeDetachedInvocation = spy.mock.calls.length
  spy()
  scope.clearAll()
  assert.equal(spy.mock.calls.length, callsBeforeDetachedInvocation + 1)

  plain.mockReturnValue("still registered")
  plain()
  scope.clearAll()
  assert.deepEqual(plain.mock.calls, [])
})

test("restoreAll works in reverse order, continues after failures, aggregates, and retries failures", () => {
  const scope = testing.createMockScope()
  const order = []
  let blocked = true
  const createTarget = (name, shouldBlock = false) => {
    const original = () => name
    const backing = {method: original}
    return {
      original,
      target: new Proxy(backing, {
        defineProperty(object, key, descriptor) {
          if (key === "method" && descriptor.value === original) {
            order.push(name)
            if (shouldBlock && blocked) throw new Error(`${name} blocked`)
          }
          return Reflect.defineProperty(object, key, descriptor)
        }
      })
    }
  }
  const first = createTarget("first")
  const second = createTarget("second", true)
  const third = createTarget("third")
  scope.spyOn(first.target, "method")
  scope.spyOn(second.target, "method")
  scope.spyOn(third.target, "method")

  assert.throws(
    () => scope.restoreAll(),
    (error) => error instanceof AggregateError && error.errors.length === 1 && /second blocked/.test(error.errors[0].message)
  )
  assert.deepEqual(order, ["third", "second", "first"])
  assert.equal(first.target.method, first.original)
  assert.equal(third.target.method, third.original)
  assert.notEqual(second.target.method, second.original)

  blocked = false
  scope.restoreAll()
  assert.deepEqual(order, ["third", "second", "first", "second"])
  assert.equal(second.target.method, second.original)
})
