import assert from "node:assert/strict"
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {describe, it} from "node:test"

import {discoverTestFiles, lineFiltersFromCandidates} from "../src/node/index.js"

describe("Node test discovery", () => {
  it("supports caller-owned directories, patterns, ignored names, and deterministic results", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-discovery-contract-"))

    try {
      await mkdir(path.join(root, "spec", "nested"), {recursive: true})
      await mkdir(path.join(root, "spec", "vendor"), {recursive: true})
      await mkdir(path.join(root, "tests"), {recursive: true})
      const backend = path.join(root, "spec", "a-spec.js")
      const nested = path.join(root, "spec", "nested", "z-test.mjs")
      const browser = path.join(root, "spec", "z.browser-spec.js")
      const ignored = path.join(root, "spec", "vendor", "hidden-spec.js")
      const packageDefault = path.join(root, "tests", "ordinary.test.cjs")

      for (const file of [backend, nested, browser, ignored, packageDefault]) await writeFile(file, "")

      assert.deepEqual(await discoverTestFiles({
        cwd: root,
        directories: ["spec"],
        filePattern: /(?<!\.browser)-(?:spec|test)\.(?:m)?js$/u,
        ignoredNames: ["vendor"]
      }), [backend, nested])
      assert.deepEqual(await discoverTestFiles({cwd: root}), [
        packageDefault,
        nested
      ].sort())
    } finally {
      await rm(root, {recursive: true, force: true})
    }
  })

  it("accepts explicit external files and directories plus a base-directory-prefixed path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-discovery-paths-"))
    const externalRoot = await mkdtemp(path.join(os.tmpdir(), "velocious-testing-external-paths-"))

    try {
      await mkdir(path.join(root, "spec", "nested"), {recursive: true})
      const internal = path.join(root, "spec", "nested", "internal-spec.js")
      const external = path.join(externalRoot, "external.fixture.js")
      await writeFile(internal, "")
      await writeFile(external, "")

      assert.deepEqual(await discoverTestFiles({
        cwd: path.join(root, "spec"),
        candidates: ["spec/nested", external],
        filePattern: /(?:-spec|\.fixture)\.js$/u
      }), [external, internal].sort())
    } finally {
      await rm(root, {recursive: true, force: true})
      await rm(externalRoot, {recursive: true, force: true})
    }
  })

  it("canonicalizes and deduplicates line filters independently from discovery", () => {
    const cwd = path.resolve("/workspace/project")

    assert.deepEqual(lineFiltersFromCandidates({
      cwd,
      candidates: ["spec/a-spec.js:12", "spec/a-spec.js:12", "spec/a-spec.js:18", "spec/b-spec.js"]
    }), {
      [path.join(cwd, "spec", "a-spec.js")]: [12, 18]
    })
  })
})
