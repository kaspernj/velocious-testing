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
 * Routes stdout-bound console methods to the current error sink until restored.
 * @param {Pick<Console, "log" | "info" | "debug" | "error">} [target]
 * @returns {() => void}
 */
export function installJsonConsoleRouting(target = console) {
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
  } catch (error) {
    for (const [method, descriptor] of descriptors) {
      Object.defineProperty(target, method, descriptor)
    }
    throw error
  }
  let active = true
  return () => {
    if (!active) return
    active = false
    for (const [method, descriptor] of descriptors) {
      Object.defineProperty(target, method, descriptor)
    }
  }
}

/**
 * Reserves the current stdout writer and routes subsequent stream writes to stderr.
 * @param {NodeJS.WriteStream} [stdout]
 * @param {NodeJS.WriteStream} [stderr]
 * @returns {{writeJson: NodeJS.WriteStream["write"], restore: () => void}}
 */
export function installJsonStdoutRouting(stdout = process.stdout, stderr = process.stderr) {
  const descriptor = Object.getOwnPropertyDescriptor(stdout, "write")
  const writeJson = /** @type {NodeJS.WriteStream["write"]} */ (stdout.write.bind(stdout))
  const routeToError = /** @type {NodeJS.WriteStream["write"]} */ (stderr.write.bind(stderr))
  Object.defineProperty(stdout, "write", {
    configurable: true,
    enumerable: descriptor?.enumerable ?? false,
    value: routeToError,
    writable: true
  })
  let active = true
  return {
    writeJson,
    restore() {
      if (!active) return
      active = false
      if (descriptor) Object.defineProperty(stdout, "write", descriptor)
      else if (!Reflect.deleteProperty(stdout, "write")) throw new Error("Cannot restore stdout.write")
    }
  }
}

/**
 * Keeps live console output away from stdout while a JSON operation is active.
 * @template T
 * @param {() => T | Promise<T>} callback
 * @param {Pick<Console, "log" | "info" | "debug" | "error">} [target]
 * @returns {Promise<Awaited<T>>}
 */
export async function withJsonConsoleRouting(callback, target = console) {
  const restore = installJsonConsoleRouting(target)
  try {
    return await callback()
  } finally {
    restore()
  }
}
