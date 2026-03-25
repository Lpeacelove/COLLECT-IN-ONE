import { Context, Next } from 'hono'
import { Env } from '../types'

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> {
  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ ok: false, error: 'unauthorized' }, 401)
  }

  const token = authHeader.slice(7)
  // 常量时间比较，防止时序攻击
  const expected = c.env.API_KEY
  if (!expected || token.length !== expected.length) {
    return c.json({ ok: false, error: 'unauthorized' }, 401)
  }

  let mismatch = 0
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  if (mismatch !== 0) {
    return c.json({ ok: false, error: 'unauthorized' }, 401)
  }

  await next()
}
