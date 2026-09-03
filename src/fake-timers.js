// @ts-check

import {RealDate, realDateNow} from "./real-time.js"

const CALLBACK_LIMIT = 10_000
const TIMER_PROPERTIES = /** @type {const} */ (["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"])
/** @type {WeakMap<object, object>} */
const activeTargets = new WeakMap()

/** @typedef {{now?: number | Date}} FakeTimerOptions */
/**
 * @typedef {object} FakeTimerTarget
 * @property {DateConstructor} Date
 * @property {Function} setTimeout
 * @property {Function} clearTimeout
 * @property {Function} setInterval
 * @property {Function} clearInterval
 */
/**
 * @typedef {Readonly<{now: number, timerCount: number}> & {
 *   install: (target?: FakeTimerTarget) => void,
 *   advanceBy: (milliseconds: number) => void,
 *   runPending: () => void,
 *   setSystemTime: (now: number | Date) => void,
 *   restore: () => void
 * }} FakeTimers
 */
/**
 * @typedef {object} TimerRecord
 * @property {number} id
 * @property {number} due
 * @property {number} order
 * @property {number} generation
 * @property {Function} callback
 * @property {any[]} args
 * @property {number | undefined} interval
 */
/** @typedef {{target: FakeTimerTarget, descriptors: Map<string, PropertyDescriptor>}} Installation */

/** @param {number | Date} value @returns {number} */
function timeValue(value) {
  const numeric = value instanceof RealDate ? value.getTime() : value
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) throw new TypeError("Fake timer now must be a valid time")
  const clipped = new RealDate(numeric).getTime()
  if (!Number.isFinite(clipped)) throw new TypeError("Fake timer now must be a valid time")
  return clipped
}

/** @param {any} delay @returns {number} */
function timerDelay(delay) {
  if (delay === undefined) return 0
  if (typeof delay !== "number" || !Number.isFinite(delay)) throw new TypeError("Fake timer delay must be a finite delay")
  return Math.max(0, Math.trunc(delay))
}

/** @param {number} milliseconds @returns {number} */
function advancement(milliseconds) {
  if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new TypeError("Fake timer advancement must be a non-negative finite number")
  }
  return Math.trunc(milliseconds)
}

/** @param {FakeTimerTarget} target @returns {Map<string, PropertyDescriptor>} */
function targetDescriptors(target) {
  if ((typeof target !== "object" && typeof target !== "function") || target === null) {
    throw new TypeError("Fake timer target must be an object")
  }
  const descriptors = new Map()
  for (const property of TIMER_PROPERTIES) {
    const descriptor = Object.getOwnPropertyDescriptor(target, property)
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
      throw new TypeError(`Fake timer target must have an own function-valued ${property} property`)
    }
    if (!descriptor.configurable && !descriptor.writable) {
      throw new TypeError(`Fake timer target property ${property} cannot be replaced`)
    }
    descriptors.set(property, descriptor)
  }
  return descriptors
}

/** Creates an explicit isolated fake clock. */
/** @param {FakeTimerOptions} [options] @returns {FakeTimers} */
export function createFakeTimers(options = {}) {
  const initialNow = timeValue(options.now ?? realDateNow())
  let wallNow = initialNow
  let schedulerNow = 0
  let nextId = 1
  let nextOrder = 1
  /** @type {Map<number, TimerRecord>} */
  let timers = new Map()
  /** @type {Installation | undefined} */
  let installation

  function requireInstalled() {
    if (!installation) throw new Error("Fake timers are not installed")
  }

  /** @returns {TimerRecord | undefined} */
  function nextTimer() {
    /** @type {TimerRecord | undefined} */
    let selected
    for (const timer of timers.values()) {
      if (!selected || timer.due < selected.due || (timer.due === selected.due && timer.order < selected.order)) selected = timer
    }
    return selected
  }

  /** @param {number} targetTime */
  function moveTo(targetTime) {
    const destination = Math.max(schedulerNow, targetTime)
    wallNow += destination - schedulerNow
    schedulerNow = destination
  }

  /** @param {TimerRecord} timer */
  function invoke(timer) {
    if (timer.interval === undefined) timers.delete(timer.id)
    else {
      timers.set(timer.id, {
        ...timer,
        due: timer.due + timer.interval,
        order: nextOrder++,
        generation: timer.generation + 1
      })
    }
    Reflect.apply(timer.callback, undefined, timer.args)
  }

  /** @param {Function} callback @param {any} delay @param {any[]} args @param {number | undefined} interval @returns {number} */
  function schedule(callback, delay, args, interval) {
    requireInstalled()
    if (typeof callback !== "function") throw new TypeError("Fake timers require a function callback")
    const normalizedDelay = timerDelay(delay)
    const id = nextId++
    timers.set(id, {
      id,
      due: schedulerNow + normalizedDelay,
      order: nextOrder++,
      generation: 1,
      callback,
      args,
      interval: interval === undefined ? undefined : normalizedDelay
    })
    return id
  }

  /** @param {any} id */
  function cancel(id) { timers.delete(id) }

  /** @param {DateConstructor} OriginalDate @returns {DateConstructor} */
  function fakeDateConstructor(OriginalDate) {
    /** @param {...any} args @returns {any} */
    function FakeDate(...args) {
      if (!new.target) return new OriginalDate(wallNow).toString()
      return Reflect.construct(OriginalDate, args.length ? args : [wallNow], new.target)
    }
    Object.setPrototypeOf(FakeDate, OriginalDate)
    FakeDate.prototype = OriginalDate.prototype
    FakeDate.now = () => wallNow
    return /** @type {DateConstructor} */ (/** @type {unknown} */ (FakeDate))
  }

  /** @param {FakeTimerTarget} [target] */
  function install(target = /** @type {FakeTimerTarget} */ (/** @type {unknown} */ (globalThis))) {
    if (installation) throw new Error("Fake timers are already installed")
    if (activeTargets.has(target)) throw new Error("Target already has fake timers installed")
    const original = targetDescriptors(target)
    /** @param {Function} callback @param {any} delay @param {...any} args @returns {number} */
    function fakeSetTimeout(callback, delay, ...args) { return schedule(callback, delay, args, undefined) }
    /** @param {Function} callback @param {any} delay @param {...any} args @returns {number} */
    function fakeSetInterval(callback, delay, ...args) { return schedule(callback, delay, args, 0) }
    /** @type {Map<string, Function>} */
    const replacements = new Map()
    replacements.set("Date", fakeDateConstructor(target.Date))
    replacements.set("setTimeout", fakeSetTimeout)
    replacements.set("clearTimeout", cancel)
    replacements.set("setInterval", fakeSetInterval)
    replacements.set("clearInterval", cancel)
    wallNow = initialNow
    schedulerNow = 0
    nextId = 1
    nextOrder = 1
    timers = new Map()
    installation = {target, descriptors: original}
    activeTargets.set(target, installation)
    /** @type {string[]} */
    const replaced = []
    try {
      for (const property of TIMER_PROPERTIES) {
        const descriptor = /** @type {PropertyDescriptor} */ (original.get(property))
        Object.defineProperty(target, property, {...descriptor, value: replacements.get(property)})
        replaced.push(property)
      }
    } catch (installationError) {
      const rollbackFailures = []
      for (const property of replaced.reverse()) {
        try {
          Object.defineProperty(target, property, /** @type {PropertyDescriptor} */ (original.get(property)))
        } catch (error) { rollbackFailures.push(error) }
      }
      if (rollbackFailures.length) {
        throw new AggregateError([installationError, ...rollbackFailures], "Failed to install and roll back fake timers")
      }
      installation = undefined
      activeTargets.delete(target)
      throw installationError
    }
  }

  /** @param {number} milliseconds */
  function advanceBy(milliseconds) {
    requireInstalled()
    const destination = schedulerNow + advancement(milliseconds)
    let callbacks = 0
    for (let timer = nextTimer(); timer && timer.due <= destination; timer = nextTimer()) {
      if (callbacks >= CALLBACK_LIMIT) throw new Error("Fake timer operation exceeded 10,000 callbacks")
      callbacks += 1
      moveTo(timer.due)
      invoke(timer)
      if (!installation) return
    }
    moveTo(destination)
  }

  function runPending() {
    requireInstalled()
    const pending = [...timers.values()]
      .sort((left, right) => left.due - right.due || left.order - right.order)
      .map((timer) => ({id: timer.id, generation: timer.generation}))
    let callbacks = 0
    for (const token of pending) {
      const timer = timers.get(token.id)
      if (!timer || timer.generation !== token.generation) continue
      if (callbacks >= CALLBACK_LIMIT) throw new Error("Fake timer operation exceeded 10,000 callbacks")
      callbacks += 1
      moveTo(timer.due)
      invoke(timer)
      if (!installation) return
    }
  }

  /** @param {number | Date} now */
  function setSystemTime(now) {
    requireInstalled()
    wallNow = timeValue(now)
  }

  function restore() {
    if (!installation) return
    timers.clear()
    const {target, descriptors} = installation
    const failures = []
    for (const property of [...TIMER_PROPERTIES].reverse()) {
      try {
        Object.defineProperty(target, property, /** @type {PropertyDescriptor} */ (descriptors.get(property)))
      } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, "Failed to restore fake timers")
    activeTargets.delete(target)
    installation = undefined
  }

  return {
    get now() { return wallNow },
    get timerCount() { return timers.size },
    install,
    advanceBy,
    runPending,
    setSystemTime,
    restore
  }
}
