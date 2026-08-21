// @ts-check

import {TestEvents} from "./events.js"
import {expect} from "./matchers.js"

export const PROTOCOL_MAJOR = 1
export const CONTEXT_SCHEMA_VERSION = 1
export const DEFAULT_CONTEXT_SYMBOL = Symbol.for("@velocious/testing.default-context.v1")

/** @typedef {{filePath?: string, line?: number}} DeclarationLocation */
/** @typedef {{excludeTags: string[], defaultTimeoutMs: number, retries: number, consoleOutput: "failure" | "live", failedConsoleOutputMaxLines: number}} TestConfig */
/** @typedef {{excludeTags?: string[] | string, defaultTimeoutMs?: number, defaultTimeoutSeconds?: number, retries?: number, consoleOutput?: "failure" | "live", failedConsoleOutputMaxLines?: number}} TestConfigInput */
/** @typedef {(...args: any[]) => void | Promise<void>} LifecycleCallback */
/** @typedef {Record<string, any> & {focus?: boolean, tags?: string[] | string, retries?: number, retry?: number, timeoutMs?: number, timeoutSeconds?: number}} TestDeclarationOptions */
/** @typedef {{callback: LifecycleCallback, location: DeclarationLocation}} HookDeclaration */
/** @typedef {{type: "test", name: string, callback: LifecycleCallback, options: TestDeclarationOptions, tags: string[], focus: boolean, location: DeclarationLocation}} TestDeclaration */
/** @typedef {{beforeAll: HookDeclaration[], afterAll: HookDeclaration[], beforeEach: HookDeclaration[], afterEach: HookDeclaration[]}} SuiteHooks */
/** @typedef {{type: "suite", name: string, options: TestDeclarationOptions, tags: string[], focus: boolean, location: DeclarationLocation, hooks: SuiteHooks, suites: SuiteDeclaration[], tests: TestDeclaration[]}} SuiteDeclaration */
/** @typedef {{suites: SuiteDeclaration[]}} TestRegistry */
/**
 * @typedef {object} TestContext
 * @property {number} protocolMajor
 * @property {number} schemaVersion
 * @property {TestRegistry} registry
 * @property {TestConfig} config
 * @property {TestEvents} events
 * @property {(name: string, optionsOrCallback: TestDeclarationOptions | LifecycleCallback, callback?: LifecycleCallback) => any} describe
 * @property {(name: string, optionsOrCallback: TestDeclarationOptions | LifecycleCallback, callback?: LifecycleCallback) => void} it
 * @property {(name: string, optionsOrCallback: TestDeclarationOptions | LifecycleCallback, callback?: LifecycleCallback) => void} fit
 * @property {(callback: LifecycleCallback) => void} beforeAll
 * @property {(callback: LifecycleCallback) => void} afterAll
 * @property {(callback: LifecycleCallback) => void} beforeEach
 * @property {(callback: LifecycleCallback) => void} afterEach
 * @property {(config?: TestConfigInput) => void} configureTests
 * @property {typeof expect} expect
 * @property {(options?: {config?: boolean}) => void} reset
 * @property {(locator: () => DeclarationLocation) => void} setDeclarationLocator
 */
/** @typedef {TestContext & {_stack: SuiteDeclaration[], _declarationLocator: () => DeclarationLocation}} InternalTestContext */

/** @param {string[] | string | undefined} tags @returns {string[]} */
export function normalizeTags(tags) {
  if (!tags) return []
  const values = (Array.isArray(tags) ? tags : [tags]).flatMap((tag) => String(tag).split(",")).map((tag) => tag.trim()).filter(Boolean)
  return [...new Set(values)]
}

/** @returns {any} */
function createRegistry() { return {suites: []} }

/** @param {InternalTestContext} context @param {string} type @param {any} declaration */
function emitDeclaration(context, type, declaration) {
  context.events.emit("declaration", {protocolMajor: PROTOCOL_MAJOR, type, declaration})
}

/** @param {InternalTestContext} context @param {string} name @param {any} arg1 @param {any} arg2 @param {boolean} [focused] @returns {any} */
function declareTest(context, name, arg1, arg2, focused = false) {
  const parent = context._stack.at(-1)
  if (!parent) throw new Error("Tests must be declared inside a describe block")
  const options = typeof arg1 === "function" ? {} : arg1 || {}
  const callback = typeof arg1 === "function" ? arg1 : arg2
  if (typeof callback !== "function") throw new Error(`Invalid arguments for it: ${name}`)
  if (parent.tests.some((/** @type {any} */ entry) => entry.name === name)) throw new Error(`Duplicate test description: ${name}`)
  const tags = normalizeTags([...parent.tags, ...normalizeTags(options.tags)])
  const mergedOptions = {...parent.options, ...options, tags}
  /** @type {TestDeclaration} */
  const declaration = {
    type: "test",
    name,
    callback,
    options: mergedOptions,
    tags,
    focus: focused || Boolean(options.focus),
    location: context._declarationLocator()
  }
  parent.tests.push(declaration)
  emitDeclaration(context, "test", declaration)
}

/** @param {InternalTestContext} context @param {string} name @param {any} arg1 @param {any} arg2 @returns {any} */
function declareSuite(context, name, arg1, arg2) {
  const options = typeof arg1 === "function" ? {} : arg1 || {}
  const callback = typeof arg1 === "function" ? arg1 : arg2
  if (typeof callback !== "function") throw new Error(`Invalid arguments for describe: ${name}`)
  const parent = context._stack.at(-1)
  const collection = parent ? parent.suites : context.registry.suites
  if (collection.some((/** @type {any} */ entry) => entry.name === name)) throw new Error(`Duplicate test description: ${name}`)
  const inheritedTags = parent?.tags || []
  const tags = normalizeTags([...inheritedTags, ...normalizeTags(options.tags)])
  const mergedOptions = {...(parent?.options || {}), ...options, tags}
  /** @type {SuiteDeclaration} */
  const declaration = {
    type: "suite",
    name,
    options: mergedOptions,
    tags,
    focus: Boolean(options.focus),
    location: context._declarationLocator(),
    hooks: {beforeAll: [], afterAll: [], beforeEach: [], afterEach: []},
    suites: [],
    tests: []
  }
  collection.push(declaration)
  emitDeclaration(context, "suite", declaration)
  context._stack.push(declaration)
  try {
    const result = callback()
    if (result && typeof result.then === "function") return result.finally(() => context._stack.pop())
    context._stack.pop()
    return result
  } catch (error) {
    context._stack.pop()
    throw error
  }
}

/** @param {InternalTestContext} context @param {keyof SuiteHooks} hook @param {LifecycleCallback} callback */
function declareHook(context, hook, callback) {
  const parent = context._stack.at(-1)
  if (!parent) throw new Error(`${hook} must be declared inside a describe block`)
  if (typeof callback !== "function") throw new Error(`${hook} callback must be a function`)
  const declaration = {callback, location: context._declarationLocator()}
  parent.hooks[hook].push(declaration)
  emitDeclaration(context, hook, declaration)
}

/**
 * @param {{declarationLocator?: () => {filePath?: string, line?: number}}} [options]
 * @returns {TestContext}
 */
export function createTestContext(options = {}) {
  /** @type {InternalTestContext} */
  const context = {
    protocolMajor: PROTOCOL_MAJOR,
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    registry: createRegistry(),
    config: {excludeTags: [], defaultTimeoutMs: 60_000, retries: 0, consoleOutput: "failure", failedConsoleOutputMaxLines: 200},
    events: new TestEvents(),
    _stack: [],
    _declarationLocator: options.declarationLocator || (() => ({})),
    describe: () => {},
    it: () => {},
    fit: () => {},
    beforeAll: () => {},
    afterAll: () => {},
    beforeEach: () => {},
    afterEach: () => {},
    configureTests: () => {},
    expect,
    reset: () => {},
    setDeclarationLocator: () => {}
  }
  /** @param {string} name @param {any} arg1 @param {any} [arg2] */
  context.describe = (name, arg1, arg2) => declareSuite(context, name, arg1, arg2)
  /** @param {string} name @param {any} arg1 @param {any} [arg2] */
  context.it = (name, arg1, arg2) => declareTest(context, name, arg1, arg2)
  /** @param {string} name @param {any} arg1 @param {any} [arg2] */
  context.fit = (name, arg1, arg2) => declareTest(context, name, arg1, arg2, true)
  /** @param {LifecycleCallback} callback */
  context.beforeAll = (callback) => declareHook(context, "beforeAll", callback)
  /** @param {LifecycleCallback} callback */
  context.afterAll = (callback) => declareHook(context, "afterAll", callback)
  /** @param {LifecycleCallback} callback */
  context.beforeEach = (callback) => declareHook(context, "beforeEach", callback)
  /** @param {LifecycleCallback} callback */
  context.afterEach = (callback) => declareHook(context, "afterEach", callback)
  /** @param {TestConfigInput} [config] */
  context.configureTests = (config = {}) => {
    if (config.excludeTags !== undefined) context.config.excludeTags = normalizeTags(config.excludeTags)
    if (config.defaultTimeoutSeconds !== undefined) context.config.defaultTimeoutMs = config.defaultTimeoutSeconds * 1000
    if (config.defaultTimeoutMs !== undefined) context.config.defaultTimeoutMs = config.defaultTimeoutMs
    if (config.retries !== undefined) context.config.retries = config.retries
    if (config.failedConsoleOutputMaxLines !== undefined) context.config.failedConsoleOutputMaxLines = config.failedConsoleOutputMaxLines
    if (config.consoleOutput !== undefined) {
      if (!["failure", "live"].includes(config.consoleOutput)) throw new Error(`Invalid consoleOutput config: ${config.consoleOutput}`)
      context.config.consoleOutput = config.consoleOutput
    }
    context.events.emit("config", {...context.config})
  }
  context.reset = ({config = false} = {}) => {
    context.registry = createRegistry()
    context._stack.length = 0
    if (config) Object.assign(context.config, {excludeTags: [], defaultTimeoutMs: 60_000, retries: 0, consoleOutput: "failure", failedConsoleOutputMaxLines: 200})
    context.events.emit("reset", {config})
  }
  /** @param {() => DeclarationLocation} locator */
  context.setDeclarationLocator = (locator) => { context._declarationLocator = locator }
  return context
}

// Narrows the realm object at the symbol-keyed compatibility boundary.
/** @type {Record<symbol, any>} */
const symbolRegistry = globalThis
/** @type {TestContext | undefined} */
const existing = symbolRegistry[DEFAULT_CONTEXT_SYMBOL]
if (existing && (existing.protocolMajor !== PROTOCOL_MAJOR || existing.schemaVersion !== CONTEXT_SCHEMA_VERSION)) {
  throw new Error(`Incompatible @velocious/testing default context: found protocol ${existing.protocolMajor}/schema ${existing.schemaVersion}, expected protocol ${PROTOCOL_MAJOR}/schema ${CONTEXT_SCHEMA_VERSION}`)
}
/** @type {TestContext} */
export const defaultTestContext = existing || createTestContext()
if (!existing) symbolRegistry[DEFAULT_CONTEXT_SYMBOL] = defaultTestContext

/** @param {Record<string, any>} [target] @param {TestContext} [context] @returns {Record<string, any>} */
export function installGlobals(target = globalThis, context = defaultTestContext) {
  Object.assign(target, {
    describe: context.describe,
    it: context.it,
    fit: context.fit,
    beforeAll: context.beforeAll,
    afterAll: context.afterAll,
    beforeEach: context.beforeEach,
    afterEach: context.afterEach,
    configureTests: context.configureTests,
    expect: context.expect,
    testEvents: context.events
  })
  return target
}
