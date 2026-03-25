import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../../src/types'
import * as pipeline from '../../src/services/pipeline'
import digestRoute from '../../src/routes/digest'
import { authMiddleware } from '../../src/middleware/auth'

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    API_KEY: 'test-key',
    DEEPSEEK_API_KEY: 'deepseek-key',
    JINA_API_KEY: '',
    FEISHU_WEBHOOK_URL: 'https://feishu.example.com/webhook',
    ...overrides,
  }
}

function makeApp() {
  const app = new Hono<{ Bindings: Env }>()
  app.use('*', authMiddleware)
  app.route('/', digestRoute)
  return app
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// 认证检查
// ---------------------------------------------------------------------------

describe('认证检查', () => {
  it('无 Authorization 头时返回 401', async () => {
    const app = makeApp()
    const res = await app.request('/', { method: 'POST' }, makeEnv())
    expect(res.status).toBe(401)
  })

  it('错误 Token 时返回 401', async () => {
    const app = makeApp()
    const res = await app.request(
      '/',
      { method: 'POST', headers: { Authorization: 'Bearer wrong-key' } },
      makeEnv(),
    )
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// 正常触发
// ---------------------------------------------------------------------------

describe('POST / 触发成功', () => {
  it('pipeline 成功时返回 200', async () => {
    vi.spyOn(pipeline, 'runDigestPipeline').mockResolvedValue({
      ok: true,
      digest_id: 'abc123',
      item_count: 3,
    })
    const app = makeApp()
    const res = await app.request(
      '/',
      { method: 'POST', headers: { Authorization: 'Bearer test-key' } },
      makeEnv(),
    )
    expect(res.status).toBe(200)
  })

  it('pipeline 成功时响应体包含 ok: true', async () => {
    vi.spyOn(pipeline, 'runDigestPipeline').mockResolvedValue({
      ok: true,
      digest_id: 'abc123',
      item_count: 3,
    })
    const app = makeApp()
    const res = await app.request(
      '/',
      { method: 'POST', headers: { Authorization: 'Bearer test-key' } },
      makeEnv(),
    )
    const body = await res.json<{ ok: boolean; digest_id?: string; item_count?: number }>()
    expect(body.ok).toBe(true)
    expect(body.digest_id).toBe('abc123')
    expect(body.item_count).toBe(3)
  })

  it('无 items 时也返回 200', async () => {
    vi.spyOn(pipeline, 'runDigestPipeline').mockResolvedValue({ ok: true })
    const app = makeApp()
    const res = await app.request(
      '/',
      { method: 'POST', headers: { Authorization: 'Bearer test-key' } },
      makeEnv(),
    )
    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// 失败触发
// ---------------------------------------------------------------------------

describe('POST / 触发失败', () => {
  it('pipeline 失败时返回 500', async () => {
    vi.spyOn(pipeline, 'runDigestPipeline').mockResolvedValue({
      ok: false,
      error: 'DeepSeek API error',
    })
    const app = makeApp()
    const res = await app.request(
      '/',
      { method: 'POST', headers: { Authorization: 'Bearer test-key' } },
      makeEnv(),
    )
    expect(res.status).toBe(500)
  })

  it('pipeline 失败时响应体包含 ok: false 和 error', async () => {
    vi.spyOn(pipeline, 'runDigestPipeline').mockResolvedValue({
      ok: false,
      error: 'DeepSeek API error',
    })
    const app = makeApp()
    const res = await app.request(
      '/',
      { method: 'POST', headers: { Authorization: 'Bearer test-key' } },
      makeEnv(),
    )
    const body = await res.json<{ ok: boolean; error?: string }>()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('DeepSeek API error')
  })
})
