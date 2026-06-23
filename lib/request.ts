import { objectToQueryString } from './url'
import { MIME_TYPES } from './const/http'

// ─── Thenable handle ───

export interface RequestHandle<T> {
  then: <R1 = T, R2 = never>(
    onfulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ) => Promise<R1 | R2>
  catch: <R = never>(
    onrejected?: ((reason: unknown) => R | PromiseLike<R>) | null
  ) => Promise<T | R>
  finally: (onfinally?: (() => void) | null) => Promise<T>
  abort: () => void
}

// ─── Interceptor types ───

export type RequestInterceptor = (
  config: RequestInit
) => RequestInit | Promise<RequestInit>

export type ResponseInterceptor<T = unknown, U = unknown> = (
  data: T
) => U | Promise<U>

export type ErrorInterceptor = (error: unknown) => unknown | Promise<unknown>

// ─── Cache config ───

export interface CacheConfig {
  /** Time-to-live in milliseconds. */
  ttl: number
}

// ─── SSE types ───

/** SSE (Server-Sent Events) message event */
export interface SSEMessageEvent {
  /** Event type (from `event:` field) */
  event?: string
  /** Message data */
  data: string
  /** Last event ID (from `id:` field) */
  id?: string
  /** Retry interval in milliseconds (from `retry:` field) */
  retry?: number
}

/** SSE event handler callbacks */
export interface SSECallbacks {
  /** Called when a message is received */
  onMessage?: (event: SSEMessageEvent) => void
  /** Called when the connection is opened */
  onOpen?: () => void
  /** Called when an error occurs */
  onError?: (error: unknown) => void
  /** Called when the connection is closed */
  onClose?: () => void
}

/** SSE configuration */
export interface SSEConfig extends SSECallbacks {
  /** Enable SSE mode */
  sse: true
  /** Custom headers for SSE request */
  headers?: Record<string, string>
  /** Request body for POST SSE */
  data?: unknown
}

// ─── Request config ───

export interface RequestConfig extends RequestInit {
  params?: Record<PropertyKey, any>
  data?: unknown
  requestInterceptors?: RequestInterceptor[]
  responseInterceptors?: ResponseInterceptor<any, any>[]
  errorInterceptors?: ErrorInterceptor[]
  /** Request timeout in milliseconds. 0 or undefined = no timeout. */
  timeout?: number
  /** Max retry count on failure. 0 = no retry. */
  retry?: number
  /** Delay between retries in milliseconds. */
  retryDelay?: number
  /** Response cache configuration. `true` = default TTL (5000ms). */
  cache?: boolean | CacheConfig
  /** Download progress callback. Receives (loadedBytes, totalBytes). */
  onDownloadProgress?: (loaded: number, total: number) => void
  /** SSE configuration. Enables Server-Sent Events mode when provided. */
  sse?: boolean | SSEConfig

  // ─── Lifecycle callbacks ───
  onSuccess?: (data: unknown) => void
  onError?: (error: unknown) => void
  onAbort?: () => void
  onFinally?: () => void
}

const BODY_METHODS = ['POST', 'PUT', 'PATCH']
const QUERY_METHODS = ['GET', 'DELETE']
const DEFAULT_CACHE_TTL = 5000

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

interface CacheEntry {
  data: unknown
  expiry: number
}

/**
 * HTTP client with interceptors, timeout, retry, cache, deduplication, and download progress.
 *
 * ### Basic usage
 * ```ts
 * const api = new Request('https://api.example.com')
 *
 * // Directly awaitable
 * const user = await api.get<User>('/users/1')
 *
 * // Lifecycle callbacks
 * await api.get('/users', {
 *   onSuccess: setUsers,
 *   onError: toast.error,
 *   onFinally: () => setLoading(false),
 * })
 * ```
 *
 * ### Composable best practice
 *
 * Prefer small focused instances over one instance with all interceptors:
 * ```ts
 * // ── Building blocks (pure functions, reusable) ──
 * const addAuth: RequestInterceptor = (config) => ({
 *   ...config,
 *   headers: { ...config.headers, Authorization: `Bearer ${getToken()}` }
 * })
 * const addLang: RequestInterceptor = (config) => ({
 *   ...config,
 *   headers: { ...config.headers, 'Accept-Language': 'zh-CN' }
 * })
 *
 * // ── Compose: each instance handles one concern ──
 * const authApi = new Request('https://api.example.com')
 * authApi.useRequestInterceptor(addAuth)
 * authApi.useRequestInterceptor(addLang)
 *
 * const publicApi = new Request('https://open.api.com')
 *
 * // ── Or use per-request interceptors ──
 * api.get('/users', {}, {
 *   requestInterceptors: [addAuth],
 *   onSuccess: setUsers,
 * })
 * ```
 */
export class Request {
  private requestInterceptors: RequestInterceptor[] = []
  private responseInterceptors: ResponseInterceptor<any, any>[] = []
  private errorInterceptors: ErrorInterceptor[] = []
  private cacheMap = new Map<string, CacheEntry>()
  private inflightMap = new Map<string, Promise<unknown>>()

  constructor(private readonly baseUrl = '') {
    //
  }

  useRequestInterceptor(interceptor: RequestInterceptor) {
    this.requestInterceptors.push(interceptor)
    return () => this.removeInterceptor(this.requestInterceptors, interceptor)
  }

  useResponseInterceptor<T = unknown, U = unknown>(
    interceptor: ResponseInterceptor<T, U>
  ) {
    this.responseInterceptors.push(interceptor)
    return () => this.removeInterceptor(this.responseInterceptors, interceptor)
  }

  useErrorInterceptor(interceptor: ErrorInterceptor) {
    this.errorInterceptors.push(interceptor)
    return () => this.removeInterceptor(this.errorInterceptors, interceptor)
  }

  // ─── Convenience methods ───

  get<T = unknown>(
    url: string,
    params?: Record<PropertyKey, any>,
    config: RequestConfig = {}
  ) {
    return this.request<T>(url, { ...config, method: 'GET', params })
  }

  delete<T = unknown>(
    url: string,
    params?: Record<PropertyKey, any>,
    config: RequestConfig = {}
  ) {
    return this.request<T>(url, { ...config, method: 'DELETE', params })
  }

  post<T = unknown>(url: string, data?: unknown, config: RequestConfig = {}) {
    return this.request<T>(url, { ...config, method: 'POST', data })
  }

  put<T = unknown>(url: string, data?: unknown, config: RequestConfig = {}) {
    return this.request<T>(url, { ...config, method: 'PUT', data })
  }

  patch<T = unknown>(url: string, data?: unknown, config: RequestConfig = {}) {
    return this.request<T>(url, { ...config, method: 'PATCH', data })
  }

  /** Clear the in-memory response cache. */
  clearCache() {
    this.cacheMap.clear()
  }

  // ─── Core: request ───

  request<T = unknown>(
    url: string,
    config: RequestConfig = {}
  ): RequestHandle<T> {
    const controller = new AbortController()
    const promise = this.execute<T>(url, config, controller)

    // onAbort fires directly when abort() is called
    const handle = {
      then: (onfulfilled?: any, onrejected?: any) =>
        (promise as Promise<T>).then(onfulfilled, onrejected),
      catch: (onrejected?: any) =>
        (promise as Promise<T>).catch(onrejected),
      finally: (onfinally?: any) =>
        (promise as Promise<T>).finally(onfinally),
      abort: () => {
        controller.abort()
      }
    } as RequestHandle<T>

    return handle
  }

  // ─── Internal: execute ───

  private buildCacheKey(method: string, url: string): string {
    return `${method}:${url}`
  }

  private async execute<T>(
    url: string,
    config: RequestConfig,
    controller: AbortController
  ): Promise<T> {
    const {
      params,
      data,
      requestInterceptors = [],
      responseInterceptors = [],
      errorInterceptors = [],
      timeout,
      retry = 0,
      retryDelay = 0,
      cache,
      onDownloadProgress,
      // Strip lifecycle callbacks — don't pass them down to RequestInit
      onSuccess,
      onError,
      onAbort: _onAbort,
      onFinally,
      ...requestConfig
    } = config

    const method = (requestConfig.method ?? 'GET').toUpperCase()
    const requestUrl = this.buildUrl(url, method, params)
    const cacheKey = this.buildCacheKey(method, requestUrl)

    // ── Cache hit (GET only) ──
    if (method === 'GET' && cache) {
      const cached = this.cacheMap.get(cacheKey)
      if (cached && cached.expiry > Date.now()) {
        onSuccess?.(cached.data)
        onFinally?.()
        return cached.data as T
      }
    }

    // ── Dedup (GET only) ──
    if (method === 'GET' && this.inflightMap.has(cacheKey)) {
      try {
        const dedupData = await this.inflightMap.get(cacheKey)!
        onSuccess?.(dedupData)
        onFinally?.()
        return dedupData as T
      } catch {
        // Upstream failed, fall through to retry
      }
    }

    const maxRetries = retry

    const executePromise = this.executeWithRetry<T>(
      requestUrl,
      method,
      data,
      requestConfig,
      controller,
      requestInterceptors,
      responseInterceptors,
      errorInterceptors,
      onDownloadProgress,
      timeout,
      maxRetries,
      retryDelay,
      cache,
      cacheKey
    )

    if (method === 'GET') {
      this.inflightMap.set(cacheKey, executePromise)
    }

    try {
      const resultData = await executePromise
      config.onSuccess?.(resultData)
      return resultData
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error as Error)?.name === 'AbortError'
      ) {
        config.onAbort?.()
      } else {
        config.onError?.(error)
      }
      throw error
    } finally {
      if (method === 'GET') {
        this.inflightMap.delete(cacheKey)
      }
      config.onFinally?.()
    }
  }

  // ─── Internal: executeWithRetry ───

  private async executeWithRetry<T>(
    requestUrl: string,
    method: string,
    data: unknown,
    requestConfig: RequestInit,
    controller: AbortController,
    requestInterceptors: RequestInterceptor[],
    responseInterceptors: ResponseInterceptor<any, any>[],
    errorInterceptors: ErrorInterceptor[],
    onDownloadProgress: ((loaded: number, total: number) => void) | undefined,
    timeout: number | undefined,
    maxRetries: number,
    retryDelayMs: number,
    cache: boolean | CacheConfig | undefined,
    cacheKey: string
  ): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const attemptController = new AbortController()

      const onUserAbort = () => {
        if (controller.signal.aborted) {
          attemptController.abort()
        }
      }
      controller.signal.addEventListener('abort', onUserAbort)

      let attemptTimeoutId: ReturnType<typeof setTimeout> | undefined
      if (timeout && timeout > 0) {
        attemptTimeoutId = setTimeout(() => {
          const err = new Error('Request timed out')
          err.name = 'TimeoutError'
          attemptController.abort(err)
        }, timeout)
      }

      try {
        if (controller.signal.aborted) {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          throw err
        }

        let requestInit = this.buildRequestInit(
          method,
          data,
          requestConfig,
          attemptController
        )

        requestInit = await this.runRequestInterceptors(requestInit, [
          ...this.requestInterceptors,
          ...requestInterceptors
        ])

        const response = await fetch(requestUrl, requestInit)

        let responseData: unknown
        if (onDownloadProgress && response.body) {
          responseData = await this.readResponseWithProgress(
            response,
            onDownloadProgress
          )
        } else {
          responseData = await this.parseResponse(response)
        }

        responseData = await this.runResponseInterceptors(responseData, [
          ...this.responseInterceptors,
          ...responseInterceptors
        ])

        // ── Cache write-back (GET only) ──
        if (method === 'GET' && cache) {
          const ttl =
            typeof cache === 'object' ? cache.ttl : DEFAULT_CACHE_TTL
          this.cacheMap.set(cacheKey, {
            data: responseData,
            expiry: Date.now() + ttl
          })
        }

        return responseData as T
      } catch (error) {
        if (controller.signal.aborted) {
          throw error
        }

        if (attempt < maxRetries) {
          if (retryDelayMs > 0) {
            await sleep(retryDelayMs)
          }
          continue
        }

        // Last attempt: run errorInterceptors then throw
        const processedError = await this.runErrorInterceptors(error, [
          ...this.errorInterceptors,
          ...errorInterceptors
        ])
        throw processedError
      } finally {
        clearTimeout(attemptTimeoutId)
        controller.signal.removeEventListener('abort', onUserAbort)
      }
    }

    // unreachable
    throw new Error('Unreachable')
  }

  // ─── SSE Parser ───

  private parseSSEStream(
    response: Response,
    callbacks: SSECallbacks,
    controller: AbortController
  ): void {
    if (!response.body) {
      callbacks.onError?.(new Error('Response body is empty'))
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let currentEvent: Partial<SSEMessageEvent> = {}

    callbacks.onOpen?.()

    const processBuffer = () => {
      const lines = buffer.split('\n')
      // Keep incomplete line in buffer
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line === '') {
          // Empty line = dispatch event
          if (currentEvent.data !== undefined) {
            callbacks.onMessage?.({
              event: currentEvent.event,
              data: currentEvent.data,
              id: currentEvent.id,
              retry: currentEvent.retry
            })
          }
          currentEvent = {}
        } else if (line.startsWith('data:')) {
          const data = line.slice(5).trimStart()
          currentEvent.data = currentEvent.data
            ? currentEvent.data + '\n' + data
            : data
        } else if (line.startsWith('event:')) {
          currentEvent.event = line.slice(6).trim()
        } else if (line.startsWith('id:')) {
          currentEvent.id = line.slice(3).trim()
        } else if (line.startsWith('retry:')) {
          const retry = parseInt(line.slice(6).trim(), 10)
          if (!isNaN(retry)) {
            currentEvent.retry = retry
          }
        }
        // Lines starting with ':' are comments, ignore them
      }
    }

    const read = async () => {
      try {
        while (true) {
          if (controller.signal.aborted) {
            reader.cancel()
            callbacks.onClose?.()
            return
          }

          const { done, value } = await reader.read()
          if (done) {
            // Process remaining buffer
            processBuffer()
            callbacks.onClose?.()
            return
          }

          buffer += decoder.decode(value, { stream: true })
          processBuffer()
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          callbacks.onError?.(error)
        }
        callbacks.onClose?.()
      }
    }

    read()
  }

  // ─── SSE convenience method ───

  /**
   * Create an SSE (Server-Sent Events) connection.
   *
   * Uses Fetch API under the hood, so it supports:
   * - Custom headers (unlike native EventSource)
   * - POST requests
   * - All HTTP methods
   *
   * @example
   * ```ts
   * const api = new Request('https://api.example.com')
   *
   * // GET SSE (default)
   * const handle = api.sse('/events', {
   *   onMessage: (event) => console.log(event.data),
   *   onError: (err) => console.error(err),
   * })
   *
   * // POST SSE with data
   * const handle = api.sse('/chat/completions', {
   *   method: 'POST',
   *   data: { prompt: 'Hello' },
   *   onMessage: (event) => {
   *     const parsed = JSON.parse(event.data)
   *     console.log(parsed)
   *   },
   * })
   *
   * // Cancel the connection
   * handle.abort()
   * ```n   */
  sse<T = unknown>(
    url: string,
    config: Omit<RequestConfig, 'sse'> & SSECallbacks = {}
  ): RequestHandle<T> {
    const controller = new AbortController()
    const { onMessage, onOpen, onError, onClose, ...requestConfig } = config

    const callbacks: SSECallbacks = {
      onMessage,
      onOpen,
      onError,
      onClose
    }

    const promise = this.executeSSE<T>(
      url,
      requestConfig,
      callbacks,
      controller
    )

    const handle = {
      then: (onfulfilled?: any, onrejected?: any) =>
        (promise as Promise<T>).then(onfulfilled, onrejected),
      catch: (onrejected?: any) =>
        (promise as Promise<T>).catch(onrejected),
      finally: (onfinally?: any) =>
        (promise as Promise<T>).finally(onfinally),
      abort: () => {
        controller.abort()
      }
    } as RequestHandle<T>

    return handle
  }

  private async executeSSE<T>(
    url: string,
    config: RequestConfig,
    callbacks: SSECallbacks,
    controller: AbortController
  ): Promise<T> {
    const {
      params,
      data,
      requestInterceptors = [],
      errorInterceptors = [],
      timeout,
      ...requestConfig
    } = config

    const method = (requestConfig.method ?? 'GET').toUpperCase()
    const requestUrl = this.buildUrl(url, method, params)

    let requestInit = this.buildRequestInit(
      method,
      data,
      requestConfig,
      controller
    )

    // Set SSE headers
    requestInit.headers = {
      Accept: 'text/event-stream',
      ...this.normalizeHeaders(requestInit.headers)
    }

    try {
      requestInit = await this.runRequestInterceptors(requestInit, [
        ...this.requestInterceptors,
        ...requestInterceptors
      ])

      const response = await fetch(requestUrl, requestInit)

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`)
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('text/event-stream')) {
        throw new Error(`Expected text/event-stream, got ${contentType}`)
      }

      // Start parsing SSE stream
      this.parseSSEStream(response, callbacks, controller)

      // Return a promise that resolves when the stream ends
      return new Promise<T>((resolve, reject) => {
        let abortHandler: (() => void) | undefined

        const cleanup = () => {
          if (abortHandler) {
            controller.signal.removeEventListener('abort', abortHandler)
          }
        }

        const onClose = () => {
          cleanup()
          resolve(undefined as T)
        }
        const onError = (error: unknown) => {
          cleanup()
          reject(error)
        }
        abortHandler = () => {
          cleanup()
          controller.abort()
        }

        controller.signal.addEventListener('abort', abortHandler)

        // Override callbacks to also resolve/reject the promise
        const originalOnClose = callbacks.onClose
        const originalOnError = callbacks.onError

        callbacks.onClose = () => {
          originalOnClose?.()
          onClose()
        }
        callbacks.onError = (error) => {
          originalOnError?.(error)
          onError(error)
        }
      })
    } catch (error) {
      const processedError = await this.runErrorInterceptors(error, [
        ...this.errorInterceptors,
        ...errorInterceptors
      ])
      callbacks.onError?.(processedError)
      throw processedError
    }
  }

  // ─── Progress reader ───

  private async readResponseWithProgress(
    response: Response,
    onProgress: (loaded: number, total: number) => void
  ): Promise<unknown> {
    const contentLength = response.headers.get('content-length')
    const total = contentLength ? parseInt(contentLength, 10) : 0
    const reader = response.body!.getReader()
    const chunks: Uint8Array[] = []
    let loaded = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      loaded += value.length
      onProgress(loaded, total)
    }

    const allChunks = new Uint8Array(loaded)
    let offset = 0
    for (const chunk of chunks) {
      allChunks.set(chunk, offset)
      offset += chunk.length
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes(MIME_TYPES.JSON)) {
      const text = new TextDecoder().decode(allChunks)
      return JSON.parse(text)
    }
    if (contentType.includes('text/')) {
      return new TextDecoder().decode(allChunks)
    }
    return new Blob([allChunks.buffer], { type: contentType || undefined })
  }

  // ─── Build request ───

  private buildRequestInit(
    method: string,
    data: unknown,
    config: RequestInit,
    controller: AbortController
  ): RequestInit {
    const requestInit: RequestInit = {
      ...config,
      method,
      signal: config.signal ?? controller.signal,
      headers: this.normalizeHeaders(config.headers)
    }

    if (BODY_METHODS.includes(method) && data !== undefined) {
      requestInit.body = this.buildBody(data)

      if (
        !(data instanceof FormData) &&
        !(data instanceof URLSearchParams) &&
        !(data instanceof Blob)
      ) {
        requestInit.headers = {
          'Content-Type': 'application/json',
          ...this.normalizeHeaders(requestInit.headers)
        }
      }
    }

    return requestInit
  }

  private buildBody(data: unknown) {
    if (data instanceof FormData) return data
    if (data instanceof URLSearchParams) return data
    if (data instanceof Blob) return data
    if (typeof data === 'string') return data
    return JSON.stringify(data)
  }

  private buildUrl(
    url: string,
    method: string,
    params?: Record<PropertyKey, any>
  ) {
    const baseUrl = this.isCompleteUrl(url)
      ? url
      : this.joinUrl(this.baseUrl, url)

    if (!QUERY_METHODS.includes(method) || !params) return baseUrl

    const queryString = objectToQueryString(params)
    if (!queryString) return baseUrl

    const separator = baseUrl.includes('?') ? '&' : '?'
    return `${baseUrl}${separator}${queryString}`
  }

  private joinUrl(baseUrl: string, url: string) {
    if (!baseUrl) return url
    return `${baseUrl.replace(/\/$/, '')}/${url.replace(/^\//, '')}`
  }

  private isCompleteUrl(url: string) {
    return /^https?:\/\//i.test(url)
  }

  private normalizeHeaders(
    headers?: RequestInit['headers']
  ): Record<string, string> {
    if (!headers) return {}
    if (headers instanceof Headers) return Object.fromEntries(headers.entries())
    if (Array.isArray(headers)) return Object.fromEntries(headers)

    const entries = Object.entries(headers).map<[string, string]>(
      ([key, value]) => [
        key,
        typeof value === 'string' ? value : value.join(', ')
      ]
    )
    return Object.fromEntries(entries)
  }

  // ─── Interceptor pipeline ───

  private async runRequestInterceptors(
    config: RequestInit,
    interceptors: RequestInterceptor[]
  ) {
    let currentConfig = config
    for (const interceptor of interceptors) {
      currentConfig = await interceptor(currentConfig)
    }
    return currentConfig
  }

  private async runResponseInterceptors(
    data: unknown,
    interceptors: ResponseInterceptor<any, any>[]
  ) {
    let currentData = data
    for (const interceptor of interceptors) {
      currentData = await interceptor(currentData)
    }
    return currentData
  }

  private async runErrorInterceptors(
    error: unknown,
    interceptors: ErrorInterceptor[]
  ) {
    let currentError = error
    for (const interceptor of interceptors) {
      currentError = await interceptor(currentError)
    }
    return currentError
  }

  // ─── Response parsing ───

  private async parseResponse(response: Response) {
    const contentType = response.headers.get('content-type') ?? ''

    if (response.status === 204 || response.status === 205) return null

    if (contentType.includes(MIME_TYPES.JSON)) return response.json()
    if (contentType.includes('text/')) return response.text()
    if (
      contentType.includes('application/octet-stream') ||
      contentType.startsWith('image/') ||
      contentType.startsWith('audio/') ||
      contentType.startsWith('video/')
    ) {
      return response.blob()
    }
    return response.text()
  }

  private removeInterceptor<T>(interceptors: T[], interceptor: T) {
    const index = interceptors.indexOf(interceptor)
    if (index !== -1) interceptors.splice(index, 1)
  }
}
