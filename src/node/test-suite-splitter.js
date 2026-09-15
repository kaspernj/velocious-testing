// @ts-check

import path from "node:path"

import {canonicalTimingManifestPath, compareTimingManifestPaths} from "./timing-manifest.js"

/** @typedef {{filePath: string, weight: number}} SplitterFileEntry */
/** @typedef {{totalWeight: number, files: string[]}} GroupBucket */
/** @typedef {{heuristicFiles: number, measuredFiles: number, staleEntries: number}} TimingManifestCoverage */

const DEFAULT_WEIGHT = 1
/** @type {Record<string, number>} */
const DIRECTORY_WEIGHTS = {system: 20, "frontend-models": 10, controller: 3}
const BROWSER_SPEC_MULTIPLIER = 2

export class TestSuiteSplitter {
  /**
   * @param {{groups: number, groupNumber: number, testFiles: string[], baseDirectory?: string, timingManifest?: import("./timing-manifest.js").TimingManifest}} args
   */
  constructor({groups, groupNumber, testFiles, baseDirectory, timingManifest}) {
    if (!Number.isSafeInteger(groups) || groups < 1) {
      throw new Error(`--groups must be a positive integer, got: ${groups}`)
    }
    if (!Number.isSafeInteger(groupNumber) || groupNumber < 1 || groupNumber > groups) {
      throw new Error(`--group-number must be between 1 and ${groups}, got: ${groupNumber}`)
    }
    this._groups = groups
    this._groupNumber = groupNumber
    this._testFiles = testFiles
    this._baseDirectory = baseDirectory || process.cwd()
    this._timingManifest = this.normalizeTimingManifest(timingManifest)
  }

  /** @returns {string[]} */
  getGroupFiles() {
    const sorted = this.sortByWeightDescending(this.computeWeightedFiles())
    return this.distributeGreedily(sorted)[this._groupNumber - 1].files
  }

  /** @returns {SplitterFileEntry[]} */
  computeWeightedFiles() {
    return this._testFiles.map((filePath) => ({filePath, weight: this.computeWeight(filePath)}))
  }

  /** @param {string} filePath @returns {number} */
  computeWeight(filePath) {
    const duration = this.timingManifestDuration(filePath)
    if (duration !== undefined && duration > 0) return duration
    const relativePath = this.heuristicRelativePath(filePath)
    let weight = DEFAULT_WEIGHT
    const specDirMatch = relativePath.match(/^(?:(?:spec|test|__tests__|tests)\/)?([^/]+)\//u)
    if (specDirMatch && DIRECTORY_WEIGHTS[specDirMatch[1]] !== undefined) {
      weight = DIRECTORY_WEIGHTS[specDirMatch[1]]
    }
    if (/\.browser-spec\.(?:cjs|js|mjs)$/u.test(filePath)) {
      weight *= BROWSER_SPEC_MULTIPLIER
    }
    return weight
  }

  /** @param {ReturnType<typeof JSON.parse>} timingManifest @returns {Record<string, number>} */
  normalizeTimingManifest(timingManifest) {
    /** @type {Record<string, number>} */
    const normalized = {}
    if (!timingManifest || typeof timingManifest !== "object" || Array.isArray(timingManifest)) return normalized
    for (const [filePath, duration] of Object.entries(timingManifest)) {
      if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) continue
      try {
        normalized[canonicalTimingManifestPath(filePath)] = duration
      } catch (error) {
        if (!(error instanceof Error)) throw error
      }
    }
    return normalized
  }

  /** @param {string} filePath @returns {string} */
  heuristicRelativePath(filePath) {
    return path.relative(this._baseDirectory, filePath).replaceAll("\\", "/").replace(/^\.\//u, "")
  }

  /** @param {string} filePath @returns {string | undefined} */
  manifestRelativePath(filePath) {
    const relativePath = path.relative(this._baseDirectory, filePath)
    if (!relativePath || path.isAbsolute(relativePath)) return undefined
    if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) return undefined
    return canonicalTimingManifestPath(relativePath)
  }

  /** @param {string} filePath @returns {string[]} */
  timingManifestPaths(filePath) {
    const relativePath = this.manifestRelativePath(filePath)
    if (!relativePath) return []
    const projectRelativePath = canonicalTimingManifestPath(path.join(path.basename(this._baseDirectory), relativePath))
    return relativePath === projectRelativePath ? [relativePath] : [relativePath, projectRelativePath]
  }

  /** @param {string} filePath @returns {number | undefined} */
  timingManifestDuration(filePath) {
    for (const manifestPath of this.timingManifestPaths(filePath)) {
      if (Object.hasOwn(this._timingManifest, manifestPath)) return this._timingManifest[manifestPath]
    }
    return undefined
  }

  /** @returns {TimingManifestCoverage} */
  getTimingManifestCoverage() {
    const matchedManifestPaths = new Set()
    let measuredFiles = 0
    for (const filePath of this._testFiles) {
      let matchedDuration
      for (const manifestPath of this.timingManifestPaths(filePath)) {
        if (!Object.hasOwn(this._timingManifest, manifestPath)) continue
        matchedManifestPaths.add(manifestPath)
        matchedDuration = this._timingManifest[manifestPath]
        break
      }
      if (matchedDuration !== undefined && matchedDuration > 0) measuredFiles += 1
    }
    return {
      heuristicFiles: this._testFiles.length - measuredFiles,
      measuredFiles,
      staleEntries: Object.keys(this._timingManifest).length - matchedManifestPaths.size
    }
  }

  /** @param {SplitterFileEntry[]} files @returns {SplitterFileEntry[]} */
  sortByWeightDescending(files) {
    return [...files].sort((fileA, fileB) => {
      if (fileB.weight !== fileA.weight) return fileB.weight - fileA.weight
      return compareTimingManifestPaths(fileA.filePath, fileB.filePath)
    })
  }

  /** @param {SplitterFileEntry[]} sortedFiles @returns {GroupBucket[]} */
  distributeGreedily(sortedFiles) {
    /** @type {GroupBucket[]} */
    const buckets = Array.from({length: this._groups}, () => ({totalWeight: 0, files: []}))
    for (const entry of sortedFiles) {
      const lightest = this.findLightestBucket(buckets)
      lightest.files.push(entry.filePath)
      lightest.totalWeight += entry.weight
    }
    return buckets
  }

  /** @param {GroupBucket[]} buckets @returns {GroupBucket} */
  findLightestBucket(buckets) {
    let lightest = buckets[0]
    for (let index = 1; index < buckets.length; index += 1) {
      if (buckets[index].totalWeight < lightest.totalWeight) lightest = buckets[index]
    }
    return lightest
  }
}
