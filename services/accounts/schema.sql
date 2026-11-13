CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'direct',
  created_at TEXT NOT NULL,
  is_test INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  activity_at TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS rate_windows (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activity (
  user_id TEXT NOT NULL REFERENCES users(id),
  event_id TEXT NOT NULL,
  day TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  action TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, event_id)
);
CREATE INDEX IF NOT EXISTS activity_user_day ON activity(user_id, day);
CREATE INDEX IF NOT EXISTS activity_day ON activity(day, user_id);
CREATE TABLE IF NOT EXISTS account_emails (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  verified_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS email_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  code_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  used TEXT NOT NULL DEFAULT '',
  UNIQUE(email,purpose,subject)
);
