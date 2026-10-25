-- Google Sheets mirror: the change number last written to the sheet, so unchanged hours cost nothing.
CREATE TABLE IF NOT EXISTS mirror_state (
  user_id     TEXT PRIMARY KEY,
  seq         INTEGER NOT NULL,
  mirrored_at INTEGER NOT NULL
);
