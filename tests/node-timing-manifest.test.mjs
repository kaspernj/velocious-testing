import assert from "node:assert/strict"
import {createHash} from "node:crypto"
import {describe, it} from "node:test"

import {
  canonicalTimingManifestPath,
  compareTimingManifestPaths,
  mergeTestProfileTimingManifests,
  timingManifestFileSetHash,
  validateTimingManifest
} from "../src/node/index.js"

const allFiles = ["spec/a-spec.js", "spec/b-spec.js"]
const suiteHash = `sha256:${createHash("sha256")
  .update("velocious.test-file-set.v1\0spec/a-spec.js\0spec/b-spec.js")
  .digest("hex")}`

function profile({
  groupNumber,
  timingManifest,
  groups = 2,
  status = "passed",
  focused = false,
  includeTagCount = 0,
  excludeTagCount = 0,
  hasExampleFilters = false,
  hasLineFilters = false,
  pathBase = "configuration-directory",
  testFileSetHash = suiteHash,
  discoveredFileCount = 2,
  fileCount = Object.keys(timingManifest || {}).length
}) {
  return {
    schema: "velocious.test-profile",
    schemaVersion: 1,
    status,
    selection: {
      discoveredFileCount,
      excludeTagCount,
      fileCount,
      focused,
      hasExampleFilters,
      hasLineFilters,
      includeTagCount,
      pathBase,
      shard: {groups, groupNumber},
      testFileSetHash
    },
    timingManifest
  }
}

describe("Node timing manifests", () => {
  it("canonicalizes paths, validates durations and collisions, and sorts by code units", () => {
    assert.equal(canonicalTimingManifestPath("./spec\\nested//../z-spec.js"), "spec/z-spec.js")
    assert.deepEqual(validateTimingManifest({
      "spec/é-spec.js": 2,
      "spec/z-spec.js": 0
    }), {
      "spec/z-spec.js": 0,
      "spec/é-spec.js": 2
    })
    assert.equal(compareTimingManifestPaths("spec/z-spec.js", "spec/é-spec.js"), -1)

    for (const invalidRoot of [null, [], "timings"]) {
      assert.throws(() => validateTimingManifest(invalidRoot), /plain JSON object/u)
    }
    for (const invalidPath of ["", "/spec/a.js", "C:spec/a.js", "C:\\spec\\a.js", "../spec/a.js", "spec/../../a.js"]) {
      assert.throws(() => canonicalTimingManifestPath(invalidPath), /relative path/u)
    }
    for (const invalidDuration of [-1, "12", null, Infinity]) {
      assert.throws(() => validateTimingManifest({"spec/a.js": invalidDuration}), /duration/u)
    }
    assert.throws(() => validateTimingManifest({"./spec/a.js": 1, "spec\\a.js": 2}), /collision/u)
  })

  it("hashes the exact canonical file-set domain independently of spelling and order", () => {
    assert.equal(timingManifestFileSetHash(["spec\\b-spec.js", "./spec/a-spec.js"]), suiteHash)
    assert.equal(timingManifestFileSetHash([...allFiles].reverse()), suiteHash)
  })

  it("merges one complete compatible passed, unfocused, unfiltered profile per shard", () => {
    assert.deepEqual(mergeTestProfileTimingManifests([
      {profile: profile({groupNumber: 2, timingManifest: {"spec/b-spec.js": 20}}), source: "shard-2.json"},
      {profile: profile({groupNumber: 1, timingManifest: {"./spec/a-spec.js": 10}}), source: "shard-1.json"}
    ]), {"spec/a-spec.js": 10, "spec/b-spec.js": 20})
  })

  it("rejects malformed, failed, interrupted, no-test, focused, and filtered profiles", () => {
    const mutations = [
      null,
      {...profile({groupNumber: 1, timingManifest: {"spec/a-spec.js": 10}}), schema: "other"},
      profile({groupNumber: 1, timingManifest: {"spec/a-spec.js": 10}, status: "failed"}),
      profile({groupNumber: 1, timingManifest: {"spec/a-spec.js": 10}, status: "interrupted"}),
      profile({groupNumber: 1, timingManifest: {"spec/a-spec.js": 10}, status: "no-tests"}),
      profile({groupNumber: 1, timingManifest: {"spec/a-spec.js": 10}, focused: true}),
      profile({groupNumber: 1, timingManifest: {"spec/a-spec.js": 10}, includeTagCount: 1}),
      profile({groupNumber: 1, timingManifest: {"spec/a-spec.js": 10}, excludeTagCount: 1}),
      profile({groupNumber: 1, timingManifest: {"spec/a-spec.js": 10}, hasExampleFilters: true}),
      profile({groupNumber: 1, timingManifest: {"spec/a-spec.js": 10}, hasLineFilters: true})
    ]

    for (const invalidProfile of mutations) {
      assert.throws(() => mergeTestProfileTimingManifests([
        {profile: invalidProfile, source: "shard-1.json"},
        {profile: profile({groupNumber: 2, timingManifest: {"spec/b-spec.js": 20}}), source: "shard-2.json"}
      ]), /profile|schema|passed|focused|filtered/u)
    }
  })

  it("rejects incomplete, duplicate, incompatible, and universe-mismatched shard sets", () => {
    const shard1 = profile({groupNumber: 1, timingManifest: {"spec/a-spec.js": 10}})
    assert.throws(() => mergeTestProfileTimingManifests([{profile: shard1, source: "one.json"}]), /missing shard/iu)
    assert.throws(() => mergeTestProfileTimingManifests([
      {profile: shard1, source: "one.json"},
      {profile: profile({groupNumber: 1, timingManifest: {"spec/b-spec.js": 20}}), source: "duplicate.json"}
    ]), /duplicate shard/iu)
    assert.throws(() => mergeTestProfileTimingManifests([
      {profile: shard1, source: "one.json"},
      {profile: profile({groupNumber: 2, timingManifest: {"spec/b-spec.js": 20}, pathBase: "test-directory"}), source: "two.json"}
    ]), /path base/u)
    assert.throws(() => mergeTestProfileTimingManifests([
      {profile: shard1, source: "one.json"},
      {profile: profile({groupNumber: 2, timingManifest: {"spec/a-spec.js": 20}}), source: "two.json"}
    ]), /duplicate timing path/iu)
    assert.throws(() => mergeTestProfileTimingManifests([
      {profile: shard1, source: "one.json"},
      {profile: profile({groupNumber: 2, timingManifest: {"spec/c-spec.js": 20}}), source: "two.json"}
    ]), /complete file universe/iu)
    assert.throws(() => mergeTestProfileTimingManifests([
      {profile: profile({groupNumber: 1, timingManifest: {"spec/a-spec.js": 10}, fileCount: 2}), source: "one.json"},
      {profile: profile({groupNumber: 2, timingManifest: {"spec/b-spec.js": 20}}), source: "two.json"}
    ]), /post-shard file count/u)
  })
})
