# @cc-heart/utils

[Docs](https://carlopenlab.github.io/utils/)

一个 JavaScript 工具库

## 安装

```shell
npm install @cc-heart/utils
```

## 使用

```js
import { capitalize } from '@cc-heart/utils'

capitalize('string') // String
```

## Request — 组合式最佳实践

```ts
import { Request } from '@cc-heart/utils'
import type { RequestInterceptor } from '@cc-heart/utils'
```

### 原则：小实例 + 组合

不要一个实例挂全部拦截器，每个实例只做一件事，需要组合时用工厂函数包装：

```ts
// ── 构建块：拦截器就是纯函数 ──
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

// ── 组合：每个实例只关注一个能力 ──
const authApi = new Request('https://api.example.com')
authApi.useRequestInterceptor(addAuth)
authApi.useRequestInterceptor(addLang)
authApi.useErrorInterceptor(handleError)

const publicApi = new Request('https://open.api.com')

// ── 或用辅助函数组合 ──
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

### 四种调用风格

```ts
const api = new Request('https://api.example.com')

// 风格 1：async/await（推荐）
try {
  const user = await api.get<User>('/users/1')
  setUser(user)
} catch (e) {
  if ((e as Error).name === 'AbortError') return // 用户主动取消
  toast.error(e)
}

// 风格 2：生命周期回调（React setState 友好）
api.get('/users', {
  onSuccess: setUsers,
  onError: toast.error,
  onFinally: () => setLoading(false),
})

// 风格 3：Promise 链式
api.get<number>('/count')
  .then(n => n * 2)
  .then(setCount)
  .catch(toast.error)

// 风格 4：混合使用（await + 回调，互不冲突）
const data = await api.get('/users', { onFinally: () => setLoading(false) })
```

### Entity —— 按实体聚合

```ts
// entities/user.ts
const api = new Request('/api')

export const UserApi = {
  list: (page: number) =>
    api.get<User[]>('/users', { page }),
  get: (id: number) =>
    api.get<User>(`/users/${id}`),
  create: (data: CreateUserDto) =>
    api.post<User>('/users', data, { onSuccess: () => toast.success('创建成功') }),
}

// 使用
const users = await UserApi.list(1)
```

### 缓存 + 去重（按实例隔离）

```ts
const cachedApi = new Request('/api')
// cache 和 dedup 是实例级别的，不同的 Request 实例互相隔离
const data1 = await cachedApi.get('/users', {}, { cache: { ttl: 5000 } })
const data2 = await cachedApi.get('/users', {}, { cache: { ttl: 5000 } }) // 命中缓存

const otherApi = new Request('/api') // 独立缓存
```

## 配置项速查

```ts
interface RequestConfig {
  // 请求参数
  params?: Record<PropertyKey, any>
  data?: unknown

  // 拦截器（单次请求）
  requestInterceptors?: RequestInterceptor[]
  responseInterceptors?: ResponseInterceptor[]
  errorInterceptors?: ErrorInterceptor[]

  // 超时 & 重试
  timeout?: number          // 毫秒，超时自动 abort 当前尝试
  retry?: number            // 失败重试次数，0 = 不重试
  retryDelay?: number       // 重试间隔（毫秒）

  // 缓存（仅 GET）
  cache?: boolean | { ttl: number }  // true = 默认 TTL 5s

  // 下载进度
  onDownloadProgress?: (loaded: number, total: number) => void

  // 生命周期回调
  onSuccess?: (data: unknown) => void
  onError?: (error: unknown) => void
  onAbort?: () => void
  onFinally?: () => void
}
```

## SSE (Server-Sent Events)

支持 SSE 流式请求，基于 Fetch API 实现，相比原生 EventSource 有以下优势：
- ✅ 支持自定义 Headers
- ✅ 支持 POST 请求
- ✅ 支持所有 HTTP 方法

### 基础用法

```ts
import { Request } from '@cc-heart/utils'

const api = new Request('https://api.example.com')

// GET SSE
const handle = api.sse('/events', {
  onMessage(event) {
    console.log('收到消息:', event.data)
  },
  onOpen() {
    console.log('连接已建立')
  },
  onError(error) {
    console.error('连接错误:', error)
  },
  onClose() {
    console.log('连接已关闭')
  }
})

// 取消连接
handle.abort()
```

### POST SSE (如 AI 流式对话)

```ts
const handle = api.sse('/chat/completions', {
  method: 'POST',
  data: {
    prompt: '你好',
    model: 'gpt-4'
  },
  onMessage(event) {
    // 解析 JSON 数据
    try {
      const data = JSON.parse(event.data)
      console.log('AI 回复:', data.content)
    } catch {
      console.log('原始数据:', event.data)
    }
  },
  onError(err) {
    console.error('请求失败:', err)
  }
})
```

### 搭配拦截器使用

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

// SSE 请求会自动携带拦截器添加的 Headers
const handle = api.sse('/protected/events', {
  onMessage(event) {
    console.log(event.data)
  }
})
```

### SSE 类型定义

```ts
interface SSEMessageEvent {
  event?: string    // 事件类型
  data: string      // 消息数据
  id?: string       // 最后事件 ID
  retry?: number    // 重连间隔（毫秒）
}

interface SSECallbacks {
  onMessage?: (event: SSEMessageEvent) => void
  onOpen?: () => void
  onError?: (error: unknown) => void
  onClose?: () => void
}
```

## 返回类型

```ts
interface RequestHandle<T> {
  // thenable，可直接 await
  then, catch, finally: Promise 方法
  // 取消请求
  abort: () => void
}
```

## LICENSE

`@cc-heart/utils` 基于 [MIT License](./LICENSE) 协议开源。
