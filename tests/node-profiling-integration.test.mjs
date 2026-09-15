import assert from "node:assert/strict"
import {AsyncLocalStorage} from "node:async_hooks"
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, it} from "node:test"
import {pathToFileURL} from "node:url"

import {runNodeTests, TestProfiler, timingManifestFileSetHash} from "../src/node/index.js"

const packageEntry = pathToFileURL(path.resolve("src/index.js")).href

function createProfiler(projectDirectory) {
  const storage = new AsyncLocalStorage()
  return new TestProfiler({
    contextAdapter: {
      current: () => storage.getStore(),
      run: (context, callback) => storage.run(context, callback)
    },
    projectDirectory,
    selection: {
      excludeTagCount: 0,
      hasExampleFilters: false,
      includeTagCount: 0,
      pathBase: "configuration-directory"
    }
  })
}

function finishProfile(profiler, result) {
  return profiler.finish({
    counts: {
      discovered: result.counts.total + result.counts.skipped,
      executed: result.tests.filter((testResult) => testResult.attempts.length > 0).length,
      failed: result.counts.failed,
      passed: result.counts.passed
    },
    focused: result.focused,
    status: result.status
  })
}

describe("Node profiling integration corrections", () => {
  it("preserves per-callback default timeouts and profiles lifecycle phases without double-counting", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-profile-lifecycle-"))
    try {
      await mkdir(path.join(root, "spec"))
      await writeFile(path.join(root, "spec", "lifecycle.test.mjs"), [
        `import {afterEach, beforeEach, describe, it} from ${JSON.stringify(packageEntry)}`,
        "const pause = () => new Promise((resolve) => setTimeout(resolve, 60))",
        "describe('profile lifecycle', () => {",
        "  beforeEach(pause)",
        "  beforeEach(pause)",
        "  afterEach(pause)",
        "  afterEach(pause)",
        "  it('works', pause)",
        "})"
      ].join("\n"))
      const profiler = createProfiler(root)
      const result = await runNodeTests({
        cwd: root,
        candidates: ["spec/lifecycle.test.mjs"],
        profiler,
        timeoutMs: 100
      })
      await new Promise((resolve) => setTimeout(resolve, 150))
      const profile = finishProfile(profiler, result)

      assert.equal(result.status, "passed")
      assert.equal(profile.phases.beforeEach.count, 2)
      assert.equal(profile.phases["test body"].count, 1)
      assert.equal(profile.phases.afterEach.count, 2)
      assert.deepEqual(profile.tests[0].attempts[0].spans.map(({phase}) => phase), [
        "beforeEach", "beforeEach", "test body", "afterEach", "afterEach"
      ])
      const file = profile.files.find(({path: filePath}) => filePath === "spec/lifecycle.test.mjs")
      assert.ok(file)
      assert.ok(file.hooksMs > 0)
      assert.ok(file.testsMs > 0)
      assert.ok(Math.abs(file.totalMs - file.importMs - file.attemptsMs) < 0.01)
    } finally {
      await rm(root, {recursive: true, force: true})
    }
  })

  it("attributes helper declarations and hooks to their discovered owner file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-profile-owner-"))
    try {
      await mkdir(path.join(root, "spec"))
      await mkdir(path.join(root, "support"))
      const helperPath = path.join(root, "support", "register.mjs")
      await writeFile(helperPath, [
        `import {beforeAll, beforeEach, describe, it} from ${JSON.stringify(packageEntry)}`,
        "export function register() {",
        "  describe('helper suite', () => {",
        "    beforeAll(() => {})",
        "    beforeEach(() => {})",
        "    it('works', () => {})",
        "  })",
        "}"
      ].join("\n"))
      await writeFile(path.join(root, "spec", "owner.test.mjs"), [
        "import {register} from '../support/register.mjs'",
        "register()"
      ].join("\n"))
      const profiler = createProfiler(root)
      const result = await runNodeTests({cwd: root, candidates: ["spec/owner.test.mjs"], profiler})
      const profile = finishProfile(profiler, result)

      assert.equal(result.tests[0].location.filePath, helperPath)
      assert.equal(profile.tests[0].file, "spec/owner.test.mjs")
      assert.deepEqual(Object.keys(profile.timingManifest), ["spec/owner.test.mjs"])
      assert.equal(profile.selection.testFileSetHash, timingManifestFileSetHash(["spec/owner.test.mjs"]))
      assert.deepEqual(new Set(profile.scopes.map(({file}) => file)), new Set(["spec/owner.test.mjs"]))
    } finally {
      await rm(root, {recursive: true, force: true})
    }
  })

  it("closes attempts abandoned after executor timeout grace before final snapshots", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-profile-timeout-"))
    try {
      await mkdir(path.join(root, "spec"))
      await writeFile(path.join(root, "spec", "timeout.test.mjs"), [
        `import {describe, it} from ${JSON.stringify(packageEntry)}`,
        "describe('timeout profile', () => it('abandons executor', () => {}))"
      ].join("\n"))
      const profiler = createProfiler(root)
      const result = await runNodeTests({
        cwd: root,
        candidates: ["spec/timeout.test.mjs"],
        profiler,
        timeoutMs: 5,
        attemptExecutor: async ({defaultExecute}) => {
          await defaultExecute()
          await new Promise(() => {})
        }
      })
      const profile = finishProfile(profiler, result)

      assert.equal(result.status, "failed")
      assert.deepEqual(profile.tests[0].attempts.map(({status}) => status), ["interrupted"])
      assert.ok(profile.files[0].attemptsMs > 0)
      assert.equal(JSON.stringify(profile).includes('"status":"running"'), false)
    } finally {
      await rm(root, {recursive: true, force: true})
    }
  })

  it("ignores focus markers inherited only by non-runnable declarations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-profile-focus-"))
    try {
      await mkdir(path.join(root, "spec"))
      await writeFile(path.join(root, "spec", "focus.test.mjs"), [
        `import {describe, it} from ${JSON.stringify(packageEntry)}`,
        "describe('focus profile', () => {",
        "  it.skip('ignored focus', {focus: true}, () => {})",
        "  it('ordinary', () => {})",
        "})"
      ].join("\n"))
      const profiler = createProfiler(root)
      const result = await runNodeTests({cwd: root, candidates: ["spec/focus.test.mjs"], profiler})
      const profile = finishProfile(profiler, result)

      assert.equal(result.status, "passed")
      assert.equal(result.focused, false)
      assert.equal(profile.selection.focused, false)
      assert.deepEqual(result.tests.map(({fullName}) => fullName), ["focus profile ordinary"])
    } finally {
      await rm(root, {recursive: true, force: true})
    }
  })

  it("combines candidate and explicit line filters for the same file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-line-filter-merge-"))
    try {
      await mkdir(path.join(root, "spec"))
      const testPath = path.join(root, "spec", "lines.test.mjs")
      await writeFile(testPath, [
        `import {describe, it} from ${JSON.stringify(packageEntry)}`,
        "describe('merged lines', () => {",
        "  it('candidate', () => {})",
        "  it('explicit', () => {})",
        "})"
      ].join("\n"))
      const result = await runNodeTests({
        cwd: root,
        candidates: ["spec/lines.test.mjs:3"],
        lineFilters: {[testPath]: [4]}
      })

      assert.deepEqual(result.tests.map(({fullName}) => fullName), [
        "merged lines candidate", "merged lines explicit"
      ])
    } finally {
      await rm(root, {recursive: true, force: true})
    }
  })
})
