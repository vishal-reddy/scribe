import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../../src/index';

describe('/guidance page headers', () => {
  it('sends a CSP that forbids scripts, framing and third-party form posts', async () => {
    const res = await app.request('/guidance', { redirect: 'manual' }, env as any);
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toContain('script-src');
  });
});
