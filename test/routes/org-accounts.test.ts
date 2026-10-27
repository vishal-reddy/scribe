import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../../src/index';
import { applyMigrations, getAuthHeaders, userIdFor } from '../helpers';
import { syncKindeOrgMembership } from '../../src/lib/orgAccounts';

const J = { 'Content-Type': 'application/json' };
const h = (email: string) => ({ ...getAuthHeaders(email), ...J });
const call = (email: string, method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: h(email), body: body === undefined ? undefined : JSON.stringify(body) }, env);
const json = async (r: Response) => (await r.json()) as any;

const owner = 'org-owner@example.com';
const admin = 'org-admin@example.com';
const member = 'org-member@example.com';
const outsider = 'org-outsider@example.com';

async function signUp(...emails: string[]) {
  for (const e of emails) await call(e, 'GET', '/api/orgs'); // creates the user row and personal workspace
}
const workspaceIds = async (email: string) => (await json(await call(email, 'GET', '/api/orgs'))).organizations.map((o: any) => o.id) as string[];

async function makeOrgWithWorkspace() {
  const org = (await json(await call(owner, 'POST', '/api/org-accounts', { name: 'Acme' }))).id as string;
  expect((await call(owner, 'POST', `/api/org-accounts/${org}/members`, { email: admin, role: 'admin' })).status).toBe(201);
  expect((await call(owner, 'POST', `/api/org-accounts/${org}/members`, { email: member, role: 'member' })).status).toBe(201);
  const ws = (await json(await call(owner, 'POST', '/api/orgs', { name: 'Team notes', orgAccountId: org }))).id as string;
  return { org, ws };
}

async function addDoc(workspaceId: string, ownerEmail: string) {
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO documents (id, user_id, org_id, title, content, markdown, created_at, updated_at, created_by, last_edited_by)
     VALUES (?, ?, ?, 'Team doc', '', 'team body', ?, ?, 'user', 'user')`
  ).bind(id, await userIdFor(ownerEmail), workspaceId, now, now).run();
  return id;
}

describe('orgs, workspaces and visibility', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
    await signUp(owner, admin, member, outsider);
  });

  it('keeps the personal org hidden', async () => {
    expect((await json(await call(owner, 'GET', '/api/org-accounts'))).orgs).toEqual([]);
    const ws = (await json(await call(owner, 'GET', '/api/orgs'))).organizations;
    const personal = ws.find((w: any) => w.isPersonal);
    expect(personal.orgAccountId).toBeNull(); // a workspace in the hidden personal org reports no org
  });

  it('lets an org owner create workspaces in an org, and only owners and admins', async () => {
    const { org } = await makeOrgWithWorkspace();
    expect((await call(member, 'POST', '/api/orgs', { name: 'Nope', orgAccountId: org })).status).toBe(403);
    expect((await call(admin, 'POST', '/api/orgs', { name: 'Admin made', orgAccountId: org })).status).toBe(201);
    expect((await call(outsider, 'POST', '/api/orgs', { name: 'Nope', orgAccountId: org })).status).toBe(403);
  });

  it('default visibility: every org member sees the workspace, outsiders do not', async () => {
    const { ws } = await makeOrgWithWorkspace();
    const doc = await addDoc(ws, owner);
    expect(await workspaceIds(member)).toContain(ws);
    expect(await workspaceIds(admin)).toContain(ws);
    expect(await workspaceIds(outsider)).not.toContain(ws);
    expect((await call(member, 'GET', `/api/documents/${doc}`)).status).toBe(200);
    expect((await call(outsider, 'GET', `/api/documents/${doc}`)).status).toBe(404);
  });

  it('org-admins-only hides workspaces from plain members; invite-only hides them from admins too', async () => {
    const { org, ws } = await makeOrgWithWorkspace();
    const doc = await addDoc(ws, owner);

    expect((await call(owner, 'PATCH', `/api/org-accounts/${org}`, { workspaceVisibility: 'org_admins' })).status).toBe(200);
    expect(await workspaceIds(member)).not.toContain(ws);
    expect((await call(member, 'GET', `/api/documents/${doc}`)).status).toBe(404);
    expect(await workspaceIds(admin)).toContain(ws);
    expect((await call(admin, 'GET', `/api/documents/${doc}`)).status).toBe(200);

    expect((await call(owner, 'PATCH', `/api/org-accounts/${org}`, { workspaceVisibility: 'invite_only' })).status).toBe(200);
    expect(await workspaceIds(admin)).not.toContain(ws);
    expect((await call(admin, 'GET', `/api/documents/${doc}`)).status).toBe(404);
    expect(await workspaceIds(owner)).toContain(ws); // the workspace's own members always keep access
  });

  it('a workspace can override the org default, and sharing it brings it into someone\'s list', async () => {
    const { org, ws } = await makeOrgWithWorkspace();
    await call(owner, 'PATCH', `/api/org-accounts/${org}`, { workspaceVisibility: 'org_members' });
    expect((await call(owner, 'PATCH', `/api/orgs/${ws}/settings`, { visibility: 'invite_only' })).status).toBe(200);
    expect(await workspaceIds(member)).not.toContain(ws);

    // Add the outsider to the workspace itself (what accepting an invite does): it appears in their list.
    await env.DB.prepare("INSERT INTO organization_members (org_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)")
      .bind(ws, await userIdFor(outsider), Date.now()).run();
    expect(await workspaceIds(outsider)).toContain(ws);
    expect(await workspaceIds(member)).not.toContain(ws);

    expect((await call(owner, 'PATCH', `/api/orgs/${ws}/settings`, { visibility: 'inherit' })).status).toBe(200);
    expect(await workspaceIds(member)).toContain(ws);
  });

  it('only admins can change settings, and a personal workspace stays private', async () => {
    const { org, ws } = await makeOrgWithWorkspace();
    expect((await call(member, 'PATCH', `/api/org-accounts/${org}`, { workspaceVisibility: 'org_admins' })).status).toBe(403);
    expect((await call(member, 'PATCH', `/api/orgs/${ws}/settings`, { visibility: 'org_admins' })).status).toBe(403);
    expect((await call(outsider, 'PATCH', `/api/org-accounts/${org}`, { name: 'Hijack' })).status).toBe(403);
    expect((await call(admin, 'PATCH', `/api/org-accounts/${org}`, { workspaceVisibility: 'bogus' })).status).toBe(400);

    const personal = (await json(await call(owner, 'GET', '/api/orgs'))).organizations.find((w: any) => w.isPersonal).id;
    expect((await call(owner, 'PATCH', `/api/orgs/${personal}/settings`, { visibility: 'org_members' })).status).toBe(403);
  });

  it('moves a workspace you own into an org only if you administer that org', async () => {
    const { org } = await makeOrgWithWorkspace();
    const mine = (await json(await call(member, 'POST', '/api/orgs', { name: 'Member workspace' }))).id as string;
    expect((await call(member, 'POST', `/api/org-accounts/${org}/workspaces`, { workspaceId: mine })).status).toBe(403); // member is not an org admin
    const adminWs = (await json(await call(admin, 'POST', '/api/orgs', { name: 'Admin personal-org workspace' }))).id as string;
    expect((await call(admin, 'POST', `/api/org-accounts/${org}/workspaces`, { workspaceId: adminWs })).status).toBe(200);
    expect(await workspaceIds(member)).toContain(adminWs); // now visible to the org by default
  });

  it('follows Kinde: only linked orgs sync, the owner is never dropped', async () => {
    const { org } = await makeOrgWithWorkspace();
    const other = (await json(await call(owner, 'POST', '/api/org-accounts', { name: 'Unlinked' }))).id as string;
    expect((await call(admin, 'PUT', `/api/org-accounts/${org}/kinde`, { kindeOrgCode: 'org_x' })).status).toBe(403); // owner only
    expect((await call(owner, 'PUT', `/api/org-accounts/${org}/kinde`, { kindeOrgCode: 'org_acme' })).status).toBe(200);

    const stranger = 'kinde-newcomer@example.com';
    await signUp(stranger);
    const sid = await userIdFor(stranger);
    await syncKindeOrgMembership(env, sid, ['org_acme']);
    expect((await json(await call(stranger, 'GET', '/api/org-accounts'))).orgs.map((o: any) => o.id)).toEqual([org]);

    await syncKindeOrgMembership(env, sid, []); // removed from the Kinde org
    expect((await json(await call(stranger, 'GET', '/api/org-accounts'))).orgs).toEqual([]);

    await syncKindeOrgMembership(env, await userIdFor(owner), []); // the owner is never dropped
    expect((await json(await call(owner, 'GET', '/api/org-accounts'))).orgs.map((o: any) => o.id)).toContain(org);
    expect((await json(await call(owner, 'GET', '/api/org-accounts'))).orgs.map((o: any) => o.id)).toContain(other);
  });
});
