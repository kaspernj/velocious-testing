// @ts-check

export const RealDate = Date
export const realDateNow = Date.now.bind(Date)
export const realSetTimeout = globalThis.setTimeout.bind(globalThis)
export const realClearTimeout = globalThis.clearTimeout.bind(globalThis)

const capturedPerformanceNow = typeof globalThis.performance?.now === "function" ?
  globalThis.performance.now.bind(globalThis.performance) : undefined

/** Returns time from the real monotonic clock captured before public fake timers can be installed. */
export function realMonotonicNow() {
  if (!capturedPerformanceNow) throw new Error("Test runner requires globalThis.performance.now as a real monotonic clock")
  return capturedPerformanceNow()
}
