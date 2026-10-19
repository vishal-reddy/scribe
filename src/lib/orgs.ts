import type { Env } from '../types';

export function personalOrgId(userId: string): string {
  return `org_personal_${userId}`;
}

/**
 * Idempotent: ensures the user has a personal organization and active_org_id set.
 */
export async function ensurePersonalOrg(env: Env, userId: string): Promise<string> {
  const orgId = personalOrgId(userId);
  const now = Date.now();

  await env.DB.prepare(
    "INSERT OR IGNORE INTO organizations (id, name, is_personal, owner_user_id, created_at) VALUES (?, 'Personal', 1, ?, ?)"
  ).bind(orgId, userId, now).run();

  await env.DB.prepare(
    "INSERT OR IGNORE INTO organization_members (org_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)"
  ).bind(orgId, userId, now).run();

  await env.DB.prepare(
    "UPDATE users SET active_org_id = ? WHERE id = ? AND active_org_id IS NULL"
  ).bind(orgId, userId).run();

  return orgId;
}

/**
 * Promoting a personal workspace restores the owner-identifying name when shared.
 */
export async function promoteSharedOrg(env: Env, orgId: string): Promise<void> {
  const org = await env.DB.prepare(
    "SELECT is_personal as isPersonal, owner_user_id as ownerUserId FROM organizations WHERE id = ?"
  ).bind(orgId).first<{ isPersonal: number; ownerUserId: string }>();
  if (!org || org.isPersonal !== 1) return;

  const owner = await env.DB.prepare("SELECT email FROM users WHERE id = ?")
    .bind(org.ownerUserId).first<{ email: string | null }>();
  const name = owner?.email ? `${owner.email}'s Workspace` : "Shared Workspace";

  await env.DB.prepare(
    "UPDATE organizations SET is_personal = 0, name = ? WHERE id = ? AND is_personal = 1"
  ).bind(name, orgId).run();
}

export async function isMember(env: Env, orgId: string, userId: string): Promise<{ role: string } | null> {
  const row = await env.DB.prepare(
    "SELECT role FROM organization_members WHERE org_id = ? AND user_id = ?"
  ).bind(orgId, userId).first<{ role: string }>();
  return row ?? null;
}

export async function requireRole(env: Env, orgId: string, userId: string, roles: string[]): Promise<void> {
  const member = await isMember(env, orgId, userId);
  if (!member || !roles.includes(member.role)) {
    throw new Error("Forbidden: insufficient role in this workspace");
  }
}

/**
 * Resolve the caller's active org ID:
 * 1. If headerOrgId specified and caller is a member, return it.
 * 2. Else check user's active_org_id in DB.
 * 3. Fall back to ensurePersonalOrg.
 */
export async function resolveScope(
  env: Env,
  userId: string,
  headerOrgId?: string | null
): Promise<string> {
  if (headerOrgId) {
    const member = await isMember(env, headerOrgId, userId);
    if (member) return headerOrgId;
  }

  const user = await env.DB.prepare("SELECT active_org_id FROM users WHERE id = ?")
    .bind(userId).first<{ active_org_id: string | null }>();
  if (user?.active_org_id) {
    const member = await isMember(env, user.active_org_id, userId);
    if (member) return user.active_org_id;
  }

  return ensurePersonalOrg(env, userId);
}

export async function createOrganization(env: Env, userId: string, name: string): Promise<string> {
  const orgId = `org_${crypto.randomUUID()}`;
  const now = Date.now();

  await env.DB.prepare(
    "INSERT INTO organizations (id, name, is_personal, owner_user_id, created_at) VALUES (?, ?, 0, ?, ?)"
  ).bind(orgId, name, userId, now).run();

  await env.DB.prepare(
    "INSERT INTO organization_members (org_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)"
  ).bind(orgId, userId, now).run();

  await env.DB.prepare(
    "UPDATE users SET active_org_id = ? WHERE id = ?"
  ).bind(orgId, userId).run();

  return orgId;
}

export async function listOrganizationsForUser(
  env: Env,
  userId: string
): Promise<Array<{ id: string; name: string; role: string; isPersonal: boolean }>> {
  await ensurePersonalOrg(env, userId);

  const { results } = await env.DB.prepare(
    `SELECT o.id, o.name, om.role, o.is_personal as isPersonal
     FROM organization_members om
     JOIN organizations o ON o.id = om.org_id
     WHERE om.user_id = ?
     ORDER BY o.is_personal DESC, o.created_at ASC`
  ).bind(userId).all<{ id: string; name: string; role: string; isPersonal: number }>();

  return results.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    isPersonal: r.isPersonal === 1,
  }));
}

export async function switchActiveOrg(env: Env, userId: string, orgId: string): Promise<void> {
  const member = await isMember(env, orgId, userId);
  if (!member) {
    throw new Error("You are not a member of this workspace");
  }

  await env.DB.prepare(
    "UPDATE users SET active_org_id = ? WHERE id = ?"
  ).bind(orgId, userId).run();
}

export async function listMembers(
  env: Env,
  orgId: string
): Promise<Array<{ userId: string; email: string; name: string | null; role: string; joinedAt: number }>> {
  const { results } = await env.DB.prepare(
    `SELECT om.user_id as userId, u.email, u.name, om.role, om.joined_at as joinedAt
     FROM organization_members om
     LEFT JOIN users u ON u.id = om.user_id
     WHERE om.org_id = ?
     ORDER BY om.joined_at ASC`
  ).bind(orgId).all<{ userId: string; email: string | null; name: string | null; role: string; joinedAt: number }>();

  return results.map((r) => ({
    userId: r.userId,
    email: r.email ?? '',
    name: r.name,
    role: r.role,
    joinedAt: r.joinedAt,
  }));
}

export async function removeMember(
  env: Env,
  orgId: string,
  targetUserId: string,
  requestingUserId: string
): Promise<void> {
  const requester = await isMember(env, orgId, requestingUserId);
  if (!requester) throw new Error("Forbidden");

  const org = await env.DB.prepare("SELECT owner_user_id, is_personal FROM organizations WHERE id = ?")
    .bind(orgId).first<{ owner_user_id: string; is_personal: number }>();
  if (!org) throw new Error("Workspace not found");
  if (org.is_personal === 1) throw new Error("Cannot modify members of a personal workspace");

  // Owner cannot be removed
  if (targetUserId === org.owner_user_id) {
    throw new Error("Cannot remove workspace owner");
  }

  // Self-leave is allowed for any non-owner; otherwise requires owner or admin
  const isSelf = targetUserId === requestingUserId;
  if (!isSelf && requester.role !== 'owner' && requester.role !== 'admin') {
    throw new Error("Forbidden: insufficient permissions to remove member");
  }

  await env.DB.prepare("DELETE FROM organization_members WHERE org_id = ? AND user_id = ?")
    .bind(orgId, targetUserId).run();

  // If user's active_org_id was this org, reset it to their personal org
  const user = await env.DB.prepare("SELECT active_org_id FROM users WHERE id = ?")
    .bind(targetUserId).first<{ active_org_id: string | null }>();
  if (user?.active_org_id === orgId) {
    const pOrg = personalOrgId(targetUserId);
    await env.DB.prepare("UPDATE users SET active_org_id = ? WHERE id = ?")
      .bind(pOrg, targetUserId).run();
  }
}
