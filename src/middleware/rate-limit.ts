import { Context, Next } from 'hono';
import type { Env } from '../types';
import { AppError, ErrorCode } from './error-handler';

interface SlidingWindowEntry {
  timestamps: number[];
}

// In-memory store keyed by "userId:bucket"
const rateLimitStore = new Map<string, SlidingWindowEntry>();

// Periodic cleanup to prevent unbounded memory growth
const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = Date.now();

function cleanupStaleEntries(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  const cutoff = now - windowMs;
  for (const [key, entry] of rateLimitStore) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) {
      rateLimitStore.delete(key);
    }
  }
}

function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - windowMs;

  cleanupStaleEntries(windowMs);

  let entry = rateLimitStore.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(key, entry);
  }

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= maxRequests) {
    const oldestInWindow = entry.timestamps[0];
    const retryAfterMs = oldestInWindow + windowMs - now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.ceil(retryAfterMs / 1000),
    };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: maxRequests - entry.timestamps.length,
    retryAfterSec: 0,
  };
}

interface RateLimitOptions {
  /** Maximum number of requests in the window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Bucket name used to separate rate limit scopes */
  bucket: string;
}

/**
 * Rate limit middleware factory.
 * Uses a sliding window algorithm keyed by userId (or IP as fallback).
 */
export function rateLimit(options: RateLimitOptions) {
  const { maxRequests, windowMs, bucket } = options;

  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const userId =
      c.get('userId') || c.req.header('cf-connecting-ip') || 'anonymous';
    const key = `${userId}:${bucket}`;
    const result = checkRateLimit(key, maxRequests, windowMs);

    // Always set informational headers
    c.header('X-RateLimit-Limit', maxRequests.toString());
    c.header('X-RateLimit-Remaining', result.remaining.toString());

    if (!result.allowed) {
      c.header('Retry-After', result.retryAfterSec.toString());
      throw new AppError(
        ErrorCode.RATE_LIMIT_EXCEEDED,
        429,
        'Too many requests. Please try again later.'
      );
    }

    await next();
  };
}

// Pre-configured limiters for common use-cases

/** Strict limit for Claude/AI endpoints: 10 req/min */
export const claudeRateLimit = rateLimit({
  maxRequests: 10,
  windowMs: 60_000,
  bucket: 'claude',
});

/** Moderate limit for document CRUD: 60 req/min */
export const documentRateLimit = rateLimit({
  maxRequests: 60,
  windowMs: 60_000,
  bucket: 'documents',
});

/** General API limit: 120 req/min */
export const generalRateLimit = rateLimit({
  maxRequests: 120,
  windowMs: 60_000,
  bucket: 'general',
});
