-- The writer's own layers on top of Scribe's default writing guidance (see src/mcp/writingGuidance.ts).
-- One row per (user, scope). document_id = '' is "all of my notes", otherwise one note. Keyed by user so a layer is only
-- ever shown to the person who wrote it, even on shared or legacy notes.
CREATE TABLE IF NOT EXISTS writing_guidance (
  user_id     TEXT NOT NULL,
  document_id TEXT NOT NULL DEFAULT '',
  text        TEXT NOT NULL,
  mode        TEXT NOT NULL DEFAULT 'append', -- 'append' adds to what is above it, 'replace' overrides it
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, document_id)
);

-- Instructions an author attaches to a document they own (a teacher's notes for a shared assignment, say). Anyone who
-- can read the document can read them. They only shape someone's assistant after that person adopts them.
CREATE TABLE IF NOT EXISTS document_author_guidance (
  document_id    TEXT PRIMARY KEY,
  author_user_id TEXT NOT NULL,
  author_name    TEXT NOT NULL DEFAULT '',
  text           TEXT NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1, -- bumped on every edit, an adoption only counts for the version it saw
  updated_at     INTEGER NOT NULL,
  -- locked = copied from a template, so nobody can edit the text in this copy (the reader can still stop following it)
  locked             INTEGER NOT NULL DEFAULT 0,
  source_document_id TEXT,
  source_author_name TEXT
);

-- Documents their owner has published as templates. A template's guidance is locked in the copies people work in,
-- and anyone who can read the template can fork it into a new template of their own with editable guidance.
CREATE TABLE IF NOT EXISTS document_templates (
  document_id TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guidance_adoptions (
  user_id     TEXT NOT NULL,
  document_id TEXT NOT NULL,
  version     INTEGER NOT NULL,
  accepted_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, document_id)
);
