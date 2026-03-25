// background.js - Service Worker
// 核心逻辑：注册右键菜单、处理消息、调用后端 API

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

var CONTEXT_MENU_ID = 'collect-page'
var ACTION_COLLECT = 'collect'
var ACTION_GET_PAGE_INFO = 'getPageInfo'
var API_PATH = '/api/collect'
var STORAGE_KEY_API_KEY = 'apiKey'
var STORAGE_KEY_WORKER_URL = 'workerUrl'

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * 从 chrome.storage.sync 读取配置
 * @returns {Promise<{apiKey: string, workerUrl: string}>}
 */
function getConfig() {
  return new Promise(function (resolve) {
    chrome.storage.sync.get([STORAGE_KEY_API_KEY, STORAGE_KEY_WORKER_URL], function (result) {
      resolve({
        apiKey: result[STORAGE_KEY_API_KEY] || '',
        workerUrl: result[STORAGE_KEY_WORKER_URL] || '',
      })
    })
  })
}

/**
 * 调用后端 collect API
 * @param {string} apiKey
 * @param {string} workerUrl
 * @param {{url: string, title: string, excerpt: string}} pageInfo
 * @returns {Promise<{success: boolean, duplicate?: boolean, error?: string}>}
 */
function callCollectApi(apiKey, workerUrl, pageInfo) {
  return fetch(workerUrl + API_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      url: pageInfo.url,
      title: pageInfo.title,
      excerpt: pageInfo.excerpt,
    }),
  }).then(function (response) {
    if (response.status === 409) {
      return { success: false, duplicate: true }
    }
    if (!response.ok) {
      return response.json().then(function (body) {
        var errMsg = (body && body.error) ? body.error : ('HTTP ' + response.status)
        return { success: false, error: errMsg }
      }).catch(function () {
        return { success: false, error: 'HTTP ' + response.status }
      })
    }
    return { success: true }
  }).catch(function (err) {
    var message = (err instanceof Error) ? err.message : String(err)
    return { success: false, error: message }
  })
}

/**
 * 执行收集流程：读取配置 -> 校验 -> 调用 API
 * @param {{url: string, title: string, excerpt?: string}} pageInfo
 * @returns {Promise<{success: boolean, duplicate?: boolean, error?: string}>}
 */
function performCollect(pageInfo) {
  return getConfig().then(function (config) {
    if (!config.apiKey || !config.workerUrl) {
      return { success: false, error: '请先在设置页面配置 API Key 和 Worker URL' }
    }
    return callCollectApi(config.apiKey, config.workerUrl, pageInfo)
  })
}

// ---------------------------------------------------------------------------
// 安装事件：注册右键菜单
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(function () {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: '收藏此页面',
    contexts: ['page', 'link'],
  })
})

// ---------------------------------------------------------------------------
// 右键菜单点击事件
// ---------------------------------------------------------------------------

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (!tab || !tab.id) {
    return
  }
  var tabId = tab.id
  var fallbackUrl = tab.url || ''
  var fallbackTitle = tab.title || ''

  chrome.tabs.sendMessage(tabId, { action: ACTION_GET_PAGE_INFO }, function (response) {
    var pageInfo = response || { url: fallbackUrl, title: fallbackTitle, excerpt: '' }
    performCollect(pageInfo).catch(function (err) {
      console.error('右键菜单收集失败', err)
    })
  })
})

// ---------------------------------------------------------------------------
// onMessage：处理来自 popup.js 的消息
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  if (message.action !== ACTION_COLLECT) {
    return false
  }

  var pageInfo = {
    url: message.url || '',
    title: message.title || '',
    excerpt: message.excerpt || '',
  }

  performCollect(pageInfo).then(function (result) {
    sendResponse(result)
  })

  // 返回 true 表示异步响应
  return true
})
