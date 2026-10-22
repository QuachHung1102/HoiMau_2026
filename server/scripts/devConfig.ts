// The configuration of npm run server:dev. Its own file so a test can load it without starting
// a cluster. This script IS the development environment, so it says NODE_ENV itself: loadConfig
// accepts the key written in this repository only then (a shell's NODE_ENV never reaches it).
import { loadConfig, type Config } from '../src/config.ts';
import { APP_CONN, DEV } from './cluster.ts';

export const DATABASE = 'hoimau';
export const HOST = '127.0.0.1';
// Development only, like the passwords in cluster.ts: journal entries written by one run stay
// readable in the next. Production sets JOURNAL_KEY out of band.
const DEV_JOURNAL_KEY = Buffer.alloc(32, 'hoi-mau-dev').toString('base64');

export function devConfig(
  env: Record<string, string | undefined> = process.env,
): Config {
  return loadConfig({
    NODE_ENV: 'development',
    JOURNAL_KEY: env.JOURNAL_KEY || DEV_JOURNAL_KEY,
    PORT: env.PORT,
    HOST,
    // always the cluster dev.ts starts, whatever the environment names
    DATABASE_URL: `postgres://${APP_CONN.user}:${APP_CONN.password}@${HOST}:${DEV.port}/${DATABASE}`,
  });
}
