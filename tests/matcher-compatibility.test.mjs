import assert from "node:assert/strict"
import test from "node:test"

import {
  arrayContaining,
  createMockScope,
  expect,
  isArrayContaining,
  isObjectContaining,
  matchArrayContaining,
  matchObject,
  objectContaining
} from "../src/index.js"

const legacyAssertionSpecs = new Map([
  ["spec/testing/expect-formatting-spec.js", "formatting"],
  ["spec/testing/expect/array-containing-spec.js", "array containing"],
  ["spec/testing/expect/object-containing-spec.js", "object containing"],
  ["spec/testing/expect/to-be-close-to-spec.js", "numeric comparisons"],
  ["spec/testing/expect/to-be-defined-spec.js", "scalar predicates"],
  ["spec/testing/expect/to-be-false-spec.js", "scalar predicates"],
  ["spec/testing/expect/to-be-greater-than-or-equal-spec.js", "numeric comparisons"],
  ["spec/testing/expect/to-be-greater-than-spec.js", "numeric comparisons"],
  ["spec/testing/expect/to-be-instance-of-spec.js", "scalar predicates"],
  ["spec/testing/expect/to-be-less-than-or-equal-spec.js", "numeric comparisons"],
  ["spec/testing/expect/to-be-less-than-spec.js", "numeric comparisons"],
  ["spec/testing/expect/to-be-null-spec.js", "scalar predicates"],
  ["spec/testing/expect/to-be-spec.js", "scalar predicates"],
  ["spec/testing/expect/to-be-true-spec.js", "scalar predicates"],
  ["spec/testing/expect/to-be-truthy-spec.js", "scalar predicates"],
  ["spec/testing/expect/to-be-undefined-spec.js", "scalar predicates"],
  ["spec/testing/expect/to-change-spec.js", "change assertions"],
  ["spec/testing/expect/to-contain-equal-spec.js", "containment"],
  ["spec/testing/expect/to-contain-spec.js", "containment"],
  ["spec/testing/expect/to-equal-spec.js", "equality"],
  ["spec/testing/expect/to-have-attributes-spec.js", "attributes and length"],
  ["spec/testing/expect/to-have-length-spec.js", "attributes and length"],
  ["spec/testing/expect/to-match-object-spec.js", "partial object and expression matching"],
  ["spec/testing/expect/to-match-spec.js", "partial object and expression matching"],
  ["spec/testing/expect/to-throw-error-spec.js", "throw assertions"],
  ["spec/testing/expect/to-throw-spec.js", "throw assertions"]
])

test("the compatibility inventory maps every legacy assertion spec", () => {
  assert.equal(legacyAssertionSpecs.size, 26)
  assert.deepEqual([...new Set(legacyAssertionSpecs.values())].sort(), [
    "array containing",
    "attributes and length",
    "change assertions",
    "containment",
    "equality",
    "formatting",
    "numeric comparisons",
    "object containing",
    "partial object and expression matching",
    "scalar predicates",
    "throw assertions"
  ])
})

test("compatibility helpers recognize only branded containing matchers", () => {
  const arrayMatcher = arrayContaining([1])
  const objectMatcher = objectContaining({id: 1})

  assert.equal(isArrayContaining(arrayMatcher), true)
  assert.equal(isArrayContaining(objectMatcher), false)
  assert.equal(isObjectContaining(objectMatcher), true)
  assert.equal(isObjectContaining(arrayMatcher), false)
  assert.equal(isArrayContaining({__velociousMatcher: "arrayContaining", value: [1]}), false)
  assert.equal(isObjectContaining({__velociousMatcher: "objectContaining", value: {id: 1}}), false)
  assert.equal(isArrayContaining(null), false)
  assert.equal(isObjectContaining(undefined), false)
})

test("matchArrayContaining returns the legacy result shape through canonical equality", () => {
  assert.deepEqual(matchArrayContaining([1, 2, 3], [2, 3]), {matches: true, differences: {}})
  assert.deepEqual(
    matchArrayContaining([{id: 1}, {id: 2, name: "Ada"}], [objectContaining({id: 2})]),
    {matches: true, differences: {}}
  )
  assert.deepEqual(matchArrayContaining([1], [1, 1]), {
    matches: false,
    differences: {$: [[1, 1], [1]]}
  })
  assert.deepEqual(matchArrayContaining("not an array", [1]), {
    matches: false,
    differences: {$: [[1], "not an array"]}
  })
  assert.throws(() => matchArrayContaining([], "nope"), {
    name: "Error",
    message: "Expected array but got string"
  })
  assert.throws(() => matchArrayContaining([undefined], new Array(1)), {
    name: "TypeError",
    message: "arrayContaining() requires a dense array"
  })
})

test("matchObject returns path-keyed legacy differences through canonical partial equality", () => {
  const actualDate = new Date("2024-01-01T00:00:00.000Z")
  const expectedDate = new Date("2024-01-02T00:00:00.000Z")

  assert.deepEqual(matchObject(
    {items: [{id: 1, name: "Ada"}], extra: true},
    {items: [{id: 1}]}
  ), {matches: true, differences: {}})
  assert.deepEqual(matchObject(
    [{id: 1, name: "Ada"}],
    [{id: 1}]
  ), {matches: true, differences: {}})
  assert.deepEqual(matchObject(
    {items: [1, 2, 3]},
    {items: arrayContaining([2, 3])}
  ), {matches: true, differences: {}})
  assert.deepEqual(matchObject(
    {profile: {id: 1}, createdAt: actualDate},
    {profile: {id: 2}, createdAt: expectedDate, missing: undefined}
  ), {
    matches: false,
    differences: {
      createdAt: [expectedDate, actualDate],
      missing: [undefined, undefined],
      "profile.id": [2, 1]
    }
  })
  assert.deepEqual(matchObject(
    {"a-b": 1, nested: {"x.y": 2}},
    {"a-b": 3, nested: {"x.y": 4}}
  ), {
    matches: false,
    differences: {"a-b": [3, 1], "nested.x.y": [4, 2]}
  })
  for (const expected of [null, undefined, false, 1, "value", Symbol("value"), () => {}]) {
    assert.throws(() => matchObject(expected, expected), {
      name: "Error",
      message: `Expected object but got ${typeof expected}`
    })
  }
})

test("legacy formatting scenarios retain observable failure information", () => {
  const circular = {label: "actual"}
  circular.self = circular
  assert.throws(() => expect(circular).toBe({label: "expected"}), /Circular/u)

  class CustomThing {}
  assert.throws(() => expect(new CustomThing()).toBeInstanceOf(Array), /CustomThing/u)
})

test("legacy arrayContaining scenarios preserve pass and fail semantics", () => {
  expect([1, 2, 3]).toEqual(arrayContaining([2, 3]))
  expect([{id: 1}, {id: 2, name: "Ada"}]).toEqual(arrayContaining([objectContaining({id: 2})]))
  assert.throws(() => expect([1, 2, 3]).toEqual(arrayContaining([2, 4])))
  assert.throws(() => expect([1, 2, 3]).not.toEqual(arrayContaining([1])))
  assert.throws(() => arrayContaining("nope"), /Expected array but got string/u)
  assert.throws(() => arrayContaining(new Array(1)), /dense array/u)
})

test("legacy objectContaining scenarios preserve pass and fail semantics", () => {
  expect({a: 1, b: 2}).toEqual(objectContaining({a: 1}))
  assert.throws(() => expect({a: 1, b: 2}).toEqual(objectContaining({a: 2})))
  assert.throws(() => expect({a: 1, b: 2}).not.toEqual(objectContaining({a: 1})))
  assert.throws(() => objectContaining(5), /Expected object but got number/u)
  assert.throws(() => objectContaining([]), /Expected object but got object/u)
})

test("legacy numeric comparison specs preserve positive and negated behavior", () => {
  expect(0.2 + 0.1).toBeCloseTo(0.3)
  assert.throws(() => expect(0.31).toBeCloseTo(0.3, 2))
  assert.throws(() => expect(0.304).not.toBeCloseTo(0.3, 2))
  expect(4).toBeGreaterThan(3)
  expect(3).toBeGreaterThanOrEqual(3)
  expect(4).toBeGreaterThanOrEqual(3)
  expect(2).toBeLessThan(3)
  expect(2).toBeLessThanOrEqual(3)
  expect(3).toBeLessThanOrEqual(3)
  assert.throws(() => expect(3).toBeGreaterThan(3))
  assert.throws(() => expect(3).not.toBeGreaterThanOrEqual(3))
  assert.throws(() => expect(3).toBeLessThan(3))
  assert.throws(() => expect(2).not.toBeLessThan(3))
})

test("legacy scalar predicate specs preserve positive and failure behavior", () => {
  expect(3).toBe(3)
  expect("value").toBeDefined()
  expect(false).toBeFalse()
  expect([]).toBeInstanceOf(Array)
  expect(null).toBeNull()
  expect(true).toBeTrue()
  expect("hello").toBeTruthy()
  expect(1).toBeTruthy()
  expect(undefined).toBeUndefined()
  assert.throws(() => expect(3).toBe(4))
  assert.throws(() => expect(3).not.toBe(3))
  assert.throws(() => expect(undefined).toBeDefined())
  assert.throws(() => expect(true).toBeFalse())
  assert.throws(() => expect({}).toBeInstanceOf(Array))
  assert.throws(() => expect(0).toBeNull())
  assert.throws(() => expect(false).toBeTrue())
  assert.throws(() => expect(0).toBeTruthy())
  assert.throws(() => expect("hello").not.toBeTruthy())
  assert.throws(() => expect(null).toBeUndefined())
})

test("legacy change spec supports async actions and multiple probes", async () => {
  let count = 1
  let doubled = 2
  await expect(async () => {
    await Promise.resolve()
    count += 2
    doubled += 4
  }).toChange(async () => count).by(2)
    .andChange(() => doubled).by(4)
    .execute()

  await assert.rejects(async () => {
    await expect(() => { count += 1 }).toChange(() => count).by(2).execute()
  }, /Expected to change by 2 but changed by 1/u)
})

test("legacy containment specs preserve arrays, strings, aliases, deep values, and not", () => {
  expect([1, 2, 3]).toContain(2)
  expect("hello").toContain("ell")
  expect("hello").toInclude("ell")
  expect([1, 2, 3]).not.toContain(4)
  expect("hello").not.toContain("world")
  expect("hello").not.toInclude("world")
  expect([{id: 1}, {id: 2}]).toContainEqual({id: 2})
  assert.throws(() => expect("hello").toContain("world"))
  assert.throws(() => expect("hello").toInclude("world"))
  assert.throws(() => expect([1, 2, 3]).not.toContain(2))
  assert.throws(() => expect([{id: 1}]).toContainEqual({id: 2}))
  assert.throws(() => expect([{id: 1}]).not.toContainEqual({id: 1}))
})

test("legacy equality spec preserves array and set mismatch behavior", () => {
  expect(["a", "b"]).toEqual(["a", "b"])
  expect(new Set(["a", "b"])).toEqual(new Set(["b", "a"]))
  assert.throws(() => expect(["a", "b"]).toEqual(["a", "c"]), /Diff:/u)
  assert.throws(() => expect(new Set(["a", "b"])).toEqual(new Set(["a", "c"])))
})

test("legacy attribute and length specs preserve observable behavior", () => {
  const person = {name: () => "Ada", age: () => 5}
  expect(person).toHaveAttributes({name: "Ada", age: 5})
  assert.throws(() => expect(person).toHaveAttributes({age: 6}), /different values/u)
  expect([1, 2, 3]).toHaveLength(3)
  expect("abc").toHaveLength(3)
  assert.throws(() => expect([1]).toHaveLength(2))
  assert.throws(() => expect([1]).not.toHaveLength(1))
})

test("legacy partial-object and regular-expression specs preserve behavior", () => {
  expect({a: 1, b: {c: 2, d: 3}, extra: true}).toMatchObject({b: {c: 2}})
  expect({items: [{id: 1, name: "a"}, {id: 2}]}).toMatchObject({items: [{id: 1}]})
  expect({createdAt: new Date("2024-01-01T00:00:00.000Z")}).toMatchObject({
    createdAt: new Date("2024-01-01T00:00:00.000Z")
  })
  expect("hello").toMatch(/ell/u)
  assert.throws(() => expect({a: 1, b: {c: 2}}).toMatchObject({b: {c: 3}}))
  assert.throws(() => expect({a: 1}).toMatchObject(5), /Expected object but got number/u)
  assert.throws(() => expect({a: 1, b: 2}).not.toMatchObject({a: 1}))
  assert.throws(() => expect("hello").toMatch(/world/u))
})

test("legacy throw specs preserve synchronous and asynchronous behavior", async () => {
  await expect(() => { throw new Error("boom") }).toThrow()
  await expect(() => { throw new Error("boom") }).toThrow("boom")
  await expect(() => { throw new Error("boom") }).toThrow(/boo/u)
  await expect(() => { throw new TypeError("boom") }).toThrow(TypeError)
  await expect(async () => { throw new Error("boom") }).toThrowError("boom")
  await assert.rejects(expect(() => {}).toThrow(), /Expected to fail but didn't/u)
  await assert.rejects(expect(() => { throw new Error("boom") }).not.toThrow(), /unexpected to throw/u)
  await assert.rejects(expect(() => { throw new Error("boom") }).toThrowError("nope"), /failed with 'boom'/u)
})

test("promise paths and mock matchers use the same canonical equality", async () => {
  await expect(Promise.resolve({id: 1})).resolves.toEqual(objectContaining({id: 1}))
  await expect(Promise.resolve("ready")).resolves.not.toEqual("waiting")
  await expect(Promise.reject(new TypeError("boom"))).rejects.toThrow(TypeError)
  await expect(Promise.reject({id: 2})).rejects.toMatchObject({id: 2})

  const implementation = createMockScope().fn()
  implementation({id: 1, tags: ["admin"]})
  expect(implementation).toHaveBeenCalledWith(objectContaining({
    tags: arrayContaining(["admin"])
  }))
})
