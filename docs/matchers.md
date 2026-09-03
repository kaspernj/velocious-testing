# Advanced matchers

The root expectation API is browser/Metro-safe. Its comparison, formatting, promise, and extension behavior uses no Node built-ins and does not change runner records. Because `TestContext.expect` and `installGlobals()` expose this API, advanced-matcher contexts use context schema 3; mixing them with schema-2 package copies fails deterministically at import time rather than reusing an older matcher engine.

## Promise assertions

Use `resolves` or `rejects` and return or await the resulting promise:

```js
await expect(Promise.resolve({id: 7})).resolves.toEqual({id: 7})
await expect(Promise.reject(new TypeError("failed"))).rejects.toThrow(TypeError)
await expect(Promise.resolve("ready")).resolves.not.toEqual("waiting")
```

`resolves` fails if the promise rejects, and `rejects` fails if it fulfills; `.not` negates only the matcher after the required settlement. Rejection reasons retain their JavaScript identity, including `undefined`, `null`, `false`, `0`, and the empty string. Promise assertions require an object or function with a callable `then` property and otherwise throw `Promise assertions require a promise-like received value`. A promise chain reads that property once, preserves the thenable receiver, and assimilates its settlement asynchronously.

The runner already awaits a promise returned by a test callback, so `it("works", () => expect(operation()).resolves.toEqual(value))` participates in ordinary timeout, retry, cleanup, and reporting behavior. An assertion promise that is neither returned nor awaited cannot be observed by the runner.

## Asymmetric values

Asymmetric values compose recursively anywhere deep equality is used, including containment and mock-call arguments:

```js
expect(response).toEqual({
  id: expect.any(Number),
  result: expect.objectContaining({name: expect.stringMatching(/^Ada/u)}),
  tags: expect.arrayContaining([expect.stringContaining("admin")]),
  optional: expect.anything()
})
```

`anything()` matches every value except `null` and `undefined`. `any(Constructor)` recognizes the primitive constructors and otherwise uses `instanceof`. `stringContaining(string)` requires a string fragment. `stringMatching(stringOrRegExp)` accepts a pattern string or regular expression and never changes a caller-owned expression's `lastIndex`. `arrayContaining(array)` requires a dense array; an explicit `undefined` element remains valid. Recursive `objectContaining()` and `arrayContaining()` patterns are cycle-safe for both matching and non-matching comparisons. All six factories are also named root exports.

## Custom matchers

`expect.extend()` atomically registers own, string-named matcher functions for that physical module instance:

```js
expect.extend({
  toHaveId(received, id) {
    return {
      pass: this.equals(received, expect.objectContaining({id})),
      message: () => `Expected ${this.format(received)} ${this.isNot ? "not " : ""}to have id ${id}`
    }
  }
})
```

A matcher receives the tested value followed by its arguments and returns `{pass: boolean, message: string | () => string}`, synchronously or through a promise. Its frozen context contains only `isNot`, `equals(actual, expected)`, `format(value)`, and `diff(actual, expected)`. Promise-like results have their `then` property read once and are assimilated with the original receiver; thrown and rejected values propagate unchanged. Names cannot replace built-in or previously registered matchers; definitions are fully validated before any name is installed. Result validation is deterministic, and lazy messages are evaluated only when the assertion fails.

Custom matchers work with `.not`, `.resolves`, and `.rejects`. TypeScript callers declare their chosen names through module augmentation while runtime registration remains explicit:

```ts
declare module "@velocious/testing" {
  interface Expect {
    toHaveId(id: number): void | Promise<void>
  }

  interface PromiseExpectation {
    toHaveId(id: number): Promise<void>
  }
}
```

The root declarations export `AsymmetricMatcher`, `CustomMatcher`, `CustomMatcherContext`, `CustomMatcherDefinitions`, and `CustomMatcherResult` for reusable helper typing.

## Structural differences

Positive equality, partial-object, containment, attribute, and mock-argument failures append structural differences without snapshots or Node-only inspection. Paths start at `$`, object keys are sorted, array indexes are explicit, and `<missing>` is distinct from `undefined`. Values are formatted deterministically with support for cycles and public asymmetric descriptions. At most 20 differences are displayed; the final line reports the omitted count. For `toHaveBeenCalledWith`, the call with the fewest structural differences is shown, with the first call winning ties.
