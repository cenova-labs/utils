/**
 * Wraps a `Promise` and returns a tuple `[error, result]`.
 *
 * - On success: `[null, result]`
 * - On failure: `[error, null]`
 *
 * @template T
 * @param target The `Promise` to await.
 * @returns A `Promise` that resolves to the tuple `[error, result]`.
 */
export async function toAwait<T>(target: Promise<T>) {
  try {
    const result = await target
    return [null, result] as const
  } catch (error) {
    return [error, null] as const
  }
}
