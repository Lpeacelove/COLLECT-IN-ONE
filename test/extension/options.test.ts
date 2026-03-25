/**
 * options.js 测试套件
 *
 * options.js 负责设置页面逻辑：从 storage 读取配置并保存。
 * 测试策略：通过注入 chrome/document mock 来隔离测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeStorageMock, type StorageData } from './chrome-mock'
import { readFileSync } from 'fs'
import { join } from 'path'

const EXTENSION_DIR = join(process.cwd(), 'extension')

// ---------------------------------------------------------------------------
// DOM mock
// ---------------------------------------------------------------------------

interface InputElement {
  value: string
  addEventListener: ReturnType<typeof vi.fn>
}

interface StatusElement {
  textContent: string
  style: { display: string }
}

interface ButtonElement {
  addEventListener: ReturnType<typeof vi.fn>
}

function makeOptionsDOMmock(initialApiKey = '', initialWorkerUrl = '') {
  const apiKeyInput: InputElement = {
    value: initialApiKey,
    addEventListener: vi.fn(),
  }
  const workerUrlInput: InputElement = {
    value: initialWorkerUrl,
    addEventListener: vi.fn(),
  }
  const saveButton: ButtonElement = {
    addEventListener: vi.fn(),
  }
  const statusEl: StatusElement = {
    textContent: '',
    style: { display: 'none' },
  }

  const elements: Record<string, InputElement | ButtonElement | StatusElement> = {
    'apiKey': apiKeyInput,
    'workerUrl': workerUrlInput,
    'saveBtn': saveButton,
    'status': statusEl,
  }

  return {
    getElementById: vi.fn().mockImplementation((id: string) => elements[id] ?? null),
    _apiKeyInput: apiKeyInput,
    _workerUrlInput: workerUrlInput,
    _saveButton: saveButton,
    _statusEl: statusEl,
    addEventListener: vi.fn().mockImplementation((event: string, callback: () => void) => {
      if (event === 'DOMContentLoaded') {
        // 立即触发，模拟 DOM 已加载
        callback()
      }
    }),
  }
}

function makeChromeMock(storageData: StorageData = {}) {
  return {
    storage: {
      sync: makeStorageMock(storageData),
    },
  }
}

function loadOptionsScript(
  chromeMock: ReturnType<typeof makeChromeMock>,
  documentMock: ReturnType<typeof makeOptionsDOMmock>,
) {
  const src = readFileSync(join(EXTENSION_DIR, 'options.js'), 'utf-8')
  const fn = new Function('chrome', 'document', 'console', src)
  fn(
    chromeMock,
    documentMock,
    { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
  )
}

// ---------------------------------------------------------------------------
// 初始化加载
// ---------------------------------------------------------------------------

describe('options.js：初始化加载', () => {
  it('加载时从 storage 读取 apiKey 和 workerUrl', async () => {
    const chrome = makeChromeMock({ apiKey: 'my-key', workerUrl: 'https://worker.example.com' })
    const dom = makeOptionsDOMmock()
    loadOptionsScript(chrome, dom)
    // storage.get 应被调用
    expect(chrome.storage.sync.get).toHaveBeenCalled()
  })

  it('加载后将 apiKey 填入输入框', async () => {
    const chrome = makeChromeMock({ apiKey: 'my-api-key', workerUrl: 'https://worker.example.com' })
    const dom = makeOptionsDOMmock()
    loadOptionsScript(chrome, dom)
    // 等待 storage.get 的 promise 完成
    await Promise.resolve()
    expect(dom._apiKeyInput.value).toBe('my-api-key')
  })

  it('加载后将 workerUrl 填入输入框', async () => {
    const chrome = makeChromeMock({ apiKey: 'key', workerUrl: 'https://my-worker.workers.dev' })
    const dom = makeOptionsDOMmock()
    loadOptionsScript(chrome, dom)
    await Promise.resolve()
    expect(dom._workerUrlInput.value).toBe('https://my-worker.workers.dev')
  })

  it('storage 中没有保存值时输入框保持为空', async () => {
    const chrome = makeChromeMock({})
    const dom = makeOptionsDOMmock()
    loadOptionsScript(chrome, dom)
    await Promise.resolve()
    expect(dom._apiKeyInput.value).toBe('')
    expect(dom._workerUrlInput.value).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 保存操作
// ---------------------------------------------------------------------------

describe('options.js：保存操作', () => {
  it('点击保存按钮时调用 storage.sync.set', async () => {
    const chrome = makeChromeMock({})
    const dom = makeOptionsDOMmock()
    loadOptionsScript(chrome, dom)

    // 模拟用户输入
    dom._apiKeyInput.value = 'new-api-key'
    dom._workerUrlInput.value = 'https://new-worker.workers.dev'

    // 触发保存按钮点击
    const saveCallback = (dom._saveButton.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
    if (saveCallback) {
      saveCallback()
      await Promise.resolve()
    }

    expect(chrome.storage.sync.set).toHaveBeenCalled()
  })

  it('保存时将输入框的值写入 storage', async () => {
    const chrome = makeChromeMock({})
    const dom = makeOptionsDOMmock()
    loadOptionsScript(chrome, dom)

    dom._apiKeyInput.value = 'saved-key'
    dom._workerUrlInput.value = 'https://saved-worker.workers.dev'

    const saveCallback = (dom._saveButton.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
    if (saveCallback) {
      saveCallback()
      await Promise.resolve()
    }

    const setCall = (chrome.storage.sync.set as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(setCall).toMatchObject({
      apiKey: 'saved-key',
      workerUrl: 'https://saved-worker.workers.dev',
    })
  })

  it('保存成功后显示成功提示', async () => {
    const chrome = makeChromeMock({})
    const dom = makeOptionsDOMmock()
    loadOptionsScript(chrome, dom)

    const saveCallback = (dom._saveButton.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
    if (saveCallback) {
      saveCallback()
      await Promise.resolve()
      await Promise.resolve()
    }

    // 状态元素应显示
    expect(dom._statusEl.style.display).not.toBe('none')
  })

  it('apiKey 为空时仍可保存（允许清空）', async () => {
    const chrome = makeChromeMock({ apiKey: 'old-key', workerUrl: 'https://worker.example.com' })
    const dom = makeOptionsDOMmock()
    loadOptionsScript(chrome, dom)

    dom._apiKeyInput.value = ''
    dom._workerUrlInput.value = 'https://worker.example.com'

    const saveCallback = (dom._saveButton.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
    if (saveCallback) {
      saveCallback()
      await Promise.resolve()
    }

    const setCall = (chrome.storage.sync.set as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(setCall).toMatchObject({ apiKey: '' })
  })
})
