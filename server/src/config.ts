export type Config = { databaseUrl: string; journalKey: Buffer; port: number };

type Env = Record<string, string | undefined>;

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
  }

  const port = Number(env.PORT ?? '8787');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push('PORT is not a port number');
  }

  if (problems.length > 0) {
    throw new Error(
      `Server configuration: ${problems.join('; ')}. See server/.env.example.`,
    );
  }
  return { databaseUrl, journalKey, port };
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
