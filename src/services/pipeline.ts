import { Env } from '../types'
import { summarizeItems } from './summarizer'
import { sendDigestToFeishu } from './feishu'

export interface PipelineResult {
  ok: boolean
  digest_id?: string
  item_count?: number
  error?: string
}

// 完整摘要推送链路：提取已完成的 items → DeepSeek 总结 → 飞书推送
// 所有异常均被捕获，保证函数本身不抛出
export async function runDigestPipeline(env: Env): Promise<PipelineResult> {
  try {
    const digest = await summarizeItems(env)
    if (!digest) {
      return { ok: true }
    }
    await sendDigestToFeishu(env, digest)
    return { ok: true, digest_id: digest.id, item_count: digest.items.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}
