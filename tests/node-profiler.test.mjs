import assert from "node:assert/strict"
import {AsyncLocalStorage} from "node:async_hooks"
import path from "node:path"
import {describe, it} from "node:test"

import {TestProfiler} from "../src/node/index.js"
import {validateTestActivityName} from "../src/profiling.js"

function profileContextAdapter() {
  const storage = new AsyncLocalStorage()
  return {
    current: () => storage.getStore(),
    run: (context, callback) => storage.run(context, callback)
  }
}

function startAttempt(profiler, attemptNumber = 1, filePath = path.resolve("spec/example-spec.js")) {
  return profiler.startAttempt({
    attemptNumber,
    descriptions: ["profile suite"],
    testData: {filePath, line: 12, ownerFilePath: filePath},
    testDescription: "records work"
  })
}

describe("Node test profiler", () => {
  it("records attempts, nested spans, custom activities, retries, and detached late work", async () => {
    const adapter = profileContextAdapter()
    const profiler = new TestProfiler({contextAdapter: adapter, projectDirectory: process.cwd()})
    const first = startAttempt(profiler)
    let releaseLate
    const lateGate = new Promise((resolve) => { releaseLate = resolve })
    let lateActivity

    await profiler.runAttempt(first, async () => {
      await profiler.runSpan({phase: "beforeEach", declarationIndex: 0, declarationScopeId: "scope:first"}, async () => {})
      await profiler.runSpan({phase: "test body"}, async () => {
        await profiler.profileActivity(adapter.current(), "cache-warmup", async () => {})
        const capturedContext = adapter.current()
        lateActivity = lateGate.then(async () => {
          await profiler.profileActivity(capturedContext, "detached-cleanup", async () => {})
        })
      })
    })
    profiler.finishAttempt(first, "failed")

    const second = startAttempt(profiler, 2)
    await profiler.runAttempt(second, async () => {
      await profiler.runSpan({phase: "beforeEach", declarationIndex: 0, declarationScopeId: "scope:first"}, async () => {})
      await profiler.runSpan({phase: "test body"}, async () => {})
    })
    profiler.finishAttempt(second, "passed")
    releaseLate()
    await lateActivity

    const profile = profiler.finish({
      counts: {discovered: 1, executed: 1, failed: 0, passed: 1},
      focused: false,
      status: "passed"
    })

    assert.equal(profile.schema, "velocious.test-profile")
    assert.equal(profile.schemaVersion, 1)
    assert.equal(profile.counts.attempts, 2)
    assert.equal(profile.unattributedLateEventCount, 1)
    assert.deepEqual(profile.tests[0].attempts.map((attempt) => attempt.status), ["failed", "passed"])
    assert.deepEqual(profile.tests[0].attempts[0].spans.map((span) => span.phase), ["beforeEach", "test body", "custom"])
    assert.deepEqual(profile.tests[0].attempts[1].spans.map((span) => span.executionOrder), [4, 5])
    assert.equal(profile.tests[0].attempts.flatMap((attempt) => attempt.spans).some((span) => span.activity === "detached-cleanup"), false)
  })

  it("bounds activity cardinality and validates browser-safe activity names", async () => {
    const adapter = profileContextAdapter()
    const profiler = new TestProfiler({contextAdapter: adapter, projectDirectory: process.cwd()})
    const attempt = startAttempt(profiler)

    await profiler.runAttempt(attempt, async () => {
      for (let index = 0; index < 22; index += 1) {
        await profiler.profileActivity(adapter.current(), `activity-${index}`, async () => {})
      }
    })
    profiler.finishAttempt(attempt, "passed")
    const profile = profiler.finish({
      counts: {discovered: 1, executed: 1, failed: 0, passed: 1},
      focused: false,
      status: "passed"
    })
    const activities = profile.tests[0].attempts[0].spans.map((span) => span.activity)

    assert.equal(validateTestActivityName("cache-warmup.v2"), "cache-warmup.v2")
    assert.throws(() => validateTestActivityName("tenant=user@example.com"), /activity name/u)
    assert.equal(new Set(activities).size, 21)
    assert.deepEqual(activities.slice(20), ["other", "other"])
  })

  it("closes active spans on interruption and refuses later attribution", async () => {
    const adapter = profileContextAdapter()
    const profiler = new TestProfiler({contextAdapter: adapter, projectDirectory: process.cwd()})
    const attempt = startAttempt(profiler)
    let releaseSpan
    let markStarted
    const gate = new Promise((resolve) => { releaseSpan = resolve })
    const started = new Promise((resolve) => { markStarted = resolve })
    const running = profiler.runAttempt(attempt, async () => {
      await profiler.runSpan({phase: "test body"}, async () => {
        markStarted()
        await gate
      })
    })

    await started
    profiler.interrupt()
    releaseSpan()
    await running
    const profile = profiler.finish({
      counts: {discovered: 1, executed: 1, failed: 1, passed: 0},
      focused: false,
      status: "interrupted"
    })

    assert.equal(profile.tests[0].attempts[0].status, "interrupted")
    assert.equal(profile.tests[0].attempts[0].spans.length, 1)
    assert.ok(profile.unattributedLateEventCount >= 1)
  })

  it("records only numeric database and pool aggregates on the active span", async () => {
    const adapter = profileContextAdapter()
    const profiler = new TestProfiler({contextAdapter: adapter, projectDirectory: process.cwd()})
    const attempt = startAttempt(profiler)

    await profiler.runAttempt(attempt, async () => {
      await profiler.runSpan({phase: "test body"}, async () => {
        const context = adapter.current()
        profiler.recordDatabaseQuery(context, {
          durationMs: 2.3456,
          failed: false,
          sqlFingerprint: "sha256:opaque",
          sqlOperation: "SELECT"
        })
        profiler.recordDatabaseQuery(context, {
          durationMs: 4,
          failed: true,
          sqlFingerprint: "sha256:unrecognized",
          sqlOperation: "SENSITIVE_TOKEN"
        })
        profiler.recordDatabaseTransaction(context, {action: "start", durationMs: 1, failed: false})
        profiler.recordDatabaseTransaction(context, {action: "rollback", durationMs: 3, failed: true})
        profiler.recordPoolMetric(context, "default", "connectionCreation", {durationMs: 5, failed: false})
        profiler.recordPoolMetric(context, "default", "checkoutWait", {durationMs: 6})
        profiler.recordPoolMetric(context, "default", "checkoutTimeout")
        profiler.recordPoolMetric(context, "default", "idleReap", {durationMs: 7, failed: true})
        profiler.recordPoolMetric(context, "default", "idleReapDisposal")
        profiler.recordPoolMetric(context, "default", "peakLiveConnections", {value: 3})
      })
    })
    profiler.finishAttempt(attempt, "passed")
    const profile = profiler.finish({
      counts: {discovered: 1, executed: 1, failed: 0, passed: 1},
      focused: false,
      status: "passed"
    })
    const span = profile.tests[0].attempts[0].spans[0]

    assert.deepEqual(profile.database.fingerprints.map(({operation}) => operation), ["SELECT", "UNKNOWN"])
    assert.equal(profile.database.queryCount, 2)
    assert.equal(profile.database.failedQueryCount, 1)
    assert.equal(profile.database.transactions.start.count, 1)
    assert.equal(profile.database.transactions.rollback.failedCount, 1)
    assert.equal(span.database.queryCount, 2)
    assert.equal(profile.pools[0].checkoutWait.totalMs, 6)
    assert.equal(profile.pools[0].checkoutTimeoutCount, 1)
    assert.equal(profile.pools[0].idleReap.disposalCount, 1)
    assert.equal(profile.pools[0].peakLiveConnections, 3)
    assert.equal(span.pools[0].identifier, "default")
    assert.doesNotMatch(JSON.stringify(profile), /SENSITIVE_TOKEN/u)
  })

  it("uses portable paths in the project and hashes external source paths", () => {
    const profiler = new TestProfiler({contextAdapter: profileContextAdapter(), projectDirectory: "/project"})

    assert.equal(profiler.safeSourcePath("/project/spec/a-spec.js"), "spec/a-spec.js")
    assert.match(profiler.safeSourcePath("/external/private/a-spec.js"), /^sha256:[a-f0-9]{24}$/u)
    assert.doesNotMatch(profiler.safeSourcePath("/external/private/a-spec.js"), /private/u)
  })
})
