#!/usr/bin/env node
// @ts-check

import {AsyncLocalStorage} from "node:async_hooks"
import fs from "node:fs/promises"

import {defaultTestContext} from "../context.js"
import {createConsoleReporter, createJsonReporter} from "../reporters.js"
import {installJsonStdoutRouting} from "./cli-output.js"
import {
  cliHelp,
  formatTestProfileSummary,
  mergeTestProfileTimingManifests,
  parseCliArguments,
  parseTimingManifestMergeArguments,
  resolveTestProfileOptions,
  runNodeTests,
  TestProfiler,
  writeTestProfileOutputs,
  writeTimingManifest
} from "./index.js"

function createJsonCliReporter() {
  const stdoutRouting = installJsonStdoutRouting()
  return createJsonReporter({write: (chunk) => { stdoutRouting.writeJson(chunk) }})
}

function createDefaultCliReporter() {
  return {
    /** @param {import("../runner.js").RunnerEvent} event */
    async onEvent(event) {
      const reporter = createConsoleReporter({
        write: (chunk) => { process.stdout.write(chunk) },
        writeError: (chunk) => { process.stderr.write(chunk) },
        failedConsoleOutputMaxLines: defaultTestContext.config.failedConsoleOutputMaxLines,
        colorize: false
      })
      await reporter.onEvent(event)
    }
  }
}

/** @param {string[]} argv @returns {Promise<void>} */
async function mergeTimingManifests(argv) {
  const {inputPaths, outputPath} = parseTimingManifestMergeArguments(argv, {cwd: process.cwd()})
  const inputs = []
  for (const inputPath of inputPaths) {
    let content
    try {
      content = await fs.readFile(inputPath, "utf8")
    } catch (error) {
      throw new Error(`Failed to read test profile: ${inputPath}`, {cause: error})
    }
    let profile
    try {
      profile = JSON.parse(content)
    } catch (error) {
      throw new Error(`Failed to parse test profile: ${inputPath}`, {cause: error})
    }
    inputs.push({profile, source: inputPath})
  }
  const timingManifest = mergeTestProfileTimingManifests(inputs)
  await writeTimingManifest({outputPath, timingManifest})
  process.stdout.write(
    `Merged ${inputPaths.length} test profile shards into ${outputPath} (${Object.keys(timingManifest).length} files)\n`
  )
}

/** @param {string[]} argv @returns {Promise<void>} */
async function runCli(argv) {
  if (argv[0] === "timing-manifest:merge") {
    await mergeTimingManifests(argv.slice(1))
    return
  }

  const options = parseCliArguments(argv)
  if (options.help) {
    process.stdout.write(cliHelp())
    return
  }

  const {reporter: reporterName = "default", ...parsedRunOptions} = options
  const json = reporterName === "json"
  const profileOptions = resolveTestProfileOptions({
    cwd: process.cwd(),
    profile: Boolean(options.profile),
    profileJsonPath: options.profileJsonPath,
    timingManifestPath: options.timingManifestPath,
    timingManifestOutputPath: options.timingManifestOutputPath
  })
  const profileStorage = new AsyncLocalStorage()
  const profiler = profileOptions.profile ? new TestProfiler({
    contextAdapter: {
      current: () => profileStorage.getStore(),
      run: (context, callback) => profileStorage.run(context, callback)
    },
    projectDirectory: process.cwd(),
    selection: {
      excludeTagCount: options.excludeTags.length,
      hasExampleFilters: options.examples.length > 0,
      includeTagCount: options.includeTags.length,
      pathBase: "configuration-directory",
      shard: options.groups !== undefined && options.groupNumber !== undefined
        ? {groups: options.groups, groupNumber: options.groupNumber}
        : undefined
    }
  }) : undefined
  const reporter = json ? createJsonCliReporter() : createDefaultCliReporter()
  let profileFinalized = false
  /** @type {Awaited<ReturnType<typeof runNodeTests>> | undefined} */
  let result

  /** @param {import("./test-profiler.js").TestProfileStatus} status */
  const finalizeProfile = async (status) => {
    if (!profiler || profileFinalized) return
    profileFinalized = true
    profiler.setSelection({
      excludeTagCount: options.excludeTags.length > 0
        ? options.excludeTags.length
        : defaultTestContext.config.excludeTags.length
    })
    const profile = profiler.finish({
      counts: {
        discovered: result ? result.counts.total + result.counts.skipped : 0,
        executed: result ? result.tests.filter((testResult) => testResult.attempts.length > 0).length : 0,
        failed: result?.counts.failed || 0,
        passed: result?.counts.passed || 0
      },
      focused: result?.focused || false,
      status
    })
    await writeTestProfileOutputs({
      profile,
      profileJsonPath: profileOptions.profileJsonPath,
      timingManifestOutputPath: profileOptions.timingManifestOutputPath
    })
    const summary = `${formatTestProfileSummary(profile, profileOptions)}\n`
    if (json) process.stderr.write(summary)
    else process.stdout.write(`\n${summary}`)
  }

  try {
    result = await runNodeTests({
      ...parsedRunOptions,
      excludeTags: parsedRunOptions.excludeTags.length > 0 ? parsedRunOptions.excludeTags : undefined,
      profiler,
      reporter,
      timingManifestPath: profileOptions.timingManifestPath
    })
    if (options.groups !== undefined && options.groupNumber !== undefined) {
      const message = `Running group ${options.groupNumber} of ${options.groups} (${result.files.length} files)\n`
      if (json) process.stderr.write(message)
      else process.stdout.write(message)
    }
    if (result.timingManifestCoverage) {
      const coverage = result.timingManifestCoverage
      const message = `Timing manifest coverage: measured=${coverage.measuredFiles} heuristic=${coverage.heuristicFiles} stale=${coverage.staleEntries}\n`
      if (json) process.stderr.write(message)
      else process.stdout.write(message)
    }
    await finalizeProfile(result.noMatches ? "no-tests" : result.status)
    process.exitCode = result.status === "passed" ? 0 : 1
  } catch (error) {
    try {
      await finalizeProfile("error")
    } catch (profileError) {
      throw new AggregateError([error, profileError], "Test command and profile finalization both failed", {cause: profileError})
    }
    throw error
  }
}

try {
  await runCli(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
