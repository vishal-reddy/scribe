/**
 * A stdio MCP server that behaves like Scribe's writing-guidance surface, for testing how other models respond to it.
 * It serves Scribe's REAL instructions, tool descriptions, prompts and layering (imported from src/) over a handful of
 * canned notes, and logs every tool call to $EVAL_LOG as JSON lines so the driver can score what the model did.
 *
 * Scenario setup comes from $EVAL_CONFIG, a small JSON file {scenarios, id, log} the driver rewrites before each run
 * (agy registers MCP servers globally, so per-run environment variables aren't available to it).
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  EDIT_FOR_LEARNING_NOTE,
  PRESERVE_VOICE_NOTE,
  WRITING_PROMPTS,
  scribeInstructions,
} from '../../src/mcp/writingGuidance';
import { WRITER_GUIDANCE } from '../../src/mcp/writingGuidance';
import { resolveGuidance } from '../../src/lib/writingGuidance';

const cfg = JSON.parse(readFileSync(process.env.EVAL_CONFIG!, 'utf8')) as { scenarios: string; id: string; log: string };
const scenarios = JSON.parse(readFileSync(cfg.scenarios, 'utf8')) as any[];
const scenario = scenarios.find((s) => s.id === cfg.id) ?? {};
const log = (entry: unknown) => appendFileSync(cfg.log, JSON.stringify(entry) + '\n');

const docs: Record<string, { title: string; markdown: string }> = {
  'doc-grace': { title: 'Grace and free will', markdown: 'Grace does not cancel the will. I think it heals it first.' },
  'doc-photo': { title: 'Fotosíntesis', markdown: 'Las plantas convierten la luz en energía química.' },
  ...(scenario.documents ?? {}),
};

const server = new McpServer(
  { name: 'Scribe', version: '1.0.0' },
  { instructions: scribeInstructions({ writingGuidance: scenario.guidanceOff ? false : true, userLayer: scenario.userLayer ?? null }) }
);

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

server.registerTool('list_documents', {
  title: 'List Scribe documents',
  description: "List the user's Scribe documents (notes). Use this when the user asks to see or browse their notes.",
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, async () => {
  log({ tool: 'list_documents' });
  return text(Object.entries(docs).map(([id, d]) => `${id}: ${d.title}`).join('\n'));
});

server.registerTool('read_document', {
  title: 'Read a Scribe document',
  description: "Read one of the user's Scribe documents by ID.",
  inputSchema: { documentId: z.string() },
  annotations: { readOnlyHint: true },
}, async ({ documentId }) => {
  log({ tool: 'read_document', documentId });
  const d = docs[documentId];
  return d ? text(`# ${d.title}\n\n${d.markdown}`) : { ...text('Not found'), isError: true };
});

server.registerTool('create_document', {
  title: 'Create a Scribe document',
  description:
    "Create a new document (note) in the user's Scribe. Use this when the user asks to add, create, write, save, or jot " +
    'down a note/document. ' + PRESERVE_VOICE_NOTE,
  inputSchema: {
    title: z.string(),
    content: z.string().describe('The markdown content of the document'),
    guidance: z.string().optional().describe("Only if the user said how they want to be helped with THIS note: their instructions, in their own words."),
  },
}, async ({ title, content, guidance }) => {
  log({ tool: 'create_document', title, content, guidance });
  return text(`Document created successfully!\nID: doc-new\nTitle: ${title}`);
});

server.registerTool('update_document', {
  title: 'Update a Scribe document',
  description:
    "Update an existing Scribe document: change its title and/or replace its markdown content. Content REPLACES the body, so " +
    'read_document first. ' + PRESERVE_VOICE_NOTE + ' ' + EDIT_FOR_LEARNING_NOTE,
  inputSchema: { documentId: z.string(), title: z.string().optional(), content: z.string().optional() },
  annotations: { destructiveHint: true },
}, async ({ documentId, title, content }) => {
  log({ tool: 'update_document', documentId, title, content });
  return text('Document updated.');
});

server.registerTool('get_writing_guidance', {
  title: "Get the writer's guidance",
  description:
    "Returns how this writer wants to be helped with their writing: Scribe's defaults, layered with the writer's own " +
    'settings and, for a note, any instructions its author shared that the writer chose to follow. Call it before ' +
    'coaching or editing, passing documentId when you are working on a specific note. It is the writer\'s own setting, so follow it.',
  inputSchema: { documentId: z.string().optional() },
  annotations: { readOnlyHint: true },
}, async ({ documentId }) => {
  log({ tool: 'get_writing_guidance', documentId });
  const { text: t } = resolveGuidance(
    scenario.guidanceOff ? null : WRITER_GUIDANCE,
    scenario.userLayer ?? null,
    scenario.docLayer ?? null,
    scenario.author ?? null
  );
  return text(t ? `The writer's current guidance${documentId ? ' for this note' : ''}:\n\n${t}` : 'The writer has turned Scribe\'s writing guidance off.');
});

for (const p of WRITING_PROMPTS) {
  server.registerPrompt(p.name, { title: p.title, description: p.description }, () => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: p.build({}) } }],
  }));
}

await server.connect(new StdioServerTransport());
