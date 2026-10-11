import { readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Pool, PoolClient } from 'pg';
import { setRole, withRole } from './db.ts';
import { errorResponse, refusalOf } from './errors.ts';
import {
  ClientGone,
  matchPath,
  readJsonBody,
  send,
  splitTarget,
  unstorableQueryParam,
} from './http.ts';
import {
  beginKey,
  idempotencyKey,
  requestHash,
  storeKey,
} from './idempotency.ts';
import { createLogger, describeError } from './log.ts';
import type { Logger } from './log.ts';
import {
  HOUR_MS,
  MINUTE_MS,
  WRITES_PER_MINUTE,
  createRateLimiter,
} from './rateLimit.ts';
import { bearerTokenHash, sessionUser } from './session.ts';

export type Mailer = (m: {
  to: string;
  subject: string;
  text: string;
}) => Promise<void>;

export type Ctx = {
  /** Inside the request transaction, role already set: app_anon without a session, else app_auth. */
  db: PoolClient;
  userId: string | null;
  params: Record<string, string>;
  query: URLSearchParams;
  /** The parsed JSON body; `undefined` for a GET and for a request without a body. Validate it. */
  body: unknown;
  /** `SELECT app.now()` at the start of the request. */
  now: Date;
  /** The Idempotency-Key, lower-case; null on a route that is not idempotent. */
  actionId: string | null;
  /** SHA-256 of the bearer token (for logout); null on an `anon` route. The token itself is not kept. */
  tokenHash: Buffer | null;
  /** For work outside the request transaction, through `withRole` of db.ts. */
  pool: Pool;
  mailer: Mailer;
  journalKey: Buffer;
  /** The address of the socket. No proxy is trusted: X-Forwarded-For is never read. */
  ip: string;
  log: Logger;
  /** What the route's `prepare` returned; `undefined` without one. */
  prepared: unknown;
};

/** What exists before the request transaction: no client, no user, no clock. */
export type PreCtx = Omit<Ctx, 'db' | 'userId' | 'now' | 'prepared'>;

export type RouteResponse = { status: number; body?: unknown };

type RouteBase = {
  method: 'GET' | 'POST' | 'PATCH';
  /** Relative to /api/v1: '/day/quests/:questCode/progress'. */
  path: string;
  auth: 'anon' | 'session' | 'user';
  idempotent?: boolean;
  /** On top of the general limits; counted per account, per client address on an `anon` route. */
  rateLimit?: { perMinute?: number; perHour?: number };
};

export type Route =
  | (RouteBase & {
      /**
       * Runs before the request transaction is opened, while the request holds no pooled client:
       * the place for slow work (scrypt). The session is not resolved yet. Throw `AppError` to
       * refuse; use `withRole(pre.pool, …)` for a short transaction of its own.
       */
      prepare?: (pre: PreCtx) => Promise<unknown>;
      /**
       * Runs inside the request transaction: COMMIT when it returns, whatever the status;
       * ROLLBACK when it throws. Return `errorResponse(code)` when what was written must stay.
       */
      handler: (ctx: Ctx) => Promise<RouteResponse>;
    })
  | (RouteBase & {
      /** Instead of `handler`, for an `anon` route that needs no request transaction at all. */
      direct: (pre: PreCtx) => Promise<RouteResponse>;
    });

/** The default-exported `Route[]` of every `*.ts` in `dir` that is not a test, in name order. */
export async function loadRoutes(dir: string): Promise<Route[]> {
  const files = (await readdir(dir))
    .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort();
  const routes: Route[] = [];
  for (const name of files) {
    const module = (await import(pathToFileURL(join(dir, name)).href)) as {
      default?: unknown;
    };
    if (!Array.isArray(module.default)) {
      throw new Error(`routes/${name} must default-export a Route[]`);
    }
    routes.push(...(module.default as Route[]));
  }
  return routes;
}

/**
 * Every route of src/routes. A route file imports only types from this module: importing a
 * value from here would be a cycle through this very load.
 */
export const routes: Route[] = await loadRoutes(
  fileURLToPath(new URL('./routes', import.meta.url)),
);

type Found = { route: Route; params: Record<string, string> };

/** Refuses a route table that cannot be served as declared, and returns its lookup. */
function compile(all: Route[]): (method: string, path: string) => Found | null {
  const seen = new Set<string>();
  for (const route of all) {
    // two patterns that differ only in the name of a parameter answer the same paths
    const id = `${route.method} ${route.path.replace(/:[^/]+/g, ':')}`;
    if (seen.has(id)) {
      throw new Error(`duplicate route ${route.method} ${route.path}`);
    }
    seen.add(id);
    if (!route.path.startsWith('/')) {
      throw new Error(`route path must start with "/": ${route.path}`);
    }
    // a key belongs to a user (R-D05), and a stored answer is only ever served to that user
    if (route.idempotent && (route.auth === 'anon' || route.method === 'GET')) {
      throw new Error(
        `${route.method} ${route.path}: only a write with a session can be idempotent`,
      );
    }
    if ('direct' in route && route.auth !== 'anon') {
      throw new Error(
        `${route.method} ${route.path}: a route without a transaction must be anon`,
      );
    }
  }
  // literal paths first, so that '/guilds/me' is never taken for '/guilds/:id'
  const ordered = [
    ...all.filter(route => !route.path.includes(':')),
    ...all.filter(route => route.path.includes(':')),
  ];
  return (method, path) => {
    for (const route of ordered) {
      const params =
        route.method === method ? matchPath(route.path, path) : null;
      if (params !== null) {
        return { route, params };
      }
    }
    return null;
  };
}

type Out = { status: number; text?: string; headers?: Record<string, string> };

/** One fixed window to count a request on; no limit, no counting. */
type Window = [key: string, limit: number | undefined, ms: number];

const out = ({ status, body }: RouteResponse): Out => ({
  status,
  text: body === undefined ? undefined : JSON.stringify(body),
});

const rateLimited = (seconds: number): Out => ({
  ...out(errorResponse('RATE_LIMITED')),
  headers: { 'retry-after': String(seconds) },
});

const CRLF = String.fromCharCode(13, 10);

export type AppDeps = {
  pool: Pool;
  mailer: Mailer;
  journalKey: Buffer;
  /** Default true. */
  rateLimits?: boolean;
  /** Default: every route of src/routes. Tests add probe routes. */
  routes?: Route[];
  /** Default: JSON lines on stdout. */
  log?: Logger;
};

/** The HTTP server of the API, not listening yet. Closing it stops its timer. */
export function createApp(deps: AppDeps): Server {
  const { pool, mailer, journalKey } = deps;
  const log = deps.log ?? createLogger();
  const find = compile(deps.routes ?? routes);
  const limiter = deps.rateLimits ?? true ? createRateLimiter() : null;

  /**
   * Counts the request on each window that has a limit: the longest wait in seconds, 0 when
   * none is over.
   */
  const overLimit = (windows: Window[]) =>
    limiter === null
      ? 0
      : Math.max(
          0,
          ...windows.map(([key, limit, ms]) =>
            limit === undefined ? 0 : limiter.hit(key, limit, ms),
          ),
        );

  async function respond(
    req: IncomingMessage,
    seen: { route: string | null; userId: string | null },
  ): Promise<Out> {
    const target = splitTarget(req.url ?? '');
    const found = target && find(req.method ?? '', target.path);
    if (!target || !found) {
      return out(errorResponse('NOT_FOUND'));
    }
    const { route, params } = found;
    seen.route = route.path;
    const badParam = unstorableQueryParam(target.query);
    if (badParam !== null) {
      return out(
        errorResponse('VALIDATION_FAILED', {
          fields: [{ field: badParam, rule: 'format' }],
        }),
      );
    }

    // The address of the socket, never X-Forwarded-For: this deployment has no proxy in front,
    // so that header would be whatever the client wrote.
    // ponytail: one window per full address; a client that rotates inside an IPv6 /64 gets a
    // window per address. Key IPv6 by its /64 prefix if that is ever abused.
    const ip = req.socket.remoteAddress ?? '';
    const write = route.method !== 'GET';
    /** The limits of the route itself, counted for `who`. */
    const ownWindows = (who: string): Window[] => [
      [
        `${route.method} ${route.path} ${who}`,
        route.rateLimit?.perMinute,
        MINUTE_MS,
      ],
      [
        `${route.method} ${route.path} ${who}`,
        route.rateLimit?.perHour,
        HOUR_MS,
      ],
    ];
    const byIp = overLimit([
      [`ip ${ip}`, write ? WRITES_PER_MINUTE.ip : undefined, MINUTE_MS],
      ...(route.auth === 'anon' ? ownWindows(`ip ${ip}`) : []),
    ]);
    if (byIp > 0) {
      return rateLimited(byIp);
    }

    // An anon route runs as app_anon whatever the client sent: its Authorization header is
    // not read.
    const tokenHash =
      route.auth === 'anon' ? null : bearerTokenHash(req.headers.authorization);
    if (route.auth !== 'anon' && tokenHash === null) {
      return out(errorResponse('SESSION_INVALID'));
    }
    const actionId = route.idempotent
      ? idempotencyKey(req.headers['idempotency-key'])
      : null;
    if (route.idempotent && actionId === null) {
      return out(errorResponse('IDEMPOTENCY_KEY_REQUIRED'));
    }
    const body = write ? await readJsonBody(req) : undefined;

    const pre: PreCtx = {
      params,
      query: target.query,
      body,
      actionId,
      tokenHash,
      pool,
      mailer,
      journalKey,
      ip,
      log,
    };
    if ('direct' in route) {
      return out(await route.direct(pre));
    }
    // before BEGIN: slow work must never hold a transaction or a pooled client
    const prepared = route.prepare ? await route.prepare(pre) : undefined;

    // ponytail: one round trip per step (role, session, key, clock): up to eleven for an
    // idempotent write. Fold the constant statements into one query if latency ever matters.
    return withRole(pool, 'app_anon', null, async db => {
      let userId: string | null = null;
      if (tokenHash !== null) {
        userId = await sessionUser(db, tokenHash);
        if (userId === null) {
          return out(errorResponse('SESSION_INVALID'));
        }
        await setRole(db, 'app_auth', userId);
        seen.userId = userId;
        const byAccount = overLimit([
          [
            `user ${userId}`,
            write ? WRITES_PER_MINUTE.account : undefined,
            MINUTE_MS,
          ],
          ...ownWindows(`user ${userId}`),
        ]);
        if (byAccount > 0) {
          return rateLimited(byAccount);
        }
        if (route.auth === 'user') {
          const { rows } = await db.query<{ onboarded: boolean }>(
            'SELECT onboarded_at IS NOT NULL AS onboarded FROM users WHERE id = app.current_user_id()',
          );
          if (rows[0]?.onboarded !== true) {
            return out(errorResponse('ONBOARDING_REQUIRED'));
          }
        }
      }
      if (actionId !== null) {
        const key = await beginKey(
          db,
          actionId,
          requestHash(route.method, req.url ?? '', body),
        );
        if (key.state === 'reused') {
          return out(errorResponse('IDEMPOTENCY_KEY_REUSED'));
        }
        if (key.state === 'replay') {
          return out(key);
        }
      }
      const { rows } = await db.query<{ now: Date }>('SELECT app.now() AS now');
      // serialised here, so that an answer that cannot be sent is not committed either
      const answer = out(
        await route.handler({ ...pre, db, userId, now: rows[0].now, prepared }),
      );
      if (actionId !== null && answer.status >= 200 && answer.status < 300) {
        await storeKey(db, actionId, answer.status, answer.text);
      }
      return answer;
    });
  }

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const started = performance.now();
    const seen = {
      route: null as string | null,
      userId: null as string | null,
    };
    /** null: the client went away while sending; nobody is left to read an answer. */
    let answer: Out | null;
    let bug: unknown;
    try {
      answer = await respond(req, seen);
    } catch (thrown) {
      const refusal = refusalOf(thrown);
      if (thrown instanceof ClientGone) {
        answer = null;
      } else if (refusal !== null) {
        answer = out(refusal);
      } else {
        bug = thrown;
        answer = out(errorResponse('INTERNAL'));
      }
    }
    if (answer === null) {
      res.destroy();
    } else {
      // after a body that was not read to its end the connection cannot carry another request
      const close: Record<string, string> =
        answer.status === 413 ? { connection: 'close' } : {};
      send(res, answer.status, answer.text, { ...answer.headers, ...close });
    }
    // The route pattern, never the path: a path and a query hold values.
    log.line({
      level: bug === undefined ? 'info' : 'error',
      method: req.method,
      route: seen.route,
      status: answer?.status ?? 499, // 499: client closed the request
      ms: Math.round(performance.now() - started),
      userId: seen.userId,
      ...(bug === undefined ? {} : describeError(bug)),
    });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => res.destroy());
  });

  // Node answers a request it cannot parse (header block over 16 KiB, which includes the URL;
  // malformed syntax) with a bare status line. Same limits, the error body of the API.
  server.on('clientError', (error: NodeJS.ErrnoException, socket) => {
    if (error.code === 'ECONNRESET' || !socket.writable) {
      return;
    }
    const tooLarge = error.code === 'HPE_HEADER_OVERFLOW';
    const text = JSON.stringify(
      errorResponse(tooLarge ? 'PAYLOAD_TOO_LARGE' : 'BAD_JSON').body,
    );
    socket.end(
      [
        tooLarge
          ? 'HTTP/1.1 431 Request Header Fields Too Large'
          : 'HTTP/1.1 400 Bad Request',
        'content-type: application/json; charset=utf-8',
        `content-length: ${Buffer.byteLength(text)}`,
        'connection: close',
        '',
        text,
      ].join(CRLF),
    );
    log.line({ level: 'warn', evt: 'client_error', code: error.code });
  });

  if (limiter !== null) {
    // windows of clients that never come back; unref'd, and gone with the server
    const sweep = setInterval(() => limiter.sweep(), MINUTE_MS);
    sweep.unref();
    server.on('close', () => clearInterval(sweep));
  }
  return server;
}
