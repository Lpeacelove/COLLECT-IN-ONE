// URL 规范化、哈希、去重工具

const STRIP_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'from', 'xhsshare', 'shareRedId', 'appuid', 'apptime',
  'share_id', 'share_token', 'share_from',
])

export function normalizeUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return raw.trim().toLowerCase()
  }

  url.hostname = url.hostname.toLowerCase()
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'

  // 移除追踪参数
  for (const key of [...url.searchParams.keys()]) {
    if (STRIP_PARAMS.has(key)) {
      url.searchParams.delete(key)
    }
  }

  // 参数排序（去重一致性）
  url.searchParams.sort()

  // 移除 fragment
  url.hash = ''

  return url.toString()
}

export async function hashUrl(normalized: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(normalized)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export function detectSource(_url: string): 'extension' | 'shortcut' | 'api' | 'unknown' {
  return 'unknown'
}

export function isXiaohongshu(url: string): boolean {
  return url.includes('xiaohongshu.com') || url.includes('xhslink.com')
}

export function isWechat(url: string): boolean {
  return url.includes('mp.weixin.qq.com')
}
