import type { Env } from '../types';
import { lintGuidance } from '../mcp/writingGuidance';
import { isOrgAdmin } from './orgAccounts';
import { isMember } from './orgs';

/**
 * Organization philosophy: free-text instructions for how documents are filed, set at three levels. Classification is done
 * by the user's own assistant through MCP, so the philosophy is guidance handed to it, not code the server runs.
 *
 * Precedence for a document in workspace W (most specific wins): workspace W, then W's org, then the acting user, then the
 * built-in Thomistic default. A personal workspace has no org layer of its own (its hidden personal org is the user's).
 *
 * Who may change what: anyone can set their own (user); only owners and admins can set an org or a workspace's.
 */

export type PhilosophyScope = 'user' | 'org' | 'workspace';
export type PhilosophyLevel = PhilosophyScope | 'default';

export const PHILOSOPHY_MAX_LENGTH = 4000;

export class PhilosophyPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhilosophyPermissionError';
  }
}

export function parsePhilosophyScope(raw: unknown): PhilosophyScope | null {
  return raw === 'user' || raw === 'org' || raw === 'workspace' ? raw : null;
}

/** Trims and drops control characters (keeping newlines and tabs). Returns an error message for text that can't be stored. */
export function validatePhilosophyText(raw: unknown, scope: PhilosophyScope): { text: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'text must be a string' };
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (text.length > PHILOSOPHY_MAX_LENGTH) return { error: `text must be at most ${PHILOSOPHY_MAX_LENGTH} characters` };
  // Org and workspace philosophies are read by other people's assistants, so they must be transparent to those people.
  if (scope !== 'user') {
    const problems = lintGuidance(text);
    if (problems.length) return { error: `A shared philosophy must be transparent to the people it applies to: this text ${problems.join('; ')}.` };
  }
  return { text };
}

export interface PhilosophyRow {
  scope: PhilosophyScope;
  scopeId: string;
  instructions: string;
  updatedBy: string;
  updatedAt: number;
}

export async function getPhilosophy(env: Env, scope: PhilosophyScope, scopeId: string): Promise<PhilosophyRow | null> {
  const row = await env.DB.prepare(
    'SELECT instructions, updated_by AS updatedBy, updated_at AS updatedAt FROM philosophies WHERE scope_type = ? AND scope_id = ?'
  ).bind(scope, scopeId).first<{ instructions: string; updatedBy: string; updatedAt: number }>();
  return row?.instructions ? { scope, scopeId, ...row } : null;
}

/** The org (not personal) a workspace belongs to, or null for a personal workspace or an unknown id. */
export async function orgOfWorkspace(env: Env, workspaceId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT o.id AS orgId FROM organizations w JOIN orgs o ON o.id = w.org_id AND o.is_personal = 0 WHERE w.id = ?'
  ).bind(workspaceId).first<{ orgId: string }>();
  return row?.orgId ?? null;
}

/** Whether `userId` may change the philosophy at this scope. */
export async function canChangePhilosophy(env: Env, userId: string, scope: PhilosophyScope, scopeId: string): Promise<boolean> {
  if (!userId) return false;
  if (scope === 'user') return scopeId === userId;
  if (scope === 'org') return isOrgAdmin(env, scopeId, userId);
  const member = await isMember(env, scopeId, userId);
  return member?.role === 'owner' || member?.role === 'admin';
}

/** Whether `userId` may start a bulk restructure of a workspace: their own personal one, or an owner/admin of a shared one. */
export async function canRestructure(env: Env, userId: string, workspaceId: string): Promise<boolean> {
  if (!userId) return false;
  const ws = await env.DB.prepare('SELECT is_personal AS isPersonal, owner_user_id AS ownerUserId FROM organizations WHERE id = ?')
    .bind(workspaceId).first<{ isPersonal: number; ownerUserId: string }>();
  if (!ws) return false;
  if (ws.isPersonal === 1) return ws.ownerUserId === userId;
  return canChangePhilosophy(env, userId, 'workspace', workspaceId);
}

/** Set (non-empty text) or clear (empty text) a philosophy. Throws PhilosophyPermissionError for someone who may not change it. */
export async function setPhilosophy(env: Env, actorId: string, scope: PhilosophyScope, scopeId: string, text: string): Promise<void> {
  if (!(await canChangePhilosophy(env, actorId, scope, scopeId))) {
    throw new PhilosophyPermissionError(
      scope === 'user'
        ? 'You can only change your own philosophy.'
        : `Only owners and admins can change the ${scope === 'org' ? 'organization' : 'workspace'} philosophy.`
    );
  }
  if (!text) {
    await env.DB.prepare('DELETE FROM philosophies WHERE scope_type = ? AND scope_id = ?').bind(scope, scopeId).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO philosophies (scope_type, scope_id, instructions, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(scope_type, scope_id) DO UPDATE SET instructions = excluded.instructions, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).bind(scope, scopeId, text, actorId, Date.now()).run();
}

export interface EffectivePhilosophy {
  level: PhilosophyLevel;
  /** The id of the scope it came from; null for the default. */
  scopeId: string | null;
  /** The instructions in effect; null means the built-in Thomistic scheme. */
  text: string | null;
}

/** The philosophy in effect for `userId` filing into `workspaceId` (workspace, then org, then user, then default). */
export async function effectivePhilosophy(env: Env, userId: string, workspaceId: string | null): Promise<EffectivePhilosophy> {
  if (workspaceId) {
    const ws = await getPhilosophy(env, 'workspace', workspaceId);
    if (ws) return { level: 'workspace', scopeId: workspaceId, text: ws.instructions };
    const orgId = await orgOfWorkspace(env, workspaceId);
    if (orgId) {
      const org = await getPhilosophy(env, 'org', orgId);
      if (org) return { level: 'org', scopeId: orgId, text: org.instructions };
    }
  }
  if (userId) {
    const user = await getPhilosophy(env, 'user', userId);
    if (user) return { level: 'user', scopeId: userId, text: user.instructions };
  }
  return { level: 'default', scopeId: null, text: null };
}

/** Everything a settings screen needs for one workspace: each layer, what the caller may edit, and what is in effect. */
export async function philosophyOverview(env: Env, userId: string, workspaceId: string) {
  const orgId = await orgOfWorkspace(env, workspaceId);
  const [user, org, workspace, effective, canOrg, canWs] = await Promise.all([
    getPhilosophy(env, 'user', userId),
    orgId ? getPhilosophy(env, 'org', orgId) : Promise.resolve(null),
    getPhilosophy(env, 'workspace', workspaceId),
    effectivePhilosophy(env, userId, workspaceId),
    orgId ? canChangePhilosophy(env, userId, 'org', orgId) : Promise.resolve(false),
    canChangePhilosophy(env, userId, 'workspace', workspaceId),
  ]);
  return {
    effective,
    user: { scopeId: userId, text: user?.instructions ?? null, canEdit: true },
    org: orgId ? { scopeId: orgId, text: org?.instructions ?? null, canEdit: canOrg } : null,
    workspace: { scopeId: workspaceId, text: workspace?.instructions ?? null, canEdit: canWs },
  };
}
