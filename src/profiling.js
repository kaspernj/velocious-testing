// @ts-check

/** @typedef {string} TestActivityName */

/**
 * Validates a low-cardinality activity label suitable for profile output.
 * @param {string} name
 * @returns {TestActivityName}
 */
export function validateTestActivityName(name) {
  if (typeof name !== "string" || !/^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u.test(name) || name.length > 64) {
    throw new Error("Test profile activity name must be a lowercase identifier of at most 64 characters")
  }
  return name
}
