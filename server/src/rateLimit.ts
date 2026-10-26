// ponytail: in-process limiter, single server process; move to the DB if a second process is ever started
import { isIPv4 } from 'node:net';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;

/** Every write (a request that is not a GET), per account and per client address. */
export const WRITES_PER_MINUTE = { account: 120, ip: 300 };
/**
 * 401 answers per client address per minute, on routes that need a session. Each of them cost a
 * session lookup; past the limit the address gets 429 before the database is asked anything.
 */
export const UNAUTHORIZED_PER_MINUTE = 60;

const MAPPED = '::ffff:';

/** The address as clients are told apart: IPv4 written as IPv4, also when it arrives mapped into IPv6. */
export function clientAddress(remoteAddress: string | undefined): string {
  const address = (remoteAddress ?? '').split('%')[0].toLowerCase();
  const mapped = address.startsWith(MAPPED) ? address.slice(MAPPED.length) : '';
  return isIPv4(mapped) ? mapped : address;
}

/**
 * What an address is counted under: itself for IPv4, its /64 prefix for IPv6. One subscriber
 * holds a whole /64, so a window per full address would be a window per request.
 */
export function addressKey(address: string): string {
  if (!address.includes(':')) {
    return address;
  }
  const [head, tail] = address.split('::');
  const groups = (part: string | undefined) =>
    part === undefined || part === ''
      ? []
      : // an IPv4 tail ("64:ff9b::192.0.2.1") stands for two groups
        part
          .split(':')
          .flatMap(group => (group.includes('.') ? ['0', '0'] : [group]));
  const left = groups(head);
  const right = groups(tail);
  const all =
    tail === undefined
      ? left
      : [
          ...left,
          ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill(
            '0',
          ),
          ...right,
        ];
  return `${all
    .slice(0, 4)
    .map(group => (parseInt(group, 16) || 0).toString(16))
    .join(':')}::/64`;
}

export type RateLimiter = {
  /**
   * Counts one request on `key`. 0 = allowed; otherwise the request is over `limit` for the
   * current window and the result is the number of seconds until that window ends.
   */
  hit(key: string, limit: number, windowMs: number): number;
  /**
   * Counts nothing. 0 while fewer than `limit` requests were counted on `key` in the current
   * window; otherwise the number of seconds until that window ends.
   */
  full(key: string, limit: number, windowMs: number): number;
  /** Drops every window that is over. */
  sweep(): void;
  /** Number of windows held. */
  size(): number;
};

/**
 * Fixed windows: the window of a key starts at its first request and is not moved by later ones.
 * A window that is over is replaced on the next request of its key; `sweep` removes the windows
 * of keys that never come back, which is what keeps the map bounded.
 */
export function createRateLimiter(now: () => number = Date.now): RateLimiter {
  const windows = new Map<string, { end: number; count: number }>();
  const secondsLeft = (end: number, at: number) =>
    Math.max(1, Math.ceil((end - at) / 1000));
  return {
    hit(key, limit, windowMs) {
      const at = now();
      const id = `${windowMs}:${key}`;
      let window = windows.get(id);
      if (window === undefined || window.end <= at) {
        window = { end: at + windowMs, count: 0 };
        windows.set(id, window);
      }
      window.count++;
      return window.count <= limit ? 0 : secondsLeft(window.end, at);
    },
    full(key, limit, windowMs) {
      const at = now();
      const window = windows.get(`${windowMs}:${key}`);
      return window === undefined || window.end <= at || window.count < limit
        ? 0
        : secondsLeft(window.end, at);
    },
    sweep() {
      const at = now();
      for (const [id, window] of windows) {
        if (window.end <= at) {
          windows.delete(id);
        }
      }
    },
    size: () => windows.size,
  };
}
