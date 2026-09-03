// @ts-check

import {isMockFunction} from "./mocks.js"
import {
  createAsymmetricMatcher,
  differenceCount,
  formatDiff,
  isAsymmetricMatcher,
  isPlainObject,
  matches,
  matchesExpression,
  partialMatches,
  stableFormat
} from "./equality.js"

/** @typedef {import("./equality.js").AsymmetricMatcher} AsymmetricMatcher */
/** @typedef {import("./equality.js").ContainingMatcher} ContainingMatcher */
/** @typedef {{pass: boolean, message: string | (() => string)}} CustomMatcherResult */
/** @typedef {{isNot: boolean, equals: (actual: any, expected: any) => boolean, format: (value: any) => string, diff: (actual: any, expected: any) => string}} CustomMatcherContext */
/** @typedef {(this: CustomMatcherContext, received: any, ...expected: any[]) => CustomMatcherResult | Promise<CustomMatcherResult>} CustomMatcher */
/** @typedef {Record<string, CustomMatcher>} CustomMatcherDefinitions */

/** @type {Map<string, CustomMatcher>} */
const customMatchers = new Map()

/** @param {any} value @returns {ContainingMatcher} */
export function objectContaining(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected object but got ${typeof value}`)
  }
  return /** @type {ContainingMatcher} */ (createAsymmetricMatcher("objectContaining", value))
}

/** @param {any[]} value @returns {ContainingMatcher} */
export function arrayContaining(value) {
  if (!Array.isArray(value)) throw new Error(`Expected array but got ${typeof value}`)
  return /** @type {ContainingMatcher} */ (createAsymmetricMatcher("arrayContaining", value))
}

/** @returns {AsymmetricMatcher} */
export function anything() { return createAsymmetricMatcher("anything") }

/** @param {Function} constructor @returns {AsymmetricMatcher} */
export function any(constructor) {
  if (typeof constructor !== "function") throw new TypeError("any() requires a constructor function")
  return createAsymmetricMatcher("any", constructor)
}

/** @param {string} value @returns {AsymmetricMatcher} */
export function stringContaining(value) {
  if (typeof value !== "string") throw new TypeError("stringContaining() requires a string")
  return createAsymmetricMatcher("stringContaining", value)
}

/** @param {string | RegExp} value @returns {AsymmetricMatcher} */
export function stringMatching(value) {
  if (typeof value !== "string" && !(value instanceof RegExp)) {
    throw new TypeError("stringMatching() requires a string or RegExp")
  }
  return createAsymmetricMatcher("stringMatching", value)
}

/** @param {any} value @returns {value is ContainingMatcher} */
function isContaining(value) {
  return isAsymmetricMatcher(value) &&
    (value.__velociousMatcher === "arrayContaining" || value.__velociousMatcher === "objectContaining")
}

/** @param {any} value @returns {string} */
function minifiedStringify(value) {
  const seen = new WeakSet()
  try {
    return JSON.stringify(value, (_key, current) => {
      if (typeof current === "bigint") return String(current)
      if (typeof current === "object" && current !== null) {
        if (seen.has(current)) return "[Circular]"
        seen.add(current)
      }
      if (current instanceof Set) return [...current]
      return current
    })
  } catch {
    return String(value)
  }
}

/** @param {any} value @returns {string} */
function formatValue(value) {
  if (value === undefined) return "undefined"
  if (value === null) return "null"
  if (typeof value === "string") return value
  if (["number", "boolean", "bigint"].includes(typeof value)) return String(value)
  if (typeof value === "symbol") return String(value)
  if (typeof value === "function") return value.name || "function"
  if (value instanceof Set) return `Set(${minifiedStringify([...value])})`
  if (Array.isArray(value) || isPlainObject(value)) return minifiedStringify(value)
  return value?.constructor?.name || String(value)
}

/** @param {any} value @returns {string} */
function quotedValue(value) {
  return typeof value === "string" ? minifiedStringify(value) : formatValue(value)
}

/** @param {any} value @returns {any[][]} */
function mockCalls(value) {
  if (!isMockFunction(value)) throw new TypeError("Expected a mock function")
  return value.mock.calls
}

/** @param {number} count @returns {string} */
function callCount(count) { return `${count} ${count === 1 ? "time" : "times"}` }

/** @param {any[][]} calls @param {any[]} expected @returns {{call: any[], index: number} | undefined} */
function closestCall(calls, expected) {
  let closest
  let closestDifferenceCount = Infinity
  calls.forEach((call, index) => {
    const count = differenceCount(call, expected)
    if (count < closestDifferenceCount) {
      closest = {call, index}
      closestDifferenceCount = count
    }
  })
  return closest
}

class ChangeExpectation {
  /** @param {Expect} parent @param {() => any | Promise<any>} probe */
  constructor(parent, probe) {
    this.parent = parent
    this.probe = probe
    /** @type {number | undefined} */
    this.expectedDelta = undefined
  }

  /** @param {number} delta @returns {Expect} */
  by(delta) {
    this.expectedDelta = delta
    return this.parent
  }
}

/** A promise-aware view of the ordinary expectation matcher surface. */
export class PromiseExpectation {
  /** @param {any} value @param {"resolves" | "rejects"} settlement @param {boolean} [negated] */
  constructor(value, settlement, negated = false) {
    if ((typeof value !== "object" && typeof value !== "function") || value === null || typeof value.then !== "function") {
      throw new TypeError("Promise assertions require a promise-like received value")
    }
    this.value = value
    this.settlement = settlement
    this.negated = negated
  }

  /** @returns {PromiseExpectation} */
  get not() { return new PromiseExpectation(this.value, this.settlement, !this.negated) }

  /** @private @param {string} name @param {any[]} args @returns {Promise<void>} */
  async invoke(name, args) {
    const outcome = await Promise.resolve(this.value).then(
      (value) => ({status: "fulfilled", value}),
      (value) => ({status: "rejected", value})
    )
    if (this.settlement === "resolves" && outcome.status === "rejected") {
      throw new Error(`Expected promise to resolve, but it rejected with ${stableFormat(outcome.value)}`)
    }
    if (this.settlement === "rejects" && outcome.status === "fulfilled") {
      throw new Error(`Expected promise to reject, but it resolved with ${stableFormat(outcome.value)}`)
    }
    const received = this.settlement === "rejects" && (name === "toThrow" || name === "toThrowError") ?
      () => { throw outcome.value } : outcome.value
    const expectation = new Expect(received, this.negated)
    const matcher = /** @type {any} */ (expectation)[name]
    if (typeof matcher !== "function") throw new TypeError(`Unknown promise matcher ${JSON.stringify(name)}`)
    await matcher.apply(expectation, args)
  }

  /** @param {any} expected @returns {Promise<void>} */
  async toBe(expected) { await this.invoke("toBe", [expected]) }
  /** @param {number} expected @returns {Promise<void>} */
  async toBeLessThan(expected) { await this.invoke("toBeLessThan", [expected]) }
  /** @param {number} expected @returns {Promise<void>} */
  async toBeLessThanOrEqual(expected) { await this.invoke("toBeLessThanOrEqual", [expected]) }
  /** @param {number} expected @returns {Promise<void>} */
  async toBeGreaterThan(expected) { await this.invoke("toBeGreaterThan", [expected]) }
  /** @param {number} expected @returns {Promise<void>} */
  async toBeGreaterThanOrEqual(expected) { await this.invoke("toBeGreaterThanOrEqual", [expected]) }
  /** @param {number} expected @param {number} [precision] @returns {Promise<void>} */
  async toBeCloseTo(expected, precision) { await this.invoke("toBeCloseTo", [expected, precision]) }
  /** @param {number} expected @returns {Promise<void>} */
  async toHaveLength(expected) { await this.invoke("toHaveLength", [expected]) }
  /** @returns {Promise<void>} */
  async toBeDefined() { await this.invoke("toBeDefined", []) }
  /** @param {Function} klass @returns {Promise<void>} */
  async toBeInstanceOf(klass) { await this.invoke("toBeInstanceOf", [klass]) }
  /** @returns {Promise<void>} */
  async toBeFalse() { await this.invoke("toBeFalse", []) }
  /** @returns {Promise<void>} */
  async toBeNull() { await this.invoke("toBeNull", []) }
  /** @returns {Promise<void>} */
  async toBeUndefined() { await this.invoke("toBeUndefined", []) }
  /** @returns {Promise<void>} */
  async toBeTrue() { await this.invoke("toBeTrue", []) }
  /** @returns {Promise<void>} */
  async toBeTruthy() { await this.invoke("toBeTruthy", []) }
  /** @param {any} expected @returns {Promise<void>} */
  async toContain(expected) { await this.invoke("toContain", [expected]) }
  /** @param {any} expected @returns {Promise<void>} */
  async toContainEqual(expected) { await this.invoke("toContainEqual", [expected]) }
  /** @param {any} expected @returns {Promise<void>} */
  async toInclude(expected) { await this.invoke("toInclude", [expected]) }
  /** @param {any} expected @returns {Promise<void>} */
  async toEqual(expected) { await this.invoke("toEqual", [expected]) }
  /** @param {RegExp} expression @returns {Promise<void>} */
  async toMatch(expression) { await this.invoke("toMatch", [expression]) }
  /** @param {any} expected @returns {Promise<void>} */
  async toMatchObject(expected) { await this.invoke("toMatchObject", [expected]) }
  /** @returns {Promise<void>} */
  async toHaveBeenCalled() { await this.invoke("toHaveBeenCalled", []) }
  /** @param {number} expected @returns {Promise<void>} */
  async toHaveBeenCalledTimes(expected) { await this.invoke("toHaveBeenCalledTimes", [expected]) }
  /** @param {...any} expected @returns {Promise<void>} */
  async toHaveBeenCalledWith(...expected) { await this.invoke("toHaveBeenCalledWith", expected) }
  /** @param {...any} expected @returns {Promise<void>} */
  async toHaveBeenLastCalledWith(...expected) { await this.invoke("toHaveBeenLastCalledWith", expected) }
  /** @param {number} index @param {...any} expected @returns {Promise<void>} */
  async toHaveBeenNthCalledWith(index, ...expected) { await this.invoke("toHaveBeenNthCalledWith", [index, ...expected]) }
  /** @param {string | RegExp | Error | Function} [expected] @returns {Promise<void>} */
  async toThrow(expected) { await this.invoke("toThrow", [expected]) }
  /** @param {string | Error} expected @returns {Promise<void>} */
  async toThrowError(expected) { await this.invoke("toThrowError", [expected]) }
  /** @param {Record<string, any>} expected @returns {Promise<void>} */
  async toHaveAttributes(expected) { await this.invoke("toHaveAttributes", [expected]) }
}

export class Expect {
  /** @param {any} value @param {boolean} [negated] */
  constructor(value, negated = false) {
    this.value = value
    this.negated = negated
    /** @type {ChangeExpectation[]} */
    this.changes = []
  }

  /** @returns {Expect} */
  get not() { return new Expect(this.value, !this.negated) }

  /** @returns {PromiseExpectation} */
  get resolves() { return new PromiseExpectation(this.value, "resolves", this.negated) }

  /** @returns {PromiseExpectation} */
  get rejects() { return new PromiseExpectation(this.value, "rejects", this.negated) }

  /** @param {boolean} condition @param {string} positive @param {string} negative @returns {void} */
  assert(condition, positive, negative) {
    if (this.negated ? condition : !condition) throw new Error(this.negated ? negative : positive)
  }

  /** @param {any} expected @returns {void} */
  toBe(expected) {
    this.assert(Object.is(this.value, expected), `${formatValue(this.value)} wasn't expected be ${formatValue(expected)}`, `${formatValue(this.value)} was unexpected not to be ${formatValue(expected)}`)
  }

  /** @param {number} expected @returns {void} */
  toBeLessThan(expected) { this.numeric(expected, (a, b) => a < b, "less than") }
  /** @param {number} expected @returns {void} */
  toBeLessThanOrEqual(expected) { this.numeric(expected, (a, b) => a <= b, "less than or equal to") }
  /** @param {number} expected @returns {void} */
  toBeGreaterThan(expected) { this.numeric(expected, (a, b) => a > b, "greater than") }
  /** @param {number} expected @returns {void} */
  toBeGreaterThanOrEqual(expected) { this.numeric(expected, (a, b) => a >= b, "greater than or equal to") }

  /** @param {number} expected @param {(actual: number, expected: number) => boolean} comparator @param {string} label */
  numeric(expected, comparator, label) {
    if (typeof this.value !== "number" || typeof expected !== "number") {
      throw new Error(`Expected numbers but got ${typeof this.value} and ${typeof expected}`)
    }
    this.assert(comparator(this.value, expected), `${this.value} wasn't expected to be ${label} ${expected}`, `${this.value} was unexpected to be ${label} ${expected}`)
  }

  /** @param {number} expected @param {number} [precision] */
  toBeCloseTo(expected, precision = 2) {
    if (typeof this.value !== "number" || typeof expected !== "number") {
      throw new Error(`Expected numbers but got ${typeof this.value} and ${typeof expected}`)
    }
    const close = Math.abs(this.value - expected) <= 0.5 * Math.pow(10, -precision)
    this.assert(close, `${this.value} wasn't expected to be close to ${expected}`, `${this.value} was unexpected to be close to ${expected}`)
  }

  /** @param {number} expected */
  toHaveLength(expected) {
    if (typeof expected !== "number") throw new Error(`Expected length number but got ${typeof expected}`)
    if (this.value === null || this.value === undefined || typeof this.value.length !== "number") throw new Error(`Expected value with length but got ${typeof this.value}`)
    this.assert(this.value.length === expected, `${formatValue(this.value)} wasn't expected to have length ${expected}`, `${formatValue(this.value)} was unexpected to have length ${expected}`)
  }

  toBeDefined() { this.assert(this.value !== undefined, "undefined wasn't expected be undefined", `${formatValue(this.value)} wasn´t expected to be defined`) }
  /** @param {Function} klass */
  toBeInstanceOf(klass) { this.assert(this.value instanceof klass, `Expected ${formatValue(this.value)} to be a ${klass.name} but it wasn't`, `Expected ${formatValue(this.value)} not to be a ${klass.name}`) }
  toBeFalse() { this.toBe(false) }
  toBeNull() { this.toBe(null) }
  toBeUndefined() { this.toBe(undefined) }
  toBeTrue() { this.toBe(true) }
  toBeTruthy() { this.assert(Boolean(this.value), `${formatValue(this.value)} wasn't expected to be truthy`, `${formatValue(this.value)} was unexpected to be truthy`) }

  /** @param {any} expected */
  toContain(expected) {
    if (typeof this.value !== "string" && !Array.isArray(this.value)) throw new Error(`Expected array or string but got ${typeof this.value}`)
    const contains = this.value.includes(expected)
    this.assert(contains, `${quotedValue(this.value)} doesn't contain ${quotedValue(expected)}`, `${quotedValue(this.value)} was unexpected to contain ${quotedValue(expected)}`)
  }

  /** @param {any} expected */
  toContainEqual(expected) {
    if (!Array.isArray(this.value)) throw new Error(`Expected array but got ${typeof this.value}`)
    const contains = this.value.some((item) => matches(item, expected))
    const closest = contains ? undefined : closestCall(this.value.map((item) => [item]), [expected])
    const suffix = closest ? `\nClosest item ${closest.index + 1}:\n${formatDiff(closest.call[0], expected)}` : ""
    this.assert(contains, `${formatValue(this.value)} doesn't contain ${quotedValue(expected)}${suffix}`, `${formatValue(this.value)} was unexpected to contain ${quotedValue(expected)}`)
  }

  /** @param {any} expected */
  toInclude(expected) { this.toContain(expected) }

  /** @param {any} expected */
  toEqual(expected) {
    const equal = matches(this.value, expected)
    if (isContaining(expected)) {
      const displayed = expected.value
      const difference = equal ? "" : formatDiff(this.value, expected)
      const suffix = difference ? `\n${difference}` : ""
      this.assert(equal, `Expected ${formatValue(this.value)} to match ${formatValue(displayed)}${suffix}`, `Expected ${formatValue(this.value)} not to match ${formatValue(displayed)}`)
      return
    }
    const difference = equal ? "" : formatDiff(this.value, expected)
    const suffix = difference ? `\n${difference}` : ""
    this.assert(equal, `${formatValue(this.value)} wasn't equal to ${formatValue(expected)}${suffix}`, `${formatValue(this.value)} was unexpected equal to ${formatValue(expected)}`)
  }

  /** @param {RegExp} expression */
  toMatch(expression) {
    if (typeof this.value !== "string") throw new Error(`Expected string but got ${typeof this.value}`)
    this.assert(matchesExpression(expression, this.value), `${minifiedStringify(this.value)} didn't match ${expression}`, `${minifiedStringify(this.value)} shouldn't match ${expression}`)
  }

  /** @param {any} expected */
  toMatchObject(expected) {
    if (!expected || typeof expected !== "object") throw new Error(`Expected object but got ${typeof expected}`)
    const equal = partialMatches(this.value, expected)
    const difference = equal ? "" : formatDiff(this.value, expected, {partial: true})
    const suffix = difference ? `\n${difference}` : ""
    this.assert(equal, `Expected ${formatValue(this.value)} to match ${formatValue(expected)}${suffix}`, `Expected ${formatValue(this.value)} not to match ${formatValue(expected)}`)
  }

  toHaveBeenCalled() {
    const calls = mockCalls(this.value)
    this.assert(
      calls.length > 0,
      `Expected mock to have been called, but it was called ${callCount(calls.length)}`,
      `Expected mock not to have been called, but actual calls were ${minifiedStringify(calls)}`
    )
  }

  /** @param {number} expected */
  toHaveBeenCalledTimes(expected) {
    if (!Number.isInteger(expected) || expected < 0) throw new TypeError("Expected call count to be a non-negative integer")
    const calls = mockCalls(this.value)
    this.assert(
      calls.length === expected,
      `Expected mock to have been called ${callCount(expected)}, but it was called ${callCount(calls.length)}`,
      `Expected mock not to have been called ${callCount(expected)}, but it was`
    )
  }

  /** @param {...any} expected */
  toHaveBeenCalledWith(...expected) {
    const calls = mockCalls(this.value)
    const matchingIndex = calls.findIndex((call) => matches(call, expected))
    const closest = matchingIndex < 0 ? closestCall(calls, expected) : undefined
    const suffix = closest ? `\nClosest call ${closest.index + 1}:\n${formatDiff(closest.call, expected)}` : ""
    this.assert(
      matchingIndex >= 0,
      `Expected mock to have been called with ${minifiedStringify(expected)}, but actual calls were ${minifiedStringify(calls)}${suffix}`,
      `Expected mock not to have been called with ${minifiedStringify(expected)}, but matching call ${matchingIndex + 1} was found`
    )
  }

  /** @param {...any} expected */
  toHaveBeenLastCalledWith(...expected) {
    const calls = mockCalls(this.value)
    const actual = calls.at(-1)
    this.assert(
      actual !== undefined && matches(actual, expected),
      actual === undefined ?
        `Expected last mock call to equal ${minifiedStringify(expected)}, but no calls were recorded` :
        `Expected last mock call to equal ${minifiedStringify(expected)}, but it was ${minifiedStringify(actual)}\n${formatDiff(actual, expected)}`,
      `Expected last mock call not to equal ${minifiedStringify(expected)}, but it did`
    )
  }

  /** @param {number} index @param {...any} expected */
  toHaveBeenNthCalledWith(index, ...expected) {
    if (!Number.isInteger(index) || index <= 0) throw new TypeError("Expected call index to be a positive integer")
    const calls = mockCalls(this.value)
    const actual = calls[index - 1]
    this.assert(
      actual !== undefined && matches(actual, expected),
      actual === undefined ?
        `Expected mock call ${index} to equal ${minifiedStringify(expected)}, but only ${calls.length} ${calls.length === 1 ? "call was" : "calls were"} recorded` :
        `Expected mock call ${index} to equal ${minifiedStringify(expected)}, but it was ${minifiedStringify(actual)}\n${formatDiff(actual, expected)}`,
      `Expected mock call ${index} not to equal ${minifiedStringify(expected)}, but it did`
    )
  }

  /** @param {string | RegExp | Error | Function} [expected] @returns {Promise<void>} */
  async toThrow(expected) {
    if (typeof this.value !== "function") throw new Error(`Expected function but got ${typeof this.value}`)
    let didThrow = false
    let thrown
    try { await this.value() } catch (error) { didThrow = true; thrown = error }
    if (!didThrow) {
      if (this.negated) return
      throw new Error("Expected to fail but didn't")
    }
    if (expected === undefined) {
      this.assert(true, "Expected to fail but didn't", `${formatValue(this.value)} was unexpected to throw`)
      return
    }
    const message = thrown instanceof Error ? thrown.message : String(thrown)
    if (expected instanceof RegExp) {
      this.assert(
        matchesExpression(expected, message),
        `Expected to fail with message matching ${expected} but failed with '${message}'`,
        `${formatValue(this.value)} was unexpected to throw`
      )
    } else if (typeof expected === "function") {
      this.assert(
        thrown instanceof expected,
        `Expected to throw ${expected.name} but threw ${thrown?.constructor?.name || typeof thrown}`,
        `${formatValue(this.value)} was unexpected to throw`
      )
    } else {
      const wanted = expected instanceof Error ? expected.message : String(expected)
      this.assert(
        message === wanted,
        `Expected to fail with '${wanted}' but failed with '${message}'`,
        `${formatValue(this.value)} was unexpected to throw`
      )
    }
  }

  /** @param {string | Error} expected @returns {Promise<void>} */
  async toThrowError(expected) { await this.toThrow(expected instanceof Error ? expected.message : expected) }

  /** @param {() => any | Promise<any>} probe @returns {ChangeExpectation} */
  toChange(probe) {
    if (this.negated) throw new Error("Negated change expectations are not supported")
    if (typeof this.value !== "function") throw new Error(`Expected function but got ${typeof this.value}`)
    const change = new ChangeExpectation(this, probe)
    this.changes.push(change)
    return change
  }

  /** @param {() => any | Promise<any>} probe @returns {ChangeExpectation} */
  andChange(probe) { return this.toChange(probe) }

  /** @returns {Promise<any>} */
  async execute() {
    if (typeof this.value !== "function") throw new Error(`Expected function but got ${typeof this.value}`)
    const before = await Promise.all(this.changes.map((change) => change.probe()))
    const result = await this.value()
    const after = await Promise.all(this.changes.map((change) => change.probe()))
    this.changes.forEach((change, index) => {
      const delta = after[index] - before[index]
      if (change.expectedDelta === undefined) throw new Error("Change expectation requires by(count)")
      if (delta !== change.expectedDelta) throw new Error(`Expected to change by ${change.expectedDelta} but changed by ${delta}`)
    })
    return result
  }

  /** @param {Record<string, any>} expected */
  toHaveAttributes(expected) {
    /** @type {Record<string, any>} */
    const actual = {}
    for (const key of Object.keys(expected)) {
      if (typeof this.value?.[key] !== "function") throw new Error(`${this.value?.constructor?.name || "Object"} doesn't respond to ${key}`)
      actual[key] = this.value[key]()
    }
    const equal = matches(actual, expected)
    this.assert(
      equal,
      `Object had different values:\n${formatDiff(actual, expected)}`,
      `Object had unexpected values: ${minifiedStringify(actual)}`
    )
  }
}

/** @param {string} name @param {CustomMatcherResult} result @param {CustomMatcherContext} context @returns {void} */
function completeCustomMatcher(name, result, context) {
  if (!isPlainObject(result)) throw new TypeError(`Custom matcher ${JSON.stringify(name)} must return an object`)
  if (typeof result.pass !== "boolean") {
    throw new TypeError(`Custom matcher ${JSON.stringify(name)} result.pass must be a boolean`)
  }
  if (typeof result.message !== "string" && typeof result.message !== "function") {
    throw new TypeError(`Custom matcher ${JSON.stringify(name)} result.message must be a string or function`)
  }
  if (!(context.isNot ? result.pass : !result.pass)) return
  const message = typeof result.message === "function" ? Reflect.apply(result.message, context, []) : result.message
  if (typeof message !== "string") throw new TypeError(`Custom matcher ${JSON.stringify(name)} message() must return a string`)
  throw new Error(message)
}

/** @param {CustomMatcherResult | Promise<CustomMatcherResult>} result @returns {result is Promise<CustomMatcherResult>} */
function isCustomMatcherPromise(result) {
  return Boolean(result && typeof /** @type {any} */ (result).then === "function")
}

/** @param {Expect} expectation @param {string} name @param {any[]} args @returns {void | Promise<void>} */
function invokeCustomMatcher(expectation, name, args) {
  const implementation = customMatchers.get(name)
  if (!implementation) throw new TypeError(`Unknown custom matcher ${JSON.stringify(name)}`)
  const context = Object.freeze({
    isNot: expectation.negated,
    equals: matches,
    format: stableFormat,
    diff: (/** @type {any} */ actual, /** @type {any} */ expected) => formatDiff(actual, expected)
  })
  const result = Reflect.apply(implementation, context, [expectation.value, ...args])
  if (isCustomMatcherPromise(result)) {
    return Promise.resolve(result).then((resolved) => completeCustomMatcher(name, resolved, context))
  }
  completeCustomMatcher(name, result, context)
}

/** @param {CustomMatcherDefinitions} definitions @returns {void} */
function extend(definitions) {
  if (!isPlainObject(definitions)) {
    throw new TypeError("expect.extend() requires a plain object of matcher functions")
  }
  const keys = Reflect.ownKeys(definitions)
  if (keys.some((key) => typeof key !== "string")) throw new TypeError("Custom matcher names must be strings")
  const names = /** @type {string[]} */ (keys).sort()
  /** @type {Array<{name: string, implementation: CustomMatcher}>} */
  const validated = []
  for (const name of names) {
    if (name.length === 0) throw new TypeError("Custom matcher names must not be empty")
    if (customMatchers.has(name)) throw new TypeError(`Custom matcher ${JSON.stringify(name)} is already registered`)
    if (name in Expect.prototype || name in PromiseExpectation.prototype) {
      throw new TypeError(`Custom matcher ${JSON.stringify(name)} conflicts with an existing matcher`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(definitions, name)
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
      throw new TypeError(`Custom matcher ${JSON.stringify(name)} must be an own data-property function`)
    }
    validated.push({name, implementation: descriptor.value})
  }
  for (const {name, implementation} of validated) {
    customMatchers.set(name, implementation)
    Object.defineProperty(Expect.prototype, name, {
      configurable: false,
      writable: false,
      /** @this {Expect} @param {...any} args */
      value: function (...args) { return invokeCustomMatcher(this, name, args) }
    })
    Object.defineProperty(PromiseExpectation.prototype, name, {
      configurable: false,
      writable: false,
      /** @this {PromiseExpectation} @param {...any} args @returns {Promise<void>} */
      value: async function (...args) { await /** @type {any} */ (this).invoke(name, args) }
    })
  }
}

/** @param {any} value @returns {Expect} */
export function expect(value) { return new Expect(value) }
expect.extend = extend
expect.objectContaining = objectContaining
expect.arrayContaining = arrayContaining
expect.anything = anything
expect.any = any
expect.stringContaining = stringContaining
expect.stringMatching = stringMatching

/**
 * @param {{on: Function, off: Function}} emitter
 * @param {string} eventName
 * @param {{timeoutMs?: number, filter?: (...args: any[]) => boolean}} [options]
 * @returns {Promise<any>}
 */
export function waitForEvent(emitter, eventName, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000
  return new Promise((resolve, reject) => {
    /** @param {...any} args */
    const listener = (...args) => {
      try {
        if (options.filter && !options.filter(...args)) return
      } catch (error) {
        clearTimeout(timer)
        emitter.off(eventName, listener)
        reject(error)
        return
      }
      clearTimeout(timer)
      emitter.off(eventName, listener)
      resolve(args.length > 1 ? args : args[0])
    }
    const timer = setTimeout(() => {
      emitter.off(eventName, listener)
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for event ${JSON.stringify(eventName)}`))
    }, timeoutMs)
    emitter.on(eventName, listener)
  })
}
