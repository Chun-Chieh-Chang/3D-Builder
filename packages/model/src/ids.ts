/** Permanent object identifier (B1.3). Never reused, never derived from position or rebuild order. */
export type Id = string;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID-style id: 10 chars of millisecond time + 16 chars of randomness (Crockford base32). */
export function newId(now: number = Date.now()): Id {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let rand = '';
  for (const b of bytes) rand += CROCKFORD[b % 32];
  return time + rand;
}
