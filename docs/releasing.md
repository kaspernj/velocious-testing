# Releasing

Releases are owned by the lockfile-installed `release-patch` 1.0.6 workflow, not CI. Its version source of truth is the latest annotated `vX.Y.Z` tag. A normal patch release therefore cannot bootstrap this unborn package: the first release must establish and publish the `v0.0.0` baseline with resume mode.

## First release after repository bootstrap

Do not tag the uncommitted bootstrap worktree. The empty-repository exception first produces one reviewed root commit through the separately reviewed repository-bootstrap flow. Only after that commit is the authoritative, pushed `master` HEAD may a release operator create the bootstrap tag.

From the canonical development service, start with a clean checkout of that eventual reviewed root commit and run the complete validation suite. Record its full commit ID as `REVIEWED_ROOT_COMMIT`, then prove local `HEAD` and `origin/master` both resolve to it. Confirm `package.json` still has version `0.0.0`, npm uses the intended public registry, and the operator has publish access.

Create an annotated tag on that exact commit, verify the tag object and peeled target, and push only that new non-force tag:

```sh
git tag -a v0.0.0 -m v0.0.0 "$REVIEWED_ROOT_COMMIT"
test "$(git cat-file -t refs/tags/v0.0.0)" = tag
test "$(git rev-list -n 1 v0.0.0)" = "$REVIEWED_ROOT_COMMIT"
git push origin v0.0.0
```

Read the remote tag back and verify its peeled commit before publishing. Then resume the exact tagged version through the package script:

```sh
git fetch origin --tags
test "$(git rev-list -n 1 refs/tags/v0.0.0)" = "$REVIEWED_ROOT_COMMIT"
git ls-remote --tags origin refs/tags/v0.0.0 'refs/tags/v0.0.0^{}'
REMOTE_BOOTSTRAP_COMMIT="$(git ls-remote --tags origin 'refs/tags/v0.0.0^{}' | awk '{print $1}')"
test "$REMOTE_BOOTSTRAP_COMMIT" = "$REVIEWED_ROOT_COMMIT"
npm run release:patch -- --resume
npm view @velocious/testing@0.0.0 version gitHead
```

`--resume` requires the annotated tag to point at the current synchronized `master` HEAD and requires `package.json` to match the tag. It reruns dependency installation, build, and publish dry-run gates, atomically confirms the existing branch/tag refs, publishes exactly `0.0.0`, and verifies registry visibility. It does not bump, commit, or create another tag.

## Partial failure and readback

- If local tag creation succeeds but its push fails, inspect the local tag type/target and `git ls-remote` output. If the remote tag is absent and the local annotated tag still targets the reviewed root commit, retry only `git push origin v0.0.0`. Never move, replace, force-push, or recreate a conflicting remote tag.
- If the tag push has an ambiguous result, fetch and read both the tag object and peeled remote target before doing anything else. A mismatched target is a release-history incident, not a reason to force it.
- If `--resume`, npm publication, or registry verification fails after the tag is public, do not run a normal patch release and do not create another tag. Read back `npm view @velocious/testing@0.0.0 version gitHead`; once authentication, connectivity, or registry availability is corrected, rerun `npm run release:patch -- --resume`. If `0.0.0` is already published, resume is a verified no-op.
- Treat network/authentication errors and mixed registry responses as unknown state. Preserve the exact commit and tag, perform remote and npm readback, and resume only the same version.

## Later patch releases

After `@velocious/testing@0.0.0` and its annotated tag are both verified, ordinary clean-master patch releases use:

```sh
npm run release:patch
```

The helper derives `0.0.1` and later patches from the latest published annotated tag. Before every release, run a fresh `npm ci`, the complete validation suite, `npm pack --dry-run --json`, and the standalone installed-tarball smoke in the canonical service. Confirm authentication and registry intent explicitly.

Feature work leaves version `0.0.0` unchanged until the bootstrap release. Never hand-edit generated build declarations, publish from an unreviewed tree, or add framework dependencies during release preparation.
