import { toAwait } from '../../lib/promise'

describe('toAwait', () => {
  test('should return [null, data] when promise resolves', async () => {
    const successPromise = Promise.resolve('success data')
    const [error, data] = await toAwait(successPromise)

    expect(error).toBeNull()
    expect(data).toBe('success data')
  })

  test('should return [error, null] when promise rejects', async () => {
    const errorMessage = 'Something went wrong'
    const failurePromise = Promise.reject(new Error(errorMessage))
    const [error, data] = await toAwait(failurePromise)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(errorMessage)
    expect(data).toBeNull()
  })

  test('should handle promise that resolves with undefined', async () => {
    const undefinedPromise = Promise.resolve(undefined)
    const [error, data] = await toAwait(undefinedPromise)

    expect(error).toBeNull()
    expect(data).toBeUndefined()
  })

  test('should handle promise that resolves with null', async () => {
    const nullPromise = Promise.resolve(null)
    const [error, data] = await toAwait(nullPromise)

    expect(error).toBeNull()
    expect(data).toBeNull()
  })
})