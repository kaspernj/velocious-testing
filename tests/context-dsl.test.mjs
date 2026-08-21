import assert from "node:assert/strict"
import test from "node:test"

import {
  configureTests,
  createTestContext,
  defaultTestContext,
  describe,
  fit,
  installGlobals,
  it
} from "../src/index.js"

test("default context is shared through the versioned global symbol", async () => {
  const duplicate = await import(`../src/index.js?duplicate=${Date.now()}`)
  const duplicateContextModule = await import(`../src/context.js?compatible=${Date.now()}`)

  assert.equal(duplicate.defaultTestContext, defaultTestContext)
  assert.equal(duplicateContextModule.defaultTestContext, defaultTestContext)
  assert.equal(Symbol.keyFor(Symbol.for("@velocious/testing.default-context.v1")), "@velocious/testing.default-context.v1")
})

test("isolated contexts own independent registry, config, and events", () => {
  const first = createTestContext()
  const second = createTestContext()
  const received = []

  first.events.on("declaration", (event) => received.push(event))
  first.describe("first", () => first.it("works", () => {}))
  first.configureTests({excludeTags: "slow", defaultTimeoutMs: 25, failedConsoleOutputMaxLines: 10})

  assert.equal(first.registry.suites.length, 1)
  assert.equal(second.registry.suites.length, 0)
  assert.deepEqual(first.config.excludeTags, ["slow"])
  assert.equal(first.config.failedConsoleOutputMaxLines, 10)
  assert.deepEqual(second.config.excludeTags, [])
  assert.equal(received.length, 2)
})

test("DSL preserves nesting, inherited tags, focus, source ownership, and rejects duplicates", () => {
  let line = 10
  const context = createTestContext({declarationLocator: () => ({filePath: "/project/tests/sample.test.js", line: line++})})

  context.describe("outer", {tags: "unit, fast"}, () => {
    context.it("ordinary", {tags: ["api"]}, () => {})
    context.describe("inner", () => context.fit("focused", () => {}))
  })

  const outer = context.registry.suites[0]
  assert.deepEqual(outer.tags, ["unit", "fast"])
  assert.deepEqual(outer.tests[0].tags, ["unit", "fast", "api"])
  assert.equal(outer.location.filePath, "/project/tests/sample.test.js")
  assert.equal(outer.suites[0].tests[0].focus, true)
  assert.throws(() => context.describe("outer", () => {}), /Duplicate test description: outer/)
  assert.throws(() => context.it("root", () => {}), /Tests must be declared inside a describe block/)
})

test("default bindings and installGlobals target the selected context", () => {
  defaultTestContext.reset({config: true})
  describe("bound", () => {
    it("normal", () => {})
    fit("focused", () => {})
  })
  configureTests({excludeTags: ["integration"]})

  const isolated = createTestContext()
  const target = {}
  installGlobals(target, isolated)
  target.describe("global", () => target.it("case", () => {}))

  assert.equal(defaultTestContext.registry.suites[0].name, "bound")
  assert.deepEqual(defaultTestContext.config.excludeTags, ["integration"])
  assert.equal(isolated.registry.suites[0].name, "global")
  assert.equal(target.expect, isolated.expect)
})

test("incompatible default context protocol fails clearly", async () => {
  const key = Symbol.for("@velocious/testing.default-context.v1")
  const compatible = globalThis[key]

  try {
    globalThis[key] = {protocolMajor: 2, schemaVersion: 1}
    await assert.rejects(
      import(`../src/context.js?incompatible=${Date.now()}`),
      /Incompatible @velocious\/testing default context/
    )
  } finally {
    globalThis[key] = compatible
  }
})
