import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export type Cluster = { port: number; dataDir: string };

const dir = (name: string) =>
  fileURLToPath(new URL(`../${name}`, import.meta.url));

// Port 5432 belongs to the machine's own PostgreSQL service: never use it.
export const TEST: Cluster = { port: 54329, dataDir: dir('.pgdata') };
export const DEV: Cluster = { port: 54330, dataDir: dir('.pgdata-dev') };

// Local development credentials only. Production sets its own out of band.
export const SUPERUSER = { user: 'postgres', password: 'pg_super_dev' };
export const APP_CONN = { user: 'app_conn', password: 'app_conn_dev' };

// initdb took up to 35 s and one start 18 s on a busy Windows machine
const START_TIMEOUT_MS = 120_000;

const CLEANUP_HINT =
  'If it is the leftover of a killed run, stop it with: npm run db:cleanup\n' +
  '(only when no other server test run is in flight: every run shares this one cluster).';

/** Where the embedded PostgreSQL binaries live: what tells our processes from the system service's. */
const BINARIES = dir('node_modules');

const normalise = (text: string) => text.replaceAll('\\', '/').toLowerCase();

type Process = { pid: number; parent: number; command: string };

function listProcesses(): Process[] {
  // Command lines of another account's processes (the system service) come back empty here.
  const out =
    process.platform === 'win32'
      ? execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Get-CimInstance Win32_Process -Filter "Name = 'postgres.exe'" | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $_.CommandLine }`,
          ],
          { encoding: 'utf8' },
        )
      : execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' });
  return out.split(/\r?\n/).flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match
      ? [
          {
            pid: Number(match[1]),
            parent: Number(match[2]),
            command: normalise(match[3]),
          },
        ]
      : [];
  });
}

/**
 * PIDs of the live processes of this cluster, postmaster first: the PID recorded in
 * `postmaster.pid` when it really is our postgres on this data directory and port, and the
 * children of that PID. A recorded PID can be stale and reused by any process, so nothing is
 * ever identified by the pid file alone, nor by the process name (the system service is
 * postgres.exe too).
 */
export function clusterProcesses({ port, dataDir }: Cluster): number[] {
  const pidFile = join(dataDir, 'postmaster.pid');
  if (!existsSync(pidFile)) {
    return [];
  }
  const recorded = Number(readFileSync(pidFile, 'utf8').split('\n')[0]);
  const ours = listProcesses().filter(({ command }) =>
    command.includes(normalise(BINARIES)),
  );
  const postmaster = ours.filter(
    ({ pid, command }) =>
      pid === recorded &&
      command.includes(normalise(dataDir)) &&
      command.includes(`-p ${port}`),
  );
  // Windows only: elsewhere a child's command line is its title, and children die with the postmaster.
  const children = ours.filter(({ parent }) => parent === recorded);
  return [...postmaster, ...children].map(({ pid }) => pid);
}

/** Kills what `clusterProcesses` finds, then removes the pid file. Returns the PIDs it killed. */
export async function killCluster(cluster: Cluster): Promise<number[]> {
  const killed = new Set<number>();
  for (let attempt = 0; attempt < 20; attempt++) {
    const pids = clusterProcesses(cluster);
    if (pids.length === 0) {
      rmSync(join(cluster.dataDir, 'postmaster.pid'), { force: true });
      return [...killed];
    }
    for (const pid of pids) {
      try {
        process.kill(pid);
        killed.add(pid);
      } catch {
        // already gone
      }
    }
    await sleep(250);
  }
  throw new Error(
    `PostgreSQL processes of ${
      cluster.dataDir
    } are still alive: ${clusterProcesses(cluster).join(', ')}`,
  );
}

export async function loadEmbeddedPostgres() {
  const events = ['beforeExit', 'exit'];
  const emitter: NodeJS.EventEmitter = process;
  const before = events.map(event => emitter.listeners(event));
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  // The library installs an exit hook that decides the exit code of the whole process: its
  // `beforeExit` handler ends with process.exit(0), so a failing test run would exit 0, and its
  // `exit` handler throws, so a passing one would exit 1. Both are removed, its signal
  // handlers are left in place. A normal end must call stop().
  events.forEach((event, i) => {
    for (const listener of emitter.listeners(event)) {
      if (!before[i].includes(listener)) {
        emitter.off(event, listener as () => void);
      }
    }
  });
  return EmbeddedPostgres;
}

export async function startCluster(
  cluster: Cluster,
): Promise<{ stop(): Promise<void> }> {
  const { port, dataDir } = cluster;
  const found = clusterProcesses(cluster);
  if (found.length > 0) {
    throw new Error(
      `This project's PostgreSQL is already running on port ${port} (data directory ${dataDir}, PIDs ${found.join(
        ', ',
      )}).\n` +
        'If another server test run is in flight, wait for it to finish.\n' +
        CLEANUP_HINT,
    );
  }

  // Loaded here so that test files can read the constants above without the cluster manager.
  const EmbeddedPostgres = await loadEmbeddedPostgres();
  const log: string[] = [];
  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    port,
    ...SUPERUSER,
    authMethod: 'scram-sha-256',
    // Windows defaults to WIN1252, which cannot store Vietnamese; the C locale alone breaks
    // upper() and ILIKE on Vietnamese, hence the ICU provider.
    initdbFlags: [
      '--encoding=UTF8',
      '--locale=C',
      '--locale-provider=icu',
      '--icu-locale=vi',
    ],
    onLog: message => log.push(message),
    onError: error => console.error('[postgres]', error),
  });
  const stop = async () => {
    await server.stop();
    // The library force-kills the process tree, and the postmaster can respawn a worker while
    // that walk is under way: the survivor keeps the data directory and this process's pipes.
    await killCluster(cluster);
  };

  const boot = (async () => {
    if (!existsSync(join(dataDir, 'PG_VERSION'))) {
      await server.initialise();
    }
    await server.start();
  })();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>(resolve => {
    timer = setTimeout(resolve, START_TIMEOUT_MS, 'timeout');
  });
  try {
    if ((await Promise.race([boot, timeout])) === 'timeout') {
      boot.catch(() => {});
      await stop();
      throw new Error(`not ready after ${START_TIMEOUT_MS / 1000} s`);
    }
  } catch (cause) {
    // start() rejects with undefined when postgres exits early: the reason is in its log.
    throw new Error(
      `PostgreSQL did not start on port ${port} (data directory ${dataDir}).\n` +
        `${log.join('').trim()}\n${CLEANUP_HINT}`,
      { cause },
    );
  } finally {
    clearTimeout(timer);
  }
  return { stop };
}
