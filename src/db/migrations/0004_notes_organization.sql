-- Hierarchy: parent/child relationship between documents
ALTER TABLE `documents` ADD COLUMN `parent_id` TEXT REFERENCES `documents`(`id`) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `sort_key` TEXT;--> statement-breakpoint

CREATE INDEX `idx_documents_parent_id` ON `documents` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_documents_parent_sort` ON `documents` (`parent_id`, `sort_key`);--> statement-breakpoint

-- Zettelkasten: bidirectional links between notes
-- `target_id` is resolved doc id (null when target text didn't match any title yet).
-- `target_text` is the raw wikilink text so unresolved links can heal later.
-- `kind` distinguishes parser-derived ('wiki') from explicit ('manual') links.
CREATE TABLE `note_links` (
  `id` TEXT PRIMARY KEY,
  `source_id` TEXT NOT NULL REFERENCES `documents`(`id`) ON DELETE CASCADE,
  `target_id` TEXT REFERENCES `documents`(`id`) ON DELETE SET NULL,
  `target_text` TEXT NOT NULL,
  `kind` TEXT NOT NULL DEFAULT 'wiki',
  `created_at` INTEGER NOT NULL
);--> statement-breakpoint

CREATE INDEX `idx_note_links_source_id` ON `note_links` (`source_id`);--> statement-breakpoint
CREATE INDEX `idx_note_links_target_id` ON `note_links` (`target_id`);--> statement-breakpoint
CREATE INDEX `idx_note_links_target_text` ON `note_links` (`target_text`);--> statement-breakpoint

-- Tags table — one row per (document, tag) pair.
CREATE TABLE `note_tags` (
  `id` TEXT PRIMARY KEY,
  `document_id` TEXT NOT NULL REFERENCES `documents`(`id`) ON DELETE CASCADE,
  `tag` TEXT NOT NULL,
  `created_at` INTEGER NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX `idx_note_tags_doc_tag` ON `note_tags` (`document_id`, `tag`);--> statement-breakpoint
CREATE INDEX `idx_note_tags_tag` ON `note_tags` (`tag`);
