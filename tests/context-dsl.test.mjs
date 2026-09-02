import assert from "node:assert/strict"
import test from "node:test"

import * as testing from "../src/index.js"

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
  assert.equal(testing.CONTEXT_SCHEMA_VERSION, 2)
  assert.equal(defaultTestContext.schemaVersion, 2)
  assert.equal(Symbol.keyFor(Symbol.for("@velocious/testing.default-context.v1")), "@velocious/testing.default-context.v1")
})

test("public declaration aliases are exact modifier aliases", () => {
  const context = createTestContext()

  assert.equal(testing.test, testing.it)
  assert.equal(testing.fit, testing.it.only)
  assert.equal(testing.xit, testing.it.skip)
  assert.equal(testing.xtest, testing.it.skip)
  assert.equal(testing.fdescribe, testing.describe.only)
  assert.equal(testing.xdescribe, testing.describe.skip)
  assert.equal(context.test, context.it)
  assert.equal(context.fit, context.it.only)
  assert.equal(context.xit, context.it.skip)
  assert.equal(context.xtest, context.it.skip)
  assert.equal(context.fdescribe, context.describe.only)
  assert.equal(context.xdescribe, context.describe.skip)

  const target = {}
  installGlobals(target, context)
  for (const name of ["describe", "fdescribe", "xdescribe", "it", "test", "fit", "xit", "xtest"]) {
    assert.equal(target[name], context[name])
  }
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

test("declaration modifiers preserve state, focus, options, and a stable skipped tree", () => {
  const context = createTestContext()
  const declarations = []

  context.describe.skip("skipped", {tags: "outer", timeoutMs: 25}, () => {
    declarations.push("skip callback")
    context.beforeAll(() => {})
    context.it.only("focused child", {tags: "inner"}, () => {})
    context.describe("nested", () => context.it("inherited", () => {}))
  })
  context.describe.todo("todo", () => {
    declarations.push("todo callback")
    context.it("inherited todo", () => {})
  })
  context.describe.only("focused", {tags: "focus"}, () => {
    context.it.skip("explicit skip", {tags: "leaf"})
    context.it.todo("explicit todo", {timeoutMs: 10})
    context.it("runs", () => {})
  })

  assert.deepEqual(declarations, ["skip callback", "todo callback"])
  const [skipped, todo, focused] = context.registry.suites
  assert.equal(skipped.state, "skip")
  assert.equal(skipped.tests[0].state, "skip")
  assert.equal(skipped.tests[0].focus, true)
  assert.deepEqual(skipped.tests[0].tags, ["outer", "inner"])
  assert.equal(skipped.tests[0].options.timeoutMs, 25)
  assert.equal(skipped.suites[0].tests[0].state, "skip")
  assert.equal(todo.state, "todo")
  assert.equal(todo.tests[0].state, "todo")
  assert.equal(focused.focus, true)
  assert.equal(focused.tests[0].state, "skip")
  assert.equal(focused.tests[1].state, "todo")
  assert.deepEqual(focused.tests[0].tags, ["focus", "leaf"])
})

test("skip callbacks are optional while todo rejects test callbacks clearly", () => {
  const context = createTestContext()

  context.describe("arguments", () => {
    context.it.skip("without callback")
    context.it.skip("with options", {tags: "documented"})
    context.it.skip("with callback", () => { throw new Error("must never run") })
    context.it.todo("todo")
    context.it.todo("todo options", {tags: "later"})
    assert.throws(() => context.it.todo("invalid", () => {}), /it\.todo.*does not accept a callback/i)
    assert.throws(() => context.it.todo("invalid options", {}, () => {}), /it\.todo.*does not accept a callback/i)
  })
  assert.throws(() => context.describe.todo("invalid suite"), /Invalid arguments for describe: invalid suite/)
})

test("table declarations spread arrays, pass scalar and object rows, and interpolate every token", () => {
  const context = createTestContext()
  const suiteArguments = []

  context.describe("tables", () => {
    context.it.each([["alpha", 12, {ok: true}]])("array %# %% %s %d %j", {tags: "table"}, () => {})
    context.it.each(["scalar"])("scalar %# %s", () => {})
    context.it.each([{user: {name: "Ada"}, count: 2}])("object $user.name $count %# %%", () => {})
    context.describe.each([["nested", 3], {label: "object-suite"}])("suite %# %s", {tags: "suite-table"}, (...args) => {
      suiteArguments.push(args)
      context.it("child", () => {})
    })
  })

  const suite = context.registry.suites[0]
  assert.deepEqual(suite.tests.map((entry) => entry.name), [
    'array 0 % alpha 12 {"ok":true}',
    "scalar 0 scalar",
    "object Ada 2 0 %"
  ])
  assert.deepEqual(suite.tests[0].tags, ["table"])
  assert.deepEqual(suite.suites.map((entry) => entry.name), ["suite 0 nested", "suite 1 [object Object]"])
  assert.deepEqual(suite.suites.map((entry) => entry.tags), [["suite-table"], ["suite-table"]])
  assert.deepEqual(suiteArguments, [["nested", 3], [{label: "object-suite"}]])
})

test("table declarations fail clearly for invalid rows and templates", () => {
  const context = createTestContext()
  context.describe("invalid tables", () => {
    assert.throws(() => context.it.each("not rows"), /it\.each rows must be an array/i)
    assert.throws(() => context.describe.each({}), /describe\.each rows must be an array/i)
    assert.throws(() => context.it.each([[1]])(42, () => {}), /it\.each name must be a string/i)
    assert.throws(() => context.it.each([[1]])("missing %s %s", () => {}), /row 0.*%s.*argument/i)
    assert.throws(() => context.it.each([["no"]])("number %d", () => {}), /row 0.*%d.*number/i)
    assert.throws(() => context.it.each([[1]])("unsupported %i", () => {}), /unsupported.*%i/i)
    assert.throws(() => context.it.each(["scalar"])("path $name", () => {}), /row 0.*\$name.*object/i)
    assert.throws(() => context.it.each([{name: "Ada"}])("path $missing", () => {}), /row 0.*\$missing.*not found/i)
    const circular = {}
    circular.self = circular
    assert.throws(() => context.it.each([[circular]])("json %j", () => {}), /row 0.*%j.*JSON/i)
  })
})

test("%j rejects non-JSON scalar and positional row values", () => {
  const invalid = [
    ["undefined", undefined, [undefined], "%j"],
    ["function", () => {}, ["prefix", () => {}], "%s %j"],
    ["symbol", Symbol("value"), ["prefix", 2, Symbol("value")], "%s %d %j"]
  ]

  for (const [label, scalar, positional, template] of invalid) {
    for (const [form, rows, name] of [
      ["scalar", [scalar], "%j"],
      ["positional", [positional], template]
    ]) {
      const context = createTestContext()
      context.describe(`${label} ${form}`, () => {
        assert.throws(
          () => context.it.each(rows)(name, () => {}),
          /Table row 0 token %j could not be serialized as JSON/
        )
      })
    }
  }
})

test("table declarations reject empty rows before template validation or registration", () => {
  const context = createTestContext()

  context.describe("empty tables", () => {
    assert.throws(() => context.it.each([]), /it\.each rows must contain at least one row/i)
    assert.throws(() => context.describe.each([]), /describe\.each rows must contain at least one row/i)
    assert.throws(
      () => context.it.each([])("unsupported %i", () => {}),
      /it\.each rows must contain at least one row/i
    )
    assert.throws(
      () => context.describe.each([])("unsupported %i", () => {}),
      /describe\.each rows must contain at least one row/i
    )
  })

  assert.deepEqual(context.registry.suites[0].tests, [])
  assert.deepEqual(context.registry.suites[0].suites, [])
})

test("table duplicate names are deterministic and generated declarations retain one callsite", () => {
  let line = 90
  const context = createTestContext({declarationLocator: () => ({filePath: "/project/tests/table.test.js", line: line++})})

  context.describe("locations", () => {
    context.it.each([["first"], ["second"]])("case %# %s", () => {})
    assert.throws(() => context.it.each(["same", "same"])("duplicate %s", () => {}), /Duplicate test description: duplicate same/)
  })

  assert.deepEqual(context.registry.suites[0].tests.map((entry) => entry.location), [
    {filePath: "/project/tests/table.test.js", line: 91},
    {filePath: "/project/tests/table.test.js", line: 91},
    {filePath: "/project/tests/table.test.js", line: 92}
  ])
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

test("schema-1/schema-2 default contexts fail clearly before registration", async () => {
  const key = Symbol.for("@velocious/testing.default-context.v1")
  const compatible = globalThis[key]

  try {
    globalThis[key] = {protocolMajor: 1, schemaVersion: 1, registry: {suites: []}}
    await assert.rejects(
      import(`../src/context.js?incompatible=${Date.now()}`),
      /Incompatible @velocious\/testing default context: found protocol 1\/schema 1, expected protocol 1\/schema 2/
    )
  } finally {
    globalThis[key] = compatible
  }
})

test("reset clears declaration state from isolated and default contexts", () => {
  const isolated = createTestContext()
  isolated.describe.skip("old isolated", () => isolated.it.todo("old test"))
  isolated.reset()
  isolated.describe("new isolated", () => isolated.it("new test", () => {}))
  assert.deepEqual(isolated.registry.suites.map((suite) => [suite.name, suite.state]), [["new isolated", "run"]])

  defaultTestContext.reset({config: true})
  testing.describe.todo("old default", () => testing.it("old child", () => {}))
  defaultTestContext.reset()
  testing.describe("new default", () => testing.it("new child", () => {}))
  assert.deepEqual(defaultTestContext.registry.suites.map((suite) => [suite.name, suite.state]), [["new default", "run"]])
})
