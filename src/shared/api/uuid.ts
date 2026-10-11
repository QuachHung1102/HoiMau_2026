type RandomSource = { getRandomValues?: (bytes: Uint8Array) => unknown };

/**
 * A new action id (UUID v4), sent as the `Idempotency-Key` of a write.
 */
// ponytail: an idempotency key, not a secret. Hermes does not reliably expose crypto.getRandomValues, so the
// fallback is Math.random: uniqueness per user is all the server needs. Never use this for anything
// security-relevant (tokens, codes, nonces); that would need a native random source.
export function newActionId(): string {
  const bytes = new Uint8Array(16);
  const source = (globalThis as { crypto?: RandomSource }).crypto;
  if (source?.getRandomValues) source.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = 0x40 + (bytes[6] % 0x10); // version 4
  bytes[8] = 0x80 + (bytes[8] % 0x40); // RFC 4122 variant
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
