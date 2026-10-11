// Test helpers for everything that goes through HTTP: the real app on a free port, over the
// app_conn pool of the test database.
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, routes as realRoutes } from '../src/app.ts';
import type { Mailer, Route } from '../src/app.ts';
import { withRole } from '../src/db.ts';
import { BASE_PATH } from '../src/http.ts';
import { createLogger } from '../src/log.ts';
import { hashToken, newToken } from '../src/session.ts';
import type { TestDb } from './testdb.ts';

type Mail = Parameters<Mailer>[0];

export type CallOptions = {
  /** Sent as `Authorization: Bearer <token>`. */
  token?: string;
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as `Idempotency-Key`. */
  key?: string;
  /** Extra or overriding request headers. */
  headers?: Record<string, string>;
  /** Sent as is instead of `body`, with no content type of its own. */
  rawBody?: string;
  signal?: AbortSignal;
};

export type CallResult = {
  status: number;
  /** The parsed JSON body, `undefined` when the response has none. */
  body: any;
  headers: Headers;
};

export type TestApp = {
  /** `path` is relative to /api/v1: `call('GET', '/healthz')`. */
  call(
    method: string,
    path: string,
    options?: CallOptions,
  ): Promise<CallResult>;
  /** Every log line written so far, parsed. */
  logs: Record<string, unknown>[];
  /** Every log line written so far, as text: for "this value appears in no line". */
  logText(): string;
  /** Every message handed to the default mailer. */
  mail: Mail[];
  baseUrl: string;
  server: Server;
  /** Call it in `after`: an open server keeps the test process alive. */
  close(): Promise<void>;
};

/**
 * The app with rate limits OFF unless `rateLimits: true`, a mailer that collects messages in
 * `mail`, and the log captured in `logs`. `routes` are added to the real ones (probe routes).
 */
export async function startTestApp(
  db: TestDb,
  opts: { mailer?: Mailer; rateLimits?: boolean; routes?: Route[] } = {},
): Promise<TestApp> {
  const mail: Mail[] = [];
  const lines: string[] = [];
  const server = createApp({
    pool: db.app,
    mailer:
      opts.mailer ??
      (async message => {
        mail.push(message);
      }),
    journalKey: Buffer.alloc(32, 1),
    rateLimits: opts.rateLimits ?? false,
    routes: [...realRoutes, ...(opts.routes ?? [])],
    log: createLogger(line => lines.push(line)),
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${
    (server.address() as AddressInfo).port
  }${BASE_PATH}`;

  return {
    async call(
      method,
      path,
      { token, body, key, headers, rawBody, signal } = {},
    ) {
      const response = await fetch(baseUrl + path, {
        method,
        signal,
        headers: {
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          ...(key === undefined ? {} : { 'idempotency-key': key }),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        body:
          rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text === '' ? undefined : JSON.parse(text),
        headers: response.headers,
      };
    },
    get logs() {
      return lines.map(line => JSON.parse(line) as Record<string, unknown>);
    },
    logText: () => lines.join('\n'),
    mail,
    baseUrl,
    server,
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

/**
 * A registered user with a live session, not onboarded. Registered through `auth_register` as
 * app_anon on the app pool, not through HTTP: no scrypt, so it costs one round trip.
 */
export async function newUser(
  db: TestDb,
): Promise<{ userId: string; token: string; email: string }> {
  const email = `u${randomBytes(8).toString('hex')}@example.com`;
  const token = newToken();
  const { rows } = await withRole(db.app, 'app_anon', null, c =>
    c.query<{ id: string }>('SELECT auth_register($1, $2, $3, $4, $5) AS id', [
      email,
      'Người thử',
      randomBytes(16),
      randomBytes(32),
      hashToken(token),
    ]),
  );
  return { userId: rows[0].id, token, email };
}
