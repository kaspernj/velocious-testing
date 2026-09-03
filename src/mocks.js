// @ts-check

/** @typedef {{type: "return" | "throw", value: any}} MockResult */
/** @typedef {((...args: any[]) => any) & (new (...args: any[]) => any)} AnyMockImplementation */
/**
 * @template {Function} T
 * @typedef {T extends (this: infer This, ...args: infer Args) => infer Result ?
 *   (this: This, ...args: Args) => Result : unknown} MockCallSignature<T>
 */
/**
 * @template {Function} T
 * @typedef {T extends new (...args: infer Args) => infer Instance ?
 *   new (...args: Args) => Instance : unknown} MockConstructSignature<T>
 */
/**
 * @template {Function} T
 * @typedef {MockCallSignature<T> & MockConstructSignature<T>} MockSignature<T>
 */
/**
 * @template {Function} T
 * @typedef {T extends (...args: any[]) => infer Result ? Result : any} MockReturnValue
 */
/**
 * @template {Function} T
 * @typedef {T extends AnyMockImplementation ?
 *   AnyMockImplementation extends T ? Function : MockSignature<T> : MockSignature<T>} MockImplementation
 */
/**
 * @template {Function} T
 * @typedef {T extends (...args: any[]) => PromiseLike<infer Value> ? Value : never} MockResolvedValue
 */
/**
 * @typedef {object} MockState
 * @property {any[][]} calls
 * @property {MockResult[]} results
 * @property {any[]} instances
 * @property {number[]} invocationCallOrder
 */
/**
 * @template {Function} [T=AnyMockImplementation]
 * @typedef {MockSignature<T> & {
 *   mock: MockState,
 *   mockClear: () => MockFunction<T>,
 *   mockReset: () => MockFunction<T>,
 *   mockImplementation: (implementation: MockImplementation<T>) => MockFunction<T>,
 *   mockImplementationOnce: (implementation: MockImplementation<T>) => MockFunction<T>,
 *   mockReturnValue: (value: MockReturnValue<T>) => MockFunction<T>,
 *   mockReturnValueOnce: (value: MockReturnValue<T>) => MockFunction<T>,
 *   mockResolvedValue: (value: MockResolvedValue<T>) => MockFunction<T>,
 *   mockResolvedValueOnce: (value: MockResolvedValue<T>) => MockFunction<T>,
 *   mockRejectedValue: (reason: any) => MockFunction<T>,
 *   mockRejectedValueOnce: (reason: any) => MockFunction<T>
 * }} MockFunction<T>
 */
/**
 * @template {Function} [T=AnyMockImplementation]
 * @typedef {MockFunction<T> & {mockRestore: () => RestorableMockFunction<T>}} RestorableMockFunction<T>
 */
/**
 * @template {object} T
 * @typedef {Extract<{
 *   [K in keyof T]-?: Extract<T[K], Function> extends never ? never : K
 * }[keyof T], string | symbol>} FunctionPropertyKey<T>
 */
/**
 * @template {object} T
 * @template {FunctionPropertyKey<T>} K
 * @typedef {Extract<T[K], Function>} PropertyFunction<T, K>
 */
/** @typedef {{implementation: Function | undefined, once: Function[]}} MockBehavior */
/** @typedef {{state: MockState, behavior: MockBehavior}} MockControl */
/**
 * @typedef {object} PropertyDoubleRecord
 * @property {object} target
 * @property {string | symbol} key
 * @property {PropertyDescriptor} descriptor
 * @property {boolean} owned
 * @property {RestorableMockFunction} implementation
 * @property {boolean} active
 */

const controls = new WeakMap()
/** @type {WeakMap<object, Map<string | symbol, PropertyDoubleRecord>>} */
const activeProperties = new WeakMap()

/** @param {any} implementation @param {string} [label] @returns {asserts implementation is Function} */
function validateImplementation(implementation, label = "Mock implementation") {
  if (typeof implementation !== "function") throw new TypeError(`${label} must be a function`)
}

/** @param {MockState} state */
function clearState(state) {
  state.calls.length = 0
  state.results.length = 0
  state.instances.length = 0
  state.invocationCallOrder.length = 0
}

/** @param {any} value @returns {Promise<any>} */
function resolveValue(value) { return Promise.resolve(value) }

/** @param {any} reason @returns {Promise<never>} */
function rejectValue(reason) { return Promise.reject(reason) }

/**
 * @param {Set<MockFunction>} registered
 * @param {() => number} nextInvocationOrder
 * @param {Function | undefined} implementation
 * @returns {MockFunction}
 */
function createMockFunction(registered, nextInvocationOrder, implementation) {
  if (implementation !== undefined) validateImplementation(implementation)
  function neutralImplementation() {}
  /** @type {MockState} */
  const state = {calls: [], results: [], instances: [], invocationCallOrder: []}
  const constructedInstances = new WeakSet()
  /** @type {MockBehavior} */
  const behavior = {implementation, once: []}

  /** @type {MockFunction} */
  const mockFunction = /** @type {any} */ (/** @this {any} @param {...any} args */ function (...args) {
    const callIndex = state.calls.length
    state.calls.push(args)
    state.invocationCallOrder.push(nextInvocationOrder())
    state.results.push(/** @type {any} */ (undefined))
    const selected = behavior.once.length ? behavior.once.shift() : behavior.implementation
    try {
      let value
      if (new.target) {
        const constructor = selected || neutralImplementation
        if (Object.is(new.target, mockFunction)) {
          mockFunction.prototype = constructor.prototype && typeof constructor.prototype === "object" ?
            constructor.prototype : neutralPrototype
        }
        const constructorNewTarget = Object.is(new.target, mockFunction) && selected ? constructor : new.target
        value = Reflect.construct(constructor, args, constructorNewTarget)
        constructedInstances.add(value)
        state.instances.push(value)
      } else {
        value = selected ? Reflect.apply(selected, this, args) : undefined
      }
      state.results[callIndex] = {type: "return", value}
      return value
    } catch (error) {
      state.results[callIndex] = {type: "throw", value: error}
      throw error
    }
  })

  const neutralPrototype = mockFunction.prototype
  Object.defineProperty(mockFunction, Symbol.hasInstance, {
    configurable: true,
    /** @param {any} value */
    value(value) {
      return constructedInstances.has(value) || Function.prototype[Symbol.hasInstance].call(mockFunction, value)
    }
  })
  if (implementation?.prototype && typeof implementation.prototype === "object") {
    mockFunction.prototype = implementation.prototype
  }
  mockFunction.mock = state
  mockFunction.mockClear = () => {
    clearState(state)
    return mockFunction
  }
  mockFunction.mockReset = () => {
    clearState(state)
    behavior.implementation = undefined
    behavior.once.length = 0
    mockFunction.prototype = neutralPrototype
    return mockFunction
  }
  mockFunction.mockImplementation = (next) => {
    validateImplementation(next)
    behavior.implementation = next
    return mockFunction
  }
  mockFunction.mockImplementationOnce = (next) => {
    validateImplementation(next)
    behavior.once.push(next)
    return mockFunction
  }
  mockFunction.mockReturnValue = (value) => mockFunction.mockImplementation(function () { return value })
  mockFunction.mockReturnValueOnce = (value) => mockFunction.mockImplementationOnce(function () { return value })
  mockFunction.mockResolvedValue = (value) => mockFunction.mockImplementation(function () { return resolveValue(value) })
  mockFunction.mockResolvedValueOnce = (value) => mockFunction.mockImplementationOnce(function () { return resolveValue(value) })
  mockFunction.mockRejectedValue = (reason) => mockFunction.mockImplementation(function () { return rejectValue(reason) })
  mockFunction.mockRejectedValueOnce = (reason) => mockFunction.mockImplementationOnce(function () { return rejectValue(reason) })
  controls.set(mockFunction, {state, behavior})
  registered.add(mockFunction)
  return mockFunction
}

/** @param {any} value @returns {value is MockFunction} */
export function isMockFunction(value) {
  return typeof value === "function" && controls.has(value)
}

/** @param {string | symbol} key @returns {string} */
function propertyLabel(key) { return typeof key === "symbol" ? String(key) : JSON.stringify(key) }

/** @param {any} target @returns {asserts target is object} */
function validateTarget(target) {
  if ((typeof target !== "object" || target === null) && typeof target !== "function") {
    throw new TypeError("Mock target must be an object or function")
  }
}

/** @param {any} key @returns {asserts key is string | symbol} */
function validatePropertyKey(key) {
  if (typeof key !== "string" && typeof key !== "symbol") {
    throw new TypeError("Mock property key must be a string or symbol")
  }
}

/**
 * @param {object} target
 * @param {string | symbol} key
 * @returns {{descriptor: PropertyDescriptor, owned: boolean} | undefined}
 */
function findProperty(target, key) {
  let owner = target
  while (owner !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key)
    if (descriptor) return {descriptor, owned: owner === target}
    owner = Object.getPrototypeOf(owner)
  }
  return undefined
}

/** Creates an isolated registry for mock functions and property doubles. */
export function createMockScope() {
  /** @type {Set<MockFunction>} */
  const registered = new Set()
  /** @type {PropertyDoubleRecord[]} */
  const propertyRecords = []
  let invocationOrder = 0
  const nextInvocationOrder = () => { invocationOrder += 1; return invocationOrder }

  /**
   * @template {Function} T
   * @overload
   * @param {T} implementation
   * @returns {MockFunction<T>}
   */
  /**
   * @overload
   * @returns {MockFunction}
   */
  /** @param {Function} [implementation] */
  function fn(implementation) {
    return createMockFunction(registered, nextInvocationOrder, implementation)
  }

  /** @param {PropertyDoubleRecord} record @returns {RestorableMockFunction} */
  const restore = (record) => {
    if (!record.active) return record.implementation
    if (record.owned) Object.defineProperty(record.target, record.key, record.descriptor)
    else if (!Reflect.deleteProperty(record.target, record.key)) {
      throw new TypeError(`Could not restore inherited property ${propertyLabel(record.key)}`)
    }
    record.active = false
    registered.delete(record.implementation)
    const targetRecords = activeProperties.get(record.target)
    targetRecords?.delete(record.key)
    if (targetRecords?.size === 0) activeProperties.delete(record.target)
    const index = propertyRecords.indexOf(record)
    if (index >= 0) propertyRecords.splice(index, 1)
    return record.implementation
  }

  /**
   * @param {object} target
   * @param {string | symbol} key
   * @param {Function | undefined} implementation
   * @param {boolean} callThrough
   * @returns {RestorableMockFunction}
   */
  const replaceProperty = (target, key, implementation, callThrough) => {
    validateTarget(target)
    validatePropertyKey(key)
    if (implementation !== undefined) validateImplementation(implementation)
    const existing = activeProperties.get(target)?.get(key)
    if (existing) throw new Error(`Property ${propertyLabel(key)} already has an active double`)
    const found = findProperty(target, key)
    if (!found) throw new Error(`Property ${propertyLabel(key)} does not exist`)
    const {descriptor, owned} = found
    if (descriptor.get || descriptor.set || !("value" in descriptor)) {
      throw new TypeError(`Property ${propertyLabel(key)} is an accessor; getter/setter spying is not supported`)
    }
    if (typeof descriptor.value !== "function") {
      throw new TypeError(`Property ${propertyLabel(key)} is not a function`)
    }
    if (owned && descriptor.configurable === false && descriptor.writable === false) {
      throw new TypeError(`Property ${propertyLabel(key)} is non-configurable and non-writable`)
    }
    if (!owned && !Object.isExtensible(target)) {
      throw new TypeError(`Target is not extensible; inherited property ${propertyLabel(key)} cannot be doubled`)
    }

    const double = createMockFunction(registered, nextInvocationOrder, callThrough ? descriptor.value : implementation)
    const replacement = owned ? {...descriptor, value: double} : {
      value: double,
      writable: descriptor.writable,
      enumerable: descriptor.enumerable,
      configurable: true
    }
    const restorable = /** @type {RestorableMockFunction} */ (/** @type {unknown} */ (double))
    /** @type {PropertyDoubleRecord} */
    const record = {target, key, descriptor, owned, implementation: restorable, active: true}
    let targetRecords = activeProperties.get(target)
    if (!targetRecords) {
      targetRecords = new Map()
      activeProperties.set(target, targetRecords)
    }
    targetRecords.set(key, record)
    propertyRecords.push(record)
    restorable.mockRestore = () => restore(record)
    try {
      Object.defineProperty(target, key, replacement)
    } catch (installationError) {
      try {
        restore(record)
      } catch (rollbackError) {
        throw new AggregateError(
          [installationError, rollbackError],
          `Failed to install and roll back property double ${propertyLabel(key)}`
        )
      }
      throw installationError
    }
    return restorable
  }

  /**
   * @template {object} T
   * @template {FunctionPropertyKey<T>} K
   * @param {T} target
   * @param {K} key
   * @returns {RestorableMockFunction<PropertyFunction<T, K>>}
   */
  function spyOn(target, key) {
    return /** @type {RestorableMockFunction<PropertyFunction<T, K>>} */ (
      /** @type {unknown} */ (replaceProperty(target, key, undefined, true))
    )
  }

  /**
   * @template {object} T
   * @template {FunctionPropertyKey<T>} K
   * @param {T} target
   * @param {K} key
   * @param {PropertyFunction<T, K>} [implementation]
   * @returns {RestorableMockFunction<PropertyFunction<T, K>>}
   */
  function stub(target, key, implementation) {
    return /** @type {RestorableMockFunction<PropertyFunction<T, K>>} */ (
      /** @type {unknown} */ (replaceProperty(target, key, implementation, false))
    )
  }

  return {
    fn,
    spyOn,
    stub,
    clearAll() { for (const implementation of registered) implementation.mockClear() },
    resetAll() { for (const implementation of registered) implementation.mockReset() },
    restoreAll() {
      const failures = []
      for (const record of [...propertyRecords].reverse()) {
        try { restore(record) } catch (error) { failures.push(error) }
      }
      if (failures.length) throw new AggregateError(failures, "Failed to restore all property doubles")
    }
  }
}

export const mock = createMockScope()
