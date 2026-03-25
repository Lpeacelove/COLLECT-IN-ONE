import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { authMiddleware } from '../../src/middleware/auth'
import type { Env } from '../../src/types'

// 构造带 API_KEY 的测试 App
function buildApp(apiKey: string) {
  const app = new Hono<{ Bindings: Env }>()
  app.use('*', authMiddleware)
  app.get('/test', (c) => c.json({ ok: true }))
  return app
}

async function request(app: ReturnType<typeof buildApp>, apiKey: string, authHeader?: string) {
  return app.request('/test', {
    headers: authHeader !== undefined ? { Authorization: authHeader } : {},
  }, { API_KEY: apiKey } as unknown as Env)
}

describe('authMiddleware', () => {
  const KEY = 'a'.repeat(64)

  it('正确 Bearer Token 通过鉴权', async () => {
    const app = buildApp(KEY)
    const res = await request(app, KEY, `Bearer ${KEY}`)
    expect(res.status).toBe(200)
  })

  it('错误 Token 返回 401', async () => {
    const app = buildApp(KEY)
    const res = await request(app, KEY, `Bearer ${'b'.repeat(64)}`)
    expect(res.status).toBe(401)
    const body = await res.json<{ ok: boolean; error: string }>()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('unauthorized')
  })

  it('缺少 Authorization 头返回 401', async () => {
    const app = buildApp(KEY)
    const res = await request(app, KEY)
    expect(res.status).toBe(401)
  })

  it('格式错误（非 Bearer）返回 401', async () => {
    const app = buildApp(KEY)
    const res = await request(app, KEY, `Token ${KEY}`)
    expect(res.status).toBe(401)
  })

  it('长度不匹配的 Token 返回 401', async () => {
    const app = buildApp(KEY)
    const res = await request(app, KEY, 'Bearer short')
    expect(res.status).toBe(401)
  })
})
