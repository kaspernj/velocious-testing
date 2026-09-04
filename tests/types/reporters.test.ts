import {createJsonReporter, type JsonReporterOptions} from "../../build/reporters.js"
import type {Reporter} from "../../build/runner.js"

const chunks: string[] = []
const options: JsonReporterOptions = {write: async (chunk) => { chunks.push(chunk) }}
const reporter: Reporter = createJsonReporter(options)

await reporter.onEvent({protocolMajor: 1, timestamp: 1, type: "run:start"})

void chunks

// @ts-expect-error A JSON reporter requires a writer.
createJsonReporter({})

// @ts-expect-error Writers receive serialized strings.
createJsonReporter({write: (chunk: number) => { void chunk }})
