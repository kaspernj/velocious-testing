// @ts-check

import fs from "node:fs/promises"
import path from "node:path"
import {fileURLToPath, pathToFileURL} from "node:url"

import {defaultTestContext} from "../context.js"
import {runTests} from "../runner.js"

const TEST_FILE_PATTERN = /(?:\.test|\.spec|-test)\.(?:js|mjs|cjs)$/u
const DECLARATION_INTERNAL_PATHS = new Set([
  fileURLToPath(import.meta.url),
  fileURLToPath(new URL("../context.js", import.meta.url))
].map((filePath) => path.resolve(filePath)))
let importSequence = 0

/**
 * @typedef {object} CliOptions
 * @property {string[]} candidates
 * @property {string[]} includeTags
 * @property {string[]} excludeTags
 * @property {string[]} examples
 * @property {string[]} setupFiles
 * @property {boolean} [help]
 * @property {number} [retries]
 * @property {number} [timeoutMs]
 */
/**
 * @typedef {Omit<import("../runner.js").TestRunnerOptions, "examples"> & {
 *   cwd?: string,
 *   candidates?: string[],
 *   examples?: Array<string | RegExp>,
 *   setupFiles?: string[],
 *   importer?: (filePath: string) => any | Promise<any>
 * }} RunNodeTestsOptions
 */

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

/** @param {string} directory @returns {Promise<string[]>} */
async function walkTests(directory) {
  const files = []
  const entries = await fs.readdir(directory, {withFileTypes: true})
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walkTests(target))
    else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) files.push(target)
  }
  return files
}

/**
 * @param {{cwd?: string, candidates?: string[]}} [options]
 * @returns {Promise<string[]>}
 */
export async function discoverTestFiles(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd())
  const candidates = options.candidates || []
  const targets = []
  if (candidates.length) {
    for (const candidate of candidates) targets.push(path.resolve(cwd, parsePathLine(candidate).path))
  } else {
    for (const conventional of ["test", "tests", "spec", "__tests__"]) {
      const target = path.join(cwd, conventional)
      if (await exists(target)) targets.push(target)
    }
  }

  const files = []
  for (const target of targets) {
    let stats
    try { stats = await fs.stat(target) } catch { throw new Error(`Test path does not exist: ${target}`) }
    if (stats.isDirectory()) files.push(...await walkTests(target))
    else if (stats.isFile()) files.push(target)
  }
  return [...new Set(files.map((file) => path.resolve(file)))].sort()
}

/** @param {string[]} argv @returns {CliOptions} */
export function parseCliArguments(argv) {
  /** @type {CliOptions} */
  const output = {candidates: [], includeTags: [], excludeTags: [], examples: [], setupFiles: []}
  const takesValue = new Set(["--include-tag", "--exclude-tag", "--example", "--setup", "--retries", "--timeout"])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--help" || argument === "-h") { output.help = true; continue }
    const equalIndex = argument.indexOf("=")
    const name = equalIndex >= 0 ? argument.slice(0, equalIndex) : argument
    let value = equalIndex >= 0 ? argument.slice(equalIndex + 1) : undefined
    if (takesValue.has(name) && value === undefined) {
      value = argv[index + 1]
      index += 1
    }
    if (takesValue.has(name) && (value === undefined || value === "")) throw new Error(`${name} requires a value`)
    const optionValue = value ?? ""
    if (name === "--include-tag") output.includeTags.push(optionValue)
    else if (name === "--exclude-tag") output.excludeTags.push(optionValue)
    else if (name === "--example") output.examples.push(optionValue)
    else if (name === "--setup") output.setupFiles.push(optionValue)
    else if (name === "--retries") output.retries = numericOption(name, optionValue)
    else if (name === "--timeout") output.timeoutMs = numericOption(name, optionValue)
    else if (name.startsWith("-")) throw new Error(`Unknown option: ${name}`)
    else output.candidates.push(argument)
  }
  return output
}

/** @param {string} name @param {string} value @returns {number} */
function numericOption(name, value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || !Number.isInteger(number)) throw new Error(`${name} must be a non-negative integer`)
  return number
}

/** @param {string | undefined} ownerFilePath @returns {{filePath?: string, line?: number}} */
export function captureDeclarationLocation(ownerFilePath) {
  const stack = new Error().stack?.split("\n") || []
  for (const stackLine of stack) {
    const match = stackLine.match(/(?:\(|\s)(file:\/\/.*?|\/[^"]*?):(\d+):(\d+)\)?$/u)
    if (!match) continue
    let filePath = match[1]
    if (filePath.startsWith("file://")) {
      try { filePath = fileURLToPath(filePath) } catch { continue }
    }
    const resolvedFilePath = path.resolve(filePath)
    if (DECLARATION_INTERNAL_PATHS.has(resolvedFilePath)) continue
    return {filePath: resolvedFilePath, line: Number(match[2])}
  }
  return ownerFilePath ? {filePath: ownerFilePath} : {}
}

/** @param {string} filePath @returns {Promise<any>} */
export async function defaultImporter(filePath) {
  importSequence += 1
  const url = pathToFileURL(filePath)
  url.searchParams.set("velociousTestingRun", String(importSequence))
  return await import(url.href)
}

/**
 * @param {RunNodeTestsOptions} [options]
 * @returns {Promise<import("../runner.js").TestRunResult & {files: string[]}>}
 */
export async function runNodeTests(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd())
  const context = options.context || defaultTestContext
  const importer = options.importer || defaultImporter
  context.reset({config: true})
  /** @type {string | undefined} */
  let ownerFilePath
  context.setDeclarationLocator(() => captureDeclarationLocation(ownerFilePath))

  for (const setup of options.setupFiles || []) {
    ownerFilePath = path.resolve(cwd, parsePathLine(setup).path)
    await importer(ownerFilePath)
  }

  const files = await discoverTestFiles({cwd, candidates: options.candidates})
  const lineFilters = {...(options.lineFilters || {})}
  for (const candidate of options.candidates || []) {
    const parsed = parsePathLine(candidate)
    if (parsed.line !== undefined) {
      const filePath = path.resolve(cwd, parsed.path)
      ;(lineFilters[filePath] ||= []).push(parsed.line)
    }
  }
  for (const file of files) {
    ownerFilePath = file
    await importer(file)
  }
  ownerFilePath = undefined
  const examples = (options.examples || []).map((/** @type {string | RegExp} */ example) => example instanceof RegExp ? example : new RegExp(example, "u"))
  const result = await runTests({
    context,
    includeTags: options.includeTags,
    includeTagMode: options.includeTagMode,
    excludeTags: options.excludeTags,
    focusedTestsBypassIncludeTags: options.focusedTestsBypassIncludeTags,
    ignoreFocus: options.ignoreFocus,
    omitEmptySuiteNames: options.omitEmptySuiteNames,
    examples,
    lineFilters,
    retries: options.retries,
    timeoutMs: options.timeoutMs,
    reporter: options.reporter,
    attemptExecutor: options.attemptExecutor,
    attemptExecutorOwnsTimeout: options.attemptExecutorOwnsTimeout,
    testArgumentResolver: options.testArgumentResolver,
    suiteHookExecutor: options.suiteHookExecutor
  })
  return {...result, files}
}

/** @returns {string} */
export function cliHelp() {
  return `Usage: velocious-test [options] [path[:line] ...]\n\nOptions:\n  --include-tag TAG   Require a tag (repeatable)\n  --exclude-tag TAG   Exclude a tag (repeatable)\n  --example PATTERN   Match a full test description (repeatable)\n  --setup FILE        Import a setup file before tests (repeatable)\n  --retries COUNT     Retry failed tests\n  --timeout MS        Default lifecycle timeout\n  -h, --help          Show this help\n`
}
