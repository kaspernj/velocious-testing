// @ts-check

/**
 * @typedef {object} CliOptions
 * @property {string[]} candidates
 * @property {string[]} includeTags
 * @property {string[]} excludeTags
 * @property {string[]} examples
 * @property {string[]} setupFiles
 * @property {"default" | "json"} [reporter]
 * @property {boolean} [help]
 * @property {number} [retries]
 * @property {number} [timeoutMs]
 * @property {number} [groups]
 * @property {number} [groupNumber]
 * @property {boolean} [profile]
 * @property {string} [profileJsonPath]
 * @property {string} [timingManifestPath]
 * @property {string} [timingManifestOutputPath]
 */
/** @typedef {{options: CliOptions, remainingArguments: string[]}} TestCliArgumentExtraction */

const VALUE_OPTIONS = new Map([
  ["--tag", "includeTag"],
  ["--include-tag", "includeTag"],
  ["-t", "includeTag"],
  ["--exclude-tag", "excludeTag"],
  ["--skip-tag", "excludeTag"],
  ["-x", "excludeTag"],
  ["--example", "example"],
  ["--name", "example"],
  ["-e", "example"],
  ["--setup", "setup"],
  ["--retry", "retries"],
  ["--retries", "retries"],
  ["--timeout", "timeoutMs"],
  ["--reporter", "reporter"],
  ["--groups", "groups"],
  ["--group-number", "groupNumber"],
  ["--profile-json", "profileJsonPath"],
  ["--timing-manifest", "timingManifestPath"],
  ["--timing-manifest-output", "timingManifestOutputPath"]
])

/** @returns {CliOptions} */
function emptyCliOptions() {
  return {candidates: [], includeTags: [], excludeTags: [], examples: [], setupFiles: []}
}

/** @param {string} value @returns {string[]} */
function splitTags(value) {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean)
}

/** @param {string} name @param {string} value @returns {number} */
function nonNegativeInteger(name, value) {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) throw new Error(`${name} must be a non-negative integer`)
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw new Error(`${name} must be a non-negative integer`)
  return number
}

/** @param {string} name @param {string} value @returns {number} */
function positiveInteger(name, value) {
  if (!/^[1-9]\d*$/u.test(value)) throw new Error(`${name} must be a positive integer`)
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw new Error(`${name} must be a positive integer`)
  return number
}

/** @param {CliOptions} options @returns {void} */
function validateGroups(options) {
  if ((options.groups === undefined) !== (options.groupNumber === undefined)) {
    throw new Error("Both --groups and --group-number must be provided together")
  }
  if (options.groups !== undefined && options.groupNumber !== undefined && options.groupNumber > options.groups) {
    throw new Error(`--group-number must be between 1 and ${options.groups}`)
  }
}

/**
 * Applies one recognized value option.
 * @param {CliOptions} options
 * @param {string} name
 * @param {string} kind
 * @param {string} value
 * @returns {void}
 */
function applyValueOption(options, name, kind, value) {
  if (kind === "includeTag") options.includeTags.push(...splitTags(value))
  else if (kind === "excludeTag") options.excludeTags.push(...splitTags(value))
  else if (kind === "example") options.examples.push(value)
  else if (kind === "setup") options.setupFiles.push(value)
  else if (kind === "retries") options.retries = nonNegativeInteger(name, value)
  else if (kind === "timeoutMs") options.timeoutMs = nonNegativeInteger(name, value)
  else if (kind === "groups") options.groups = positiveInteger(name, value)
  else if (kind === "groupNumber") options.groupNumber = positiveInteger(name, value)
  else if (kind === "reporter") {
    if (value !== "default" && value !== "json") throw new Error("--reporter must be one of: default, json")
    options.reporter = value
  } else if (kind === "profileJsonPath") {
    options.profileJsonPath = value
    options.profile = true
  } else if (kind === "timingManifestPath") options.timingManifestPath = value
  else if (kind === "timingManifestOutputPath") {
    options.timingManifestOutputPath = value
    options.profile = true
  }
}

/**
 * Extracts package-owned test flags while preserving all other arguments for a downstream CLI.
 * @param {string[]} argv
 * @returns {TestCliArgumentExtraction}
 */
export function extractTestCliArguments(argv) {
  const options = emptyCliOptions()
  const remainingArguments = []
  let afterSeparator = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (afterSeparator) {
      remainingArguments.push(argument)
      continue
    }
    if (argument === "--") {
      afterSeparator = true
      remainingArguments.push(argument)
      continue
    }
    if (argument === "--help" || argument === "-h") {
      options.help = true
      continue
    }
    if (argument === "--profile") {
      options.profile = true
      continue
    }

    const equalIndex = argument.indexOf("=")
    const name = equalIndex >= 0 ? argument.slice(0, equalIndex) : argument
    const kind = VALUE_OPTIONS.get(name)
    if (!kind) {
      remainingArguments.push(argument)
      continue
    }

    let value = equalIndex >= 0 ? argument.slice(equalIndex + 1) : undefined
    if (value === undefined) {
      value = argv[index + 1]
      if (value !== undefined) index += 1
    }
    if (value === undefined || value === "") throw new Error(`${name} requires a value`)
    if (!["retries", "timeoutMs", "groups", "groupNumber"].includes(kind) && value.startsWith("-")) {
      throw new Error(`${name} requires a value`)
    }
    applyValueOption(options, name, kind, value)
  }

  options.includeTags = [...new Set(options.includeTags)]
  options.excludeTags = [...new Set(options.excludeTags)]
  validateGroups(options)
  return {options, remainingArguments}
}

/** @param {string[]} argv @returns {CliOptions} */
export function parseCliArguments(argv) {
  const {options, remainingArguments} = extractTestCliArguments(argv)
  let afterSeparator = false

  for (const argument of remainingArguments) {
    if (argument === "--" && !afterSeparator) {
      afterSeparator = true
      continue
    }
    if (!afterSeparator && argument.startsWith("-")) throw new Error(`Unknown option: ${argument.split("=", 1)[0]}`)
    options.candidates.push(argument)
  }
  return options
}

/** @param {string} value @returns {string} */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

/** @param {string[]} patterns @returns {RegExp[]} */
export function normalizeExamplePatterns(patterns) {
  return patterns.map((pattern) => {
    const regexMatch = pattern.match(/^\/(.+)\/([dgimsuvy]*)$/u)
    return regexMatch ? new RegExp(regexMatch[1], regexMatch[2]) : new RegExp(escapeRegExp(pattern), "u")
  })
}
