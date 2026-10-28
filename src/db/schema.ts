import { sqliteTable, text, integer, index, primaryKey, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

// Users table - stores authenticated users
export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // SHA-256 hash of email
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp' }),
  sessionToken: text('session_token'), // hashed access token (short-lived)
  sessionExpiresAt: integer('session_expires_at', { mode: 'timestamp' }),
  refreshToken: text('refresh_token'), // hashed refresh token — rotates on each use
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  otpCode: text('otp_code'), // hashed OTP for email verification
  otpExpiresAt: integer('otp_expires_at', { mode: 'timestamp' }),
  isVerified: integer('is_verified', { mode: 'boolean' }).default(false),
  activeOrgId: text('active_org_id'),
}, (table) => [
  index('idx_users_email').on(table.email),
  index('idx_users_session_token').on(table.sessionToken),
  index('idx_users_refresh_token').on(table.refreshToken),
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
  orgId: text('org_id'), // FK to organizations.id
  parentId: text('parent_id').references((): AnySQLiteColumn => documents.id, { onDelete: 'set null' }), // folder hierarchy
  sortKey: text('sort_key'), // manual ordering among siblings
  // Set when the note is created/edited; cleared once Claude generates a feed
  // post for it. NULL = no pending feed work. Drives list_notes_needing_feed.
  feedQueuedAt: integer('feed_queued_at', { mode: 'timestamp' }),
  // Ephemeral notes (e.g. MCP quick-notes): auto-deleted by the daily sweep
  // once expiresAt passes, unless the user converts it via POST /persist
  // (which clears both fields). isEphemeral false / expiresAt null = normal.
  isEphemeral: integer('is_ephemeral', { mode: 'boolean' }).notNull().default(false),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
}, (table) => [
  index('idx_documents_updated_at').on(table.updatedAt),
  index('idx_documents_created_by').on(table.createdBy),
  index('idx_documents_user_id').on(table.userId),
  index('idx_documents_org_id').on(table.orgId),
  index('idx_documents_parent_id').on(table.parentId),
  index('idx_documents_feed_queued_at').on(table.feedQueuedAt),
  index('idx_documents_expires_at').on(table.expiresAt),
]);

// Small generic key/value store for app-wide settings (e.g. the default
// ephemeral-note TTL). Not per-user — see appSettings usage in
// src/routes/settings.ts and the create_ephemeral_note MCP tool for why.
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

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

// Feed posts — a simulated social feed. Posts are AI-generated learning
// snippets resurfaced from the user's notes (no real users / social graph).
// Claude writes these over MCP; the app reads them like documents
// (userId IS NULL = visible to everyone, matching the documents pattern).
export const feedPosts = sqliteTable('feed_posts', {
  id: text('id').primaryKey(),
  userId: text('user_id'), // FK to users.id — null for Claude-authored (visible to all)
  text: text('text').notNull(), // the snippet body (Twitter-length)
  kind: text('kind'), // Claude's freeform style tag: 'insight' | 'question' | 'quote' | 'connection' | 'hook'
  // Synthetic persona (no real account) — gives the social feel.
  authorName: text('author_name').notNull(), // e.g. "Aquinas Daily"
  authorHandle: text('author_handle').notNull(), // e.g. "aquinas" (rendered as @aquinas)
  authorAvatar: text('author_avatar'), // emoji or short seed for the avatar
  sourceDocumentId: text('source_document_id').references((): AnySQLiteColumn => documents.id, { onDelete: 'set null' }),
  sourceTitle: text('source_title'), // denormalized note title for display
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  savedAt: integer('saved_at', { mode: 'timestamp' }), // bookmarked by the user (null = not saved)
}, (table) => [
  index('idx_feed_posts_created_at').on(table.createdAt),
  index('idx_feed_posts_user_id').on(table.userId),
  index('idx_feed_posts_source_document_id').on(table.sourceDocumentId),
  index('idx_feed_posts_saved_at').on(table.savedAt),
]);

// Orgs: business accounts that own many workspaces. Every user also has a hidden personal org (isPersonal).
export const orgs = sqliteTable('orgs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  isPersonal: integer('is_personal', { mode: 'boolean' }).notNull().default(false),
  ownerUserId: text('owner_user_id').notNull(),
  kindeOrgCode: text('kinde_org_code'), // legacy, dual-written; see 0015
  externalProvider: text('external_provider'),
  externalId: text('external_id'),
  workspaceVisibility: text('workspace_visibility').notNull().default('org_members'), // org_members | org_admins | invite_only
  createdAt: integer('created_at').notNull(),
});

export const orgMembers = sqliteTable('org_members', {
  orgId: text('org_id').notNull(),
  userId: text('user_id').notNull(),
  role: text('role').notNull().default('member'), // 'owner' | 'admin' | 'member'
  joinedAt: integer('joined_at').notNull(),
}, (table) => [
  primaryKey({ columns: [table.orgId, table.userId] }),
  index('idx_org_members_user_id').on(table.userId),
]);

// Workspaces (the table keeps its older name `organizations`); each belongs to an org
export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  isPersonal: integer('is_personal', { mode: 'boolean' }).notNull().default(false),
  ownerUserId: text('owner_user_id').notNull(),
  orgId: text('org_id'), // the org this workspace belongs to
  visibility: text('visibility').notNull().default('inherit'), // inherit | org_members | org_admins | invite_only
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// Organization members
export const organizationMembers = sqliteTable('organization_members', {
  orgId: text('org_id').notNull(),
  userId: text('user_id').notNull(),
  role: text('role').notNull().default('member'), // 'owner' | 'admin' | 'member'
  joinedAt: integer('joined_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.orgId, table.userId] }),
  index('idx_org_members_user').on(table.userId),
]);

// Organization email invites
export const orgInvites = sqliteTable('org_invites', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  email: text('email').notNull(),
  role: text('role').notNull().default('member'),
  tokenHash: text('token_hash').notNull().unique(),
  invitedByUserId: text('invited_by_user_id').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  acceptedAt: integer('accepted_at', { mode: 'timestamp' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  resentAt: integer('resent_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('idx_org_invites_org_id').on(table.orgId),
  index('idx_org_invites_email').on(table.email),
]);

// Document direct shares (per-resource ACL)
export const documentShares = sqliteTable('document_shares', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  userId: text('user_id'),
  email: text('email').notNull(),
  role: text('role').notNull().default('viewer'), // 'viewer' | 'editor'
  createdByUserId: text('created_by_user_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => [
  index('idx_document_shares_document_id').on(table.documentId),
  index('idx_document_shares_user_id').on(table.userId),
  index('idx_document_shares_email').on(table.email),
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
export type FeedPost = typeof feedPosts.$inferSelect;
export type NewFeedPost = typeof feedPosts.$inferInsert;
export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;
export type OrgInvite = typeof orgInvites.$inferSelect;
export type NewOrgInvite = typeof orgInvites.$inferInsert;
export type DocumentShare = typeof documentShares.$inferSelect;
export type NewDocumentShare = typeof documentShares.$inferInsert;

