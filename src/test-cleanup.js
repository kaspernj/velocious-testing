// @ts-check

/**
 * Runs a callback and its dynamically registered cleanups without hiding a
 * primary failure or later cleanup failures.
 *
 * Cleanups run in registration order. A sole failure is rethrown unchanged;
 * multiple failures are aggregated in primary-then-cleanup execution order.
 *
 * @param {(registerCleanup: (cleanup: () => void | Promise<void>) => void) => void | Promise<void>} callback callback that receives the cleanup registrar
 * @returns {Promise<void>} completion after the callback and every registered cleanup have run
 */
export async function withTestCleanup(callback) {
  /** @type {Array<() => void | Promise<void>>} */
  const cleanups = []
  /** @type {unknown[]} */
  const failures = []

  try {
    await callback((cleanup) => {
      cleanups.push(cleanup)
    })
  } catch (error) {
    failures.push(error)
  }

  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      failures.push(error)
    }
  }

  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, "Test and cleanup failed")
}
