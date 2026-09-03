# Browser-safe test doubles

The root package exports a default `mock` scope and `createMockScope()` for isolated registries. Both are browser/Metro-safe and independent of the test context and runner. Cleanup is explicit: no test, retry, hook, or context reset automatically changes mock state.

```js
import {afterEach, createMockScope, describe, expect, it} from "@velocious/testing"

const mocks = createMockScope()

describe("client", () => {
  afterEach(() => mocks.restoreAll())

  it("records a request", () => {
    const request = mocks.fn().mockResolvedValue({ok: true})
    request("/health")
    expect(request).toHaveBeenCalledWith("/health")
  })
})
```

## Functions and behavior

`scope.fn(implementation?)` creates a callable mock. Its stable `.mock` object contains `calls`, `results`, `instances`, and `invocationCallOrder`. Calls and their scope-global order are recorded before behavior runs. Results are `{type: "return", value}` or `{type: "throw", value}`. A promise is a returned value even when it later rejects. Successful constructor calls add the actual constructed return to `instances`; throwing constructors record a throw result but no instance.

Use `mockImplementation`, `mockReturnValue`, `mockResolvedValue`, and `mockRejectedValue` for persistent behavior. Their `Once` variants form one FIFO queue shared by all one-shot helpers. When the queue is exhausted, the persistent implementation runs; without one, the mock returns `undefined`. Every helper is chainable.

Declarations preserve the original implementation contract: return helpers accept the call result for callable implementations or the instance type for constructor-only implementations, and resolved or rejected helpers are available only for promise-returning call contracts. Completely unconfigured mocks retain permissive helper arguments.

`mockClear()` empties the four history arrays in place and preserves behavior. `mockReset()` also empties queued and persistent behavior, including the implementation originally passed to `fn`. Invocation numbering is monotonic for the lifetime of a scope and is not restarted by clear or reset.

## Property spies and stubs

`scope.spyOn(target, key)` installs a call-through mock for a data method. `scope.stub(target, key, implementation?)` installs supplied behavior or defaults to `undefined`. Either can be reconfigured with the ordinary mock helpers.

String and symbol keys and own or inherited data methods are supported. Accessors are rejected without invoking their getter. Missing and non-callable properties are rejected. Own descriptors keep their writable, enumerable, and configurable flags while doubled and are restored exactly. A writable non-configurable own method is supported; a non-writable non-configurable method is not. An inherited method is shadowed with a configurable own descriptor carrying the source writable/enumerable flags, so the target must be extensible.

`mockRestore()` unconditionally restores the captured own descriptor even if the property was reassigned while doubled. For an inherited method it deletes the introduced own property, exposing the then-current inherited value. Restoration is idempotent after success. If a proxy trap or intervening descriptor change prevents restoration, the error is propagated and the double stays registered so restoration can be retried. A target/key cannot have two active doubles, including doubles requested by different scopes from the same package instance.

`clearAll()` and `resetAll()` apply to every registered plain mock and active property double. Resetting a spy leaves its wrapper installed as a no-op; only restore reinstates the original property. `restoreAll()` restores active property doubles in reverse registration order, attempts every restoration, and throws an `AggregateError` containing all failures. Successfully restored doubles are unregistered; plain mocks remain registered for later clear/reset calls. Prefer a bounded scope when many short-lived plain mocks are created.

## Call assertions

The expectation API provides `toHaveBeenCalled`, `toHaveBeenCalledTimes`, `toHaveBeenCalledWith`, `toHaveBeenLastCalledWith`, and one-based `toHaveBeenNthCalledWith`. Every matcher supports `.not`; argument comparisons use the same deep equality and `objectContaining`/`arrayContaining` composition as `toEqual`.

Module mocking, getter/setter spying, fake timers, and automatic lifecycle cleanup are intentionally outside this API.
