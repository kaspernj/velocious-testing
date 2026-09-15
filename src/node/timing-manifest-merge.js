// @ts-check

import path from "node:path"

/** @typedef {{inputPaths: string[], outputPath: string}} TimingManifestMergeArguments */

/**
 * Parses strict merge arguments and resolves their paths.
 * @param {string[]} argv
 * @param {{cwd?: string}} [options]
 * @returns {TimingManifestMergeArguments}
 */
export function parseTimingManifestMergeArguments(argv, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd())
  const inputPaths = []
  /** @type {string | undefined} */
  let outputPath

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--output" || argument.startsWith("--output=")) {
      const equals = argument.startsWith("--output=")
      const value = equals ? argument.slice("--output=".length) : argv[index + 1]
      if (!value || value.startsWith("-")) throw new Error("Missing value for --output")
      if (outputPath) throw new Error("--output may only be provided once")
      outputPath = path.resolve(cwd, value)
      if (!equals) index += 1
      continue
    }
    if (argument.startsWith("-")) throw new Error(`Unknown argument for timing-manifest:merge: ${argument}`)
    inputPaths.push(path.resolve(cwd, argument))
  }

  if (!outputPath) throw new Error("--output is required")
  if (inputPaths.length === 0) throw new Error("At least one rich test profile input is required")
  const uniqueInputPaths = new Set(inputPaths)
  if (uniqueInputPaths.size !== inputPaths.length) throw new Error("Each rich test profile input must be provided once")
  if (uniqueInputPaths.has(outputPath)) throw new Error("Timing manifest output must not overwrite an input profile")
  return {inputPaths, outputPath}
}
