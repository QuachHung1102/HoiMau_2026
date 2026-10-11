// The process around the server (main.ts, guardProcess), in a process of its own.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
const EMAIL = 'someone@example.com';

function run(script: string): { status: number | null; out: string } {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    { cwd: SERVER_DIR, encoding: 'utf8', timeout: 20_000 },
  );
  return { status, out: `${stdout}${stderr}` };
}

const events = (out: string) =>
  out
    .split(String.fromCharCode(10))
    .filter(line => line.startsWith('{'))
    .map(line => JSON.parse(line) as Record<string, unknown>);

test('a rejection nobody handled is logged without its message and the server keeps serving', () => {
  const { status, out } = run(`
    const { guardProcess } = await import('./src/main.ts');
    guardProcess(async () => { console.log('STOPPED'); });
    Promise.reject(new RangeError('Invalid time zone specified: ${EMAIL}'));
    Promise.reject('${EMAIL}');
    await new Promise(resolve => setTimeout(resolve, 200));
    console.log('STILL SERVING');
  `);
  assert.equal(status, 0, out);
  assert.ok(out.includes('STILL SERVING'), out);
  assert.ok(!out.includes('STOPPED'), out);
  assert.ok(!out.includes(EMAIL), out);
  assert.deepEqual(
    events(out).map(({ level, evt, error }) => [level, evt, error]),
    [
      ['error', 'unhandled_rejection', 'RangeError'],
      ['error', 'unhandled_rejection', 'string'],
    ],
  );
});

test('an uncaught exception is logged without its message, the server is stopped, the exit code is 1', () => {
  const { status, out } = run(`
    const { guardProcess } = await import('./src/main.ts');
    guardProcess(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      console.log('STOPPED');
    });
    setInterval(() => {}, 1000); // what keeps a real server alive: its listening socket
    setTimeout(() => { throw new Error('boom ${EMAIL}'); }, 20);
  `);
  assert.equal(status, 1, out);
  assert.ok(out.includes('STOPPED'), out);
  assert.ok(!out.includes(EMAIL), out);
  assert.deepEqual(
    events(out).map(({ level, evt, error }) => [level, evt, error]),
    [['error', 'uncaught_exception', 'Error']],
  );
});
