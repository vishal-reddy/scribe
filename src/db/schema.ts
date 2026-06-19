import { sqliteTable, text, integer, index, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

// Users table - stores authenticated users
export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // SHA-256 hash of email
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
  sessionToken: text('session_token'), // hashed session token
  sessionExpiresAt: integer('session_expires_at', { mode: 'timestamp' }),
  otpCode: text('otp_code'), // hashed OTP for email verification
  otpExpiresAt: integer('otp_expires_at', { mode: 'timestamp' }),
  isVerified: integer('is_verified', { mode: 'boolean' }).default(false),
}, (table) => [
  index('idx_users_email').on(table.email),
  index('idx_users_session_token').on(table.sessionToken),
]);

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
  userId: text('user_id'), // FK to users.id — null for legacy docs
  parentId: text('parent_id').references((): AnySQLiteColumn => documents.id, { onDelete: 'set null' }), // folder hierarchy
  sortKey: text('sort_key'), // manual ordering among siblings
}, (table) => [
  index('idx_documents_updated_at').on(table.updatedAt),
  index('idx_documents_created_by').on(table.createdBy),
  index('idx_documents_user_id').on(table.userId),
  index('idx_documents_parent_id').on(table.parentId),
]);

// Zettelkasten links between documents (parsed [[wikilinks]] + manual links)
export const noteLinks = sqliteTable('note_links', {
  id: text('id').primaryKey(),
  sourceId: text('source_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  targetId: text('target_id').references((): AnySQLiteColumn => documents.id, { onDelete: 'set null' }),
  targetText: text('target_text').notNull(),
  kind: text('kind').notNull().default('wiki'), // 'wiki' | 'manual'
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('idx_note_links_source_id').on(table.sourceId),
  index('idx_note_links_target_id').on(table.targetId),
  index('idx_note_links_target_text').on(table.targetText),
]);

// Tags — one row per (document, tag)
export const noteTags = sqliteTable('note_tags', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  tag: text('tag').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('idx_note_tags_tag').on(table.tag),
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
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type NewDocumentVersion = typeof documentVersions.$inferInsert;
export type ClaudeInteraction = typeof claudeInteractions.$inferSelect;
export type NewClaudeInteraction = typeof claudeInteractions.$inferInsert;
export type NoteLink = typeof noteLinks.$inferSelect;
export type NewNoteLink = typeof noteLinks.$inferInsert;
export type NoteTag = typeof noteTags.$inferSelect;
export type NewNoteTag = typeof noteTags.$inferInsert;
