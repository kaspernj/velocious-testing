import {
  composeReporters,
  createConsoleReporter,
  createJsonReporter,
  formatTestError,
  formatTestResultLine,
  slowestTestResults,
  type ConsoleReporterOptions,
  type JsonReporterOptions,
  type SlowTestResult
} from "../../build/reporters.js"
import type {Reporter} from "../../build/runner.js"

const chunks: string[] = []
const options: JsonReporterOptions = {write: async (chunk) => { chunks.push(chunk) }}
const reporter: Reporter = createJsonReporter(options)

await reporter.onEvent({protocolMajor: 1, timestamp: 1, type: "run:start"})

void chunks

const consoleOptions: ConsoleReporterOptions = {
  write: (chunk) => { chunks.push(chunk) },
  writeError: (chunk) => { chunks.push(chunk) },
  failedConsoleOutputMaxLines: 20,
  colorize: false
}
const consoleReporter: Reporter = createConsoleReporter(consoleOptions)
const composed: Reporter = composeReporters([reporter, consoleReporter])
const slow: SlowTestResult[] = slowestTestResults({
  protocolMajor: 1,
  status: "passed",
  noMatches: false,
  counts: {total: 0, passed: 0, failed: 0, skipped: 0},
  tests: [],
  nonRunTests: [],
  errors: []
}, {limit: 10})
void composed
void slow
void formatTestResultLine
void formatTestError

// @ts-expect-error A JSON reporter requires a writer.
createJsonReporter({})

// @ts-expect-error Writers receive serialized strings.
createJsonReporter({write: (chunk: number) => { void chunk }})
