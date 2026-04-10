/**
 * Create a valid JWT token for testing.
 * The auth middleware does a simple base64 decode of the payload.
 */
export function createTestToken(email = 'test@example.com', name = 'Test User'): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({ email, name, exp: Date.now() + 3600000 }));
  const signature = 'test-signature';
  return `${header}.${payload}.${signature}`;
}

/**
 * Get auth headers with a valid test token
 */
export function getAuthHeaders(email?: string): Record<string, string> {
  return { Authorization: `Bearer ${createTestToken(email)}` };
}

/**
 * Apply D1 database migrations to create the required tables
 */
export async function applyMigrations(db: D1Database): Promise<void> {
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY NOT NULL, email text NOT NULL, name text, created_at integer NOT NULL, last_login_at integer, session_token text, session_expires_at integer, otp_code text, otp_expires_at integer, is_verified integer DEFAULT false)'
  ).run();

  await db.prepare(
    'CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email)'
  ).run();

  await db.prepare(
    'CREATE TABLE IF NOT EXISTS documents (id text PRIMARY KEY NOT NULL, title text NOT NULL, content text NOT NULL, markdown text NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, created_by text NOT NULL, last_edited_by text NOT NULL, user_id text)'
  ).run();

  await db.prepare(
    'CREATE TABLE IF NOT EXISTS document_versions (id text PRIMARY KEY NOT NULL, document_id text NOT NULL, version integer NOT NULL, content text NOT NULL, markdown text NOT NULL, created_at integer NOT NULL, created_by text NOT NULL, FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE)'
  ).run();

  await db.prepare(
    'CREATE TABLE IF NOT EXISTS claude_interactions (id text PRIMARY KEY NOT NULL, document_id text, prompt text NOT NULL, response text NOT NULL, operation text NOT NULL, created_at integer NOT NULL, FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL)'
  ).run();
}
