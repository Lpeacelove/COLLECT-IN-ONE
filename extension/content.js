// content.js - 内容脚本
// 负责从当前页面提取 URL、title、excerpt 信息

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

var ACTION_GET_PAGE_INFO = 'getPageInfo'
var EXCERPT_MAX_LENGTH = 200
var META_OG_DESCRIPTION = 'meta[property="og:description"]'
var META_NAME_DESCRIPTION = 'meta[name="description"]'

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * 从页面 meta 标签提取摘要
 * 优先级：og:description > meta[name="description"] > 空字符串
 * 截断到最多 200 字符
 * @returns {string}
 */
function extractExcerpt() {
  var ogEl = document.querySelector(META_OG_DESCRIPTION)
  var metaEl = document.querySelector(META_NAME_DESCRIPTION)
  var raw = ''

  if (ogEl && ogEl.content) {
    raw = ogEl.content
  } else if (metaEl && metaEl.content) {
    raw = metaEl.content
  }

  if (raw.length > EXCERPT_MAX_LENGTH) {
    return raw.slice(0, EXCERPT_MAX_LENGTH)
  }
  return raw
}

// ---------------------------------------------------------------------------
// 消息监听
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  if (message.action !== ACTION_GET_PAGE_INFO) {
    return false
  }

  sendResponse({
    url: document.URL,
    title: document.title,
    excerpt: extractExcerpt(),
  })

  return false
})
