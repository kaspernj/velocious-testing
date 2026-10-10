import assert from "node:assert/strict"
import test from "node:test"

import {arrayContaining, expect} from "../src/index.js"

test("toEqual compares Buffers and typed arrays by their bytes", () => {
  expect(Buffer.from([1, 2, 3])).toEqual(Buffer.from([1, 2, 3]))
  expect(Buffer.alloc(0)).toEqual(Buffer.from([]))
  expect(new Uint8Array([1, 2, 3])).toEqual(new Uint8Array([1, 2, 3]))

  const pool = Buffer.from([9, 1, 2, 9])
  expect(pool.subarray(1, 3)).toEqual(Buffer.from([1, 2]))

  expect(Buffer.from([1, 2, 3])).not.toEqual(Buffer.from([1, 2, 4]))
  expect(Buffer.from([1, 2])).not.toEqual(Buffer.from([1, 2, 3]))
  expect(new Uint8Array([1, 2, 3])).not.toEqual(new Uint8Array([1, 2, 4]))
})

test("typed-array equality preserves class boundaries in nested structures", () => {
  expect(Buffer.from([1, 2])).not.toEqual(new Uint8Array([1, 2]))
  expect(new Uint8Array([1, 2])).not.toEqual(new Int8Array([1, 2]))
  expect(new Uint8Array([1, 2])).not.toEqual([1, 2])
  expect(Buffer.from("abc")).not.toEqual("abc")

  expect({data: Buffer.from([1, 2]), tag: "x"}).toEqual({data: Buffer.from([1, 2]), tag: "x"})
  expect({data: Buffer.from([1, 2])}).not.toEqual({data: Buffer.from([1, 3])})
  expect([Buffer.from([1])]).toEqual([Buffer.from([1])])
  expect([Buffer.from([1])]).toEqual(arrayContaining([Buffer.from([1])]))
  expect([Buffer.from([1])]).toContainEqual(Buffer.from([1]))
  expect({data: Buffer.from([1, 2]), extra: true}).toMatchObject({data: Buffer.from([1, 2])})
})

test("ArrayBuffer and DataView values compare by their contents", () => {
  const first = new ArrayBuffer(2)
  const second = new ArrayBuffer(2)
  new Uint8Array(first).set([7, 8])
  new Uint8Array(second).set([7, 8])
  expect(first).toEqual(second)

  const different = new ArrayBuffer(2)
  new Uint8Array(different).set([7, 9])
  expect(first).not.toEqual(different)
  expect(new ArrayBuffer(2)).not.toEqual(new ArrayBuffer(3))
  expect(new ArrayBuffer(2)).not.toEqual(first)

  expect(new DataView(first)).toEqual(new DataView(second))
  expect(new DataView(first)).not.toEqual(new DataView(different))
  expect(new DataView(first)).not.toEqual(new Uint8Array([7, 8]))
})

test("binary difference diagnostics render bounded hex previews", () => {
  assert.throws(
    () => expect(Buffer.from([1, 2])).toEqual(Buffer.from([3, 4])),
    /expected <Buffer 03 04 \(2 bytes\)>, received <Buffer 01 02 \(2 bytes\)>/u
  )
  const oversized = Buffer.alloc(30, 1)
  const oversizedOther = Buffer.from(oversized)
  oversizedOther[29] = 2
  assert.throws(
    () => expect(oversized).toEqual(oversizedOther),
    /received <Buffer 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 … \(30 bytes\)>/u
  )
  assert.throws(() => expect(Buffer.from([1])).not.toEqual(Buffer.from([1])), /unexpected equal/u)
})
