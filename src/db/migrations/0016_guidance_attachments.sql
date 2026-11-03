-- Notes a writer attaches as guidance for their assistant (a style guide, a rubric, a glossary). The note's text is read
-- live when the guidance is resolved, so editing the attached note changes the guidance. Keyed by user, like the writer's
-- other layers: only the person who attached a note ever has it applied. document_id = '' means "all of my notes".
CREATE TABLE IF NOT EXISTS guidance_attachments (
  user_id            TEXT NOT NULL,
  document_id        TEXT NOT NULL DEFAULT '',
  source_document_id TEXT NOT NULL,
  created_at         INTEGER NOT NULL,
  PRIMARY KEY (user_id, document_id, source_document_id)
);
CREATE INDEX IF NOT EXISTS idx_guidance_attachments_source ON guidance_attachments (source_document_id);
