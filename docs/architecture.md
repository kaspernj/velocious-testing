# Architecture

## Dependency direction

`src/index.js`, context, events, and matchers form the browser-safe DSL. `src/runner.js` depends only on that core. `src/node/` depends inward on both and owns filesystem, URL, process, CLI, stack/source-location, and dynamic-import behavior. Nothing points to the full Velocious framework. Consumers may adapt the generic contracts downstream; this package never reaches outward to discover framework behavior.

Published build and declaration maps resolve to the shipped `src/` files. Those files support debugging only: the package export map remains the complete public module boundary, with no wildcard or source/internal subpath exports.

## Context identity and protocol

Registration state is explicit: each `TestContext` owns a registry, configuration, event emitter, declaration stack, and bound DSL. `createTestContext()` always isolates those values. The default uses the realm-wide versioned symbol `@velocious/testing.default-context.v1`; copies with protocol major 1/schema 1 reuse it, while incompatible values throw at import time. Result and structured event records include numeric protocol major 1.

A protocol-major change requires a new symbol, migration notes, dual-version compatibility guidance, and explicit rollback instructions. Additive schema changes should retain old readers. A rollback must restore the prior entry formats without leaving a context that a compatible physical copy can misinterpret.

## Runner contracts

The kernel owns selection, traversal, hook inheritance/order, retries, timeouts, console capture, cleanup, and accounting. Small collaborators stay replaceable:

- `attemptExecutor(input)` may wrap one lifecycle attempt and can invoke `input.defaultExecute()`.
- `testArgumentResolver(input)` returns callback arguments.
- `reporter.onEvent(event)` consumes stable structured events.
- The Node `importer(filePath)` owns module loading.

The default executor runs ordinary callbacks with outer-to-inner setup and inner-to-outer cleanup. Internal completion/failure discriminators never use the thrown value as a sentinel, so falsy throws and promise rejections remain failures through retries, accounting, and event reporting. Cleanup always exhausts every hook in reverse order. When more than one lifecycle step fails, recursive `errors` records preserve the primary failure followed by every teardown failure; this is an additive protocol-1 result field. The runner is sequential because console interception is process-global.

## Deferred adapters

Velocious application/configuration/database/mailer/request/model support, shared transactions, factories, browser scenarios, profiling, timing manifests, and duration-aware sharding are deliberately outside v1. They belong in separately versioned downstream adapters that depend on both systems, preventing dependency cycles. Adding one here would violate the package boundary and should be rolled back rather than hidden behind optional discovery.

Releases are independent semantic versions. Compatibility changes update tests, README, this document, and a changelog fragment in the same review.
