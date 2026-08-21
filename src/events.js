// @ts-check

/** A tiny browser-safe event emitter used by test contexts. */
export class TestEvents {
  constructor() {
    /** @type {Map<string, Set<(...args: any[]) => void>>} */
    this.listeners = new Map()
  }

  /** @param {string} name @param {(...args: any[]) => void} listener @returns {this} */
  on(name, listener) {
    const listeners = this.listeners.get(name) || new Set()
    listeners.add(listener)
    this.listeners.set(name, listeners)
    return this
  }

  /** @param {string} name @param {(...args: any[]) => void} listener @returns {this} */
  off(name, listener) {
    this.listeners.get(name)?.delete(listener)
    return this
  }

  /** @param {string} name @param {...any} args @returns {boolean} */
  emit(name, ...args) {
    const listeners = [...(this.listeners.get(name) || [])]
    for (const listener of listeners) listener(...args)
    return listeners.length > 0
  }

  /** @param {string} [name] @returns {void} */
  clear(name) {
    if (name) this.listeners.delete(name)
    else this.listeners.clear()
  }
}
