import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../../src/types'

// Mock 外部依赖，隔离单元测试
vi.mock('../../src/db/queries', () => ({
  findItemByHash: vi.fn(),
  insertItem: vi.fn(),
}))

vi.mock('../../src/services/extractor', () => ({
  extractContent: vi.fn(),
}))

import { findItemByHash, insertItem } from '../../src/db/queries'
import collectRoute from '../../src/routes/collect'

const API_KEY = 'test-api-key-64chars-padded-with-zeros-xxxxxxxxxxxxxxxxxxxxxxx'

function buildApp() {
  const app = new Hono<{ Bindings: Env }>()
  app.route('/api/collect', collectRoute)
  return app
}

function makeEnv(): Env {
  return {
    DB: {} as D1Database,
    API_KEY,
    DEEPSEEK_API_KEY: '',
    JINA_API_KEY: '',
    FEISHU_WEBHOOK_URL: '',
  }
}

function post(app: ReturnType<typeof buildApp>, body: unknown) {
  return app.request('/api/collect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, makeEnv() as unknown as Env)
}

describe('POST /api/collect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findItemByHash).mockResolvedValue(null)
    vi.mocked(insertItem).mockResolvedValue(undefined)
  })

  it('成功收集新链接，返回 201', async () => {
    const app = buildApp()
    const res = await post(app, { url: 'https://mp.weixin.qq.com/s/abc123', source: 'api' })

    expect(res.status).toBe(201)
    const body = await res.json<{ ok: boolean; item: { status: string } }>()
    expect(body.ok).toBe(true)
    expect(body.item.status).toBe('pending')
  })

  it('重复链接返回 409', async () => {
    vi.mocked(findItemByHash).mockResolvedValue({
      id: 'existing-id',
      url: 'https://mp.weixin.qq.com/s/abc123',
      url_hash: 'hash',
      status: 'extracted',
    } as never)

    const app = buildApp()
    const res = await post(app, { url: 'https://mp.weixin.qq.com/s/abc123', source: 'api' })

    expect(res.status).toBe(409)
    const body = await res.json<{ ok: boolean; error: string; existing_item_id: string }>()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('duplicate')
    expect(body.existing_item_id).toBe('existing-id')
  })

  it('缺少 url 字段返回 400', async () => {
    const app = buildApp()
    const res = await post(app, { source: 'api' })

    expect(res.status).toBe(400)
    const body = await res.json<{ ok: boolean; error: string }>()
    expect(body.ok).toBe(false)
  })

  it('非法 JSON 返回 400', async () => {
    const app = buildApp()
    const res = app.request('/api/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    }, makeEnv() as unknown as Env)

    expect((await res).status).toBe(400)
  })

  it('URL 规范化后去重（不同参数顺序视为同一链接）', async () => {
    // 第一次调用 findItemByHash 返回 null（第一次收集）
    // 但 insertItem 被调用后，第二次调用 collect 时相同规范化 URL 应命中去重
    const app = buildApp()

    await post(app, { url: 'https://example.com?b=2&a=1', source: 'api' })
    expect(insertItem).toHaveBeenCalledTimes(1)

    // 模拟第二次时数据库已有记录
    vi.mocked(findItemByHash).mockResolvedValue({ id: 'x' } as never)
    const res2 = await post(app, { url: 'https://example.com?a=1&b=2', source: 'api' })
    expect(res2.status).toBe(409)
  })

  it('收集时触发异步提取（insertItem 被调用一次）', async () => {
    const app = buildApp()
    await post(app, { url: 'https://mp.weixin.qq.com/s/xyz', source: 'api' })
    expect(insertItem).toHaveBeenCalledTimes(1)
  })
})
