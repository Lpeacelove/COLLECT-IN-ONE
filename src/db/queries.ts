import { Item, ItemStatus } from '../types'

// 按 url_hash 查找条目（去重用）
export async function findItemByHash(db: D1Database, urlHash: string): Promise<Item | null> {
  const result = await db
    .prepare('SELECT * FROM items WHERE url_hash = ? LIMIT 1')
    .bind(urlHash)
    .first<Item>()
  return result ?? null
}

// 插入新条目
export async function insertItem(
  db: D1Database,
  item: {
    id: string
    url: string
    url_hash: string
    title: string | null
    excerpt: string | null
    source: string
    tags: string | null
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO items (id, url, url_hash, title, excerpt, source, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(item.id, item.url, item.url_hash, item.title, item.excerpt, item.source, item.tags)
    .run()
}

// 更新条目状态
export async function updateItemStatus(
  db: D1Database,
  id: string,
  status: ItemStatus,
  extra: Partial<Pick<Item, 'content' | 'content_length' | 'extracted_at' | 'last_error' | 'retry_count'>> = {}
): Promise<void> {
  const fields: string[] = ['status = ?', "updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"]
  const values: unknown[] = [status]

  if (extra.content !== undefined) { fields.push('content = ?'); values.push(extra.content) }
  if (extra.content_length !== undefined) { fields.push('content_length = ?'); values.push(extra.content_length) }
  if (extra.extracted_at !== undefined) { fields.push('extracted_at = ?'); values.push(extra.extracted_at) }
  if (extra.last_error !== undefined) { fields.push('last_error = ?'); values.push(extra.last_error) }
  if (extra.retry_count !== undefined) { fields.push('retry_count = ?'); values.push(extra.retry_count) }

  values.push(id)
  await db.prepare(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
}

// 列表查询
export interface ListItemsParams {
  status?: ItemStatus
  source?: string
  since?: string
  until?: string
  limit?: number
  offset?: number
}

export async function listItems(db: D1Database, params: ListItemsParams = {}): Promise<{ items: Item[]; total: number }> {
  const conditions: string[] = []
  const values: unknown[] = []

  if (params.status) { conditions.push('status = ?'); values.push(params.status) }
  if (params.source) { conditions.push('source = ?'); values.push(params.source) }
  if (params.since) { conditions.push('created_at >= ?'); values.push(params.since) }
  if (params.until) { conditions.push('created_at <= ?'); values.push(params.until) }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = Math.min(params.limit ?? 50, 200)
  const offset = params.offset ?? 0

  const [itemsResult, countResult] = await Promise.all([
    db
      .prepare(`SELECT id, url, title, source, status, tags, summary, created_at, updated_at FROM items ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .bind(...values, limit, offset)
      .all<Item>(),
    db
      .prepare(`SELECT COUNT(*) as count FROM items ${where}`)
      .bind(...values)
      .first<{ count: number }>(),
  ])

  return {
    items: itemsResult.results ?? [],
    total: countResult?.count ?? 0,
  }
}

// 按 ID 获取完整条目
export async function getItemById(db: D1Database, id: string): Promise<Item | null> {
  const result = await db.prepare('SELECT * FROM items WHERE id = ? LIMIT 1').bind(id).first<Item>()
  return result ?? null
}

// 删除条目
export async function deleteItem(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM items WHERE id = ?').bind(id).run()
  return (result.meta.changes ?? 0) > 0
}

// 查询待提取的失败条目（Cron 重试用）
export async function getPendingRetryItems(db: D1Database): Promise<Item[]> {
  const result = await db
    .prepare("SELECT * FROM items WHERE status IN ('pending', 'failed') AND retry_count < 3 ORDER BY created_at ASC LIMIT 20")
    .all<Item>()
  return result.results ?? []
}

// 查询已提取待总结的条目
export async function getExtractedItems(db: D1Database): Promise<Item[]> {
  const result = await db
    .prepare("SELECT * FROM items WHERE status = 'extracted' ORDER BY created_at ASC")
    .all<Item>()
  return result.results ?? []
}

// 查询已总结待推送的条目
export async function getSummarizedItems(db: D1Database): Promise<Item[]> {
  const result = await db
    .prepare("SELECT * FROM items WHERE status = 'summarized' ORDER BY created_at ASC")
    .all<Item>()
  return result.results ?? []
}

// 批量更新状态
export async function batchUpdateStatus(
  db: D1Database,
  ids: string[],
  status: ItemStatus,
  extra: Partial<Pick<Item, 'summary' | 'summarized_at' | 'delivered_at'>> = {}
): Promise<void> {
  const placeholders = ids.map(() => '?').join(', ')
  const fields: string[] = ['status = ?', "updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"]
  const values: unknown[] = [status]

  if (extra.summary !== undefined) { fields.push('summary = ?'); values.push(extra.summary) }
  if (extra.summarized_at !== undefined) { fields.push('summarized_at = ?'); values.push(extra.summarized_at) }
  if (extra.delivered_at !== undefined) { fields.push('delivered_at = ?'); values.push(extra.delivered_at) }

  values.push(...ids)
  await db.prepare(`UPDATE items SET ${fields.join(', ')} WHERE id IN (${placeholders})`).bind(...values).run()
}
