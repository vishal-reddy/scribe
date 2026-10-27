import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { calculateScribeStorageBytes } from '../../src/lib/quota';
import { applyMigrations } from '../helpers';

// Runs against the real schema: a mocked D1 hid a wrong column name that made
// every account report 0 bytes used.
describe('calculateScribeStorageBytes (real schema)', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  it('counts only the given user\'s documents', async () => {
    const now = Math.floor(Date.now() / 1000);
    const insert = (id: string, userId: string) =>
      env.DB.prepare(
        `INSERT INTO documents (id, title, content, markdown, created_at, updated_at, created_by, last_edited_by, user_id)
         VALUES (?, 'abcd', 'xxxx', 'yyyyyy', ?, ?, 'user', 'user', ?)`
      ).bind(id, now, now, userId).run();
    await insert('q1', 'quota_user');
    await insert('q2', 'quota_user');
    await insert('q3', 'someone_else');

    const res = await calculateScribeStorageBytes(env.DB, 'quota_user');
    expect(res.count).toBe(2);
    expect(res.bytes).toBe(2 * (4 + 4 + 6));
  });
});
