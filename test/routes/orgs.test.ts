import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../../src/index';
import { applyMigrations, getAuthHeaders, userIdFor } from '../helpers';

describe('Organizations API', () => {
  const aliceEmail = 'alice@example.com';
  const bobEmail = 'bob@example.com';
  const aliceAuth = getAuthHeaders(aliceEmail);
  const bobAuth = getAuthHeaders(bobEmail);

  let createdOrgId: string;
  let bobUserId: string;

  beforeAll(async () => {
    await applyMigrations(env.DB);
    bobUserId = await userIdFor(bobEmail);
  });

  describe('GET /api/orgs', () => {
    it('should require authentication', async () => {
      const res = await app.request('/api/orgs', {}, env);
      expect(res.status).toBe(401);
    });

    it('should list organizations for user and auto-create personal org', async () => {
      const res = await app.request('/api/orgs', {
        headers: aliceAuth,
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data).toHaveProperty('organizations');
      expect(Array.isArray(data.organizations)).toBe(true);
      expect(data.organizations.length).toBeGreaterThanOrEqual(1);

      const personal = data.organizations.find((o: any) => o.isPersonal);
      expect(personal).toBeDefined();
      expect(personal.role).toBe('owner');
      expect(data).toHaveProperty('activeOrgId');
      expect(data.activeOrgId).toBe(personal.id);
    });
  });

  describe('POST /api/orgs', () => {
    it('should require a name', async () => {
      const res = await app.request('/api/orgs', {
        method: 'POST',
        headers: { ...aliceAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      }, env);

      expect(res.status).toBe(400);
    });

    it('should create a new organization and make user owner', async () => {
      const res = await app.request('/api/orgs', {
        method: 'POST',
        headers: { ...aliceAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Acme Research' }),
      }, env);

      expect(res.status).toBe(201);
      const data: any = await res.json();
      expect(data).toHaveProperty('organization');
      expect(data.organization.name).toBe('Acme Research');
      expect(data.organization.role).toBe('owner');
      createdOrgId = data.organization.id;
    });
  });

  describe('POST /api/orgs/switch', () => {
    it('should switch active organization', async () => {
      const res = await app.request('/api/orgs/switch', {
        method: 'POST',
        headers: { ...aliceAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: createdOrgId }),
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.activeOrgId).toBe(createdOrgId);

      // Verify listing reflects the new active org
      const listRes = await app.request('/api/orgs', {
        headers: aliceAuth,
      }, env);
      const listData: any = await listRes.json();
      expect(listData.activeOrgId).toBe(createdOrgId);
    });
  });

  describe('Org Members and Invites', () => {
    it('should list members of created org', async () => {
      const res = await app.request(`/api/orgs/${createdOrgId}/members`, {
        headers: aliceAuth,
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data).toHaveProperty('members');
      expect(data.members.length).toBe(1);
      expect(data.members[0].role).toBe('owner');
    });

    it('should create an invite for bob', async () => {
      const res = await app.request(`/api/orgs/${createdOrgId}/invites`, {
        method: 'POST',
        headers: { ...aliceAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: bobEmail, role: 'editor' }),
      }, env);

      expect(res.status).toBe(201);
      const data: any = await res.json();
      expect(data).toHaveProperty('inviteId');
      expect(data).toHaveProperty('token');

      // Bob accepts invite
      const acceptRes = await app.request('/api/orgs/invites/accept', {
        method: 'POST',
        headers: { ...bobAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: data.token }),
      }, env);

      expect(acceptRes.status).toBe(200);
      const acceptData: any = await acceptRes.json();
      expect(acceptData.orgId).toBe(createdOrgId);

      // Verify bob is now in member list
      const membersRes = await app.request(`/api/orgs/${createdOrgId}/members`, {
        headers: aliceAuth,
      }, env);
      const membersData: any = await membersRes.json();
      expect(membersData.members.length).toBe(2);
      const bobMember = membersData.members.find((m: any) => m.userId === bobUserId);
      expect(bobMember).toBeDefined();
    });

    it('should remove bob from the org', async () => {
      const res = await app.request(`/api/orgs/${createdOrgId}/members/${bobUserId}`, {
        method: 'DELETE',
        headers: aliceAuth,
      }, env);

      expect(res.status).toBe(200);

      // Verify bob is gone
      const membersRes = await app.request(`/api/orgs/${createdOrgId}/members`, {
        headers: aliceAuth,
      }, env);
      const membersData: any = await membersRes.json();
      expect(membersData.members.length).toBe(1);
    });
  });
});
