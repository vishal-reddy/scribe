import type { Env } from '../types';
import { appBaseUrl } from './urls';
import { isMember } from './orgs';

export interface DocumentPermission {
  canRead: boolean;
  canWrite: boolean;
  isOwner: boolean;
  role: 'owner' | 'admin' | 'editor' | 'member' | 'viewer' | null;
  source: 'owner' | 'org' | 'direct' | 'legacy' | null;
}

export interface DocumentShareRow {
  id: string;
  documentId: string;
  userId: string | null;
  email: string;
  role: 'viewer' | 'editor';
  createdByUserId: string;
  createdAt: number;
  updatedAt: number;
}

export async function getDocumentPermission(
  env: Env,
  documentId: string,
  userId: string | null,
  activeOrgId?: string | null
): Promise<DocumentPermission> {
  const doc = await env.DB.prepare(
    "SELECT id, user_id as userId, org_id as orgId FROM documents WHERE id = ?"
  ).bind(documentId).first<{ id: string; userId: string | null; orgId: string | null }>();

  if (!doc) {
    return { canRead: false, canWrite: false, isOwner: false, role: null, source: null };
  }

  // Ownerless documents grant nothing to anyone (they used to grant everyone full access).
  if (!doc.userId || !userId) {
    return { canRead: false, canWrite: false, isOwner: false, role: null, source: null };
  }

  // Direct owner
  if (doc.userId === userId) {
    return { canRead: true, canWrite: true, isOwner: true, role: 'owner', source: 'owner' };
  }

  // Organization membership
  if (doc.orgId) {
    const member = await isMember(env, doc.orgId, userId);
    if (member) {
      // Organization owner, admin, or member can read and edit shared workspace documents
      return {
        canRead: true,
        canWrite: true,
        isOwner: member.role === 'owner',
        role: member.role as 'owner' | 'admin' | 'member',
        source: 'org',
      };
    }
  }

  // Direct share by userId or email
  const user = await env.DB.prepare("SELECT email FROM users WHERE id = ?")
    .bind(userId).first<{ email: string | null }>();
  const email = user?.email?.toLowerCase().trim() ?? '';

  const share = await env.DB.prepare(
    `SELECT role FROM document_shares
     WHERE document_id = ? AND (user_id = ? OR (email = ? AND email != ''))
     LIMIT 1`
  ).bind(documentId, userId, email).first<{ role: string }>();

  if (share) {
    const isEditor = share.role === 'editor';
    return {
      canRead: true,
      canWrite: isEditor,
      isOwner: false,
      role: share.role as 'editor' | 'viewer',
      source: 'direct',
    };
  }

  return { canRead: false, canWrite: false, isOwner: false, role: null, source: null };
}

export async function shareDocument(
  env: Env,
  documentId: string,
  email: string,
  role: 'viewer' | 'editor',
  requestingUserId: string
): Promise<{ shareId: string }> {
  const perm = await getDocumentPermission(env, documentId, requestingUserId);
  if (!perm.isOwner && perm.role !== 'admin') {
    throw new Error("Forbidden: only the document owner or workspace admin can share this document");
  }

  const cleanEmail = email.toLowerCase().trim();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error("A valid email address is required");
  }

  // Check if user exists, or derive deterministic hash
  const existingUser = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(cleanEmail).first<{ id: string }>();
  let targetUserId = existingUser?.id ?? null;
  if (!targetUserId) {
    const data = new TextEncoder().encode(cleanEmail);
    const hash = await crypto.subtle.digest('SHA-256', data);
    targetUserId = Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  const now = Date.now();
  const existingShare = await env.DB.prepare(
    "SELECT id FROM document_shares WHERE document_id = ? AND email = ?"
  ).bind(documentId, cleanEmail).first<{ id: string }>();

  let shareId: string;
  if (existingShare) {
    shareId = existingShare.id;
    await env.DB.prepare(
      "UPDATE document_shares SET role = ?, user_id = ?, updated_at = ? WHERE id = ?"
    ).bind(role, targetUserId, now, shareId).run();
  } else {
    shareId = `share_${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT INTO document_shares (id, document_id, user_id, email, role, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(shareId, documentId, targetUserId, cleanEmail, role, requestingUserId, now, now).run();
  }

  // Send email if configured
  if (env.RESEND_API_KEY) {
    const doc = await env.DB.prepare("SELECT title FROM documents WHERE id = ?")
      .bind(documentId).first<{ title: string }>();
    const inviter = await env.DB.prepare("SELECT email, name FROM users WHERE id = ?")
      .bind(requestingUserId).first<{ email: string | null; name: string | null }>();
    const inviterName = inviter?.name || inviter?.email || "Someone";
    const docTitle = doc?.title || "a document";
    const appUrl = appBaseUrl(env);

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM || 'Scribe <onboarding@resend.dev>',
          to: [cleanEmail],
          subject: `${inviterName} shared "${docTitle}" with you on Scribe`,
          text: `${inviterName} shared the document "${docTitle}" with you (${role} access) on Scribe.\n\nOpen Scribe to view: ${appUrl}`,
          html: `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:440px;margin:0 auto;padding:24px">
  <h2 style="color:#18181b;font-weight:600;margin:0 0 12px">Scribe</h2>
  <p style="color:#3f3f46;font-size:15px;line-height:1.5;margin:0 0 20px">
    <strong>${inviterName}</strong> shared the document <em>"${docTitle}"</em> with you as a <strong>${role}</strong>.
  </p>
  <div style="margin:24px 0">
    <a href="${appUrl}" style="background:#3a3a3c;color:#fafafa;padding:12px 24px;border-radius:8px;font-weight:600;text-decoration:none;display:inline-block">
      Open Document →
    </a>
  </div>
</div>`,
        }),
      });
    } catch (err) {
      console.error('Failed to send share email:', err);
    }
  }

  return { shareId };
}

export async function removeDocumentShare(
  env: Env,
  shareId: string,
  requestingUserId: string
): Promise<{ success: boolean }> {
  const share = await env.DB.prepare("SELECT document_id, user_id FROM document_shares WHERE id = ?")
    .bind(shareId).first<{ document_id: string; user_id: string | null }>();
  if (!share) throw new Error("Share not found");

  const perm = await getDocumentPermission(env, share.document_id, requestingUserId);
  const isSelf = share.user_id === requestingUserId;

  if (!perm.isOwner && perm.role !== 'admin' && !isSelf) {
    throw new Error("Forbidden: insufficient permissions to remove this share");
  }

  await env.DB.prepare("DELETE FROM document_shares WHERE id = ?").bind(shareId).run();
  return { success: true };
}

export async function listDocumentShares(
  env: Env,
  documentId: string,
  requestingUserId: string
): Promise<Array<{ id: string; documentId: string; userId: string | null; email: string; role: string; createdAt: number }>> {
  const perm = await getDocumentPermission(env, documentId, requestingUserId);
  if (!perm.canRead) {
    throw new Error("Document not found");
  }

  const { results } = await env.DB.prepare(
    `SELECT id, document_id as documentId, user_id as userId, email, role, created_at as createdAt
     FROM document_shares
     WHERE document_id = ?
     ORDER BY created_at ASC`
  ).bind(documentId).all<{ id: string; documentId: string; userId: string | null; email: string; role: string; createdAt: number }>();

  return results;
}
