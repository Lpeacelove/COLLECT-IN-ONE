export type ItemStatus =
  | 'pending'
  | 'extracting'
  | 'extracted'
  | 'summarizing'
  | 'summarized'
  | 'delivered'
  | 'failed'
  | 'permanently_failed'

export type ItemSource = 'extension' | 'shortcut' | 'api' | 'unknown'

export interface Item {
  id: string
  url: string
  url_hash: string
  title: string | null
  excerpt: string | null
  source: ItemSource
  tags: string | null
  status: ItemStatus
  content: string | null
  content_length: number
  summary: string | null
  retry_count: number
  last_error: string | null
  created_at: string
  extracted_at: string | null
  summarized_at: string | null
  delivered_at: string | null
  updated_at: string
}

export interface Digest {
  id: string
  item_count: number
  summary_overview: string | null
  feishu_message_id: string | null
  status: 'building' | 'sent' | 'failed'
  error: string | null
  period_start: string
  period_end: string
  created_at: string
  sent_at: string | null
}

export interface Env {
  DB: D1Database
  API_KEY: string
  DEEPSEEK_API_KEY: string
  JINA_API_KEY: string
  FEISHU_WEBHOOK_URL: string
}

export interface CollectRequest {
  url: string
  title?: string
  excerpt?: string
  source?: ItemSource
  tags?: string[]
}

export interface ApiResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}
