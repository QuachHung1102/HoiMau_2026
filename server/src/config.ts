export type Config = {
  databaseUrl: string;
  journalKey: Buffer;
  /** The interface to listen on. Default 127.0.0.1: reachable from this machine only. */
  host: string;
  port: number;
};

type Env = Record<string, string | undefined>;

/** The journal keys anyone with the source has: scripts/dev.ts and test/http.ts. */
const REPOSITORY_KEYS = [Buffer.alloc(32, 'hoi-mau-dev'), Buffer.alloc(32, 1)];

/**
 * Reads the environment of the server process and fails fast. A message names the variable and
 * what is wrong with it, never its value: the URL holds the database password, the key is a secret.
 */
export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = [];

  const databaseUrl = env.DATABASE_URL ?? '';
  if (databaseUrl === '') {
    problems.push('DATABASE_URL is missing');
  } else if (!isPostgresUrl(databaseUrl)) {
    problems.push(
      'DATABASE_URL is not a postgres:// URL with a user, a host and a database name',
    );
  }

  const encodedKey = env.JOURNAL_KEY ?? '';
  const journalKey = Buffer.from(encodedKey, 'base64');
  if (encodedKey === '') {
    problems.push('JOURNAL_KEY is missing');
  } else if (
    journalKey.length !== 32 ||
    journalKey.toString('base64') !== encodedKey
  ) {
    // Buffer.from skips what is not base64, so the round trip is what proves the format
    problems.push('JOURNAL_KEY is not 32 bytes in base64 (44 characters)');
  } else if (
    env.NODE_ENV !== 'development' &&
    env.NODE_ENV !== 'test' &&
    REPOSITORY_KEYS.some(known => known.equals(journalKey))
  ) {
    // fails closed like the outbox mailer (main.ts): production, staging, unset, any spelling
    problems.push(
      'JOURNAL_KEY is a key written in this repository, allowed only with NODE_ENV=development or test',
    );
  }

  const port = Number(env.PORT ?? '8787');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push('PORT is not a port number');
  }

  // loopback unless told otherwise: an API reachable from the network is a decision, not a default
  const host = env.HOST || '127.0.0.1';
  if (!/^[0-9A-Za-z.:-]+$/.test(host)) {
    problems.push('HOST is not an address or a host name');
  }

  if (problems.length > 0) {
    throw new Error(
      `Server configuration: ${problems.join('; ')}. See server/.env.example.`,
    );
  }
  return { databaseUrl, journalKey, host, port };
}

function isPostgresUrl(value: string): boolean {
  if (!URL.canParse(value)) {
    return false;
  }
  const { protocol, username, hostname, pathname } = new URL(value);
  return (
    (protocol === 'postgres:' || protocol === 'postgresql:') &&
    username !== '' &&
    hostname !== '' &&
    pathname.length > 1
  );
}
