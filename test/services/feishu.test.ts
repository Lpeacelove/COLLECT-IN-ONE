import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendDigestToFeishu } from '../../src/services/feishu'
import type { Env, DigestPayload } from '../../src/types'

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

function makeDigest(overrides: Partial<DigestPayload> = {}): DigestPayload {
  return {
    id: 'digest-1',
    overall: '今日整体总结',
    date: '2024-01-01',
    items: [
      { id: 'item-1', title: '文章一', url: 'https://example.com/1', summary: '摘要一' },
      { id: 'item-2', title: '文章二', url: 'https://example.com/2', summary: '摘要二' },
    ],
    ...overrides,
  }
}

function makeFetchResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// 正常推送路径
// ---------------------------------------------------------------------------

describe('正常推送路径', () => {
  it('POST 到 FEISHU_WEBHOOK_URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { code: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    await sendDigestToFeishu(makeEnv(), makeDigest())

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://feishu.example.com/webhook')
    expect(options.method).toBe('POST')
  })

  it('请求 Content-Type 为 application/json', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { code: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    await sendDigestToFeishu(makeEnv(), makeDigest())

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('消息体 msg_type 为 interactive', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { code: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    await sendDigestToFeishu(makeEnv(), makeDigest())

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.msg_type).toBe('interactive')
  })

  it('卡片 header 包含日期', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { code: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    await sendDigestToFeishu(makeEnv(), makeDigest({ date: '2024-03-15' }))

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.card.header.title.content).toContain('2024-03-15')
  })

  it('卡片 elements 包含整体总结内容', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { code: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    await sendDigestToFeishu(makeEnv(), makeDigest({ overall: '今天的内容非常有价值' }))

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    const elements = body.card.elements as Array<{ tag: string; content?: string }>
    const allContent = elements.map(e => e.content ?? '').join('')
    expect(allContent).toContain('今天的内容非常有价值')
  })

  it('卡片 elements 包含所有文章标题', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { code: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    await sendDigestToFeishu(makeEnv(), makeDigest())

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    const elements = body.card.elements as Array<{ tag: string; content?: string }>
    const allContent = elements.map(e => e.content ?? '').join('')
    expect(allContent).toContain('文章一')
    expect(allContent).toContain('文章二')
  })

  it('卡片 elements 包含所有文章摘要', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { code: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    await sendDigestToFeishu(makeEnv(), makeDigest())

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    const elements = body.card.elements as Array<{ tag: string; content?: string }>
    const allContent = elements.map(e => e.content ?? '').join('')
    expect(allContent).toContain('摘要一')
    expect(allContent).toContain('摘要二')
  })

  it('卡片底部 note 包含文章数量', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(200, { code: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    await sendDigestToFeishu(makeEnv(), makeDigest())

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    const elements = body.card.elements as Array<{
      tag: string
      elements?: Array<{ content?: string }>
    }>
    const noteEl = elements.find(e => e.tag === 'note')
    expect(noteEl).toBeDefined()
    const noteContent = noteEl!.elements?.map(e => e.content ?? '').join('') ?? ''
    expect(noteContent).toContain('2')
  })

  it('成功时不抛出错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(200, { code: 0 })))

    await expect(sendDigestToFeishu(makeEnv(), makeDigest())).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 错误路径
// ---------------------------------------------------------------------------

describe('错误路径', () => {
  it('飞书返回 code 非 0 时抛出错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeFetchResponse(200, { code: 19001, msg: 'invalid webhook' })),
    )

    await expect(sendDigestToFeishu(makeEnv(), makeDigest())).rejects.toThrow()
  })

  it('HTTP 非 200 时抛出错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(500, {})))

    await expect(sendDigestToFeishu(makeEnv(), makeDigest())).rejects.toThrow()
  })

  it('FEISHU_WEBHOOK_URL 为空时抛出错误（不发请求）', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      sendDigestToFeishu(makeEnv({ FEISHU_WEBHOOK_URL: '' }), makeDigest()),
    ).rejects.toThrow()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetch 抛出异常时向上传播', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    await expect(sendDigestToFeishu(makeEnv(), makeDigest())).rejects.toThrow('network down')
  })
})
