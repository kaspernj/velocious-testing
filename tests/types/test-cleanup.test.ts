import {withTestCleanup} from "../../build/index.js"

await withTestCleanup(async (after) => {
  after(() => {})
  after(async () => {})
})

// @ts-expect-error cleanups must be callable
await withTestCleanup((after) => after("not a cleanup"))
