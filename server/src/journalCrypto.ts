// The journal at rest (spec 10.1): AES-256-GCM in this process, so the database, its logs and its
// backups only ever hold ciphertext. Stored blob = version 0x01 ‖ 12-byte random IV ‖ ciphertext ‖
// 16-byte tag; the additional authenticated data "<userId>:<entryId>" binds a blob to its row, so a
// blob copied to another user or another entry does not decrypt.
//
// Never log, return in an error or hand to SQL anything but the blob: the text and the key stay here.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 0x01;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const aad = (userId: string, entryId: string) => Buffer.from(`${userId}:${entryId}`, 'utf8');

export function encryptJournal(key: Buffer, userId: string, entryId: string, text: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(userId, entryId));
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, body, cipher.getAuthTag()]);
}

/** Throws (a message without any of the input) when the blob is not one of ours for this row. */
export function decryptJournal(key: Buffer, userId: string, entryId: string, blob: Buffer): string {
  if (blob.length < 1 + IV_BYTES + TAG_BYTES || blob[0] !== VERSION) {
    throw new Error('journal blob: unknown layout');
  }
  const iv = blob.subarray(1, 1 + IV_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad(userId, entryId));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(blob.subarray(1 + IV_BYTES, blob.length - TAG_BYTES)), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    // node's own message names nothing secret, but one fixed message keeps it that way
    throw new Error('journal blob: authentication failed');
  }
}
