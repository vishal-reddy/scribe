import type { Env } from "../types";
import { RegistryClient } from "./registryClient";
import { personalOrgAccountId } from "./orgAccounts";

interface HubOrg {
  id: string;
  name: string;
  isPersonal: boolean;
  ownerUserId: string;
  role: string;
  workspaceVisibility: string;
  externalProvider: string | null;
  externalId: string | null;
  createdAt: number;
  aliases?: Record<string, string[]>;
}

interface HubWorkspace {
  id: string;
  orgAccountId: string | null;
  name: string;
  isPersonal: boolean;
  ownerUserId: string;
  role: string;
  visibility: string;
  createdAt: number;
  updatedAt: number;
  aliases?: Record<string, string[]>;
}

/** The id this app already uses for a hub record: its legacy alias when it has one, else the hub's canonical id. */
const localId = (r: { id: string; aliases?: Record<string, string[]> }) => r.aliases?.scribe?.[0] ?? r.id;

/**
 * Makes this app show the orgs and workspaces the hub registry holds for the caller. The registry owns them; this copies
 * each one into the local tables (keyed by the id this app already uses, or the hub's id when it is new here) so the
 * existing role checks and content scoping keep working. Personal ones stay local. Best effort: when the hub is
 * unreachable or unconfigured the list is simply whatever this app already had.
 */
export async function mirrorRegistry(
  env: Env,
  user: { userId: string; email?: string },
  client: RegistryClient = new RegistryClient(env, user),
): Promise<void> {
  if (!client.configured) return;
  let orgs: HubOrg[];
  let workspaces: HubWorkspace[];
  try {
    [orgs, workspaces] = (await Promise.all([client.organizations(), client.workspaces()])) as [HubOrg[], HubWorkspace[]];
  } catch (e) {
    console.warn("registry mirror skipped:", e instanceof Error ? e.message : e);
    return;
  }

  const orgLocal = new Map<string, string>();
  const stmts: D1PreparedStatement[] = [];
  for (const o of orgs) {
    if (o.isPersonal) continue;
    const id = localId(o);
    orgLocal.set(o.id, id);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO orgs (id, name, is_personal, owner_user_id, workspace_visibility, external_provider, external_id, created_at)
         VALUES (?, ?, 0, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, workspace_visibility = excluded.workspace_visibility,
           external_provider = excluded.external_provider, external_id = excluded.external_id`,
      ).bind(id, o.name, o.ownerUserId || user.userId, o.workspaceVisibility, o.externalProvider, o.externalId, o.createdAt || Date.now()),
      env.DB.prepare(
        `INSERT INTO org_members (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(org_id, user_id) DO UPDATE SET role = excluded.role`,
      ).bind(id, user.userId, o.role, Date.now()),
    );
  }
  for (const w of workspaces) {
    if (w.isPersonal) continue;
    const id = localId(w);
    const parent = (w.orgAccountId && orgLocal.get(w.orgAccountId)) || personalOrgAccountId(user.userId);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO organizations (id, name, is_personal, owner_user_id, created_at, org_id, visibility)
         VALUES (?, ?, 0, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, org_id = excluded.org_id, visibility = excluded.visibility`,
      ).bind(id, w.name, w.ownerUserId || user.userId, w.createdAt || Date.now(), parent, w.visibility),
      env.DB.prepare(
        `INSERT INTO organization_members (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(org_id, user_id) DO UPDATE SET role = excluded.role`,
      ).bind(id, user.userId, w.role, Date.now()),
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
}

/** Mirrors for a signed-in user, looking up the email the hub matches people by. */
export async function mirrorRegistryFor(env: Env, userId: string): Promise<void> {
  if (!env.HUB_ADMIN_SECRET) return;
  const row = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first<{ email: string | null }>();
  await mirrorRegistry(env, { userId, email: row?.email || undefined });
}
