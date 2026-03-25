import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest'
import { summarizeItems } from '../../src/services/summarizer'
import * as queries from '../../src/db/queries'
import type { Env, Item } from '../../src/types'

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    API_KEY: 'test-api-key',
    DEEPSEEK_API_KEY: 'deepseek-key',
    JINA_API_KEY: 'jina-key',
    FEISHU_WEBHOOK_URL: 'https://feishu.example.com/webhook',
    ...overrides,
  }
}

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-1',
    url: 'https://example.com',
    url_hash: 'hash',
    title: '测试文章',
    excerpt: null,
    source: 'api',
    tags: null,
    status: 'extracted',
    content: '文章内容示例',
    content_length: 6,
    summary: null,
    retry_count: 0,
    last_error: null,
    created_at: '2024-01-01T00:00:00Z',
    extracted_at: '2024-01-01T00:01:00Z',
    summarized_at: null,
    delivered_at: null,
    updated_at: '2024-01-01T00:01:00Z',
    ...overrides,
  }
}

function makeDeepSeekResponse(status: number, body: unknown, ok?: boolean): Response {
  return {
    status,
    ok: ok ?? (status >= 200 && status < 300),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response
}

function makeDeepSeekBody(
  summaries: Array<{ id: string; title: string; summary: string }>,
  overall: string,
): unknown {
  return {
    choices: [{ message: { content: JSON.stringify({ summaries, overall }) } }],
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let getExtractedItemsSpy: MockInstance
let batchUpdateStatusSpy: MockInstance
let insertDigestSpy: MockInstance
let insertDigestItemsSpy: MockInstance

beforeEach(() => {
  vi.restoreAllMocks()
  getExtractedItemsSpy = vi.spyOn(queries, 'getExtractedItems').mockResolvedValue([])
  batchUpdateStatusSpy = vi.spyOn(queries, 'batchUpdateStatus').mockResolvedValue(undefined)
  insertDigestSpy = vi.spyOn(queries, 'insertDigest').mockResolvedValue(undefined)
  insertDigestItemsSpy = vi.spyOn(queries, 'insertDigestItems').mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// 无 items 时短路
// ---------------------------------------------------------------------------

describe('无 extracted items 时', () => {
  it('返回 null', async () => {
    const result = await summarizeItems(makeEnv())
    expect(result).toBeNull()
  })

  it('不调用 DeepSeek API', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await summarizeItems(makeEnv())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('不写入数据库', async () => {
    await summarizeItems(makeEnv())
    expect(insertDigestSpy).not.toHaveBeenCalled()
    expect(batchUpdateStatusSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 正常路径
// ---------------------------------------------------------------------------

describe('正常总结路径', () => {
  it('有 items 时先将 items 置为 summarizing', async () => {
    const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' })]
    getExtractedItemsSpy.mockResolvedValue(items)

    const body = makeDeepSeekBody(
      [
        { id: 'a', title: '文章A', summary: '摘要A' },
        { id: 'b', title: '文章B', summary: '摘要B' },
      ],
      '整体总结',
    )
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeDeepSeekResponse(200, body)))

    await summarizeItems(makeEnv())

    expect(batchUpdateStatusSpy).toHaveBeenCalledWith(
      expect.anything(),
      ['a', 'b'],
      'summarizing',
    )
  })

  it('成功后将 items 置为 summarized', async () => {
    const items = [makeItem({ id: 'item-x' })]
    getExtractedItemsSpy.mockResolvedValue(items)

    const body = makeDeepSeekBody([{ id: 'item-x', title: '文章', summary: '摘要' }], '整体')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeDeepSeekResponse(200, body)))

    await summarizeItems(makeEnv())

    const calls = batchUpdateStatusSpy.mock.calls as unknown[][]
    const summarizedCall = calls.find(c => c[2] === 'summarized')
    expect(summarizedCall).toBeDefined()
    expect(summarizedCall![1]).toEqual(['item-x'])
  })

  it('summarized 调用携带 summarized_at', async () => {
    const items = [makeItem()]
    getExtractedItemsSpy.mockResolvedValue(items)

    const body = makeDeepSeekBody([{ id: 'item-1', title: '文章', summary: '摘要' }], '整体')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeDeepSeekResponse(200, body)))

    await summarizeItems(makeEnv())

    const calls = batchUpdateStatusSpy.mock.calls as unknown[][]
    const summarizedCall = calls.find(c => c[2] === 'summarized')
    expect(summarizedCall![3]).toMatchObject({ summarized_at: expect.any(String) })
  })

  it('成功后写入 digest 记录（含 summary_overview 和 item_count）', async () => {
    const items = [makeItem()]
    getExtractedItemsSpy.mockResolvedValue(items)

    const body = makeDeepSeekBody(
      [{ id: 'item-1', title: '文章', summary: '摘要' }],
      '今日整体总结内容',
    )
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeDeepSeekResponse(200, body)))

    await summarizeItems(makeEnv())

    expect(insertDigestSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        summary_overview: '今日整体总结内容',
        item_count: 1,
      }),
    )
  })

  it('成功后写入 digest_items 关联', async () => {
    const items = [makeItem({ id: 'item-1' })]
    getExtractedItemsSpy.mockResolvedValue(items)

    const body = makeDeepSeekBody([{ id: 'item-1', title: '文章', summary: '摘要' }], '整体')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeDeepSeekResponse(200, body)))

    await summarizeItems(makeEnv())

    expect(insertDigestItemsSpy).toHaveBeenCalled()
  })

  it('返回的 DigestPayload 包含 overall', async () => {
    const items = [makeItem()]
    getExtractedItemsSpy.mockResolvedValue(items)

    const body = makeDeepSeekBody(
      [{ id: 'item-1', title: '文章', summary: '摘要内容' }],
      '今日整体摘要',
    )
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeDeepSeekResponse(200, body)))

    const result = await summarizeItems(makeEnv())

    expect(result).not.toBeNull()
    expect(result!.overall).toBe('今日整体摘要')
  })

  it('返回的 DigestPayload items 包含来自 DeepSeek 的 summary', async () => {
    const items = [makeItem({ id: 'item-1', url: 'https://example.com', title: '文章' })]
    getExtractedItemsSpy.mockResolvedValue(items)

    const body = makeDeepSeekBody(
      [{ id: 'item-1', title: '文章', summary: '这是 DeepSeek 生成的摘要' }],
      '整体',
    )
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeDeepSeekResponse(200, body)))

    const result = await summarizeItems(makeEnv())

    expect(result!.items).toHaveLength(1)
    expect(result!.items[0].summary).toBe('这是 DeepSeek 生成的摘要')
    expect(result!.items[0].url).toBe('https://example.com')
  })

  it('返回的 DigestPayload.id 非空', async () => {
    const items = [makeItem()]
    getExtractedItemsSpy.mockResolvedValue(items)

    const body = makeDeepSeekBody([{ id: 'item-1', title: '文章', summary: '摘要' }], '整体')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeDeepSeekResponse(200, body)))

    const result = await summarizeItems(makeEnv())
    expect(result!.id).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// DeepSeek API 请求格式
// ---------------------------------------------------------------------------

describe('DeepSeek API 请求格式', () => {
  it('请求头携带 Authorization: Bearer', async () => {
    const items = [makeItem()]
    getExtractedItemsSpy.mockResolvedValue(items)

    const body = makeDeepSeekBody([{ id: 'item-1', title: '文章', summary: '摘要' }], '整体')
    const fetchMock = vi.fn().mockResolvedValue(makeDeepSeekResponse(200, body))
    vi.stubGlobal('fetch', fetchMock)

    await summarizeItems(makeEnv({ DEEPSEEK_API_KEY: 'my-ds-key' }))

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((options.headers as Record<string, string>)['Authorization']).toBe('Bearer my-ds-key')
  })

  it('POST 到 DeepSeek API endpoint', async () => {
    const items = [makeItem()]
    getExtractedItemsSpy.mockResolvedValue(items)

    const body = makeDeepSeekBody([{ id: 'item-1', title: '文章', summary: '摘要' }], '整体')
    const fetchMock = vi.fn().mockResolvedValue(makeDeepSeekResponse(200, body))
    vi.stubGlobal('fetch', fetchMock)

    await summarizeItems(makeEnv())

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('deepseek.com')
    expect(options.method).toBe('POST')
  })

  it('请求体包含 deepseek-chat model', async () => {
    const items = [makeItem()]
    getExtractedItemsSpy.mockResolvedValue(items)

    const body = makeDeepSeekBody([{ id: 'item-1', title: '文章', summary: '摘要' }], '整体')
    const fetchMock = vi.fn().mockResolvedValue(makeDeepSeekResponse(200, body))
    vi.stubGlobal('fetch', fetchMock)

    await summarizeItems(makeEnv())

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const reqBody = JSON.parse(options.body as string)
    expect(reqBody.model).toBe('deepseek-chat')
  })
})

// ---------------------------------------------------------------------------
// 错误路径
// ---------------------------------------------------------------------------

describe('错误路径', () => {
  it('DeepSeek API 返回非 200 时抛出错误', async () => {
    const items = [makeItem()]
    getExtractedItemsSpy.mockResolvedValue(items)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeDeepSeekResponse(500, {}, false)))

    await expect(summarizeItems(makeEnv())).rejects.toThrow()
  })

  it('DeepSeek 返回无效 JSON 时抛出错误', async () => {
    const items = [makeItem()]
    getExtractedItemsSpy.mockResolvedValue(items)

    const badBody = { choices: [{ message: { content: 'not-a-json-object' } }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeDeepSeekResponse(200, badBody)))

    await expect(summarizeItems(makeEnv())).rejects.toThrow()
  })

  it('fetch 网络错误时抛出错误', async () => {
    const items = [makeItem()]
    getExtractedItemsSpy.mockResolvedValue(items)

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')))

    await expect(summarizeItems(makeEnv())).rejects.toThrow('network error')
  })

  it('DeepSeek 响应缺少 summaries 字段时抛出错误', async () => {
    const items = [makeItem()]
    getExtractedItemsSpy.mockResolvedValue(items)

    const badBody = { choices: [{ message: { content: '{"overall": "仅有overall"}' } }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeDeepSeekResponse(200, badBody)))

    await expect(summarizeItems(makeEnv())).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 状态机调用顺序
// ---------------------------------------------------------------------------

describe('状态机调用顺序', () => {
  it('summarizing 在 summarized 之前调用', async () => {
    const items = [makeItem()]
    getExtractedItemsSpy.mockResolvedValue(items)

    const body = makeDeepSeekBody([{ id: 'item-1', title: '文章', summary: '摘要' }], '整体')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeDeepSeekResponse(200, body)))

    const callOrder: string[] = []
    batchUpdateStatusSpy.mockImplementation(async (_db: unknown, _ids: unknown, status: string) => {
      callOrder.push(status)
    })

    await summarizeItems(makeEnv())

    expect(callOrder[0]).toBe('summarizing')
    expect(callOrder[callOrder.length - 1]).toBe('summarized')
  })
})
