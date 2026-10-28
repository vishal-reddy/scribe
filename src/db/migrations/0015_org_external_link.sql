-- Provider-neutral link from an org to an external identity provider's organization, so the org model does not
-- depend on one vendor. `kinde_org_code` stays populated (dual-written) so the previous release keeps working
-- during rollout and can be rolled back to; drop it in a later migration.
ALTER TABLE orgs ADD COLUMN external_provider TEXT;
ALTER TABLE orgs ADD COLUMN external_id TEXT;
UPDATE orgs SET external_provider = 'kinde', external_id = kinde_org_code WHERE kinde_org_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orgs_external ON orgs (external_provider, external_id) WHERE external_id IS NOT NULL;
