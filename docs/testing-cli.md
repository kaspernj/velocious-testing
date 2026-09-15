# Discovery, filtering, and sharding

The standalone `velocious-test` executable owns framework-neutral argument parsing, test discovery, filtering, deterministic grouping, timing-manifest input, profiling output, and timing-profile aggregation. It exits unsuccessfully for failed tests and for a selection that matches no tests.

## Arguments and discovery

Tags accept `--include-tag`/`--tag`/`-t` and `--exclude-tag`/`--skip-tag`/`-x`. Comma-separated tag values are trimmed and deduplicated. Examples accept `--example`/`--name`/`-e`; plain values are literal substrings, while `/expression/flags` values are regular expressions. Both `--option value` and `--option=value` forms are supported. `--retry` aliases `--retries`; setup files, timeouts, paths, and `path:line` selections retain their existing behavior. A `--` separator makes every following token a candidate path.

`parseCliArguments(argv)` is the strict standalone parser. `extractTestCliArguments(argv)` returns `{options, remainingArguments}` so a downstream CLI can remove package-owned flags and preserve its command and framework flags without implementing another test-option parser. Group counts are strict positive decimal integers: `--groups` and `--group-number` must appear together, and the 1-indexed group number cannot exceed the group count.

`discoverTestFiles({cwd, candidates, directories, filePattern, ignoredNames})` keeps the package defaults when options are omitted: it recursively scans `test`, `tests`, `spec`, and `__tests__` for `*.test.*`, `*.spec.*`, and `*-test.*` JavaScript/CJS/MJS files. Explicit files may live outside `cwd` and do not need to match the scan pattern. Explicit directories use the configured pattern. Results are absolute, deduplicated, and code-unit sorted. A caller that needs Velocious-style backend discovery can supply its narrower directories and a pattern excluding `.browser-spec` files; browser adapters can supply their own browser pattern. `lineFiltersFromCandidates()` performs the matching path/line normalization without rediscovery.

## Deterministic grouping

```sh
velocious-test --groups 4 --group-number 1 spec
velocious-test --groups=4 --group-number=2 --timing-manifest=tmp/timings.json spec
```

`TestSuiteSplitter` sorts by descending weight and then code-unit path order, assigning each file to the earliest lightest group. Across all group numbers the partitions are deterministic, complete, and disjoint; groups may be empty. The fallback weights are ordinary `1`, `controller` `3`, `frontend-models` `10`, and `system` `20`, with a `2` multiplier for browser specs. A positive finite timing entry replaces the fallback. Missing, zero, malformed, stale, and external entries fall back without changing partition determinism. `getTimingManifestCoverage()` reports measured files, heuristic files, and stale entries for the complete discovery set.

Timing manifests are plain relative-path-to-duration JSON objects. `canonicalTimingManifestPath`, `compareTimingManifestPaths`, `validateTimingManifest`, and `timingManifestFileSetHash` own portable slash normalization, non-escaping relative paths, collision and duration validation, locale-independent code-unit order, and the `sha256:` identity over the `velocious.test-file-set.v1` domain.

See [Test profiling and timing manifests](test-profiling.md) for producing and strictly merging timing data.
