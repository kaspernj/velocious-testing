// @ts-check

import {sharedRuntimeState} from "./shared-runtime-state.js"

export const RealDate = sharedRuntimeState.RealDate
export const realDateNow = sharedRuntimeState.realDateNow
export const realSetTimeout = sharedRuntimeState.realSetTimeout
export const realClearTimeout = sharedRuntimeState.realClearTimeout

/** Returns time from the real monotonic clock captured before public fake timers can be installed. */
export function realMonotonicNow() {
  if (!sharedRuntimeState.realPerformanceNow) throw new Error("Test runner requires globalThis.performance.now as a real monotonic clock")
  return sharedRuntimeState.realPerformanceNow()
}
