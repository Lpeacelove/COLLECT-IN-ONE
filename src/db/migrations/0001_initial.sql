CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  url TEXT NOT NULL,
  url_hash TEXT NOT NULL,
  title TEXT,
  excerpt TEXT,
  source TEXT NOT NULL DEFAULT 'unknown',
  tags TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'extracting', 'extracted',
      'summarizing', 'summarized', 'delivered',
      'failed', 'permanently_failed'
    )),
  content TEXT,
  content_length INTEGER DEFAULT 0,
  summary TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
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


CREATE TABLE IF NOT EXISTS digest_items (
  digest_id TEXT NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (digest_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_digest_items_item ON digest_items(item_id);
