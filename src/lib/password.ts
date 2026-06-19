export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  // Cloudflare Workers caps PBKDF2 at 100,000 iterations
  const iterations = 100_000;
  const key = await deriveKey(password, salt, iterations);
  const saltHex = bufToHex(salt);
  const keyHex = bufToHex(new Uint8Array(key));
  return `pbkdf2:${iterations}:${saltHex}:${keyHex}`;
}

export async function verifyPassword(password: string, stored: string): Promise<{ valid: boolean; needsRehash: boolean }> {
  const parts = stored.split(':');
  let iterations = 100_000;
  let saltHex = '';
  let expected = '';

  if (parts.length === 3 && parts[0] === 'pbkdf2') {
    saltHex = parts[1]!;
    expected = parts[2]!;
  } else if (parts.length === 4 && parts[0] === 'pbkdf2') {
    iterations = parseInt(parts[1]!, 10);
    if (iterations < 1_000 || iterations > 10_000_000) return { valid: false, needsRehash: false };
    saltHex = parts[2]!;
    expected = parts[3]!;
  } else {
    return { valid: false, needsRehash: false };
  }

  const salt = hexToBuf(saltHex);
  const derived = bufToHex(new Uint8Array(await deriveKey(password, salt, iterations)));
  const valid = timingSafeEqual(derived, expected);
  return { valid, needsRehash: valid && iterations < 100_000 };
}

export async function verifyPasswordLegacy(password: string, stored: string): Promise<boolean> {
  const result = await verifyPassword(password, stored);
  return result.valid;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    256
  );
}

function bufToHex(buf: Uint8Array): string {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return arr;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
