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

Run explicit files or let the CLI recursively discover `*.test.*`, `*.spec.*`, and `*-test.*` files under `test`, `tests`, `spec`, or `__tests__`:

```sh
npx velocious-test
npx velocious-test tests/unit.test.js tests/api.test.js:42
npx velocious-test --include-tag unit --exclude-tag slow --example "adds" --setup tests/setup.js
```

Failures and an empty selection exit nonzero. `--retries COUNT` and `--timeout MS` set run defaults; declarations may use `retries`, `timeoutMs`, or `timeoutSeconds`. `configureTests()` sets `excludeTags`, `retries`, `defaultTimeoutMs`/`defaultTimeoutSeconds`, `consoleOutput`, and `failedConsoleOutputMaxLines` defaults.

## Public API

The browser/Metro-safe root exports `describe`, `it`, `fit`, all four lifecycle hooks, `expect`, `arrayContaining`, `objectContaining`, `waitForEvent`, `configureTests`, `defaultTestContext`, `createTestContext()`, and `installGlobals()`. The expectation API provides `not`, `toBe`, `toEqual`, `toBeLessThan`, `toBeLessThanOrEqual`, `toBeGreaterThan`, `toBeGreaterThanOrEqual`, `toBeCloseTo`, `toHaveLength`, `toBeDefined`, `toBeInstanceOf`, `toBeFalse`, `toBeNull`, `toBeUndefined`, `toBeTrue`, `toBeTruthy`, `toContain`, `toContainEqual`, `toInclude`, `toMatch`, `toMatchObject`, `toThrow`, `toThrowError`, `toHaveAttributes`, and `toChange`/`andChange` expectations. Throw matchers recognize arbitrary thrown or rejected JavaScript values, including falsy values; regular-expression matching is repeatable and does not change a caller-owned expression's `lastIndex`.

`@velocious/testing/runner` exports `PROTOCOL_MAJOR`, `TestRunner`, `runTests()`, and the ordinary lifecycle `defaultAttemptExecutor`. The runner owns nested traversal and hook order, focus/tags/example/path-line filtering, retries, lifecycle timeouts, console capture, structured events, cleanup, and fresh accounting for repeated runs. Completion and failure are tracked explicitly, so every thrown or rejected value is a failure regardless of truthiness. Every teardown runs in reverse order even after another teardown fails; recursive error records retain the primary and all cleanup failures. Its focused collaborators are `attemptExecutor`, `testArgumentResolver`, and `reporter`; isolated contexts are passed as `{context}`. Reporter promises are awaited before execution advances.

Include tags require every requested tag by default; `includeTagMode: "any"` selects a test with at least one requested tag. `focusedTestsBypassIncludeTags: true` keeps focused tests eligible when includes do not match, while exclusions still win. A custom executor may set `attemptExecutorOwnsTimeout: true` to receive the declared `timeoutMs` without the kernel abandoning it at that deadline; that executor must apply its own timeout and settle only after its bounded cleanup. `TestRunner#cleanupActiveSuites()` idempotently runs active `afterAll` hooks once in reverse scope order for interruption handling. An empty suite name is structural and is omitted from full test names, allowing adapters to represent global hooks without changing selection or reporting.

```js
import {createTestContext} from "@velocious/testing"
import {runTests} from "@velocious/testing/runner"

const context = createTestContext()
context.describe("isolated", () => context.it("works", () => {}))
const result = await runTests({context})
```

`installGlobals(target?, context?)` installs bound DSL methods explicitly; importing the package never mutates globals. Node-only discovery, importing, argument parsing, source locations, console reporting, and `runNodeTests()` live at `@velocious/testing/node`. `runNodeTests()` forwards the programmatic runner selection, timeout-ownership, collaborator, and reporting options to the same kernel.

## Compatibility and plugins

Compatible physical copies share the default context through `Symbol.for("@velocious/testing.default-context.v1")`. The context, event, and result protocol has numeric major `1` and schema `1`; an incompatible copy throws instead of silently splitting registration trees. Isolated contexts never share registry, config, or events.

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
