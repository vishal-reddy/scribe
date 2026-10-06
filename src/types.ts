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
  ALLOWED_ORIGINS?: string;
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
