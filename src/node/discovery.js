// @ts-check

import fs from "node:fs/promises"
import path from "node:path"

const DEFAULT_TEST_FILE_PATTERN = /(?:\.test|\.spec|-test)\.(?:js|mjs|cjs)$/u
const DEFAULT_DIRECTORIES = ["test", "tests", "spec", "__tests__"]
const DEFAULT_IGNORED_NAMES = [".git", "node_modules"]

/**
 * @typedef {object} TestDiscoveryOptions
 * @property {string} [cwd]
 * @property {string[]} [candidates]
 * @property {string[]} [directories]
 * @property {RegExp} [filePattern]
 * @property {string[]} [ignoredNames]
 */
/** @typedef {Record<string, number[]>} TestLineFilters */

/** @param {string} value @returns {string} */
function portablePath(value) { return value.replaceAll("\\", "/") }

/** @param {string} candidate @returns {{path: string, line?: number}} */
export function parsePathLine(candidate) {
  const normalized = portablePath(candidate)
  const match = normalized.match(/^(.*):(\d+)$/u)
  if (!match) return {path: normalized}
  return {path: match[1], line: Number(match[2])}
}

/** @param {string} target @returns {Promise<boolean>} */
async function exists(target) {
  try { await fs.access(target); return true } catch { return false }
}

/** @param {string} cwd @param {string} candidate @returns {Promise<string>} */
async function resolveCandidate(cwd, candidate) {
  if (path.isAbsolute(candidate)) return path.resolve(candidate)
  const direct = path.resolve(cwd, candidate)
  const baseName = path.basename(cwd)
  const portableCandidate = portablePath(candidate)
  if (portableCandidate === baseName || portableCandidate.startsWith(`${baseName}/`)) {
    const basePrefixed = path.resolve(path.dirname(cwd), candidate)
    if (await exists(basePrefixed)) return basePrefixed
  }
  return direct
}

/**
 * @param {string} directory
 * @param {RegExp} filePattern
 * @param {Set<string>} ignoredNames
 * @returns {Promise<string[]>}
 */
async function walkTests(directory, filePattern, ignoredNames) {
  const files = []
  const entries = await fs.readdir(directory, {withFileTypes: true})
  for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (ignoredNames.has(entry.name) || entry.name.startsWith(".")) continue
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walkTests(target, filePattern, ignoredNames))
    else if (entry.isFile()) {
      filePattern.lastIndex = 0
      if (filePattern.test(entry.name)) files.push(target)
    }
  }
  return files
}

/**
 * Discovers test files under explicit candidates or caller-selected conventional directories.
 * @param {TestDiscoveryOptions} [options]
 * @returns {Promise<string[]>}
 */
export async function discoverTestFiles(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd())
  const candidates = options.candidates || []
  const filePattern = options.filePattern || DEFAULT_TEST_FILE_PATTERN
  const ignoredNames = new Set([...DEFAULT_IGNORED_NAMES, ...(options.ignoredNames || [])])
  const targets = []

  if (candidates.length > 0) {
    for (const candidate of candidates) targets.push(await resolveCandidate(cwd, parsePathLine(candidate).path))
  } else {
    for (const directory of options.directories || DEFAULT_DIRECTORIES) {
      const target = path.resolve(cwd, directory)
      if (await exists(target)) targets.push(target)
    }
  }

  const files = []
  for (const target of targets) {
    let stats
    try { stats = await fs.stat(target) } catch { throw new Error(`Test path does not exist: ${target}`) }
    if (stats.isDirectory()) files.push(...await walkTests(target, filePattern, ignoredNames))
    else if (stats.isFile()) files.push(target)
  }
  return [...new Set(files.map((file) => path.resolve(file)))].sort()
}

/**
 * @param {Pick<TestDiscoveryOptions, "cwd" | "candidates">} [options]
 * @returns {TestLineFilters}
 */
export function lineFiltersFromCandidates(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd())
  /** @type {Record<string, number[]>} */
  const lineFilters = {}

  for (const candidate of options.candidates || []) {
    const parsed = parsePathLine(candidate)
    if (parsed.line === undefined) continue
    const portableCandidate = portablePath(parsed.path)
    const baseName = path.basename(cwd)
    const filePath = !path.isAbsolute(parsed.path) &&
      (portableCandidate === baseName || portableCandidate.startsWith(`${baseName}/`))
      ? path.resolve(path.dirname(cwd), parsed.path)
      : path.resolve(cwd, parsed.path)
    const lines = lineFilters[filePath] ||= []
    if (!lines.includes(parsed.line)) lines.push(parsed.line)
  }

  return lineFilters
}
