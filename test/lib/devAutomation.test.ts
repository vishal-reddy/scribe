import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import * as jose from 'jose';
import { verifyDevAutomationToken, DEV_AUTOMATION_EMAIL } from '../../src/lib/devAutomation';
import { applyMigrations } from '../helpers';
import type { Env } from '../../src/types';
// @ts-expect-error vite raw import
import wranglerToml from '../../wrangler.toml?raw';

const ISSUER = 'https://kecker.kinde.com';
const CLIENT = 'a760e4261a014c7c8386ffa71a5deba7';
const DEV_AUD = 'https://scribe-dev.kecker.co';
const PROD_AUD = 'https://scribe.kecker.co';

const devEnv = {
  ...env,
  ENVIRONMENT: 'development',
  LOCAL_DEV: undefined,
  KINDE_DOMAIN: ISSUER,
  DEV_AUTOMATION_CLIENT_ID: CLIENT,
  DEV_AUTOMATION_AUDIENCE: DEV_AUD,
} as unknown as Env;

describe('verifyDevAutomationToken', () => {
  let key: CryptoKey;
  let publicKey: CryptoKey;
  let otherKey: CryptoKey;

  async function sign(claims: Record<string, unknown>, opts: { aud?: string; exp?: string | number; k?: CryptoKey } = {}) {
    return new jose.SignJWT({ azp: CLIENT, ...claims })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(ISSUER)
      .setAudience(opts.aud ?? DEV_AUD)
      .setSubject('m2m-subject')
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? '10m')
      .sign(opts.k ?? key);
  }

  beforeAll(async () => {
    await applyMigrations(env.DB);
    const pair = await jose.generateKeyPair('RS256');
    key = pair.privateKey;
    publicKey = pair.publicKey;
    otherKey = (await jose.generateKeyPair('RS256')).privateKey;
  });

  // The verifier is handed the matching public key instead of fetching Kinde's JWKS.
  async function verify(token: string, e: Env = devEnv) {
    return verifyDevAutomationToken(e, token, publicKey);
  }

  it('accepts a valid client-credentials token and returns the fixed test user', async () => {
    const r = await verify(await sign({}));
    expect(r?.email).toBe(DEV_AUTOMATION_EMAIL);
    expect(r?.userId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts the client id in `client_id` as well as `azp`', async () => {
    const t = await new jose.SignJWT({ client_id: CLIENT })
      .setProtectedHeader({ alg: 'RS256' }).setIssuer(ISSUER).setAudience(DEV_AUD).setExpirationTime('10m').sign(key);
    expect((await verify(t))?.email).toBe(DEV_AUTOMATION_EMAIL);
  });

  it('rejects a token issued for the production audience (a prod/dev token must not work here as automation)', async () => {
    expect(await verify(await sign({}, { aud: PROD_AUD }))).toBeNull();
  });

  it('rejects a token issued to a different client', async () => {
    expect(await verify(await sign({ azp: 'some-other-client' }))).toBeNull();
  });

  it('rejects a token with no client id claim', async () => {
    const t = await new jose.SignJWT({}).setProtectedHeader({ alg: 'RS256' }).setIssuer(ISSUER).setAudience(DEV_AUD).setExpirationTime('10m').sign(key);
    expect(await verify(t)).toBeNull();
  });

  it('rejects an expired token', async () => {
    expect(await verify(await sign({}, { exp: Math.floor(Date.now() / 1000) - 60 }))).toBeNull();
  });

  it('rejects a token signed by a different key', async () => {
    expect(await verify(await sign({}, { k: otherKey }))).toBeNull();
  });

  it('rejects a token from another issuer', async () => {
    const t = await new jose.SignJWT({ azp: CLIENT }).setProtectedHeader({ alg: 'RS256' })
      .setIssuer('https://evil.example').setAudience(DEV_AUD).setExpirationTime('10m').sign(key);
    expect(await verify(t)).toBeNull();
  });

  it('is off on production, on the test environment, and when not fully configured', async () => {
    const t = await sign({});
    expect(await verify(t, { ...devEnv, ENVIRONMENT: 'production' } as Env)).toBeNull();
    expect(await verify(t, { ...devEnv, ENVIRONMENT: undefined } as Env)).toBeNull();
    expect(await verify(t, { ...devEnv, ENVIRONMENT: 'test' } as Env)).toBeNull();
    expect(await verify(t, { ...devEnv, DEV_AUTOMATION_CLIENT_ID: undefined } as Env)).toBeNull();
    expect(await verify(t, { ...devEnv, DEV_AUTOMATION_AUDIENCE: undefined } as Env)).toBeNull();
  });

  it('is never configured on the production Worker', () => {
    // Everything before the first [env.*] table is the production Worker's configuration.
    const prodConfig = (wranglerToml as string).split(/^\[env\./m)[0] ?? '';
    expect(prodConfig).not.toMatch(/DEV_AUTOMATION_/);
    expect(wranglerToml as string).toMatch(/\[env\.dev\.vars\][\s\S]*DEV_AUTOMATION_CLIENT_ID/);
  });
});
