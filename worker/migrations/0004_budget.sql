CREATE TABLE ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  step TEXT NOT NULL,
  est_usd REAL NOT NULL,
  actual_usd REAL,
  request_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE budget_state (
  provider TEXT PRIMARY KEY,
  total_usd REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE kill_switch (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE rate_buckets (
  key TEXT PRIMARY KEY,
  tokens REAL NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_ledger_user_id_created_at ON ledger(user_id, created_at);
CREATE INDEX idx_ledger_provider_created_at ON ledger(provider, created_at);
