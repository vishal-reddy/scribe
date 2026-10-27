-- A document is reachable at /d/:id by anyone only while it has a row here. Publishing is an explicit act by the owner
-- (POST /api/documents/:id/publish) and can be revoked (DELETE). Before this table, any document id was a public link.
CREATE TABLE IF NOT EXISTS published_documents (
  document_id  TEXT PRIMARY KEY,
  published_by TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  -- 'public' = anyone with the link; 'org' = signed-in people who can already read the document (its organization's members)
  visibility   TEXT NOT NULL DEFAULT 'public'
);
