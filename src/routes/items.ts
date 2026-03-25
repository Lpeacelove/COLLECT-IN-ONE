import { Hono } from 'hono'
import { Env, ItemStatus, ItemSource } from '../types'
import { listItems, getItemById, deleteItem, updateItemStatus } from '../db/queries'

const app = new Hono<{ Bindings: Env }>()

// 列表查询
app.get('/', async (c) => {
  const { status, source, since, until, limit, offset } = c.req.query()

  const result = await listItems(c.env.DB, {
    status: status as ItemStatus | undefined,
    source: source as ItemSource | undefined,
    since,
    until,
    limit: limit ? parseInt(limit, 10) : undefined,
    offset: offset ? parseInt(offset, 10) : undefined,
  })

  return c.json({
    ok: true,
    ...result,
    limit: Math.min(parseInt(limit ?? '50', 10), 200),
    offset: parseInt(offset ?? '0', 10),
  })
})

// 条目详情
app.get('/:id', async (c) => {
  const item = await getItemById(c.env.DB, c.req.param('id'))
  if (!item) {
    return c.json({ ok: false, error: 'not_found' }, 404)
  }
  return c.json({ ok: true, item })
})

// 删除条目
app.delete('/:id', async (c) => {
  const deleted = await deleteItem(c.env.DB, c.req.param('id'))
  if (!deleted) {
    return c.json({ ok: false, error: 'not_found' }, 404)
  }
  return c.json({ ok: true, deleted: c.req.param('id') })
})

// 手动重试失败提取
app.post('/:id/retry', async (c) => {
  const item = await getItemById(c.env.DB, c.req.param('id'))
  if (!item) {
    return c.json({ ok: false, error: 'not_found' }, 404)
  }
  if (!['failed', 'permanently_failed'].includes(item.status)) {
    return c.json({ ok: false, error: 'item_not_failed' }, 400)
  }

  await updateItemStatus(c.env.DB, item.id, 'pending', { retry_count: 0, last_error: null as unknown as undefined })

  const { extractContent } = await import('../services/extractor')
  c.executionCtx.waitUntil(extractContent(c.env, item.id, item.url))

  return c.json({ ok: true, item_id: item.id, status: 'pending' })
})

export default app
