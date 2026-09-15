// @ts-check

import path from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"

import {defaultTestContext} from "../context.js"
import {runTests} from "../runner.js"
import {normalizeExamplePatterns} from "./cli-arguments.js"
import {discoverTestFiles, lineFiltersFromCandidates, parsePathLine} from "./discovery.js"
import {loadTimingManifest} from "./test-profile-output.js"
import {TestSuiteSplitter} from "./test-suite-splitter.js"
import {timingManifestFileSetHash} from "./timing-manifest.js"

/** @typedef {import("./cli-arguments.js").CliOptions} CliOptions */
/** @typedef {import("./cli-arguments.js").TestCliArgumentExtraction} TestCliArgumentExtraction */
/** @typedef {import("./discovery.js").TestDiscoveryOptions} TestDiscoveryOptions */
/** @typedef {import("./discovery.js").TestLineFilters} TestLineFilters */
/** @typedef {import("./test-suite-splitter.js").TimingManifestCoverage} TimingManifestCoverage */
/** @typedef {import("./timing-manifest.js").TimingManifest} TimingManifest */
/** @typedef {import("./timing-manifest.js").TestProfileTimingManifestInput} TestProfileTimingManifestInput */
/** @typedef {import("./timing-manifest-merge.js").TimingManifestMergeArguments} TimingManifestMergeArguments */
/** @typedef {import("./test-profiler.js").ProfileActionAggregate} ProfileActionAggregate */
/** @typedef {import("./test-profiler.js").ProfileContextAdapter} ProfileContextAdapter */
/** @typedef {import("./test-profiler.js").ProfileDatabaseAggregate} ProfileDatabaseAggregate */
/** @typedef {import("./test-profiler.js").ProfilePoolAggregate} ProfilePoolAggregate */
/** @typedef {import("./test-profiler.js").TestProfileAsyncContext} TestProfileAsyncContext */
/** @typedef {import("./test-profiler.js").TestProfileAttemptHandle} TestProfileAttemptHandle */
/** @typedef {import("./test-profiler.js").TestProfileAttemptRecord} TestProfileAttemptRecord */
/** @typedef {import("./test-profiler.js").TestProfileAttemptStatus} TestProfileAttemptStatus */
/** @typedef {import("./test-profiler.js").TestProfileCpuAggregate} TestProfileCpuAggregate */
/** @typedef {import("./test-profiler.js").TestProfileDatabase} TestProfileDatabase */
/** @typedef {import("./test-profiler.js").TestProfileDocument} TestProfileDocument */
/** @typedef {import("./test-profiler.js").TestProfileFileAggregate} TestProfileFileAggregate */
/** @typedef {import("./test-profiler.js").TestProfilePhaseAggregate} TestProfilePhaseAggregate */
/** @typedef {import("./test-profiler.js").TestProfileQueryFingerprint} TestProfileQueryFingerprint */
/** @typedef {import("./test-profiler.js").TestProfileScope} TestProfileScope */
/** @typedef {import("./test-profiler.js").TestProfileSelection} TestProfileSelection */
/** @typedef {import("./test-profiler.js").TestProfileShard} TestProfileShard */
/** @typedef {import("./test-profiler.js").TestProfileSpan} TestProfileSpan */
/** @typedef {import("./test-profiler.js").TestProfileStatus} TestProfileStatus */
/** @typedef {import("./test-profiler.js").TestProfileTestRecord} TestProfileTestRecord */
/** @typedef {import("./test-profile-output.js").ResolvedTestProfileOptions} ResolvedTestProfileOptions */
/** @typedef {import("./test-profile-output.js").TestProfileOptions} TestProfileOptions */
/** @typedef {import("./test-profile-output.js").TestProfileOutputOptions} TestProfileOutputOptions */
/** @typedef {import("./test-profile-output.js").TestProfileSummaryOutputs} TestProfileSummaryOutputs */

export {extractTestCliArguments, normalizeExamplePatterns, parseCliArguments} from "./cli-arguments.js"
export {discoverTestFiles, lineFiltersFromCandidates, parsePathLine} from "./discovery.js"
export {TestSuiteSplitter} from "./test-suite-splitter.js"
export {parseTimingManifestMergeArguments} from "./timing-manifest-merge.js"
export {default as TestProfiler, roundProfileDuration} from "./test-profiler.js"
export {
  formatTestProfileSummary,
  loadTimingManifest,
  resolveTestProfileOptions,
  timingManifestFromProfile,
  writeTestProfileOutputs,
  writeTimingManifest
} from "./test-profile-output.js"
export {
  canonicalTimingManifestPath,
  compareTimingManifestPaths,
  mergeTestProfileTimingManifests,
  timingManifestFileSetHash,
  validateTimingManifest
} from "./timing-manifest.js"

const DECLARATION_INTERNAL_PATHS = new Set([
  fileURLToPath(import.meta.url),
  fileURLToPath(new URL("../context.js", import.meta.url))
].map((filePath) => path.resolve(filePath)))
let importSequence = 0

/**
 * @typedef {Omit<import("../runner.js").TestRunnerOptions, "examples"> & {
 *   cwd?: string,
 *   candidates?: string[],
 *   examples?: Array<string | RegExp>,
 *   setupFiles?: string[],
 *   importer?: (filePath: string) => any | Promise<any>,
 *   directories?: string[],
 *   filePattern?: RegExp,
 *   ignoredNames?: string[],
 *   groups?: number,
 *   groupNumber?: number,
 *   timingManifest?: Record<string, number>,
 *   timingManifestPath?: string,
 *   profiler?: import("./test-profiler.js").default
 * }} RunNodeTestsOptions
 */
/** @typedef {import("../runner.js").TestRunResult & {files: string[], focused: boolean, timingManifestCoverage?: TimingManifestCoverage}} RunNodeTestResult */

/**
 * @param {import("../context.js").SuiteDeclaration[]} suites
 * @param {boolean} [ancestorFocused]
 * @returns {boolean}
 */
function hasFocusedDeclarations(suites, ancestorFocused = false) {
  return suites.some((suite) => {
    const focused = ancestorFocused || suite.focus
    return suite.tests.some((test) => test.state === "run" && (focused || test.focus)) ||
      hasFocusedDeclarations(suite.suites, focused)
  })
}

/** @param {TestLineFilters[]} sources @returns {TestLineFilters} */
function mergeLineFilters(sources) {
  /** @type {TestLineFilters} */
  const merged = {}
  for (const source of sources) {
    for (const [filePath, sourceLines] of Object.entries(source)) {
      const lines = merged[filePath] ||= []
      for (const line of sourceLines) {
        if (!lines.includes(line)) lines.push(line)
      }
      lines.sort((lineA, lineB) => lineA - lineB)
    }
  }
  return merged
}

/**
 * @param {import("./test-profiler.js").default} profiler
 * @param {import("../context.js").SuiteDeclaration[]} lineage
 * @param {WeakMap<object, string>} declarationOwnerPaths
 * @returns {string | undefined}
 */
function profileScopeId(profiler, lineage, declarationOwnerPaths) {
  /** @type {string | undefined} */
  let parentId
  const descriptions = []
  for (const suite of lineage) {
    descriptions.push(suite.name)
    parentId = profiler.scopeId(suite, {
      descriptions: [...descriptions],
      filePath: declarationOwnerPaths.get(suite) ?? suite.location.filePath,
      line: suite.location.line,
      parentId
    })
  }
  return parentId
}

/**
 * Instruments the existing lifecycle callbacks without reimplementing their ordering, cleanup, or timeout behavior.
 * @param {import("../context.js").SuiteDeclaration[]} suites
 * @param {import("./test-profiler.js").default} profiler
 * @param {WeakMap<object, string>} declarationOwnerPaths
 * @param {import("../context.js").SuiteDeclaration[]} [ancestors]
 * @returns {() => void}
 */
function instrumentProfileLifecycle(suites, profiler, declarationOwnerPaths, ancestors = []) {
  /** @type {Array<() => void>} */
  const restorations = []
  for (const suite of suites) {
    const lineage = [...ancestors, suite]
    for (const phase of /** @type {const} */ (["beforeAll", "beforeEach", "afterEach", "afterAll"])) {
      for (const [declarationIndex, hook] of suite.hooks[phase].entries()) {
        const callback = hook.callback
        /** @type {import("../context.js").LifecycleCallback} */
        const instrumented = (...args) => {
          return profiler.runSpan({
            phase,
            declarationIndex,
            declarationScopeId: profileScopeId(profiler, lineage, declarationOwnerPaths),
            filePath: declarationOwnerPaths.get(hook) ?? declarationOwnerPaths.get(suite) ?? hook.location.filePath
          }, () => callback(...args))
        }
        hook.callback = instrumented
        restorations.push(() => {
          if (hook.callback === instrumented) hook.callback = callback
        })
      }
    }
    for (const test of suite.tests) {
      const callback = test.callback
      /** @type {import("../context.js").LifecycleCallback} */
      const instrumented = (...args) => {
        return profiler.runSpan({
          phase: "test body",
          filePath: declarationOwnerPaths.get(test) ?? declarationOwnerPaths.get(suite) ?? test.location.filePath
        }, () => callback(...args))
      }
      test.callback = instrumented
      restorations.push(() => {
        if (test.callback === instrumented) test.callback = callback
      })
    }
    const restoreNested = instrumentProfileLifecycle(suite.suites, profiler, declarationOwnerPaths, lineage)
    restorations.push(restoreNested)
  }
  return () => {
    for (const restore of restorations.reverse()) restore()
  }
}

/** @param {string | undefined} ownerFilePath @returns {{filePath?: string, line?: number}} */
export function captureDeclarationLocation(ownerFilePath) {
  const stack = new Error().stack?.split("\n") || []
  for (const stackLine of stack) {
    const match = stackLine.match(/(?:\(|\s)(file:\/\/.*?|\/[^"]*?):(\d+):(\d+)\)?$/u)
    if (!match) continue
    let filePath = match[1]
    if (filePath.startsWith("file://")) {
      try { filePath = fileURLToPath(filePath) } catch { continue }
    }
    const resolvedFilePath = path.resolve(filePath)
    if (DECLARATION_INTERNAL_PATHS.has(resolvedFilePath)) continue
    return {filePath: resolvedFilePath, line: Number(match[2])}
  }
  return ownerFilePath ? {filePath: ownerFilePath} : {}
}

/** @param {string} filePath @returns {Promise<any>} */
export async function defaultImporter(filePath) {
  importSequence += 1
  const url = pathToFileURL(filePath)
  url.searchParams.set("velociousTestingRun", String(importSequence))
  return await import(url.href)
}

/**
 * @param {RunNodeTestsOptions} [options]
 * @returns {Promise<RunNodeTestResult>}
 */
export async function runNodeTests(options = {}) {
  if ((options.groups === undefined) !== (options.groupNumber === undefined)) {
    throw new Error("groups and groupNumber must be supplied together")
  }
  const cwd = path.resolve(options.cwd || process.cwd())
  const context = options.context || defaultTestContext
  const importer = options.importer || defaultImporter
  const profiler = options.profiler
  context.reset({config: true})
  /** @type {string | undefined} */
  let ownerFilePath
  context.setDeclarationLocator(() => captureDeclarationLocation(ownerFilePath))
  /** @type {WeakMap<object, string>} */
  const declarationOwnerPaths = new WeakMap()
  /** @param {{declaration?: object}} event */
  const rememberDeclarationOwner = (event) => {
    if (ownerFilePath && event.declaration) declarationOwnerPaths.set(event.declaration, ownerFilePath)
  }
  context.events.on("declaration", rememberDeclarationOwner)

  const lineFilters = mergeLineFilters([
    lineFiltersFromCandidates({cwd, candidates: options.candidates}),
    options.lineFilters || {}
  ])
  /** @type {string[]} */
  let files = []
  /** @type {import("./test-suite-splitter.js").TimingManifestCoverage | undefined} */
  let timingManifestCoverage
  /** @param {string} filePath @param {"imports" | "testing config/global setup"} phase */
  const importOwnedFile = async (filePath, phase) => {
    ownerFilePath = filePath
    try {
      if (profiler) await profiler.measurePhase(phase, async () => await importer(filePath), {filePath})
      else await importer(filePath)
    } finally {
      ownerFilePath = undefined
    }
  }

  try {
    for (const setup of options.setupFiles || []) {
      const setupPath = path.resolve(cwd, parsePathLine(setup).path)
      await importOwnedFile(setupPath, "testing config/global setup")
    }

    const discover = async () => await discoverTestFiles({
      cwd,
      candidates: options.candidates,
      directories: options.directories,
      filePattern: options.filePattern,
      ignoredNames: options.ignoredNames
    })
    if (profiler) {
      files = await profiler.measurePhase("discovery", discover)
      const discoveredPaths = files.map((filePath) => profiler.safeSourcePath(filePath))
      profiler.setSelection({
        discoveredFileCount: files.length,
        hasLineFilters: Object.keys(lineFilters).length > 0,
        testFileSetHash: timingManifestFileSetHash(discoveredPaths)
      })
    } else {
      files = await discover()
    }
    const timingManifest = options.timingManifest ?? await loadTimingManifest(options.timingManifestPath)
    if (options.groups !== undefined && options.groupNumber !== undefined) {
      const splitter = new TestSuiteSplitter({
        groups: options.groups,
        groupNumber: options.groupNumber,
        testFiles: files,
        baseDirectory: cwd,
        timingManifest
      })
      timingManifestCoverage = options.timingManifestPath ? splitter.getTimingManifestCoverage() : undefined
      files = splitter.getGroupFiles()
    }
    profiler?.setSelection({fileCount: files.length})

    for (const file of files) await importOwnedFile(file, "imports")
  } finally {
    ownerFilePath = undefined
    context.events.off("declaration", rememberDeclarationOwner)
  }
  const examples = [
    ...normalizeExamplePatterns((options.examples || []).filter((example) => typeof example === "string")),
    ...(options.examples || []).filter((example) => example instanceof RegExp)
  ]
  const restoreProfileLifecycle = profiler
    ? instrumentProfileLifecycle(context.registry.suites, profiler, declarationOwnerPaths)
    : () => {}
  const attemptExecutor = profiler ? async (/** @type {import("../runner.js").AttemptExecutorInput} */ input) => {
    const descriptions = input.fullName.endsWith(input.test.name)
      ? [input.fullName.slice(0, -input.test.name.length).trimEnd()]
      : [input.suite.name]
    const ownerFilePath = declarationOwnerPaths.get(input.test) ?? declarationOwnerPaths.get(input.suite)
    const handle = profiler.startAttempt({
      descriptions,
      attemptNumber: input.attemptNumber,
      testData: ownerFilePath ? {...input.test, ownerFilePath} : input.test,
      testDescription: input.test.name
    })
    try {
      await profiler.runAttempt(handle, async () => {
        if (options.attemptExecutor) await options.attemptExecutor(input)
        else await input.defaultExecute()
      })
      profiler.finishAttempt(handle, "passed")
    } catch (error) {
      const status = error instanceof Error && /^Timed out after /u.test(error.message) ? "timed-out" : "failed"
      profiler.finishAttempt(handle, status)
      throw error
    }
  } : options.attemptExecutor
  try {
    const result = await runTests({
      context,
      includeTags: options.includeTags,
      includeTagMode: options.includeTagMode,
      excludeTags: options.excludeTags,
      focusedTestsBypassIncludeTags: options.focusedTestsBypassIncludeTags,
      ignoreFocus: options.ignoreFocus,
      omitEmptySuiteNames: options.omitEmptySuiteNames,
      examples,
      lineFilters,
      retries: options.retries,
      timeoutMs: options.timeoutMs,
      reporter: options.reporter,
      attemptExecutor,
      attemptExecutorOwnsTimeout: profiler && !options.attemptExecutor ? true : options.attemptExecutorOwnsTimeout,
      testArgumentResolver: options.testArgumentResolver,
      suiteHookExecutor: options.suiteHookExecutor
    })
    const focused = !options.ignoreFocus && hasFocusedDeclarations(context.registry.suites)
    return {...result, files, focused, ...(timingManifestCoverage ? {timingManifestCoverage} : {})}
  } finally {
    restoreProfileLifecycle()
  }
}

/** @returns {string} */
export function cliHelp() {
  return `Usage: velocious-test [options] [path[:line] ...]\n       velocious-test timing-manifest:merge --output FILE PROFILE...\n\nOptions:\n  --include-tag TAG              Require a tag (repeatable; aliases: --tag, -t)\n  --exclude-tag TAG              Exclude a tag (repeatable; aliases: --skip-tag, -x)\n  --example PATTERN              Match a full test description (aliases: --name, -e)\n  --setup FILE                   Import a setup file before tests (repeatable)\n  --retry, --retries COUNT       Retry failed tests\n  --timeout MS                   Default lifecycle timeout\n  --groups COUNT                 Split files into COUNT deterministic groups\n  --group-number NUMBER          Run one 1-indexed group (requires --groups)\n  --timing-manifest FILE         Use prior file durations for group balancing\n  --profile                      Print a test profile summary\n  --profile-json FILE            Write a rich velocious.test-profile v1 document\n  --timing-manifest-output FILE  Write the selected files' timing manifest\n  --reporter FORMAT  Use default or json output\n  -h, --help                     Show this help\n`
}
