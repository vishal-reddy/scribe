import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// Documents table - stores user documents with CRDT state
export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(), // Y.js CRDT state (base64 encoded binary)
  markdown: text('markdown').notNull(), // Cached markdown export
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  createdBy: text('created_by').notNull(), // 'user' or 'claude'
  lastEditedBy: text('last_edited_by').notNull(), // 'user' or 'claude'
}, (table) => [
  index('idx_documents_updated_at').on(table.updatedAt),
  index('idx_documents_created_by').on(table.createdBy),
]);

// Document versions table - snapshots for version history
export const documentVersions = sqliteTable('document_versions', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  content: text('content').notNull(), // Y.js CRDT state snapshot
  markdown: text('markdown').notNull(), // Markdown at this version
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  createdBy: text('created_by').notNull(), // 'user' or 'claude'
}, (table) => [
  index('idx_document_versions_document_id').on(table.documentId),
  index('idx_document_versions_document_version').on(table.documentId, table.version),
]);

// Claude interactions table - audit log of AI operations
export const claudeInteractions = sqliteTable('claude_interactions', {
  id: text('id').primaryKey(),
  documentId: text('document_id').references(() => documents.id, { onDelete: 'set null' }),
  prompt: text('prompt').notNull(),
  response: text('response').notNull(),
  operation: text('operation').notNull(), // 'create', 'edit', 'read'
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('idx_claude_interactions_document_id').on(table.documentId),
  index('idx_claude_interactions_created_at').on(table.createdAt),
]);

// Export types for TypeScript
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type NewDocumentVersion = typeof documentVersions.$inferInsert;
export type ClaudeInteraction = typeof claudeInteractions.$inferSelect;
export type NewClaudeInteraction = typeof claudeInteractions.$inferInsert;
