import { z } from 'zod';
import type { D1Database, DurableObjectNamespace, AnalyticsEngineDataset } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  DOCUMENT_SYNC: DurableObjectNamespace;
  SCRIBE_MCP: DurableObjectNamespace;
  ANALYTICS?: AnalyticsEngineDataset;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUDIENCE?: string;
  ANTHROPIC_API_KEY?: string;
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
