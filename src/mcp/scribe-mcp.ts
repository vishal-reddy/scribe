import { McpAgent } from "agents/mcp";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { eq, like, or, desc, sql, isNotNull, asc } from "drizzle-orm";
import * as schema from "../db/schema";
import type { Env } from "../types";
import { reparseDocument, rebindLinksToTitle } from "../services/notes";
import {
  TAXONOMY_GUIDANCE,
  TAXONOMY_CATEGORIES,
  fileDocumentInCategory,
  listUnfiledDocuments,
} from "../services/classification";

type State = {};

export class ScribeMCP extends McpAgent<Env, State, {}> {
  server = new McpServer({
    name: "Scribe",
    version: "1.0.0",
  });

  initialState: State = {};

  private getDb() {
    return drizzle(this.env.DB, { schema });
  }

  async init() {
    // ── Resources ──────────────────────────────────────────────────────

    this.server.resource(
      "documents",
      "scribe://documents",
      { description: "List of all documents in Scribe" },
      async (uri) => {
        const db = this.getDb();
        const docs = await db
          .select({
            id: schema.documents.id,
            title: schema.documents.title,
            createdAt: schema.documents.createdAt,
            updatedAt: schema.documents.updatedAt,
            lastEditedBy: schema.documents.lastEditedBy,
          })
          .from(schema.documents)
          .orderBy(desc(schema.documents.updatedAt));

        return {
          contents: [
            {
              text: JSON.stringify(docs, null, 2),
              uri: uri.href,
              mimeType: "application/json",
            },
          ],
        };
      }
    );

    this.server.resource(
      "document",
      new ResourceTemplate("scribe://document/{id}", { list: undefined }),
      { description: "A single Scribe document" },
      async (uri, variables) => {
        const db = this.getDb();
        const doc = await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, String(variables.id)))
          .get();

        if (!doc) {
          return { contents: [] };
        }

        return {
          contents: [
            {
              text: `# ${doc.title}\n\n${doc.markdown}`,
              uri: uri.href,
              mimeType: "text/markdown",
            },
          ],
        };
      }
    );

    // ── Tools ──────────────────────────────────────────────────────────

    this.server.registerTool("list_documents", {
      description: "List all user documents in Scribe",
    }, async () => {
      const db = this.getDb();
      const docs = await db
        .select({
          id: schema.documents.id,
          title: schema.documents.title,
          createdAt: schema.documents.createdAt,
          updatedAt: schema.documents.updatedAt,
          lastEditedBy: schema.documents.lastEditedBy,
        })
        .from(schema.documents)
        .orderBy(desc(schema.documents.updatedAt));

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(docs, null, 2) },
        ],
      };
    });

    this.server.registerTool("read_document", {
      description: "Read the content of a specific document",
      inputSchema: { documentId: z.string().describe("The ID of the document to read") },
    }, async ({ documentId }) => {
      const db = this.getDb();
      const doc = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId))
        .get();

      if (!doc) {
        return {
          content: [{ type: "text" as const, text: `Error: Document with ID ${documentId} not found` }],
          isError: true,
        };
      }

      return {
        content: [
          { type: "text" as const, text: `Title: ${doc.title}\n\nContent:\n${doc.markdown}` },
        ],
      };
    });

    this.server.registerTool("create_document", {
      description:
        "Create a new document in Scribe. After creating, classify the document into the " +
        "Thomistic taxonomy and file it by calling file_document with the returned document ID.",
      inputSchema: {
        title: z.string().describe("The title of the new document"),
        content: z.string().describe("The markdown content of the document"),
      },
    }, async ({ title, content }) => {
      const db = this.getDb();
      const documentId = crypto.randomUUID();
      const now = new Date();

      const newDoc: schema.NewDocument = {
        id: documentId,
        title,
        content: "",
        markdown: content || "",
        createdAt: now,
        updatedAt: now,
        createdBy: "claude",
        lastEditedBy: "claude",
        feedQueuedAt: now, // queue for a learning-feed post
      };

      await db.insert(schema.documents).values(newDoc);
      // Derive #tags / [[wikilinks]] and heal links that pointed to this title.
      await reparseDocument(db, documentId, newDoc.markdown ?? "");
      await rebindLinksToTitle(db, documentId, title);

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Document created successfully!\nID: ${documentId}\nTitle: ${title}\n\n` +
              `Now auto-organize it. ${TAXONOMY_GUIDANCE}\n\n` +
              `Then call file_document with documentId "${documentId}" and your chosen category.`,
          },
        ],
      };
    });

    // ── Auto-organization (Thomistic taxonomy) ───────────────────────────
    // Classification uses the user's Claude subscription: Claude picks the
    // category here in the MCP session; the server only does the filing.

    this.server.registerTool("list_categories", {
      description:
        "List the Thomistic taxonomy of the sciences and arts used to organize documents. " +
        "Use this to choose a category before calling file_document.",
      inputSchema: {},
    }, async () => ({
      content: [{ type: "text" as const, text: TAXONOMY_GUIDANCE }],
    }));

    this.server.registerTool("file_document", {
      description:
        "File a document under its Thomistic taxonomy category. Creates the category folder " +
        "(and its parent division) if needed and sets the document's parent. Call this after " +
        "classifying a document with the taxonomy from list_categories.",
      inputSchema: {
        documentId: z.string().describe("The ID of the document to file"),
        category: z
          .string()
          .describe(`The taxonomy leaf to file under. One of: ${TAXONOMY_CATEGORIES.join(", ")}`),
      },
    }, async ({ documentId, category }) => {
      const db = this.getDb();
      const result = await fileDocumentInCategory(db, documentId, category, null);
      if (!result) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Could not file document. Either the ID was not found or "${category}" is not a ` +
                `valid category. Valid categories: ${TAXONOMY_CATEGORIES.join(", ")}.`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          { type: "text" as const, text: `Filed under "${result.category}".` },
        ],
      };
    });

    this.server.registerTool("list_unfiled_documents", {
      description:
        "List documents that have not been filed under any folder yet (e.g. notes created in the " +
        "mobile app). Use this to find documents to classify and file with file_document.",
      inputSchema: {
        limit: z.number().optional().describe("Max documents to return (default 50)"),
      },
    }, async ({ limit }) => {
      const db = this.getDb();
      const docs = await listUnfiledDocuments(db, null, limit ?? 50);
      if (docs.length === 0) {
        return { content: [{ type: "text" as const, text: "No unfiled documents." }] };
      }
      const lines = docs
        .map((d) => `- ${d.id}: ${d.title}${d.markdown ? ` — ${d.markdown.slice(0, 80)}` : ""}`)
        .join("\n");
      return {
        content: [
          {
            type: "text" as const,
            text: `${docs.length} unfiled document(s):\n${lines}\n\nClassify each and file with file_document.`,
          },
        ],
      };
    });

    this.server.registerTool("update_document", {
      description: "Update an existing document's title and/or content",
      inputSchema: {
        documentId: z.string().describe("The ID of the document to update"),
        title: z.string().optional().describe("New title (optional)"),
        content: z.string().optional().describe("New markdown content (optional)"),
      },
    }, async ({ documentId, title, content }) => {
      const db = this.getDb();
      const existing = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId))
        .get();

      if (!existing) {
        return {
          content: [{ type: "text" as const, text: `Error: Document with ID ${documentId} not found` }],
          isError: true,
        };
      }

      const updates: Partial<schema.Document> = {
        updatedAt: new Date(),
        lastEditedBy: "claude",
      };
      if (title) updates.title = title;
      if (content !== undefined) updates.markdown = content;
      // Re-queue for a feed post when the readable content changes.
      if (title || content !== undefined) updates.feedQueuedAt = new Date();

      await db
        .update(schema.documents)
        .set(updates)
        .where(eq(schema.documents.id, documentId));

      return {
        content: [
          { type: "text" as const, text: `Document updated successfully!\nID: ${documentId}` },
        ],
      };
    });

    this.server.registerTool("search_documents", {
      description: "Search documents by title or content",
      inputSchema: {
        query: z.string().describe("Search query string"),
      },
    }, async ({ query }) => {
      const db = this.getDb();
      const pattern = `%${query}%`;
      const docs = await db
        .select({
          id: schema.documents.id,
          title: schema.documents.title,
          markdown: schema.documents.markdown,
        })
        .from(schema.documents)
        .where(
          or(
            like(schema.documents.title, pattern),
            like(schema.documents.markdown, pattern)
          )
        )
        .orderBy(desc(schema.documents.updatedAt));

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${docs.length} documents:\n\n${JSON.stringify(
              docs.map((d) => ({
                id: d.id,
                title: d.title,
                preview: d.markdown.substring(0, 100) + "...",
              })),
              null,
              2
            )}`,
          },
        ],
      };
    });

    this.server.registerTool("get_document_versions", {
      description: "Get version history for a document",
      inputSchema: {
        documentId: z.string().describe("The ID of the document"),
      },
    }, async ({ documentId }) => {
      const db = this.getDb();
      const versions = await db
        .select({
          id: schema.documentVersions.id,
          version: schema.documentVersions.version,
          createdAt: schema.documentVersions.createdAt,
          createdBy: schema.documentVersions.createdBy,
        })
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, documentId))
        .orderBy(desc(schema.documentVersions.version));

      if (versions.length === 0) {
        return {
          content: [
            { type: "text" as const, text: `No version history found for document ${documentId}` },
          ],
        };
      }

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(versions, null, 2) },
        ],
      };
    });

    this.server.registerTool("create_version_snapshot", {
      description: "Create a version snapshot of a document",
      inputSchema: {
        documentId: z.string().describe("The ID of the document to snapshot"),
      },
    }, async ({ documentId }) => {
      const db = this.getDb();

      const doc = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId))
        .get();

      if (!doc) {
        return {
          content: [{ type: "text" as const, text: `Error: Document with ID ${documentId} not found` }],
          isError: true,
        };
      }

      // Determine next version number
      const latestVersion = await db
        .select({ maxVersion: sql<number>`MAX(${schema.documentVersions.version})` })
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, documentId))
        .get();

      const nextVersion = (latestVersion?.maxVersion ?? 0) + 1;
      const versionId = crypto.randomUUID();

      const newVersion: schema.NewDocumentVersion = {
        id: versionId,
        documentId,
        version: nextVersion,
        content: doc.content,
        markdown: doc.markdown,
        createdAt: new Date(),
        createdBy: "claude",
      };

      await db.insert(schema.documentVersions).values(newVersion);

      return {
        content: [
          {
            type: "text" as const,
            text: `Version snapshot created!\nDocument: ${documentId}\nVersion: ${nextVersion}\nSnapshot ID: ${versionId}`,
          },
        ],
      };
    });

    // ── Learning feed ────────────────────────────────────────────────────
    // The mobile app has a Twitter-like "feed" tab that resurfaces the user's
    // own notes as short, scrollable learning snippets. There are no real users
    // — the feed is a simulation. Claude (in the user's own app) reads their
    // notes via the tools above and posts back a batch of snippets here; the
    // app renders them.

    this.server.registerTool("create_feed_posts", {
      description:
        "Populate the user's learning feed (a simulated, Twitter-like feed in the Scribe app) with " +
        "short snippets generated from their notes. First read the relevant notes (list_documents / " +
        "read_document / search_documents), then write a batch of bite-sized posts that REINFORCE " +
        "what the notes contain — key insights, active-recall questions, memorable quotes, or " +
        "connections between notes. Guidance:\n" +
        "- Keep each `text` punchy and Twitter-length (aim ≤ 280 chars). Plain language, no preamble.\n" +
        "- Give each post a synthetic persona (`authorName` + `authorHandle` + an emoji `authorAvatar`) " +
        "themed to the subject (e.g. \"Aquinas Daily\"/\"aquinas\"/\"🟣\"). Reuse handles across related " +
        "posts so the feed feels like recurring accounts. These are NOT real users.\n" +
        "- Set `sourceDocumentId` to the note a post came from so the app can link back to it.\n" +
        "- Vary `kind` across the batch: 'insight' | 'question' | 'quote' | 'connection' | 'hook'.\n" +
        "- A good batch is ~5–15 posts spanning several notes.",
      inputSchema: {
        posts: z
          .array(
            z.object({
              text: z.string().describe("The snippet body. Twitter-length (≤ 280 chars), plain language."),
              authorName: z.string().describe("Synthetic persona display name, e.g. \"Aquinas Daily\"."),
              authorHandle: z.string().describe("Persona handle without @, e.g. \"aquinas\". Reuse across related posts."),
              authorAvatar: z.string().optional().describe("A single emoji for the avatar, e.g. \"🟣\"."),
              kind: z.string().optional().describe("Style: 'insight' | 'question' | 'quote' | 'connection' | 'hook'."),
              sourceDocumentId: z.string().optional().describe("ID of the note this snippet came from (links back)."),
            })
          )
          .min(1)
          .describe("The batch of feed posts to publish."),
      },
    }, async ({ posts }) => {
      const db = this.getDb();
      const now = new Date();

      // Resolve source note titles in one pass for display + validity.
      const titleById = new Map<string, string | null>();
      for (const p of posts) {
        if (p.sourceDocumentId && !titleById.has(p.sourceDocumentId)) {
          const doc = await db
            .select({ title: schema.documents.title })
            .from(schema.documents)
            .where(eq(schema.documents.id, p.sourceDocumentId))
            .get();
          titleById.set(p.sourceDocumentId, doc?.title ?? null);
        }
      }

      const rows: schema.NewFeedPost[] = posts.map((p) => {
        const sourceTitle = p.sourceDocumentId ? titleById.get(p.sourceDocumentId) ?? null : null;
        // Drop a sourceDocumentId that doesn't resolve, to avoid a dangling FK.
        const sourceDocumentId = sourceTitle != null ? p.sourceDocumentId ?? null : null;
        return {
          id: crypto.randomUUID(),
          userId: null,
          text: p.text,
          kind: p.kind ?? null,
          authorName: p.authorName,
          authorHandle: p.authorHandle.replace(/^@/, ""),
          authorAvatar: p.authorAvatar ?? null,
          sourceDocumentId,
          sourceTitle,
          createdAt: now,
          savedAt: null,
        };
      });

      await db.insert(schema.feedPosts).values(rows);

      // Dequeue every note we made a post for, so it drops out of
      // list_notes_needing_feed (a later edit re-queues it).
      const coveredDocIds = [...new Set(rows.map((r) => r.sourceDocumentId).filter((id): id is string => id != null))];
      for (const docId of coveredDocIds) {
        await db
          .update(schema.documents)
          .set({ feedQueuedAt: null })
          .where(eq(schema.documents.id, docId));
      }

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Published ${rows.length} post(s) to the learning feed` +
              (coveredDocIds.length ? ` and cleared ${coveredDocIds.length} note(s) from the feed queue` : "") +
              `. They'll appear in the user's Feed tab, newest first.`,
          },
        ],
      };
    });

    this.server.registerTool("list_notes_needing_feed", {
      description:
        "List notes that have been created or edited but don't have a learning-feed post yet " +
        "(the feed auto-queue). Use this to drive the feed: read each note, then call " +
        "create_feed_posts with snippets that reinforce it — that automatically clears the note " +
        "from this queue. Returns oldest-queued first.",
      inputSchema: {
        limit: z.number().optional().describe("Max notes to return (default 25)"),
      },
    }, async ({ limit }) => {
      const db = this.getDb();
      const docs = await db
        .select({
          id: schema.documents.id,
          title: schema.documents.title,
          markdown: schema.documents.markdown,
          feedQueuedAt: schema.documents.feedQueuedAt,
        })
        .from(schema.documents)
        .where(isNotNull(schema.documents.feedQueuedAt))
        .orderBy(asc(schema.documents.feedQueuedAt))
        .limit(limit ?? 25);

      if (docs.length === 0) {
        return { content: [{ type: "text" as const, text: "No notes are waiting for a feed post." }] };
      }

      const lines = docs
        .map((d) => `- ${d.id}: ${d.title}${d.markdown ? ` — ${d.markdown.slice(0, 120).replace(/\s+/g, " ")}` : ""}`)
        .join("\n");
      return {
        content: [
          {
            type: "text" as const,
            text:
              `${docs.length} note(s) waiting for a feed post:\n${lines}\n\n` +
              `Read each (read_document) and call create_feed_posts with reinforcement snippets ` +
              `(set sourceDocumentId so they're linked and dequeued).`,
          },
        ],
      };
    });
  }
}
