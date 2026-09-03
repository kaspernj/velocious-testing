// @ts-check

import {defaultTestContext} from "./context.js"

/** @typedef {import("./matchers.js").AsymmetricMatcher} AsymmetricMatcher */
/** @typedef {import("./matchers.js").CustomMatcher} CustomMatcher */
/** @typedef {import("./matchers.js").CustomMatcherContext} CustomMatcherContext */
/** @typedef {import("./matchers.js").CustomMatcherDefinitions} CustomMatcherDefinitions */
/** @typedef {import("./matchers.js").CustomMatcherResult} CustomMatcherResult */
/** @typedef {import("./fake-timers.js").FakeTimerOptions} FakeTimerOptions */
/** @typedef {import("./fake-timers.js").FakeTimers} FakeTimers */
/** @typedef {import("./fake-timers.js").FakeTimerTarget} FakeTimerTarget */

export {CONTEXT_SCHEMA_VERSION, createTestContext, defaultTestContext, installGlobals} from "./context.js"
export {
  any,
  anything,
  arrayContaining,
  Expect,
  expect,
  objectContaining,
  PromiseExpectation,
  stringContaining,
  stringMatching,
  waitForEvent
} from "./matchers.js"
export {createMockScope, mock} from "./mocks.js"
export {createFakeTimers} from "./fake-timers.js"

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
