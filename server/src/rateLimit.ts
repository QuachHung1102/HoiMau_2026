// ponytail: in-process limiter, single server process; move to the DB if a second process is ever started

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;

/** AR-21: every write (a request that is not a GET), per account and per client address. */
export const WRITES_PER_MINUTE = { account: 120, ip: 300 };

export type RateLimiter = {
  /**
   * Counts one request on `key`. 0 = allowed; otherwise the request is over `limit` for the
   * current window and the result is the number of seconds until that window ends.
   */
  hit(key: string, limit: number, windowMs: number): number;
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
      return window.count <= limit
        ? 0
        : Math.max(1, Math.ceil((window.end - at) / 1000));
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
