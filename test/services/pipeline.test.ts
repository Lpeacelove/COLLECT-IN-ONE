import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest'
import { runDigestPipeline } from '../../src/services/pipeline'
import * as summarizer from '../../src/services/summarizer'
import * as feishu from '../../src/services/feishu'
import type { Env, DigestPayload } from '../../src/types'

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function makeEnv(): Env {
  return {
    DB: {} as D1Database,
    API_KEY: 'test-key',
    DEEPSEEK_API_KEY: 'deepseek-key',
    JINA_API_KEY: '',
    FEISHU_WEBHOOK_URL: 'https://feishu.example.com/webhook',
  }
}

function makeDigest(): DigestPayload {
  return {
    id: 'digest-1',
    overall: '今日整体总结',
    date: '2024-01-01',
    items: [
      { id: 'item-1', title: '文章一', url: 'https://example.com/1', summary: '摘要一' },
      { id: 'item-2', title: '文章二', url: 'https://example.com/2', summary: '摘要二' },
    ],
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let summarizeSpy: MockInstance
let feishuSpy: MockInstance

beforeEach(() => {
  vi.restoreAllMocks()
  summarizeSpy = vi.spyOn(summarizer, 'summarizeItems')
  feishuSpy = vi.spyOn(feishu, 'sendDigestToFeishu')
})

// ---------------------------------------------------------------------------
// 无 items 场景
// ---------------------------------------------------------------------------

describe('无 extracted items 时', () => {
  it('返回 ok: true', async () => {
    summarizeSpy.mockResolvedValue(null)
    const result = await runDigestPipeline(makeEnv())
    expect(result.ok).toBe(true)
  })

  it('不包含 digest_id', async () => {
    summarizeSpy.mockResolvedValue(null)
    const result = await runDigestPipeline(makeEnv())
    expect(result.digest_id).toBeUndefined()
  })

  it('不调用 sendDigestToFeishu', async () => {
    summarizeSpy.mockResolvedValue(null)
    feishuSpy.mockResolvedValue(undefined)
    await runDigestPipeline(makeEnv())
    expect(feishuSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 正常流程
// ---------------------------------------------------------------------------

describe('正常流程', () => {
  it('成功时返回 ok: true', async () => {
    summarizeSpy.mockResolvedValue(makeDigest())
    feishuSpy.mockResolvedValue(undefined)
    const result = await runDigestPipeline(makeEnv())
    expect(result.ok).toBe(true)
  })

  it('成功时返回 digest_id', async () => {
    const digest = makeDigest()
    summarizeSpy.mockResolvedValue(digest)
    feishuSpy.mockResolvedValue(undefined)
    const result = await runDigestPipeline(makeEnv())
    expect(result.digest_id).toBe('digest-1')
  })

  it('成功时返回 item_count', async () => {
    summarizeSpy.mockResolvedValue(makeDigest())
    feishuSpy.mockResolvedValue(undefined)
    const result = await runDigestPipeline(makeEnv())
    expect(result.item_count).toBe(2)
  })

  it('调用 sendDigestToFeishu 时传入 digest payload', async () => {
    const digest = makeDigest()
    summarizeSpy.mockResolvedValue(digest)
    feishuSpy.mockResolvedValue(undefined)
    await runDigestPipeline(makeEnv())
    expect(feishuSpy).toHaveBeenCalledWith(expect.anything(), digest)
  })
})

// ---------------------------------------------------------------------------
// 错误处理
// ---------------------------------------------------------------------------

describe('错误处理', () => {
  it('summarizeItems 抛出异常时返回 ok: false', async () => {
    summarizeSpy.mockRejectedValue(new Error('DeepSeek unavailable'))
    const result = await runDigestPipeline(makeEnv())
    expect(result.ok).toBe(false)
  })

  it('summarizeItems 抛出异常时 error 字段包含错误信息', async () => {
    summarizeSpy.mockRejectedValue(new Error('DeepSeek unavailable'))
    const result = await runDigestPipeline(makeEnv())
    expect(result.error).toContain('DeepSeek unavailable')
  })

  it('sendDigestToFeishu 抛出异常时返回 ok: false', async () => {
    summarizeSpy.mockResolvedValue(makeDigest())
    feishuSpy.mockRejectedValue(new Error('Feishu webhook failed'))
    const result = await runDigestPipeline(makeEnv())
    expect(result.ok).toBe(false)
  })

  it('sendDigestToFeishu 抛出异常时 error 字段包含错误信息', async () => {
    summarizeSpy.mockResolvedValue(makeDigest())
    feishuSpy.mockRejectedValue(new Error('Feishu webhook failed'))
    const result = await runDigestPipeline(makeEnv())
    expect(result.error).toContain('Feishu webhook failed')
  })

  it('runDigestPipeline 本身不抛出异常', async () => {
    summarizeSpy.mockRejectedValue(new Error('catastrophic failure'))
    await expect(runDigestPipeline(makeEnv())).resolves.not.toThrow()
  })

  it('非 Error 对象的异常也能正常返回错误信息', async () => {
    summarizeSpy.mockRejectedValue('string error')
    const result = await runDigestPipeline(makeEnv())
    expect(result.ok).toBe(false)
    expect(result.error).toBe('string error')
  })
})
