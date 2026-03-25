/**
 * content.js 测试套件
 *
 * content.js 在浏览器环境中运行，依赖 document 和 chrome.runtime。
 * 测试策略：
 * - 使用 jsdom 提供的 document 全局对象（vitest 需切换 environment）
 * - 手动注入 chrome.runtime mock
 * - 通过触发 onMessage 监听器测试响应逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const EXTENSION_DIR = join(process.cwd(), 'extension')

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 构建一个最小 document mock，模拟浏览器 document 对象
 */
function makeDocumentMock(overrides: {
  url?: string
  title?: string
  ogDescription?: string
  metaDescription?: string
  bodyText?: string
} = {}) {
  const metas: Array<{ name?: string; property?: string; content: string }> = []

  if (overrides.ogDescription) {
    metas.push({ property: 'og:description', content: overrides.ogDescription })
  }
  if (overrides.metaDescription) {
    metas.push({ name: 'description', content: overrides.metaDescription })
  }

  return {
    URL: overrides.url ?? 'https://example.com',
    title: overrides.title ?? 'Example Page',
    querySelector: vi.fn().mockImplementation((selector: string) => {
      for (const meta of metas) {
        if (selector === 'meta[property="og:description"]' && meta.property === 'og:description') {
          return { content: meta.content }
        }
        if (selector === 'meta[name="description"]' && meta.name === 'description') {
          return { content: meta.content }
        }
      }
      return null
    }),
    body: {
      innerText: overrides.bodyText ?? '',
    },
  }
}

/**
 * 构建 chrome mock（包含 runtime.onMessage），并收集注册的 onMessage 监听器
 */
function makeRuntimeMock() {
  const listeners: Array<(msg: { action: string }, sender: unknown, sendResponse: (res: unknown) => void) => boolean | void> = []
  const onMessage = {
    addListener: vi.fn().mockImplementation((fn: typeof listeners[0]) => {
      listeners.push(fn)
    }),
    _trigger: (message: { action: string }, sender: unknown = {}) => {
      return new Promise<unknown>((resolve) => {
        for (const listener of listeners) {
          listener(message, sender, resolve)
        }
      })
    },
  }
  return {
    // content.js 通过 chrome.runtime.onMessage 访问
    runtime: { onMessage },
    // 暴露给测试代码直接调用
    onMessage,
  }
}

/**
 * 在给定的 chrome/document context 中加载并执行 content.js
 */
function loadContentScript(
  chromeMock: ReturnType<typeof makeRuntimeMock>,
  documentMock: ReturnType<typeof makeDocumentMock>,
) {
  const src = readFileSync(join(EXTENSION_DIR, 'content.js'), 'utf-8')
  const fn = new Function('chrome', 'document', 'console', src)
  fn(
    chromeMock,
    documentMock,
    { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
  )
}

// ---------------------------------------------------------------------------
// 注册监听器
// ---------------------------------------------------------------------------

describe('content.js 监听器注册', () => {
  it('加载时注册 chrome.runtime.onMessage 监听器', () => {
    const chrome = makeRuntimeMock()
    const doc = makeDocumentMock()
    loadContentScript(chrome, doc)
    expect(chrome.onMessage.addListener).toHaveBeenCalledTimes(1)
  })

  it('只注册一个监听器', () => {
    const chrome = makeRuntimeMock()
    const doc = makeDocumentMock()
    loadContentScript(chrome, doc)
    expect(chrome.onMessage.addListener).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// getPageInfo：基本字段
// ---------------------------------------------------------------------------

describe('getPageInfo：基本字段', () => {
  it('返回当前页面 url', async () => {
    const chrome = makeRuntimeMock()
    const doc = makeDocumentMock({ url: 'https://news.example.com/article' })
    loadContentScript(chrome, doc)
    const response = await chrome.onMessage._trigger({ action: 'getPageInfo' }) as Record<string, string>
    expect(response.url).toBe('https://news.example.com/article')
  })

  it('返回当前页面 title', async () => {
    const chrome = makeRuntimeMock()
    const doc = makeDocumentMock({ title: 'My Article Title' })
    loadContentScript(chrome, doc)
    const response = await chrome.onMessage._trigger({ action: 'getPageInfo' }) as Record<string, string>
    expect(response.title).toBe('My Article Title')
  })

  it('响应对象包含 url、title、excerpt 三个字段', async () => {
    const chrome = makeRuntimeMock()
    const doc = makeDocumentMock()
    loadContentScript(chrome, doc)
    const response = await chrome.onMessage._trigger({ action: 'getPageInfo' }) as Record<string, string>
    expect(response).toHaveProperty('url')
    expect(response).toHaveProperty('title')
    expect(response).toHaveProperty('excerpt')
  })
})

// ---------------------------------------------------------------------------
// getPageInfo：excerpt 提取逻辑
// ---------------------------------------------------------------------------

describe('getPageInfo：excerpt 提取', () => {
  it('优先使用 og:description', async () => {
    const chrome = makeRuntimeMock()
    const doc = makeDocumentMock({
      ogDescription: 'OG description text',
      metaDescription: 'Meta description text',
    })
    loadContentScript(chrome, doc)
    const response = await chrome.onMessage._trigger({ action: 'getPageInfo' }) as Record<string, string>
    expect(response.excerpt).toBe('OG description text')
  })

  it('og:description 不存在时回退到 meta[name="description"]', async () => {
    const chrome = makeRuntimeMock()
    const doc = makeDocumentMock({ metaDescription: 'Meta description text' })
    loadContentScript(chrome, doc)
    const response = await chrome.onMessage._trigger({ action: 'getPageInfo' }) as Record<string, string>
    expect(response.excerpt).toBe('Meta description text')
  })

  it('两者都不存在时 excerpt 为空字符串', async () => {
    const chrome = makeRuntimeMock()
    const doc = makeDocumentMock()
    loadContentScript(chrome, doc)
    const response = await chrome.onMessage._trigger({ action: 'getPageInfo' }) as Record<string, string>
    expect(response.excerpt).toBe('')
  })

  it('excerpt 超过 200 字符时截断到恰好 200 字符', async () => {
    const longText = 'a'.repeat(300)
    const chrome = makeRuntimeMock()
    const doc = makeDocumentMock({ ogDescription: longText })
    loadContentScript(chrome, doc)
    const response = await chrome.onMessage._trigger({ action: 'getPageInfo' }) as Record<string, string>
    expect(response.excerpt).toHaveLength(200)
  })

  it('excerpt 恰好 200 字符时不截断', async () => {
    const text = 'b'.repeat(200)
    const chrome = makeRuntimeMock()
    const doc = makeDocumentMock({ ogDescription: text })
    loadContentScript(chrome, doc)
    const response = await chrome.onMessage._trigger({ action: 'getPageInfo' }) as Record<string, string>
    expect(response.excerpt).toHaveLength(200)
  })

  it('excerpt 不足 200 字符时原样返回', async () => {
    const text = 'Short description'
    const chrome = makeRuntimeMock()
    const doc = makeDocumentMock({ ogDescription: text })
    loadContentScript(chrome, doc)
    const response = await chrome.onMessage._trigger({ action: 'getPageInfo' }) as Record<string, string>
    expect(response.excerpt).toBe(text)
  })

  it('excerpt 包含 Unicode 字符时按字符数截断', async () => {
    // 200 个中文字符 + 额外字符
    const text = '中'.repeat(250)
    const chrome = makeRuntimeMock()
    const doc = makeDocumentMock({ ogDescription: text })
    loadContentScript(chrome, doc)
    const response = await chrome.onMessage._trigger({ action: 'getPageInfo' }) as Record<string, string>
    expect(response.excerpt).toHaveLength(200)
    expect(response.excerpt).toBe('中'.repeat(200))
  })
})

// ---------------------------------------------------------------------------
// getPageInfo：非目标 action 不响应
// ---------------------------------------------------------------------------

describe('content.js：非 getPageInfo action', () => {
  it('未知 action 时监听器正常返回不报错', () => {
    const chrome = makeRuntimeMock()
    const doc = makeDocumentMock()
    loadContentScript(chrome, doc)

    // 直接调用监听器，不等待 sendResponse（非 getPageInfo action 不调用 sendResponse）
    const listener = (chrome.onMessage.addListener as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    const fakeSendResponse = vi.fn()
    expect(() => {
      if (listener) {
        listener({ action: 'someOtherAction' }, {}, fakeSendResponse)
      }
    }).not.toThrow()
    expect(fakeSendResponse).not.toHaveBeenCalled()
  })
})
