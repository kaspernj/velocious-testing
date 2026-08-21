// @ts-check

import {defaultTestContext} from "./context.js"

export {createTestContext, defaultTestContext, installGlobals} from "./context.js"
export {arrayContaining, expect, objectContaining, waitForEvent} from "./matchers.js"

export const describe = defaultTestContext.describe
export const it = defaultTestContext.it
export const fit = defaultTestContext.fit
export const beforeAll = defaultTestContext.beforeAll
export const afterAll = defaultTestContext.afterAll
export const beforeEach = defaultTestContext.beforeEach
export const afterEach = defaultTestContext.afterEach
export const configureTests = defaultTestContext.configureTests
