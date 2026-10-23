import { McpAgent } from "agents/mcp";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { eq, like, or, and, desc, sql, isNotNull, asc, inArray } from "drizzle-orm";
import * as schema from "../db/schema";
import type { Env } from "../types";
import { reparseDocument, rebindLinksToTitle } from "../services/notes";
import { getEphemeralTtlDays, expiresAtFromNow } from "../services/ephemeral";
import {
  TAXONOMY_GUIDANCE,
  TAXONOMY_CATEGORIES,
  fileDocumentInCategory,
  listUnfiledDocuments,
  ownerFilter,
} from "../services/classification";
import { resolveScope, listOrganizationsForUser, switchActiveOrg, createOrganization } from "../lib/orgs";
import { getDocumentPermission, shareDocument, listDocumentShares } from "../lib/documentShares";
import { checkScribeQuota, reportScribeQuota } from "../lib/quota";

import { cleanGuidanceText, effectiveGuidance, getGuidanceLayer, setAuthorGuidance, setGuidanceLayer, validateAuthorText } from "../lib/writingGuidance";
import {
  EDIT_FOR_LEARNING_NOTE,
  PRESERVE_VOICE_NOTE,
  WRITING_PROMPTS,
  scribeInstructions,
  writingGuidanceEnabled,
} from "./writingGuidance";

type State = {};

/** Resolved once per /mcp request in index.ts's resolveMcpIdentity, attached as ctx.props before the request reaches this class. Empty userId is the dev-only unscoped path. */
export interface ScribeMcpProps extends Record<string, unknown> {
  userId: string;
  email: string;
}

export class ScribeMCP extends McpAgent<Env, State, ScribeMcpProps> {
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
      instructions: scribeInstructions({ writingGuidance: writingGuidanceEnabled(this.env?.WRITING_GUIDANCE) }),
    }
  );

  initialState: State = {};

  private getDb() {
    return drizzle(this.env.DB, { schema });
  }

  /** '' in the dev-only unscoped path (resolveMcpIdentity in index.ts) — ownerFilter treats that as "unowned documents only", never "everyone's". */
  private userId(): string {
    return this.props?.userId ?? "";
  }

  private email(): string {
    return this.props?.email ?? "";
  }

  /** For inserts: a real userId, or null to match the schema's NULL-means-unowned convention (never an empty string). */
  private userIdOrNull(): string | null {
    const id = this.userId();
    return id || null;
  }

  private async getScopeFilter() {
    const userId = this.userId();
    if (!userId) {
      return { filter: ownerFilter(null), activeOrgId: null };
    }
    const activeOrgId = await resolveScope(this.env, userId);
    const email = this.email();

    const { results } = await this.env.DB.prepare(
      `SELECT document_id FROM document_shares WHERE user_id = ? OR (email = ? AND email != '')`
    ).bind(userId, email).all<{ document_id: string }>();
    const sharedDocIds = results.map((r) => r.document_id);

    const filter = or(
      eq(schema.documents.userId, userId),
      eq(schema.documents.orgId, activeOrgId),
      sharedDocIds.length > 0 ? inArray(schema.documents.id, sharedDocIds) : undefined,
      sql`${schema.documents.userId} IS NULL`
    );

    return { filter, activeOrgId };
  }

  async init() {
    // The writer's own layer for all their notes goes into the server instructions (the channel hosts trust), so it applies
    // without the model having to ask for it. McpAgent connects `this.server` after init(), so building it here is safe.
    const userLayer = this.userId() ? await getGuidanceLayer(this.env, this.userId()) : null;
    this.server = new McpServer(
      { name: "Scribe", version: "1.0.0" },
      { instructions: scribeInstructions({ writingGuidance: writingGuidanceEnabled(this.env.WRITING_GUIDANCE), userLayer }) }
    );

    // ── Resources ──────────────────────────────────────────────────────

    this.server.resource(
      "documents",
      "scribe://documents",
      { description: "List of all documents in Scribe" },
      async (uri) => {
        const db = this.getDb();
        const { filter } = await this.getScopeFilter();
        const docs = await db
          .select({
            id: schema.documents.id,
            title: schema.documents.title,
            createdAt: schema.documents.createdAt,
            updatedAt: schema.documents.updatedAt,
            lastEditedBy: schema.documents.lastEditedBy,
          })
          .from(schema.documents)
          .where(filter)
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
        const documentId = String(variables.id);
        const userId = this.userId();
        const activeOrgId = userId ? await resolveScope(this.env, userId) : null;
        const perm = await getDocumentPermission(this.env, documentId, userId || null, activeOrgId);

        if (!perm.canRead) {
          return { contents: [] };
        }

        const doc = await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, documentId))
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

    // ── Prompts ────────────────────────────────────────────────────────
    // User-invoked (slash commands in hosts that support them), so the user opts in to each one. They carry the
    // same purpose as the server instructions: help the person write and speak better in their own words and language.
    for (const p of WRITING_PROMPTS) {
      this.server.registerPrompt(
        p.name,
        {
          title: p.title,
          description: p.description,
          argsSchema: Object.fromEntries(
            Object.entries(p.args).map(([k, d]) => [k, z.string().optional().describe(d)])
          ),
        },
        (args: Record<string, string | undefined>) => ({
          messages: [{ role: "user" as const, content: { type: "text" as const, text: p.build(args ?? {}) } }],
        })
      );
    }

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
      const { filter } = await this.getScopeFilter();
      const docs = await db
        .select({
          id: schema.documents.id,
          title: schema.documents.title,
          createdAt: schema.documents.createdAt,
          updatedAt: schema.documents.updatedAt,
          lastEditedBy: schema.documents.lastEditedBy,
        })
        .from(schema.documents)
        .where(filter)
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
      const userId = this.userId();
      const activeOrgId = userId ? await resolveScope(this.env, userId) : null;
      const perm = await getDocumentPermission(this.env, documentId, userId || null, activeOrgId);

      if (!perm.canRead) {
        return {
          content: [{ type: "text" as const, text: `Error: Document with ID ${documentId} not found` }],
          isError: true,
        };
      }

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
        "to Scribe\", \"start a new document\". " + PRESERVE_VOICE_NOTE + " After creating, classify the " +
        "document into the Thomistic taxonomy and file it by calling file_document with the returned document ID.",
      inputSchema: {
        title: z.string().describe("The title of the new document"),
        content: z.string().describe("The markdown content of the document"),
        guidance: z
          .string()
          .max(2000)
          .optional()
          .describe(
            "Only if the user said how they want to be helped with THIS note (for example \"ask me questions, " +
              "don't write it for me\"): their instructions, in their own words. Saved with the note and returned " +
              "by get_writing_guidance. Do not invent guidance the user didn't give."
          ),
        shareGuidance: z
          .string()
          .max(2000)
          .optional()
          .describe(
            "Only if the user is an author (a teacher, say) and asked to attach instructions for everyone who reads " +
              "this note. Readers see the text and choose whether their assistant follows it."
          ),
      },
      annotations: {
        title: "Create a Scribe document",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    }, async ({ title, content, guidance, shareGuidance }) => {
      const db = this.getDb();
      const documentId = crypto.randomUUID();
      const personalGuidance = cleanGuidanceText(guidance ?? "");
      const sharedGuidance: { text: string } | { error: string } = shareGuidance ? validateAuthorText(shareGuidance) : { text: "" };
      if (personalGuidance === null || "error" in sharedGuidance) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: personalGuidance === null ? "guidance is too long (2000 characters at most)." : ("error" in sharedGuidance ? sharedGuidance.error : "") }],
        };
      }
      const now = new Date();
      const userId = this.userId();
      const userEmail = this.props?.email;
      const activeOrgId = userId ? await resolveScope(this.env, userId) : null;

      if (userId) {
        const estBytes = (title?.length || 0) + (content?.length || 0);
        const check = await checkScribeQuota(this.env, userId, estBytes, userEmail);
        if (!check.allowed) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: check.message || "Collective storage quota exceeded." }],
          };
        }
      }

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
        userId: this.userIdOrNull(),
        orgId: activeOrgId,
      };

      await db.insert(schema.documents).values(newDoc);
      // Guidance the user gave for this note travels with it.
      let guidanceSaved = "";
      if (userId && personalGuidance) {
        await setGuidanceLayer(this.env, userId, documentId, personalGuidance, "append");
        guidanceSaved = " The user's guidance for this note is saved; get_writing_guidance returns it.";
      }
      if (userId && "text" in sharedGuidance && sharedGuidance.text) {
        await setAuthorGuidance(this.env, documentId, userId, (userEmail ?? "").split("@")[0], sharedGuidance.text);
        guidanceSaved += " Shared instructions are attached; readers choose whether to follow them.";
      }
      // Derive #tags / [[wikilinks]] and heal links that pointed to this title.
      await reparseDocument(db, documentId, newDoc.markdown ?? "");
      await rebindLinksToTitle(db, documentId, title);

      if (userId) {
        reportScribeQuota(this.env, userId, userEmail).catch(() => {});
      }

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Document created successfully!${guidanceSaved}\nID: ${documentId}\nTitle: ${title}\n\n` +
              `Now auto-organize it. ${TAXONOMY_GUIDANCE}\n\n` +
              `Then call file_document with documentId "${documentId}" and your chosen category.`,
          },
        ],
      };
    });

    this.server.registerTool("get_writing_guidance", {
      title: "Get the writer's guidance",
      description:
        "Returns how this writer wants to be helped with their writing: Scribe's defaults, layered with the " +
        "writer's own settings and, for a note, any instructions its author shared that the writer chose to " +
        "follow. Call it before coaching or editing, passing documentId when you are working on a specific " +
        "note. It is the writer's own setting, so follow it.",
      inputSchema: {
        documentId: z.string().optional().describe("The note you are working on, if any"),
      },
      annotations: {
        title: "Get the writer's guidance",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    }, async ({ documentId }) => {
      const userId = this.userId();
      if (documentId) {
        const activeOrgId = userId ? await resolveScope(this.env, userId) : null;
        const perm = await getDocumentPermission(this.env, documentId, userId || null, activeOrgId);
        if (!perm.canRead) {
          return {
            content: [{ type: "text" as const, text: `Error: Document with ID ${documentId} not found` }],
            isError: true,
          };
        }
      }
      const { text } = await effectiveGuidance(this.env, userId, documentId);
      return {
        content: [
          {
            type: "text" as const,
            text: text
              ? `The writer's current guidance${documentId ? " for this note" : ""}:\n\n${text}`
              : "The writer has turned Scribe's writing guidance off. Help with the task as asked.",
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
      const userId = this.userId();
      const userEmail = this.props?.email;
      const activeOrgId = userId ? await resolveScope(this.env, userId) : null;

      if (userId) {
        const estBytes = (title?.length || 0) + (content?.length || 0);
        const check = await checkScribeQuota(this.env, userId, estBytes, userEmail);
        if (!check.allowed) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: check.message || "Collective storage quota exceeded." }],
          };
        }
      }

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
        userId: this.userIdOrNull(),
        orgId: activeOrgId,
      };

      await db.insert(schema.documents).values(newDoc);
      await reparseDocument(db, documentId, newDoc.markdown ?? "");
      await rebindLinksToTitle(db, documentId, title);

      if (userId) {
        reportScribeQuota(this.env, userId, userEmail).catch(() => {});
      }

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
      const result = await fileDocumentInCategory(db, documentId, category, this.userIdOrNull());
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
      const docs = await listUnfiledDocuments(db, this.userIdOrNull(), limit ?? 50);
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
        "you need to preserve or extend the current text. " + PRESERVE_VOICE_NOTE + " " + EDIT_FOR_LEARNING_NOTE,
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
      const userId = this.userId();
      const activeOrgId = userId ? await resolveScope(this.env, userId) : null;
      const perm = await getDocumentPermission(this.env, documentId, userId || null, activeOrgId);

      if (!perm.canRead) {
        return {
          content: [{ type: "text" as const, text: `Error: Document with ID ${documentId} not found` }],
          isError: true,
        };
      }
      if (!perm.canWrite) {
        return {
          content: [{ type: "text" as const, text: `Error: Forbidden - document is read-only` }],
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

      if (userId) {
        reportScribeQuota(this.env, userId, this.props?.email).catch(() => {});
      }

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
      const { filter } = await this.getScopeFilter();
      const docs = await db
        .select({
          id: schema.documents.id,
          title: schema.documents.title,
          markdown: schema.documents.markdown,
        })
        .from(schema.documents)
        .where(
          and(
            filter,
            or(
              like(schema.documents.title, pattern),
              like(schema.documents.markdown, pattern)
            )
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
      const userId = this.userId();
      const activeOrgId = userId ? await resolveScope(this.env, userId) : null;
      const perm = await getDocumentPermission(this.env, documentId, userId || null, activeOrgId);

      if (!perm.canRead) {
        return {
          content: [{ type: "text" as const, text: `Error: Document with ID ${documentId} not found` }],
          isError: true,
        };
      }

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
      const userId = this.userId();
      const activeOrgId = userId ? await resolveScope(this.env, userId) : null;
      const perm = await getDocumentPermission(this.env, documentId, userId || null, activeOrgId);

      if (!perm.canRead) {
        return {
          content: [{ type: "text" as const, text: `Error: Document with ID ${documentId} not found` }],
          isError: true,
        };
      }
      if (!perm.canWrite) {
        return {
          content: [{ type: "text" as const, text: `Error: Forbidden - document is read-only` }],
          isError: true,
        };
      }

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

      // Resolve source note titles in one pass for display + validity — and
      // ownership, so a post can't be sourced from a document that isn't the
      // caller's (same "drop it, like it didn't resolve" treatment as an
      // unknown id, rather than a hard error over one bad item in a batch).
      const titleById = new Map<string, string | null>();
      for (const p of posts) {
        if (p.sourceDocumentId && !titleById.has(p.sourceDocumentId)) {
          const doc = await db
            .select({ title: schema.documents.title, userId: schema.documents.userId })
            .from(schema.documents)
            .where(eq(schema.documents.id, p.sourceDocumentId))
            .get();
          const owned = doc && (!doc.userId || doc.userId === this.userId());
          titleById.set(p.sourceDocumentId, owned ? doc.title : null);
        }
      }

      const rows: schema.NewFeedPost[] = posts.map((p) => {
        const sourceTitle = p.sourceDocumentId ? titleById.get(p.sourceDocumentId) ?? null : null;
        // Drop a sourceDocumentId that doesn't resolve (or isn't the caller's), to avoid a dangling FK.
        const sourceDocumentId = sourceTitle != null ? p.sourceDocumentId ?? null : null;
        return {
          id: crypto.randomUUID(),
          userId: this.userIdOrNull(),
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
        .where(and(ownerFilter(this.userId()), isNotNull(schema.documents.feedQueuedAt)))
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

    // ── Workspaces & Sharing ─────────────────────────────────────────────

    this.server.registerTool("list_organizations", {
      title: "List Scribe organizations/workspaces",
      description:
        "List all organizations/workspaces the user belongs to in Scribe, along with their role and " +
        "which workspace is currently active.",
      inputSchema: {},
      annotations: {
        title: "List Scribe organizations",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    }, async () => {
      const userId = this.userId();
      if (!userId) {
        return { content: [{ type: "text" as const, text: "No organizations available in unscoped mode." }] };
      }
      const activeOrgId = await resolveScope(this.env, userId);
      const orgs = await listOrganizationsForUser(this.env, userId);
      const enriched = orgs.map((o) => ({ ...o, isActive: o.id === activeOrgId }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify(enriched, null, 2) }],
      };
    });

    this.server.registerTool("create_organization", {
      title: "Create a Scribe organization/workspace",
      description:
        "Create a new shared workspace in Scribe for collaborating with others. You become its owner.",
      inputSchema: {
        name: z.string().describe("The name of the new workspace (e.g. 'Engineering', 'Family')"),
      },
      annotations: {
        title: "Create a Scribe organization",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    }, async ({ name }) => {
      const userId = this.userId();
      if (!userId) {
        return {
          content: [{ type: "text" as const, text: "Error: Must be authenticated to create a workspace." }],
          isError: true,
        };
      }
      const orgId = await createOrganization(this.env, userId, name);
      return {
        content: [
          { type: "text" as const, text: `Workspace "${name}" created successfully with ID: ${orgId}` },
        ],
      };
    });

    this.server.registerTool("switch_organization", {
      title: "Switch active Scribe organization/workspace",
      description:
        "Switch the user's active workspace in Scribe. Notes created afterward will belong to this workspace.",
      inputSchema: {
        orgId: z.string().describe("The ID of the organization to switch to"),
      },
      annotations: {
        title: "Switch active Scribe organization",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    }, async ({ orgId }) => {
      const userId = this.userId();
      if (!userId) {
        return {
          content: [{ type: "text" as const, text: "Error: Must be authenticated to switch workspace." }],
          isError: true,
        };
      }
      try {
        await switchActiveOrg(this.env, userId, orgId);
        return {
          content: [{ type: "text" as const, text: `Switched active workspace to: ${orgId}` }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${err?.message || "Failed to switch workspace"}` }],
          isError: true,
        };
      }
    });

    this.server.registerTool("share_document", {
      title: "Share a Scribe document",
      description:
        "Share a Scribe document with another user by their email address with either 'viewer' (read-only) or 'editor' (read-write) role.",
      inputSchema: {
        documentId: z.string().describe("The ID of the document to share"),
        email: z.string().email().describe("The email address of the person to share with"),
        role: z.enum(["viewer", "editor"]).default("editor").describe("The permission level ('viewer' or 'editor')"),
      },
      annotations: {
        title: "Share a Scribe document",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    }, async ({ documentId, email, role }) => {
      const userId = this.userId();
      if (!userId) {
        return {
          content: [{ type: "text" as const, text: "Error: Must be authenticated to share documents." }],
          isError: true,
        };
      }
      try {
        const result = await shareDocument(this.env, documentId, email, role, userId);
        return {
          content: [
            { type: "text" as const, text: `Document shared with ${email} as ${role} (Share ID: ${result.shareId})` },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Error sharing document: ${err?.message || "Failed"}` }],
          isError: true,
        };
      }
    });

    this.server.registerTool("list_document_shares", {
      title: "List Scribe document shares",
      description:
        "List all users who have direct access to this document via document-level shares.",
      inputSchema: {
        documentId: z.string().describe("The ID of the document"),
      },
      annotations: {
        title: "List Scribe document shares",
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    }, async ({ documentId }) => {
      const userId = this.userId();
      const activeOrgId = userId ? await resolveScope(this.env, userId) : null;
      const perm = await getDocumentPermission(this.env, documentId, userId || null, activeOrgId);

      if (!perm.canRead) {
        return {
          content: [{ type: "text" as const, text: `Error: Document with ID ${documentId} not found` }],
          isError: true,
        };
      }

      const shares = await listDocumentShares(this.env, documentId, userId);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(shares, null, 2) }],
      };
    });
  }
}
