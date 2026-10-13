import { randomBytes, scrypt } from 'node:crypto';
import { AppError } from './errors.ts';

// scrypt N = 2^15, r = 8, p = 1: 32 MiB per derivation, so maxmem leaves room above it.
const COST = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Length of a derived key, of a salt: what `credentials` stores (CHECKs in 10-auth.sql). */
export const KEY_BYTES = 32;
export const SALT_BYTES = 16;

export const newSalt = (): Buffer => randomBytes(SALT_BYTES);

export type Gate = { run<T>(work: () => Promise<T>): Promise<T> };

/**
 * At most `maxRunning` works at a time and `maxWaiting` more in line; one past that is refused
 * with RATE_LIMITED. Every derivation holds 32 MiB and a thread of the libuv pool for tens of
 * milliseconds: an unbounded queue of them is memory and latency for everybody.
 */
export function createGate(maxRunning: number, maxWaiting: number): Gate {
  let running = 0;
  const line: (() => void)[] = [];
  return {
    async run(work) {
      if (running < maxRunning) {
        running++;
      } else if (line.length < maxWaiting) {
        // the slot is handed over, not released and taken again: `running` stays as it is
        await new Promise<void>(resolve => line.push(resolve));
      } else {
        throw new AppError('RATE_LIMITED');
      }
      try {
        return await work();
      } finally {
        const next = line.shift();
        if (next === undefined) {
          running--;
        } else {
          next();
        }
      }
    },
  };
}

/** D6: 4 running (the size of the libuv pool), 32 waiting. */
export const scryptGate = createGate(4, 32);

/**
 * The key a password becomes. Call it in a route's `prepare`, never inside the request
 * transaction: it is slow on purpose. Refused with RATE_LIMITED when 36 derivations are
 * already running or waiting.
 */
export function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return scryptGate.run(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        scrypt(password, salt, KEY_BYTES, COST, (error, key) => {
          if (error === null) {
            resolve(key);
          } else {
            reject(error);
          }
        });
      }),
  );
}
