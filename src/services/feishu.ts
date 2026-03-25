import { Env, DigestPayload } from '../types'

export async function sendDigestToFeishu(env: Env, digest: DigestPayload): Promise<void> {
  if (!env.FEISHU_WEBHOOK_URL) {
    throw new Error('FEISHU_WEBHOOK_URL is not configured')
  }

  const articleElements = digest.items.map(item => ({
    tag: 'markdown',
    content: `**[${item.title}](${item.url})**\n${item.summary}`,
  }))

  const card = {
    msg_type: 'interactive',
    card: {
      header: {
        title: {
          content: `今日信息摘要 · ${digest.date}`,
          tag: 'plain_text',
        },
      },
      elements: [
        {
          tag: 'markdown',
          content: `**整体总结**\n${digest.overall}`,
        },
        { tag: 'hr' },
        ...articleElements,
        {
          tag: 'note',
          elements: [
            {
              tag: 'plain_text',
              content: `共 ${digest.items.length} 篇 · ${digest.date}`,
            },
          ],
        },
      ],
    },
  }

  const res = await fetch(env.FEISHU_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(card),
  })

  if (!res.ok) {
    throw new Error(`Feishu HTTP ${res.status}`)
  }

  const data = await res.json<{ code: number; msg?: string }>()
  if (data.code !== 0) {
    throw new Error(`Feishu error code ${data.code}: ${data.msg ?? 'unknown'}`)
  }
}
