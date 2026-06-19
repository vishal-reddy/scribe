ALTER TABLE `users` ADD COLUMN `password_hash` text;
--> statement-breakpoint

CREATE TABLE `web_sessions` (
  `session_id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `email` text NOT NULL,
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL
);
