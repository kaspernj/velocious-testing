// @ts-check

import {TestEvents} from "./events.js"
import {expect} from "./matchers.js"

export const PROTOCOL_MAJOR = 1
export const CONTEXT_SCHEMA_VERSION = 2
export const DEFAULT_CONTEXT_SYMBOL = Symbol.for("@velocious/testing.default-context.v1")

/** @typedef {{filePath?: string, line?: number}} DeclarationLocation */
/** @typedef {"run" | "skip" | "todo"} DeclarationState */
/** @typedef {{excludeTags: string[], defaultTimeoutMs: number, retries: number, consoleOutput: "failure" | "live", failedConsoleOutputMaxLines: number}} TestConfig */
/** @typedef {{excludeTags?: string[] | string, defaultTimeoutMs?: number, defaultTimeoutSeconds?: number, retries?: number, consoleOutput?: "failure" | "live", failedConsoleOutputMaxLines?: number}} TestConfigInput */
/** @typedef {(...args: any[]) => void | Promise<void>} LifecycleCallback */
/** @typedef {Record<string, any> & {focus?: boolean, tags?: string[] | string, retries?: number, retry?: number, timeoutMs?: number, timeoutSeconds?: number}} TestDeclarationOptions */
/** @typedef {{callback: LifecycleCallback, location: DeclarationLocation}} HookDeclaration */
/** @typedef {{type: "test", name: string, callback: LifecycleCallback, options: TestDeclarationOptions, tags: string[], focus: boolean, state: DeclarationState, rowArguments: any[], location: DeclarationLocation}} TestDeclaration */
/** @typedef {{beforeAll: HookDeclaration[], afterAll: HookDeclaration[], beforeEach: HookDeclaration[], afterEach: HookDeclaration[]}} SuiteHooks */
/** @typedef {{type: "suite", name: string, options: TestDeclarationOptions, tags: string[], focus: boolean, state: DeclarationState, location: DeclarationLocation, hooks: SuiteHooks, suites: SuiteDeclaration[], tests: TestDeclaration[]}} SuiteDeclaration */
/** @typedef {{suites: SuiteDeclaration[]}} TestRegistry */
/** @typedef {(name: string, optionsOrCallback: TestDeclarationOptions | LifecycleCallback, callback?: LifecycleCallback) => any} SuiteDeclarationFunction */
/** @typedef {(name: string, optionsOrCallback: TestDeclarationOptions | LifecycleCallback, callback?: LifecycleCallback) => void} TestDeclarationFunction */
/** @typedef {(name: string, optionsOrCallback?: TestDeclarationOptions | LifecycleCallback, callback?: LifecycleCallback) => void} SkippedTestDeclarationFunction */
/** @typedef {(name: string, options?: TestDeclarationOptions) => void} TodoTestDeclarationFunction */
/** @typedef {SuiteDeclarationFunction & {only: SuiteDeclarationFunction, skip: SuiteDeclarationFunction, todo: SuiteDeclarationFunction, each: (rows: any[]) => SuiteDeclarationFunction}} SuiteDsl */
/** @typedef {TestDeclarationFunction & {only: TestDeclarationFunction, skip: SkippedTestDeclarationFunction, todo: TodoTestDeclarationFunction, each: (rows: any[]) => TestDeclarationFunction}} TestDsl */
/**
 * @typedef {object} TestContext
 * @property {number} protocolMajor
 * @property {number} schemaVersion
 * @property {TestRegistry} registry
 * @property {TestConfig} config
 * @property {TestEvents} events
 * @property {SuiteDsl} describe
 * @property {SuiteDeclarationFunction} fdescribe
 * @property {SuiteDeclarationFunction} xdescribe
 * @property {TestDsl} it
 * @property {TestDsl} test
 * @property {TestDeclarationFunction} fit
 * @property {SkippedTestDeclarationFunction} xit
 * @property {SkippedTestDeclarationFunction} xtest
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

/** @param {any} row @returns {any[]} */
function rowArguments(row) { return Array.isArray(row) ? row : [row] }

/** @param {string} kind @param {any[]} rows */
function validateRows(kind, rows) {
  if (!Array.isArray(rows)) throw new Error(`${kind}.each rows must be an array`)
  if (rows.length === 0) throw new Error(`${kind}.each rows must contain at least one row`)
  for (let index = 0; index < rows.length; index += 1) {
    if (!Object.hasOwn(rows, index)) throw new Error(`${kind}.each rows must not be sparse: missing row at index ${index}`)
  }
}

/** @param {string} template */
function validateTableTemplate(template) {
  for (let index = 0; index < template.length; index += 1) {
    if (template[index] !== "%") continue
    const token = template[index + 1]
    if (!["%", "#", "s", "d", "j"].includes(token || "")) {
      throw new Error(`Unsupported table interpolation token %${token || "<end>"}`)
    }
    index += 1
  }
}

/** @param {string} kind @param {string} name @param {any} arg1 @param {any} arg2 @returns {LifecycleCallback} */
function requiredCallback(kind, name, arg1, arg2) {
  const callback = typeof arg1 === "function" ? arg1 : arg2
  if (typeof callback !== "function") throw new Error(`Invalid arguments for ${kind}: ${name}`)
  return callback
}

/** @param {any} value @param {string} token @param {number} rowIndex @returns {string} */
function jsonTableValue(value, token, rowIndex) {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new Error()
    return serialized
  } catch {
    throw new Error(`Table row ${rowIndex} token ${token} could not be serialized as JSON`)
  }
}

/** @param {any} row @param {string} path @param {number} rowIndex @returns {any} */
function tablePathValue(row, path, rowIndex) {
  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`Table row ${rowIndex} token $${path} requires an object row`)
  }
  let value = row
  for (const segment of path.split(".")) {
    if (value === null || (typeof value !== "object" && typeof value !== "function") || !Object.hasOwn(value, segment)) {
      throw new Error(`Table row ${rowIndex} path $${path} was not found`)
    }
    value = value[segment]
  }
  return value
}

/** @param {string} template @param {any} row @param {number} rowIndex @returns {string} */
function interpolateTableName(template, row, rowIndex) {
  const args = rowArguments(row)
  let argumentIndex = 0
  let output = ""
  for (let index = 0; index < template.length; index += 1) {
    const character = template[index]
    if (character === "%") {
      const token = template[index + 1]
      if (token === "%") { output += "%"; index += 1; continue }
      if (token === "#") { output += String(rowIndex); index += 1; continue }
      if (!["s", "d", "j"].includes(token || "")) {
        throw new Error(`Unsupported table interpolation token %${token || "<end>"}`)
      }
      if (argumentIndex >= args.length) {
        throw new Error(`Table row ${rowIndex} token %${token} has no positional argument`)
      }
      const value = args[argumentIndex]
      argumentIndex += 1
      if (token === "d") {
        if (typeof value !== "number" || Number.isNaN(value)) {
          throw new Error(`Table row ${rowIndex} token %d requires a number`)
        }
        output += String(value)
      } else if (token === "j") output += jsonTableValue(value, "%j", rowIndex)
      else output += String(value)
      index += 1
      continue
    }
    if (character === "$") {
      const match = template.slice(index + 1).match(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/u)
      if (match) {
        output += String(tablePathValue(row, match[0], rowIndex))
        index += match[0].length
        continue
      }
    }
    output += character
  }
  return output
}

/**
 * @param {InternalTestContext} context
 * @param {string} name
 * @param {any} arg1
 * @param {any} arg2
 * @param {DeclarationState} [state]
 * @param {boolean} [focused]
 * @param {DeclarationLocation} [location]
 * @param {any[]} [tableArguments]
 * @returns {void}
 */
function declareTest(context, name, arg1, arg2, state = "run", focused = false, location, tableArguments = []) {
  const parent = context._stack.at(-1)
  if (!parent) throw new Error("Tests must be declared inside a describe block")
  const options = typeof arg1 === "function" ? {} : arg1 || {}
  const suppliedCallback = typeof arg1 === "function" || arg2 !== undefined
  if (state === "todo" && suppliedCallback) throw new Error(`it.todo does not accept a callback: ${name}`)
  const callback = state === "todo" || (state === "skip" && !suppliedCallback) ? () => {} : requiredCallback("it", name, arg1, arg2)
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
    state: parent.state === "run" ? state : parent.state,
    rowArguments: tableArguments,
    location: location || context._declarationLocator()
  }
  parent.tests.push(declaration)
  emitDeclaration(context, "test", declaration)
}

/**
 * @param {InternalTestContext} context
 * @param {string} name
 * @param {any} arg1
 * @param {any} arg2
 * @param {DeclarationState} [state]
 * @param {boolean} [focused]
 * @param {DeclarationLocation} [location]
 * @param {any[]} [tableArguments]
 * @returns {any}
 */
function declareSuite(context, name, arg1, arg2, state = "run", focused = false, location, tableArguments = []) {
  const options = typeof arg1 === "function" ? {} : arg1 || {}
  const callback = requiredCallback("describe", name, arg1, arg2)
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
    focus: focused || Boolean(options.focus),
    state: parent?.state && parent.state !== "run" ? parent.state : state,
    location: location || context._declarationLocator(),
    hooks: {beforeAll: [], afterAll: [], beforeEach: [], afterEach: []},
    suites: [],
    tests: []
  }
  collection.push(declaration)
  emitDeclaration(context, "suite", declaration)
  context._stack.push(declaration)
  try {
    const result = callback(...tableArguments)
    if (result && typeof result.then === "function") return result.finally(() => context._stack.pop())
    context._stack.pop()
    return result
  } catch (error) {
    context._stack.pop()
    throw error
  }
}

/** @param {InternalTestContext} context @param {string} kind @param {any[]} rows @returns {TestDeclarationFunction} */
function testEach(context, kind, rows) {
  validateRows(kind, rows)
  return (name, arg1, arg2) => {
    if (typeof name !== "string") throw new Error(`${kind}.each name must be a string`)
    validateTableTemplate(name)
    requiredCallback("it", name, arg1, arg2)
    const location = context._declarationLocator()
    rows.forEach((row, rowIndex) => {
      declareTest(context, interpolateTableName(name, row, rowIndex), arg1, arg2, "run", false, location, rowArguments(row))
    })
  }
}

/** @param {InternalTestContext} context @param {string} kind @param {any[]} rows @returns {SuiteDeclarationFunction} */
function suiteEach(context, kind, rows) {
  validateRows(kind, rows)
  return (name, arg1, arg2) => {
    if (typeof name !== "string") throw new Error(`${kind}.each name must be a string`)
    validateTableTemplate(name)
    requiredCallback("describe", name, arg1, arg2)
    const location = context._declarationLocator()
    /** @type {Promise<any> | undefined} */
    let pending
    rows.forEach((row, rowIndex) => {
      const declare = () => declareSuite(
        context, interpolateTableName(name, row, rowIndex), arg1, arg2, "run", false, location, rowArguments(row)
      )
      if (pending) pending = pending.then(declare)
      else {
        const result = declare()
        if (result && typeof result.then === "function") pending = Promise.resolve(result)
      }
    })
    return pending
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
    describe: /** @type {any} */ (() => {}),
    fdescribe: () => {},
    xdescribe: () => {},
    it: /** @type {any} */ (() => {}),
    test: /** @type {any} */ (() => {}),
    fit: () => {},
    xit: () => {},
    xtest: () => {},
    beforeAll: () => {},
    afterAll: () => {},
    beforeEach: () => {},
    afterEach: () => {},
    configureTests: () => {},
    expect,
    reset: () => {},
    setDeclarationLocator: () => {}
  }
  /** @type {SuiteDeclarationFunction} */
  const describeDeclaration = (name, arg1, arg2) => declareSuite(context, name, arg1, arg2)
  /** @type {TestDeclarationFunction} */
  const testDeclaration = (name, arg1, arg2) => declareTest(context, name, arg1, arg2)
  /** @param {string} name @param {any} arg1 @param {any} arg2 */
  const todoDeclaration = (name, arg1, arg2) => declareTest(context, name, arg1, arg2, "todo")
  context.describe = Object.assign(describeDeclaration, {
    only: /** @type {SuiteDeclarationFunction} */ ((name, arg1, arg2) => declareSuite(context, name, arg1, arg2, "run", true)),
    skip: /** @type {SuiteDeclarationFunction} */ ((name, arg1, arg2) => declareSuite(context, name, arg1, arg2, "skip")),
    todo: /** @type {SuiteDeclarationFunction} */ ((name, arg1, arg2) => declareSuite(context, name, arg1, arg2, "todo")),
    each: /** @param {any[]} rows */ (rows) => suiteEach(context, "describe", rows)
  })
  context.it = Object.assign(testDeclaration, {
    only: /** @type {TestDeclarationFunction} */ ((name, arg1, arg2) => declareTest(context, name, arg1, arg2, "run", true)),
    skip: /** @type {SkippedTestDeclarationFunction} */ ((name, arg1, arg2) => declareTest(context, name, arg1, arg2, "skip")),
    todo: /** @type {TodoTestDeclarationFunction} */ (todoDeclaration),
    each: /** @param {any[]} rows */ (rows) => testEach(context, "it", rows)
  })
  context.test = context.it
  context.fit = context.it.only
  context.xit = context.it.skip
  context.xtest = context.it.skip
  context.fdescribe = context.describe.only
  context.xdescribe = context.describe.skip
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
    fdescribe: context.fdescribe,
    xdescribe: context.xdescribe,
    it: context.it,
    test: context.test,
    fit: context.fit,
    xit: context.xit,
    xtest: context.xtest,
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
