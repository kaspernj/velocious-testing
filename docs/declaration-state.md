# Declaration states and schema-2 migration

## DSL behavior

Schema 2 adds explicit `run`, `skip`, and `todo` state to suite and test declarations. A non-running suite passes its state to every descendant. An inner focus marker remains part of the stable declaration tree but cannot change inherited state, so focus never revives skipped or todo work.

`it.skip(name, options?, callback?)` permits an omitted body. `it.todo(name, options?)` represents unfinished behavior and rejects any supplied callback. `describe.skip(name, options?, callback)` and `describe.todo(name, options?, callback)` require and execute their callback only to register descendants and hooks. The runner never invokes bodies or hooks under either state.

The aliases are identities, not wrappers:

- `test === it`
- `fit === it.only`
- `xit === it.skip`
- `xtest === it.skip`
- `fdescribe === describe.only`
- `xdescribe === describe.skip`

Table declarations use `it.each(rows)(name, options?, callback)` and `describe.each(rows)(name, options?, callback)`. The rows value must be a non-empty, non-sparse array; this is validated before the returned declaration function or its name template is evaluated. Array rows spread; every other row is one argument. `%s`, `%d`, and `%j` consume positional row arguments, `%#` inserts the zero-based row index, `%%` inserts a percent sign, and `$path` reads an object-row property path. Unsupported tokens, missing positional values, invalid numeric/JSON values, non-object `$path` rows, and missing paths throw declaration errors. Duplicate generated names use the ordinary duplicate-declaration error. All rows use the original `each` callsite.

## Result and event additions

The `tests` array and passed/failed event records retain their prior meaning: they contain executed tests and tests blocked by setup. `nonRunTests` is additive and contains matched explicit skips/todos as `{fullName, status, location, tags}`, where status is `skipped` or `todo`. Each record is also sent in a `test:skip` event.

`counts.total` remains runnable selected tests, `counts.skipped` includes both filtered leaves and declared non-runs without double counting, and `noMatches` is false when selection filters matched only explicit non-runs.

## Upgrading physical copies

Protocol major remains 1 and the global key remains `Symbol.for("@velocious/testing.default-context.v1")`, but `CONTEXT_SCHEMA_VERSION` is now 2. Every physical copy in a JavaScript realm must use schema 2. A schema-1/schema-2 mix throws during module initialization before either copy can register against the other's tree.

Upgrade all direct, workspace, and plugin copies together, then restart the process so no schema-1 default context remains on the global symbol. Compatible schema-2 copies reuse the same default context and registration tree. If a consumer cannot upgrade every copy, keep the entire realm on the prior package release; do not delete or rewrite the global symbol at runtime as a compatibility workaround.

Isolated contexts created with `createTestContext()` continue to own independent registry, config, events, and declaration state. `reset()` replaces the registry, so repeated isolated and default-context runs do not retain state from prior declarations.
