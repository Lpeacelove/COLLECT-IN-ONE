// popup.js - 弹出页面逻辑
// 负责展示当前页面信息并触发收藏操作

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

var ACTION_GET_PAGE_INFO = 'getPageInfo'
var ACTION_COLLECT = 'collect'

var CSS_CLASS_SUCCESS = 'status-success'
var CSS_CLASS_ERROR = 'status-error'
var CSS_CLASS_DUPLICATE = 'status-duplicate'

var MSG_SUCCESS = '收藏成功！'
var MSG_DUPLICATE = '已经收藏过了'
var MSG_ERROR_PREFIX = '收藏失败：'
var MSG_UNKNOWN_ERROR = '未知错误'

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', function () {
  var collectBtn = document.getElementById('collectBtn')
  var statusEl = document.getElementById('status')
  var loadingEl = document.getElementById('loading')
  var pageTitleEl = document.getElementById('pageTitle')
  var pageUrlEl = document.getElementById('pageUrl')

  var currentPageInfo = null

  // 向 background.js 请求当前页面信息
  chrome.runtime.sendMessage({ action: ACTION_GET_PAGE_INFO }, function (response) {
    if (!response) {
      return
    }
    currentPageInfo = response
    if (pageTitleEl) {
      pageTitleEl.textContent = response.title || ''
    }
    if (pageUrlEl) {
      pageUrlEl.textContent = response.url || ''
    }
  })

  /**
   * 显示状态信息
   * @param {string} text
   * @param {string} cssClass
   */
  function showStatus(text, cssClass) {
    if (!statusEl) return
    statusEl.textContent = text
    statusEl.className = cssClass
    statusEl.style.display = 'block'
  }

  // 收藏按钮点击事件
  if (collectBtn) {
    collectBtn.addEventListener('click', function () {
      collectBtn.disabled = true
      if (loadingEl) {
        loadingEl.style.display = 'block'
      }

      var pageInfo = currentPageInfo || { url: '', title: '', excerpt: '' }

      chrome.runtime.sendMessage(
        {
          action: ACTION_COLLECT,
          url: pageInfo.url,
          title: pageInfo.title,
          excerpt: pageInfo.excerpt || '',
        },
        function (response) {
          if (loadingEl) {
            loadingEl.style.display = 'none'
          }

          if (!response) {
            showStatus(MSG_ERROR_PREFIX + MSG_UNKNOWN_ERROR, CSS_CLASS_ERROR)
            return
          }

          if (response.success) {
            showStatus(MSG_SUCCESS, CSS_CLASS_SUCCESS)
          } else if (response.duplicate) {
            showStatus(MSG_DUPLICATE, CSS_CLASS_DUPLICATE)
          } else {
            var errText = response.error || MSG_UNKNOWN_ERROR
            showStatus(MSG_ERROR_PREFIX + errText, CSS_CLASS_ERROR)
          }
        }
      )
    })
  }
})
