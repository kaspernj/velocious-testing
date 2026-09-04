// @ts-check

/** @typedef {{write: (chunk: string) => void | Promise<void>}} JsonReporterOptions */

/**
 * Creates a reporter that writes one compact JSON result for every finished run.
 * @param {JsonReporterOptions} options
 * @returns {import("./runner.js").Reporter}
 */
export function createJsonReporter({write}) {
  return {
    async onEvent(event) {
      if (event.type !== "run:finish") return
      await write(`${JSON.stringify(event.result)}\n`)
    }
  }
}
