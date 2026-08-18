-- Ephemeral notes: MCP-created quick notes that self-expire after a TTL
-- (default 30 days, configurable) unless converted to permanent via
-- POST /api/documents/:id/persist. A daily Cron Trigger sweeps expired rows.
ALTER TABLE documents ADD COLUMN is_ephemeral INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN expires_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_documents_expires_at ON documents (expires_at);

-- Small generic key/value store for app-wide settings (not per-user — MCP
-- calls have no per-user identity today). Holds e.g. "ephemeral_ttl_days".
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
