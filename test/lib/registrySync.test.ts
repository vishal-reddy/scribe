import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations } from '../helpers';
import { mirrorRegistry } from '../../src/lib/registrySync';
import { RegistryClient } from '../../src/lib/registryClient';
import { listOrganizationsForUser } from '../../src/lib/orgs';
import { listOrgAccountsForUser } from '../../src/lib/orgAccounts';
import type { Env } from '../../src/types';

const e = env as unknown as Env;
const user = { userId: 'rs_user1', email: 'rs1@kecker.co' };

function hub(orgs: unknown[], workspaces: unknown[], status = 200) {
  const fetcher = (async (url: string) =>
    new Response(JSON.stringify(url.endsWith('/organizations') ? { organizations: orgs } : { workspaces }), { status })) as unknown as typeof fetch;
  return new RegistryClient({ HUB_URL: 'https://hub.test', HUB_ADMIN_SECRET: 's' }, user, fetcher);
}

const org = { id: 'orgacct_swim', name: 'SwimRay USA', isPersonal: false, ownerUserId: 'x', role: 'admin', workspaceVisibility: 'org_members', externalProvider: null, externalId: null, createdAt: 1, aliases: {} };
const ws = { id: 'ws_swim', orgAccountId: 'orgacct_swim', name: 'Swimray USA', isPersonal: false, ownerUserId: 'x', role: 'member', visibility: 'inherit', createdAt: 1, updatedAt: 1, aliases: {} };

describe('mirrorRegistry', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
    await env.DB.prepare('INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, 1)').bind(user.userId, user.email).run();
  });

  it('shows a hub org and workspace here, once, under the hub id', async () => {
    await mirrorRegistry(e, user, hub([org], [ws]));
    await mirrorRegistry(e, user, hub([org], [{ ...ws, name: 'Swimray USA renamed' }]));
    const list = await listOrganizationsForUser(e, user.userId);
    expect(list.filter((w) => w.id === 'ws_swim').map((w) => [w.name, w.role, w.orgAccountId])).toEqual([['Swimray USA renamed', 'member', 'orgacct_swim']]);
    expect((await listOrgAccountsForUser(e, user.userId)).map((o) => [o.id, o.role])).toEqual([['orgacct_swim', 'admin']]);
  });

  it('keeps the legacy id when the hub has an alias for it', async () => {
    const u2 = { userId: 'rs_user2', email: 'rs2@kecker.co' };
    await env.DB.prepare('INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, 1)').bind(u2.userId, u2.email).run();
    await mirrorRegistry(e, u2, hub([], [{ ...ws, id: 'ws_other', aliases: { scribe: ['org_legacy1'] } }]));
    const ids = (await listOrganizationsForUser(e, u2.userId)).map((w) => w.id);
    expect(ids).toContain('org_legacy1');
    expect(ids).not.toContain('ws_other');
  });

  it('does nothing when the hub is unreachable', async () => {
    await expect(mirrorRegistry(e, user, hub([], [], 500))).resolves.toBeUndefined();
  });
});
