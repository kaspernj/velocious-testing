// @ts-check

import {isMockFunction} from "./mocks.js"

/** @typedef {{__velociousMatcher: "arrayContaining" | "objectContaining", value: any}} ContainingMatcher */

/** @param {any} value @returns {ContainingMatcher} */
export function objectContaining(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected object but got ${typeof value}`)
  }
  return {__velociousMatcher: "objectContaining", value}
}

/** @param {any[]} value @returns {ContainingMatcher} */
export function arrayContaining(value) {
  if (!Array.isArray(value)) throw new Error(`Expected array but got ${typeof value}`)
  return {__velociousMatcher: "arrayContaining", value}
}

/** @param {any} value @returns {value is ContainingMatcher} */
function isContaining(value) {
  return Boolean(value && typeof value === "object" &&
    (value.__velociousMatcher === "arrayContaining" || value.__velociousMatcher === "objectContaining"))
}

/** @param {any} value @returns {boolean} */
function isPlainObject(value) {
  if (!value || typeof value !== "object") return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** @param {any} actual @param {any} expected @returns {boolean} */
function matches(actual, expected) {
  if (isContaining(expected)) {
    if (expected.__velociousMatcher === "objectContaining") {
      if (!actual || typeof actual !== "object") return false
      return Object.keys(expected.value).every((key) =>
        Object.prototype.hasOwnProperty.call(actual, key) && matches(actual[key], expected.value[key]))
    }

    if (!Array.isArray(actual)) return false
    const used = new Set()
    return /** @type {any[]} */ (expected.value).every((/** @type {any} */ expectedItem) => {
      const index = actual.findIndex((actualItem, candidateIndex) =>
        !used.has(candidateIndex) && matches(actualItem, expectedItem))
      if (index < 0) return false
      used.add(index)
      return true
    })
  }

  if (Object.is(actual, expected)) return true
  if (actual instanceof Date && expected instanceof Date) return actual.getTime() === expected.getTime()
  if (actual instanceof RegExp && expected instanceof RegExp) {
    return actual.source === expected.source && actual.flags === expected.flags
  }
  if (actual instanceof Set && expected instanceof Set) {
    if (actual.size !== expected.size) return false
    const remaining = [...actual]
    return [...expected].every((expectedItem) => {
      const index = remaining.findIndex((item) => matches(item, expectedItem))
      if (index < 0) return false
      remaining.splice(index, 1)
      return true
    })
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return actual.length === expected.length && expected.every((item, index) => matches(actual[index], item))
  }
  if (isPlainObject(actual) && isPlainObject(expected)) {
    const actualKeys = Object.keys(actual)
    const expectedKeys = Object.keys(expected)
    return actualKeys.length === expectedKeys.length && expectedKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(actual, key) && matches(actual[key], expected[key]))
  }
  return false
}

/** @param {any} actual @param {any} expected @returns {boolean} */
function partialMatches(actual, expected) {
  if (isContaining(expected)) return matches(actual, expected)
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.every((item, index) => partialMatches(actual[index], item))
  }
  if (isPlainObject(expected)) {
    return Boolean(actual && typeof actual === "object" && Object.keys(expected).every((key) =>
      Object.prototype.hasOwnProperty.call(actual, key) && partialMatches(actual[key], expected[key])))
  }
  return matches(actual, expected)
}

/** @param {any} actual @param {any} expected @param {string} path @param {Record<string, [any, any]>} differences @returns {void} */
function collectDifferences(actual, expected, path, differences) {
  if (isContaining(expected)) {
    if (expected.__velociousMatcher === "arrayContaining") {
      if (!matches(actual, expected)) differences[path || "$"] = [expected.value, actual]
      return
    }
    collectDifferences(actual, expected.value, path, differences)
    return
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      differences[path || "$"] = [expected, actual]
      return
    }
    expected.forEach((item, index) => collectDifferences(actual[index], item, `${path}[${index}]`, differences))
    return
  }
  if (isPlainObject(expected)) {
    if (!actual || typeof actual !== "object") {
      differences[path || "$"] = [expected, actual]
      return
    }
    for (const key of Object.keys(expected)) {
      const nextPath = path ? `${path}.${key}` : key
      if (!Object.prototype.hasOwnProperty.call(actual, key)) differences[nextPath] = [expected[key], undefined]
      else collectDifferences(actual[key], expected[key], nextPath, differences)
    }
    return
  }
  if (!matches(actual, expected)) differences[path || "$"] = [expected, actual]
}

/** @param {any} actual @param {any} expected @returns {Record<string, [any, any]>} */
function matchDifferences(actual, expected) {
  /** @type {Record<string, [any, any]>} */
  const differences = {}
  collectDifferences(actual, expected, "", differences)
  return differences
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

/** @param {RegExp} expression @param {string} value @returns {boolean} */
function matchesExpression(expression, value) {
  return new RegExp(expression.source, expression.flags).test(value)
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
    this.assert(contains, `${formatValue(this.value)} doesn't contain ${quotedValue(expected)}`, `${formatValue(this.value)} was unexpected to contain ${quotedValue(expected)}`)
  }

  /** @param {any} expected */
  toInclude(expected) { this.toContain(expected) }

  /** @param {any} expected */
  toEqual(expected) {
    const equal = matches(this.value, expected)
    if (isContaining(expected)) {
      const displayed = expected.value
      const differences = equal ? {} : matchDifferences(this.value, expected)
      const suffix = Object.keys(differences).length ? ` (diff: ${minifiedStringify(differences)})` : ""
      this.assert(equal, `Expected ${formatValue(this.value)} to match ${formatValue(displayed)}${suffix}`, `Expected ${formatValue(this.value)} not to match ${formatValue(displayed)}`)
      return
    }
    this.assert(equal, `${formatValue(this.value)} wasn't equal to ${formatValue(expected)}`, `${formatValue(this.value)} was unexpected equal to ${formatValue(expected)}`)
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
    const differences = equal ? {} : matchDifferences(this.value, expected)
    const suffix = Object.keys(differences).length ? ` (diff: ${minifiedStringify(differences)})` : ""
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
    this.assert(
      matchingIndex >= 0,
      `Expected mock to have been called with ${minifiedStringify(expected)}, but actual calls were ${minifiedStringify(calls)}`,
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
        `Expected last mock call to equal ${minifiedStringify(expected)}, but it was ${minifiedStringify(actual)}`,
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
        `Expected mock call ${index} to equal ${minifiedStringify(expected)}, but it was ${minifiedStringify(actual)}`,
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
      `Object had different values: ${minifiedStringify(matchDifferences(actual, expected))}`,
      `Object had unexpected values: ${minifiedStringify(actual)}`
    )
  }
}

/** @param {any} value @returns {Expect} */
export function expect(value) { return new Expect(value) }
expect.objectContaining = objectContaining
expect.arrayContaining = arrayContaining

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
