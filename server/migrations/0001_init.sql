-- Every synced record (session, task, project, template, settings) as a JSON document.
-- `version` is the record's own modified time; the newest version wins.
-- `seq` is a per-user, ever-increasing change number that devices pull from.
CREATE TABLE IF NOT EXISTS records (
  user_id TEXT NOT NULL,
  kind    TEXT NOT NULL,
  id      TEXT NOT NULL,
  version INTEGER NOT NULL,
  seq     INTEGER NOT NULL,
  data    TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, id)
);
CREATE INDEX IF NOT EXISTS records_by_seq ON records (user_id, seq);

CREATE TABLE IF NOT EXISTS counters (
  user_id TEXT PRIMARY KEY,
  seq     INTEGER NOT NULL
);

-- Sign-in sessions. Only a SHA-256 of the token is stored.
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS auth_sessions_by_email ON auth_sessions (email);
