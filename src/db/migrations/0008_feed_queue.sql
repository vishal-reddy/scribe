-- Feed auto-queue: mark a note when it's created/edited so the user's Claude
-- app can pull pending notes (list_notes_needing_feed) and generate feed posts.
-- Cleared once a post is created for the note. NULL = nothing pending.
ALTER TABLE documents ADD COLUMN feed_queued_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_documents_feed_queued_at ON documents (feed_queued_at);
