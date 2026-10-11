import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ClientBase } from 'pg';

export type Seeder = (db: ClientBase) => Promise<void>;

const SEED_DIR = fileURLToPath(new URL('./seed', import.meta.url));

/** Decoy files (8N) and the self-check (90) need the seeded content, so they run after it. */
const AFTER_SEED = 80;

async function inTransaction(
  client: ClientBase,
  label: string,
  work: () => Promise<unknown>,
): Promise<void> {
  try {
    await client.query('BEGIN');
    await work();
    await client.query('COMMIT');
  } catch (cause) {
    // the step's own error is the one to report, even when the rollback fails too
    await client.query('ROLLBACK').catch(() => {});
    throw new Error(`${label}: ${(cause as Error).message}`, { cause });
  }
}

/**
 * Apply the schema as its owner (the superuser), one transaction per step:
 * `NN-*.sql` below 80 in name order, then every seeder of `seedDir` (`export async function
 * seed(db)`), then the remaining SQL files. Returns the steps in the order they ran.
 */
export async function migrate(
  client: ClientBase,
  sqlDir: string,
  seedDir: string = SEED_DIR,
): Promise<string[]> {
  const sqlFiles = (await readdir(sqlDir))
    .filter(name => /^\d\d-.*\.sql$/.test(name))
    .sort();
  if (sqlFiles.length === 0) {
    throw new Error(`no NN-*.sql file in ${sqlDir}`);
  }
  // The self-check judges the finished schema: whatever ran after it would go unchecked.
  const selfCheck = sqlFiles.findIndex(name => name.startsWith('90-'));
  if (selfCheck !== -1 && selfCheck !== sqlFiles.length - 1) {
    throw new Error(
      `${sqlFiles[selfCheck]} must be the last step, but ${sqlFiles
        .slice(selfCheck + 1)
        .join(', ')} would run after it`,
    );
  }
  const seedFiles = (
    await readdir(seedDir).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') {
        return [] as string[];
      }
      throw e;
    })
  )
    .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort();

  const applySql = async (name: string) => {
    const sql = await readFile(join(sqlDir, name), 'utf8');
    await inTransaction(client, name, () => client.query(sql));
  };
  const beforeSeed = sqlFiles.filter(
    name => Number(name.slice(0, 2)) < AFTER_SEED,
  );
  const afterSeed = sqlFiles.filter(name => !beforeSeed.includes(name));

  for (const name of beforeSeed) {
    await applySql(name);
  }
  for (const name of seedFiles) {
    const { seed } = (await import(
      pathToFileURL(join(seedDir, name)).href
    )) as {
      seed: Seeder;
    };
    await inTransaction(client, `seed/${name}`, () => seed(client));
  }
  for (const name of afterSeed) {
    await applySql(name);
  }
  return [
    ...beforeSeed,
    ...seedFiles.map(name => `seed/${name}`),
    ...afterSeed,
  ];
}
