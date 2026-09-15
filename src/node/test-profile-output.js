// @ts-check

import fs from "node:fs/promises"
import path from "node:path"
import { roundProfileDuration } from "./test-profiler.js"
import { validateTimingManifest } from "./timing-manifest.js"

const FORBIDDEN_PROFILE_FIELDS = new Set([
  "bind",
  "binds",
  "checkoutname",
  "credential",
  "credentials",
  "databasename",
  "error",
  "host",
  "password",
  "reusekey",
  "sql",
  "stack",
  "tenant",
  "username"
])
const PHASE_ORDER = [
  "discovery",
  "imports",
  "testing config/global setup",
  "beforeAll",
  "beforeEach",
  "test body",
  "afterEach",
  "afterAll",
  "custom",
  "runner overhead",
  "total"
]
let atomicWriteSequence = 0

/**
 * @typedef {object} TestProfileOptions
 * @property {string} cwd
 * @property {boolean} profile
 * @property {string} [profileJsonPath]
 * @property {string} [timingManifestPath]
 * @property {string} [timingManifestOutputPath]
 */
/**
 * @typedef {object} ResolvedTestProfileOptions
 * @property {boolean} profile
 * @property {string | undefined} profileJsonPath
 * @property {string | undefined} timingManifestPath
 * @property {string | undefined} timingManifestOutputPath
 */
/**
 * @typedef {object} TestProfileOutputOptions
 * @property {import("./test-profiler.js").TestProfileDocument} profile
 * @property {string} [profileJsonPath]
 * @property {string} [timingManifestOutputPath]
 */
/** @typedef {{profileJsonPath?: string, timingManifestOutputPath?: string}} TestProfileSummaryOutputs */

/**
 * Resolves and validates profiling paths before test discovery starts.
 * @param {TestProfileOptions} options
 * @returns {ResolvedTestProfileOptions}
 */
export function resolveTestProfileOptions({cwd, profile, profileJsonPath, timingManifestPath, timingManifestOutputPath}) {
  const resolvedProfileJsonPath = profileJsonPath ? path.resolve(cwd, profileJsonPath) : undefined
  const resolvedTimingManifestPath = timingManifestPath ? path.resolve(cwd, timingManifestPath) : undefined
  const resolvedTimingManifestOutputPath = timingManifestOutputPath ? path.resolve(cwd, timingManifestOutputPath) : undefined

  if (resolvedProfileJsonPath && resolvedTimingManifestOutputPath && resolvedProfileJsonPath === resolvedTimingManifestOutputPath) {
    throw new Error("Test profiling output paths must be different")
  }
  if (resolvedTimingManifestPath && (
    resolvedProfileJsonPath === resolvedTimingManifestPath ||
    resolvedTimingManifestOutputPath === resolvedTimingManifestPath
  )) {
    throw new Error("Test profiling outputs must not overwrite --timing-manifest input")
  }
  return {
    profile: profile || Boolean(resolvedProfileJsonPath || resolvedTimingManifestOutputPath),
    profileJsonPath: resolvedProfileJsonPath,
    timingManifestPath: resolvedTimingManifestPath,
    timingManifestOutputPath: resolvedTimingManifestOutputPath
  }
}

/** @param {string | undefined} timingManifestPath @returns {Promise<Record<string, number> | undefined>} */
export async function loadTimingManifest(timingManifestPath) {
  if (!timingManifestPath) return undefined
  let content
  try {
    content = await fs.readFile(timingManifestPath, "utf8")
  } catch (error) {
    throw new Error(`Failed to read timing manifest: ${timingManifestPath}`, {cause: error})
  }
  let parsed
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    throw new Error(`Failed to parse timing manifest: ${timingManifestPath}`, {cause: error})
  }
  return validateTimingManifest(parsed, {source: `Timing manifest ${timingManifestPath}`})
}

/**
 * Recursively rejects fields that are forbidden from rich profile output.
 * @param {ReturnType<typeof JSON.parse>} value - Profile value.
 * @param {string} [pathName] - Diagnostic field path.
 * @returns {void}
 */
function assertProfilePrivacy(value, pathName = "profile") {
  if (!value || typeof value !== "object") return

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      assertProfilePrivacy(value[index], `${pathName}[${index}]`)
    }
    return
  }

  for (const [key, childValue] of Object.entries(value)) {
    if (FORBIDDEN_PROFILE_FIELDS.has(key.toLowerCase())) {
      throw new Error(`Forbidden profile field: ${pathName}.${key}`)
    }

    assertProfilePrivacy(childValue, `${pathName}.${key}`)
  }
}

/**
 * Recursively rounds duration fields and rejects invalid duration values.
 * @param {ReturnType<typeof JSON.parse>} value - Profile value.
 * @param {string | undefined} [parentKey] - Parent field name.
 * @returns {void}
 */
function normalizeDurations(value, parentKey) {
  if (!value || typeof value !== "object") return

  if (Array.isArray(value)) {
    for (const childValue of value) normalizeDurations(childValue, parentKey)
    return
  }

  for (const [key, childValue] of Object.entries(value)) {
    const durationField = key.endsWith("Ms") || parentKey === "cpuMs"

    if (durationField && typeof childValue === "number") {
      if (typeof childValue !== "number" || !Number.isFinite(childValue) || childValue < 0) {
        throw new Error(`Invalid test profile duration field: ${key}`)
      }

      value[key] = roundProfileDuration(childValue)
      continue
    }

    if (key.endsWith("Ms") && key !== "cpuMs") {
      throw new Error(`Invalid test profile duration field: ${key}`)
    }

    normalizeDurations(childValue, key)
  }
}

/**
 * Returns a normalized JSON-safe rich profile.
 * @param {import("./test-profiler.js").TestProfileDocument} profile - Rich profile document.
 * @returns {import("./test-profiler.js").TestProfileDocument} - Normalized document.
 */
function normalizedProfile(profile) {
  if (profile?.schema !== "velocious.test-profile" || profile?.schemaVersion !== 1) {
    throw new Error("Invalid Velocious test profile schema")
  }

  assertProfilePrivacy(profile)
  const normalized = /** @type {import("./test-profiler.js").TestProfileDocument} */ (JSON.parse(JSON.stringify(profile)))

  normalizeDurations(normalized)
  return normalized
}

/**
 * Writes text through a same-directory temporary file and atomic rename.
 * @param {string} outputPath - Final output path.
 * @param {string} content - Complete output content.
 * @returns {Promise<void>} - Resolves after rename.
 */
async function atomicWrite(outputPath, content) {
  const directory = path.dirname(outputPath)
  const sequence = ++atomicWriteSequence
  const temporaryPath = path.join(directory, `.${path.basename(outputPath)}.${process.pid}.${sequence}.tmp`)
  let temporaryFileCreated = false

  await fs.mkdir(directory, {recursive: true})

  try {
    await fs.writeFile(temporaryPath, content, {encoding: "utf8", flag: "wx"})
    temporaryFileCreated = true
    await fs.rename(temporaryPath, outputPath)
  } catch (error) {
    if (temporaryFileCreated) {
      try {
        await fs.unlink(temporaryPath)
      } catch (cleanupError) {
        if (!(cleanupError instanceof Error) || !("code" in cleanupError) || cleanupError.code !== "ENOENT") {
          throw new AggregateError(
            [error, cleanupError],
            `Failed to write and clean up test profile output: ${outputPath}`,
            {cause: cleanupError}
          )
        }
      }
    }

    throw error
  }
}

/**
 * Creates a sorted plain timing manifest.
 * @param {import("./test-profiler.js").TestProfileDocument} profile - Rich profile document.
 * @returns {import("./timing-manifest.js").TimingManifest} - Sorted file-duration map.
 */
export function timingManifestFromProfile(profile) {
  /** @type {Record<string, number>} */
  const manifest = {}
  const validatedManifest = validateTimingManifest(profile.timingManifest || {}, {source: "Test profile timing manifest"})

  for (const [filePath, durationMs] of Object.entries(validatedManifest)) {
    manifest[filePath] = roundProfileDuration(durationMs)
  }

  return manifest
}

/**
 * Atomically writes a canonical splitter-compatible timing manifest.
 * @param {object} args - Output arguments.
 * @param {string} args.outputPath - Final output path.
 * @param {import("./timing-manifest.js").TimingManifest} args.timingManifest - Validated or candidate timing manifest.
 * @returns {Promise<void>} - Resolves after atomic replacement.
 */
export async function writeTimingManifest({outputPath, timingManifest}) {
  const normalized = validateTimingManifest(timingManifest)
  /** @type {Record<string, number>} */
  const rounded = {}

  for (const [filePath, durationMs] of Object.entries(normalized)) {
    rounded[filePath] = roundProfileDuration(durationMs)
  }

  await atomicWrite(outputPath, `${JSON.stringify(rounded, null, 2)}\n`)
}

/**
 * Atomically writes requested test profile outputs.
 * @param {TestProfileOutputOptions} args - Output options.
 * @returns {Promise<void>} - Resolves after all requested writes.
 */
export async function writeTestProfileOutputs({profile, profileJsonPath, timingManifestOutputPath}) {
  const normalized = normalizedProfile(profile)
  const timingManifest = timingManifestFromProfile(normalized)

  normalized.timingManifest = timingManifest

  if (profileJsonPath) {
    await atomicWrite(profileJsonPath, `${JSON.stringify(normalized, null, 2)}\n`)
  }

  if (timingManifestOutputPath) {
    await writeTimingManifest({outputPath: timingManifestOutputPath, timingManifest})
  }
}

/**
 * Formats a compact Benchmark-style console summary.
 * @param {import("./test-profiler.js").TestProfileDocument} profile - Rich profile document.
 * @param {TestProfileSummaryOutputs} [outputs] - Written output paths.
 * @returns {string} - Console summary.
 */
export function formatTestProfileSummary(profile, outputs = {}) {
  const lines = [
    "Test profile",
    "Phase".padEnd(31) + "Count".padStart(5) + "Real ms".padStart(13) + "CPU ms".padStart(13)
  ]

  for (const phase of PHASE_ORDER) {
    const aggregate = profile.phases?.[phase]

    if (!aggregate) continue

    lines.push(
      phase.padEnd(31) +
      String(aggregate.count).padStart(5) +
      aggregate.totalMs.toFixed(3).padStart(13) +
      aggregate.cpuMs.total.toFixed(3).padStart(13)
    )
  }

  if (profile.pools?.length > 0) {
    lines.push("Pools")

    for (const pool of profile.pools) {
      lines.push(
        `Pool ${pool.identifier}: created=${pool.connectionCreation.count}` +
        ` failed=${pool.connectionCreation.failedCount}` +
        ` wait=${pool.checkoutWait.count}/${pool.checkoutWait.totalMs.toFixed(3)}ms` +
        ` timeouts=${pool.checkoutTimeoutCount}` +
        ` reaped=${pool.idleReap.disposalCount}` +
        ` peak=${pool.peakLiveConnections}`
      )
    }
  }

  if (outputs.profileJsonPath) lines.push(`Rich JSON: ${outputs.profileJsonPath}`)
  if (outputs.timingManifestOutputPath) lines.push(`Timing manifest: ${outputs.timingManifestOutputPath}`)

  return lines.join("\n")
}
