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
 * The server-side userId for an email — mirrors auth middleware's hashEmail
 * (hex SHA-256 of the lowercased, trimmed email). Useful for seeding rows owned
 * by the authenticated test user.
 */
export async function userIdFor(email = 'test@example.com'): Promise<string> {
  const data = new TextEncoder().encode(email.toLowerCase().trim());
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Load the real migration SQL at build time (vite raw glob) so the test schema
// always matches production — no hand-maintained DDL to drift.
const migrationFiles = import.meta.glob('../src/db/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Split a migration file into individual SQL statements. Handles both the
 *  drizzle `--> statement-breakpoint` separator and plain `;`-terminated SQL. */
function splitStatements(sql: string): string[] {
  return sql
    .replace(/^\s*--.*$/gm, '') // strip comment lines first (incl. drizzle's `--> statement-breakpoint`)
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Apply the real D1 migrations (in order) to a fresh test database, so tests
 * run against the exact production schema (documents, note_links, note_tags,
 * oauth, web_sessions, feed_posts, feed_queued_at, …).
 */
export async function applyMigrations(db: D1Database): Promise<void> {
  const paths = Object.keys(migrationFiles).sort();
  for (const path of paths) {
    for (const stmt of splitStatements(migrationFiles[path])) {
      try {
        await db.prepare(stmt).run();
      } catch (err) {
        // Idempotent: ignore "already exists" / "duplicate column" on re-runs.
        const msg = String((err as Error)?.message ?? err).toLowerCase();
        if (!msg.includes('already exists') && !msg.includes('duplicate column')) {
          throw err;
        }
      }
    }
  }
}
