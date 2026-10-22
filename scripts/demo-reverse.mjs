// npm run demo:reverse: the phone's localhost:8787 (API) and :8081 (Metro) point at this PC.
// adb comes from PATH, else from the Android SDK (ANDROID_HOME, ANDROID_SDK_ROOT or %LOCALAPPDATA%\Android\Sdk).
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const sdk =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
const run = (adb, ...args) => execFileSync(adb, args, { stdio: 'inherit' });

let adb = 'adb';
try {
  execFileSync(adb, ['version'], { stdio: 'ignore' });
} catch {
  adb = join(sdk, 'platform-tools', exe);
}
try {
  for (const port of [8787, 8081]) {
    run(adb, 'reverse', `tcp:${port}`, `tcp:${port}`);
  }
  run(adb, 'reverse', '--list');
} catch {
  process.exitCode = 1; // adb has said why on its own output (no device, device unauthorized)
}
