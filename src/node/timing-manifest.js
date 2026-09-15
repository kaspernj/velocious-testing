// @ts-check

import {createHash} from "node:crypto"

/** @typedef {Record<string, number>} TimingManifest */
/**
 * @typedef {object} TestProfileTimingManifestInput
 * @property {import("./test-profiler.js").TestProfileDocument} profile
 * @property {string} source
 */
/**
 * @typedef {object} ValidatedProfileShard
 * @property {number} discoveredFileCount
 * @property {number} fileCount
 * @property {number} groupNumber
 * @property {number} groups
 * @property {string} pathBase
 * @property {string} testFileSetHash
 * @property {TimingManifest} timingManifest
 */

/** @param {string} filePath @returns {string} */
export function canonicalTimingManifestPath(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new Error("Timing manifest keys must be non-empty relative paths")
  }
  const portablePath = filePath.replaceAll("\\", "/")
  if (portablePath.startsWith("/") || /^[A-Za-z]:/u.test(portablePath)) {
    throw new Error(`Timing manifest key must be a relative path: ${filePath}`)
  }

  const segments = []
  for (const segment of portablePath.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      if (segments.length === 0) {
        throw new Error(`Timing manifest key must be a non-escaping relative path: ${filePath}`)
      }
      segments.pop()
    } else {
      segments.push(segment)
    }
  }
  if (segments.length === 0) {
    throw new Error(`Timing manifest key must be a non-empty relative path: ${filePath}`)
  }
  return segments.join("/")
}

/** @param {string} filePathA @param {string} filePathB @returns {number} */
export function compareTimingManifestPaths(filePathA, filePathB) {
  if (filePathA === filePathB) return 0
  return filePathA < filePathB ? -1 : 1
}

/**
 * @param {ReturnType<typeof JSON.parse>} timingManifest
 * @param {{source?: string}} [options]
 * @returns {TimingManifest}
 */
export function validateTimingManifest(timingManifest, {source = "timing manifest"} = {}) {
  if (!timingManifest || typeof timingManifest !== "object" || Array.isArray(timingManifest)) {
    throw new Error(`${source} must be a plain JSON object mapping relative paths to durations`)
  }
  /** @type {Map<string, {duration: number, originalPath: string}>} */
  const entries = new Map()
  for (const [originalPath, duration] of Object.entries(timingManifest)) {
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) {
      throw new Error(`${source} has an invalid duration for ${originalPath}`)
    }
    const canonicalPath = canonicalTimingManifestPath(originalPath)
    const existing = entries.get(canonicalPath)
    if (existing) {
      throw new Error(`${source} has a normalized path collision between ${existing.originalPath} and ${originalPath}`)
    }
    entries.set(canonicalPath, {duration, originalPath})
  }
  return Object.fromEntries(
    [...entries.entries()]
      .sort(([filePathA], [filePathB]) => compareTimingManifestPaths(filePathA, filePathB))
      .map(([filePath, entry]) => [filePath, entry.duration])
  )
}

/** @param {string[]} filePaths @returns {string} */
export function timingManifestFileSetHash(filePaths) {
  const pathManifest = Object.fromEntries(filePaths.map((filePath) => [filePath, 0]))
  const canonicalPaths = Object.keys(validateTimingManifest(pathManifest, {source: "test file set"}))
  const identity = `velocious.test-file-set.v1\0${canonicalPaths.join("\0")}`
  return `sha256:${createHash("sha256").update(identity).digest("hex")}`
}

/** @param {ReturnType<typeof JSON.parse>} value @param {string} message @returns {void} */
function assertJsonObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message)
}

/** @param {ReturnType<typeof JSON.parse>} selection @param {string} source @returns {void} */
function assertCompleteSelection(selection, source) {
  if (selection.focused !== false) throw new Error(`${source} must not be a focused test profile`)
  const selectionFilters = [
    [selection.includeTagCount, 0],
    [selection.excludeTagCount, 0],
    [selection.hasExampleFilters, false],
    [selection.hasLineFilters, false]
  ]
  if (selectionFilters.some(([value, expected]) => value !== expected)) {
    throw new Error(`${source} must not be a filtered test profile`)
  }
}

/**
 * @param {ReturnType<typeof JSON.parse>} shard
 * @param {string} source
 * @returns {{groupNumber: number, groups: number}}
 */
function validatedShardNumbers(shard, source) {
  assertJsonObject(shard, `${source} is missing shard metadata`)
  if (!Number.isInteger(shard.groups) || shard.groups < 1) {
    throw new Error(`${source} has an invalid shard group count`)
  }
  if (!Number.isInteger(shard.groupNumber) || shard.groupNumber < 1 || shard.groupNumber > shard.groups) {
    throw new Error(`${source} has an invalid shard number`)
  }
  return {groupNumber: shard.groupNumber, groups: shard.groups}
}

/** @param {ReturnType<typeof JSON.parse>} value @param {string} message @returns {number} */
function validatedSelectionCount(value, message) {
  if (!Number.isInteger(value) || value < 0) throw new Error(message)
  return value
}

/**
 * @param {ReturnType<typeof JSON.parse>} selection
 * @param {string} source
 * @returns {{pathBase: string, testFileSetHash: string}}
 */
function validatedSelectionIdentity(selection, source) {
  if (!new Set(["configuration-directory", "test-directory"]).has(selection.pathBase)) {
    throw new Error(`${source} has an invalid timing manifest path base`)
  }
  if (typeof selection.testFileSetHash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(selection.testFileSetHash)) {
    throw new Error(`${source} has an invalid test file set identity`)
  }
  return {pathBase: selection.pathBase, testFileSetHash: selection.testFileSetHash}
}

/** @param {TestProfileTimingManifestInput} input @returns {ValidatedProfileShard} */
function validatedProfileShard({profile, source}) {
  assertJsonObject(profile, `${source} must be a rich Velocious test profile`)
  if (profile.schema !== "velocious.test-profile" || profile.schemaVersion !== 1) {
    throw new Error(`${source} has an incompatible Velocious test profile schema`)
  }
  if (profile.status !== "passed" && profile.status !== "no-tests") {
    throw new Error(`${source} must have passed status for timing aggregation`)
  }
  const selection = profile.selection
  assertJsonObject(selection, `${source} is missing test profile selection metadata`)
  assertCompleteSelection(selection, source)
  const {groupNumber, groups} = validatedShardNumbers(selection.shard, source)
  const discoveredFileCount = validatedSelectionCount(
    selection.discoveredFileCount,
    `${source} has an invalid pre-shard discovered file count`
  )
  const fileCount = validatedSelectionCount(
    selection.fileCount,
    `${source} has an invalid post-shard file count`
  )
  const {pathBase, testFileSetHash} = validatedSelectionIdentity(selection, source)
  const timingManifest = validateTimingManifest(profile.timingManifest, {source: `${source} timing manifest`})
  if (profile.status === "no-tests") {
    const counts = profile.counts
    const countNames = /** @type {const} */ (["discovered", "executed", "failed", "passed", "attempts"])
    if (discoveredFileCount === 0 || fileCount !== 0 || Object.keys(timingManifest).length !== 0 ||
        !counts || typeof counts !== "object" || Array.isArray(counts) ||
        countNames.some((countName) => counts[countName] !== 0) ||
        !Array.isArray(profile.files) || profile.files.length !== 0 ||
        !Array.isArray(profile.tests) || profile.tests.length !== 0) {
      throw new Error(`${source} no-tests status is only valid for an empty shard`)
    }
  }
  if (Object.keys(timingManifest).length !== fileCount) {
    throw new Error(`${source} timing manifest does not match its post-shard file count`)
  }
  return {discoveredFileCount, fileCount, groupNumber, groups, pathBase, testFileSetHash, timingManifest}
}

/** @param {ValidatedProfileShard} shard @param {ValidatedProfileShard} expected @param {string} source */
function assertCompatibleShard(shard, expected, source) {
  if (shard.groups !== expected.groups) throw new Error(`${source} has a different shard group count`)
  if (shard.pathBase !== expected.pathBase) throw new Error(`${source} has a different timing manifest path base`)
  if (shard.discoveredFileCount !== expected.discoveredFileCount) throw new Error(`${source} has a different discovered file count`)
  if (shard.testFileSetHash !== expected.testFileSetHash) throw new Error(`${source} has a different test file set identity`)
}

/** @param {TestProfileTimingManifestInput[]} inputs @returns {TimingManifest} */
export function mergeTestProfileTimingManifests(inputs) {
  if (inputs.length === 0) throw new Error("At least one rich test profile is required")
  const shards = inputs.map((input) => validatedProfileShard(input))
  const expected = shards[0]
  /** @type {Map<number, string>} */
  const shardSources = new Map()
  /** @type {Map<string, {duration: number, source: string}>} */
  const mergedEntries = new Map()
  let selectedFileCount = 0

  for (let index = 0; index < shards.length; index++) {
    const shard = shards[index]
    const source = inputs[index].source
    assertCompatibleShard(shard, expected, source)
    const existingShardSource = shardSources.get(shard.groupNumber)
    if (existingShardSource) {
      throw new Error(`Duplicate shard ${shard.groupNumber} in ${existingShardSource} and ${source}`)
    }
    shardSources.set(shard.groupNumber, source)
    selectedFileCount += shard.fileCount
    for (const [filePath, duration] of Object.entries(shard.timingManifest)) {
      const existingEntry = mergedEntries.get(filePath)
      if (existingEntry) throw new Error(`Duplicate timing path ${filePath} in ${existingEntry.source} and ${source}`)
      mergedEntries.set(filePath, {duration, source})
    }
  }

  const missingShardNumbers = []
  for (let groupNumber = 1; groupNumber <= expected.groups; groupNumber++) {
    if (!shardSources.has(groupNumber)) missingShardNumbers.push(groupNumber)
  }
  if (missingShardNumbers.length > 0) throw new Error(`Missing shard profiles: ${missingShardNumbers.join(", ")}`)
  if (selectedFileCount !== expected.discoveredFileCount || mergedEntries.size !== expected.discoveredFileCount) {
    throw new Error("Merged timing manifest does not cover the complete file universe")
  }
  const merged = Object.fromEntries([...mergedEntries].map(([filePath, entry]) => [filePath, entry.duration]))
  if (timingManifestFileSetHash(Object.keys(merged)) !== expected.testFileSetHash) {
    throw new Error("Merged timing manifest does not match the complete file universe")
  }
  return validateTimingManifest(merged, {source: "merged timing manifest"})
}
