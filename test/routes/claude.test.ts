import { describe, it, expect, beforeAll, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from '../../src/index';
import { applyMigrations, getAuthHeaders } from '../helpers';

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: async () => ({
        content: [{ type: 'text', text: 'This is a mocked Claude response.' }],
        model: 'claude-3-5-sonnet-20241022',
        role: 'assistant',
      }),
    };
  },
}));

describe('Claude Prompt API', () => {
  const authHeaders = getAuthHeaders();

  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  it('should require authentication', async () => {
    const res = await app.request('/api/claude/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' }),
    }, env);

    expect(res.status).toBe(401);
  });

  it('should validate prompt schema - empty prompt', async () => {
    const res = await app.request('/api/claude/prompt', {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: '' }),
    }, env);

    expect(res.status).toBe(400);
  });

  it('should reject prompts that are too long', async () => {
    const longPrompt = 'a'.repeat(2001);
    const res = await app.request('/api/claude/prompt', {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: longPrompt }),
    }, env);

    expect(res.status).toBe(400);
  });

  it('should process a valid prompt', async () => {
    const res = await app.request('/api/claude/prompt', {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: 'Write a short poem about coding' }),
    }, env);

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data).toHaveProperty('response');
    expect(data).toHaveProperty('interactionId');
    expect(typeof data.response).toBe('string');
  });

  it('should process a prompt with documentId', async () => {
    // First create a document
    const createRes = await app.request('/api/documents', {
      method: 'POST',
      body: JSON.stringify({ title: 'Test Doc for Claude', markdown: '# Test' }),
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
    }, env);
    const createData: any = await createRes.json();
    const docId = createData.document.id;

    const res = await app.request('/api/claude/prompt', {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'Improve this document',
        documentId: docId,
      }),
    }, env);

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.documentId).toBe(docId);
    expect(data.response).toBeDefined();
  });

  it('should return Claude history for a document', async () => {
    // Create a document and prompt against it
    const createRes = await app.request('/api/documents', {
      method: 'POST',
      body: JSON.stringify({ title: 'History Doc', markdown: '# History' }),
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
    }, env);
    const createData: any = await createRes.json();
    const docId = createData.document.id;

    await app.request('/api/claude/prompt', {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Edit this', documentId: docId }),
    }, env);

    const res = await app.request(`/api/claude/history/${docId}`, {
      headers: authHeaders,
    }, env);

    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.documentId).toBe(docId);
    expect(data).toHaveProperty('history');
    expect(Array.isArray(data.history)).toBe(true);
    expect(data.history.length).toBeGreaterThan(0);
  });
});
