import type { Env } from '../types';

/** Prod origins; the dev deployment overrides them with APP_BASE_URL / HUB_URL (see wrangler.toml [env.dev]). */
const PROD_APP_URL = 'https://scribe.kecker.co';
const PROD_HUB_URL = 'https://mcp.kecker.co';

type UrlEnv = Pick<Env, 'APP_BASE_URL' | 'HUB_URL' | 'ENVIRONMENT'>;

/** This deployment's public origin (no trailing slash). Falls back to localhost outside production. */
export function appBaseUrl(env: UrlEnv): string {
  const configured = env.APP_BASE_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  return env.ENVIRONMENT === 'production' ? PROD_APP_URL : 'http://localhost:8787';
}

/** The Kecker MCP hub this deployment reports storage to, and whose access tokens it accepts. */
export function hubUrl(env: Pick<Env, 'HUB_URL'>): string {
  return env.HUB_URL?.trim().replace(/\/+$/, '') || PROD_HUB_URL;
}

/**
 * The audience of the tokens the hub forwards. It is a Kinde API identifier, not a place to send requests, so it
 * stays the prod value (https://mcp.kecker.co) in dev too: dev reuses the prod Kinde configuration rather than
 * needing its own APIs and callbacks. HUB_AUDIENCE overrides it if that ever changes.
 */
export function hubAudience(env: Pick<Env, 'HUB_AUDIENCE'>): string {
  return env.HUB_AUDIENCE?.trim().replace(/\/+$/, '') || PROD_HUB_URL;
}

export function hubQuotaUrl(env: Pick<Env, 'HUB_URL'>): string {
  return `${hubUrl(env)}/api/quota`;
}
