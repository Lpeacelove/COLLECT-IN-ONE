import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest'
import { extractContent } from '../../src/services/extractor'
import * as queries from '../../src/db/queries'
import type { Env } from '../../src/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeD1First(returnValue: unknown) {
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockResolvedValue(returnValue),
      }),
    }),
  }
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: makeD1First({ retry_count: 0 }) as unknown as D1Database,
    API_KEY: 'test-api-key',
    DEEPSEEK_API_KEY: 'deepseek-key',
    JINA_API_KEY: 'jina-key',
    FEISHU_WEBHOOK_URL: 'https://feishu.example.com/webhook',
    ...overrides,
  }
}

function makeFetchResponse(status: number, body: unknown, ok?: boolean): Response {
  return {
    status,
    ok: ok ?? (status >= 200 && status < 300),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let updateItemStatusSpy: MockInstance

beforeEach(() => {
  vi.restoreAllMocks()
  updateItemStatusSpy = vi.spyOn(queries, 'updateItemStatus').mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// 正常路径
// ---------------------------------------------------------------------------

describe('正常路径', () => {
  it('成功提取：先置状态为 extracting，再置为 extracted', async () => {
    const body = { data: { content: '# Hello', title: 'Hello' } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(200, body)))

    const env = makeEnv()
    await extractContent(env, 'item-1', 'https://example.com/article')

    expect(updateItemStatusSpy).toHaveBeenCalledTimes(2)
    expect(updateItemStatusSpy).toHaveBeenNthCalledWith(
      1,
      env.DB,
      'item-1',
      'extracting',
    )
    expect(updateItemStatusSpy).toHaveBeenNthCalledWith(
      2,
      env.DB,
      'item-1',
      'extracted',
      expect.objectContaining({
        content: '# Hello',
        content_length: 7,
        extracted_at: expect.any(String),
      }),
    )
  })

  it('extracted_at 是合法的 ISO 8601 字符串', async () => {
    const body = { data: { content: 'text' } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(200, body)))

    await extractContent(makeEnv(), 'item-2', 'https://example.com')

    const call = updateItemStatusSpy.mock.calls[1]
    const extra = call[3] as { extracted_at: string }
    expect(new Date(extra.extracted_at).toISOString()).toBe(extra.extracted_at)
  })

  it('内容未超限时原样写入，不截断', async () => {
    const content = 'a'.repeat(499_999)
    const body = { data: { content } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(200, body)))

    await extractContent(makeEnv(), 'item-3', 'https://example.com')

    const extra = updateItemStatusSpy.mock.calls[1][3] as { content: string; content_length: number }
    expect(extra.content).toHaveLength(499_999)
    expect(extra.content_length).toBe(499_999)
  })

  it('内容超过 500,000 字节时截断到恰好 500,000', async () => {
    const content = 'b'.repeat(600_000)
    const body = { data: { content } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(200, body)))

    await extractContent(makeEnv(), 'item-4', 'https://example.com')

    const extra = updateItemStatusSpy.mock.calls[1][3] as { content: string; content_length: number }
    expect(extra.content).toHaveLength(500_000)
    expect(extra.content_length).toBe(500_000)
  })

  it('内容恰好等于 500,000 字节时不截断', async () => {
    const content = 'c'.repeat(500_000)
    const body = { data: { content } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(200, body)))

    await extractContent(makeEnv(), 'item-5', 'https://example.com')

    const extra = updateItemStatusSpy.mock.calls[1][3] as { content: string; content_length: number }
    expect(extra.content).toHaveLength(500_000)
    expect(extra.content_length).toBe(500_000)
  })

  it('data.data.content 缺失时写入空字符串', async () => {
    const body = { data: { title: 'Only title' } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(200, body)))

    await extractContent(makeEnv(), 'item-6', 'https://example.com')

    const extra = updateItemStatusSpy.mock.calls[1][3] as { content: string; content_length: number }
    expect(extra.content).toBe('')
    expect(extra.content_length).toBe(0)
  })

  it('data.data 整个缺失时写入空字符串', async () => {
    const body = {}
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(200, body)))

    await extractContent(makeEnv(), 'item-7', 'https://example.com')

    const extra = updateItemStatusSpy.mock.calls[1][3] as { content: string; content_length: number }
    expect(extra.content).toBe('')
    expect(extra.content_length).toBe(0)
  })

  it('Jina title 字段被忽略，不传入 updateItemStatus', async () => {
    const body = { data: { content: 'text', title: 'My Title' } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(200, body)))

    await extractContent(makeEnv(), 'item-8', 'https://example.com')

    const extra = updateItemStatusSpy.mock.calls[1][3] as Record<string, unknown>
    expect(extra).not.toHaveProperty('title')
  })
})

// ---------------------------------------------------------------------------
// API Key 头部
// ---------------------------------------------------------------------------

describe('JINA_API_KEY 头部处理', () => {
  it('有 JINA_API_KEY 时请求头携带 Authorization: Bearer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { data: { content: '' } }))
    vi.stubGlobal('fetch', fetchMock)

    const env = makeEnv({ JINA_API_KEY: 'my-secret-key' })
    await extractContent(env, 'item-9', 'https://example.com')

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((options.headers as Record<string, string>)['Authorization']).toBe('Bearer my-secret-key')
  })

  it('JINA_API_KEY 为空字符串时不携带 Authorization 头', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { data: { content: '' } }))
    vi.stubGlobal('fetch', fetchMock)

    const env = makeEnv({ JINA_API_KEY: '' })
    await extractContent(env, 'item-10', 'https://example.com')

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((options.headers as Record<string, string>)['Authorization']).toBeUndefined()
  })

  it('请求头始终包含 Accept 和 X-Return-Format', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { data: { content: '' } }))
    vi.stubGlobal('fetch', fetchMock)

    await extractContent(makeEnv(), 'item-11', 'https://example.com')

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = options.headers as Record<string, string>
    expect(headers['Accept']).toBe('application/json')
    expect(headers['X-Return-Format']).toBe('markdown')
    expect(headers['X-Timeout']).toBe('15')
  })
})

// ---------------------------------------------------------------------------
// Jina URL 构建
// ---------------------------------------------------------------------------

describe('Jina URL 构建', () => {
  it('对目标 URL 进行 encodeURIComponent 拼接', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { data: { content: '' } }))
    vi.stubGlobal('fetch', fetchMock)

    const targetUrl = 'https://example.com/path?a=1&b=2'
    await extractContent(makeEnv(), 'item-12', targetUrl)

    const [calledUrl] = fetchMock.mock.calls[0] as [string]
    expect(calledUrl).toBe(`https://r.jina.ai/${encodeURIComponent(targetUrl)}`)
  })

  it('含中文字符的 URL 被正确编码', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { data: { content: '' } }))
    vi.stubGlobal('fetch', fetchMock)

    const targetUrl = 'https://example.com/文章/标题'
    await extractContent(makeEnv(), 'item-13', targetUrl)

    const [calledUrl] = fetchMock.mock.calls[0] as [string]
    expect(calledUrl).toBe(`https://r.jina.ai/${encodeURIComponent(targetUrl)}`)
  })
})

// ---------------------------------------------------------------------------
// 永久失败路径（HTTP 403 / 404）
// ---------------------------------------------------------------------------

describe('永久失败路径（403 / 404）', () => {
  it('HTTP 404 置为 permanently_failed，写入错误信息', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(404, {}, false)))

    await extractContent(makeEnv(), 'item-14', 'https://example.com')

    expect(updateItemStatusSpy).toHaveBeenCalledTimes(2)
    expect(updateItemStatusSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'item-14',
      'permanently_failed',
      { last_error: 'HTTP 404 from Jina' },
    )
  })

  it('HTTP 403 置为 permanently_failed，写入错误信息', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(403, {}, false)))

    await extractContent(makeEnv(), 'item-15', 'https://example.com')

    expect(updateItemStatusSpy).toHaveBeenCalledTimes(2)
    expect(updateItemStatusSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'item-15',
      'permanently_failed',
      { last_error: 'HTTP 403 from Jina' },
    )
  })

  it('404 路径中不查询 retry_count', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(404, {}, false)))

    const env = makeEnv()
    await extractContent(env, 'item-16', 'https://example.com')

    const db = env.DB as ReturnType<typeof makeD1First>
    expect(db.prepare).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 可重试失败路径（HTTP 5xx）
// ---------------------------------------------------------------------------

describe('可重试失败路径（HTTP 5xx）', () => {
  it('HTTP 500 且 retry_count=0 时置为 failed，写入 retry_count=1', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(500, {}, false)))

    const env = makeEnv({
      DB: makeD1First({ retry_count: 0 }) as unknown as D1Database,
    })
    await extractContent(env, 'item-17', 'https://example.com')

    expect(updateItemStatusSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'item-17',
      'failed',
      expect.objectContaining({ retry_count: 1, last_error: 'Jina HTTP 500' }),
    )
  })

  it('HTTP 500 且 retry_count=1 时置为 failed，写入 retry_count=2', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(500, {}, false)))

    const env = makeEnv({
      DB: makeD1First({ retry_count: 1 }) as unknown as D1Database,
    })
    await extractContent(env, 'item-18', 'https://example.com')

    expect(updateItemStatusSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'item-18',
      'failed',
      expect.objectContaining({ retry_count: 2 }),
    )
  })

  it('HTTP 500 且 retry_count=2 时置为 permanently_failed，写入 retry_count=3', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(500, {}, false)))

    const env = makeEnv({
      DB: makeD1First({ retry_count: 2 }) as unknown as D1Database,
    })
    await extractContent(env, 'item-19', 'https://example.com')

    expect(updateItemStatusSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'item-19',
      'permanently_failed',
      expect.objectContaining({ retry_count: 3 }),
    )
  })

  it('数据库中 retry_count 为 null 时降级为 0，写入 retry_count=1', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(500, {}, false)))

    const env = makeEnv({
      DB: makeD1First({ retry_count: null }) as unknown as D1Database,
    })
    await extractContent(env, 'item-20', 'https://example.com')

    expect(updateItemStatusSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'item-20',
      'failed',
      expect.objectContaining({ retry_count: 1 }),
    )
  })

  it('数据库中 item 不存在（first 返回 null）时 retry_count 从 0 开始', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(500, {}, false)))

    const env = makeEnv({
      DB: makeD1First(null) as unknown as D1Database,
    })
    await extractContent(env, 'item-21', 'https://example.com')

    expect(updateItemStatusSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'item-21',
      'failed',
      expect.objectContaining({ retry_count: 1 }),
    )
  })

  it('失败时错误信息来自 Error.message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(503, {}, false)))

    const env = makeEnv({
      DB: makeD1First({ retry_count: 0 }) as unknown as D1Database,
    })
    await extractContent(env, 'item-22', 'https://example.com')

    const extra = updateItemStatusSpy.mock.calls[1][3] as { last_error: string }
    expect(extra.last_error).toBe('Jina HTTP 503')
  })
})

// ---------------------------------------------------------------------------
// 网络错误路径
// ---------------------------------------------------------------------------

describe('网络错误路径', () => {
  it('fetch 抛出 TypeError（网络断开）时 retry_count 正常累加', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const env = makeEnv({
      DB: makeD1First({ retry_count: 0 }) as unknown as D1Database,
    })
    await extractContent(env, 'item-23', 'https://example.com')

    expect(updateItemStatusSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'item-23',
      'failed',
      expect.objectContaining({
        last_error: 'Failed to fetch',
        retry_count: 1,
      }),
    )
  })

  it('fetch 抛出非 Error 对象时错误信息被 String() 转换', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('some string error'))

    const env = makeEnv({
      DB: makeD1First({ retry_count: 0 }) as unknown as D1Database,
    })
    await extractContent(env, 'item-24', 'https://example.com')

    const extra = updateItemStatusSpy.mock.calls[1][3] as { last_error: string }
    expect(extra.last_error).toBe('some string error')
  })

  it('fetch 超时（AbortError）时 retry_count 正常累加', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))

    const env = makeEnv({
      DB: makeD1First({ retry_count: 0 }) as unknown as D1Database,
    })
    await extractContent(env, 'item-25', 'https://example.com')

    expect(updateItemStatusSpy).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'item-25',
      'failed',
      expect.objectContaining({ retry_count: 1 }),
    )
    const extra = updateItemStatusSpy.mock.calls[1][3] as { last_error: string }
    expect(extra.last_error).toContain('aborted')
  })

  it('extractContent 本身不抛出异常（所有错误被内部吞掉）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('catastrophic')))

    const env = makeEnv({
      DB: makeD1First({ retry_count: 0 }) as unknown as D1Database,
    })
    await expect(extractContent(env, 'item-26', 'https://example.com')).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 状态机顺序验证
// ---------------------------------------------------------------------------

describe('状态机调用顺序', () => {
  it('成功路径：extracting 必须在 extracted 之前调用', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(200, { data: { content: 'ok' } })))

    const callOrder: string[] = []
    updateItemStatusSpy.mockImplementation(async (_db, _id, status) => {
      callOrder.push(status as string)
    })

    await extractContent(makeEnv(), 'item-27', 'https://example.com')

    expect(callOrder).toEqual(['extracting', 'extracted'])
  })

  it('404 路径：extracting 必须在 permanently_failed 之前调用', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(404, {}, false)))

    const callOrder: string[] = []
    updateItemStatusSpy.mockImplementation(async (_db, _id, status) => {
      callOrder.push(status as string)
    })

    await extractContent(makeEnv(), 'item-28', 'https://example.com')

    expect(callOrder).toEqual(['extracting', 'permanently_failed'])
  })

  it('HTTP 500 路径：extracting 必须在 failed 之前调用', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(500, {}, false)))

    const callOrder: string[] = []
    updateItemStatusSpy.mockImplementation(async (_db, _id, status) => {
      callOrder.push(status as string)
    })

    const env = makeEnv({
      DB: makeD1First({ retry_count: 0 }) as unknown as D1Database,
    })
    await extractContent(env, 'item-29', 'https://example.com')

    expect(callOrder).toEqual(['extracting', 'failed'])
  })
})

// ---------------------------------------------------------------------------
// Bug 验证：404 路径的 clearTimeout 缺失
// ---------------------------------------------------------------------------

describe('已知问题：404/403 路径 clearTimeout 缺失', () => {
  it('404 响应后函数正常返回（不因 timer 残留而挂起）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(404, {}, false)))

    // 如果 timer 影响异步执行，此 promise 不会在合理时间内 resolve
    await expect(
      Promise.race([
        extractContent(makeEnv(), 'item-30', 'https://example.com'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout: 404 path hung')), 1000),
        ),
      ]),
    ).resolves.toBeUndefined()
  })
})
