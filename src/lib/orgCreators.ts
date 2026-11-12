import type { Env } from '../types';

/**
 * Business organizations are created by Kecker, not by users (the hub enforces the same rule). Only these accounts may
 * create one; everyone else is told to contact Kecker. Workspaces are not affected.
 */
const ORG_CREATORS = ["vlukereddy@gmail.com"];

export const ORG_CREATION_DENIED = "Forbidden: Contact Kecker for a new organization.";

export async function requireOrgCreator(env: Env, userId: string): Promise<void> {
  const row = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first<{ email: string | null }>();
  const email = row?.email?.trim().toLowerCase();
  if (!email || !ORG_CREATORS.includes(email)) throw new Error(ORG_CREATION_DENIED);
}
