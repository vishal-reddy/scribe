import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../../src/index';
import { applyMigrations } from '../helpers';

describe('MCP Server', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  it('should return 404 for /mcp routes via Hono (MCP is handled by McpAgent DO)', async () => {
    // MCP routes are served by the ScribeMCP Durable Object via the combined
    // fetch handler, not through the Hono app. Hono correctly returns 404.
    const res = await app.request('/mcp', { method: 'GET' }, env);
    expect(res.status).toBe(404);
  });

  it('should export ScribeMCP Durable Object class', async () => {
    const { ScribeMCP } = await import('../../src/index');
    expect(ScribeMCP).toBeDefined();
    expect(typeof ScribeMCP).toBe('function');
  });

  it('should advertise the MCP endpoint on the connect page', async () => {
    const res = await app.request('/connect', { method: 'GET' }, env);
    expect(res.status).toBe(200);
    // The connect page surfaces the /mcp server URL for users to copy.
    const html = await res.text();
    expect(html).toContain('/mcp');
  });
});
