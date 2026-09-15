#!/usr/bin/env node
// @ts-check

import {cliHelp, parseCliArguments, runNodeTests} from "./index.js"
import {formatTestError, formatTestResultLine, installJsonStdoutRouting} from "./cli-output.js"
import {defaultTestContext} from "../context.js"
import {createJsonReporter} from "../reporters.js"

/** @param {any} event */
function report(event) {
  if (event.type === "test:not-run") {
    console.log(`- ${event.test.fullName} (not run: terminal resource failure in ${event.test.reason.fullName})`)
  }
  if (event.type === "test:finish") {
    console.log(formatTestResultLine(event.test))
    if (event.test.error) {
      console.error(formatTestError(event.test.error))
      const output = event.test.attempts.at(-1)?.consoleOutput?.trimEnd()
      if (output) console.error(output.split("\n").slice(-defaultTestContext.config.failedConsoleOutputMaxLines).join("\n"))
    }
  }
}

function createJsonCliReporter() {
  const stdoutRouting = installJsonStdoutRouting()
  return createJsonReporter({write: (chunk) => { stdoutRouting.writeJson(chunk) }})
}

try {
  const options = parseCliArguments(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(cliHelp())
  } else {
    const {reporter: reporterName = "default", ...runOptions} = options
    const json = reporterName === "json"
    const reporter = json ? createJsonCliReporter() : {onEvent: report}
    const execute = async () => {
      const result = await runNodeTests({...runOptions, reporter})
      if (!json) {
        for (const failure of result.errors) console.error(`${failure.phase} ${failure.suite}: ${formatTestError(failure.error)}`)
        console.log(`\n${result.counts.passed} passed, ${result.counts.failed} failed, ${result.counts.total} total${result.counts.notRun ? `, ${result.counts.notRun} not run` : ""}`)
        if (result.noMatches) console.error("No tests matched the requested selection.")
      }
      process.exitCode = result.status === "passed" ? 0 : 1
    }
    await execute()
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
