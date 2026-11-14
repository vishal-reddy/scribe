-- Organization philosophy: free-text instructions for how documents are filed, set per user, org or workspace.
-- Absent = the built-in Thomistic scheme. scope_type: 'user' (scope_id = user id) | 'org' (orgs.id) | 'workspace' (organizations.id).
CREATE TABLE IF NOT EXISTS philosophies (
  scope_type   TEXT NOT NULL,
  scope_id     TEXT NOT NULL,
  instructions TEXT NOT NULL,
  updated_by   TEXT NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (scope_type, scope_id)
);
