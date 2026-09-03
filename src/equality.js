// @ts-check

/** @typedef {"arrayContaining" | "objectContaining" | "anything" | "any" | "stringContaining" | "stringMatching"} AsymmetricMatcherKind */
/** @typedef {{__velociousMatcher: "arrayContaining" | "objectContaining", value: any}} ContainingMatcher */
/** @typedef {ContainingMatcher | {__velociousMatcher: "anything"} | {__velociousMatcher: "any" | "stringContaining" | "stringMatching", value: any}} AsymmetricMatcher */
/** @typedef {{path: string, expected: any, actual: any}} Difference */

const MAX_DIFFERENCES = 20
const MISSING = Symbol("missing")
const ASYMMETRIC_MATCHER_BRAND = Symbol.for("@velocious/testing/asymmetric-matcher/v1")
const ASYMMETRIC_MATCHERS = new Set([
  "arrayContaining",
  "objectContaining",
  "anything",
  "any",
  "stringContaining",
  "stringMatching"
])

/** @param {AsymmetricMatcherKind} kind @param {any} [value] @returns {AsymmetricMatcher} */
export function createAsymmetricMatcher(kind, value) {
  const matcher = value === undefined ? {__velociousMatcher: kind} : {__velociousMatcher: kind, value}
  Object.defineProperty(matcher, ASYMMETRIC_MATCHER_BRAND, {value: true})
  return /** @type {AsymmetricMatcher} */ (matcher)
}

/** @param {any} value @returns {value is AsymmetricMatcher} */
export function isAsymmetricMatcher(value) {
  return Boolean(value && typeof value === "object" && value[ASYMMETRIC_MATCHER_BRAND] === true &&
    ASYMMETRIC_MATCHERS.has(value.__velociousMatcher))
}

/** @param {any} value @returns {boolean} */
export function isPlainObject(value) {
  if (!value || typeof value !== "object") return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** @param {RegExp} expression @param {string} value @returns {boolean} */
export function matchesExpression(expression, value) {
  return new RegExp(expression.source, expression.flags).test(value)
}

/** @param {any} actual @param {Function} constructor @returns {boolean} */
function matchesConstructor(actual, constructor) {
  if (constructor === String) return typeof actual === "string" || actual instanceof String
  if (constructor === Number) return typeof actual === "number" || actual instanceof Number
  if (constructor === Boolean) return typeof actual === "boolean" || actual instanceof Boolean
  if (constructor === BigInt) return typeof actual === "bigint"
  if (constructor === Symbol) return typeof actual === "symbol"
  if (constructor === Function) return typeof actual === "function"
  if (constructor === Object) return actual !== null && (typeof actual === "object" || typeof actual === "function")
  try { return actual instanceof constructor } catch { return false }
}

/** @param {any[]} actual @param {any[]} expected @param {[any, any][]} pairs @returns {boolean} */
function matchesUnordered(actual, expected, pairs) {
  if (expected.length > actual.length) return false
  /** @type {Array<Array<boolean | undefined>>} */
  const compatibility = expected.map(() => Array(actual.length))
  const actualAssignments = Array(actual.length).fill(-1)

  /** @param {number} expectedIndex @param {number} actualIndex @returns {boolean} */
  const compatible = (expectedIndex, actualIndex) => {
    const cached = compatibility[expectedIndex][actualIndex]
    if (cached !== undefined) return cached
    const result = matchesInternal(actual[actualIndex], expected[expectedIndex], [...pairs])
    compatibility[expectedIndex][actualIndex] = result
    return result
  }

  /** @param {number} expectedIndex @param {Set<number>} visited @returns {boolean} */
  const augment = (expectedIndex, visited) => {
    for (let actualIndex = 0; actualIndex < actual.length; actualIndex += 1) {
      if (visited.has(actualIndex) || !compatible(expectedIndex, actualIndex)) continue
      visited.add(actualIndex)
      const previousExpectedIndex = actualAssignments[actualIndex]
      if (previousExpectedIndex === -1 || augment(previousExpectedIndex, visited)) {
        actualAssignments[actualIndex] = expectedIndex
        return true
      }
    }
    return false
  }

  for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex += 1) {
    if (!augment(expectedIndex, new Set())) return false
  }
  return true
}

/** @param {any} actual @param {AsymmetricMatcher} expected @param {[any, any][]} pairs @returns {boolean} */
function matchesAsymmetric(actual, expected, pairs) {
  switch (expected.__velociousMatcher) {
    case "anything": return actual !== null && actual !== undefined
    case "any": return matchesConstructor(actual, expected.value)
    case "stringContaining": return typeof actual === "string" && actual.includes(expected.value)
    case "stringMatching": {
      if (typeof actual !== "string") return false
      const expression = expected.value instanceof RegExp ? expected.value : new RegExp(expected.value)
      return matchesExpression(expression, actual)
    }
    case "objectContaining":
      return Boolean(actual && typeof actual === "object" && Object.keys(expected.value).every((key) =>
        Object.prototype.hasOwnProperty.call(actual, key) && matchesInternal(actual[key], expected.value[key], pairs)))
    case "arrayContaining":
      return Array.isArray(actual) && matchesUnordered(actual, expected.value, pairs)
  }
}

/** @param {any} actual @param {any} expected @param {[any, any][]} pairs @returns {boolean} */
function matchesInternal(actual, expected, pairs) {
  if (isAsymmetricMatcher(expected)) {
    const recursive = expected.__velociousMatcher === "objectContaining" || expected.__velociousMatcher === "arrayContaining"
    if (recursive && markPair(pairs, actual, expected)) return true
    return matchesAsymmetric(actual, expected, pairs)
  }
  if (Object.is(actual, expected)) return true
  if (actual instanceof Date && expected instanceof Date) return actual.getTime() === expected.getTime()
  if (actual instanceof RegExp && expected instanceof RegExp) {
    return actual.source === expected.source && actual.flags === expected.flags
  }
  if (actual instanceof Set && expected instanceof Set) {
    if (actual.size !== expected.size) return false
    return matchesUnordered([...actual], [...expected], pairs)
  }
  if (actual && expected && typeof actual === "object" && typeof expected === "object") {
    if (pairs.some(([seenActual, seenExpected]) => seenActual === actual && seenExpected === expected)) return true
    pairs.push([actual, expected])
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    return actual.length === expected.length && expected.every((item, index) => matchesInternal(actual[index], item, pairs))
  }
  if (isPlainObject(actual) && isPlainObject(expected)) {
    const actualKeys = Object.keys(actual)
    const expectedKeys = Object.keys(expected)
    return actualKeys.length === expectedKeys.length && expectedKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(actual, key) && matchesInternal(actual[key], expected[key], pairs))
  }
  return false
}

/** @param {any} actual @param {any} expected @returns {boolean} */
export function matches(actual, expected) { return matchesInternal(actual, expected, []) }

/** @param {any} actual @param {any} expected @param {[any, any][]} pairs @returns {boolean} */
function partialMatchesInternal(actual, expected, pairs) {
  if (isAsymmetricMatcher(expected)) return matchesInternal(actual, expected, pairs)
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false
    if (pairs.some(([seenActual, seenExpected]) => seenActual === actual && seenExpected === expected)) return true
    pairs.push([actual, expected])
    return expected.every((item, index) => partialMatchesInternal(actual[index], item, pairs))
  }
  if (isPlainObject(expected)) {
    if (!actual || typeof actual !== "object") return false
    if (pairs.some(([seenActual, seenExpected]) => seenActual === actual && seenExpected === expected)) return true
    pairs.push([actual, expected])
    return Object.keys(expected).every((key) => Object.prototype.hasOwnProperty.call(actual, key) &&
      partialMatchesInternal(actual[key], expected[key], pairs))
  }
  return matchesInternal(actual, expected, pairs)
}

/** @param {any} actual @param {any} expected @returns {boolean} */
export function partialMatches(actual, expected) { return partialMatchesInternal(actual, expected, []) }

/** @param {string} path @param {string} key @returns {string} */
function propertyPath(path, key) {
  return /^[A-Za-z_$][\w$]*$/u.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
}

/** @param {[any, any][]} pairs @param {any} actual @param {any} expected @returns {boolean} */
function markPair(pairs, actual, expected) {
  if (!actual || !expected || typeof actual !== "object" || typeof expected !== "object") return false
  if (pairs.some(([seenActual, seenExpected]) => seenActual === actual && seenExpected === expected)) return true
  pairs.push([actual, expected])
  return false
}

/** @param {Difference[]} differences @param {string} path @param {any} expected @param {any} actual @returns {void} */
function addDifference(differences, path, expected, actual) {
  differences.push({path, expected, actual})
}

/** @param {any} actual @param {any} expected @param {string} path @param {Difference[]} differences @param {[any, any][]} pairs @returns {void} */
function collectFull(actual, expected, path, differences, pairs) {
  if (matches(actual, expected)) return
  if (isAsymmetricMatcher(expected)) {
    if (expected.__velociousMatcher === "objectContaining" && actual && typeof actual === "object") {
      if (markPair(pairs, actual, expected.value)) return
      for (const key of Object.keys(expected.value).sort()) {
        const nextPath = propertyPath(path, key)
        if (!Object.prototype.hasOwnProperty.call(actual, key)) addDifference(differences, nextPath, expected.value[key], MISSING)
        else collectFull(actual[key], expected.value[key], nextPath, differences, pairs)
      }
      return
    }
    addDifference(differences, path, expected, actual)
    return
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) { addDifference(differences, path, expected, actual); return }
    if (markPair(pairs, actual, expected)) return
    if (actual.length !== expected.length) addDifference(differences, `${path}.length`, expected.length, actual.length)
    const length = Math.max(actual.length, expected.length)
    for (let index = 0; index < length; index += 1) {
      const expectedOwns = Object.hasOwn(expected, index)
      const actualOwns = Object.hasOwn(actual, index)
      if (!expectedOwns && !actualOwns) continue
      if (!expectedOwns) addDifference(differences, `${path}[${index}]`, MISSING, actual[index])
      else if (!actualOwns) addDifference(differences, `${path}[${index}]`, expected[index], MISSING)
      else collectFull(actual[index], expected[index], `${path}[${index}]`, differences, pairs)
    }
    return
  }
  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) { addDifference(differences, path, expected, actual); return }
    if (markPair(pairs, actual, expected)) return
    const keys = [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort()
    for (const key of keys) {
      const nextPath = propertyPath(path, key)
      const expectedOwns = Object.prototype.hasOwnProperty.call(expected, key)
      const actualOwns = Object.prototype.hasOwnProperty.call(actual, key)
      if (!expectedOwns) addDifference(differences, nextPath, MISSING, actual[key])
      else if (!actualOwns) addDifference(differences, nextPath, expected[key], MISSING)
      else collectFull(actual[key], expected[key], nextPath, differences, pairs)
    }
    return
  }
  addDifference(differences, path, expected, actual)
}

/** @param {any} actual @param {any} expected @param {string} path @param {Difference[]} differences @param {[any, any][]} pairs @returns {void} */
function collectPartial(actual, expected, path, differences, pairs) {
  if (partialMatches(actual, expected)) return
  if (isAsymmetricMatcher(expected)) { collectFull(actual, expected, path, differences, pairs); return }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) { addDifference(differences, path, expected, actual); return }
    if (markPair(pairs, actual, expected)) return
    expected.forEach((item, index) => collectPartial(actual[index], item, `${path}[${index}]`, differences, pairs))
    return
  }
  if (isPlainObject(expected)) {
    if (!actual || typeof actual !== "object") { addDifference(differences, path, expected, actual); return }
    if (markPair(pairs, actual, expected)) return
    for (const key of Object.keys(expected).sort()) {
      const nextPath = propertyPath(path, key)
      if (!Object.prototype.hasOwnProperty.call(actual, key)) addDifference(differences, nextPath, expected[key], MISSING)
      else collectPartial(actual[key], expected[key], nextPath, differences, pairs)
    }
    return
  }
  addDifference(differences, path, expected, actual)
}

/** @param {any} value @returns {string} */
function constructorName(value) { return value?.name || "anonymous" }

/** @param {AsymmetricMatcher} matcher @returns {string} */
export function asymmetricDescription(matcher) {
  switch (matcher.__velociousMatcher) {
    case "anything": return "anything()"
    case "any": return `any(${constructorName(matcher.value)})`
    case "stringContaining": return `stringContaining(${stableFormat(matcher.value)})`
    case "stringMatching": return `stringMatching(${stableFormat(matcher.value)})`
    case "arrayContaining": return `arrayContaining(${stableFormat(matcher.value)})`
    case "objectContaining": return `objectContaining(${stableFormat(matcher.value)})`
  }
}

/** @param {any} value @param {Map<object, number>} seen @param {{next: number}} state @param {number} depth @returns {string} */
function stableFormatInternal(value, seen, state, depth) {
  if (value === MISSING) return "<missing>"
  if (isAsymmetricMatcher(value)) return asymmetricDescription(value)
  if (value === undefined) return "undefined"
  if (value === null) return "null"
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "bigint") return `${value}n`
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN"
    if (value === Infinity) return "Infinity"
    if (value === -Infinity) return "-Infinity"
    if (Object.is(value, -0)) return "-0"
    return String(value)
  }
  if (typeof value === "boolean") return String(value)
  if (typeof value === "symbol") return String(value)
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "Date(Invalid)" : `Date(${JSON.stringify(value.toISOString())})`
  if (value instanceof RegExp) return String(value)
  if (value instanceof Error) return `${value.name}(${JSON.stringify(value.message)})`
  const reference = seen.get(value)
  if (reference !== undefined) return `<Circular #${reference}>`
  const referenceNumber = state.next
  state.next += 1
  seen.set(value, referenceNumber)
  if (depth >= 8) return `<${value?.constructor?.name || "Object"}>`
  if (Array.isArray(value)) {
    const entries = value.slice(0, 50).map((entry) => stableFormatInternal(entry, seen, state, depth + 1))
    if (value.length > 50) entries.push(`… ${value.length - 50} more`)
    return `[${entries.join(", ")}]`
  }
  if (value instanceof Set) {
    const entries = [...value].map((entry) => stableFormatInternal(entry, seen, state, depth + 1)).sort()
    return `Set {${entries.join(", ")}}`
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort()
    const entries = keys.slice(0, 50).map((key) => `${JSON.stringify(key)}: ${stableFormatInternal(value[key], seen, state, depth + 1)}`)
    if (keys.length > 50) entries.push(`… ${keys.length - 50} more`)
    return `{${entries.join(", ")}}`
  }
  return `[${value?.constructor?.name || "Object"}]`
}

/** @param {any} value @returns {string} */
export function stableFormat(value) { return stableFormatInternal(value, new Map(), {next: 1}, 0) }

/** @param {any} actual @param {any} expected @param {{partial?: boolean}} [options] @returns {Difference[]} */
function differences(actual, expected, options = {}) {
  /** @type {Difference[]} */
  const output = []
  if (options.partial) collectPartial(actual, expected, "$", output, [])
  else collectFull(actual, expected, "$", output, [])
  if (output.length === 0 && !(options.partial ? partialMatches(actual, expected) : matches(actual, expected))) {
    output.push({path: "$", expected, actual})
  }
  return output
}

/** @param {any} actual @param {any} expected @param {{partial?: boolean}} [options] @returns {string} */
export function formatDiff(actual, expected, options = {}) {
  const found = differences(actual, expected, options)
  if (found.length === 0) return ""
  const displayed = found.slice(0, MAX_DIFFERENCES)
  const lines = displayed.map((entry) =>
    `  ${entry.path}: expected ${stableFormat(entry.expected)}, received ${stableFormat(entry.actual)}`)
  if (found.length > MAX_DIFFERENCES) lines.push(`  ... ${found.length - MAX_DIFFERENCES} more differences`)
  return ["Diff:", ...lines].join("\n")
}

/** @param {any} actual @param {any} expected @returns {number} */
export function differenceCount(actual, expected) { return differences(actual, expected).length }
