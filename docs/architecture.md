# Architecture

## Dependency direction

`src/index.js`, context, events, matchers, and the internal equality/diff engine form the browser-safe DSL. `src/runner.js` depends only on that core. `src/node/` depends inward on both and owns filesystem, URL, process, CLI, stack/source-location, and dynamic-import behavior. Nothing points to the full Velocious framework. Consumers may adapt the generic contracts downstream; this package never reaches outward to discover framework behavior.

`src/equality.js` owns runtime-neutral deep comparison, asymmetric-value dispatch, stable value formatting, and bounded structural differences. `src/matchers.js` owns assertions, promise settlement dispatch, and the module-local custom matcher registry. Promise assertions return ordinary promises, so the existing runner lifecycle awaits them without matcher-specific runner coupling. Custom matcher registration does not attach to `TestContext` and therefore does not alter its shared protocol/schema state.

`src/mocks.js` is another browser-safe core leaf. A mock scope owns only function state, a monotonic invocation counter, and explicit property-restoration registrations; a module-local weak registry prevents ambiguous property-double stacking across scopes. It does not attach to `TestContext`, alter the context protocol/schema, or participate in runner attempts and retries. This keeps isolated cleanup available through ordinary hooks without adding implicit runner coupling or cross-copy compatibility state.

`src/fake-timers.js` provides explicit browser-safe clock scopes. Each scope owns its wall clock, scheduler position, lifetime timer-ID sequence, deterministic queue, installation epochs, and exact installation descriptors. Epoch-bound wrappers keep retained functions and handles from crossing reinstalls; attempted replacements and verified restoration preserve retry state for exotic target failures. It replaces only Date and timeout/interval globals on a selected target and never attaches to `TestContext`; separate contexts opt into separate scopes through ordinary hooks. `src/shared-runtime-state.js` stores a validated internal version-1 record under a realm-wide symbol. Compatible physical copies reuse its first native wall clock, timer functions, monotonic clock, and active-target WeakMap, preventing late imports from capturing fake primitives and preventing cross-copy installation overlap. `src/real-time.js` exposes the captured real-time functions to the root and runner. These browser-safe leaves import no Node facilities and do not change the public context protocol or schema.

Published build and declaration maps resolve to the shipped `src/` files. Those files support debugging only: the package export map remains the complete public module boundary, with no wildcard or source/internal subpath exports.

## Context identity and protocol

Registration state is explicit: each `TestContext` owns a registry, configuration, event emitter, declaration stack, bound DSL, and expectation API. `createTestContext()` always isolates those values. The default uses the realm-wide versioned symbol `@velocious/testing.default-context.v1`; copies with protocol major 1/schema 3 reuse it, while incompatible values throw at import time before a declaration can be registered. Schema 3 distinguishes the advanced matcher engine from schema-2 contexts so a newer copy cannot silently inherit an older `expect`. Result and structured event records include numeric protocol major 1.

Schema 2 added `run`/`skip`/`todo` declaration state, inherited from suites, and row arguments for generated table tests; schema 3 retains those records unchanged. Skipped and todo suite callbacks execute during declaration so registry shape and source ownership remain stable; execution traversal admits only `run` leaves. The table helper captures its source location once and assigns it to every generated declaration, leaving Node stack inspection in the Node-only layer.

A protocol-major change requires a new symbol, migration notes, dual-version compatibility guidance, and explicit rollback instructions. Additive schema changes should retain old readers. A rollback must restore the prior entry formats without leaving a context that a compatible physical copy can misinterpret.

## Runner contracts

The kernel owns selection, traversal, hook inheritance/order, retries, timeouts, console capture, cleanup, and accounting. Runner timeout deadlines, the custom-executor cleanup grace, attempt durations, and event timestamps use captured real primitives; user fake timers cannot suspend deadlines or rewrite accounting. A callable `globalThis.performance.now` is required as the real monotonic source. Small collaborators stay replaceable:

- `attemptExecutor(input)` may wrap one lifecycle attempt and can invoke `input.defaultExecute()`. With `attemptExecutorOwnsTimeout`, it receives `timeoutMs` but the kernel waits for the executor to apply timeout and bounded cleanup before settling.
- `testArgumentResolver(input)` returns callback arguments.
- `reporter.onEvent(event)` consumes stable structured events and may return a promise that the runner awaits before advancing.
- The Node `importer(filePath)` owns module loading.

The default executor runs ordinary callbacks with outer-to-inner setup and inner-to-outer cleanup. Internal completion/failure discriminators never use the thrown value as a sentinel, so falsy throws and promise rejections remain failures through retries, accounting, and event reporting. Cleanup always exhausts every hook in reverse order. When more than one lifecycle step fails, recursive `errors` records preserve the primary failure followed by every teardown failure; this is an additive protocol-1 result field. `cleanupActiveSuites()` shares idempotent cleanup promises with ordinary suite completion, so interruption cleanup runs active scopes inside-out without later double teardown. The runner is sequential because console interception is process-global.

Selection applies focus, tags, examples, and source lines to all leaves before declaration state divides the selection. Runnable leaves retain the existing `tests`, `test:start`, and `test:finish` shapes. Matched explicit non-runs are additive `nonRunTests` records and `test:skip` events. `counts.total` still equals runnable selected tests and therefore `passed + failed`; `counts.skipped` is all declared leaves minus runnable selected leaves, so filtered and explicit non-runs are counted once. `noMatches` examines the pre-state selection, allowing matched-only-todo runs to succeed without executing hooks.

The Node CLI appends compact execution time to each test result line by summing the existing attempt `durationMs` values. Tests blocked by suite setup have no attempts and are reported as not run. This is presentation derived from protocol-1 records; it does not add result or event fields.

Selection defaults remain strict and standalone-compatible: include filters require all requested tags and focused tests must still match includes. Downstream adapters can choose any-tag matching and focused include bypass independently; exclusion filters always take precedence. Empty suite names retain their legacy separators unless an adapter sets `omitEmptySuiteNames: true` for unnamed structural suites; that option omits them from full names, example matching, and reported test names. These are runner options and naming behavior only; they do not change the context protocol or declaration, event, and result records.

## Deferred adapters

Velocious application/configuration/database/mailer/request/model support, shared transactions, factories, browser scenarios, profiling, timing manifests, duration-aware sharding, module mocking, accessor spying, and automatic mock or fake-timer cleanup are deliberately outside v1. Framework behavior belongs in separately versioned downstream adapters that depend on both systems, preventing dependency cycles. Adding one here would violate the package boundary and should be rolled back rather than hidden behind optional discovery.

Releases are independent semantic versions. Compatibility changes update tests, README, this document, and a changelog fragment in the same review.
