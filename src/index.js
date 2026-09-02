// @ts-check

import {defaultTestContext} from "./context.js"

export {CONTEXT_SCHEMA_VERSION, createTestContext, defaultTestContext, installGlobals} from "./context.js"
export {arrayContaining, expect, objectContaining, waitForEvent} from "./matchers.js"

export const describe = defaultTestContext.describe
export const fdescribe = defaultTestContext.fdescribe
export const xdescribe = defaultTestContext.xdescribe
export const it = defaultTestContext.it
export const test = defaultTestContext.test
export const fit = defaultTestContext.fit
export const xit = defaultTestContext.xit
export const xtest = defaultTestContext.xtest
export const beforeAll = defaultTestContext.beforeAll
export const afterAll = defaultTestContext.afterAll
export const beforeEach = defaultTestContext.beforeEach
export const afterEach = defaultTestContext.afterEach
export const configureTests = defaultTestContext.configureTests
