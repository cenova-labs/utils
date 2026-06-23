# @cc-heart/utils

[Docs](https://cenova-labs.github.io/utils/)

A library of JavaScript tools

## Install

```shell
npm install @cc-heart/utils
```

## Usage

```js
import { capitalize } from '@cc-heart/utils'

capitalize('string') // String
```

## Request — composable best practices

```ts
import { Request } from '@cc-heart/utils'
import type { RequestInterceptor } from '@cc-heart/utils'
```

### Principle: small instances + composition

Prefer small focused instances over one instance with all interceptors. Combine them with factory functions:

```ts
// ── Building blocks: interceptors are pure functions ──
const addAuth: RequestInterceptor = (config) => ({
  ...config,
  headers: { ...config.headers, Authorization: `Bearer ${getToken()}` }
})

const addLang: RequestInterceptor = (config) => ({
  ...config,
  headers: { ...config.headers, 'Accept-Language': 'zh-CN' }
})

const handleError = (err: unknown) => {
  toast.error(err)
  return err
}

// ── Compose: each instance handles one concern ──
const authApi = new Request('https://api.example.com')
authApi.useRequestInterceptor(addAuth)
authApi.useRequestInterceptor(addLang)
authApi.useErrorInterceptor(handleError)

const publicApi = new Request('https://open.api.com')

// ── Or use helper functions ──
function withInterceptors(
  req: Request,
  interceptors: RequestInterceptor[]
): Request {
  interceptors.forEach((i) => req.useRequestInterceptor(i))
  return req
}
function withBaseUrl(url: string): Request {
  return new Request(url)
}

const api = withInterceptors(withBaseUrl('https://api.example.com'), [
  addAuth,
  addLang,
])
```

### Four calling styles

```ts
const api = new Request('https://api.example.com')

// Style 1: async/await (recommended)
try {
  const user = await api.get<User>('/users/1')
  setUser(user)
} catch (e) {
  if ((e as Error).name === 'AbortError') return  // user cancelled
  toast.error(e)
}

// Style 2: lifecycle callbacks (React setState friendly)
api.get('/users', {
  onSuccess: setUsers,
  onError: toast.error,
  onFinally: () => setLoading(false),
})

// Style 3: promise chaining
api.get<number>('/count')
  .then(n => n * 2)
  .then(setCount)
  .catch(toast.error)

// Style 4: mixed (await + callbacks, non-conflicting)
const data = await api.get('/users', { onFinally: () => setLoading(false) })
```

### Entity — group by domain

```ts
// entities/user.ts
const api = new Request('/api')

export const UserApi = {
  list: (page: number) =>
    api.get<User[]>('/users', { page }),
  get: (id: number) =>
    api.get<User>(`/users/${id}`),
  create: (data: CreateUserDto) =>
    api.post<User>('/users', data, { onSuccess: () => toast.success('created') }),
}

// Usage
const users = await UserApi.list(1)
```

### Cache & dedup — isolated per instance

```ts
const cachedApi = new Request('/api')
// cache and dedup are instance-level, different Request instances are isolated
const data1 = await cachedApi.get('/users', {}, { cache: { ttl: 5000 } })
const data2 = await cachedApi.get('/users', {}, { cache: { ttl: 5000 } }) // cache hit

const otherApi = new Request('/api') // isolated cache
```

## SSE (Server-Sent Events)

Supports SSE streaming requests, built on Fetch API with these advantages over native EventSource:
- ✅ Custom Headers support
- ✅ POST requests support
- ✅ All HTTP methods supported

### Basic usage

```ts
import { Request } from '@cc-heart/utils'

const api = new Request('https://api.example.com')

// GET SSE
const handle = api.sse('/events', {
  onMessage(event) {
    console.log('Received:', event.data)
  },
  onOpen() {
    console.log('Connection opened')
  },
  onError(error) {
    console.error('Connection error:', error)
  },
  onClose() {
    console.log('Connection closed')
  }
})

// Cancel connection
handle.abort()
```

### POST SSE (e.g., AI streaming chat)

```ts
const handle = api.sse('/chat/completions', {
  method: 'POST',
  data: {
    prompt: 'Hello',
    model: 'gpt-4'
  },
  onMessage(event) {
    // Parse JSON data
    try {
      const data = JSON.parse(event.data)
      console.log('AI reply:', data.content)
    } catch {
      console.log('Raw data:', event.data)
    }
  },
  onError(err) {
    console.error('Request failed:', err)
  }
})
```

### With interceptors

```ts
import type { RequestInterceptor } from '@cc-heart/utils'

const addAuth: RequestInterceptor = (config) => ({
  ...config,
  headers: {
    ...config.headers,
    Authorization: `Bearer ${getToken()}`
  }
})

const api = new Request('https://api.example.com')
api.useRequestInterceptor(addAuth)

// SSE requests automatically include interceptor headers
const handle = api.sse('/protected/events', {
  onMessage(event) {
    console.log(event.data)
  }
})
```

### SSE Type definitions

```ts
interface SSEMessageEvent {
  event?: string    // Event type
  data: string      // Message data
  id?: string       // Last event ID
  retry?: number    // Retry interval (ms)
}

interface SSECallbacks {
  onMessage?: (event: SSEMessageEvent) => void
  onOpen?: () => void
  onError?: (error: unknown) => void
  onClose?: () => void
}
```

## LICENSE

`@cc-heart/utils` is licensed under the [MIT License](./LICENSE).
