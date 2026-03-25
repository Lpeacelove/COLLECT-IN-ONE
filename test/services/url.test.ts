import { describe, it, expect } from 'vitest'
import { normalizeUrl, hashUrl, isXiaohongshu, isWechat } from '../../src/services/url'

describe('normalizeUrl', () => {
  it('移除 utm 追踪参数', () => {
    const result = normalizeUrl('https://example.com/article?utm_source=wechat&utm_medium=social&id=123')
    expect(result).toBe('https://example.com/article?id=123')
  })

  it('移除小红书分享参数', () => {
    const result = normalizeUrl('https://www.xiaohongshu.com/explore/abc?xhsshare=CopyLink&appuid=123&apptime=456')
    expect(result).toBe('https://www.xiaohongshu.com/explore/abc')
  })

  it('移除末尾斜杠', () => {
    const result = normalizeUrl('https://example.com/article/')
    expect(result).toBe('https://example.com/article')
  })

  it('移除 URL fragment', () => {
    const result = normalizeUrl('https://example.com/article#section-1')
    expect(result).toBe('https://example.com/article')
  })

  it('对查询参数排序，保证相同参数不同顺序结果一致', () => {
    const a = normalizeUrl('https://example.com?b=2&a=1')
    const b = normalizeUrl('https://example.com?a=1&b=2')
    expect(a).toBe(b)
  })

  it('hostname 转小写', () => {
    const result = normalizeUrl('https://Example.COM/path')
    expect(result).toBe('https://example.com/path')
  })

  it('同一个 URL 规范化后相同', () => {
    const url = 'https://mp.weixin.qq.com/s/abc123'
    expect(normalizeUrl(url)).toBe(normalizeUrl(url))
  })

  it('无效 URL 返回 trim 后的原始字符串', () => {
    const result = normalizeUrl('  not-a-url  ')
    expect(result).toBe('not-a-url')
  })
})

describe('hashUrl', () => {
  it('相同 URL 产生相同哈希', async () => {
    const hash1 = await hashUrl('https://example.com/article')
    const hash2 = await hashUrl('https://example.com/article')
    expect(hash1).toBe(hash2)
  })

  it('不同 URL 产生不同哈希', async () => {
    const hash1 = await hashUrl('https://example.com/article-1')
    const hash2 = await hashUrl('https://example.com/article-2')
    expect(hash1).not.toBe(hash2)
  })

  it('返回 64 字符十六进制字符串（SHA-256）', async () => {
    const hash = await hashUrl('https://example.com')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('isXiaohongshu', () => {
  it('识别小红书主域名', () => {
    expect(isXiaohongshu('https://www.xiaohongshu.com/explore/abc')).toBe(true)
  })

  it('识别小红书短链', () => {
    expect(isXiaohongshu('https://xhslink.com/abc123')).toBe(true)
  })

  it('非小红书链接返回 false', () => {
    expect(isXiaohongshu('https://mp.weixin.qq.com/s/abc')).toBe(false)
  })
})

describe('isWechat', () => {
  it('识别微信公众号文章', () => {
    expect(isWechat('https://mp.weixin.qq.com/s/abc123')).toBe(true)
  })

  it('非微信链接返回 false', () => {
    expect(isWechat('https://www.xiaohongshu.com/explore/abc')).toBe(false)
  })
})
