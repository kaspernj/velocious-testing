import assert from "node:assert/strict"
import {lstat, readFile, readlink} from "node:fs/promises"
import test from "node:test"

test("package metadata exposes only supported ESM surfaces and no Velocious dependency", async () => {
  const packageData = JSON.parse(await readFile("package.json", "utf8"))
  const lock = JSON.parse(await readFile("package-lock.json", "utf8"))
  assert.equal(packageData.name, "@velocious/testing")
  assert.match(packageData.version, /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u)
  assert.equal(lock.version, packageData.version)
  assert.equal(lock.packages[""].version, packageData.version)
  assert.equal(packageData.type, "module")
  assert.equal(packageData.license, "MIT")
  assert.equal(packageData.engines.node, ">=20")
  assert.deepEqual(Object.keys(packageData.exports), [".", "./runner", "./node", "./package.json"])
  assert.equal(packageData.bin["velocious-test"], "./build/node/cli.js")
  assert.equal(packageData.scripts["release:patch"], "release-patch")
  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    assert.equal(Object.hasOwn(packageData[section] || {}, "velocious"), false)
  }
})

test("agent instructions are canonical and model instruction files are symlinks", async () => {
  assert.equal((await lstat("CLAUDE.md")).isSymbolicLink(), true)
  assert.equal((await lstat("GEMINI.md")).isSymbolicLink(), true)
  assert.equal(await readlink("CLAUDE.md"), "AGENTS.md")
  assert.equal(await readlink("GEMINI.md"), "AGENTS.md")
  assert.match(await readFile("AGENTS.md", "utf8"), /independent of Velocious/)
})

test("Docker contract is source-independent and binds only the complete development home", async () => {
  const dockerfile = await readFile("Dockerfile", "utf8")
  const compose = await readFile("compose.yml", "utf8")
  assert.match(dockerfile, /^FROM ubuntu:26\.04@sha256:3131b4cc82a783df6c9df078f86e01819a13594b865c2cad47bd1bca2b7063bb/m)
  assert.doesNotMatch(dockerfile, /^(?:COPY|ADD (?!https:\/\/registry\.npmjs\.org))\s/m)
  assert.doesNotMatch(dockerfile, /npm (?:ci|install)(?! --global)/)
  assert.match(compose, /^name: velocious-testing$/m)
  assert.match(compose, /source: \$\{DEV_HOME_PATH:-\/home\/dev\}/)
  assert.match(compose, /target: \/home\/dev/)
  assert.equal((compose.match(/type: bind/g) || []).length, 1)
  assert.doesNotMatch(compose, /container_name|ports:|volumes:\s*\n\s+[a-z].*:/)
  assert.doesNotMatch(`${dockerfile}\n${compose}`, /hermes|threadwire|provider-runtime|auth\.json/i)
})

test("TensorBuzz fans out lockfile setup into supported Node tests and one quality lane", async () => {
  await assert.rejects(lstat(".github/workflows"), {code: "ENOENT"})

  const configuration = await readFile("tensorbuzz.yml", "utf8")
  const useNode = await readFile("scripts/tensorbuzz-use-node", "utf8")
  const executable = (await lstat("scripts/tensorbuzz-use-node")).mode & 0o111

  assert.match(configuration, /^environment:\n/m)
  for (const environmentLine of [
    'CI: "true"',
    "NODE_ENV: test",
    'NPM_CONFIG_AUDIT: "false"',
    'NPM_CONFIG_FUND: "false"',
    'NPM_CONFIG_UPDATE_NOTIFIER: "false"'
  ]) assert.match(configuration, new RegExp(`^  ${environmentLine}$`, "m"))
  assert.match(configuration, /^builds:\n  setup:\n/m)
  assert.equal((configuration.match(/npm ci --no-audit --fund=false/g) || []).length, 1)
  assert.match(configuration, /^    builds:\n      node_20_tests:\n/m)
  assert.deepEqual(
    [...configuration.matchAll(/^      ([a-z0-9_]+):$/gm)].map((match) => match[1]),
    ["node_20_tests", "node_22_tests", "node_24_tests", "quality_and_package"]
  )
  for (const version of ["20.20.2", "22.23.2", "24.19.0"]) {
    assert.match(configuration, new RegExp(`scripts/tensorbuzz-use-node ${version.replaceAll(".", "\\.")}`))
  }
  assert.equal((configuration.match(/npm test/g) || []).length, 3)
  for (const command of [
    "npm run lint",
    "npm run typecheck",
    "npm run build",
    "npm run verify:docker-dev-environment",
    "npm audit --audit-level=high",
    "npm ls --omit=dev --all",
    "npm pack --dry-run --json"
  ]) {
    assert.equal(configuration.split(command).length - 1, 1, `${command} must run once`)
  }
  assert.doesNotMatch(configuration, /npm publish|release-patch/)

  assert.notEqual(executable, 0)
  assert.match(useNode, /^#!\/usr\/bin\/env bash\nset -euo pipefail\n/)
  assert.match(useNode, /curl .*--retry 5 .*https:\/\/nodejs\.org\/dist\/v\$\{version\}/s)
  assert.match(useNode, /test "\$\(node --version\)" = "v\$\{version\}"/)
})
