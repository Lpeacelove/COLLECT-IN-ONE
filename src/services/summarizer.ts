import { Env, DigestPayload } from '../types'
import { getExtractedItems, batchUpdateStatus, insertDigest, insertDigestItems } from '../db/queries'

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-chat'
const DEEPSEEK_TIMEOUT_MS = 30_000
// 每篇文章传入 DeepSeek 的内容最大长度（防止超出上下文窗口）
const MAX_CONTENT_PER_ITEM = 2_000

interface DeepSeekSummaryItem {
  id: string
  title: string
  summary: string
}

interface DeepSeekResult {
  summaries: DeepSeekSummaryItem[]
  overall: string
}

export async function summarizeItems(env: Env): Promise<DigestPayload | null> {
  const items = await getExtractedItems(env.DB)
  if (items.length === 0) return null

  const ids = items.map(item => item.id)
  await batchUpdateStatus(env.DB, ids, 'summarizing')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS)

  let result: DeepSeekResult
  try {
    const articlesText = items
      .map(
        (item, i) =>
          `文章 ${i + 1}（id: ${item.id}）\n标题：${item.title ?? '无标题'}\n内容：${(item.content ?? '').slice(0, MAX_CONTENT_PER_ITEM)}`,
      )
      .join('\n\n---\n\n')

    const userContent =
      `以下是今天收藏的 ${items.length} 篇文章，请为每篇生成一个 2-3 句话的中文摘要，` +
      `并在最后提供一个整体的主题总结（3-5句话）。\n\n${articlesText}\n\n` +
      `请以 JSON 格式返回：{ "summaries": [{"id": "...", "title": "...", "summary": "..."}], "overall": "..." }`

    const res = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: '你是一个信息整理助手，帮助用户总结今日收藏的内容。' },
          { role: 'user', content: userContent },
        ],
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      throw new Error(`DeepSeek HTTP ${res.status}`)
    }

    const data = await res.json<{ choices: Array<{ message: { content: string } }> }>()
    const content = data.choices[0]?.message?.content ?? ''
    const parsed = JSON.parse(content) as DeepSeekResult

    if (!parsed.summaries || !parsed.overall) {
      throw new Error('DeepSeek response missing required fields: summaries or overall')
    }
    result = parsed
  } catch (err) {
    clearTimeout(timer)
    throw err
  }

  // 写入 digest 主记录
  const digestId = crypto.randomUUID().replace(/-/g, '')
  const now = new Date().toISOString()
  const today = now.slice(0, 10)

  await insertDigest(env.DB, {
    id: digestId,
    summary_overview: result.overall,
    item_count: items.length,
    period_start: `${today}T00:00:00Z`,
    period_end: `${today}T23:59:59Z`,
  })

  // 写入 digest_items 关联
  await insertDigestItems(
    env.DB,
    ids.map((id, i) => ({ digest_id: digestId, item_id: id, display_order: i })),
  )

  // 构建 item summary 映射（id → summary）
  const summaryMap = new Map(result.summaries.map(s => [s.id, s.summary]))

  // 批量更新 items 为 summarized
  await batchUpdateStatus(env.DB, ids, 'summarized', { summarized_at: now })

  return {
    id: digestId,
    overall: result.overall,
    date: today,
    items: items.map(item => ({
      id: item.id,
      title: item.title ?? '无标题',
      url: item.url,
      summary: summaryMap.get(item.id) ?? '',
    })),
  }
}
