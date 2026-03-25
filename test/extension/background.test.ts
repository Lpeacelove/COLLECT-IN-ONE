/**
 * background.js 测试套件
 *
 * 测试策略：
 * - background.js 是纯浏览器代码（无 import/export），通过 globalThis 注入 chrome mock
 * - 使用动态 import + ?raw 读取源码，再用 Function() 在注入 mock 后执行
 * - 每个 describe 块前重置 chrome mock，确保测试隔离
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { makeChromeMock, type MockMessage } from './chrome-mock'
import { readFileSync } from 'fs'
import { join } from 'path'

// ---------------------------------------------------------------------------
// 加载 background.js 源码并在给定 context 中执行
// ---------------------------------------------------------------------------

const EXTENSION_DIR = join(process.cwd(), 'extension')

function loadAndExecuteBackground(chromeMock: ReturnType<typeof makeChromeMock>, fetchMock?: typeof fetch) {
  const src = readFileSync(join(EXTENSION_DIR, 'background.js'), 'utf-8')
  const fn = new Function('chrome', 'fetch', 'console', src)
  fn(
    chromeMock,
    fetchMock ?? globalThis.fetch,
    { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
  )
}

// ---------------------------------------------------------------------------
// Helper：构造 fetch Response mock
// ---------------------------------------------------------------------------

function makeResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const VALID_API_KEY = 'test-bearer-token'
const VALID_WORKER_URL = 'https://my-worker.workers.dev'
const TEST_URL = 'https://example.com/article'
const TEST_TITLE = 'Example Article'
const TEST_EXCERPT = 'This is a test excerpt'

// ---------------------------------------------------------------------------
// 安装事件（onInstalled）
// ---------------------------------------------------------------------------

describe('onInstalled：注册右键菜单', () => {
  let chrome: ReturnType<typeof makeChromeMock>

  beforeEach(() => {
    chrome = makeChromeMock()
  })

  it('注册 onInstalled 监听器', () => {
    loadAndExecuteBackground(chrome)
    expect(chrome.runtime.onInstalled.addListener).toHaveBeenCalledTimes(1)
  })

  it('onInstalled 触发时调用 contextMenus.create', () => {
    loadAndExecuteBackground(chrome)
    // 触发 onInstalled 回调
    const callback = (chrome.runtime.onInstalled.addListener as ReturnType<typeof vi.fn>).mock.calls[0][0]
    callback()
    expect(chrome.contextMenus.create).toHaveBeenCalledTimes(1)
  })

  it('contextMenus.create 被调用时传入 id 和 title', () => {
    loadAndExecuteBackground(chrome)
    const callback = (chrome.runtime.onInstalled.addListener as ReturnType<typeof vi.fn>).mock.calls[0][0]
    callback()
    const createArg = (chrome.contextMenus.create as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(createArg).toHaveProperty('id')
    expect(createArg).toHaveProperty('title')
    expect(typeof createArg.id).toBe('string')
    expect(typeof createArg.title).toBe('string')
  })

  it('右键菜单注册了 onClicked 监听器', () => {
    loadAndExecuteBackground(chrome)
    expect(chrome.contextMenus.onClicked.addListener).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// onMessage：collect 动作 - 正常路径
// ---------------------------------------------------------------------------

describe('onMessage collect：正常路径', () => {
  let chrome: ReturnType<typeof makeChromeMock>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    chrome = makeChromeMock({
      storageData: { apiKey: VALID_API_KEY, workerUrl: VALID_WORKER_URL },
    })
    fetchMock = vi.fn().mockResolvedValue(makeResponse(200, { id: 'item-123' }))
    loadAndExecuteBackground(chrome, fetchMock as unknown as typeof fetch)
  })

  it('注册了 onMessage 监听器', () => {
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1)
  })

  it('收到 collect 消息后调用 fetch', async () => {
    const message: MockMessage = { action: 'collect', url: TEST_URL, title: TEST_TITLE, excerpt: TEST_EXCERPT }
    await chrome.runtime.onMessage._trigger(message)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fetch 请求 URL 包含 workerUrl + /api/collect', async () => {
    const message: MockMessage = { action: 'collect', url: TEST_URL, title: TEST_TITLE, excerpt: TEST_EXCERPT }
    await chrome.runtime.onMessage._trigger(message)
    const [calledUrl] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe(`${VALID_WORKER_URL}/api/collect`)
  })

  it('fetch 请求方法为 POST', async () => {
    const message: MockMessage = { action: 'collect', url: TEST_URL, title: TEST_TITLE, excerpt: TEST_EXCERPT }
    await chrome.runtime.onMessage._trigger(message)
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(options.method).toBe('POST')
  })

  it('fetch 请求头包含 Authorization Bearer token', async () => {
    const message: MockMessage = { action: 'collect', url: TEST_URL, title: TEST_TITLE, excerpt: TEST_EXCERPT }
    await chrome.runtime.onMessage._trigger(message)
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = options.headers as Record<string, string>
    expect(headers['Authorization']).toBe(`Bearer ${VALID_API_KEY}`)
  })

  it('fetch 请求头 Content-Type 为 application/json', async () => {
    const message: MockMessage = { action: 'collect', url: TEST_URL, title: TEST_TITLE, excerpt: TEST_EXCERPT }
    await chrome.runtime.onMessage._trigger(message)
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = options.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('fetch 请求体包含 url、title、excerpt', async () => {
    const message: MockMessage = { action: 'collect', url: TEST_URL, title: TEST_TITLE, excerpt: TEST_EXCERPT }
    await chrome.runtime.onMessage._trigger(message)
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(options.body as string)
    expect(body).toMatchObject({ url: TEST_URL, title: TEST_TITLE, excerpt: TEST_EXCERPT })
  })

  it('成功后 sendResponse 收到 { success: true }', async () => {
    const message: MockMessage = { action: 'collect', url: TEST_URL, title: TEST_TITLE, excerpt: TEST_EXCERPT }
    const response = await chrome.runtime.onMessage._trigger(message)
    expect(response).toMatchObject({ success: true })
  })
})

// ---------------------------------------------------------------------------
// onMessage collect：HTTP 409 重复收藏
// ---------------------------------------------------------------------------

describe('onMessage collect：HTTP 409 重复收藏', () => {
  let chrome: ReturnType<typeof makeChromeMock>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    chrome = makeChromeMock({
      storageData: { apiKey: VALID_API_KEY, workerUrl: VALID_WORKER_URL },
    })
    fetchMock = vi.fn().mockResolvedValue(makeResponse(409, { error: 'duplicate' }))
    loadAndExecuteBackground(chrome, fetchMock as unknown as typeof fetch)
  })

  it('409 时 sendResponse 收到 { success: false, duplicate: true }', async () => {
    const message: MockMessage = { action: 'collect', url: TEST_URL, title: TEST_TITLE }
    const response = await chrome.runtime.onMessage._trigger(message)
    expect(response).toMatchObject({ success: false, duplicate: true })
  })
})

// ---------------------------------------------------------------------------
// onMessage collect：HTTP 错误（非 409）
// ---------------------------------------------------------------------------

describe('onMessage collect：HTTP 错误', () => {
  let chrome: ReturnType<typeof makeChromeMock>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    chrome = makeChromeMock({
      storageData: { apiKey: VALID_API_KEY, workerUrl: VALID_WORKER_URL },
    })
  })

  it('HTTP 500 时 sendResponse 包含 success: false 和 error 信息', async () => {
    fetchMock = vi.fn().mockResolvedValue(makeResponse(500, { error: 'server error' }))
    loadAndExecuteBackground(chrome, fetchMock as unknown as typeof fetch)
    const message: MockMessage = { action: 'collect', url: TEST_URL, title: TEST_TITLE }
    const response = await chrome.runtime.onMessage._trigger(message)
    expect(response).toMatchObject({ success: false })
    expect((response as Record<string, unknown>).error).toBeTruthy()
  })

  it('HTTP 401 时 sendResponse 包含 success: false', async () => {
    fetchMock = vi.fn().mockResolvedValue(makeResponse(401, { error: 'unauthorized' }))
    loadAndExecuteBackground(chrome, fetchMock as unknown as typeof fetch)
    const message: MockMessage = { action: 'collect', url: TEST_URL, title: TEST_TITLE }
    const response = await chrome.runtime.onMessage._trigger(message)
    expect(response).toMatchObject({ success: false })
  })
})

// ---------------------------------------------------------------------------
// onMessage collect：网络错误
// ---------------------------------------------------------------------------

describe('onMessage collect：网络错误', () => {
  let chrome: ReturnType<typeof makeChromeMock>

  beforeEach(() => {
    chrome = makeChromeMock({
      storageData: { apiKey: VALID_API_KEY, workerUrl: VALID_WORKER_URL },
    })
  })

  it('fetch 抛出 TypeError 时 sendResponse 包含 success: false 和错误信息', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    loadAndExecuteBackground(chrome, fetchMock as unknown as typeof fetch)
    const message: MockMessage = { action: 'collect', url: TEST_URL, title: TEST_TITLE }
    const response = await chrome.runtime.onMessage._trigger(message)
    expect(response).toMatchObject({ success: false })
    expect((response as Record<string, unknown>).error).toContain('Failed to fetch')
  })

  it('网络错误时不崩溃，正常返回错误响应', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    loadAndExecuteBackground(chrome, fetchMock as unknown as typeof fetch)
    const message: MockMessage = { action: 'collect', url: TEST_URL, title: TEST_TITLE }
    // 不应抛出，而是 resolve 出错误对象
    await expect(chrome.runtime.onMessage._trigger(message)).resolves.toMatchObject({ success: false })
  })
})

// ---------------------------------------------------------------------------
// onMessage collect：配置缺失
// ---------------------------------------------------------------------------

describe('onMessage collect：配置缺失', () => {
  it('apiKey 为空时不发起 fetch 请求，返回错误', async () => {
    const chrome = makeChromeMock({ storageData: { apiKey: '', workerUrl: VALID_WORKER_URL } })
    const fetchMock = vi.fn()
    loadAndExecuteBackground(chrome, fetchMock as unknown as typeof fetch)
    const message: MockMessage = { action: 'collect', url: TEST_URL, title: TEST_TITLE }
    const response = await chrome.runtime.onMessage._trigger(message)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(response).toMatchObject({ success: false })
  })

  it('workerUrl 为空时不发起 fetch 请求，返回错误', async () => {
    const chrome = makeChromeMock({ storageData: { apiKey: VALID_API_KEY, workerUrl: '' } })
    const fetchMock = vi.fn()
    loadAndExecuteBackground(chrome, fetchMock as unknown as typeof fetch)
    const message: MockMessage = { action: 'collect', url: TEST_URL, title: TEST_TITLE }
    const response = await chrome.runtime.onMessage._trigger(message)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(response).toMatchObject({ success: false })
  })

  it('apiKey 和 workerUrl 均未设置时返回配置缺失错误', async () => {
    const chrome = makeChromeMock({ storageData: {} })
    const fetchMock = vi.fn()
    loadAndExecuteBackground(chrome, fetchMock as unknown as typeof fetch)
    const message: MockMessage = { action: 'collect', url: TEST_URL, title: TEST_TITLE }
    const response = await chrome.runtime.onMessage._trigger(message)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(response).toMatchObject({ success: false })
  })
})

// ---------------------------------------------------------------------------
// onMessage：非 collect 动作（不应处理）
// ---------------------------------------------------------------------------

describe('onMessage：其他 action 不影响 collect 逻辑', () => {
  it('收到未知 action 时不调用 fetch', () => {
    const chrome = makeChromeMock({ storageData: { apiKey: VALID_API_KEY, workerUrl: VALID_WORKER_URL } })
    const fetchMock = vi.fn()
    loadAndExecuteBackground(chrome, fetchMock as unknown as typeof fetch)

    // 直接调用已注册的监听器，不等待 sendResponse（非 collect action 不会调用 sendResponse）
    const listener = (chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    const fakeSendResponse = vi.fn()
    if (listener) {
      listener({ action: 'unknown_action' }, {}, fakeSendResponse)
    }

    expect(fetchMock).not.toHaveBeenCalled()
    expect(fakeSendResponse).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 右键菜单点击（contextMenus.onClicked）
// ---------------------------------------------------------------------------

describe('contextMenus.onClicked：触发收集', () => {
  let chrome: ReturnType<typeof makeChromeMock>
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    chrome = makeChromeMock({
      storageData: { apiKey: VALID_API_KEY, workerUrl: VALID_WORKER_URL },
      activeTab: { id: 1, url: TEST_URL, title: TEST_TITLE },
    })
    fetchMock = vi.fn().mockResolvedValue(makeResponse(200, { id: 'item-xyz' }))
    loadAndExecuteBackground(chrome, fetchMock as unknown as typeof fetch)
  })

  it('右键菜单点击后向 content.js 发送 getPageInfo 消息', async () => {
    // 模拟 tabs.sendMessage 返回页面信息
    ;(chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      (_tabId: number, _msg: MockMessage, callback?: (res: unknown) => void) => {
        callback?.({ url: TEST_URL, title: TEST_TITLE, excerpt: TEST_EXCERPT })
        return undefined
      }
    )
    const onClickedCallback = (chrome.contextMenus.onClicked.addListener as ReturnType<typeof vi.fn>).mock.calls[0][0]
    await onClickedCallback({ menuItemId: 'collect-page' }, { id: 1, url: TEST_URL, title: TEST_TITLE })
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      { action: 'getPageInfo' },
      expect.any(Function),
    )
  })

  it('右键菜单点击后最终调用 fetch 发起收集', async () => {
    ;(chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
      (_tabId: number, _msg: MockMessage, callback?: (res: unknown) => void) => {
        callback?.({ url: TEST_URL, title: TEST_TITLE, excerpt: TEST_EXCERPT })
        return undefined
      }
    )
    const onClickedCallback = (chrome.contextMenus.onClicked.addListener as ReturnType<typeof vi.fn>).mock.calls[0][0]
    await onClickedCallback({ menuItemId: 'collect-page' }, { id: 1, url: TEST_URL, title: TEST_TITLE })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl] = fetchMock.mock.calls[0] as [string]
    expect(calledUrl).toBe(`${VALID_WORKER_URL}/api/collect`)
  })
})
