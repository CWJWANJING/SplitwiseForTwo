-- Amounts are integers in the currency's minor unit (cents). Users are 1 and 2.
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE recurring (
  id TEXT PRIMARY KEY,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly','yearly')),
  anchor_day INTEGER NOT NULL,
  next_date TEXT NOT NULL,
  template TEXT NOT NULL,           -- JSON of the transaction fields
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- kind = expense : paidN = what user N paid,      shareN = what user N owes
-- kind = income  : paidN = what user N received,  shareN = what user N is entitled to
-- kind = payment : paidN = what user N sent,      shareN = what user N received
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('expense','income','payment')),
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  date TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  group_id TEXT REFERENCES groups(id),
  notes TEXT NOT NULL DEFAULT '',
  paid1 INTEGER NOT NULL, paid2 INTEGER NOT NULL,
  share1 INTEGER NOT NULL, share2 INTEGER NOT NULL,
  split TEXT NOT NULL DEFAULT '{}', -- JSON of the split form inputs, for editing
  recurring_id TEXT REFERENCES recurring(id),
  has_receipt INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (paid1 + paid2 = amount AND share1 + share2 = amount)
);
CREATE INDEX tx_date ON transactions(deleted_at, date DESC);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id),
  user_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX comments_tx ON comments(transaction_id);

CREATE TABLE receipts (
  transaction_id TEXT PRIMARY KEY REFERENCES transactions(id),
  mime TEXT NOT NULL,
  data TEXT NOT NULL                -- base64, compressed client-side to < 700 KB
);

CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  transaction_id TEXT,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES ('default_currency', 'USD');

CREATE TABLE login_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL
);
