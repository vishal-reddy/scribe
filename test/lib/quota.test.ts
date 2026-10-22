import { describe, it, expect, vi } from 'vitest';
import { calculateScribeStorageBytes, checkScribeQuota, reportScribeQuota } from '../../src/lib/quota';

describe('Scribe Quota Integration', () => {
  it('calculates storage bytes across documents', async () => {
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({ total_bytes: 1048576, doc_count: 5 }),
        }),
      }),
    };

    const res = await calculateScribeStorageBytes(mockDb as any, 'usr_test');
    expect(res.bytes).toBe(1048576);
    expect(res.count).toBe(5);
  });

  it('fails open if hub check encounters a network error', async () => {
    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network offline'));
    try {
      const res = await checkScribeQuota({} as any, 'usr_test', 1000);
      expect(res.allowed).toBe(true);
    } finally {
      globalThis.fetch = globalFetch;
    }
  });

  it('correctly blocks when hub responds with 403', async () => {
    const globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 403,
      json: vi.fn().mockResolvedValue({ message: 'Collective 50 MB limit exceeded' }),
    });
    try {
      const res = await checkScribeQuota({} as any, 'usr_test', 1000);
      expect(res.allowed).toBe(false);
      expect(res.message).toBe('Collective 50 MB limit exceeded');
    } finally {
      globalThis.fetch = globalFetch;
    }
  });
});
