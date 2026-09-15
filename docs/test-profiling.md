# Test profiling and timing manifests

Profiling is opt-in and framework-neutral. `TestProfiler` lives at `@velocious/testing/node`; the browser-safe `@velocious/testing/profiling` entry exports only `validateTestActivityName(name)`. Activity names are lowercase, bounded identifiers and never contain application values.

## Standalone output

```sh
velocious-test --profile spec
velocious-test --profile-json tmp/profile.json --timing-manifest-output tmp/timings.json spec
```

`--profile` prints a fixed-width phase summary. Either output option also enables collection. Rich output retains the historical external schema name `velocious.test-profile` and schema version `1`; changing that identity would invalidate persisted shard profiles. JSON files are normalized, durations are rounded to three decimals, privacy-forbidden field names are rejected recursively, and writes use a same-directory temporary file plus atomic rename. Output paths must differ and cannot overwrite the timing-manifest input.

The profile contains aggregate selection metadata, real and process-CPU phase totals, portable file weights, opaque test/scope IDs, attempts and spans, allowlisted query-operation/fingerprint aggregates, numeric transaction/pool aggregates, and an unattributed-late-event count. It never stores SQL, binds, database names, credentials, hosts, tenants, stacks, or errors as profiling payload fields. Source paths under the project are portable; external source paths are opaque truncated SHA-256 identifiers.

## Context adapter

The collector receives a narrow context adapter rather than a framework configuration:

```js
const profiler = new TestProfiler({
  projectDirectory,
  selection,
  contextAdapter: {
    current: () => storage.getStore(),
    run: (context, callback) => storage.run(context, callback)
  }
})
```

`startAttempt`/`runAttempt`/`finishAttempt`, `runSpan`, `measurePhase`, and `profileActivity` own attribution lifetimes. `interrupt()` closes active spans and attempts. Descendant work that settles after its attempt is closed runs without attribution and increments `unattributedLateEventCount`. Custom activity labels are capped at 20 distinct values, after which new labels aggregate as `other`. Database and pool adapters pass only durations, booleans, bounded identifiers, numeric values, safe SQL operations, and precomputed opaque fingerprints through `recordDatabaseQuery`, `recordDatabaseTransaction`, and `recordPoolMetric`.

The standalone Node runner uses the existing importer, attempt-executor, suite-hook-executor, and reporter seams for profiling; it adds no context-protocol field or global registration.

## Strict shard aggregation

Produce one rich profile for every group, then merge them:

```sh
velocious-test --groups 2 --group-number 1 --profile-json tmp/profile-1.json spec
velocious-test --groups 2 --group-number 2 --profile-json tmp/profile-2.json spec
velocious-test timing-manifest:merge --output tmp/timings.json tmp/profile-1.json tmp/profile-2.json
```

`mergeTestProfileTimingManifests(inputs)` and the merge command accept exactly one compatible profile for every shard. Every profile must use schema v1, have passed, represent an unfocused and unfiltered selection, match the same path base, discovered count, group count, and full file-set hash, and contain exactly its post-shard file count. Malformed, failed, interrupted, no-test, focused, filtered, duplicate, incomplete, colliding, or universe-mismatched inputs are rejected before `writeTimingManifest` atomically replaces the destination. Both `--output FILE` and `--output=FILE` forms are supported.

The plain manifest is the only input to duration-aware sharding. See [Discovery, filtering, and sharding](testing-cli.md) for its path and fallback rules.
