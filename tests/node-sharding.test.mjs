import assert from "node:assert/strict"
import path from "node:path"
import {describe, it} from "node:test"

import {runNodeTests, TestSuiteSplitter} from "../src/node/index.js"

describe("Node test suite sharding", () => {
  it("forms deterministic complete disjoint partitions including empty groups", () => {
    const testFiles = [
      "/project/spec/system/login-spec.js",
      "/project/spec/frontend-models/query.browser-spec.js",
      "/project/spec/controller/routes-spec.js",
      "/project/spec/utils/a-spec.js"
    ]
    const partitions = Array.from({length: 6}, (_, index) => new TestSuiteSplitter({
      groups: 6,
      groupNumber: index + 1,
      testFiles,
      baseDirectory: "/project"
    }).getGroupFiles())

    assert.deepEqual(partitions.flat().sort(), [...testFiles].sort())
    assert.equal(new Set(partitions.flat()).size, testFiles.length)
    assert.deepEqual(partitions.slice(4), [[], []])

    const repeated = new TestSuiteSplitter({
      groups: 6,
      groupNumber: 1,
      testFiles: [...testFiles].reverse(),
      baseDirectory: "/project"
    }).getGroupFiles()
    assert.deepEqual(repeated, partitions[0])
  })

  it("preserves exact heuristic weights and the browser multiplier", () => {
    const testFiles = [
      "/project/spec/ordinary/a-spec.js",
      "/project/spec/controller/a-spec.js",
      "/project/spec/frontend-models/a-spec.js",
      "/project/spec/system/a-spec.js",
      "/project/spec/frontend-models/a.browser-spec.mjs"
    ]
    const splitter = new TestSuiteSplitter({groups: 1, groupNumber: 1, testFiles, baseDirectory: "/project"})

    assert.deepEqual(splitter.computeWeightedFiles().map(({weight}) => weight), [1, 3, 10, 20, 20])
  })

  it("prefers usable timings and deterministically falls back for missing, zero, malformed, and external entries", () => {
    const external = path.resolve("/external/spec/system/login.browser-spec.js")
    const testFiles = [
      "/project/spec/system/measured-spec.js",
      "/project/spec/system/zero-spec.js",
      "/project/spec/controller/malformed-spec.js",
      "/project/spec/utils/missing-spec.js",
      external
    ]
    const splitter = new TestSuiteSplitter({
      groups: 1,
      groupNumber: 1,
      testFiles,
      baseDirectory: "/project",
      timingManifest: {
        "./spec/system/measured-spec.js": 2.5,
        "spec/system/zero-spec.js": 0,
        "spec/controller/malformed-spec.js": "12",
        "../external/spec/system/login.browser-spec.js": 500,
        "spec/stale-spec.js": 99
      }
    })

    assert.deepEqual(splitter.computeWeightedFiles().map(({weight}) => weight), [2.5, 20, 3, 1, 2])
    assert.deepEqual(splitter.getTimingManifestCoverage(), {
      heuristicFiles: 4,
      measuredFiles: 1,
      staleEntries: 1
    })
  })

  it("accepts project-prefixed manifest paths when the timing base is a test subdirectory", () => {
    const splitter = new TestSuiteSplitter({
      groups: 1,
      groupNumber: 1,
      testFiles: ["/project/spec/system/slow-spec.js"],
      baseDirectory: "/project/spec",
      timingManifest: {"spec\\system\\slow-spec.js": 7}
    })

    assert.equal(splitter.computeWeightedFiles()[0].weight, 7)
  })

  it("validates constructor bounds", () => {
    assert.throws(() => new TestSuiteSplitter({groups: 0, groupNumber: 1, testFiles: []}), /positive integer/u)
    assert.throws(() => new TestSuiteSplitter({groups: 2, groupNumber: 0, testFiles: []}), /between 1 and 2/u)
    assert.throws(() => new TestSuiteSplitter({groups: 2, groupNumber: 3, testFiles: []}), /between 1 and 2/u)
    assert.throws(() => new TestSuiteSplitter({groups: Number.MAX_SAFE_INTEGER + 1, groupNumber: 1, testFiles: []}), /positive integer/u)
  })

  it("requires paired grouping options through the programmatic runner", async () => {
    await assert.rejects(runNodeTests({candidates: [], directories: [], groups: 2}), /supplied together/u)
    await assert.rejects(runNodeTests({candidates: [], directories: [], groupNumber: 1}), /supplied together/u)
  })
})
