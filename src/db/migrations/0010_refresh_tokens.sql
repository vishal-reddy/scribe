-- Refresh tokens: the access token (session_token) drops from 30 days to 1
-- hour; a long-lived, rotating refresh token now carries the "stay logged in"
-- burden instead, via POST /api/auth/refresh.
ALTER TABLE users ADD COLUMN refresh_token TEXT;
ALTER TABLE users ADD COLUMN refresh_token_expires_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_users_refresh_token ON users (refresh_token);
