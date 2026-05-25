import { isFn, isObject, isStr, isPromise } from './validate'
import type { Fn } from '../typings/helper'

/**
 * Formats an error object into a string representation.
 * @param error - The error to format. It can be an `Error` instance, a string, or another object.
 * @param [defaultErrorString=''] - The default error message if the error cannot be formatted.
 * @param [opts={}] - Additional options.
 * @param [opts.errorLimit=8] - The maximum number of stack trace lines to include.
 * @returns  The formatted error message.
 */
export function formatErrorToString(
  error: unknown,
  defaultErrorString: string = '',
  opts = {
    errorLimit: 8
  }
) {
  if (error instanceof Error) {
    Error.captureStackTrace(error, formatErrorToString)
    const stackLines = error.stack?.split('\n').slice(0, opts.errorLimit) || []
    return stackLines.join('\n')
  }

  if (isStr(error)) return error
  if (isObject(error) && 'toString' in error && isFn(error.toString))
    return error.toString()

  return defaultErrorString
}


/**
 * Creates a function factory with error handling capabilities
 *
 * @param handleError - Error handling function to process exceptions during execution
 * @returns Returns a new function that can execute target functions with automatic error handling
 *
 * @example
 * ```ts
 * const errorHandler = (error) => console.error(error);
 * const safeExecute = invokeWithErrorHandlingFactory(errorHandler);
 *
 * // Execute regular function
 * safeExecute(() => { throw new Error('test') });
 *
 * // Execute async function
 * safeExecute(async () => { throw new Error('async test') });
 * ```
 */
export const invokeWithErrorHandlingFactory = (handleError: Fn) => {
  return (handler: Fn, context?: unknown, args?: Array<unknown>) => {
    let res
    try {
      res = args ? handler.apply(context, args) : handler.call(context)

      if (isPromise(res)) {
        res.catch((e) => {
          return handleError(e)
        })
      }
    } catch (e) {
      handleError(e)
    }

    return res
  }
}
