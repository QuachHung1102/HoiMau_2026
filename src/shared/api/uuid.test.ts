import { newActionId } from './uuid';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const realCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const setCrypto = (value: unknown) => Object.defineProperty(globalThis, 'crypto', { value, configurable: true, writable: true });

afterEach(() => {
  if (realCrypto) Object.defineProperty(globalThis, 'crypto', realCrypto);
  else delete (globalThis as { crypto?: unknown }).crypto;
});

const thousand = () => Array.from({ length: 1000 }, newActionId);

test('1 000 ids from Math.random (no crypto, as on Hermes) are unique UUID v4 strings', () => {
  setCrypto(undefined);
  const ids = thousand();
  expect(new Set(ids).size).toBe(1000);
  expect(ids.filter(id => !UUID_V4.test(id))).toEqual([]);
});

test('1 000 ids from crypto.getRandomValues are unique UUID v4 strings', () => {
  let seed = 1;
  const getRandomValues = jest.fn((bytes: Uint8Array) => {
    // a deterministic stand-in that covers every byte value, so the version and variant bits get masked
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (seed = (seed * 75 + 74) % 65537) % 256;
    return bytes;
  });
  setCrypto({ getRandomValues });
  const ids = thousand();
  expect(getRandomValues).toHaveBeenCalledTimes(1000);
  expect(new Set(ids).size).toBe(1000);
  expect(ids.filter(id => !UUID_V4.test(id))).toEqual([]);
});

test('the version and variant bits are forced even when every random byte is 0xff', () => {
  setCrypto({ getRandomValues: (bytes: Uint8Array) => bytes.fill(0xff) });
  expect(newActionId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
});
