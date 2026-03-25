# 架构设计：碎片化信息总结工作流

> 生成日期：2026-03-25

---

## 1. 系统目标

允许单用户通过以下方式收集内容链接：小红书、微信公众号文章、Chrome 浏览器插件、iOS 分享菜单。收集的内容经 AI 自动总结后，通过飞书机器人以定时摘要卡片的形式推送给用户。

### 已确认技术选型

| 组件 | 选择 |
|------|------|
| 托管平台 | Cloudflare Workers + D1 + Cron Triggers |
| AI 模型 | DeepSeek API（`deepseek-chat`） |
| 内容提取 | Jina Reader API（`r.jina.ai`） |
| 用户规模 | 单用户 MVP |
| 飞书集成 | 自定义机器人 Webhook |
| 浏览器插件 | Chrome Extension Manifest V3 |
| 移动端 | iOS 快捷指令（分享菜单） |

---

## 2. 组件交互图

```
+-------------------+     +--------------------+
| Chrome 浏览器插件  |     | iOS 快捷指令        |
| (Manifest V3)     |     | (分享菜单)          |
+--------+----------+     +--------+-----------+
         |  POST /api/collect       |  POST /api/collect
         |  (url, title, excerpt,   |  (url, source_hint)
         |   source, tags)          |
         +----------+---------+-----+
                    |         |
                    v         v
         +-------------------------+
         | Cloudflare Worker       |
         | （主 API Worker）        |
         |                         |
         | 路由：                   |
         |  POST /api/collect      |
         |  GET  /api/items        |
         |  GET  /api/items/:id    |
         |  POST /api/digest       |
         |  GET  /api/digest/preview|
         |  DELETE /api/items/:id  |
         +---+--------+--------+--+
             |        |        |
             |        |  waitUntil()（异步）
             |        v
             |  +--------------+
             |  | Jina Reader  |
             |  | r.jina.ai    |
             |  | （内容提取）  |
             |  +--------------+
             |
             |  Cron Trigger（每日 08:00 CST）
             v
         +-------------------------+
         | 总结推送流水线           |
         | （同一 Worker 内执行）   |
         |                         |
         | 1. 查询待总结条目        |
         | 2. 批量发送 DeepSeek    |
         | 3. 构建飞书卡片          |
         | 4. POST 推送飞书         |
         +---+---------------------+
             |
             v
         +-------------------------+     +------------------+
         | DeepSeek API            |     | 飞书 Webhook     |
         | (deepseek-chat)         |     | （自定义机器人）  |
         +-------------------------+     +------------------+
                                                |
                                                v
                                         +------------------+
                                         | 飞书群聊          |
                                         | （摘要卡片消息）  |
                                         +------------------+

         +-------------------------+
         | Cloudflare D1           |
         | （SQLite，单数据库）     |
         | - items 表              |
         | - digests 表            |
         | - digest_items 表       |
         +-------------------------+
```

---

## 3. 数据流（含错误路径）

### 收集流程

```
客户端（插件 / 快捷指令）
  |
  | POST /api/collect { url, title?, excerpt?, source?, tags? }
  |
  v
[鉴权校验] --失败--> 401 Unauthorized
  |
  |--通过-->
  v
[URL 规范化 & 去重检查]
  |
  |--重复--> 409 Conflict { existing_item_id }
  |
  |--新条目-->
  v
[写入 D1：status='pending'] --> 201 Created { item_id }
  |
  | ctx.waitUntil(extractContent(item_id))（异步触发）
  v
[Jina Reader API：r.jina.ai/{url}]
  |
  |--超时/5xx--> [status='failed', retry_count++]
  |                    |
  |                    +--(retry_count < 3)--> [下次 Cron 重试]
  |                    +--(retry_count >= 3)--> [status='permanently_failed']
  |
  |--200 OK-->
  v
[更新 D1：content=markdown, status='extracted']
```

### 总结与推送流程

```
Cron Trigger（每日 08:00 CST）或 POST /api/digest
  |
  v
[查询 D1：status='extracted' 且未推送过]
  |
  |--无数据--> [空操作]
  |
  |--有数据-->
  v
[按每批 10 条分组]
  |
  v（对每批）
[DeepSeek API：批量总结]
  |
  |--报错--> [记录日志，跳过该批，status 保持 'extracted'，下次重试]
  |
  |--200 OK-->
  v
[更新条目：status='summarized', summary=文本]
  |
  v
[构建飞书交互卡片 JSON]
  |
  v（超过 20 条时拆分，每 20 条一张卡片）
[POST 到飞书 Webhook]
  |
  |--失败--> [记录日志，条目保持 'summarized'，下次重试]
  |
  |--成功-->
  v
[更新条目：status='delivered']
[写入 digest 记录]
```

### 条目状态机

```
pending → extracting → extracted → summarizing → summarized → delivered
              ↓                                       ↓
           failed ←————————(retry_count < 3)————————
              ↓
      permanently_failed（retry_count >= 3 或 4xx 响应）
```

---

## 4. 架构决策记录（ADR）

### ADR-001：单 Worker + 路由分发

**决策**：使用单个 Cloudflare Worker，以 Hono 路由器处理所有 API 路由和 Cron 处理器。

**原因**：单用户 MVP 场景下，Worker 间通信无任何收益。`ctx.waitUntil()` 足以处理异步提取，共享 D1 绑定更简洁。

**已排除方案**：多 Worker + Service Bindings、Cloudflare Queues。

---

### ADR-002：D1 作为唯一数据存储（不使用 KV）

**决策**：全量使用 D1。

**原因**：支持按状态/日期的 SQL 过滤、digest 与 items 的关联查询、事务性批量更新。单用户永远不会接近 10GB 上限。

**已排除方案**：KV 存储提取内容（此规模无优势），R2（仅适用于二进制大文件）。

---

### ADR-003：Jina Reader 通过 `waitUntil()` 异步执行 + Cron 重试

**决策**：`/api/collect` 写入条目后立即返回 201，通过 `ctx.waitUntil()` 触发 Jina 提取。失败最多重试 3 次，由 Cron 驱动。

**原因**：客户端响应时间 < 200ms。`waitUntil()` 保持 Worker 存活最长 30s，无需队列基础设施。

**已排除方案**：同步提取（客户端等待 2-10s）、Cloudflare Queues（增加成本与复杂度）。

---

### ADR-004：DeepSeek 批量总结（每批 10 条）

**决策**：每次 DeepSeek API 调用处理最多 10 条，每条内容截断至 3000 字符。

**原因**：减少 API 调用次数（约 $0.50/月）。批处理上下文可发现跨文章主题关联。`deepseek-chat` 支持 64K 上下文。

**已排除方案**：逐条总结（调用次数多，无主题分析）。

---

### ADR-005：静态 API Key 认证

**决策**：单个 64 字符十六进制 Key，存储为 Cloudflare Worker Secret，通过 `Authorization: Bearer <key>` 传递。

**原因**：零认证基础设施。插件、iOS 快捷指令、curl 统一使用。单用户无多租户需求。

**已排除方案**：Cloudflare Access（不兼容编程客户端），JWT（单用户场景过度设计）。

---

## 5. 完整 D1 Schema

```sql
-- items：每条收集的 URL 对应一行
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  url TEXT NOT NULL,
  url_hash TEXT NOT NULL,          -- 规范化 URL 的 SHA-256，用于去重
  title TEXT,
  excerpt TEXT,                    -- 用户选中的文本
  source TEXT NOT NULL DEFAULT 'unknown',  -- 'extension', 'shortcut', 'api'
  tags TEXT,                       -- JSON 数组，如 '["tech","ai"]'

  -- 提取相关
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'extracting', 'extracted',
      'summarizing', 'summarized', 'delivered',
      'failed', 'permanently_failed'
    )),
  content TEXT,                    -- Jina Reader 提取的 Markdown 正文
  content_length INTEGER DEFAULT 0,

  -- 总结相关
  summary TEXT,

  -- 重试追踪
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,

  -- 时间戳（ISO 8601 UTC）
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  extracted_at TEXT,
  summarized_at TEXT,
  delivered_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_url_hash ON items(url_hash);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at);
CREATE INDEX IF NOT EXISTS idx_items_status_retry
  ON items(status, retry_count)
  WHERE status IN ('pending', 'failed');


-- digests：每次推送的摘要记录
CREATE TABLE IF NOT EXISTS digests (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  item_count INTEGER NOT NULL DEFAULT 0,
  summary_overview TEXT,
  feishu_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'building'
    CHECK (status IN ('building', 'sent', 'failed')),
  error TEXT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_digests_created_at ON digests(created_at);


-- digest_items：摘要与条目的关联表
CREATE TABLE IF NOT EXISTS digest_items (
  digest_id TEXT NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (digest_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_digest_items_item ON digest_items(item_id);
```

---

## 6. API 接口约定

除 `/api/health` 外，所有接口均需 `Authorization: Bearer <API_KEY>` 请求头。

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/collect` | 收集链接（立即返回） |
| `GET` | `/api/items` | 列表查询（支持 status、source、since、until 过滤） |
| `GET` | `/api/items/:id` | 条目详情（含全文和摘要） |
| `DELETE` | `/api/items/:id` | 删除条目 |
| `POST` | `/api/items/:id/retry` | 手动重试失败的提取 |
| `POST` | `/api/digest` | 手动触发摘要推送（支持 `dry_run`） |
| `GET` | `/api/digest/preview` | 预览下次推送内容（不实际发送） |
| `GET` | `/api/stats` | 系统状态统计 |
| `GET` | `/api/health` | 健康检查（无需认证） |

### `POST /api/collect`

请求体：
```json
{
  "url": "https://www.xiaohongshu.com/explore/abc123",
  "title": "可选页面标题",
  "excerpt": "可选选中文本",
  "source": "extension",
  "tags": ["tech"]
}
```

响应 201：
```json
{
  "ok": true,
  "item": {
    "id": "a1b2c3d4...",
    "url": "https://www.xiaohongshu.com/explore/abc123",
    "status": "pending",
    "created_at": "2026-03-25T10:30:00Z"
  }
}
```

响应 409（重复）：
```json
{ "ok": false, "error": "duplicate", "existing_item_id": "a1b2c3d4..." }
```

### `POST /api/digest`

请求体（可选）：
```json
{
  "since": "2026-03-24T00:00:00Z",
  "until": "2026-03-25T00:00:00Z",
  "dry_run": false
}
```

---

## 7. 飞书卡片 JSON 模板

```json
{
  "msg_type": "interactive",
  "card": {
    "config": { "wide_screen_mode": true },
    "header": {
      "title": {
        "tag": "plain_text",
        "content": "每日阅读摘要 -- 2026年3月25日"
      },
      "template": "blue"
    },
    "elements": [
      {
        "tag": "markdown",
        "content": "**主题概述**\n今日收集的 8 篇文章涉及 AI 工具、前端架构和生产力工作流等主题。"
      },
      { "tag": "hr" },
      {
        "tag": "markdown",
        "content": "**1. 文章标题**\n[source.com](https://source.com/article) | 来自 浏览器插件\n\n文章核心观点的 2-3 句话总结。"
      },
      { "tag": "hr" },
      {
        "tag": "note",
        "elements": [
          { "tag": "plain_text", "content": "共 8 条 | 生成于 08:00 CST" }
        ]
      }
    ]
  }
}
```

> 超过 20 条时：拆分为多张卡片，标题分别为「每日摘要（1/2）」「每日摘要（2/2）」，发送间隔 1 秒。

---

## 8. Chrome 插件架构

### 组件职责

| 组件 | 职责 |
|------|------|
| `background.js`（Service Worker） | API 调用、认证、右键菜单处理 |
| `popup.html/js` | 一键收集 UI、状态展示 |
| `content.js` | 获取选中文本、页面元数据 |
| `options.html/js` | API Key 配置 |

### 消息传递流程

```
用户点击插件图标
  → 弹出 Popup
  → Popup → content.js：{ action: "getPageInfo" }
  → content.js 返回：{ title, url, excerpt, ogDescription }
  → 用户点击「收集」按钮
  → Popup → background.js：{ action: "collect", url, title, excerpt }
  → background.js 从 chrome.storage.sync 读取 API_KEY
  → POST /api/collect
  → Popup 显示成功或错误状态
```

### Manifest V3 权限声明

```json
{
  "manifest_version": 3,
  "permissions": ["activeTab", "contextMenus", "storage"],
  "host_permissions": ["https://collect.yourdomain.workers.dev/*"]
}
```

### 错误状态

| 状态 | UI 提示 |
|------|---------|
| 未配置 API Key | "请在设置中填写 API Key" |
| 离线 | "当前无网络连接，请稍后重试" |
| 401 | "API Key 无效，请检查设置" |
| 409 | "已收藏过该链接 ✓" |
| 成功 | 绿色勾选徽标显示 3 秒 |

---

## 9. iOS 快捷指令流程

```
分享菜单接收到 URL 或文本
  ↓
用正则 https?://[^\s]+ 匹配提取 URL（处理小红书分享文本格式）
  ↓
POST /api/collect
  请求头：Authorization: Bearer <key>
  请求体：{ "url": "<url>", "source": "shortcut" }
  ↓
检查响应中的 "ok" 字段
  → true：显示通知「已成功收藏」
  → false：读取 "error" 字段
              "duplicate" → 「该链接已收藏过」
              其他         → 「收藏失败：<错误信息>」
```

**小红书分享文本格式**：`"这篇不错！https://xhslink.com/abc 复制链接打开小红书"`
→ 快捷指令通过正则提取 URL；Worker 在提取内容时服务端自动跟随跳转解析短链。

---

## 10. 安全模型

| 密钥 | 存储位置 | 访问方式 |
|------|---------|---------|
| `API_KEY` | `wrangler secret` | `env.API_KEY` |
| `DEEPSEEK_API_KEY` | `wrangler secret` | `env.DEEPSEEK_API_KEY` |
| `JINA_API_KEY` | `wrangler secret` | `env.JINA_API_KEY` |
| `FEISHU_WEBHOOK_URL` | `wrangler secret` | `env.FEISHU_WEBHOOK_URL` |

CORS 策略：`Access-Control-Allow-Origin: *` — 可接受，API Key 是安全边界而非 CORS。

---

## 11. 项目目录结构

```
collect-in-one/
├── wrangler.toml
├── package.json
├── tsconfig.json
├── .dev.vars                    # 本地开发密钥（已 gitignore）
├── src/
│   ├── index.ts                 # Hono 应用入口 + Cron 处理器导出
│   ├── types.ts                 # Env 绑定、D1 类型、API 类型定义
│   ├── routes/
│   │   ├── collect.ts           # POST /api/collect
│   │   ├── items.ts             # GET/DELETE /api/items
│   │   ├── digest.ts            # POST /api/digest
│   │   ├── stats.ts             # GET /api/stats
│   │   └── health.ts            # GET /api/health
│   ├── middleware/
│   │   ├── auth.ts              # Bearer Token 校验
│   │   ├── cors.ts              # CORS 响应头
│   │   └── error-handler.ts     # 全局错误边界
│   ├── services/
│   │   ├── extractor.ts         # Jina Reader API 集成
│   │   ├── summarizer.ts        # DeepSeek API 集成
│   │   ├── feishu.ts            # Webhook 调用 + 卡片构建
│   │   └── url.ts               # URL 规范化、哈希、去重
│   ├── cron/
│   │   ├── handler.ts           # Cron 主编排逻辑
│   │   ├── retry.ts             # 重试失败提取
│   │   ├── summarize.ts         # 批量总结
│   │   └── deliver.ts           # 飞书推送
│   ├── db/
│   │   ├── queries.ts           # 带类型的 D1 查询封装
│   │   └── migrations/
│   │       └── 0001_initial.sql
│   └── prompts/
│       └── summarize.ts         # DeepSeek Prompt 模板
├── extension/
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── popup.html / popup.js / popup.css
│   ├── options.html / options.js
│   └── icons/
├── docs/
│   ├── architecture.md          # 英文架构文档
│   ├── architecture-zh.md       # 本文件
│   ├── adr/
│   │   ├── 001-single-worker.md
│   │   ├── 002-d1-only.md
│   │   ├── 003-waituntil-extraction.md
│   │   ├── 004-batch-summarization.md
│   │   └── 005-static-api-key.md
│   ├── feishu-card-template.json
│   └── ios-shortcut-setup.md
└── test/
    ├── routes/
    ├── services/
    ├── cron/
    └── fixtures/
```

---

## 12. 核心 `wrangler.toml`

```toml
name = "collect-in-one"
main = "src/index.ts"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]

[triggers]
crons = ["0 0 * * *"]  # 00:00 UTC = 北京时间 08:00

[[d1_databases]]
binding = "DB"
database_name = "collect-in-one-db"
database_id = "<your-database-id>"
```

---

## 13. DeepSeek Prompt 模板

```typescript
export function buildSummarizePrompt(items: Array<{
  title: string;
  url: string;
  content: string;
  excerpt?: string;
}>): string {
  const itemsText = items.map((item, i) =>
    `### 文章 ${i + 1}：${item.title || '无标题'}
链接：${item.url}
${item.excerpt ? `用户备注：${item.excerpt}\n` : ''}
正文：
${item.content.slice(0, 3000)}
---`
  ).join('\n\n');

  return `你是一个阅读摘要助手。请对以下 ${items.length} 篇文章进行总结，生成每日阅读摘要。

对每篇文章，请输出：
1. 简洁的标题（原标题好则保留，模糊则改进）
2. 2-3 句话的核心观点总结
3. 一个关键词标签

所有文章总结完成后，写一段「主题概述」（3-4 句话），提炼今日文章的共同主题、关联性或规律。

以 JSON 格式输出：
{
  "items": [
    { "index": 1, "title": "...", "summary": "...", "tag": "..." }
  ],
  "thematic_overview": "..."
}

文章列表：

${itemsText}`;
}
```

---

## 14. 可观测性查询

```sql
-- 系统状态概览
SELECT status, COUNT(*) as count FROM items GROUP BY status;

-- 需要关注的失败条目
SELECT id, url, last_error, retry_count, updated_at
FROM items
WHERE status IN ('failed', 'permanently_failed')
ORDER BY updated_at DESC;

-- 每日收集量统计
SELECT date(created_at) as day, COUNT(*) as collected
FROM items
GROUP BY date(created_at)
ORDER BY day DESC LIMIT 14;
```

---

## 15. 实施顺序

| 阶段 | 内容 | 预估时间 |
|------|------|---------|
| 1 | Worker 初始化 + D1 Schema + `/api/collect` + `/api/items` | 2-3h |
| 2 | Jina 内容提取（`waitUntil()` 异步） | 1-2h |
| 3 | Chrome 浏览器插件 | 2-3h |
| 4 | DeepSeek 批量总结 + 飞书推送 | 2-3h |
| 5 | Cron 定时触发 + 重试逻辑 | 1-2h |
| 6 | iOS 快捷指令 | 30min |
| 7 | 统计接口 + 优化 + 测试 | 2-3h |

**MVP 合计：约 12-18 小时**
