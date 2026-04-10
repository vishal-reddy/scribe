CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`created_at` integer NOT NULL,
	`last_login_at` integer,
	`session_token` text,
	`session_expires_at` integer,
	`otp_code` text,
	`otp_expires_at` integer,
	`is_verified` integer DEFAULT false
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);
--> statement-breakpoint
CREATE INDEX `idx_users_email` ON `users` (`email`);
--> statement-breakpoint
CREATE INDEX `idx_users_session_token` ON `users` (`session_token`);
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `user_id` text;
--> statement-breakpoint
CREATE INDEX `idx_documents_user_id` ON `documents` (`user_id`);
