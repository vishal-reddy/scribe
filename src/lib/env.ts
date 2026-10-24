/**
 * True only for local `wrangler dev` and the test pool, which set LOCAL_DEV=true (in .dev.vars / test bindings).
 *
 * Never put LOCAL_DEV in wrangler.toml [vars] or set it as a deployed secret: every shortcut it enables skips
 * authentication (unsigned tokens, OTP echoed in responses, unscoped MCP, error details). Deployed environments,
 * including the internet-facing dev Worker, must verify every credential. The previous gate was
 * `ENVIRONMENT !== 'production'`, which failed open and left scribe-dev wide open.
 */
export function isLocalDev(env: { LOCAL_DEV?: string }): boolean {
  return env.LOCAL_DEV === 'true';
}
