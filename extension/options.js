// options.js - 设置页面逻辑
// 负责读取和保存 API Key 和 Worker URL

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

var STORAGE_KEY_API_KEY = 'apiKey'
var STORAGE_KEY_WORKER_URL = 'workerUrl'
var STATUS_HIDE_DELAY_MS = 2000

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/**
 * 显示状态提示并在指定时间后隐藏
 * @param {HTMLElement} el
 * @param {string} text
 */
function showStatus(el, text) {
  el.textContent = text
  el.style.display = 'block'
  setTimeout(function () {
    el.style.display = 'none'
  }, STATUS_HIDE_DELAY_MS)
}

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', function () {
  var apiKeyInput = document.getElementById('apiKey')
  var workerUrlInput = document.getElementById('workerUrl')
  var saveBtn = document.getElementById('saveBtn')
  var statusEl = document.getElementById('status')

  // 从 storage 加载已保存的值
  chrome.storage.sync.get([STORAGE_KEY_API_KEY, STORAGE_KEY_WORKER_URL], function (result) {
    if (apiKeyInput) {
      apiKeyInput.value = result[STORAGE_KEY_API_KEY] || ''
    }
    if (workerUrlInput) {
      workerUrlInput.value = result[STORAGE_KEY_WORKER_URL] || ''
    }
  })

  // 保存按钮点击事件
  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      var apiKey = apiKeyInput ? apiKeyInput.value : ''
      var workerUrl = workerUrlInput ? workerUrlInput.value : ''

      var data = {}
      data[STORAGE_KEY_API_KEY] = apiKey
      data[STORAGE_KEY_WORKER_URL] = workerUrl

      chrome.storage.sync.set(data, function () {
        if (statusEl) {
          showStatus(statusEl, '保存成功')
        }
      })
    })
  }
})
