/**
 * Chrome Extension API Mock
 *
 * 手写 Chrome API mock，避免引入 jest-chrome 等外部依赖。
 * 仅模拟测试中实际用到的 API 子集。
 */

import { vi } from 'vitest'

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export interface StorageData {
  apiKey?: string
  workerUrl?: string
}

export interface MockTab {
  id?: number
  url?: string
  title?: string
}

export interface MockMessage {
  action: string
  url?: string
  title?: string
  excerpt?: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Storage mock
// ---------------------------------------------------------------------------

/**
 * 创建一个内存存储 mock，模拟 chrome.storage.sync 行为
 */
export function makeStorageMock(initialData: StorageData = {}) {
  let store: StorageData = { ...initialData }

  return {
    get: vi.fn().mockImplementation((keys: string | string[], callback?: (result: StorageData) => void) => {
      const keyList = Array.isArray(keys) ? keys : [keys]
      const result: StorageData = {}
      for (const key of keyList) {
        if (key in store) {
          (result as Record<string, unknown>)[key] = (store as Record<string, unknown>)[key]
        }
      }
      if (callback) {
        callback(result)
        return undefined
      }
      return Promise.resolve(result)
    }),
    set: vi.fn().mockImplementation((data: StorageData, callback?: () => void) => {
      store = { ...store, ...data }
      if (callback) {
        callback()
        return undefined
      }
      return Promise.resolve()
    }),
    _getStore: () => ({ ...store }),
    _setStore: (data: StorageData) => { store = { ...data } },
  }
}

// ---------------------------------------------------------------------------
// Tabs mock
// ---------------------------------------------------------------------------

export function makeTabsMock(activeTab: MockTab = { id: 1, url: 'https://example.com', title: 'Example' }) {
  return {
    query: vi.fn().mockImplementation((_query: object, callback?: (tabs: MockTab[]) => void) => {
      if (callback) {
        callback([activeTab])
        return undefined
      }
      return Promise.resolve([activeTab])
    }),
    sendMessage: vi.fn().mockImplementation((_tabId: number, _message: MockMessage, callback?: (response: unknown) => void) => {
      if (callback) {
        callback(undefined)
        return undefined
      }
      return Promise.resolve(undefined)
    }),
  }
}

// ---------------------------------------------------------------------------
// ContextMenus mock
// ---------------------------------------------------------------------------

export function makeContextMenusMock() {
  return {
    create: vi.fn(),
    onClicked: {
      addListener: vi.fn(),
    },
  }
}

// ---------------------------------------------------------------------------
// Runtime mock
// ---------------------------------------------------------------------------

export function makeRuntimeMock() {
  const listeners: Array<(message: MockMessage, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void> = []

  return {
    onInstalled: {
      addListener: vi.fn(),
    },
    onMessage: {
      addListener: vi.fn().mockImplementation((listener: typeof listeners[0]) => {
        listeners.push(listener)
      }),
      // 触发所有已注册的 message 监听器，用于测试
      _trigger: (message: MockMessage, sender: unknown = {}) => {
        return new Promise<unknown>((resolve) => {
          for (const listener of listeners) {
            listener(message, sender, resolve)
          }
        })
      },
      _listeners: listeners,
    },
    lastError: undefined as { message: string } | undefined,
  }
}

// ---------------------------------------------------------------------------
// 完整 chrome mock 对象工厂
// ---------------------------------------------------------------------------

export function makeChromeMock(overrides: {
  storageData?: StorageData
  activeTab?: MockTab
} = {}) {
  return {
    storage: {
      sync: makeStorageMock(overrides.storageData),
    },
    tabs: makeTabsMock(overrides.activeTab),
    contextMenus: makeContextMenusMock(),
    runtime: makeRuntimeMock(),
  }
}
