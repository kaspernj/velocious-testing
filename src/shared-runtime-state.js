// @ts-check

const RUNTIME_STATE_VERSION = 1
const RUNTIME_STATE_SYMBOL = Symbol.for("@velocious/testing.runtime-state.v1")

/**
 * @typedef {object} SharedRuntimeState
 * @property {1} version
 * @property {DateConstructor} RealDate
 * @property {() => number} realDateNow
 * @property {typeof globalThis.setTimeout} realSetTimeout
 * @property {typeof globalThis.clearTimeout} realClearTimeout
 * @property {(() => number) | undefined} realPerformanceNow
 * @property {WeakMap<object, object>} activeTimerTargets
 */

/** @param {any} value @returns {value is SharedRuntimeState} */
function isCompatibleRuntimeState(value) {
  if (!value || typeof value !== "object" || value.version !== RUNTIME_STATE_VERSION ||
    typeof value.RealDate !== "function" || typeof value.realDateNow !== "function" ||
    typeof value.realSetTimeout !== "function" || typeof value.realClearTimeout !== "function" ||
    (value.realPerformanceNow !== undefined && typeof value.realPerformanceNow !== "function")) return false
  try {
    WeakMap.prototype.has.call(value.activeTimerTargets, globalThis)
    return true
  } catch {
    return false
  }
}

// Narrows the realm object at the symbol-keyed internal compatibility boundary.
/** @type {Record<symbol, any>} */
const symbolRegistry = globalThis
const existing = symbolRegistry[RUNTIME_STATE_SYMBOL]
if (existing && !isCompatibleRuntimeState(existing)) {
  throw new Error(`Incompatible @velocious/testing runtime state: found version ${String(existing.version)}, expected version ${RUNTIME_STATE_VERSION}`)
}

/** @returns {SharedRuntimeState} */
function captureRuntimeState() {
  return Object.freeze({
    version: RUNTIME_STATE_VERSION,
    RealDate: Date,
    realDateNow: Date.now.bind(Date),
    realSetTimeout: globalThis.setTimeout.bind(globalThis),
    realClearTimeout: globalThis.clearTimeout.bind(globalThis),
    realPerformanceNow: typeof globalThis.performance?.now === "function" ?
      globalThis.performance.now.bind(globalThis.performance) : undefined,
    activeTimerTargets: new WeakMap()
  })
}

/** @type {SharedRuntimeState} */
export const sharedRuntimeState = existing || captureRuntimeState()
if (!existing) symbolRegistry[RUNTIME_STATE_SYMBOL] = sharedRuntimeState
