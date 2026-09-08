# Terminal resource failures

A sequential run can depend on one shared resource that becomes unsafe to reuse. Its owner may throw an ordinary `Error` with this explicit property:

```js
const error = new Error("Shared resource can no longer be used", {cause})
error.terminalResource = {scope: "run", name: "shared-resource"}
throw error
```

`scope` must be `"run"` and `name` a nonempty string. Recognition is structural and recursive through `cause` and `AggregateError.errors`; no message matching, framework imports or browser knowledge is involved. This contract aborts the entire selected run. It is not a resource scheduler and provides no cancellation or replacement policy.

The originating attempt fails once, without retry. Later selected callbacks and unentered suite hooks do not start. Every entered scope still performs its usual reverse-order cleanup exactly once. A terminal `beforeAll` failure is a suite error, with all its selected descendants not run. A terminal cleanup error also fails the run and blocks later suites.

Results add `terminalFailure: {fullName, error}` and, when nonzero, `counts.notRun`. Each affected declaration appears in `nonRunTests` with `status: "not-run"` and `reason` referencing the originating terminal failure. The runner emits `test:not-run` with that record; it emits no `test:start`, attempt, or `test:finish` for those declarations. `attempt:finish` includes `terminalFailure` when retry has been suppressed. Declared skips/todos keep their existing status/count/events. `counts.total` remains selected runnable declarations, so terminal runs satisfy `passed + failed + notRun === total`. Ordinary setup failures retain their existing compatibility behavior.

Error records retain full stacks, recursive causes and aggregate members, with circular references represented explicitly. Lifecycle aggregation preserves an existing aggregate instead of flattening away its own stack/cause/marker; the new aggregate also has the primary failure as its cause. Console and standalone CLI output include causes and not-run reasons, and the CLI exits nonzero even if no test body started.

## Compatibility

This is an additive runner/result/event extension to protocol major 1. Context schema 3 and declaration registration are unchanged; root and runner remain browser/Metro safe. Existing successful-run count shapes remain unchanged. Reporter adapters must handle `test:not-run`, preserve the new error fields, and use overall `status` for run success rather than only `counts.failed`. Result consumers must allow `not-run` alongside declared `skipped`/`todo` records.

Upgrade the executing runner and any framework reporter adapter before enabling a resource owner that emits this contract. Older runner versions ignore the marker and may retry or execute later callbacks. Compatible context registration across package copies alone does not guarantee terminal-run support; resolve and verify the actual executing runner version. No browser replacement, dependency import, or implicit recovery is supplied by this package.
