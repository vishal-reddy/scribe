import { Context, Next } from 'hono';
import type { Env } from '../types';
import { AppError, ErrorCode } from './error-handler';

// --- Constants ---

const MAX_BODY_SIZE = 1_048_576; // 1 MB
const MAX_TITLE_LENGTH = 200;

// Patterns that indicate XSS payloads in markdown
const DANGEROUS_PATTERNS: RegExp[] = [
  /<script[\s>]/gi,
  /<\/script>/gi,
  /javascript\s*:/gi,
  /on\w+\s*=/gi, // onclick=, onerror=, onload=, etc.
  /<iframe[\s>]/gi,
  /<\/iframe>/gi,
  /<object[\s>]/gi,
  /<\/object>/gi,
  /<embed[\s>]/gi,
  /<\/embed>/gi,
  /<form[\s>]/gi,
  /<\/form>/gi,
  /data\s*:\s*text\/html/gi,
  /vbscript\s*:/gi,
];

// --- Helpers ---

/**
 * Strip dangerous HTML/JS from markdown content.
 * Returns sanitized string.
 */
export function sanitizeMarkdown(input: string): string {
  let sanitized = input;
  for (const pattern of DANGEROUS_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }
  return sanitized;
}

// --- Middleware ---

/**
 * Request body size limit middleware.
 * Rejects requests whose Content-Length exceeds the configured maximum.
 */
export function bodySizeLimit(maxBytes: number = MAX_BODY_SIZE) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const contentLength = c.req.header('content-length');
    if (contentLength && parseInt(contentLength, 10) > maxBytes) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        413,
        `Request body too large. Maximum size is ${Math.round(maxBytes / 1024)}KB.`
      );
    }

    await next();
  };
}

/**
 * Input sanitization middleware for document mutations.
 * Sanitizes markdown content and enforces title length.
 */
export async function sanitizeInput(
  c: Context<{ Bindings: Env }>,
  next: Next
) {
  // Only process JSON bodies on mutating methods
  if (!['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
    return next();
  }

  const contentType = c.req.header('content-type');
  if (!contentType?.includes('application/json')) {
    return next();
  }

  try {
    const body = await c.req.json();

    let modified = false;

    // Sanitize markdown / content fields
    if (typeof body.markdown === 'string') {
      body.markdown = sanitizeMarkdown(body.markdown);
      modified = true;
    }
    if (typeof body.content === 'string') {
      body.content = sanitizeMarkdown(body.content);
      modified = true;
    }

    // Enforce title length
    if (typeof body.title === 'string' && body.title.length > MAX_TITLE_LENGTH) {
      body.title = body.title.substring(0, MAX_TITLE_LENGTH);
      modified = true;
    }

    // Enforce body-level content size
    if (typeof body.markdown === 'string' && body.markdown.length > MAX_BODY_SIZE) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        413,
        `Document content too large. Maximum size is ${Math.round(MAX_BODY_SIZE / 1024)}KB.`
      );
    }
    if (typeof body.content === 'string' && body.content.length > MAX_BODY_SIZE) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        413,
        `Document content too large. Maximum size is ${Math.round(MAX_BODY_SIZE / 1024)}KB.`
      );
    }

    // Replace the request body so downstream handlers see sanitized data.
    // Hono caches the parsed body, so we override _json on the raw request.
    if (modified) {
      (c.req as any)._json = body;
      (c.req.raw as any)._jsonBody = body;
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    // If body parsing fails let downstream validators handle it
  }

  await next();
}
