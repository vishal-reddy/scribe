CREATE TABLE `oauth_clients` (
  `client_id` TEXT PRIMARY KEY,
  `client_secret_hash` TEXT NOT NULL,
  `client_name` TEXT,
  `redirect_uris_json` TEXT NOT NULL,
  `token_endpoint_auth_method` TEXT NOT NULL DEFAULT 'client_secret_post',
  `grant_types_json` TEXT NOT NULL DEFAULT '["authorization_code","refresh_token"]',
  `response_types_json` TEXT NOT NULL DEFAULT '["code"]',
  `scope` TEXT,
  `created_at` INTEGER NOT NULL
);--> statement-breakpoint

CREATE TABLE `oauth_authorization_codes` (
  `code_hash` TEXT PRIMARY KEY,
  `client_id` TEXT NOT NULL,
  `user_id` TEXT NOT NULL,
  `redirect_uri` TEXT NOT NULL,
  `code_challenge` TEXT NOT NULL,
  `code_challenge_method` TEXT NOT NULL,
  `scope` TEXT,
  `resource` TEXT,
  `expires_at` INTEGER NOT NULL,
  `consumed_at` INTEGER,
  `created_at` INTEGER NOT NULL
);--> statement-breakpoint

CREATE TABLE `oauth_access_tokens` (
  `token_hash` TEXT PRIMARY KEY,
  `client_id` TEXT NOT NULL,
  `user_id` TEXT NOT NULL,
  `scope` TEXT,
  `resource` TEXT,
  `expires_at` INTEGER NOT NULL,
  `revoked_at` INTEGER,
  `last_used_at` INTEGER,
  `created_at` INTEGER NOT NULL
);--> statement-breakpoint

CREATE TABLE `oauth_refresh_tokens` (
  `token_hash` TEXT PRIMARY KEY,
  `client_id` TEXT NOT NULL,
  `user_id` TEXT NOT NULL,
  `scope` TEXT,
  `resource` TEXT,
  `expires_at` INTEGER,
  `revoked_at` INTEGER,
  `rotated_to` TEXT,
  `created_at` INTEGER NOT NULL
);--> statement-breakpoint

CREATE INDEX `idx_oauth_access_tokens_user` ON `oauth_access_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_refresh_tokens_user` ON `oauth_refresh_tokens` (`user_id`);
