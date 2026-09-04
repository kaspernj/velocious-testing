# Deterministic fake timers

The browser/Metro-safe root exports `createFakeTimers({now?})`. Each call creates an isolated clock; there is no default clock, context field, implicit installation, or automatic cleanup. The initial time accepts a finite `number` or valid `Date`, including a Date from another realm, and otherwise defaults to current real wall time read through a function captured when the package loaded.

```js
import {afterEach, beforeEach, createFakeTimers, describe, it} from "@velocious/testing"

const timers = createFakeTimers({now: 1_000})

describe("clock isolation", () => {
  beforeEach(() => timers.install())
  afterEach(() => timers.restore())

  it("advances", () => {
    setTimeout(() => {}, 25)
    timers.advanceBy(25)
  })
})
```

The default lifecycle runs every reverse-order `afterEach` after setup, body, and timeout failures and before a retry begins, so this pattern restores the real globals and discards pending work on every attempt. A suite-wide installation can use `beforeAll` and `afterAll`. A custom attempt executor that does not call `defaultExecute()` owns equivalent cleanup itself. `TestContext.reset()` does not restore a clock.

## Supported globals and Date behavior

`install(target = globalThis)` replaces exactly five own function-valued properties: `Date`, `setTimeout`, `clearTimeout`, `setInterval`, and `clearInterval`. The target must allow each property to be replaced. Installation records each attempted property before replacement, rolls every attempt back if installation fails, and verifies restored descriptors; overlapping active clocks on one target are rejected even when the scopes come from compatible physical package copies. If an exotic proxy prevents or obscures rollback, the aggregate error retains the scope's installation state so `restore()` can be retried. `restore()` is idempotent after success, discards every pending timer without running it, attempts and verifies every property restoration, and aggregates restoration failures.

While installed, `Date.now()`, `new Date()` without arguments, and `Date()` observe the fake wall clock. Explicit constructor arguments, `Date.parse`, `Date.UTC`, prototypes, and `instanceof Date` retain the installed target's original Date behavior. `setSystemTime(value)` changes wall time without running timers or changing their remaining delays.

Promises, the microtask queue, `queueMicrotask`, `performance.now`, animation frames, `setImmediate`, Node timer objects and their `ref`/`unref` methods, scheduler APIs, and string timer callbacks are not virtualized. Timer callbacks run synchronously and their return values are ignored; native microtasks run after fake-timer control returns to the host.

## Scheduling

Timer handles are increasing positive numbers and are not reused when the same scope is reinstalled. Timeout and interval handles share one namespace, either clear function cancels either kind, and clearing an unknown or completed handle does nothing. Retained setter functions from an older installation throw instead of scheduling into the current installation; retained clear functions are harmless. An omitted delay is zero, a negative finite delay clamps to zero, and a fractional delay truncates toward zero. Non-finite delays and non-function callbacks throw.

The queue orders occurrences by due time and then insertion sequence. Equal-deadline work is FIFO. A timeout is removed before its callback. An interval queues its next occurrence from its prior scheduled deadline before invoking its callback; clearing that interval from inside the callback removes the queued occurrence. This preserves cadence without callback-time drift.

`advanceBy(milliseconds)` requires a non-negative finite number and truncates fractional input toward zero. It runs every occurrence due through the destination, including nested work scheduled within the range, moves the clock to each deadline before invoking its callback, and finishes exactly at the destination. If a callback restores and reinstalls its scope, the old advancement stops immediately; it does not run timers from the new installation or move the new clock. If a callback throws, the error propagates immediately, time remains at that callback, and other queued work stays pending.

`runPending()` snapshots current occurrence identities, runs each still-pending snapshot at most once in due/FIFO order, and advances time as necessary. Cancellation is honored. Nested timers and newly queued interval occurrences are left for a later operation. Neither control automatically drains microtasks.

Each advancing operation is limited to 10,000 callbacks. Hitting the limit—for example with a zero-delay interval—throws and leaves the remaining timer state available for cancellation or restoration. Calling `advanceBy()` or `runPending()` reentrantly from a timer callback is rejected while the outer clock-control operation is active, and the scope remains usable after the error.

## Runner clock separation

Runner lifecycle deadlines, the bounded custom-executor cleanup grace, attempt durations, and event timestamps use real functions captured before public fake timers can install. Compatible physical package copies reuse the first validated realm-wide capture, including when a later copy is imported while another copy's fake clock is installed. Deadlines and durations use the captured monotonic `performance.now`; deadlines beyond the host timer's maximum delay are rechecked in supported chunks instead of passing an oversized delay to the host. Event timestamps use captured real wall time. Advancing or setting a fake clock therefore never advances, pauses, or rewrites runner bookkeeping.

The timer API does not change the context global symbol, protocol major 1, schema 3, declaration records, results, events, runner collaborators, or package export map.
