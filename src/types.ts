import { z } from 'zod';
import type { D1Database, DurableObjectNamespace, AnalyticsEngineDataset } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  DOCUMENT_SYNC: DurableObjectNamespace;
  SCRIBE_MCP: DurableObjectNamespace;
  // Transactional email (Resend). RESEND_API_KEY is a secret; EMAIL_FROM is a plain var.
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  ANALYTICS?: AnalyticsEngineDataset;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUDIENCE?: string;
  ANTHROPIC_API_KEY?: string;
  MCP_AUTH_TOKEN?: string;
  SCRIBE_API_KEY?: string;
  OAUTH_PEPPER: string;
  /** Shared Kinde business every Kecker.co app authenticates against. */
  KINDE_DOMAIN: string;
  /** "Scribe Web" Kinde application — used by the backend-hosted /auth/kinde/* login (consent-flow gate). iOS talks to its own "Scribe iOS" Kinde application client-side. */
  KINDE_CLIENT_ID: string;
  /** The "Scribe" Kinde API's audience (https://scribe.kecker.co). */
  KINDE_AUDIENCE: string;
  KINDE_CLIENT_SECRET: string;
  SENTRY_DSN?: string;
  ENVIRONMENT?: string;
  /** Dev Worker only: the Kinde M2M application allowed to act as the fixed test user (lib/devAutomation.ts). */
  DEV_AUTOMATION_CLIENT_ID?: string;
  /** Dev Worker only: the dev-only Kinde API audience that M2M token must be issued for. */
  DEV_AUTOMATION_AUDIENCE?: string;
  /** "true" only for local wrangler dev and tests. See lib/env.ts. */
  LOCAL_DEV?: string;
  ALLOWED_ORIGINS?: string;
  /** This deployment's public origin, e.g. https://scribe-dev.kecker.co. Unset in prod (it derives from ENVIRONMENT). */
  APP_BASE_URL?: string;
  /** The Kecker MCP hub origin for quota reporting and token audience. Unset means prod (https://mcp.kecker.co). */
  HUB_URL?: string;
  /** Audience of hub-forwarded tokens. Unset means https://mcp.kecker.co in every environment (dev reuses prod Kinde). */
  HUB_AUDIENCE?: string;
  /** "off" removes the writing-coach section from the MCP server instructions (default on). */
  WRITING_GUIDANCE?: string;
}

// Add context variables type
declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    userEmail: string;
    userName: string;
    requestId: string;
  }
}

// Document schemas
export const createDocumentSchema = z.object({
  title: z.string().min(1).max(200),
  markdown: z.string().optional().default(''),
  /** The writer's own instructions for working on this note (a per-note layer, see lib/writingGuidance.ts). */
  guidance: z.string().max(2000).optional(),
  guidanceMode: z.enum(['append', 'replace']).optional(),
  /** Instructions to attach for everyone who reads the note; readers adopt them before they apply. */
  sharedGuidance: z.string().max(2000).optional(),
});

export const updateDocumentSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
  markdown: z.string().optional(),
});

// Claude interaction schemas
export const claudePromptSchema = z.object({
  prompt: z.string().min(1).max(2000),
  documentId: z.string().optional(),
});

export const claudeCreateDocumentSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string(),
});

export const claudeEditDocumentSchema = z.object({
  instruction: z.string().min(1).max(1000),
});

// Export types
export type CreateDocumentRequest = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentRequest = z.infer<typeof updateDocumentSchema>;
export type ClaudePromptRequest = z.infer<typeof claudePromptSchema>;
export type ClaudeCreateDocumentRequest = z.infer<typeof claudeCreateDocumentSchema>;
export type ClaudeEditDocumentRequest = z.infer<typeof claudeEditDocumentSchema>;
