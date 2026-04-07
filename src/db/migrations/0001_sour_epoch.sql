CREATE INDEX `idx_claude_interactions_document_id` ON `claude_interactions` (`document_id`);--> statement-breakpoint
CREATE INDEX `idx_claude_interactions_created_at` ON `claude_interactions` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_document_versions_document_id` ON `document_versions` (`document_id`);--> statement-breakpoint
CREATE INDEX `idx_document_versions_document_version` ON `document_versions` (`document_id`,`version`);--> statement-breakpoint
CREATE INDEX `idx_documents_updated_at` ON `documents` (`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_documents_created_by` ON `documents` (`created_by`);