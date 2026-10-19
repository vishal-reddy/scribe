-- Organizations (shared workspaces) and Document Sharing (per-resource ACL)

CREATE TABLE IF NOT EXISTS organizations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  is_personal   INTEGER NOT NULL DEFAULT 0,
  owner_user_id TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_members (
  org_id     TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member', -- 'owner' | 'admin' | 'member'
  joined_at  INTEGER NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members (user_id);

CREATE TABLE IF NOT EXISTS org_invites (
  id                  TEXT PRIMARY KEY,   -- inv_<uuid>
  org_id              TEXT NOT NULL,
  email               TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'member',
  token_hash          TEXT NOT NULL UNIQUE,
  invited_by_user_id  TEXT NOT NULL,
  expires_at          INTEGER NOT NULL,
  accepted_at         INTEGER,
  revoked_at          INTEGER,
  resent_at           INTEGER,
  created_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_invites_org ON org_invites (org_id);
CREATE INDEX IF NOT EXISTS idx_org_invites_email ON org_invites (email);

CREATE TABLE IF NOT EXISTS document_shares (
  id                  TEXT PRIMARY KEY,   -- share_<uuid>
  document_id         TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id             TEXT,
  email               TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'viewer', -- 'viewer' | 'editor'
  created_by_user_id  TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_shares_doc ON document_shares (document_id);
CREATE INDEX IF NOT EXISTS idx_doc_shares_user ON document_shares (user_id);
CREATE INDEX IF NOT EXISTS idx_doc_shares_email ON document_shares (email);

ALTER TABLE users ADD COLUMN active_org_id TEXT;
ALTER TABLE documents ADD COLUMN org_id TEXT;
CREATE INDEX IF NOT EXISTS idx_documents_org ON documents (org_id);

-- Backfill: every existing user gets their deterministic personal org
INSERT INTO organizations (id, name, is_personal, owner_user_id, created_at)
SELECT 'org_personal_' || id, coalesce(name, email) || '''s Workspace', 1, id, created_at
FROM users
WHERE NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = 'org_personal_' || users.id);

INSERT INTO organization_members (org_id, user_id, role, joined_at)
SELECT 'org_personal_' || id, id, 'owner', created_at
FROM users
WHERE NOT EXISTS (SELECT 1 FROM organization_members m WHERE m.org_id = 'org_personal_' || users.id AND m.user_id = users.id);

UPDATE users SET active_org_id = 'org_personal_' || id WHERE active_org_id IS NULL;
UPDATE documents SET org_id = 'org_personal_' || user_id WHERE org_id IS NULL AND user_id IS NOT NULL;
