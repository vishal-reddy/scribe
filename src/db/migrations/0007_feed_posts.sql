-- Simulated learning feed: AI-generated snippets resurfaced from the user's
-- notes. Claude authors these over MCP (user_id NULL = visible to all, like
-- documents); the app reads them and can bookmark (saved_at).
CREATE TABLE IF NOT EXISTS feed_posts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  text TEXT NOT NULL,
  kind TEXT,
  author_name TEXT NOT NULL,
  author_handle TEXT NOT NULL,
  author_avatar TEXT,
  source_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  source_title TEXT,
  created_at INTEGER NOT NULL,
  saved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_feed_posts_created_at ON feed_posts (created_at);
CREATE INDEX IF NOT EXISTS idx_feed_posts_user_id ON feed_posts (user_id);
CREATE INDEX IF NOT EXISTS idx_feed_posts_source_document_id ON feed_posts (source_document_id);
CREATE INDEX IF NOT EXISTS idx_feed_posts_saved_at ON feed_posts (saved_at);
