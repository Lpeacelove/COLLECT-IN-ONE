import { Env } from '../types'
import { updateItemStatus } from '../db/queries'

const JINA_TIMEOUT_MS = 15_000
const MAX_CONTENT_BYTES = 500_000

export async function extractContent(env: Env, itemId: string, url: string): Promise<void> {
  await updateItemStatus(env.DB, itemId, 'extracting')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS)

  try {
    const jinaUrl = `https://r.jina.ai/${encodeURIComponent(url)}`
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Return-Format': 'markdown',
      'X-Timeout': '15',
    }
    if (env.JINA_API_KEY) {
      headers['Authorization'] = `Bearer ${env.JINA_API_KEY}`
    }

    const res = await fetch(jinaUrl, { headers, signal: controller.signal })
    clearTimeout(timer)

    if (res.status === 404 || res.status === 403) {
      // 无法访问的页面，不再重试
      clearTimeout(timer)
      await updateItemStatus(env.DB, itemId, 'permanently_failed', {
        last_error: `HTTP ${res.status} from Jina`,
      })
      return
    }

    if (!res.ok) {
      throw new Error(`Jina HTTP ${res.status}`)
    }

    const data = await res.json<{ data?: { content?: string; title?: string } }>()
    const content = data?.data?.content ?? ''

    // 截断超大内容
    const truncated = content.length > MAX_CONTENT_BYTES
      ? content.slice(0, MAX_CONTENT_BYTES)
      : content

    await updateItemStatus(env.DB, itemId, 'extracted', {
      content: truncated,
      content_length: truncated.length,
      extracted_at: new Date().toISOString(),
    })
  } catch (err) {
    clearTimeout(timer)
    const message = err instanceof Error ? err.message : String(err)

    // 读取当前 retry_count
    const item = await env.DB
      .prepare('SELECT retry_count FROM items WHERE id = ? LIMIT 1')
      .bind(itemId)
      .first<{ retry_count: number }>()

    const retryCount = (item?.retry_count ?? 0) + 1
    const nextStatus = retryCount >= 3 ? 'permanently_failed' : 'failed'

    await updateItemStatus(env.DB, itemId, nextStatus, {
      last_error: message,
      retry_count: retryCount,
    })
  }
}
