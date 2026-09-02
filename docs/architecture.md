# Architecture

## Dependency direction

`src/index.js`, context, events, and matchers form the browser-safe DSL. `src/runner.js` depends only on that core. `src/node/` depends inward on both and owns filesystem, URL, process, CLI, stack/source-location, and dynamic-import behavior. Nothing points to the full Velocious framework. Consumers may adapt the generic contracts downstream; this package never reaches outward to discover framework behavior.

Published build and declaration maps resolve to the shipped `src/` files. Those files support debugging only: the package export map remains the complete public module boundary, with no wildcard or source/internal subpath exports.

## Context identity and protocol

Registration state is explicit: each `TestContext` owns a registry, configuration, event emitter, declaration stack, and bound DSL. `createTestContext()` always isolates those values. The default uses the realm-wide versioned symbol `@velocious/testing.default-context.v1`; copies with protocol major 1/schema 1 reuse it, while incompatible values throw at import time. Result and structured event records include numeric protocol major 1.

A protocol-major change requires a new symbol, migration notes, dual-version compatibility guidance, and explicit rollback instructions. Additive schema changes should retain old readers. A rollback must restore the prior entry formats without leaving a context that a compatible physical copy can misinterpret.

## Runner contracts

The kernel owns selection, traversal, hook inheritance/order, retries, timeouts, console capture, cleanup, and accounting. Small collaborators stay replaceable:

- `attemptExecutor(input)` may wrap one lifecycle attempt and can invoke `input.defaultExecute()`. With `attemptExecutorOwnsTimeout`, it receives `timeoutMs` but the kernel waits for the executor to apply timeout and bounded cleanup before settling.
- `testArgumentResolver(input)` returns callback arguments.
- `reporter.onEvent(event)` consumes stable structured events and may return a promise that the runner awaits before advancing.
- The Node `importer(filePath)` owns module loading.

The default executor runs ordinary callbacks with outer-to-inner setup and inner-to-outer cleanup. Internal completion/failure discriminators never use the thrown value as a sentinel, so falsy throws and promise rejections remain failures through retries, accounting, and event reporting. Cleanup always exhausts every hook in reverse order. When more than one lifecycle step fails, recursive `errors` records preserve the primary failure followed by every teardown failure; this is an additive protocol-1 result field. `cleanupActiveSuites()` shares idempotent cleanup promises with ordinary suite completion, so interruption cleanup runs active scopes inside-out without later double teardown. The runner is sequential because console interception is process-global.

The Node CLI appends compact execution time to each test result line by summing the existing attempt `durationMs` values. Tests blocked by suite setup have no attempts and are reported as not run. This is presentation derived from protocol-1 records; it does not add result or event fields.

Selection defaults remain strict and standalone-compatible: include filters require all requested tags and focused tests must still match includes. Downstream adapters can choose any-tag matching and focused include bypass independently; exclusion filters always take precedence. Empty suite names retain their legacy separators unless an adapter sets `omitEmptySuiteNames: true` for unnamed structural suites; that option omits them from full names, example matching, and reported test names. These are runner options and naming behavior only; they do not change the context protocol or declaration, event, and result records.

## Deferred adapters

Velocious application/configuration/database/mailer/request/model support, shared transactions, factories, browser scenarios, profiling, timing manifests, and duration-aware sharding are deliberately outside v1. They belong in separately versioned downstream adapters that depend on both systems, preventing dependency cycles. Adding one here would violate the package boundary and should be rolled back rather than hidden behind optional discovery.

Releases are independent semantic versions. Compatibility changes update tests, README, this document, and a changelog fragment in the same review.
