// @ts-check

import {defaultTestContext, normalizeTags, PROTOCOL_MAJOR} from "./context.js"

export {PROTOCOL_MAJOR}

/** @typedef {"log" | "info" | "warn" | "error" | "debug"} ConsoleMethod */
/** @typedef {import("./context.js").TestContext} TestContext */
/** @typedef {import("./context.js").SuiteDeclaration} SuiteDeclaration */
/** @typedef {import("./context.js").TestDeclaration} TestDeclaration */
/** @typedef {{name: string, message: string, stack?: string, errors?: TestErrorRecord[]}} TestErrorRecord */
/** @typedef {{attemptNumber: number, durationMs: number, consoleOutput: string, error?: TestErrorRecord}} TestAttemptResult */
/** @typedef {{fullName: string, status: "passed" | "failed", attempts: TestAttemptResult[], location: import("./context.js").DeclarationLocation, tags?: string[], error?: TestErrorRecord}} TestResult */
/** @typedef {{total: number, passed: number, failed: number, skipped: number}} TestRunCounts */
/** @typedef {{protocolMajor: number, status: "passed" | "failed", noMatches: boolean, counts: TestRunCounts, tests: TestResult[], errors: Array<{phase: string, suite: string, error: TestErrorRecord}>}} TestRunResult */
/** @typedef {{protocolMajor: number, timestamp: number, type: string, [key: string]: any}} RunnerEvent */
/** @typedef {{onEvent: (event: RunnerEvent) => void}} Reporter */
/** @typedef {{failed: false} | {failed: true, error: any}} FailureState */
/**
 * @typedef {object} AttemptExecutorInput
 * @property {TestContext} context
 * @property {SuiteDeclaration} suite
 * @property {TestDeclaration} test
 * @property {number} attemptNumber
 * @property {import("./context.js").HookDeclaration[]} beforeEach
 * @property {import("./context.js").HookDeclaration[]} afterEach
 * @property {any[]} args
 * @property {number} timeoutMs
 * @property {string} fullName
 * @property {() => Promise<void>} defaultExecute
 */
/** @typedef {(input: AttemptExecutorInput) => any | Promise<any>} AttemptExecutor */
/** @typedef {(input: {context: TestContext, suite: SuiteDeclaration, test: TestDeclaration, attemptNumber: number}) => any[] | Promise<any[]>} TestArgumentResolver */
/**
 * @typedef {object} TestRunnerOptions
 * @property {TestContext} [context]
 * @property {string[] | string} [includeTags]
 * @property {string[] | string} [excludeTags]
 * @property {RegExp[]} [examples]
 * @property {Record<string, number[]>} [lineFilters]
 * @property {boolean} [ignoreFocus]
 * @property {number} [retries]
 * @property {number} [timeoutMs]
 * @property {AttemptExecutor} [attemptExecutor]
 * @property {TestArgumentResolver} [testArgumentResolver]
 * @property {Reporter} [reporter]
 */
/** @type {ConsoleMethod[]} */
const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"]

/** @param {any} error @returns {TestErrorRecord} */
function errorRecord(error) {
  if (error instanceof Error) {
    /** @type {TestErrorRecord} */
    const record = {name: error.name, message: error.message, stack: error.stack}
    if (error instanceof AggregateError) record.errors = error.errors.map(errorRecord)
    return record
  }
  return {name: "Error", message: String(error)}
}

/** @param {any} error @returns {any[]} */
function flattenFailures(error) {
  return error instanceof AggregateError && error.errors.length ? error.errors.flatMap(flattenFailures) : [error]
}

/** @param {FailureState} primary @param {any[]} cleanupFailures @param {string} label @returns {FailureState} */
function aggregateFailures(primary, cleanupFailures, label) {
  const failures = [
    ...(primary.failed ? flattenFailures(primary.error) : []),
    ...cleanupFailures.flatMap(flattenFailures)
  ]
  if (failures.length === 0) return {failed: false}
  if (failures.length === 1) return {failed: true, error: failures[0]}
  const message = primary.failed ?
    primary.error instanceof Error ? primary.error.message : String(primary.error) :
    `Multiple ${label} failures`
  return {failed: true, error: new AggregateError(failures, message)}
}

/** @param {any} value @returns {string} */
function consoleValue(value) {
  if (typeof value === "string") return value
  try { return JSON.stringify(value) } catch { return String(value) }
}

/** @param {() => Promise<any>} callback @param {boolean} [live] @returns {Promise<({status: "completed", value: any} | {status: "failed", error: any}) & {output: string}>} */
async function captureConsole(callback, live = false) {
  /** @type {Partial<Record<ConsoleMethod, (...args: any[]) => void>>} */
  const original = {}
  /** @type {string[]} */
  const lines = []
  // Narrows the selected standard console methods to a writable record.
  /** @type {Record<ConsoleMethod, (...args: any[]) => void>} */
  const capturedConsole = console
  for (const method of CONSOLE_METHODS) {
    original[method] = capturedConsole[method]
    capturedConsole[method] = (...args) => {
      lines.push(args.map(consoleValue).join(" "))
      if (live) /** @type {(...args: any[]) => void} */ (original[method])(...args)
    }
  }
  try {
    return {status: "completed", value: await callback(), output: lines.join("\n") + (lines.length ? "\n" : "")}
  } catch (error) {
    return {status: "failed", error, output: lines.join("\n") + (lines.length ? "\n" : "")}
  } finally {
    for (const method of CONSOLE_METHODS) capturedConsole[method] = /** @type {(...args: any[]) => void} */ (original[method])
  }
}

/** @param {Promise<any>} promise @param {number} timeoutMs @param {string} name @returns {Promise<any>} */
function withTimeout(promise, timeoutMs, name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms: ${name}`)), timeoutMs)
    promise.then((value) => { clearTimeout(timer); resolve(value) }, (error) => { clearTimeout(timer); reject(error) })
  })
}

/** @param {any[]} hooks @param {any[]} args @param {number} [timeoutMs] @param {string} [name] @returns {Promise<void>} */
async function runHooks(hooks, args, timeoutMs, name) {
  for (const hook of hooks) {
    if (timeoutMs === undefined) await hook.callback(...args)
    else await runLifecycleCallback(hook.callback, args, timeoutMs, name || "lifecycle hook")
  }
}

/** @param {any[]} hooks @param {any[]} args @param {number} timeoutMs @param {string} name @returns {Promise<any[]>} */
async function collectCleanupFailures(hooks, args, timeoutMs, name) {
  const failures = []
  for (const hook of hooks) {
    try {
      await runLifecycleCallback(hook.callback, args, timeoutMs, name)
    } catch (error) {
      failures.push(error)
    }
  }
  return failures
}

/** @param {Function} callback @param {any[]} args @param {number} timeoutMs @param {string} name @returns {Promise<any>} */
async function runLifecycleCallback(callback, args, timeoutMs, name) {
  return await withTimeout(Promise.resolve().then(() => callback(...args)), timeoutMs, name)
}

/** @param {Omit<AttemptExecutorInput, "defaultExecute" | "context" | "suite" | "attemptNumber">} input @returns {Promise<void>} */
export async function defaultAttemptExecutor(input) {
  /** @type {FailureState} */
  let primary = {failed: false}
  try {
    for (const hook of input.beforeEach) {
      await runLifecycleCallback(hook.callback, input.args, input.timeoutMs, input.fullName)
    }
    await runLifecycleCallback(input.test.callback, input.args, input.timeoutMs, input.fullName)
  } catch (error) {
    primary = {failed: true, error}
  }
  const cleanupFailures = await collectCleanupFailures(
    [...input.afterEach].reverse(), input.args, input.timeoutMs, input.fullName
  )
  const failure = aggregateFailures(primary, cleanupFailures, "afterEach")
  if (failure.failed) throw failure.error
}

/**
 * Enforces the timeout for custom executors while allowing a default lifecycle
 * that already timed out a short window to finish its cleanup hooks.
 * @param {Promise<any>} promise
 * @param {number} timeoutMs
 * @param {string} name
 * @param {() => boolean} defaultInvoked
 * @returns {Promise<any>}
 */
function withExecutorTimeout(promise, timeoutMs, name, defaultInvoked) {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer = setTimeout(onTimeout, timeoutMs)
    function onTimeout() {
      if (settled) return
      if (defaultInvoked()) {
        timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms: ${name}`)), 100)
      } else {
        reject(new Error(`Timed out after ${timeoutMs}ms: ${name}`))
      }
    }
    promise.then((value) => {
      settled = true
      clearTimeout(timer)
      resolve(value)
    }, (error) => {
      settled = true
      clearTimeout(timer)
      reject(error)
    })
  })
}

/** @param {any} suite @returns {boolean} */
function hasFocus(suite) {
  return suite.focus || suite.tests.some((/** @type {any} */ entry) => entry.focus) || suite.suites.some(hasFocus)
}

/** @param {any} suite @param {any[]} ancestors @param {any[]} output */
function flatten(suite, ancestors, output) {
  const lineage = [...ancestors, suite]
  for (const test of suite.tests) output.push({suite, test, lineage, fullName: [...lineage.map((entry) => entry.name), test.name].join(" ")})
  for (const child of suite.suites) flatten(child, lineage, output)
}

/** @param {Record<string, number[]>} filters @param {any} entry @returns {boolean} */
function matchesLine(filters, entry) {
  const keys = Object.keys(filters)
  if (!keys.length) return true
  const declarations = [...entry.lineage, entry.test]
  return declarations.some((declaration) => {
    const filePath = declaration.location?.filePath
    const line = declaration.location?.line
    return filePath && line !== undefined && (filters[filePath] || []).includes(line)
  })
}

/** @param {RegExp} expression @param {string} value @returns {boolean} */
function matchesExpression(expression, value) {
  return new RegExp(expression.source, expression.flags).test(value)
}

export class TestRunner {
  /** @param {TestRunnerOptions} [options] */
  constructor(options = {}) {
    this.options = options
    this.context = options.context || defaultTestContext
    if (this.context.protocolMajor !== PROTOCOL_MAJOR) throw new Error(`Unsupported test context protocol major: ${this.context.protocolMajor}`)
    this.attemptExecutor = options.attemptExecutor || ((input) => defaultAttemptExecutor(input))
    this.testArgumentResolver = options.testArgumentResolver || (() => [])
    this.reporter = options.reporter || {onEvent() {}}
  }

  /** @private @param {Omit<RunnerEvent, "protocolMajor" | "timestamp">} event @returns {void} */
  emit(event) {
    const structured = /** @type {RunnerEvent} */ ({protocolMajor: PROTOCOL_MAJOR, timestamp: Date.now(), ...event})
    this.context.events.emit("runner", structured)
    this.reporter.onEvent(structured)
  }

  /** @returns {Promise<TestRunResult>} */
  async run() {
    /** @type {any[]} */
    const all = []
    for (const suite of this.context.registry.suites) flatten(suite, [], all)
    const focused = this.context.registry.suites.some((/** @type {any} */ suite) => hasFocus(suite))
    const include = new Set(normalizeTags(this.options.includeTags))
    const exclude = new Set(normalizeTags(this.options.excludeTags ?? this.context.config.excludeTags))
    const examples = this.options.examples || []
    const selected = all.filter((/** @type {any} */ entry) => {
      const tags = new Set(entry.test.tags)
      if (focused && !this.options.ignoreFocus && !entry.test.focus && !entry.lineage.some((/** @type {any} */ suite) => suite.focus)) return false
      if (include.size && ![...include].every((tag) => tags.has(tag))) return false
      if ([...exclude].some((tag) => tags.has(tag))) return false
      if (examples.length && !examples.some((/** @type {RegExp} */ pattern) => matchesExpression(pattern, entry.fullName))) return false
      return matchesLine(this.options.lineFilters || {}, entry)
    })
    /** @type {TestRunResult} */
    const result = {
      protocolMajor: PROTOCOL_MAJOR,
      status: "passed",
      noMatches: selected.length === 0,
      counts: {total: selected.length, passed: 0, failed: 0, skipped: all.length - selected.length},
      tests: [],
      errors: []
    }
    this.emit({type: "run:start", total: selected.length})
    const selectedSet = new Set(selected.map((entry) => entry.test))
    for (const suite of this.context.registry.suites) await this.runSuite(suite, [], selectedSet, result)
    if (result.counts.failed || result.noMatches) result.status = "failed"
    this.emit({type: "run:finish", result})
    return result
  }

  /** @private @param {SuiteDeclaration} suite @param {SuiteDeclaration[]} ancestors @param {Set<TestDeclaration>} selected @param {TestRunResult} result @returns {Promise<void>} */
  async runSuite(suite, ancestors, selected, result) {
    /** @type {any[]} */
    const descendants = []
    flatten(suite, ancestors, descendants)
    const selectedDescendants = descendants.filter((entry) => selected.has(entry.test))
    if (!selectedDescendants.length) return
    const lineage = [...ancestors, suite]
    const timeoutMs = suite.options.timeoutMs ?? (suite.options.timeoutSeconds !== undefined ? suite.options.timeoutSeconds * 1000 : undefined) ?? this.options.timeoutMs ?? this.context.config.defaultTimeoutMs
    /** @type {FailureState} */
    let beforeAll = {failed: false}
    try { await runHooks(suite.hooks.beforeAll, [], timeoutMs, `${suite.name} beforeAll`) } catch (error) { beforeAll = {failed: true, error} }
    if (beforeAll.failed) {
      for (const entry of selectedDescendants) this.recordSetupFailure(entry, beforeAll.error, result)
    } else {
      const beforeEach = lineage.flatMap((entry) => entry.hooks.beforeEach)
      const afterEach = lineage.flatMap((entry) => entry.hooks.afterEach)
      for (const test of suite.tests) {
        if (selected.has(test)) await this.runTest({suite, test, lineage, fullName: [...lineage.map((entry) => entry.name), test.name].join(" ")}, beforeEach, afterEach, result)
      }
      for (const child of suite.suites) await this.runSuite(child, lineage, selected, result)
    }
    const afterAllFailures = await collectCleanupFailures(
      [...suite.hooks.afterAll].reverse(), [], timeoutMs, `${suite.name} afterAll`
    )
    const afterAll = aggregateFailures({failed: false}, afterAllFailures, "afterAll")
    if (afterAll.failed) {
      const error = afterAll.error
      result.errors.push({phase: "afterAll", suite: suite.name, error: errorRecord(error)})
      result.status = "failed"
    }
  }

  /** @private @param {any} entry @param {any} error @param {TestRunResult} result */
  recordSetupFailure(entry, error, result) {
    /** @type {TestResult} */
    const record = {fullName: entry.fullName, status: "failed", attempts: [], error: errorRecord(error), location: entry.test.location}
    result.tests.push(record)
    result.counts.failed += 1
    this.emit({type: "test:finish", test: record})
  }

  /** @private @param {any} entry @param {import("./context.js").HookDeclaration[]} beforeEach @param {import("./context.js").HookDeclaration[]} afterEach @param {TestRunResult} result @returns {Promise<void>} */
  async runTest(entry, beforeEach, afterEach, result) {
    const retries = entry.test.options.retries ?? entry.test.options.retry ?? this.options.retries ?? this.context.config.retries
    const timeoutMs = entry.test.options.timeoutMs ?? (entry.test.options.timeoutSeconds !== undefined ? entry.test.options.timeoutSeconds * 1000 : undefined) ?? this.options.timeoutMs ?? this.context.config.defaultTimeoutMs
    /** @type {any} */
    const record = {fullName: entry.fullName, status: "failed", attempts: [], location: entry.test.location, tags: entry.test.tags}
    this.emit({type: "test:start", fullName: entry.fullName})
    for (let attemptNumber = 1; attemptNumber <= retries + 1; attemptNumber += 1) {
      const argsValue = await this.testArgumentResolver({context: this.context, suite: entry.suite, test: entry.test, attemptNumber})
      const args = Array.isArray(argsValue) ? argsValue : [argsValue]
      const startedAt = Date.now()
      const captured = await captureConsole(async () => {
        const input = {context: this.context, suite: entry.suite, test: entry.test, attemptNumber, beforeEach, afterEach, args, timeoutMs, fullName: entry.fullName}
        let defaultInvoked = false
        const execution = Promise.resolve(this.attemptExecutor({...input, defaultExecute: () => {
          defaultInvoked = true
          return defaultAttemptExecutor(input)
        }}))
        if (!this.options.attemptExecutor) return await execution
        return await withExecutorTimeout(execution, timeoutMs, entry.fullName, () => defaultInvoked)
      }, this.context.config.consoleOutput === "live")
      const attempt = {
        attemptNumber,
        durationMs: Date.now() - startedAt,
        consoleOutput: captured.output,
        error: captured.status === "failed" ? errorRecord(captured.error) : undefined
      }
      record.attempts.push(attempt)
      this.emit({type: "attempt:finish", fullName: entry.fullName, attempt})
      if (captured.status === "completed") {
        record.status = "passed"
        delete record.error
        result.counts.passed += 1
        break
      }
      record.error = errorRecord(captured.error)
    }
    if (record.status === "failed") result.counts.failed += 1
    result.tests.push(record)
    this.emit({type: "test:finish", test: record})
  }
}

/** @param {TestRunnerOptions} [options] @returns {Promise<TestRunResult>} */
export async function runTests(options = {}) { return await new TestRunner(options).run() }
