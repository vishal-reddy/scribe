import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../../src/index';
import { applyMigrations } from '../helpers';

describe('MCP Server', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  describe('POST /mcp/tools/list', () => {
    it('should list all 5 tools', async () => {
      const res = await app.request('/mcp/tools/list', {
        method: 'POST',
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.tools).toBeDefined();
      expect(Array.isArray(data.tools)).toBe(true);
      expect(data.tools.length).toBe(5);

      const toolNames = data.tools.map((t: any) => t.name);
      expect(toolNames).toContain('list_documents');
      expect(toolNames).toContain('read_document');
      expect(toolNames).toContain('create_document');
      expect(toolNames).toContain('update_document');
      expect(toolNames).toContain('search_documents');
    });

    it('should include input schemas for each tool', async () => {
      const res = await app.request('/mcp/tools/list', {
        method: 'POST',
      }, env);
      const data: any = await res.json();

      for (const tool of data.tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
      }
    });
  });

  describe('POST /mcp/tools/call', () => {
    it('should reject unknown tools with 400', async () => {
      const res = await app.request('/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'invalid_tool', arguments: {} }),
      }, env);

      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.isError).toBe(true);
    });

    it('should handle list_documents', async () => {
      const res = await app.request('/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'list_documents', arguments: {} }),
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.content).toBeDefined();
      expect(Array.isArray(data.content)).toBe(true);
      expect(data.content[0].type).toBe('text');
    });

    it('should handle create_document', async () => {
      const res = await app.request('/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'create_document',
          arguments: { title: 'MCP Doc', content: '# MCP Content' },
        }),
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.content[0].text).toContain('Document created successfully');
    });

    it('should handle read_document with missing document', async () => {
      const res = await app.request('/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'read_document',
          arguments: { documentId: 'non-existent-id' },
        }),
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.isError).toBe(true);
    });

    it('should create and then read a document', async () => {
      // Create
      const createRes = await app.request('/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'create_document',
          arguments: { title: 'Readable Doc', content: 'readable content here' },
        }),
      }, env);
      const createData: any = await createRes.json();
      const idMatch = createData.content[0].text.match(/ID:\s*(.+)/);
      const docId = idMatch?.[1]?.trim();

      expect(docId).toBeDefined();

      // Read
      const readRes = await app.request('/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'read_document',
          arguments: { documentId: docId },
        }),
      }, env);

      expect(readRes.status).toBe(200);
      const readData: any = await readRes.json();
      expect(readData.content[0].text).toContain('Readable Doc');
      expect(readData.content[0].text).toContain('readable content here');
    });

    it('should handle update_document with missing document', async () => {
      const res = await app.request('/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'update_document',
          arguments: { documentId: 'non-existent', title: 'New Title' },
        }),
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.isError).toBe(true);
    });

    it('should handle search_documents', async () => {
      const res = await app.request('/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'search_documents',
          arguments: { query: 'readable' },
        }),
      }, env);

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.content).toBeDefined();
      expect(data.content[0].type).toBe('text');
    });

    it('should handle update_document for existing document', async () => {
      // Create a document first
      const createRes = await app.request('/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'create_document',
          arguments: { title: 'Update Target', content: 'original' },
        }),
      }, env);
      const createData: any = await createRes.json();
      const idMatch = createData.content[0].text.match(/ID:\s*(.+)/);
      const docId = idMatch?.[1]?.trim();

      // Update it
      const updateRes = await app.request('/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'update_document',
          arguments: { documentId: docId, title: 'Updated Title', content: 'updated content' },
        }),
      }, env);

      expect(updateRes.status).toBe(200);
      const data: any = await updateRes.json();
      expect(data.content[0].text).toContain('Document updated successfully');
    });
  });
});
