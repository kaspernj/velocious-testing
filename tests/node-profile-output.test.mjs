import assert from "node:assert/strict"
import {AsyncLocalStorage} from "node:async_hooks"
import {access, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, it} from "node:test"

import {
  formatTestProfileSummary,
  loadTimingManifest,
  resolveTestProfileOptions,
  TestProfiler,
  timingManifestFromProfile,
  writeTestProfileOutputs,
  writeTimingManifest
} from "../src/node/index.js"

function buildProfile() {
  const storage = new AsyncLocalStorage()
  const profiler = new TestProfiler({
    contextAdapter: {
      current: () => storage.getStore(),
      run: (context, callback) => storage.run(context, callback)
    },
    projectDirectory: process.cwd(),
    selection: {
      discoveredFileCount: 2,
      excludeTagCount: 0,
      fileCount: 2,
      focused: false,
      hasExampleFilters: false,
      hasLineFilters: false,
      includeTagCount: 0,
      pathBase: "configuration-directory",
      shard: {groups: 2, groupNumber: 1},
      testFileSetHash: `sha256:${"0".repeat(64)}`
    }
  })
  profiler.addFileDuration("spec/z-profile-spec.js", "imports", 9.87654)
  profiler.addFileDuration("spec/a-profile-spec.js", "imports", 4.32109)
  return profiler.finish({
    counts: {discovered: 2, executed: 2, failed: 0, passed: 2},
    focused: false,
    status: "passed"
  })
}

describe("Node test profile output", () => {
  it("atomically writes deterministic rich JSON and a canonical rounded timing manifest", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "velocious-profile-output-"))
    const profileJsonPath = path.join(directory, "nested", "profile.json")
    const timingManifestOutputPath = path.join(directory, "nested", "timings.json")

    try {
      await writeTestProfileOutputs({profile: buildProfile(), profileJsonPath, timingManifestOutputPath})
      const profileContent = await readFile(profileJsonPath, "utf8")
      const manifestContent = await readFile(timingManifestOutputPath, "utf8")

      assert.equal(profileContent.endsWith("\n"), true)
      assert.equal(manifestContent, '{\n  "spec/a-profile-spec.js": 4.321,\n  "spec/z-profile-spec.js": 9.877\n}\n')
      assert.deepEqual(JSON.parse(profileContent).timingManifest, JSON.parse(manifestContent))
      assert.deepEqual((await readdir(path.join(directory, "nested"))).sort(), ["profile.json", "timings.json"])
      assert.deepEqual(timingManifestFromProfile(buildProfile()), JSON.parse(manifestContent))
    } finally {
      await rm(directory, {recursive: true, force: true})
    }
  })

  it("rejects forbidden profile fields before writing and leaves existing output untouched", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "velocious-profile-privacy-"))
    const outputPath = path.join(directory, "profile.json")

    try {
      await writeFile(outputPath, "existing\n")
      await assert.rejects(
        writeTestProfileOutputs({profile: {...buildProfile(), sql: "SELECT secret"}, profileJsonPath: outputPath}),
        /forbidden profile field/iu
      )
      assert.equal(await readFile(outputPath, "utf8"), "existing\n")
      assert.deepEqual((await readdir(directory)).sort(), ["profile.json"])
    } finally {
      await rm(directory, {recursive: true, force: true})
    }
  })

  it("resolves profile paths and rejects output collisions before work starts", () => {
    const cwd = path.resolve("/workspace/project")
    assert.deepEqual(resolveTestProfileOptions({
      cwd,
      profile: false,
      profileJsonPath: "tmp/profile.json",
      timingManifestPath: "tmp/current.json",
      timingManifestOutputPath: "tmp/next.json"
    }), {
      profile: true,
      profileJsonPath: path.join(cwd, "tmp/profile.json"),
      timingManifestPath: path.join(cwd, "tmp/current.json"),
      timingManifestOutputPath: path.join(cwd, "tmp/next.json")
    })
    assert.throws(() => resolveTestProfileOptions({
      cwd,
      profile: true,
      profileJsonPath: "tmp/profile.json",
      timingManifestOutputPath: "tmp/profile.json"
    }), /paths must be different/u)
    assert.throws(() => resolveTestProfileOptions({
      cwd,
      profile: true,
      timingManifestPath: "tmp/current.json",
      timingManifestOutputPath: "tmp/current.json"
    }), /must not overwrite/u)
  })

  it("loads explicit manifests with distinct read, parse, and validation failures", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "velocious-profile-manifest-load-"))
    const validPath = path.join(directory, "valid.json")
    const malformedPath = path.join(directory, "malformed.json")
    const invalidPath = path.join(directory, "invalid.json")

    try {
      await writeFile(validPath, JSON.stringify({"./spec//a-spec.js": 0}))
      await writeFile(malformedPath, "not json")
      await writeFile(invalidPath, JSON.stringify({"spec/a-spec.js": "12"}))
      assert.deepEqual(await loadTimingManifest(validPath), {"spec/a-spec.js": 0})
      assert.equal(await loadTimingManifest(undefined), undefined)
      await assert.rejects(loadTimingManifest(path.join(directory, "missing.json")), /read timing manifest/u)
      await assert.rejects(loadTimingManifest(malformedPath), /parse timing manifest/u)
      await assert.rejects(loadTimingManifest(invalidPath), /duration/u)
    } finally {
      await rm(directory, {recursive: true, force: true})
    }
  })

  it("formats summaries and writes standalone timing manifests", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "velocious-profile-summary-"))
    const outputPath = path.join(directory, "nested", "timings.json")
    const profile = buildProfile()
    profile.pools = [{
      identifier: "default",
      connectionCreation: {count: 2, failedCount: 0, totalMs: 3, maxMs: 2},
      checkoutWait: {count: 1, totalMs: 4, maxMs: 4},
      checkoutTimeoutCount: 0,
      idleReap: {count: 1, failedCount: 0, totalMs: 2, maxMs: 2, disposalCount: 1},
      peakLiveConnections: 2
    }]

    try {
      await writeTimingManifest({outputPath, timingManifest: {"spec\\z.js": 1.23456}})
      assert.equal(await readFile(outputPath, "utf8"), '{\n  "spec/z.js": 1.235\n}\n')
      const summary = formatTestProfileSummary(profile, {profileJsonPath: "/tmp/profile.json", timingManifestOutputPath: outputPath})
      assert.match(summary, /^Test profile\nPhase\s+Count\s+Real ms\s+CPU ms/mu)
      assert.match(summary, /runner overhead/u)
      assert.match(summary, /Pool default/u)
      assert.match(summary, /Rich JSON: \/tmp\/profile.json/u)
      assert.match(summary, /Timing manifest:/u)
      await access(outputPath)
    } finally {
      await rm(directory, {recursive: true, force: true})
    }
  })
})
