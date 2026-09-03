# @velocious/testing

An independently versioned, ESM-only testing DSL and standalone runner. This package is independent of Velocious: it has no dependency, peer dependency, runtime import, or dynamic resolution of the `velocious` package.

## Install and use

```sh
npm install --save-dev @velocious/testing
```

```js
import {afterEach, beforeEach, describe, expect, it} from "@velocious/testing"

describe("calculator", {tags: ["unit"]}, () => {
  beforeEach(() => {})
  afterEach(() => {})

  it("adds", () => expect(1 + 1).toEqual(2))
})
```

Declaration modifiers and table tests are available on the same bound DSL:

```js
import {describe, expect, it, test} from "@velocious/testing"

describe.only("calculator", () => {
  test("has an alias", () => {})
  it.skip("documents a disabled case")
  it.todo("documents unfinished behavior")
  it.each([[1, 2, 3], [2, 3, 5]])("adds row %#: %d + %d = %d", (left, right, sum) => {
    expect(left + right).toEqual(sum)
  })
})
```

`test` aliases `it`; `fit` aliases `it.only`; `xit` and `xtest` alias `it.skip`; and `fdescribe`/`xdescribe` alias `describe.only`/`describe.skip`. Skipped and todo suites still run their declaration callback to build a stable registry, but neither their test bodies nor their lifecycle hooks execute. `it.todo` accepts no callback.

`it.each(rows)` and `describe.each(rows)` require a non-empty, non-sparse rows array, spread array rows into positional callback arguments, and pass scalar or object rows as one argument. Names support `%%`, `%#`, `%s`, `%d`, `%j`, and `$path` for object rows. Generated declarations keep the table callsite for path-line selection and diagnostics.

Browser-safe test doubles use the default `mock` registry or an isolated scope:

```js
import {createMockScope, expect} from "@velocious/testing"

const mocks = createMockScope()
const send = mocks.fn().mockResolvedValueOnce({status: 202})
const service = {load(id) { return {id} }}
const load = mocks.spyOn(service, "load")

await send("queued")
service.load(7)
expect(send).toHaveBeenCalledWith("queued")
expect(load).toHaveBeenCalledTimes(1)
mocks.restoreAll()
```

Mocks record calls, return/throw results, successful constructor instances, and scope-global invocation order. Persistent behavior and FIFO one-shot implementation/return/resolve/reject helpers are chainable. Typed constructor return helpers require compatible instances, while resolved and rejected helpers require promise-returning call contracts; unconfigured mocks remain permissive. `mockClear()` removes history, `mockReset()` also removes behavior, and property-double `mockRestore()` reinstates exact captured ownership and descriptors. Scope-level `clearAll()`, `resetAll()`, and reverse-order `restoreAll()` are explicit; the runner does not perform magical cleanup. See [Browser-safe test doubles](docs/test-doubles.md) for descriptor rules and lifecycle details.

Promise and asymmetric assertions compose with the same equality engine, and custom matchers can extend it without Node-only formatting:

```js
expect.extend({
  toHaveId(received, id) {
    return {pass: this.equals(received, expect.objectContaining({id})), message: `Expected value to have id ${id}`}
  }
})

await expect(Promise.resolve({id: 7, name: "Ada"})).resolves.toEqual({
  id: expect.any(Number),
  name: expect.stringMatching(/^Ada/u)
})
```

Return or await promise assertions so the runner can apply its normal timeout, retry, and failure accounting. Recursive containing patterns are cycle-safe, and promise-like custom matcher results read `then` once while preserving its receiver. Positive equality and mock-argument failures include bounded, deterministic structural differences. See [Advanced matchers](docs/matchers.md) for settlement behavior, custom matcher validation and TypeScript augmentation.

Run explicit files or let the CLI recursively discover `*.test.*`, `*.spec.*`, and `*-test.*` files under `test`, `tests`, `spec`, or `__tests__`:

```sh
npx velocious-test
npx velocious-test tests/unit.test.js tests/api.test.js:42
npx velocious-test --include-tag unit --exclude-tag slow --example "adds" --setup tests/setup.js
```

Each test result line includes its execution time:

```text
✓ calculator adds (42ms)
✗ calculator waits (1.234s)
✗ calculator setup-dependent test (not run)
```

Durations below one second use integer milliseconds; longer durations use seconds with millisecond precision. Retried tests sum every attempt, while tests blocked by suite setup are reported as not run.

Failures and an empty selection exit nonzero. `--retries COUNT` and `--timeout MS` set run defaults; declarations may use `retries`, `timeoutMs`, or `timeoutSeconds`. `configureTests()` sets `excludeTags`, `retries`, `defaultTimeoutMs`/`defaultTimeoutSeconds`, `consoleOutput`, and `failedConsoleOutputMaxLines` defaults.

## Public API

The browser/Metro-safe root exports `describe`, `fdescribe`, `xdescribe`, `it`, `test`, `fit`, `xit`, `xtest`, all four lifecycle hooks, `expect`, `Expect`, `PromiseExpectation`, `anything`, `any`, `arrayContaining`, `objectContaining`, `stringContaining`, `stringMatching`, `waitForEvent`, `mock`, `createMockScope()`, `configureTests`, `CONTEXT_SCHEMA_VERSION`, `defaultTestContext`, `createTestContext()`, and `installGlobals()`. The expectation API provides `not`, `resolves`, `rejects`, `extend`, `toBe`, `toEqual`, `toBeLessThan`, `toBeLessThanOrEqual`, `toBeGreaterThan`, `toBeGreaterThanOrEqual`, `toBeCloseTo`, `toHaveLength`, `toBeDefined`, `toBeInstanceOf`, `toBeFalse`, `toBeNull`, `toBeUndefined`, `toBeTrue`, `toBeTruthy`, `toContain`, `toContainEqual`, `toInclude`, `toMatch`, `toMatchObject`, `toThrow`, `toThrowError`, `toHaveAttributes`, the five mock call matchers, and `toChange`/`andChange` expectations. Throw matchers recognize arbitrary thrown or rejected JavaScript values, including falsy values; regular-expression matching is repeatable and does not change a caller-owned expression's `lastIndex`.

`@velocious/testing/runner` exports `PROTOCOL_MAJOR`, `TestRunner`, `runTests()`, and the ordinary lifecycle `defaultAttemptExecutor`. The runner owns nested traversal and hook order, focus/tags/example/path-line filtering, retries, lifecycle timeouts, console capture, structured events, cleanup, and fresh accounting for repeated runs. Completion and failure are tracked explicitly, so every thrown or rejected value is a failure regardless of truthiness. Every teardown runs in reverse order even after another teardown fails; recursive error records retain the primary and all cleanup failures. Its focused collaborators are `attemptExecutor`, `testArgumentResolver`, and `reporter`; isolated contexts are passed as `{context}`. Reporter promises are awaited before execution advances.

Run results keep executed and setup-blocked records in `tests` and add explicit declared non-runs in `nonRunTests` with `skipped` or `todo` status. Each matched explicit non-run emits `test:skip`. `counts.total` remains the number of runnable selected tests, while `counts.skipped` includes filtered declarations and declared non-runs exactly once. A selection matching only explicit skips or todos has `noMatches: false` and succeeds when no other error occurs.

Include tags require every requested tag by default; `includeTagMode: "any"` selects a test with at least one requested tag. `focusedTestsBypassIncludeTags: true` keeps focused tests eligible when includes do not match, while exclusions still win. A custom executor may set `attemptExecutorOwnsTimeout: true` to receive the declared `timeoutMs` without the kernel abandoning it at that deadline; that executor must apply its own timeout and settle only after its bounded cleanup. `TestRunner#cleanupActiveSuites()` idempotently runs active `afterAll` hooks once in reverse scope order for interruption handling. Empty suite names retain their legacy separators by default; adapters that use unnamed structural suites can set `omitEmptySuiteNames: true` to omit them consistently from full names, example matching, and reporting.

```js
import {createTestContext} from "@velocious/testing"
import {runTests} from "@velocious/testing/runner"

const context = createTestContext()
context.describe("isolated", () => context.it("works", () => {}))
const result = await runTests({context})
```

`installGlobals(target?, context?)` installs bound DSL methods explicitly; importing the package never mutates globals. Node-only discovery, importing, argument parsing, source locations, console reporting, and `runNodeTests()` live at `@velocious/testing/node`. `runNodeTests()` forwards the programmatic runner selection, naming, timeout-ownership, collaborator, and reporting options to the same kernel.

## Compatibility and plugins

Compatible physical copies share the default context through `Symbol.for("@velocious/testing.default-context.v1")`. The context, event, and result protocol has numeric major `1` and schema `3`; an incompatible copy throws instead of silently reusing or splitting registration trees. Schema 2 added declaration state and table arguments plus additive non-run results/events; schema 3 identifies contexts whose public `expect` supports the advanced matcher engine. Schema-2 and schema-3 physical copies cannot coexist in one realm, because the older context would expose an incompatible matcher surface. Upgrade every copy together before importing tests. Isolated contexts never share registry, config, or events. See [Declaration states and context-schema migration](docs/declaration-state.md).

Plugins that expose testing helpers should declare `@velocious/testing` as a peer dependency and import its public entries. They should not bundle a private physical copy or depend on the full Velocious framework for generic test behavior. Framework-specific adapters remain downstream.

See [Architecture](docs/architecture.md) for dependency direction and deferred scope, and [Releasing](docs/releasing.md) for the independent release workflow.

## Node support

Node 20, 22, and 24 are supported. The root and runner entries contain no Node built-ins; only `@velocious/testing/node` and `velocious-test` require Node.

Published source and declaration maps resolve to source files included for debugging. The explicit package export map remains authoritative: shipped `src/` files are not public subpath exports.

## Development

The canonical source-independent Ubuntu 26.04/Node 24 environment uses the root `Dockerfile` and `compose.yml`. It runs as UID/GID 1000 and binds the complete development home; the image does not copy source or install package dependencies.

```sh
cp .env.example .env
docker compose up --build --detach dev
docker compose exec -T dev npm ci
docker compose exec -T dev npm run check
docker compose exec -T dev npm run verify:docker-dev-environment
```

Use a distinct `COMPOSE_PROJECT_NAME` and `DEV_HOME_PATH` for concurrent isolated checkouts. Generated `build/` files and local tarballs are ignored. TensorBuzz validates the complete suite on pinned Node 20/22/24 releases and runs the remaining quality/package gates once; `release-patch` remains the sole release authority.
