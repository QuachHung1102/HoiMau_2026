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
  KeyBusy,
  MAX_STORED_BYTES,
  beginKey,
  idempotencyKey,
  releaseKey,
  requestHash,
  requestHashKey,
  storeKey,
} from './idempotency.ts';
import { createLogger, describeError } from './log.ts';
import type { Logger } from './log.ts';
import {
  HOUR_MS,
  MINUTE_MS,
  UNAUTHORIZED_PER_MINUTE,
  WRITES_PER_MINUTE,
  addressKey,
  clientAddress,
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
  /**
   * For `prepare` and `direct` only, through `withRole` of db.ts. A handler already holds one
   * pooled client (`db`) and must never take a second: enough requests doing that leave every
   * client waiting for one that will not come. In a handler, touching this throws.
   */
  pool: Pool;
  mailer: Mailer;
  journalKey: Buffer;
  /**
   * The address of the socket, IPv4 also when it arrives mapped into IPv6. No proxy is trusted:
   * X-Forwarded-For is never read.
   */
  ip: string;
  log: Logger;
  /** What the route's `prepare` returned; `undefined` without one. */
  prepared: unknown;
  /**
   * Queues `run` for after the request transaction is committed AND the answer has been
   * written to the client: the place to send a mail, so that neither its latency nor its
   * failure reaches the answer. Not run when the request ends in a thrown error (the
   * transaction was rolled back); run also for a returned `errorResponse`. A rejection is
   * logged without its message and reaches nobody.
   */
  afterCommit(run: () => Promise<void>): void;
};

/**
 * What exists before the request transaction: no client, no clock. `userId` is null on an
 * `anon` route; before the `prepare` of any other route it is the user of the session, looked
 * up in a transaction of its own (the request transaction looks it up again).
 */
export type PreCtx = Omit<Ctx, 'db' | 'now' | 'prepared' | 'afterCommit'>;

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
       * Runs before the request transaction is opened, while the request holds no pooled
       * client: the place for slow work (scrypt), and the only place that may take a pooled
       * client of its own (`withRole(pre.pool, …)`, a short transaction that is over before the
       * request transaction starts). Throw `AppError` to refuse. On a route with a session it
       * runs only for a live session (`pre.userId`) that is within the per-account limits.
       */
      prepare?: (pre: PreCtx) => Promise<unknown>;
      /**
       * Runs inside the request transaction, which is committed when it returns, whatever the
       * status, and rolled back when it throws. Return `errorResponse(code)` when what was
       * written must stay. Never catch a database error and carry on: the transaction is lost
       * by then, and the request ends in 500.
       */
      handler: (ctx: Ctx) => Promise<RouteResponse>;
      direct?: never;
    })
  | (RouteBase & {
      /** Instead of `handler`, for an `anon` route that needs no request transaction at all. */
      direct: (pre: PreCtx) => Promise<RouteResponse>;
      handler?: never;
      prepare?: never;
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
    const name = `${route.method} ${route.path}`;
    // two patterns that differ only in the name of a parameter answer the same paths
    const id = `${route.method} ${route.path.replace(/:[^/]+/g, ':')}`;
    if (seen.has(id)) {
      throw new Error(`duplicate route ${name}`);
    }
    seen.add(id);
    if (!route.path.startsWith('/')) {
      throw new Error(`route path must start with "/": ${route.path}`);
    }
    // a key belongs to a user (R-D05), and a stored answer is only ever served to that user
    if (route.idempotent && (route.auth === 'anon' || route.method === 'GET')) {
      throw new Error(`${name}: only a write with a session can be idempotent`);
    }
    // a cast gets past the type, and then one of the two would silently never run
    const { direct, handler, prepare } = route as Partial<
      Record<'direct' | 'handler' | 'prepare', unknown>
    >;
    if ((direct === undefined) === (handler === undefined)) {
      throw new Error(`${name}: a route has either a handler or direct`);
    }
    if (direct !== undefined && prepare !== undefined) {
      throw new Error(`${name}: prepare belongs to a handler, not to direct`);
    }
    if (direct !== undefined && route.auth !== 'anon') {
      throw new Error(`${name}: a route without a transaction must be anon`);
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

/**
 * The answer of a route, serialised. A status that is no HTTP status is a bug of the route:
 * thrown here, inside the transaction when there is one, so that nothing of it is kept.
 */
function out({ status, body }: RouteResponse): Out {
  if (!Number.isInteger(status) || status < 200 || status > 599) {
    throw new Error('a route answered with a status outside 200-599');
  }
  return {
    status,
    text: body === undefined ? undefined : JSON.stringify(body),
  };
}

const retryAfter = (seconds: number): Out => ({
  ...out(errorResponse('RATE_LIMITED')),
  headers: { 'retry-after': String(seconds) },
});

const CRLF = String.fromCharCode(13, 10);

/** What a handler finds in `ctx.pool`: a second pooled client per request starves the pool. */
const noPoolInHandler = new Proxy(
  {},
  {
    get() {
      throw new Error(
        'a handler must not use ctx.pool: it already holds a pooled client (ctx.db)',
      );
    },
  },
) as Pool;

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
  const hashKey = requestHashKey(journalKey);

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
    seen: {
      route: string | null;
      userId: string | null;
      after: (() => Promise<void>)[];
    },
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
    // so that header would be whatever the client wrote. Counted per IPv4 address and per
    // IPv6 /64.
    const ip = clientAddress(req.socket.remoteAddress);
    const from = `ip ${addressKey(ip)}`;
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
    // Everything counted per address is settled here, before the body is read, before prepare
    // and before the database: a flood from one address buys no work.
    const byAddress = overLimit([
      [from, write ? WRITES_PER_MINUTE.ip : undefined, MINUTE_MS],
      ...(route.auth === 'anon' ? ownWindows(from) : []),
    ]);
    if (byAddress > 0) {
      return retryAfter(byAddress);
    }

    // A missing or unknown session is counted per address: looking a token up costs a
    // transaction, and an address that collected enough refusals is not looked up any more.
    const unauthorized = (): Out => {
      limiter?.hit(`401 ${from}`, UNAUTHORIZED_PER_MINUTE, MINUTE_MS);
      return out(errorResponse('SESSION_INVALID'));
    };
    // An anon route runs as app_anon whatever the client sent: its Authorization header is
    // not read.
    let tokenHash: Buffer | null = null;
    if (route.auth !== 'anon') {
      const refused =
        limiter?.full(`401 ${from}`, UNAUTHORIZED_PER_MINUTE, MINUTE_MS) ?? 0;
      if (refused > 0) {
        return retryAfter(refused);
      }
      tokenHash = bearerTokenHash(req.headers.authorization);
      if (tokenHash === null) {
        return unauthorized();
      }
    }
    let actionId: string | null = null;
    if (route.idempotent) {
      const header = req.headers['idempotency-key'];
      if (header === undefined || header === '') {
        return out(errorResponse('IDEMPOTENCY_KEY_REQUIRED'));
      }
      actionId = idempotencyKey(header);
      if (actionId === null) {
        return out(
          errorResponse('VALIDATION_FAILED', {
            fields: [{ field: 'Idempotency-Key', rule: 'format' }],
          }),
        );
      }
    }
    const body = write ? await readJsonBody(req) : undefined;

    const pre: PreCtx = {
      userId: null,
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
    if (route.direct) {
      return out(await route.direct(pre));
    }
    const { handler } = route;
    /** The limits of the account, counted once per request: the refusal, or 0. */
    const accountLimited = (userId: string) =>
      overLimit([
        [
          `user ${userId}`,
          write ? WRITES_PER_MINUTE.account : undefined,
          MINUTE_MS,
        ],
        ...ownWindows(`user ${userId}`),
      ]);
    // The work of prepare is done for a live session only, and counted on its account first: a
    // stolen or made-up token buys no derivation.
    let counted = false;
    if (route.prepare && tokenHash !== null) {
      const hash = tokenHash;
      pre.userId = await withRole(pool, 'app_anon', null, db =>
        sessionUser(db, hash),
      );
      if (pre.userId === null) {
        return unauthorized();
      }
      const byAccount = accountLimited(pre.userId);
      if (byAccount > 0) {
        return retryAfter(byAccount);
      }
      counted = true;
    }
    // before the transaction opens: slow work must never hold it, or a pooled client
    const prepared = route.prepare ? await route.prepare(pre) : undefined;

    // ponytail: one round trip per step (role, session, key, clock): up to eleven for an
    // idempotent write. Fold the constant statements into one query if latency ever matters.
    return withRole(pool, 'app_anon', null, async db => {
      let userId: string | null = null;
      if (tokenHash !== null) {
        userId = await sessionUser(db, tokenHash);
        // a session revoked since prepare looked is no session; a token names one user
        if (userId === null || (counted && userId !== pre.userId)) {
          return unauthorized();
        }
        await setRole(db, 'app_auth', userId);
        seen.userId = userId;
        const byAccount = counted ? 0 : accountLimited(userId);
        if (byAccount > 0) {
          return retryAfter(byAccount);
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
          requestHash(hashKey, route.method, req.url ?? '', body),
        );
        if (key.state === 'reused') {
          return out(errorResponse('IDEMPOTENCY_KEY_REUSED'));
        }
        if (key.state === 'replay') {
          return out(key);
        }
      }
      const { rows } = await db.query<{ now: Date }>('SELECT app.now() AS now');
      // serialised here, so that an answer that cannot be sent is not kept either
      const answer = out(
        await handler({
          ...pre,
          pool: noPoolInHandler,
          db,
          userId,
          now: rows[0].now,
          prepared,
          afterCommit: run => {
            seen.after.push(run);
          },
        }),
      );
      if (actionId !== null) {
        if (answer.status >= 300) {
          // only a 2xx is remembered: the key is free again, for the same or a corrected request
          await releaseKey(db, actionId);
        } else if (Buffer.byteLength(answer.text ?? '') > MAX_STORED_BYTES) {
          // answering without storing would let the retry run the handler a second time
          throw new Error('the answer of an idempotent route is over 256 KiB');
        } else {
          await storeKey(db, actionId, answer.status, answer.text);
        }
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
      after: [] as (() => Promise<void>)[],
    };
    /** null: the client went away while sending; nobody is left to read an answer. */
    let answer: Out | null;
    let bug: unknown;
    let note: string | undefined;
    /** `respond` returned: the transaction, if there was one, is committed. */
    let committed = false;
    try {
      answer = await respond(req, seen);
      committed = true;
    } catch (thrown) {
      const refusal = refusalOf(thrown);
      if (thrown instanceof ClientGone) {
        answer = null;
      } else if (thrown instanceof KeyBusy) {
        // The contract has no code for "this very request is still running". 429 is the one
        // a client keeps the action for and sends again; by then the first answer is stored.
        answer = retryAfter(1);
        note = 'idempotency key in use';
      } else if (refusal?.body.error.code === 'RATE_LIMITED') {
        // thrown by a route (the scrypt gate): the contract gives every 429 a Retry-After
        answer = retryAfter(1);
      } else if (refusal !== null) {
        answer = out(refusal);
      } else {
        // also every database timeout: statement, lock, a lost connection, no free client
        bug = thrown;
        answer = out(errorResponse('INTERNAL'));
      }
    }
    if (answer === null) {
      res.destroy();
    } else {
      // Answered before the body was read to its end (404, 401, 413, a GET with a body ...):
      // what the client still sends is not read. With "Connection: close" Node destroys the
      // socket as soon as the answer is flushed; left alone, it would read the rest for the
      // sake of the next request on that connection, however long the rest is.
      const unread = !req.complete;
      send(res, answer.status, answer.text, {
        ...answer.headers,
        ...(unread ? { connection: 'close' } : {}),
      });
    }
    // The route pattern, never the path: a path and a query hold values.
    log.line({
      level: bug === undefined ? 'info' : 'error',
      method: req.method,
      route: seen.route,
      status: answer?.status ?? 499, // 499: client closed the request
      ms: Math.round(performance.now() - started),
      userId: seen.userId,
      ...(note === undefined ? {} : { note }),
      ...(bug === undefined ? {} : describeError(bug)),
    });
    // After the answer is written: what the route queued with ctx.afterCommit (a mail). Only
    // when the transaction committed; a failure is logged without its message and ends here.
    if (committed && answer !== null) {
      for (const run of seen.after) {
        Promise.resolve()
          .then(run)
          .catch((thrown: unknown) =>
            log.line({
              level: 'error',
              evt: 'after_commit',
              route: seen.route,
              ...describeError(thrown),
            }),
          );
      }
    }
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
