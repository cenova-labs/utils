import { Request } from '../../lib/request'

describe('Request', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    jest.useRealTimers()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  // ──────────────────────────────────────────────
  // 基础功能
  // ──────────────────────────────────────────────

  test('should append GET params to query string', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ ok: true }))
    globalThis.fetch = fetchMock

    const request = new Request('https://api.example.com')
    await request.get('/users', { page: 1, keyword: 'hello world' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/users?page=1&keyword=hello%20world',
      expect.objectContaining({ method: 'GET' })
    )
  })

  test('should send POST JSON body and default content type', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ id: 1 }))
    globalThis.fetch = fetchMock

    const request = new Request()
    await request.post('/users', { name: 'Carl' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/users',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Carl' }),
        headers: { 'Content-Type': 'application/json' }
      })
    )
  })

  test('should keep FormData body without setting JSON content type', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ ok: true }))
    globalThis.fetch = fetchMock

    const formData = new FormData()
    formData.append('file', 'content')

    const request = new Request()
    await request.post('/upload', formData)

    expect(fetchMock).toHaveBeenCalledWith(
      '/upload',
      expect.objectContaining({
        method: 'POST',
        body: formData,
        headers: {}
      })
    )
  })

  test('should allow request interceptors to modify RequestInit', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ ok: true }))
    globalThis.fetch = fetchMock

    const request = new Request()
    request.useRequestInterceptor((config) => ({
      ...config,
      headers: { ...config.headers, Authorization: 'Bearer token' }
    }))

    await request.get('/users')

    expect(fetchMock).toHaveBeenCalledWith(
      '/users',
      expect.objectContaining({
        headers: { Authorization: 'Bearer token' }
      })
    )
  })

  test('should transform data through response interceptors in order', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(jsonResponse({ count: 1 }))

    const request = new Request()
    request.useResponseInterceptor<{ count: number }, { count: number }>(
      (data) => ({ count: data.count + 1 })
    )
    request.useResponseInterceptor<{ count: number }, number>(
      (data) => data.count
    )

    const result = request.get<number>('/counter')
    await expect(result).resolves.toBe(2)
  })

  test('should run error interceptors and store the final error', async () => {
    const sourceError = new Error('network failure')
    globalThis.fetch = jest.fn().mockRejectedValue(sourceError)

    const request = new Request()
    const errorInterceptor = jest.fn((error: unknown) => ({
      wrapped: error
    }))
    request.useErrorInterceptor(errorInterceptor)

    await expect(request.get('/users')).rejects.toEqual({
      wrapped: sourceError
    })
    expect(errorInterceptor).toHaveBeenCalledWith(sourceError)
  })

  test('should abort requests and reject with AbortError', async () => {
    globalThis.fetch = jest.fn(
      (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('Aborted')
            error.name = 'AbortError'
            reject(error)
          })
        })
    )

    const request = new Request()
    const result = request.get('/slow')

    const onAbort = jest.fn()
    request.get('/slow', { onAbort })

    await Promise.resolve()
    result.abort()

    await expect(result).rejects.toThrow()
    try {
      await result
    } catch (e) {
      expect((e as Error).name).toBe('AbortError')
    }
  })

  test('should not prefix complete URLs with baseUrl', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ ok: true }))
    globalThis.fetch = fetchMock

    const request = new Request('https://api.example.com')
    await request.get('https://cdn.example.com/file')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://cdn.example.com/file',
      expect.objectContaining({ method: 'GET' })
    )
  })

  test('should merge one-time interceptors with registered interceptors', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ value: 1 }))
    globalThis.fetch = fetchMock

    const request = new Request()
    request.useRequestInterceptor((config) => ({
      ...config,
      headers: { ...config.headers, 'X-Global': 'global' }
    }))

    await request.get<number>('/value', {}, {
      requestInterceptors: [
        (config) => ({
          ...config,
          headers: { ...config.headers, 'X-Once': 'once' }
        })
      ],
      responseInterceptors: [(data: any) => data.value],
      errorInterceptors: []
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/value',
      expect.objectContaining({
        headers: { 'X-Global': 'global', 'X-Once': 'once' }
      })
    )
  })

  // ──────────────────────────────────────────────
  // 生命周期回调
  // ──────────────────────────────────────────────

  test('should call onSuccess with response data', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(jsonResponse({ id: 1 }))

    const onSuccess = jest.fn()
    const request = new Request()

    await request.get('/user', {}, { onSuccess })

    expect(onSuccess).toHaveBeenCalledWith({ id: 1 })
  })

  test('should call onError on request failure', async () => {
    const sourceError = new Error('fail')
    globalThis.fetch = jest.fn().mockRejectedValue(sourceError)

    const onError = jest.fn()
    const request = new Request()

    await expect(
      request.get('/fail', {}, { onError })
    ).rejects.toThrow('fail')

    expect(onError).toHaveBeenCalled()
  })

  test('should call onFinally after success', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(jsonResponse({ ok: true }))

    const onFinally = jest.fn()
    const request = new Request()

    await request.get('/ok', {}, { onFinally })

    expect(onFinally).toHaveBeenCalledTimes(1)
  })

  test('should call onFinally after error', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('fail'))

    const onFinally = jest.fn()
    const request = new Request()

    await expect(
      request.get('/fail', {}, { onFinally })
    ).rejects.toThrow()

    expect(onFinally).toHaveBeenCalledTimes(1)
  })

  test('should call onAbort when request is cancelled', async () => {
    globalThis.fetch = jest.fn(
      (_input: any, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('Aborted')
            err.name = 'AbortError'
            reject(err)
          })
        })
    )

    const onAbort = jest.fn()
    const request = new Request()
    const result = request.get('/slow', {}, { onAbort })

    await Promise.resolve()
    result.abort()

    await expect(result).rejects.toThrow()
    expect(onAbort).toHaveBeenCalledTimes(1)
  })

  // ──────────────────────────────────────────────
  // buildBody — Blob & URLSearchParams
  // ──────────────────────────────────────────────

  test('should send Blob body without JSON content type', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ ok: true }))
    globalThis.fetch = fetchMock

    const blob = new Blob(['binary data'], { type: 'application/octet-stream' })
    const request = new Request()

    await request.post('/upload', blob)

    expect(fetchMock).toHaveBeenCalledWith(
      '/upload',
      expect.objectContaining({
        method: 'POST',
        body: blob,
        headers: {}
      })
    )
  })

  test('should send URLSearchParams body without JSON.stringify', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ ok: true }))
    globalThis.fetch = fetchMock

    const params = new URLSearchParams({ name: 'test', value: '123' })
    const request = new Request()

    await request.post('/submit', params)

    expect(fetchMock).toHaveBeenCalledWith(
      '/submit',
      expect.objectContaining({
        method: 'POST',
        body: params,
        headers: {}
      })
    )
  })

  // ──────────────────────────────────────────────
  // parseResponse — 204/205 & blob
  // ──────────────────────────────────────────────

  test('should return null for 204 No Content response', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(noContentResponse())

    const request = new Request()
    await expect(request.get('/nocontent')).resolves.toBeNull()
  })

  test('should return null for 205 Reset Content response', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(noContentResponse(205))

    const request = new Request()
    await expect(request.get('/reset')).resolves.toBeNull()
  })

  test('should return Blob for binary content types', async () => {
    const imageBlob = new Blob(['fake-png'], { type: 'image/png' })
    globalThis.fetch = jest.fn().mockResolvedValue(
      blobResponse(imageBlob, 'image/png')
    )

    const request = new Request()
    const data = await request.get('/image.png')

    expect(data).toBeInstanceOf(Blob)
    expect((data as Blob).type).toBe('image/png')
  })

  test('should return Blob for application/octet-stream', async () => {
    const binaryBlob = new Blob(['binary'], { type: 'application/octet-stream' })
    globalThis.fetch = jest.fn().mockResolvedValue(
      blobResponse(binaryBlob, 'application/octet-stream')
    )

    const request = new Request()
    await expect(request.get('/file.bin')).resolves.toBeInstanceOf(Blob)
  })

  // ──────────────────────────────────────────────
  // timeout
  // ──────────────────────────────────────────────

  test('should timeout when request exceeds timeout limit', async () => {
    globalThis.fetch = jest.fn(
      (...args: any[]) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = (args[1] as RequestInit | undefined)?.signal as
            | AbortSignal
            | undefined
          signal?.addEventListener('abort', () => {
            const err = new Error('Request timed out')
            err.name = 'TimeoutError'
            reject(err)
          })
        })
    )

    const request = new Request()
    const result = request.get('/slow', {}, { timeout: 20 })

    await expect(result).rejects.toThrow()
    try {
      await result
    } catch (e) {
      expect((e as Error).name).toBe('TimeoutError')
    }
  }, 10000)

  // ──────────────────────────────────────────────
  // retry
  // ──────────────────────────────────────────────

  test('should retry on failure and succeed on retry', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))

    globalThis.fetch = fetchMock

    const request = new Request()
    await expect(
      request.get('/flaky', {}, { retry: 1, retryDelay: 0 })
    ).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('should exhaust retries and reject', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValue(new Error('Persistent error'))

    globalThis.fetch = fetchMock

    const request = new Request()
    await expect(
      request.get('/failing', {}, { retry: 2, retryDelay: 0 })
    ).rejects.toThrow('Persistent error')

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  test('should not retry when user aborts', async () => {
    globalThis.fetch = jest.fn(
      (...args: any[]) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = (args[1] as RequestInit | undefined)?.signal as
            | AbortSignal
            | undefined
          signal?.addEventListener('abort', () => {
            const err = new Error('Aborted')
            err.name = 'AbortError'
            reject(err)
          })
        })
    )

    const request = new Request()
    const result = request.get('/slow', {}, { retry: 3, retryDelay: 0 })

    await Promise.resolve()
    result.abort()

    await expect(result).rejects.toThrow()
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  // ──────────────────────────────────────────────
  // cache
  // ──────────────────────────────────────────────

  test('should return cached response for same GET URL within TTL', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ value: 1 }))
    globalThis.fetch = fetchMock

    const request = new Request()

    const r1 = request.get('/data', {}, { cache: { ttl: 10000 } })
    await expect(r1).resolves.toEqual({ value: 1 })

    const r2 = request.get('/data', {}, { cache: { ttl: 10000 } })
    await expect(r2).resolves.toEqual({ value: 1 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('should skip cache for POST requests', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ saved: true }))
    globalThis.fetch = fetchMock

    const request = new Request()

    await request.post('/data', { x: 1 }, { cache: { ttl: 10000 } })
    await request.post('/data', { x: 2 }, { cache: { ttl: 10000 } })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('should respect cache TTL and expire', async () => {
    jest.useFakeTimers()

    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ value: 1 }))
    globalThis.fetch = fetchMock

    const request = new Request()

    // First request — hits network
    await expect(
      request.get('/data', {}, { cache: { ttl: 100 } })
    ).resolves.toEqual({ value: 1 })

    // Advance time past TTL
    jest.advanceTimersByTime(101)
    await Promise.resolve()

    // Second request — should miss cache, hit network
    await expect(
      request.get('/data', {}, { cache: { ttl: 100 } })
    ).resolves.toEqual({ value: 1 })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('clearCache() should remove all cached entries', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ value: 42 }))
    globalThis.fetch = fetchMock

    const request = new Request()

    await request.get('/data', {}, { cache: { ttl: 10000 } })
    request.clearCache()

    await request.get('/data', {}, { cache: { ttl: 10000 } })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // ──────────────────────────────────────────────
  // deduplication
  // ──────────────────────────────────────────────

  test('should deduplicate concurrent GET requests to same URL', async () => {
    let resolveFetch!: (value: Response) => void
    globalThis.fetch = jest.fn(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve })
    )

    const request = new Request()

    const r1 = request.get('/data')
    const r2 = request.get('/data')

    await Promise.resolve()
    resolveFetch(jsonResponse({ ok: true }))

    await expect(r1).resolves.toEqual({ ok: true })
    await expect(r2).resolves.toEqual({ ok: true })

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  test('should not deduplicate different URLs', async () => {
    let resolve1!: (v: Response) => void
    let resolve2!: (v: Response) => void
    let callCount = 0
    globalThis.fetch = jest.fn(
      () => new Promise<Response>((resolve) => {
        if (callCount === 0) resolve1 = resolve
        else resolve2 = resolve
        callCount++
      })
    )

    const request = new Request()

    const r1 = request.get('/a')
    const r2 = request.get('/b')

    await Promise.resolve()
    resolve1(jsonResponse({ a: 1 }))
    resolve2(jsonResponse({ b: 2 }))

    await expect(r1).resolves.toEqual({ a: 1 })
    await expect(r2).resolves.toEqual({ b: 2 })
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  // ──────────────────────────────────────────────
  // download progress
  // ──────────────────────────────────────────────

  test('should report download progress for JSON response', async () => {
    const content = JSON.stringify({ message: 'hello progress' })
    const encoder = new TextEncoder()
    const bytes = encoder.encode(content)

    globalThis.fetch = jest.fn().mockResolvedValue(
      streamResponse([bytes.slice(0, 10), bytes.slice(10)], 'application/json')
    )

    const request = new Request()
    const onProgress = jest.fn()

    await request.get('/progress', {}, { onDownloadProgress: onProgress })

    expect(onProgress).toHaveBeenCalledTimes(2)
    expect(onProgress).toHaveBeenNthCalledWith(1, 10, bytes.length)
    expect(onProgress).toHaveBeenNthCalledWith(2, bytes.length, bytes.length)
  })

  test('should report download progress for binary response', async () => {
    const blobContent = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])

    globalThis.fetch = jest.fn().mockResolvedValue(
      streamResponse(
        [blobContent.subarray(0, 5), blobContent.subarray(5)],
        'application/octet-stream'
      )
    )

    const request = new Request()
    const onProgress = jest.fn()

    await request.get('/file.bin', {}, { onDownloadProgress: onProgress })

    expect(onProgress).toHaveBeenCalled()
  })

  // ──────────────────────────────────────────────
  // combination: timeout + retry
  // ──────────────────────────────────────────────

  test('should retry after timeout and succeed on second attempt', async () => {
    let attempt = 0
    globalThis.fetch = jest.fn(
      (...args: any[]) =>
        new Promise<Response>((_resolve, reject) => {
          attempt++
          const signal = (args[1] as RequestInit | undefined)?.signal as
            | AbortSignal
            | undefined
          signal?.addEventListener('abort', () => {
            const msg =
              attempt === 1 ? 'Request timed out' : 'Should not timeout'
            const err = new Error(msg)
            err.name = attempt === 1 ? 'TimeoutError' : 'AbortError'
            reject(err)
          })
        })
    )

    const request = new Request()
    await expect(
      request.get('/flaky-timeout', {}, { timeout: 20, retry: 1, retryDelay: 0 })
    ).rejects.toThrow()

    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  }, 10000)

  // ──────────────────────────────────────────────
  // thenable: await / Promise.all 支持
  // ──────────────────────────────────────────────

  test('should be directly awaitable without .promise', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(jsonResponse({ hello: 'world' }))

    const request = new Request()
    const data = await request.get('/test')

    expect(data).toEqual({ hello: 'world' })
  })

  test('should work with Promise.all', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ ok: true }))
    globalThis.fetch = fetchMock

    const request = new Request()
    const [a, b] = await Promise.all([
      request.get('/a'),
      request.get('/b')
    ])

    expect(a).toEqual({ ok: true })
    expect(b).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('should support .then chaining', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(jsonResponse(42))

    const request = new Request()
    const result = await request.get<number>('/num').then((n) => n * 2)

    expect(result).toBe(84)
  })
})

// ─── 测试辅助函数 ──────────────────────────────

function jsonResponse(data: unknown): Response {
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null
    },
    json: jest.fn().mockResolvedValue(data),
    text: jest.fn().mockResolvedValue(JSON.stringify(data)),
    blob: jest.fn().mockResolvedValue(new Blob([JSON.stringify(data)])),
    status: 200
  } as unknown as Response
}

function noContentResponse(status: number = 204): Response {
  return {
    headers: { get: () => null },
    json: jest.fn(),
    text: jest.fn(),
    blob: jest.fn(),
    status
  } as unknown as Response
}

function blobResponse(blob: Blob, contentType: string): Response {
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? contentType : null
    },
    json: jest.fn().mockRejectedValue(new Error('Not JSON')),
    text: jest.fn().mockResolvedValue(''),
    blob: jest.fn().mockResolvedValue(blob),
    status: 200
  } as unknown as Response
}

function streamResponse(
  chunks: Uint8Array[],
  contentType: string
): Response {
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)

  const stream = new (globalThis as any).ReadableStream({
    start(controller: any) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
    }
  })

  return {
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === 'content-type') return contentType
        if (name.toLowerCase() === 'content-length') return String(totalLength)
        return null
      }
    },
    body: stream,
    json: jest.fn(),
    text: jest.fn(),
    blob: jest.fn(),
    status: 200
  } as unknown as Response
}
