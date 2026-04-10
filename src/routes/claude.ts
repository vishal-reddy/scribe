import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc, count, or, sql } from 'drizzle-orm';
import { zValidator } from '@hono/zod-validator';
import Anthropic from '@anthropic-ai/sdk';
import * as schema from '../db/schema';
import { claudeCreateDocumentSchema, claudeEditDocumentSchema, claudePromptSchema, type Env } from '../types';
import { markdownToYjsUpdate } from '../lib/yjs-utils';
import { createClaudeEditNotification, storeNotification } from '../lib/notifications';
import { hasRecentUserEdit } from '../lib/conflict-detection';

const claude = new Hono<{ Bindings: Env }>();

function parsePagination(c: { req: { query: (key: string) => string | undefined } }, maxLimit = 100, defaultLimit = 50) {
  const rawLimit = parseInt(c.req.query('limit') || String(defaultLimit), 10);
  const rawOffset = parseInt(c.req.query('offset') || '0', 10);
  const limit = Math.max(1, Math.min(rawLimit, maxLimit));
  const offset = Math.max(0, rawOffset);
  return { limit, offset };
}

/**
 * Check Claude integration status
 * GET /api/claude/status
 */
claude.get('/status', async (c) => {
  const hasApiKey = !!c.env.ANTHROPIC_API_KEY;
  return c.json({
    modes: {
      mcp: {
        available: true,
        endpoint: '/mcp',
        description: 'Connect Claude Desktop or Claude Code to use your Claude subscription directly',
      },
      api: {
        available: hasApiKey,
        description: hasApiKey
          ? 'In-app Claude chat is active via API key'
          : 'Set ANTHROPIC_API_KEY to enable in-app Claude chat. Otherwise use MCP with your Claude subscription.',
      },
    },
  });
});

/**
 * List all documents (artifacts) for Claude
 * GET /api/claude/artifacts
 */
claude.get('/artifacts', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const { limit, offset } = parsePagination(c);
  const userId = c.get('userId');

  const ownershipFilter = or(
    eq(schema.documents.userId, userId),
    sql`${schema.documents.userId} IS NULL`
  );

  try {
    const documents = await db
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        markdown: schema.documents.markdown,
        createdAt: schema.documents.createdAt,
        updatedAt: schema.documents.updatedAt,
        createdBy: schema.documents.createdBy,
        lastEditedBy: schema.documents.lastEditedBy,
      })
      .from(schema.documents)
      .where(ownershipFilter)
      .orderBy(desc(schema.documents.updatedAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(schema.documents)
      .where(ownershipFilter);

    return c.json({
      artifacts: documents.map((doc) => ({
        artifactId: doc.id,
        title: doc.title,
        content: doc.markdown,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
        author: doc.createdBy,
        lastEditor: doc.lastEditedBy,
      })),
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error fetching artifacts:', error);
    return c.json({ error: 'Failed to fetch artifacts' }, 500);
  }
});

/**
 * Get a specific artifact (document)
 * GET /api/claude/artifacts/:id
 */
claude.get('/artifacts/:id', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const artifactId = c.req.param('id');
  const userId = c.get('userId');

  try {
    const doc = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, artifactId))
      .get();

    if (!doc) {
      return c.json({ error: 'Artifact not found' }, 404);
    }

    // Ownership check
    if (doc.userId && doc.userId !== userId) {
      return c.json({ error: 'Artifact not found' }, 404);
    }

    return c.json({
      artifact: {
        artifactId: doc.id,
        title: doc.title,
        content: doc.markdown,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
        author: doc.createdBy,
        lastEditor: doc.lastEditedBy,
      },
    });
  } catch (error) {
    console.error('Error fetching artifact:', error);
    return c.json({ error: 'Failed to fetch artifact' }, 500);
  }
});

/**
 * Create a new artifact (document) programmatically
 * POST /api/claude/create
 */
claude.post('/create', zValidator('json', claudeCreateDocumentSchema), async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const data = c.req.valid('json');
  const userId = c.get('userId');

  try {
    const artifactId = crypto.randomUUID();
    const now = new Date();

    const newDoc: schema.NewDocument = {
      id: artifactId,
      title: data.title,
      content: '', // Empty Y.js state
      markdown: data.content,
      createdAt: now,
      updatedAt: now,
      createdBy: 'claude',
      lastEditedBy: 'claude',
      userId,
    };

    await db.insert(schema.documents).values(newDoc);

    // Log the creation
    await db.insert(schema.claudeInteractions).values({
      id: crypto.randomUUID(),
      documentId: artifactId,
      prompt: `Create document: ${data.title}`,
      response: data.content,
      operation: 'create',
      createdAt: now,
    });

    return c.json({
      artifact: {
        artifactId: newDoc.id,
        title: newDoc.title,
        content: newDoc.markdown,
        createdAt: newDoc.createdAt.toISOString(),
        updatedAt: newDoc.updatedAt.toISOString(),
      },
    }, 201);
  } catch (error) {
    console.error('Error creating artifact:', error);
    return c.json({ error: 'Failed to create artifact' }, 500);
  }
});

/**
 * Edit an existing artifact (document) programmatically
 * POST /api/claude/edit/:id
 */
claude.post('/edit/:id', zValidator('json', claudeEditDocumentSchema), async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const artifactId = c.req.param('id');
  const data = c.req.valid('json');
  const userId = c.get('userId');

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({
      error: 'ANTHROPIC_API_KEY not configured',
      hint: 'Use Claude Desktop or Claude Code with the MCP connector instead. Connect to /mcp to use your Claude subscription directly.',
    }, 501);
  }

  try {
    // Get current document
    const doc = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, artifactId))
      .get();

    if (!doc) {
      return c.json({ error: 'Artifact not found' }, 404);
    }

    // Ownership check
    if (doc.userId && doc.userId !== userId) {
      return c.json({ error: 'Artifact not found' }, 404);
    }

    // Use Claude to edit the document
    const anthropic = new Anthropic({
      apiKey: c.env.ANTHROPIC_API_KEY,
    });

    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      system: `Edit this document according to the instruction. Return only the edited markdown content.\n\nCurrent document:\n${doc.markdown}`,
      messages: [
        {
          role: 'user',
          content: data.instruction,
        },
      ],
    });

    const editedContent = message.content[0].type === 'text' 
      ? message.content[0].text 
      : doc.markdown;

    // Update document
    const now = new Date();
    await db
      .update(schema.documents)
      .set({
        markdown: editedContent,
        updatedAt: now,
        lastEditedBy: 'claude',
      })
      .where(eq(schema.documents.id, artifactId));

    // Log the edit
    await db.insert(schema.claudeInteractions).values({
      id: crypto.randomUUID(),
      documentId: artifactId,
      prompt: data.instruction,
      response: editedContent,
      operation: 'edit',
      createdAt: now,
    });

    return c.json({
      artifact: {
        artifactId,
        title: doc.title,
        content: editedContent,
        updatedAt: now.toISOString(),
      },
    });
  } catch (error: any) {
    console.error('Error editing artifact:', error);
    return c.json(
      { 
        error: 'Failed to edit artifact',
        details: error.message,
      },
      500
    );
  }
});

/**
 * Process a natural language prompt from the user
 * POST /api/claude/prompt
 */
claude.post('/prompt', zValidator('json', claudePromptSchema), async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const data = c.req.valid('json');
  const userId = c.get('userId');

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({
      error: 'ANTHROPIC_API_KEY not configured',
      hint: 'Use Claude Desktop or Claude Code with the MCP connector instead. Connect to /mcp to use your Claude subscription directly.',
    }, 501);
  }

  try {
    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: c.env.ANTHROPIC_API_KEY,
    });

    // Get document context if documentId provided
    let documentContext = '';
    if (data.documentId) {
      const doc = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, data.documentId))
        .get();

      if (!doc) {
        return c.json({ error: 'Document not found' }, 404);
      }

      // Ownership check
      if (doc.userId && doc.userId !== userId) {
        return c.json({ error: 'Document not found' }, 404);
      }

      documentContext = `\n\nCurrent document:\nTitle: ${doc.title}\nContent:\n${doc.markdown}`;
    }

    // Build prompt for Claude
    const systemPrompt = `You are a helpful writing assistant for the Scribe app. Help users create and edit markdown documents. Be concise and provide the edited content directly.${documentContext}`;

    // Call Claude API
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: data.prompt,
        },
      ],
    });

    // Extract response
    const responseText = message.content[0].type === 'text' 
      ? message.content[0].text 
      : '';

    // If editing an existing document, update it
    if (data.documentId) {
      const now = new Date();
      
      // Update markdown in database
      await db
        .update(schema.documents)
        .set({
          markdown: responseText,
          updatedAt: now,
          lastEditedBy: 'claude',
        })
        .where(eq(schema.documents.id, data.documentId));
      
      // Create notification for Claude edit
      const notification = createClaudeEditNotification(data.documentId, data.prompt);
      await storeNotification(notification, c.env);
      
      // TODO: Broadcast update to connected clients via Durable Object
      // For now, clients will get the update on next sync
    }

    // Log interaction
    const interactionId = crypto.randomUUID();
    await db.insert(schema.claudeInteractions).values({
      id: interactionId,
      documentId: data.documentId || null,
      prompt: data.prompt,
      response: responseText,
      operation: data.documentId ? 'edit' : 'create',
      createdAt: new Date(),
    });

    return c.json({
      response: responseText,
      documentId: data.documentId,
      interactionId,
    });
  } catch (error: any) {
    console.error('Claude API error:', error);
    return c.json(
      { 
        error: 'Failed to process prompt',
        details: error.message,
      },
      500
    );
  }
});

/**
 * Get Claude's edit history for a document
 * GET /api/claude/history/:documentId
 */
claude.get('/history/:documentId', async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const documentId = c.req.param('documentId');
  const userId = c.get('userId');
  const { limit, offset } = parsePagination(c);

  try {
    // Verify document ownership
    const doc = await db.select().from(schema.documents).where(eq(schema.documents.id, documentId)).get();
    if (doc && doc.userId && doc.userId !== userId) {
      return c.json({ error: 'Document not found' }, 404);
    }

    const history = await db
      .select()
      .from(schema.claudeInteractions)
      .where(eq(schema.claudeInteractions.documentId, documentId))
      .orderBy(desc(schema.claudeInteractions.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(schema.claudeInteractions)
      .where(eq(schema.claudeInteractions.documentId, documentId));

    return c.json({ 
      documentId,
      history: history.map(h => ({
        id: h.id,
        prompt: h.prompt,
        operation: h.operation,
        createdAt: h.createdAt.toISOString(),
        preview: h.response.substring(0, 200) + '...',
      })),
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error fetching Claude history:', error);
    return c.json({ error: 'Failed to fetch history' }, 500);
  }
});

export default claude;
