/**
 * popup.js 测试套件
 *
 * popup.js 负责弹出页面交互逻辑。
 * 测试策略：注入 chrome/document mock，通过触发 DOM 事件测试行为
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const EXTENSION_DIR = join(process.cwd(), 'extension')

// ---------------------------------------------------------------------------
// DOM mock
// ---------------------------------------------------------------------------

function makePopupDOMMock() {
  const collectBtn = { addEventListener: vi.fn(), disabled: false }
  const statusEl = { textContent: '', className: '', style: { display: 'none' } }
  const loadingEl = { style: { display: 'none' } }
  const pageTitleEl = { textContent: '' }
  const pageUrlEl = { textContent: '' }

  const elements: Record<string, unknown> = {
    'collectBtn': collectBtn,
    'status': statusEl,
    'loading': loadingEl,
    'pageTitle': pageTitleEl,
    'pageUrl': pageUrlEl,
  }

  return {
    getElementById: vi.fn().mockImplementation((id: string) => elements[id] ?? null),
    addEventListener: vi.fn().mockImplementation((event: string, callback: () => void) => {
      if (event === 'DOMContentLoaded') {
        callback()
      }
    }),
    _collectBtn: collectBtn,
    _statusEl: statusEl,
    _loadingEl: loadingEl,
    _pageTitleEl: pageTitleEl,
    _pageUrlEl: pageUrlEl,
  }
}

// ---------------------------------------------------------------------------
// Chrome mock
// ---------------------------------------------------------------------------

interface PageInfo {
  url: string
  title: string
  excerpt: string
}

function makeChromeMock(options: {
  pageInfo?: PageInfo
  collectResponse?: { success: boolean; duplicate?: boolean; error?: string }
} = {}) {
  const defaultPageInfo: PageInfo = {
    url: 'https://example.com',
    title: 'Example Page',
    excerpt: 'Example excerpt',
  }
  const defaultCollectResponse = { success: true }

  const pageInfo = options.pageInfo ?? defaultPageInfo
  const collectResponse = options.collectResponse ?? defaultCollectResponse

  const messageListeners: Array<(msg: { action: string }, sender: unknown, sendResponse: (r: unknown) => void) => boolean | void> = []

  return {
    tabs: {
      query: vi.fn().mockImplementation((_query: object, callback: (tabs: Array<{ id: number }>) => void) => {
        callback([{ id: 1 }])
      }),
    },
    runtime: {
      sendMessage: vi.fn().mockImplementation((message: { action: string }, callback?: (response: unknown) => void) => {
        if (message.action === 'getPageInfo') {
          callback?.(pageInfo)
        } else if (message.action === 'collect') {
          callback?.(collectResponse)
        }
        return undefined
      }),
      onMessage: {
        addListener: vi.fn().mockImplementation((fn: typeof messageListeners[0]) => {
          messageListeners.push(fn)
        }),
      },
      lastError: undefined as { message: string } | undefined,
    },
    _messageListeners: messageListeners,
  }
}

function loadPopupScript(
  chromeMock: ReturnType<typeof makeChromeMock>,
  documentMock: ReturnType<typeof makePopupDOMMock>,
) {
  const src = readFileSync(join(EXTENSION_DIR, 'popup.js'), 'utf-8')
  const fn = new Function('chrome', 'document', 'console', src)
  fn(
    chromeMock,
    documentMock,
    { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
  )
}

// ---------------------------------------------------------------------------
// 初始化：加载页面信息
// ---------------------------------------------------------------------------

describe('popup.js：初始化加载页面信息', () => {
  it('加载时向 background.js 发送 getPageInfo 消息', () => {
    const chrome = makeChromeMock()
    const dom = makePopupDOMMock()
    loadPopupScript(chrome, dom)
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { action: 'getPageInfo' },
      expect.any(Function),
    )
  })

  it('加载后将页面 title 显示在 DOM 中', async () => {
    const chrome = makeChromeMock({ pageInfo: { url: 'https://example.com', title: 'My Page', excerpt: '' } })
    const dom = makePopupDOMMock()
    loadPopupScript(chrome, dom)
    await Promise.resolve()
    expect(dom._pageTitleEl.textContent).toBe('My Page')
  })

  it('加载后将页面 url 显示在 DOM 中', async () => {
    const chrome = makeChromeMock({ pageInfo: { url: 'https://news.example.com/post', title: 'Title', excerpt: '' } })
    const dom = makePopupDOMMock()
    loadPopupScript(chrome, dom)
    await Promise.resolve()
    expect(dom._pageUrlEl.textContent).toBe('https://news.example.com/post')
  })
})

// ---------------------------------------------------------------------------
// 收藏按钮点击：成功路径
// ---------------------------------------------------------------------------

describe('popup.js：收藏按钮 - 成功', () => {
  it('点击收藏按钮时发送 collect 消息', async () => {
    const chrome = makeChromeMock({ collectResponse: { success: true } })
    const dom = makePopupDOMMock()
    loadPopupScript(chrome, dom)
    await Promise.resolve()

    const clickCallback = (dom._collectBtn.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
    if (clickCallback) {
      clickCallback()
      await Promise.resolve()
    }

    const calls = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls
    const collectCall = calls.find((c: unknown[]) => (c[0] as { action: string }).action === 'collect')
    expect(collectCall).toBeTruthy()
  })

  it('成功后显示成功状态', async () => {
    const chrome = makeChromeMock({ collectResponse: { success: true } })
    const dom = makePopupDOMMock()
    loadPopupScript(chrome, dom)
    await Promise.resolve()

    const clickCallback = (dom._collectBtn.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
    if (clickCallback) {
      clickCallback()
      await Promise.resolve()
      await Promise.resolve()
    }

    expect(dom._statusEl.style.display).not.toBe('none')
  })

  it('点击时禁用收藏按钮防止重复提交', async () => {
    const chrome = makeChromeMock()
    const dom = makePopupDOMMock()
    loadPopupScript(chrome, dom)
    await Promise.resolve()

    const clickCallback = (dom._collectBtn.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
    if (clickCallback) {
      clickCallback()
    }

    expect(dom._collectBtn.disabled).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 收藏按钮点击：409 重复
// ---------------------------------------------------------------------------

describe('popup.js：收藏按钮 - 409 重复', () => {
  it('duplicate: true 时显示重复提示', async () => {
    const chrome = makeChromeMock({ collectResponse: { success: false, duplicate: true } })
    const dom = makePopupDOMMock()
    loadPopupScript(chrome, dom)
    await Promise.resolve()

    const clickCallback = (dom._collectBtn.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
    if (clickCallback) {
      clickCallback()
      await Promise.resolve()
      await Promise.resolve()
    }

    // 状态元素应显示，且包含重复相关信息
    expect(dom._statusEl.style.display).not.toBe('none')
  })
})

// ---------------------------------------------------------------------------
// 收藏按钮点击：错误路径
// ---------------------------------------------------------------------------

describe('popup.js：收藏按钮 - 错误', () => {
  it('success: false 时显示错误状态', async () => {
    const chrome = makeChromeMock({ collectResponse: { success: false, error: 'Network error' } })
    const dom = makePopupDOMMock()
    loadPopupScript(chrome, dom)
    await Promise.resolve()

    const clickCallback = (dom._collectBtn.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
    if (clickCallback) {
      clickCallback()
      await Promise.resolve()
      await Promise.resolve()
    }

    expect(dom._statusEl.style.display).not.toBe('none')
  })
})
