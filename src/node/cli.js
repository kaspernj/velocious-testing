#!/usr/bin/env node
// @ts-check

import {cliHelp, parseCliArguments, runNodeTests} from "./index.js"
import {formatTestError, formatTestResultLine} from "./cli-output.js"
import {defaultTestContext} from "../context.js"

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

try {
  const options = parseCliArguments(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(cliHelp())
  } else {
    const result = await runNodeTests({...options, reporter: {onEvent: report}})
    for (const failure of result.errors) console.error(`${failure.phase} ${failure.suite}: ${formatTestError(failure.error)}`)
    console.log(`\n${result.counts.passed} passed, ${result.counts.failed} failed, ${result.counts.total} total${result.counts.notRun ? `, ${result.counts.notRun} not run` : ""}`)
    if (result.noMatches) console.error("No tests matched the requested selection.")
    process.exitCode = result.status === "passed" ? 0 : 1
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
