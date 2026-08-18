import { McpAgent } from "agents/mcp";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { eq, like, or, desc, sql, isNotNull, asc } from "drizzle-orm";
import * as schema from "../db/schema";
import type { Env } from "../types";
import { reparseDocument, rebindLinksToTitle } from "../services/notes";
import { getEphemeralTtlDays, expiresAtFromNow } from "../services/ephemeral";
import {
  TAXONOMY_GUIDANCE,
  TAXONOMY_CATEGORIES,
  fileDocumentInCategory,
  listUnfiledDocuments,
} from "../services/classification";

type State = {};

export class ScribeMCP extends McpAgent<Env, State, {}> {
  server = new McpServer(
    {
      name: "Scribe",
      version: "1.0.0",
    },
    {
      // Surfaced to the client/model during `initialize`. This orients tool
      // discovery: when several connected MCP servers all traffic in
      // "documents"/"notes", these instructions tell the model that the user's
      // personal notes/writing live in Scribe and which tool to reach for.
      instructions:
        "Scribe is the user's personal note-taking and writing app. It is the source of truth for " +
        "the user's own notes, documents, and writing — in Scribe the words \"note\" and \"document\" " +
        "mean the same thing. Use these tools whenever the user asks to see, list, browse, search, read, " +
        "create, or edit THEIR notes/documents/writing (e.g. \"list my Scribe documents\", \"show my " +
        "notes\", \"find my note about X\", \"add a note\"). Prefer Scribe over generic file/drive/email " +
        "tools for anything the user calls their notes, their documents, or their writing.\n\n" +
        "Typical flow: `list_documents` or `search_documents` to find a note, `read_document` to read one, " +
        "`create_document`/`update_document` to write. New documents should then be classified with " +
        "`list_categories` and filed with `file_document`; `list_unfiled_documents` finds ones still " +
        "needing filing. The learning feed (`list_notes_needing_feed` + `create_feed_posts`) turns notes " +
        "into spaced-repetition study prompts. For reminders/scratch notes meant to self-delete, use " +
        "`create_ephemeral_note` instead of `create_document`.",
    }
  );

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
      title: "List Scribe documents",
      description:
        "List all of the user's documents (a.k.a. notes) in Scribe, newest-edited first. " +
        "Use this whenever the user asks to see, show, list, or browse their Scribe documents, " +
        "notes, or writing — e.g. \"list my Scribe documents\", \"show my notes\", \"what notes do I " +
        "have\". Returns each document's id, title, and timestamps (not its body — use read_document " +
        "for the content). Takes no arguments.",
      inputSchema: {},
      annotations: {
        title: "List Scribe documents",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
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
      title: "Read a Scribe document",
      description:
        "Read the full title and markdown content of one of the user's Scribe documents (notes). " +
        "Use this to open or read a specific note once you have its id (from list_documents or " +
        "search_documents) — e.g. \"read my note about X\", \"open that document\".",
      inputSchema: { documentId: z.string().describe("The ID of the document to read") },
      annotations: {
        title: "Read a Scribe document",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
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

      return {
        content: [
          { type: "text" as const, text: `Title: ${doc.title}\n\nContent:\n${doc.markdown}` },
        ],
      };
    });

    this.server.registerTool("create_document", {
      title: "Create a Scribe document",
      description:
        "Create a new document (note) in the user's Scribe. Use this when the user asks to add, " +
        "create, write, save, or jot down a note/document — e.g. \"add a note about X\", \"save this " +
        "to Scribe\", \"start a new document\". After creating, classify the document into the " +
        "Thomistic taxonomy and file it by calling file_document with the returned document ID.",
      inputSchema: {
        title: z.string().describe("The title of the new document"),
        content: z.string().describe("The markdown content of the document"),
      },
      annotations: {
        title: "Create a Scribe document",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
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

    this.server.registerTool("create_ephemeral_note", {
      title: "Create an ephemeral Scribe note",
      description:
        "Create a throwaway/quick note in the user's Scribe that self-deletes after a TTL " +
        "(app-wide default, currently configured in the user's Settings; pass ttlDays to override " +
        "for just this note). It appears in the regular document list like any other note, and the " +
        "user can tap \"Make permanent\" in the app to keep it forever — otherwise it (and any " +
        "learning-feed post generated from it) is deleted once it expires. Use this for reminders, " +
        "scratch notes, or anything explicitly temporary; use create_document for anything meant to " +
        "last.",
      inputSchema: {
        title: z.string().describe("The title of the new note"),
        content: z.string().describe("The markdown content of the note"),
        ttlDays: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Days until this note expires. Defaults to the app-wide setting (usually 30)."),
      },
      annotations: {
        title: "Create an ephemeral Scribe note",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    }, async ({ title, content, ttlDays }) => {
      const db = this.getDb();
      const documentId = crypto.randomUUID();
      const now = new Date();
      const effectiveTtlDays = ttlDays ?? (await getEphemeralTtlDays(this.env));
      const expiresAt = expiresAtFromNow(effectiveTtlDays);

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
        isEphemeral: true,
        expiresAt,
      };

      await db.insert(schema.documents).values(newDoc);
      await reparseDocument(db, documentId, newDoc.markdown ?? "");
      await rebindLinksToTitle(db, documentId, title);

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Ephemeral note created!\nID: ${documentId}\nTitle: ${title}\n` +
              `Expires: ${expiresAt.toISOString()} (${effectiveTtlDays} days) unless the user makes it permanent in the app.`,
          },
        ],
      };
    });

    // ── Auto-organization (Thomistic taxonomy) ───────────────────────────
    // Classification uses the user's Claude subscription: Claude picks the
    // category here in the MCP session; the server only does the filing.

    this.server.registerTool("list_categories", {
      title: "List Scribe taxonomy categories",
      description:
        "List the Thomistic taxonomy of the sciences and arts used to organize Scribe documents. " +
        "Use this to choose a category before calling file_document. Takes no arguments.",
      inputSchema: {},
      annotations: {
        title: "List Scribe taxonomy categories",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    }, async () => ({
      content: [{ type: "text" as const, text: TAXONOMY_GUIDANCE }],
    }));

    this.server.registerTool("file_document", {
      title: "File a Scribe document under a category",
      description:
        "File a Scribe document (note) under its Thomistic taxonomy category — i.e. organize/move it " +
        "into the right folder. Creates the category folder (and its parent division) if needed and " +
        "sets the document's parent. Call this after classifying a document with the taxonomy from " +
        "list_categories.",
      inputSchema: {
        documentId: z.string().describe("The ID of the document to file"),
        category: z
          .string()
          .describe(`The taxonomy leaf to file under. One of: ${TAXONOMY_CATEGORIES.join(", ")}`),
      },
      annotations: {
        title: "File a Scribe document under a category",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
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
      title: "List unfiled Scribe documents",
      description:
        "List the user's Scribe documents (notes) that have not been filed under any folder yet " +
        "(e.g. notes created in the mobile app) — the ones still needing to be organized. Use this to " +
        "find documents to classify and file with file_document.",
      inputSchema: {
        limit: z.number().optional().describe("Max documents to return (default 50)"),
      },
      annotations: {
        title: "List unfiled Scribe documents",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
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
      title: "Update a Scribe document",
      description:
        "Update an existing Scribe document (note): change its title and/or replace its markdown " +
        "content. Use this when the user asks to edit, rewrite, append to, or change one of their " +
        "notes/documents. Content, when provided, REPLACES the existing body — read_document first if " +
        "you need to preserve or extend the current text.",
      inputSchema: {
        documentId: z.string().describe("The ID of the document to update"),
        title: z.string().optional().describe("New title (optional)"),
        content: z.string().optional().describe("New markdown content (optional)"),
      },
      annotations: {
        title: "Update a Scribe document",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
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
      title: "Search Scribe documents",
      description:
        "Search the user's Scribe documents (notes) by keyword in their title or body, returning " +
        "matches with a short preview. Use this when the user wants to find a specific note/document " +
        "or everything mentioning a topic — e.g. \"find my note about X\", \"search my Scribe for Y\".",
      inputSchema: {
        query: z.string().describe("Search query string"),
      },
      annotations: {
        title: "Search Scribe documents",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
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
      title: "Get Scribe document version history",
      description:
        "Get the version history (saved snapshots) of one of the user's Scribe documents (notes). " +
        "Use this to review past revisions of a note. Returns version numbers, timestamps, and authors.",
      inputSchema: {
        documentId: z.string().describe("The ID of the document"),
      },
      annotations: {
        title: "Get Scribe document version history",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
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
      title: "Snapshot a Scribe document",
      description:
        "Save a version snapshot of one of the user's Scribe documents (notes), capturing its current " +
        "content so it can be restored or compared later. Use this before making large edits, or when " +
        "the user asks to checkpoint/save a version of a note.",
      inputSchema: {
        documentId: z.string().describe("The ID of the document to snapshot"),
      },
      annotations: {
        title: "Snapshot a Scribe document",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
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
      title: "Publish learning-feed posts",
      annotations: {
        title: "Publish learning-feed posts",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      description:
        "Populate the user's learning feed — a simulated, Twitter-like feed in the Scribe app whose " +
        "real purpose is REINFORCEMENT LEARNING: helping the user remember and deepen their own notes. " +
        "Optimize every post for long-term retention, not for summary.\n\n" +
        "First read the relevant notes (read_document / list_notes_needing_feed / search_documents), " +
        "then write a batch of posts grounded ONLY in what those notes actually say. Apply these " +
        "evidence-based principles (retrieval practice, spacing, elaboration, desirable difficulty):\n" +
        "- RETRIEVAL FIRST. Most posts should make the reader recall something from memory rather than " +
        "re-read it — a pointed question, a cloze (fill-in-the-blank using ‘___’ for a key term), or a " +
        "‘predict / explain’ prompt. The testing effect beats restatement. Plain restated facts should " +
        "be the minority.\n" +
        "- ONE IDEA PER POST. Atomic, like a good flashcard. Split a compound idea into several posts.\n" +
        "- DESIRABLE DIFFICULTY. Make them think: don't reveal the answer inside the question, avoid " +
        "trivial yes/no, and don't quote the note verbatim when a question would force recall.\n" +
        "- ELABORATE & CONNECT. Mix in posts that ask ‘why/how’, prompt the reader to restate an idea " +
        "in their own words, apply it to a concrete example, or link two related notes (‘How does X " +
        "relate to Y?’). Elaboration and connection build durable memory.\n" +
        "- SPACE & INTERLEAVE. Pull from across several notes — including OLDER ones, not just the " +
        "newest — and mix subjects within the batch so retrieval is varied, not blocked.\n" +
        "- GROUNDED. Never invent facts; everything must be answerable from the user's notes. Always set " +
        "`sourceDocumentId` so the reader can tap through to verify and study the source.\n\n" +
        "Style: keep each `text` punchy and Twitter-length (≤ 280 chars), plain language, no preamble. " +
        "Give each post a synthetic persona (`authorName` + `authorHandle` + emoji `authorAvatar`) themed " +
        "to the subject (e.g. \"Aquinas Daily\"/\"aquinas\"/\"🟣\"); reuse handles across related posts so it " +
        "feels like recurring accounts — they are NOT real users. A good batch is ~5–15 posts spanning " +
        "several notes, mostly retrieval-style.",
      inputSchema: {
        posts: z
          .array(
            z.object({
              text: z
                .string()
                .describe(
                  "The post body, optimized for recall (a question, cloze ‘___’, or prompt to explain/apply) " +
                  "rather than a restatement. Twitter-length (≤ 280 chars), plain language, no preamble."
                ),
              authorName: z.string().describe("Synthetic persona display name, e.g. \"Aquinas Daily\"."),
              authorHandle: z.string().describe("Persona handle without @, e.g. \"aquinas\". Reuse across related posts."),
              authorAvatar: z.string().optional().describe("A single emoji for the avatar, e.g. \"🟣\"."),
              kind: z
                .string()
                .optional()
                .describe(
                  "Learning style — favor the retrieval kinds: 'recall' (question answered from memory) | " +
                  "'cloze' (fill-in-the-blank) | 'why' (elaborative why/how) | 'apply' (use it on an example) | " +
                  "'connect' (link two notes) | 'insight' (a sharp key idea — use sparingly)."
                ),
              sourceDocumentId: z.string().optional().describe("ID of the note this post came from (links back + dequeues it). Always set when known."),
            })
          )
          .min(1)
          .describe("The batch of feed posts to publish. Aim for mostly retrieval-style posts across several notes."),
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
      title: "List notes needing a feed post",
      annotations: {
        title: "List notes needing a feed post",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      description:
        "List notes that have been created or edited but don't have a learning-feed post yet " +
        "(the feed auto-queue). Use this to drive the feed: read each note (read_document), then call " +
        "create_feed_posts with retrieval-style posts that reinforce it — mostly recall questions and " +
        "cloze prompts, not restatements — which automatically clears the note from this queue. " +
        "Returns oldest-queued first.",
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
