import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, like, desc } from 'drizzle-orm';
import * as schema from '../db/schema';
import type { Env } from '../types';

const mcp = new Hono<{ Bindings: Env }>();

/**
 * MCP Tools List
 * POST /mcp/tools/list
 */
mcp.post('/tools/list', async (c) => {
  return c.json({
    tools: [
      {
        name: 'list_documents',
        description: 'List all user documents in Scribe',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'read_document',
        description: 'Read the content of a specific document',
        inputSchema: {
          type: 'object',
          properties: {
            documentId: {
              type: 'string',
              description: 'The ID of the document to read',
            },
          },
          required: ['documentId'],
        },
      },
      {
        name: 'create_document',
        description: 'Create a new document in Scribe',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'The title of the new document',
            },
            content: {
              type: 'string',
              description: 'The markdown content of the document',
            },
          },
          required: ['title', 'content'],
        },
      },
      {
        name: 'update_document',
        description: 'Update an existing document',
        inputSchema: {
          type: 'object',
          properties: {
            documentId: {
              type: 'string',
              description: 'The ID of the document to update',
            },
            title: {
              type: 'string',
              description: 'New title (optional)',
            },
            content: {
              type: 'string',
              description: 'New markdown content (optional)',
            },
          },
          required: ['documentId'],
        },
      },
      {
        name: 'search_documents',
        description: 'Search documents by title or content',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query',
            },
          },
          required: ['query'],
        },
      },
    ],
  });
});

/**
 * MCP Tool Call
 * POST /mcp/tools/call
 */
mcp.post('/tools/call', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const body = await c.req.json();
  const { name, arguments: args } = body;

  try {
    switch (name) {
      case 'list_documents': {
        const documents = await db
          .select()
          .from(schema.documents)
          .orderBy(desc(schema.documents.updatedAt));

        return c.json({
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                documents.map((doc) => ({
                  id: doc.id,
                  title: doc.title,
                  createdAt: doc.createdAt,
                  updatedAt: doc.updatedAt,
                  lastEditedBy: doc.lastEditedBy,
                })),
                null,
                2
              ),
            },
          ],
        });
      }

      case 'read_document': {
        const doc = await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, args.documentId))
          .get();

        if (!doc) {
          return c.json({
            content: [
              {
                type: 'text',
                text: `Error: Document with ID ${args.documentId} not found`,
              },
            ],
            isError: true,
          });
        }

        return c.json({
          content: [
            {
              type: 'text',
              text: `Title: ${doc.title}\n\nContent:\n${doc.markdown}`,
            },
          ],
        });
      }

      case 'create_document': {
        const documentId = crypto.randomUUID();
        const now = new Date();

        const newDoc: schema.NewDocument = {
          id: documentId,
          title: args.title,
          content: '',
          markdown: args.content || '',
          createdAt: now,
          updatedAt: now,
          createdBy: 'claude',
          lastEditedBy: 'claude',
        };

        await db.insert(schema.documents).values(newDoc);

        return c.json({
          content: [
            {
              type: 'text',
              text: `Document created successfully!\nID: ${documentId}\nTitle: ${args.title}`,
            },
          ],
        });
      }

      case 'update_document': {
        const existing = await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, args.documentId))
          .get();

        if (!existing) {
          return c.json({
            content: [
              {
                type: 'text',
                text: `Error: Document with ID ${args.documentId} not found`,
              },
            ],
            isError: true,
          });
        }

        const updates: Partial<schema.Document> = {
          updatedAt: new Date(),
          lastEditedBy: 'claude',
        };

        if (args.title) updates.title = args.title;
        if (args.content !== undefined) updates.markdown = args.content;

        await db
          .update(schema.documents)
          .set(updates)
          .where(eq(schema.documents.id, args.documentId));

        return c.json({
          content: [
            {
              type: 'text',
              text: `Document updated successfully!\nID: ${args.documentId}`,
            },
          ],
        });
      }

      case 'search_documents': {
        const documents = await db
          .select()
          .from(schema.documents)
          .where(
            like(schema.documents.markdown, `%${args.query}%`)
          )
          .orderBy(desc(schema.documents.updatedAt));

        return c.json({
          content: [
            {
              type: 'text',
              text: `Found ${documents.length} documents:\n\n${JSON.stringify(
                documents.map((doc) => ({
                  id: doc.id,
                  title: doc.title,
                  preview: doc.markdown.substring(0, 100) + '...',
                })),
                null,
                2
              )}`,
            },
          ],
        });
      }

      default:
        return c.json(
          {
            content: [
              {
                type: 'text',
                text: `Error: Unknown tool '${name}'`,
              },
            ],
            isError: true,
          },
          400
        );
    }
  } catch (error: any) {
    console.error('MCP tool call error:', error);
    return c.json(
      {
        content: [
          {
            type: 'text',
            text: `Error executing tool: ${error.message}`,
          },
        ],
        isError: true,
      },
      500
    );
  }
});

export default mcp;
