// @ts-check

/** @param {import("../runner.js").TestResult} testResult @returns {string} */
export function formatTestResultLine(testResult) {
  const marker = testResult.status === "passed" ? "✓" : "✗"
  if (testResult.attempts.length === 0) return `${marker} ${testResult.fullName} (not run)`
  const durationMs = testResult.attempts.reduce((total, attempt) => total + attempt.durationMs, 0)
  const duration = durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(3)}s`
  return `${marker} ${testResult.fullName} (${duration})`
}
