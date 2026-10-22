import { describe, it, expect, vi } from 'vitest';
import { calculateScribeStorageBytes, checkScribeQuota, reportScribeQuota, isUnlimitedAccount } from '../../src/lib/quota';

describe('Scribe Quota Integration', () => {
  it('exempts vlukereddy@gmail.com and Kecker employees with unlimited quota', async () => {
    expect(isUnlimitedAccount('vlukereddy@gmail.com')).toBe(true);
    expect(isUnlimitedAccount('usr_123', 'vlukereddy@gmail.com')).toBe(true);
    expect(isUnlimitedAccount('usr_123', 'dev@kecker.co')).toBe(true);
    expect(isUnlimitedAccount('usr_123', 'eng@kecker.com')).toBe(true);
    expect(isUnlimitedAccount('usr_123', 'freeuser@example.com')).toBe(false);

    const fetchSpy = vi.fn();
    const globalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy;
    try {
      const res1 = await checkScribeQuota({} as any, 'vlukereddy@gmail.com', 500000000);
      expect(res1.allowed).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();

      const res2 = await checkScribeQuota({} as any, 'usr_123', 500000000, 'staff@kecker.co');
      expect(res2.allowed).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = globalFetch;
    }
  });

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
