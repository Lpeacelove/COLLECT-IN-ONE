# Architecture Design: Fragmented Information Summary Workflow

> 碎片化信息总结工作流 — 架构设计文档
> Generated: 2026-03-25

---

## 1. System Goal

Allow a single user to collect content links from Xiaohongshu (小红书), WeChat Official Accounts (公众号), arbitrary web pages via Chrome extension, and iOS Share Sheet. Collected items are AI-summarized and delivered as a scheduled digest to Feishu (飞书/Lark) via Bot.

### Confirmed Tech Decisions

| Component | Choice |
|-----------|--------|
| Hosting | Cloudflare Workers + D1 + Cron Triggers |
| AI Model | DeepSeek API (`deepseek-chat`) |
| Content Extraction | Jina Reader API (`r.jina.ai`) |
| Scale | Single user MVP |
| Feishu | Custom Bot via Webhook |
| Browser | Chrome Extension Manifest V3 |
| Mobile | iOS Shortcuts (share sheet) |

---

## 2. Component Interaction Diagram

```
+-------------------+     +--------------------+
| Chrome Extension  |     | iOS Shortcut       |
| (Manifest V3)     |     | (Share Sheet)      |
+--------+----------+     +--------+-----------+
         |  POST /api/collect       |  POST /api/collect
         |  (url, title, excerpt,   |  (url, source_hint)
         |   source, tags)          |
         +----------+---------+-----+
                    |         |
                    v         v
         +-------------------------+
         | Cloudflare Worker       |
         | (Main API Worker)       |
         |                         |
         | Routes:                 |
         |  POST /api/collect      |
         |  GET  /api/items        |
         |  GET  /api/items/:id    |
         |  POST /api/digest       |
         |  GET  /api/digest/preview|
         |  DELETE /api/items/:id  |
         +---+--------+--------+--+
             |        |        |
             |        |  waitUntil()
             |        v
             |  +--------------+
             |  | Jina Reader  |
             |  | r.jina.ai    |
             |  | (extraction) |
             |  +--------------+
             |
             |  Cron Trigger (daily 08:00 CST)
             v
         +-------------------------+
         | Summarization Pipeline  |
         | (within same Worker)    |
         |                         |
         | 1. Query unsummarized   |
         | 2. Batch to DeepSeek    |
         | 3. Build Feishu Card    |
         | 4. POST to Feishu       |
         +---+---------------------+
             |
             v
         +-------------------------+     +------------------+
         | DeepSeek API            |     | Feishu Webhook   |
         | (deepseek-chat)         |     | (Custom Bot)     |
         +-------------------------+     +------------------+
                                                |
                                                v
                                         +------------------+
                                         | Feishu Group Chat|
                                         | (Digest Card)    |
                                         +------------------+

         +-------------------------+
         | Cloudflare D1           |
         | (SQLite, single DB)     |
         | - items table           |
         | - digests table         |
         | - digest_items table    |
         +-------------------------+
```

---

## 3. Data Flow with Error Paths

### Ingestion Flow

```
Client (Extension/Shortcut)
  |
  | POST /api/collect { url, title?, excerpt?, source?, tags? }
  |
  v
[Auth Check] --FAIL--> 401 Unauthorized
  |
  |--OK-->
  v
[URL Normalization & Dedup Check]
  |
  |--DUPLICATE--> 409 Conflict { existing_item_id }
  |
  |--NEW-->
  v
[Insert to D1: status='pending'] --> 201 Created { item_id }
  |
  | ctx.waitUntil(extractContent(item_id))
  v
[Jina Reader API: r.jina.ai/{url}]
  |
  |--TIMEOUT/5xx--> [status='failed', retry_count++]
  |                    |
  |                    +--(retry_count < 3)--> [Requeued by next cron]
  |                    +--(retry_count >= 3)--> [status='permanently_failed']
  |
  |--200 OK-->
  v
[Update D1: content=markdown, status='extracted']
```

### Summarization & Delivery Flow

```
Cron Trigger (daily 08:00 CST) OR POST /api/digest
  |
  v
[Query D1: status='extracted', not yet in any digest]
  |
  |--EMPTY--> [No-op]
  |
  |--HAS ITEMS-->
  v
[Batch items into groups of 10]
  |
  v (for each batch)
[DeepSeek API: summarize batch]
  |
  |--ERROR--> [Log error, skip batch, status stays 'extracted']
  |
  |--200 OK-->
  v
[Update items: status='summarized', summary=text]
  |
  v
[Build Feishu Interactive Card JSON]
  |
  v (chunk if > 20 items: one card per 20)
[POST to Feishu Webhook]
  |
  |--FAIL--> [Log error, items stay 'summarized' for next retry]
  |
  |--OK-->
  v
[Update items: status='delivered']
[Insert digest record with metadata]
```

### Item Status State Machine

```
pending → extracting → extracted → summarizing → summarized → delivered
              ↓                                       ↓
           failed ←————————(retry_count < 3)————————
              ↓
      permanently_failed (retry_count >= 3 OR 4xx)
```

---

## 4. Architecture Decision Records

### ADR-001: Single Worker with Route-based Dispatch

**Decision**: Single Cloudflare Worker with Hono router for all routes and the cron handler.

**Why**: For single-user MVP, Worker-to-Worker communication adds zero value. `ctx.waitUntil()` handles async extraction. Shared D1 binding is simpler.

**Rejected**: Multiple Workers with Service Bindings, Cloudflare Queues.

---

### ADR-002: D1 as Single Data Store (No KV)

**Decision**: Use D1 exclusively.

**Why**: SQL filtering by status/date, relational joins for digest-to-items, transactional batch updates. Single user will never approach 10GB limit.

**Rejected**: KV for extracted content (no benefit at this scale), R2 (only needed for binary blobs).

---

### ADR-003: Jina Reader via `waitUntil()` with Cron Retry

**Decision**: `/api/collect` inserts item, returns 201 immediately, fires Jina extraction via `ctx.waitUntil()`. Cron retries failures (max 3).

**Why**: Sub-200ms response to client. `waitUntil()` keeps Worker alive up to 30s. No queue infrastructure needed.

**Rejected**: Synchronous extraction (blocks client 2-10s), Cloudflare Queues (adds cost/complexity).

---

### ADR-004: DeepSeek Batch Summarization (10 items per prompt)

**Decision**: Batch up to 10 items per DeepSeek call. Content truncated to 3000 chars per item.

**Why**: Fewer API calls (~$0.50/month). Batch context enables cross-item theme detection. DeepSeek `deepseek-chat` supports 64K context.

**Rejected**: Per-item summarization (more calls, no thematic analysis).

---

### ADR-005: Static API Key Authentication

**Decision**: Single 64-char hex key stored as Cloudflare Worker secret. Sent as `Authorization: Bearer <key>`.

**Why**: Zero auth infrastructure. Works for extension, iOS Shortcut, and curl. Single user has no multi-tenant needs.

**Rejected**: Cloudflare Access (incompatible with programmatic clients), JWT (unnecessary for single user).

---

## 5. Complete D1 Schema

```sql
-- Items: one row per collected URL
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  url TEXT NOT NULL,
  url_hash TEXT NOT NULL,          -- SHA-256 of normalized URL, for dedup
  title TEXT,
  excerpt TEXT,                    -- user-selected text
  source TEXT NOT NULL DEFAULT 'unknown',  -- 'extension', 'shortcut', 'api'
  tags TEXT,                       -- JSON array, e.g. '["tech","ai"]'

  -- Extraction
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'extracting', 'extracted',
      'summarizing', 'summarized', 'delivered',
      'failed', 'permanently_failed'
    )),
  content TEXT,                    -- extracted markdown from Jina Reader
  content_length INTEGER DEFAULT 0,

  -- Summarization
  summary TEXT,

  -- Retry tracking
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,

  -- Timestamps (ISO 8601 UTC)
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


-- Digests: one row per delivered digest
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


-- Junction: which items are in which digest
CREATE TABLE IF NOT EXISTS digest_items (
  digest_id TEXT NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (digest_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_digest_items_item ON digest_items(item_id);
```

---

## 6. API Contract

All endpoints require `Authorization: Bearer <API_KEY>` except `/api/health`.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/collect` | Collect a URL (returns immediately) |
| `GET` | `/api/items` | List items (filter: status, source, since, until) |
| `GET` | `/api/items/:id` | Full item detail with content and summary |
| `DELETE` | `/api/items/:id` | Delete an item |
| `POST` | `/api/items/:id/retry` | Manually retry failed extraction |
| `POST` | `/api/digest` | Trigger digest (supports `dry_run`) |
| `GET` | `/api/digest/preview` | Preview next digest without sending |
| `GET` | `/api/stats` | System health stats |
| `GET` | `/api/health` | Health check (no auth) |

### `POST /api/collect`

Request:
```json
{
  "url": "https://www.xiaohongshu.com/explore/abc123",
  "title": "Optional page title",
  "excerpt": "Optional selected text",
  "source": "extension",
  "tags": ["tech"]
}
```

Response 201:
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

Response 409 (duplicate):
```json
{ "ok": false, "error": "duplicate", "existing_item_id": "a1b2c3d4..." }
```

### `POST /api/digest`

Request (optional):
```json
{
  "since": "2026-03-24T00:00:00Z",
  "until": "2026-03-25T00:00:00Z",
  "dry_run": false
}
```

---

## 7. Feishu Card JSON Template

```json
{
  "msg_type": "interactive",
  "card": {
    "config": { "wide_screen_mode": true },
    "header": {
      "title": {
        "tag": "plain_text",
        "content": "Daily Reading Digest -- Mar 25, 2026"
      },
      "template": "blue"
    },
    "elements": [
      {
        "tag": "markdown",
        "content": "**Thematic Overview**\nToday's 8 articles span AI tooling, frontend architecture, and productivity workflows."
      },
      { "tag": "hr" },
      {
        "tag": "markdown",
        "content": "**1. Article Title**\n[source.com](https://source.com/article) | via Extension\n\nTwo-to-three sentence summary of the article's key insight."
      },
      { "tag": "hr" },
      {
        "tag": "note",
        "elements": [
          { "tag": "plain_text", "content": "8 items collected | Generated at 08:00 CST" }
        ]
      }
    ]
  }
}
```

> If > 20 items: split into multiple cards with headers "Daily Digest (1/2)" and "(2/2)". Send with 1-second delay between cards.

---

## 8. Chrome Extension Architecture

### Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| `background.js` (Service Worker) | API calls, auth, context menu handler |
| `popup.html/js` | Quick-collect UI, status display |
| `content.js` | Capture selected text, page metadata |
| `options.html/js` | API key configuration |

### Message Flow

```
User clicks extension icon
  → Popup opens
  → Popup → content.js: { action: "getPageInfo" }
  → content.js returns: { title, url, excerpt, ogDescription }
  → User clicks "Collect"
  → Popup → background.js: { action: "collect", url, title, excerpt }
  → background.js reads API_KEY from chrome.storage.sync
  → POST /api/collect
  → Show success/error in popup
```

### Manifest V3 Permissions

```json
{
  "manifest_version": 3,
  "permissions": ["activeTab", "contextMenus", "storage"],
  "host_permissions": ["https://collect.yourdomain.workers.dev/*"]
}
```

### Error States

| State | UI |
|-------|-----|
| No API key | "Set API key in settings" |
| Offline | "You are offline. Try again later." |
| 401 | "Invalid API key. Check settings." |
| 409 | "Already collected ✓" |
| Success | Green check badge for 3 seconds |

---

## 9. iOS Shortcut Flow

```
Share Sheet receives URL/text
  ↓
Match Text with regex https?://[^\s]+ (handles XHS text shares)
  ↓
POST /api/collect
  Headers: Authorization: Bearer <key>
  Body: { "url": "<url>", "source": "shortcut" }
  ↓
Check response "ok"
  → true:  Show notification "Collected successfully"
  → false: Check "error"
             "duplicate" → "Already collected"
             other       → "Failed: <error>"
```

**Xiaohongshu share text format**: `"这篇不错！https://xhslink.com/abc 复制链接打开小红书"`
→ Shortcut extracts URL via regex; Worker resolves redirect server-side during extraction.

---

## 10. Security Model

| Secret | Storage | Access |
|--------|---------|--------|
| `API_KEY` | `wrangler secret` | `env.API_KEY` |
| `DEEPSEEK_API_KEY` | `wrangler secret` | `env.DEEPSEEK_API_KEY` |
| `JINA_API_KEY` | `wrangler secret` | `env.JINA_API_KEY` |
| `FEISHU_WEBHOOK_URL` | `wrangler secret` | `env.FEISHU_WEBHOOK_URL` |

CORS: `Access-Control-Allow-Origin: *` — acceptable because API key is the security boundary, not CORS.

---

## 11. Project File Structure

```
collect-in-one/
├── wrangler.toml
├── package.json
├── tsconfig.json
├── .dev.vars                    # Local dev secrets (gitignored)
├── src/
│   ├── index.ts                 # Hono app + cron handler export
│   ├── types.ts                 # Env bindings, D1 types, API types
│   ├── routes/
│   │   ├── collect.ts
│   │   ├── items.ts
│   │   ├── digest.ts
│   │   ├── stats.ts
│   │   └── health.ts
│   ├── middleware/
│   │   ├── auth.ts
│   │   ├── cors.ts
│   │   └── error-handler.ts
│   ├── services/
│   │   ├── extractor.ts         # Jina Reader integration
│   │   ├── summarizer.ts        # DeepSeek API
│   │   ├── feishu.ts            # Webhook + card builder
│   │   └── url.ts               # Normalization, hashing, dedup
│   ├── cron/
│   │   ├── handler.ts           # Cron orchestration
│   │   ├── retry.ts
│   │   ├── summarize.ts
│   │   └── deliver.ts
│   ├── db/
│   │   ├── queries.ts           # Typed D1 query helpers
│   │   └── migrations/
│   │       └── 0001_initial.sql
│   └── prompts/
│       └── summarize.ts
├── extension/
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── popup.html / popup.js / popup.css
│   ├── options.html / options.js
│   └── icons/
├── docs/
│   ├── architecture.md          # This file
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

## 12. Key `wrangler.toml`

```toml
name = "collect-in-one"
main = "src/index.ts"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]

[triggers]
crons = ["0 0 * * *"]  # 00:00 UTC = 08:00 CST

[[d1_databases]]
binding = "DB"
database_name = "collect-in-one-db"
database_id = "<your-database-id>"
```

---

## 13. DeepSeek Prompt Template

```typescript
export function buildSummarizePrompt(items: Array<{
  title: string;
  url: string;
  content: string;
  excerpt?: string;
}>): string {
  const itemsText = items.map((item, i) =>
    `### Article ${i + 1}: ${item.title || 'Untitled'}
URL: ${item.url}
${item.excerpt ? `User note: ${item.excerpt}\n` : ''}
Content:
${item.content.slice(0, 3000)}
---`
  ).join('\n\n');

  return `You are a reading digest assistant. Summarize the following ${items.length} articles.

For each article, produce:
1. A concise title
2. A 2-3 sentence summary capturing the key insight
3. One keyword tag

After all summaries, write a "Thematic Overview" paragraph (3-4 sentences) identifying connections across today's articles.

Output as JSON:
{
  "items": [
    { "index": 1, "title": "...", "summary": "...", "tag": "..." }
  ],
  "thematic_overview": "..."
}

Articles:

${itemsText}`;
}
```

---

## 14. Observability Queries

```sql
-- System health overview
SELECT status, COUNT(*) as count FROM items GROUP BY status;

-- Failed items
SELECT id, url, last_error, retry_count, updated_at
FROM items
WHERE status IN ('failed', 'permanently_failed')
ORDER BY updated_at DESC;

-- Daily collection activity
SELECT date(created_at) as day, COUNT(*) as collected
FROM items
GROUP BY date(created_at)
ORDER BY day DESC LIMIT 14;
```

---

## 15. Implementation Order

| Phase | Content | Est. Time |
|-------|---------|-----------|
| 1 | Worker init + D1 schema + `/api/collect` + `/api/items` | 2-3h |
| 2 | Jina extraction with `waitUntil()` | 1-2h |
| 3 | Chrome Extension | 2-3h |
| 4 | DeepSeek summarization + Feishu delivery | 2-3h |
| 5 | Cron trigger + retry logic | 1-2h |
| 6 | iOS Shortcut | 30min |
| 7 | Stats endpoint + polish + tests | 2-3h |

**Total MVP: ~12-18 hours**
