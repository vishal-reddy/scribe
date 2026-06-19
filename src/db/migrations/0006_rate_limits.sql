-- Rate limiting buckets for distributed auth rate limits
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);
