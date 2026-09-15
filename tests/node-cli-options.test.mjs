import assert from "node:assert/strict"
import {describe, it} from "node:test"

import {
  extractTestCliArguments,
  normalizeExamplePatterns,
  parseCliArguments
} from "../src/node/index.js"

describe("Node CLI options", () => {
  it("parses aliases, comma-separated tags, grouping, profiling, and both value syntaxes", () => {
    assert.deepEqual(parseCliArguments([
      "--tag", "unit,fast", "-t=api", "--skip-tag=slow", "-x", "network",
      "--name", "literal.*", "-e=/works/i", "--setup", "test/setup.mjs",
      "--retry", "2", "--timeout=500", "--groups", "4", "--group-number=2",
      "--timing-manifest", "tmp/timings.json", "--profile-json=tmp/profile.json",
      "--timing-manifest-output", "tmp/next-timings.json", "spec"
    ]), {
      candidates: ["spec"],
      includeTags: ["unit", "fast", "api"],
      excludeTags: ["slow", "network"],
      examples: ["literal.*", "/works/i"],
      setupFiles: ["test/setup.mjs"],
      retries: 2,
      timeoutMs: 500,
      groups: 4,
      groupNumber: 2,
      profile: true,
      profileJsonPath: "tmp/profile.json",
      timingManifestPath: "tmp/timings.json",
      timingManifestOutputPath: "tmp/next-timings.json"
    })
  })

  it("extracts only package-owned flags for a downstream command and honors --", () => {
    assert.deepEqual(extractTestCliArguments([
      "test", "--tag", "fast", "--groups=2", "--group-number", "1",
      "framework-option", "--", "--profile", "external-spec.js"
    ]), {
      options: {
        candidates: [],
        includeTags: ["fast"],
        excludeTags: [],
        examples: [],
        setupFiles: [],
        groups: 2,
        groupNumber: 1
      },
      remainingArguments: ["test", "framework-option", "--", "--profile", "external-spec.js"]
    })
  })

  it("requires paired strict positive grouping integers in range", () => {
    for (const argv of [
      ["--groups", "0", "--group-number", "1"],
      ["--groups=-1", "--group-number=1"],
      ["--groups", "1.5", "--group-number", "1"],
      ["--groups=2files", "--group-number=1"],
      ["--groups=2", "--group-number=0"],
      ["--groups=2", "--group-number=-1"],
      ["--groups=2", "--group-number=1.5"],
      ["--groups=2", "--group-number=1suffix"]
    ]) assert.throws(() => parseCliArguments(argv), /positive integer/u)

    assert.throws(() => parseCliArguments([
      `--groups=${"9".repeat(400)}`, "--group-number=1"
    ]), /positive integer/u)

    assert.throws(() => parseCliArguments(["--groups=2"]), /provided together/u)
    assert.throws(() => parseCliArguments(["--group-number=1"]), /provided together/u)
    assert.throws(() => parseCliArguments(["--groups=2", "--group-number=3"]), /between 1 and 2/u)
  })

  it("normalizes literal examples and explicit regular expressions", () => {
    const [literal, expression] = normalizeExamplePatterns(["adds (two)", "/works.+well/i"])

    assert.equal(literal.test("adds (two)"), true)
    assert.equal(literal.test("adds two"), false)
    assert.equal(expression.test("WORKS very well"), true)
  })
})
