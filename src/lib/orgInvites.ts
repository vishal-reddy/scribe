import type { Env } from '../types';
import { promoteSharedOrg } from './orgs';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface OrgInviteRow {
  id: string;
  org_id: string;
  email: string;
  role: string;
  token_hash: string;
  invited_by_user_id: string;
  expires_at: number;
  accepted_at: number | null;
  revoked_at: number | null;
  resent_at: number | null;
  created_at: number;
}

export function generateRawToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashRawToken(raw: string): Promise<string> {
  const enc = new TextEncoder().encode(raw);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function orgInviteLink(env: Env, rawToken: string): string {
  const base = env.ENVIRONMENT === 'production' ? 'https://scribe.kecker.co' : 'http://localhost:8787';
  return `${base}/auth/invite?token=${rawToken}`;
}

export async function createOrgInvite(
  env: Env,
  orgId: string,
  email: string,
  role: string,
  invitedByUserId: string
): Promise<{ inviteId: string; rawToken: string }> {
  await promoteSharedOrg(env, orgId);

  const rawToken = generateRawToken();
  const tokenHash = await hashRawToken(rawToken);
  const inviteId = `inv_${crypto.randomUUID()}`;
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO org_invites (id, org_id, email, role, token_hash, invited_by_user_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(inviteId, orgId, email.toLowerCase().trim(), role, tokenHash, invitedByUserId, now + INVITE_TTL_MS, now).run();

  return { inviteId, rawToken };
}

export async function sendOrgInviteEmail(
  env: Env,
  params: { to: string; orgName: string; invitedByEmail: string | null; inviteUrl: string }
): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    if (env.ENVIRONMENT !== 'production') {
      console.log(`[DEV] Org Invite Email to ${params.to}: ${params.inviteUrl}`);
    }
    return false;
  }

  const from = env.EMAIL_FROM || 'Scribe <onboarding@resend.dev>';
  const inviter = params.invitedByEmail ? `${params.invitedByEmail} has` : 'You have been';

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: `Join ${params.orgName} on Scribe`,
        text: `${inviter} invited you to collaborate in ${params.orgName} on Scribe.\n\nAccept your invite here: ${params.inviteUrl}\n\nThis invite expires in 7 days.`,
        html: `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:440px;margin:0 auto;padding:24px">
  <h2 style="color:#18181b;font-weight:600;margin:0 0 12px">Scribe</h2>
  <p style="color:#3f3f46;font-size:15px;line-height:1.5;margin:0 0 20px">
    ${inviter} invited you to collaborate in <strong>${params.orgName}</strong> on Scribe.
  </p>
  <div style="margin:24px 0">
    <a href="${params.inviteUrl}" style="background:#3a3a3c;color:#fafafa;padding:12px 24px;border-radius:8px;font-weight:600;text-decoration:none;display:inline-block">
      Join Workspace →
    </a>
  </div>
  <p style="color:#71717a;font-size:13px;margin:24px 0 0">
    This invite expires in 7 days. If you weren't expecting this, you can ignore this email.
  </p>
</div>`,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error('Failed to send org invite email:', err);
    return false;
  }
}

export async function createAndSendOrgInvite(
  env: Env,
  orgId: string,
  email: string,
  role: string,
  invitedByUserId: string
): Promise<{ inviteId: string; token: string; sent: boolean }> {
  const { inviteId, rawToken } = await createOrgInvite(env, orgId, email, role, invitedByUserId);

  const org = await env.DB.prepare("SELECT name FROM organizations WHERE id = ?")
    .bind(orgId).first<{ name: string }>();
  const inviter = await env.DB.prepare("SELECT email FROM users WHERE id = ?")
    .bind(invitedByUserId).first<{ email: string | null }>();

  const rawOrgName = org?.name ?? "a workspace";
  const orgName = (rawOrgName.includes('@') || /.*@.*'s Workspace/i.test(rawOrgName))
    ? "Shared Workspace"
    : rawOrgName;

  const sent = await sendOrgInviteEmail(env, {
    to: email,
    orgName,
    invitedByEmail: inviter?.email ?? null,
    inviteUrl: orgInviteLink(env, rawToken),
  });

  return { inviteId, token: rawToken, sent };
}

export async function lookupOrgInvite(env: Env, rawToken: string): Promise<(OrgInviteRow & { org_name: string }) | null> {
  const tokenHash = await hashRawToken(rawToken);
  const row = await env.DB.prepare(
    `SELECT oi.*, o.name as org_name
     FROM org_invites oi
     JOIN organizations o ON o.id = oi.org_id
     WHERE oi.token_hash = ?`
  ).bind(tokenHash).first<OrgInviteRow & { org_name: string }>();
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.accepted_at && !row.email.startsWith("link-invite") && row.email !== "link@invite") return null;
  if (row.expires_at < Date.now()) return null;
  return row;
}

export async function acceptOrgInvite(env: Env, inviteId: string, userId: string): Promise<{ orgId: string }> {
  const invite = await env.DB.prepare("SELECT org_id, email, role, accepted_at, revoked_at, expires_at FROM org_invites WHERE id = ?")
    .bind(inviteId).first<{ org_id: string; email: string; role: string; accepted_at: number | null; revoked_at: number | null; expires_at: number }>();
  if (!invite) throw new Error("Invite not found");
  if (invite.accepted_at && !invite.email.startsWith("link-invite") && invite.email !== "link@invite") throw new Error("Invite already accepted");
  if (invite.revoked_at) throw new Error("Invite has been revoked");
  if (invite.expires_at < Date.now()) throw new Error("Invite has expired");

  const now = Date.now();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO organization_members (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)"
  ).bind(invite.org_id, userId, invite.role, now).run();

  if (!invite.email.startsWith("link-invite") && invite.email !== "link@invite") {
    await env.DB.prepare("UPDATE org_invites SET accepted_at = ? WHERE id = ?").bind(now, inviteId).run();
  }
  await env.DB.prepare("UPDATE users SET active_org_id = ? WHERE id = ?").bind(invite.org_id, userId).run();

  return { orgId: invite.org_id };
}

export async function listPendingInvites(env: Env, orgId: string): Promise<OrgInviteRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM org_invites WHERE org_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC`
  ).bind(orgId, Date.now()).all<OrgInviteRow>();
  return results;
}

export async function resendOrgInvite(env: Env, inviteId: string): Promise<{ sent: boolean; token: string }> {
  const invite = await env.DB.prepare(
    `SELECT oi.*, o.name as org_name, u.email as invited_by_email
     FROM org_invites oi
     JOIN organizations o ON o.id = oi.org_id
     JOIN users u ON u.id = oi.invited_by_user_id
     WHERE oi.id = ?`
  ).bind(inviteId).first<OrgInviteRow & { org_name: string; invited_by_email: string | null }>();
  if (!invite || invite.revoked_at || (invite.accepted_at && !invite.email.startsWith("link-invite") && invite.email !== "link@invite")) {
    return { sent: false, token: '' };
  }

  const rawToken = generateRawToken();
  const tokenHash = await hashRawToken(rawToken);
  const now = Date.now();

  await env.DB.prepare(
    "UPDATE org_invites SET token_hash = ?, expires_at = ?, resent_at = ? WHERE id = ?"
  ).bind(tokenHash, now + INVITE_TTL_MS, now, inviteId).run();

  const sent = await sendOrgInviteEmail(env, {
    to: invite.email,
    orgName: invite.org_name,
    invitedByEmail: invite.invited_by_email,
    inviteUrl: orgInviteLink(env, rawToken),
  });

  return { sent, token: rawToken };
}

export async function revokeOrgInvite(env: Env, inviteId: string): Promise<void> {
  await env.DB.prepare("UPDATE org_invites SET revoked_at = ? WHERE id = ?").bind(Date.now(), inviteId).run();
}
