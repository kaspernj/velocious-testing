import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
import test from "node:test"

test("release docs match the installed helper's brand-new package bootstrap contract", async () => {
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"))
  const helperReadme = await readFile("node_modules/release-patch/README.md", "utf8")
  const releaseDocs = await readFile("docs/releasing.md", "utf8")

  assert.equal(lock.packages["node_modules/release-patch"].version, "1.0.6")
  assert.match(helperReadme, /git tag -a v0\.0\.0 -m v0\.0\.0/)
  assert.match(helperReadme, /release-patch --resume/)
  assert.match(releaseDocs, /eventual reviewed root commit/)
  assert.match(releaseDocs, /git tag -a v0\.0\.0 -m v0\.0\.0/)
  assert.match(releaseDocs, /git push origin v0\.0\.0/)
  assert.match(releaseDocs, /REMOTE_BOOTSTRAP_COMMIT=.*git ls-remote --tags origin/)
  assert.match(releaseDocs, /test "\$REMOTE_BOOTSTRAP_COMMIT" = "\$REVIEWED_ROOT_COMMIT"/)
  assert.match(releaseDocs, /npm run release:patch -- --resume/)
  assert.ok(releaseDocs.indexOf("git tag -a v0.0.0") < releaseDocs.indexOf("npm run release:patch -- --resume"))
  assert.match(releaseDocs, /npm view @velocious\/testing@0\.0\.0 version gitHead/)
  assert.match(releaseDocs, /\nnpm run release:patch\n/)
})
