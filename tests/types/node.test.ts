import type {TestDeclaration} from "../../build/runner.js"
import {
  canonicalTimingManifestPath,
  discoverTestFiles,
  extractTestCliArguments,
  formatTestProfileSummary,
  lineFiltersFromCandidates,
  loadTimingManifest,
  mergeTestProfileTimingManifests,
  normalizeExamplePatterns,
  parseCliArguments,
  parseTimingManifestMergeArguments,
  resolveTestProfileOptions,
  TestProfiler,
  TestSuiteSplitter,
  timingManifestFileSetHash,
  timingManifestFromProfile,
  validateTimingManifest,
  writeTestProfileOutputs,
  writeTimingManifest,
  type CliOptions,
  type ProfileContextAdapter,
  type ProfileDatabaseAggregate,
  type ProfilePoolAggregate,
  type ResolvedTestProfileOptions,
  type RunNodeTestsOptions,
  type TestDiscoveryOptions,
  type TestProfileAsyncContext,
  type TestProfileAttemptRecord,
  type TestProfileDocument,
  type TestProfileOutputOptions,
  type TestProfilePhaseAggregate,
  type TestProfileSelection,
  type TestProfileSpan,
  type TestProfileTimingManifestInput,
  type TimingManifest,
  type TimingManifestCoverage,
  type TimingManifestMergeArguments
} from "../../build/node/index.js"

let currentContext: TestProfileAsyncContext | undefined
const contextAdapter: ProfileContextAdapter = {
  current: () => currentContext,
  run: (context, callback) => {
    currentContext = context
    try { return callback() } finally { currentContext = undefined }
  }
}
const selection: TestProfileSelection = {
  discoveredFileCount: 1,
  excludeTagCount: 0,
  fileCount: 1,
  focused: false,
  hasExampleFilters: false,
  hasLineFilters: false,
  includeTagCount: 0,
  pathBase: "configuration-directory",
  shard: {groups: 1, groupNumber: 1},
  testFileSetHash: `sha256:${"0".repeat(64)}`
}
const profiler = new TestProfiler({contextAdapter, projectDirectory: process.cwd(), selection})
const declaration = {} as TestDeclaration
const attempt = profiler.startAttempt({attemptNumber: 1, descriptions: [], testData: declaration, testDescription: "works"})
const attemptRecord: TestProfileAttemptRecord = attempt.attempt
const span: TestProfileSpan | undefined = attemptRecord.spans[0]
const database: ProfileDatabaseAggregate | undefined = span?.database
const pool: ProfilePoolAggregate | undefined = span?.pools?.[0]
profiler.finishAttempt(attempt, "passed")
const profile: TestProfileDocument = profiler.finish({
  counts: {discovered: 1, executed: 1, failed: 0, passed: 1},
  focused: false,
  status: "passed"
})
const phase: TestProfilePhaseAggregate | undefined = profile.phases.imports
const manifest: TimingManifest = timingManifestFromProfile(profile)
const mergeInput: TestProfileTimingManifestInput = {profile, source: "profile.json"}
const coverage: TimingManifestCoverage = new TestSuiteSplitter({
  groups: 1,
  groupNumber: 1,
  testFiles: [],
  timingManifest: manifest
}).getTimingManifestCoverage()
const cli: CliOptions = parseCliArguments([])
const runOptions: RunNodeTestsOptions = {candidates: cli.candidates}
const discovery: TestDiscoveryOptions = {cwd: process.cwd(), candidates: []}
const resolved: ResolvedTestProfileOptions = resolveTestProfileOptions({cwd: process.cwd(), profile: true})
const output: TestProfileOutputOptions = {profile, profileJsonPath: "profile.json"}
const mergeArguments: TimingManifestMergeArguments = parseTimingManifestMergeArguments([
  "profile.json", "--output", "timings.json"
])

await discoverTestFiles(discovery)
lineFiltersFromCandidates(discovery)
extractTestCliArguments([])
normalizeExamplePatterns([])
canonicalTimingManifestPath("spec/a-spec.js")
validateTimingManifest(manifest)
timingManifestFileSetHash(Object.keys(manifest))
mergeTestProfileTimingManifests([mergeInput])
await loadTimingManifest(undefined)
await writeTimingManifest({outputPath: "timings.json", timingManifest: manifest})
await writeTestProfileOutputs(output)
formatTestProfileSummary(profile, resolved)
void database
void pool
void phase
void coverage
void runOptions
void mergeArguments

// @ts-expect-error Group counts are numeric.
new TestSuiteSplitter({groups: "1", groupNumber: 1, testFiles: []})
