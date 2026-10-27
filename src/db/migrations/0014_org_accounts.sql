-- Org model: an ORG (a business account, optionally linked to a Kinde organization) owns many WORKSPACES.
-- Naming note: the older `organizations` / `organization_members` tables hold WORKSPACES and their explicit members.
-- Every user has a hidden personal org (is_personal = 1) that exists only to contain their personal workspace and any
-- workspace they create on their own. It is never shown to people as an org.
CREATE TABLE IF NOT EXISTS orgs (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  is_personal          INTEGER NOT NULL DEFAULT 0,
  owner_user_id        TEXT NOT NULL,
  kinde_org_code       TEXT UNIQUE,
  -- who in the org can see its workspaces without being added to them: org_members | org_admins | invite_only
  workspace_visibility TEXT NOT NULL DEFAULT 'org_members',
  created_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS org_members (
  org_id    TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  role      TEXT NOT NULL DEFAULT 'member',
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON org_members (user_id);

ALTER TABLE organizations ADD COLUMN org_id TEXT;
-- per-workspace override of the org default: inherit | org_members | org_admins | invite_only
ALTER TABLE organizations ADD COLUMN visibility TEXT NOT NULL DEFAULT 'inherit';
CREATE INDEX IF NOT EXISTS idx_organizations_org_id ON organizations (org_id);

-- Backfill: a hidden personal org for every user and every workspace owner, and every existing workspace sits in its owner's.
INSERT OR IGNORE INTO orgs (id, name, is_personal, owner_user_id, created_at)
  SELECT 'orgp_' || id, 'Personal', 1, id, CAST(strftime('%s','now') AS INTEGER) * 1000 FROM users;
INSERT OR IGNORE INTO orgs (id, name, is_personal, owner_user_id, created_at)
  SELECT 'orgp_' || owner_user_id, 'Personal', 1, owner_user_id, CAST(strftime('%s','now') AS INTEGER) * 1000 FROM organizations;
INSERT OR IGNORE INTO org_members (org_id, user_id, role, joined_at)
  SELECT id, owner_user_id, 'owner', created_at FROM orgs WHERE is_personal = 1;
UPDATE organizations SET org_id = 'orgp_' || owner_user_id WHERE org_id IS NULL;
