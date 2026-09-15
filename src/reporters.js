// @ts-check

/** @typedef {{write: (chunk: string) => void | Promise<void>}} JsonReporterOptions */
/**
 * @typedef {object} ConsoleReporterOptions
 * @property {(chunk: string) => void | Promise<void>} write
 * @property {(chunk: string) => void | Promise<void>} writeError
 * @property {number} [failedConsoleOutputMaxLines]
 * @property {boolean} [colorize]
 */
/** @typedef {{fullName: string, durationMs: number, filePath?: string, line?: number}} SlowTestResult */

/**
 * Creates a reporter that writes one compact JSON result for every finished run.
 * @param {JsonReporterOptions} options
 * @returns {import("./runner.js").Reporter}
 */
export function createJsonReporter({write}) {
  return {
    async onEvent(event) {
      if (event.type !== "run:finish") return
      await write(`${JSON.stringify(event.result)}\n`)
    }
  }
}

/** @param {import("./runner.js").TestResult} testResult @returns {string} */
export function formatTestResultLine(testResult) {
  const marker = testResult.status === "passed" ? "✓" : "✗"
  if (testResult.attempts.length === 0) return `${marker} ${testResult.fullName} (not run)`
  const durationMs = testResult.attempts.reduce((total, attempt) => total + attempt.durationMs, 0)
  const duration = durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(3)}s`
  return `${marker} ${testResult.fullName} (${duration})`
}

/**
 * @param {import("./runner.js").TestErrorRecord} error
 * @param {Set<import("./runner.js").TestErrorRecord>} [ancestors]
 * @returns {string}
 */
export function formatTestError(error, ancestors = new Set()) {
  if (ancestors.has(error)) return `${error.name}: [Circular error reference]`
  const nextAncestors = new Set(ancestors)
  nextAncestors.add(error)
  const parts = [error.stack || `${error.name}: ${error.message}`]
  if (error.cause) parts.push(`Caused by: ${formatTestError(error.cause, nextAncestors)}`)
  for (const child of error.errors || []) parts.push(`Related failure: ${formatTestError(child, nextAncestors)}`)
  return parts.join("\n")
}

/** @param {import("./runner.js").Reporter[]} reporters @returns {import("./runner.js").Reporter} */
export function composeReporters(reporters) {
  return {
    async onEvent(event) {
      for (const reporter of reporters) await reporter.onEvent(event)
    }
  }
}

/** @param {string} value @param {"green" | "red"} color @param {boolean} colorize @returns {string} */
function withColor(value, color, colorize) {
  if (!colorize) return value
  const code = color === "green" ? 32 : 31
  return `\u001b[${code}m${value}\u001b[39m`
}

/** @param {string} output @param {number} maxLines @returns {string} */
function boundedConsoleOutput(output, maxLines) {
  if (maxLines === 0) return ""
  const lines = output.trimEnd().split("\n")
  return lines.slice(-maxLines).join("\n")
}

/**
 * Creates a browser-safe human reporter around caller-owned writers.
 * @param {ConsoleReporterOptions} options
 * @returns {import("./runner.js").Reporter}
 */
export function createConsoleReporter({write, writeError, failedConsoleOutputMaxLines = 200, colorize = false}) {
  const maxLines = Number.isFinite(failedConsoleOutputMaxLines)
    ? Math.max(0, Math.floor(failedConsoleOutputMaxLines))
    : 200
  return {
    async onEvent(event) {
      if (event.type === "test:not-run") {
        await write(`- ${event.test.fullName} (not run: terminal resource failure in ${event.test.reason.fullName})\n`)
        return
      }
      if (event.type === "test:finish") {
        const line = formatTestResultLine(event.test)
        await write(`${withColor(line, event.test.status === "passed" ? "green" : "red", colorize)}\n`)
        if (event.test.error) {
          await writeError(`${withColor(formatTestError(event.test.error), "red", colorize)}\n`)
          const output = boundedConsoleOutput(event.test.attempts.at(-1)?.consoleOutput || "", maxLines)
          if (output) await writeError(`${output}\n`)
        }
        return
      }
      if (event.type !== "run:finish") return
      for (const failure of event.result.errors) {
        await writeError(`${failure.phase} ${failure.suite}: ${formatTestError(failure.error)}\n`)
      }
      const {counts} = event.result
      await write(`\n${counts.passed} passed, ${counts.failed} failed, ${counts.total} total${counts.notRun ? `, ${counts.notRun} not run` : ""}\n`)
      if (event.result.noMatches) await writeError("No tests matched the requested selection.\n")
    }
  }
}

/**
 * @param {import("./runner.js").TestRunResult} runResult
 * @param {{limit: number}} options
 * @returns {SlowTestResult[]}
 */
export function slowestTestResults(runResult, {limit}) {
  const results = runResult.tests
    .filter((testResult) => testResult.attempts.length > 0)
    .map((testResult) => ({
      fullName: testResult.fullName,
      durationMs: testResult.attempts.reduce((total, attempt) => total + attempt.durationMs, 0),
      ...(testResult.location.filePath ? {filePath: testResult.location.filePath} : {}),
      ...(testResult.location.line !== undefined ? {line: testResult.location.line} : {})
    }))
    .sort((resultA, resultB) => resultB.durationMs - resultA.durationMs)
  return limit > 0 ? results.slice(0, limit) : results
}
