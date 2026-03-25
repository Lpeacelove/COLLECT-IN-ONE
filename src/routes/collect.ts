import { Hono } from 'hono'
import { Env, CollectRequest } from '../types'
import { normalizeUrl, hashUrl } from '../services/url'
import { findItemByHash, insertItem } from '../db/queries'
import { extractContent } from '../services/extractor'

const app = new Hono<{ Bindings: Env }>()

app.post('/', async (c) => {
  let body: CollectRequest
  try {
    body = await c.req.json<CollectRequest>()
  } catch {
    return c.json({ ok: false, error: 'invalid_json' }, 400)
  }

  const { url, title, excerpt, source = 'api', tags } = body

  if (!url || typeof url !== 'string') {
    return c.json({ ok: false, error: 'url is required' }, 400)
  }

  const normalized = normalizeUrl(url)
  const urlHash = await hashUrl(normalized)

  // 去重检查
  const existing = await findItemByHash(c.env.DB, urlHash)
  if (existing) {
    return c.json({ ok: false, error: 'duplicate', existing_item_id: existing.id }, 409)
  }

  // 生成 ID
  const id = crypto.randomUUID().replace(/-/g, '')

  await insertItem(c.env.DB, {
    id,
    url: normalized,
    url_hash: urlHash,
    title: title ?? null,
    excerpt: excerpt ?? null,
    source,
    tags: tags ? JSON.stringify(tags) : null,
  })

  // 异步触发内容提取，不阻塞响应
  // 测试环境中不存在 ExecutionContext，由 Cron 重试 pending 条目兜底
  try {
    c.executionCtx.waitUntil(extractContent(c.env, id, normalized))
  } catch {
    // no-op
  }

  return c.json(
    {
      ok: true,
      item: {
        id,
        url: normalized,
        status: 'pending',
        created_at: new Date().toISOString(),
      },
    },
    201
  )
})

export default app
