# Reporters

## JSON reporter

`@velocious/testing/reporters` is browser/Metro-safe and exports a deterministic JSON reporter with an explicit writer:

```js
import {createJsonReporter} from "@velocious/testing/reporters"
import {runTests} from "@velocious/testing/runner"

const chunks = []
const reporter = createJsonReporter({
  write: async (chunk) => { chunks.push(chunk) }
})

await runTests({context, reporter})
```

The reporter ignores events other than `run:finish`. For every finish it awaits exactly one `write(JSON.stringify(event.result) + "\n")`. The output is the existing `TestRunResult` object in its existing property and array order; it is not sorted, projected, wrapped, or supplemented with the Node-only discovered `files`. Determinism describes serialization of a given result. Durations, stacks, and absolute source locations remain run- and environment-specific.

The writer may be synchronous or asynchronous. A serialization failure or thrown/rejected writer failure propagates from `onEvent`, and therefore from the runner that awaits it. The shared reporter does not select a stream, inspect the process, import Node modules, or determine an exit status.

## Console composition and slowest results

The same browser-safe entry exports `createConsoleReporter({write, writeError, failedConsoleOutputMaxLines, colorize})`, `composeReporters(reporters)`, `formatTestResultLine(result)`, `formatTestError(error)`, and `slowestTestResults(runResult, {limit})`. Writers may be synchronous or asynchronous and are awaited. Composition delivers each event sequentially in the supplied order and propagates failures. The console reporter derives human lines, causal errors, bounded final-attempt console output, suite failures, and the summary from protocol-1 records without inspecting Node streams or Velocious configuration.

`slowestTestResults` sums every attempt for each executed test, sorts slowest first without mutating the run result, and omits setup-blocked records that have no attempts. A positive limit truncates the projection; `0` returns every executed test. Callers own headings, destinations, and environment-specific location presentation.

## Node CLI selection

`velocious-test --reporter default` selects the generic console reporter's human result lines and summary. Omitting `--reporter` is identical. `velocious-test --reporter json` writes exactly one compact result document followed by a newline to stdout for each completed CLI run. Passed results exit zero; failed results, including an empty selection, exit one. Ordinary test, setup, and cleanup failures remain inside that JSON result rather than being duplicated as human diagnostics.

Argument, discovery, import, serialization, and writer failures are CLI failures rather than completed runs; they write a diagnostic to stderr and exit one without guaranteeing a JSON document. A settled startup failure is reported immediately rather than waiting for imported persistent handles to release the event loop. Help remains on stdout and exits zero.

In a JSON CLI process, the executable captures the original stdout writer exclusively for the reporter, then routes subsequent `process.stdout.write` calls to the original stderr sink for the remainder of that process. This also covers separately constructed `Console` instances backed by `process.stdout`; `console.log`, `console.info`, and `console.debug` follow the same route. `console.warn` and `console.error` already use stderr. Process-lifetime ownership covers unawaited work and work scheduled during `beforeExit`, keeping stdout machine-readable without changing captured attempt output. Reusable scoped console and stream routing can still restore the exact properties when its scope ends.
