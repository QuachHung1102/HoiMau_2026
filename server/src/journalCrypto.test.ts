// encryptJournal / decryptJournal without a database: the layout of the blob, the round trip, and
// that the authenticated data binds a blob to its user and entry.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { decryptJournal, encryptJournal } from './journalCrypto.ts';

const KEY = Buffer.alloc(32, 7);
const TEXT = 'Hôm nay mình đi bộ 30 phút, trời mát 🌿';

test('round trip; layout 0x01 ‖ 12-byte IV ‖ ciphertext ‖ 16-byte tag; a fresh IV every time; no plaintext in the blob', () => {
  const [user, entry] = [randomUUID(), randomUUID()];
  const a = encryptJournal(KEY, user, entry, TEXT);
  const b = encryptJournal(KEY, user, entry, TEXT);
  assert.equal(decryptJournal(KEY, user, entry, a), TEXT);
  assert.equal(a[0], 0x01);
  assert.equal(a.length, 1 + 12 + Buffer.byteLength(TEXT) + 16);
  assert.notDeepEqual(a.subarray(1, 13), b.subarray(1, 13));
  assert.equal(a.indexOf(Buffer.from(TEXT, 'utf8')), -1);
});

test('another user, another entry, another key, one flipped byte anywhere, another version: decryption fails with a fixed message', () => {
  const [user, entry] = [randomUUID(), randomUUID()];
  const blob = encryptJournal(KEY, user, entry, TEXT);
  const fails = (fn: () => string) =>
    assert.throws(fn, (e: Error) => /^journal blob: (authentication failed|unknown layout)$/.test(e.message));
  fails(() => decryptJournal(KEY, randomUUID(), entry, blob));
  fails(() => decryptJournal(KEY, user, randomUUID(), blob));
  fails(() => decryptJournal(Buffer.alloc(32, 8), user, entry, blob));
  for (const at of [0, 1, 13, blob.length - 1]) {
    const tampered = Buffer.from(blob);
    tampered[at] = 255 - tampered[at];
    fails(() => decryptJournal(KEY, user, entry, tampered));
  }
  fails(() => decryptJournal(KEY, user, entry, blob.subarray(0, 28)));
});
