// @ts-check

import { createHash } from "node:crypto"
import path from "node:path"
import { validateTestActivityName } from "../profiling.js"
import { compareTimingManifestPaths } from "./timing-manifest.js"

/** @typedef {"passed" | "failed" | "interrupted" | "timed-out"} TestProfileAttemptStatus */
/** @typedef {{user: number, system: number}} ProcessCpuUsage */
/** @typedef {{user: number, system: number, total: number}} TestProfileCpuAggregate */
/** @typedef {{queryCount: number, failedQueryCount: number, totalMs: number, maxMs: number}} ProfileDatabaseAggregate */
/** @typedef {{count: number, failedCount: number, totalMs: number, maxMs: number}} ProfileActionAggregate */
/** @typedef {{identifier: string, connectionCreation: ProfileActionAggregate, checkoutWait: {count: number, totalMs: number, maxMs: number}, checkoutTimeoutCount: number, idleReap: ProfileActionAggregate & {disposalCount: number}, peakLiveConnections: number}} ProfilePoolAggregate */
/** @typedef {{current: () => TestProfileAsyncContext | undefined, run: <T>(context: TestProfileAsyncContext, callback: () => T) => T}} ProfileContextAdapter */
/** @typedef {import("../context.js").TestDeclaration & {filePath?: string, ownerFilePath?: string, line?: number}} ProfileTestDeclaration */
/** @typedef {"passed" | "failed" | "interrupted" | "no-tests" | "focused" | "error"} TestProfileStatus */
/** @typedef {{groups: number, groupNumber: number}} TestProfileShard */
/**
 * @typedef {object} TestProfileSelection
 * @property {boolean} focused
 * @property {number} [discoveredFileCount]
 * @property {number} [fileCount]
 * @property {number} [includeTagCount]
 * @property {number} [excludeTagCount]
 * @property {boolean} [hasExampleFilters]
 * @property {boolean} [hasLineFilters]
 * @property {"configuration-directory" | "test-directory"} [pathBase]
 * @property {TestProfileShard} [shard]
 * @property {string} [testFileSetHash]
 */
/** @typedef {{count: number, totalMs: number, maxMs: number, cpuMs: TestProfileCpuAggregate}} TestProfilePhaseAggregate */
/** @typedef {{path: string, importMs: number, hooksMs: number, testsMs: number, attemptsMs: number, totalMs: number}} TestProfileFileAggregate */
/** @typedef {{id: string, parentId: string | undefined, file: string, line: number | undefined}} TestProfileScope */
/** @typedef {{id: string, file: string, line: number | undefined, durationMs: number, attempts: TestProfileAttemptRecord[]}} TestProfileTestRecord */
/** @typedef {{hash: string, operation: string, count: number, failedCount: number, totalMs: number, maxMs: number}} TestProfileQueryFingerprint */
/** @typedef {ProfileDatabaseAggregate & {fingerprints: TestProfileQueryFingerprint[], transactions: {start: ProfileActionAggregate, commit: ProfileActionAggregate, rollback: ProfileActionAggregate}}} TestProfileDatabase */
/**
 * @typedef {object} TestProfileDocument
 * @property {"velocious.test-profile"} schema
 * @property {1} schemaVersion
 * @property {TestProfileStatus} status
 * @property {TestProfileSelection} selection
 * @property {{discovered: number, executed: number, failed: number, passed: number, attempts: number}} counts
 * @property {number} durationMs
 * @property {TestProfileCpuAggregate} cpuMs
 * @property {Record<string, TestProfilePhaseAggregate>} phases
 * @property {TestProfileFileAggregate[]} files
 * @property {TestProfileScope[]} scopes
 * @property {TestProfileTestRecord[]} tests
 * @property {TestProfileSpan[]} spans
 * @property {TestProfileDatabase} database
 * @property {ProfilePoolAggregate[]} pools
 * @property {number} unattributedLateEventCount
 * @property {import("./timing-manifest.js").TimingManifest} timingManifest
 */

/**
 * @typedef {object} TestProfileAsyncContext
 * @property {TestProfiler} profiler - Owning profiler.
 * @property {TestProfileAttemptRecord | undefined} attempt - Active test attempt.
 * @property {boolean} active - Whether attribution is still open.
 * @property {Set<TestProfileAsyncContext> | undefined} [attemptContexts] - Contexts sharing one attempt lifetime.
 * @property {string | undefined} filePath - Project-relative owning test file.
 * @property {TestProfileSpan | undefined} [span] - Innermost active profile span.
 * @property {number} [spanStartedAt] - Span monotonic start time.
 * @property {ProcessCpuUsage} [spanCpuStartedAt] - Span CPU start time.
 */

/**
 * @typedef {object} TestProfileSpan
 * @property {string} phase - Profile phase.
 * @property {number} executionOrder - Monotonic span start order.
 * @property {number} durationMs - Real duration.
 * @property {TestProfileCpuAggregate} cpuMs - Process CPU duration.
 * @property {string} [activity] - Validated custom activity name.
 * @property {number} [declarationIndex] - Hook index within its declaration scope.
 * @property {string} [declarationScopeId] - Opaque declaration scope identifier.
 * @property {string} [file] - Project-relative source path.
 * @property {ProfileDatabaseAggregate} [database] - Span database aggregate.
 * @property {ProfilePoolAggregate[]} [pools] - Span pool aggregates.
 */

/**
 * @typedef {object} TestProfileAttemptRecord
 * @property {number} number - One-indexed attempt number.
 * @property {TestProfileAttemptStatus | "running"} status - Attempt result.
 * @property {number} durationMs - Real duration.
 * @property {TestProfileCpuAggregate} cpuMs - Process CPU duration.
 * @property {TestProfileSpan[]} spans - Attempt-owned spans.
 */

/**
 * @typedef {object} TestProfileAttemptHandle
 * @property {TestProfileAsyncContext} context - Async attribution context.
 * @property {TestProfileAttemptRecord} attempt - Output attempt record.
 * @property {number} startedAt - Real start time.
 * @property {ProcessCpuUsage} cpuStartedAt - CPU start time.
 */

/**
 * @typedef {object} InternalPhaseAggregate
 * @property {number} count - Invocation count.
 * @property {number} totalMs - Total real duration.
 * @property {number} maxMs - Maximum real duration.
 * @property {number} cpuUserMs - Total user CPU time.
 * @property {number} cpuSystemMs - Total system CPU time.
 */

/**
 * @typedef {object} InternalFileAggregate
 * @property {string} path - Project-relative path.
 * @property {number} importMs - Import duration.
 * @property {number} hooksMs - Hook duration.
 * @property {number} testsMs - Test body duration.
 * @property {number} attemptsMs - Complete test-attempt duration.
 * @property {number} totalMs - Total file weight duration.
 */

/**
 * @typedef {object} InternalTestRecord
 * @property {string} id - Opaque stable test identifier.
 * @property {string} file - Project-relative source path.
 * @property {number | undefined} line - Declaration line.
 * @property {TestProfileAttemptRecord[]} attempts - Attempt records.
 */

const BUILT_IN_PHASES = [
  "discovery",
  "imports",
  "testing config/global setup",
  "beforeAll",
  "beforeEach",
  "test body",
  "afterEach",
  "afterAll"
]
const MAX_CUSTOM_ACTIVITY_NAMES = 20
const SAFE_SQL_OPERATIONS = new Set([
  "ALTER",
  "ANALYZE",
  "BEGIN",
  "CALL",
  "COMMIT",
  "COPY",
  "CREATE",
  "DELETE",
  "DESCRIBE",
  "DROP",
  "EXEC",
  "EXECUTE",
  "EXPLAIN",
  "GRANT",
  "INSERT",
  "MERGE",
  "PRAGMA",
  "RELEASE",
  "REPLACE",
  "REVOKE",
  "ROLLBACK",
  "SAVEPOINT",
  "SELECT",
  "SET",
  "SHOW",
  "TRUNCATE",
  "UPDATE",
  "VACUUM",
  "VALUES",
  "WITH"
])

/**
 * Rounds and bounds duration values for public output.
 * @param {number} durationMs - Raw duration.
 * @returns {number} - Safe duration.
 */
export function roundProfileDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return 0

  return Math.round(durationMs * 1000) / 1000
}

/**
 * Collects opt-in test-run timing without retaining application payloads.
 */
export default class TestProfiler {
  /**
   * Creates an opt-in test profile collector.
   * @param {object} args - Profiler options.
   * @param {ProfileContextAdapter} args.contextAdapter - Async context integration.
   * @param {string} args.projectDirectory - Project root used for portable paths.
   * @param {Partial<TestProfileSelection>} [args.selection] - Sanitized selection metadata.
   */
  constructor({contextAdapter, projectDirectory, selection = {}}) {
    this._contextAdapter = contextAdapter
    this._projectDirectory = path.resolve(projectDirectory)
    this._selection = selection
    this._startedAt = this.now()
    this._cpuStartedAt = process.cpuUsage()
    this._executionOrder = 0
    this._unattributedLateEventCount = 0
    /** @type {Map<string, InternalPhaseAggregate>} */
    this._phases = new Map()
    /** @type {Map<string, InternalFileAggregate>} */
    this._files = new Map()
    /** @type {InternalTestRecord[]} */
    this._tests = []
    /** @type {Map<string, InternalTestRecord>} */
    this._testsById = new Map()
    /** @type {Set<TestProfileAttemptHandle>} */
    this._activeAttempts = new Set()
    /** @type {Set<TestProfileAsyncContext>} */
    this._activeSpanContexts = new Set()
    /** @type {TestProfileSpan[]} */
    this._spans = []
    /** @type {Array<{id: string, parentId: string | undefined, file: string, line: number | undefined}>} */
    this._scopes = []
    /** @type {WeakMap<import("../context.js").SuiteDeclaration, string>} */
    this._scopeIds = new WeakMap()
    /** @type {Set<string>} */
    this._customActivityNames = new Set()
    this._database = this.emptyDatabaseAggregate()
    /** @type {Map<string, {hash: string, operation: string, count: number, failedCount: number, totalMs: number, maxMs: number}>} */
    this._queryFingerprints = new Map()
    this._transactions = {
      start: this.phaseAggregateShape(),
      commit: this.phaseAggregateShape(),
      rollback: this.phaseAggregateShape()
    }
    /** @type {Map<string, ProfilePoolAggregate>} */
    this._pools = new Map()
    /** @type {TestProfileDocument | undefined} */
    this._finishedProfile = undefined

    for (const phase of BUILT_IN_PHASES) this.phaseAggregate(phase)
  }

  /**
   * Returns the profiler's monotonic clock.
   * @returns {number} - Monotonic milliseconds.
   */
  now() {
    return globalThis.performance.now()
  }

  /**
   * Converts a source path to a project-relative path or an opaque hash.
   * @param {string | undefined} filePath - Source path.
   * @returns {string} - Safe source identifier.
   */
  safeSourcePath(filePath) {
    if (!filePath) return "sha256:unknown"

    const absolutePath = path.resolve(filePath)
    const relativePath = path.relative(this._projectDirectory, absolutePath)

    if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
      return relativePath.replaceAll(path.sep, "/")
    }

    if (!relativePath) return path.basename(absolutePath)

    return this.hash(`external-source:${absolutePath}`)
  }

  /**
   * Returns a bounded opaque SHA-256 identifier.
   * @param {string} value - Value to hash.
   * @returns {string} - Opaque hash.
   */
  hash(value) {
    return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 24)}`
  }

  /**
   * Adds aggregate-only selection metadata as discovery progresses.
   * @param {Partial<TestProfileSelection>} selection - Safe selection metadata.
   * @returns {void}
   */
  setSelection(selection) {
    Object.assign(this._selection, selection)
  }

  /**
   * Registers and returns a deterministic scope identifier.
   * @param {import("../context.js").SuiteDeclaration} scope - Scope object.
   * @param {object} args - Scope metadata.
   * @param {string[]} args.descriptions - Scope description path.
   * @param {string | undefined} args.filePath - Scope source path.
   * @param {number | undefined} [args.line] - Scope source line.
   * @param {string | undefined} [args.parentId] - Parent scope identifier.
   * @returns {string} - Opaque scope identifier.
   */
  scopeId(scope, {descriptions, filePath, line, parentId}) {
    const existing = this._scopeIds.get(scope)
    if (existing) return existing

    const safeFilePath = this.safeSourcePath(filePath)
    const id = this.hash(`scope:${safeFilePath}:${line ?? 0}:${descriptions.join("\u0000")}`)

    this._scopeIds.set(scope, id)
    this._scopes.push({id, parentId, file: safeFilePath, line})
    return id
  }

  /**
   * Starts an attempt and its async attribution context.
   * @param {object} args - Attempt metadata.
   * @param {string[]} args.descriptions - Parent descriptions.
   * @param {number} args.attemptNumber - Attempt number.
   * @param {ProfileTestDeclaration} args.testData - Test declaration.
   * @param {string} args.testDescription - Test description.
   * @returns {TestProfileAttemptHandle} - Active attempt handle.
   */
  startAttempt({descriptions, attemptNumber, testData, testDescription}) {
    const sourcePath = testData.ownerFilePath ?? testData.filePath ?? testData.location?.filePath
    const line = testData.line ?? testData.location?.line
    const file = this.safeSourcePath(sourcePath)
    const id = this.hash(`test:${file}:${line ?? 0}:${[...descriptions, testDescription].join("\u0000")}`)
    let testRecord = this._testsById.get(id)

    if (!testRecord) {
      testRecord = {id, file, line, attempts: []}
      this._testsById.set(id, testRecord)
      this._tests.push(testRecord)
    }

    /** @type {TestProfileAttemptRecord} */
    const attempt = {
      number: attemptNumber,
      status: "running",
      durationMs: 0,
      cpuMs: {user: 0, system: 0, total: 0},
      spans: []
    }
    /** @type {Set<TestProfileAsyncContext>} */
    const attemptContexts = new Set()
    const context = {profiler: this, attempt, active: true, attemptContexts, filePath: file, span: undefined}

    attemptContexts.add(context)

    const handle = {context, attempt, startedAt: this.now(), cpuStartedAt: process.cpuUsage()}

    testRecord.attempts.push(attempt)
    this._activeAttempts.add(handle)

    return handle
  }

  /**
   * Runs work inside an attempt's async context.
   * @template T
   * @param {TestProfileAttemptHandle} handle - Attempt handle.
   * @param {() => Promise<T>} callback - Attempt lifecycle.
   * @returns {Promise<T>} - Callback result.
   */
  async runAttempt(handle, callback) {
    return await this._contextAdapter.run(handle.context, callback)
  }

  /**
   * Completes an attempt and prevents descendant late work from retaining attribution.
   * @param {TestProfileAttemptHandle} handle - Attempt handle.
   * @param {TestProfileAttemptStatus} status - Attempt result.
   * @returns {void}
   */
  finishAttempt(handle, status) {
    if (handle.attempt.status !== "running") return

    for (const context of handle.context.attemptContexts || []) {
      if (context.span) this.finishSpanContext(context)
      context.active = false
    }

    handle.attempt.status = status
    handle.attempt.durationMs = roundProfileDuration(this.now() - handle.startedAt)
    handle.attempt.cpuMs = this.cpuDuration(handle.cpuStartedAt)
    this.addFileAttemptDuration(handle.context.filePath, handle.attempt.durationMs)
    this._activeAttempts.delete(handle)
  }

  /**
   * Closes every active attempt and nested span at the current interruption boundary.
   * @returns {void}
   */
  interrupt() {
    for (const handle of [...this._activeAttempts]) {
      this.finishAttempt(handle, "interrupted")
    }

    for (const context of [...this._activeSpanContexts]) {
      this.finishSpanContext(context)
    }
  }

  /**
   * Runs a runner-owned phase span.
   * @template T
   * @param {object} args - Span metadata.
   * @param {string} args.phase - Phase name.
   * @param {string} [args.activity] - Custom activity label.
   * @param {number} [args.declarationIndex] - Hook declaration index.
   * @param {string} [args.declarationScopeId] - Hook declaration scope.
   * @param {string} [args.filePath] - Source or owning test file.
   * @param {() => (T | Promise<T>)} callback - Timed work.
   * @returns {Promise<T>} - Callback result.
   */
  async runSpan({phase, activity, declarationIndex, declarationScopeId, filePath}, callback) {
    const currentContext = this._contextAdapter.current()

    if (currentContext && !this.contextIsActive(currentContext)) {
      this._unattributedLateEventCount++
      return await callback()
    }

    const safeFilePath = currentContext?.filePath ?? (filePath ? this.safeSourcePath(filePath) : undefined)
    const startedAt = this.now()
    const cpuStartedAt = process.cpuUsage()
    /** @type {TestProfileSpan} */
    const span = {
      phase,
      executionOrder: ++this._executionOrder,
      durationMs: 0,
      cpuMs: {user: 0, system: 0, total: 0}
    }

    if (activity) span.activity = activity
    if (declarationIndex !== undefined) span.declarationIndex = declarationIndex
    if (declarationScopeId) span.declarationScopeId = declarationScopeId
    if (safeFilePath) span.file = safeFilePath

    if (currentContext?.attempt) {
      currentContext.attempt.spans.push(span)
    } else {
      this._spans.push(span)
    }

    const spanContext = {
      profiler: this,
      attempt: currentContext?.attempt,
      active: true,
      attemptContexts: currentContext?.attemptContexts,
      filePath: safeFilePath,
      span,
      spanStartedAt: startedAt,
      spanCpuStartedAt: cpuStartedAt
    }

    spanContext.attemptContexts?.add(spanContext)
    this._activeSpanContexts.add(spanContext)

    try {
      return await this._contextAdapter.run(spanContext, callback)
    } finally {
      if (spanContext.active) {
        this.finishSpanContext(spanContext)
      } else if (spanContext.attempt) {
        this._unattributedLateEventCount++
      }
    }
  }

  /**
   * Finalizes an open span, including partial work closed by a timeout.
   * @param {TestProfileAsyncContext} context - Span context.
   * @returns {void}
   */
  finishSpanContext(context) {
    if (!context.active || !context.span || context.spanStartedAt === undefined || !context.spanCpuStartedAt) return

    context.active = false
    context.span.durationMs = roundProfileDuration(this.now() - context.spanStartedAt)
    context.span.cpuMs = this.cpuDuration(context.spanCpuStartedAt)
    this.addPhaseDuration(context.span.phase, context.span.durationMs, context.span.cpuMs)
    this.addFileDuration(context.filePath, context.span.phase, context.span.durationMs, Boolean(context.attempt))
    this._activeSpanContexts.delete(context)
  }

  /**
   * Checks both a nested span boundary and its owning attempt boundary.
   * @param {TestProfileAsyncContext} context - Candidate profile context.
   * @returns {boolean} - Whether events may still be attributed.
   */
  contextIsActive(context) {
    return context.active && (!context.attempt || context.attempt.status === "running")
  }

  /**
   * Runs a validated application-defined activity.
   * @template T
   * @param {TestProfileAsyncContext} context - Captured async context.
   * @param {string} name - Validated activity name.
   * @param {() => (T | Promise<T>)} callback - Activity callback.
   * @returns {Promise<T>} - Callback result.
   */
  async profileActivity(context, name, callback) {
    if (!this.contextIsActive(context)) {
      this._unattributedLateEventCount++
      return await callback()
    }

    const validatedName = validateTestActivityName(name)
    let outputName = validatedName

    if (!this._customActivityNames.has(validatedName)) {
      if (this._customActivityNames.size >= MAX_CUSTOM_ACTIVITY_NAMES) {
        outputName = "other"
      } else {
        this._customActivityNames.add(validatedName)
      }
    }

    return await this.runSpan({phase: "custom", activity: outputName}, callback)
  }

  /**
   * Measures a command-level phase outside an attempt.
   * @template T
   * @param {string} phase - Phase name.
   * @param {() => (T | Promise<T>)} callback - Timed work.
   * @param {{filePath?: string}} [metadata] - Optional source ownership.
   * @returns {Promise<T>} - Callback result.
   */
  async measurePhase(phase, callback, metadata = {}) {
    return await this.runSpan({phase, filePath: metadata.filePath}, callback)
  }

  /**
   * Records one successful or failed physical database query attempt.
   * @param {TestProfileAsyncContext} context - Context captured when the query began.
   * @param {{durationMs: number, failed: boolean, sqlFingerprint: string, sqlOperation: string}} args - Query aggregate values.
   * @returns {void}
   */
  recordDatabaseQuery(context, {durationMs, failed, sqlFingerprint, sqlOperation}) {
    if (!this.contextIsActive(context)) {
      this._unattributedLateEventCount++
      return
    }

    const safeDurationMs = roundProfileDuration(durationMs)

    this.addDatabaseQueryAggregate(this._database, {durationMs: safeDurationMs, failed})
    if (context.span) {
      context.span.database ||= this.emptyDatabaseAggregate()
      this.addDatabaseQueryAggregate(context.span.database, {durationMs: safeDurationMs, failed})
    }

    const safeOperation = SAFE_SQL_OPERATIONS.has(sqlOperation) ? sqlOperation : "UNKNOWN"
    const fingerprintKey = `${safeOperation}:${sqlFingerprint}`
    let fingerprint = this._queryFingerprints.get(fingerprintKey)

    if (!fingerprint && this._queryFingerprints.size < 50) {
      fingerprint = {
        hash: sqlFingerprint,
        operation: safeOperation,
        count: 0,
        failedCount: 0,
        totalMs: 0,
        maxMs: 0
      }
      this._queryFingerprints.set(fingerprintKey, fingerprint)
    }

    if (fingerprint) {
      fingerprint.count++
      if (failed) fingerprint.failedCount++
      fingerprint.totalMs += safeDurationMs
      fingerprint.maxMs = Math.max(fingerprint.maxMs, safeDurationMs)
    }
  }

  /**
   * Records a physical transaction action.
   * @param {TestProfileAsyncContext} context - Context captured when the action began.
   * @param {{action: "start" | "commit" | "rollback", durationMs: number, failed: boolean}} args - Transaction aggregate values.
   * @returns {void}
   */
  recordDatabaseTransaction(context, {action, durationMs, failed}) {
    if (!this.contextIsActive(context)) {
      this._unattributedLateEventCount++
      return
    }

    const aggregate = this._transactions[action]
    const safeDurationMs = roundProfileDuration(durationMs)

    aggregate.count++
    if (failed) aggregate.failedCount++
    aggregate.totalMs += safeDurationMs
    aggregate.maxMs = Math.max(aggregate.maxMs, safeDurationMs)
  }

  /**
   * Records one low-cardinality pool lifecycle delta.
   * @param {TestProfileAsyncContext} context - Context captured when the operation began.
   * @param {string} identifier - Logical pool identifier.
   * @param {"connectionCreation" | "checkoutWait" | "checkoutTimeout" | "idleReap" | "idleReapDisposal" | "peakLiveConnections"} metric - Metric name.
   * @param {{durationMs?: number, failed?: boolean, value?: number}} [values] - Aggregate values.
   * @returns {void}
   */
  recordPoolMetric(context, identifier, metric, values = {}) {
    if (!this.contextIsActive(context)) {
      this._unattributedLateEventCount++
      return
    }

    const aggregate = this.poolAggregate(this._pools, identifier)

    this.addPoolMetric(aggregate, metric, values)

    if (context.span) {
      context.span.pools ||= []
      const spanPools = new Map(context.span.pools.map((pool) => [pool.identifier, pool]))
      const spanAggregate = this.poolAggregate(spanPools, identifier)

      if (!context.span.pools.includes(spanAggregate)) context.span.pools.push(spanAggregate)
      this.addPoolMetric(spanAggregate, metric, values)
    }
  }

  /**
   * Builds the final privacy-safe profile document.
   * @param {object} args - Run result.
   * @param {{discovered: number, executed: number, failed: number, passed: number}} args.counts - Run counts.
   * @param {boolean} args.focused - Whether focused tests were selected.
   * @param {TestProfileStatus} args.status - Run status.
   * @returns {TestProfileDocument} - Rich profile document.
   */
  finish({counts, focused, status}) {
    if (this._finishedProfile) return this._finishedProfile

    const totalDurationMs = roundProfileDuration(this.now() - this._startedAt)
    const totalCpuMs = this.cpuDuration(this._cpuStartedAt)
    const exclusivePhaseNames = BUILT_IN_PHASES
    const measuredDurationMs = exclusivePhaseNames.reduce((sum, phase) => sum + this.phaseAggregate(phase).totalMs, 0)
    const measuredCpuUserMs = exclusivePhaseNames.reduce((sum, phase) => sum + this.phaseAggregate(phase).cpuUserMs, 0)
    const measuredCpuSystemMs = exclusivePhaseNames.reduce((sum, phase) => sum + this.phaseAggregate(phase).cpuSystemMs, 0)

    this._phases.set("runner overhead", {
      count: 1,
      totalMs: Math.max(0, totalDurationMs - measuredDurationMs),
      maxMs: Math.max(0, totalDurationMs - measuredDurationMs),
      cpuUserMs: Math.max(0, totalCpuMs.user - measuredCpuUserMs),
      cpuSystemMs: Math.max(0, totalCpuMs.system - measuredCpuSystemMs)
    })
    this._phases.set("total", {
      count: 1,
      totalMs: totalDurationMs,
      maxMs: totalDurationMs,
      cpuUserMs: totalCpuMs.user,
      cpuSystemMs: totalCpuMs.system
    })

    const phases = Object.fromEntries([...this._phases.entries()].map(([phase, aggregate]) => [
      phase,
      this.publicAggregate(aggregate)
    ]))
    const files = [...this._files.values()]
      .map((file) => ({
        path: file.path,
        importMs: roundProfileDuration(file.importMs),
        hooksMs: roundProfileDuration(file.hooksMs),
        testsMs: roundProfileDuration(file.testsMs),
        attemptsMs: roundProfileDuration(file.attemptsMs),
        totalMs: roundProfileDuration(file.totalMs)
      }))
      .sort((fileA, fileB) => compareTimingManifestPaths(fileA.path, fileB.path))
    const timingManifest = Object.fromEntries(files.map((file) => [file.path, file.totalMs]))
    const attempts = this._tests.reduce((sum, test) => sum + test.attempts.length, 0)

    this._finishedProfile = {
      schema: "velocious.test-profile",
      schemaVersion: /** @type {1} */ (1),
      status,
      selection: {...this._selection, focused},
      counts: {...counts, attempts},
      durationMs: totalDurationMs,
      cpuMs: totalCpuMs,
      phases,
      files,
      scopes: [...this._scopes].sort((scopeA, scopeB) => scopeA.id.localeCompare(scopeB.id)),
      tests: this._tests.map((test) => ({
        id: test.id,
        file: test.file,
        line: test.line,
        durationMs: roundProfileDuration(test.attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0)),
        attempts: test.attempts
      })),
      spans: this._spans,
      database: {
        queryCount: this._database.queryCount,
        failedQueryCount: this._database.failedQueryCount,
        totalMs: roundProfileDuration(this._database.totalMs),
        maxMs: roundProfileDuration(this._database.maxMs),
        fingerprints: [...this._queryFingerprints.values()]
          .map((fingerprint) => ({
            ...fingerprint,
            totalMs: roundProfileDuration(fingerprint.totalMs),
            maxMs: roundProfileDuration(fingerprint.maxMs)
          }))
          .sort((fingerprintA, fingerprintB) => {
            return fingerprintA.operation.localeCompare(fingerprintB.operation) || fingerprintA.hash.localeCompare(fingerprintB.hash)
          }),
        transactions: {
          start: this.publicActionAggregate(this._transactions.start),
          commit: this.publicActionAggregate(this._transactions.commit),
          rollback: this.publicActionAggregate(this._transactions.rollback)
        }
      },
      pools: [...this._pools.values()]
        .map((pool) => this.publicPoolAggregate(pool))
        .sort((poolA, poolB) => poolA.identifier.localeCompare(poolB.identifier)),
      unattributedLateEventCount: this._unattributedLateEventCount,
      timingManifest
    }

    return this._finishedProfile
  }

  /**
   * Returns an internal phase aggregate.
   * @param {string} phase - Phase name.
   * @returns {InternalPhaseAggregate} - Aggregate.
   */
  phaseAggregate(phase) {
    let aggregate = this._phases.get(phase)

    if (!aggregate) {
      aggregate = {count: 0, totalMs: 0, maxMs: 0, cpuUserMs: 0, cpuSystemMs: 0}
      this._phases.set(phase, aggregate)
    }

    return aggregate
  }

  /**
   * Adds a completed span to its aggregate phase.
   * @param {string} phase - Phase name.
   * @param {number} durationMs - Real duration.
   * @param {{user: number, system: number, total: number}} cpuMs - CPU duration.
   * @returns {void}
   */
  addPhaseDuration(phase, durationMs, cpuMs) {
    const aggregate = this.phaseAggregate(phase)

    aggregate.count++
    aggregate.totalMs += durationMs
    aggregate.maxMs = Math.max(aggregate.maxMs, durationMs)
    aggregate.cpuUserMs += cpuMs.user
    aggregate.cpuSystemMs += cpuMs.system
  }

  /**
   * Adds an exclusive file-owned phase to timing-manifest weight.
   * @param {string | undefined} filePath - Safe project-relative path.
   * @param {string} phase - Phase name.
   * @param {number} durationMs - Real duration.
   * @param {boolean} [insideAttempt] - Whether the phase is already covered by complete attempt time.
   * @returns {void}
   */
  addFileDuration(filePath, phase, durationMs, insideAttempt = false) {
    if (!filePath) return
    if (!["imports", "beforeAll", "beforeEach", "test body", "afterEach", "afterAll"].includes(phase)) return

    let file = this._files.get(filePath)

    if (!file) {
      file = {path: filePath, importMs: 0, hooksMs: 0, testsMs: 0, attemptsMs: 0, totalMs: 0}
      this._files.set(filePath, file)
    }

    if (phase === "imports") file.importMs += durationMs
    if (phase === "test body") file.testsMs += durationMs
    if (["beforeAll", "beforeEach", "afterEach", "afterAll"].includes(phase)) file.hooksMs += durationMs
    if (!insideAttempt) file.totalMs += durationMs
  }

  /**
   * Adds the complete cost of an attempt to its owning file weight.
   * @param {string | undefined} filePath - Safe project-relative path.
   * @param {number} durationMs - Attempt duration.
   * @returns {void}
   */
  addFileAttemptDuration(filePath, durationMs) {
    if (!filePath) return

    let file = this._files.get(filePath)

    if (!file) {
      file = {path: filePath, importMs: 0, hooksMs: 0, testsMs: 0, attemptsMs: 0, totalMs: 0}
      this._files.set(filePath, file)
    }

    file.attemptsMs += durationMs
    file.totalMs += durationMs
  }

  /**
   * Calculates process CPU time since a start sample.
   * @param {ProcessCpuUsage} start - CPU start sample.
   * @returns {{user: number, system: number, total: number}} - Millisecond CPU duration.
   */
  cpuDuration(start) {
    const cpu = process.cpuUsage(start)
    const user = roundProfileDuration(cpu.user / 1000)
    const system = roundProfileDuration(cpu.system / 1000)

    return {user, system, total: roundProfileDuration(user + system)}
  }

  /**
   * Converts an internal aggregate to public rounded values.
   * @param {InternalPhaseAggregate} [aggregate] - Internal aggregate.
   * @returns {{count: number, totalMs: number, maxMs: number, cpuMs: {user: number, system: number, total: number}}} - Public aggregate.
   */
  publicAggregate(aggregate = {count: 0, totalMs: 0, maxMs: 0, cpuUserMs: 0, cpuSystemMs: 0}) {
    const user = roundProfileDuration(aggregate.cpuUserMs)
    const system = roundProfileDuration(aggregate.cpuSystemMs)

    return {
      count: aggregate.count,
      totalMs: roundProfileDuration(aggregate.totalMs),
      maxMs: roundProfileDuration(aggregate.maxMs),
      cpuMs: {user, system, total: roundProfileDuration(user + system)}
    }
  }

  /**
   * Returns an empty query aggregate.
   * @returns {ProfileDatabaseAggregate} - Empty aggregate.
   */
  emptyDatabaseAggregate() {
    return {queryCount: 0, failedQueryCount: 0, totalMs: 0, maxMs: 0}
  }

  /**
   * Adds a query attempt to a database aggregate.
   * @param {ProfileDatabaseAggregate} aggregate - Aggregate to update.
   * @param {{durationMs: number, failed: boolean}} args - Attempt values.
   * @returns {void}
   */
  addDatabaseQueryAggregate(aggregate, {durationMs, failed}) {
    aggregate.queryCount++
    if (failed) aggregate.failedQueryCount++
    aggregate.totalMs += durationMs
    aggregate.maxMs = Math.max(aggregate.maxMs, durationMs)
  }

  /**
   * Returns an empty action aggregate.
   * @returns {ProfileActionAggregate} - Empty aggregate.
   */
  phaseAggregateShape() {
    return {count: 0, failedCount: 0, totalMs: 0, maxMs: 0}
  }

  /**
   * Rounds a transaction or pool action aggregate.
   * @param {ProfileActionAggregate} aggregate - Internal aggregate.
   * @returns {ProfileActionAggregate} - Public aggregate.
   */
  publicActionAggregate(aggregate) {
    return {
      count: aggregate.count,
      failedCount: aggregate.failedCount,
      totalMs: roundProfileDuration(aggregate.totalMs),
      maxMs: roundProfileDuration(aggregate.maxMs)
    }
  }

  /**
   * Returns an empty pool aggregate.
   * @param {string} [identifier] - Logical pool identifier.
   * @returns {ProfilePoolAggregate} - Empty aggregate.
   */
  emptyPoolAggregate(identifier = "") {
    return {
      identifier,
      connectionCreation: this.phaseAggregateShape(),
      checkoutWait: {count: 0, totalMs: 0, maxMs: 0},
      checkoutTimeoutCount: 0,
      idleReap: {...this.phaseAggregateShape(), disposalCount: 0},
      peakLiveConnections: 0
    }
  }

  /**
   * Gets or creates a pool aggregate in a map.
   * @param {Map<string, ProfilePoolAggregate>} pools - Pool map.
   * @param {string} identifier - Logical pool identifier.
   * @returns {ProfilePoolAggregate} - Pool aggregate.
   */
  poolAggregate(pools, identifier) {
    let aggregate = pools.get(identifier)

    if (!aggregate) {
      aggregate = this.emptyPoolAggregate(identifier)
      pools.set(identifier, aggregate)
    }

    return aggregate
  }

  /**
   * Applies one pool metric delta.
   * @param {ProfilePoolAggregate} aggregate - Pool aggregate.
   * @param {"connectionCreation" | "checkoutWait" | "checkoutTimeout" | "idleReap" | "idleReapDisposal" | "peakLiveConnections"} metric - Metric name.
   * @param {{durationMs?: number, failed?: boolean, value?: number}} values - Metric values.
   * @returns {void}
   */
  addPoolMetric(aggregate, metric, values) {
    const durationMs = roundProfileDuration(values.durationMs ?? 0)

    if (metric === "connectionCreation" || metric === "idleReap") {
      const actionAggregate = metric === "connectionCreation" ? aggregate.connectionCreation : aggregate.idleReap

      actionAggregate.count++
      if (values.failed) actionAggregate.failedCount++
      actionAggregate.totalMs += durationMs
      actionAggregate.maxMs = Math.max(actionAggregate.maxMs, durationMs)
    } else if (metric === "checkoutWait") {
      aggregate.checkoutWait.count++
      aggregate.checkoutWait.totalMs += durationMs
      aggregate.checkoutWait.maxMs = Math.max(aggregate.checkoutWait.maxMs, durationMs)
    } else if (metric === "checkoutTimeout") {
      aggregate.checkoutTimeoutCount++
    } else if (metric === "idleReapDisposal") {
      aggregate.idleReap.disposalCount++
    } else if (metric === "peakLiveConnections") {
      aggregate.peakLiveConnections = Math.max(aggregate.peakLiveConnections, values.value ?? 0)
    }
  }

  /**
   * Rounds a pool aggregate for output.
   * @param {ProfilePoolAggregate} aggregate - Internal aggregate.
   * @returns {ProfilePoolAggregate} - Public aggregate.
   */
  publicPoolAggregate(aggregate) {
    return {
      identifier: aggregate.identifier,
      connectionCreation: this.publicActionAggregate(aggregate.connectionCreation),
      checkoutWait: {
        count: aggregate.checkoutWait.count,
        totalMs: roundProfileDuration(aggregate.checkoutWait.totalMs),
        maxMs: roundProfileDuration(aggregate.checkoutWait.maxMs)
      },
      checkoutTimeoutCount: aggregate.checkoutTimeoutCount,
      idleReap: {
        ...this.publicActionAggregate(aggregate.idleReap),
        disposalCount: aggregate.idleReap.disposalCount
      },
      peakLiveConnections: aggregate.peakLiveConnections
    }
  }
}
