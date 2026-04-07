import { McpAgent } from "agents/mcp";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { eq, like, or, desc, sql } from "drizzle-orm";
import * as schema from "../db/schema";
import type { Env } from "../types";

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
      description: "Create a new document in Scribe",
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
      };

      await db.insert(schema.documents).values(newDoc);

      return {
        content: [
          { type: "text" as const, text: `Document created successfully!\nID: ${documentId}\nTitle: ${title}` },
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
  }
}
