// @ts-check

const JSON_STDOUT_CONSOLE_METHODS = ["log", "info", "debug"]

/** @param {import("../runner.js").TestResult} testResult @returns {string} */
export function formatTestResultLine(testResult) {
  const marker = testResult.status === "passed" ? "✓" : "✗"
  if (testResult.attempts.length === 0) return `${marker} ${testResult.fullName} (not run)`
  const durationMs = testResult.attempts.reduce((total, attempt) => total + attempt.durationMs, 0)
  const duration = durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(3)}s`
  return `${marker} ${testResult.fullName} (${duration})`
}

/**
 * Keeps live console output away from stdout while a JSON CLI run is active.
 * @template T
 * @param {() => T | Promise<T>} callback
 * @param {Pick<Console, "log" | "info" | "debug" | "error">} [target]
 * @returns {Promise<Awaited<T>>}
 */
export async function withJsonConsoleRouting(callback, target = console) {
  /** @type {Map<string, PropertyDescriptor>} */
  const descriptors = new Map()
  const writeError = target.error.bind(target)
  /** @param {...any} args */
  const routeToError = (...args) => writeError(...args)
  try {
    for (const method of JSON_STDOUT_CONSOLE_METHODS) {
      const descriptor = Object.getOwnPropertyDescriptor(target, method)
      if (!descriptor) throw new Error(`Cannot route console.${method}: property descriptor is missing`)
      descriptors.set(method, descriptor)
      Object.defineProperty(target, method, {
        ...descriptor,
        value: routeToError
      })
    }
    return await callback()
  } finally {
    for (const [method, descriptor] of descriptors) {
      Object.defineProperty(target, method, descriptor)
    }
  }
}
