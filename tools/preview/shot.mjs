// node tools/preview/shot.mjs <name> [out.png]  ->  390x844 @2x full-page PNG of ?screen=<name>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const [name, outArg] = process.argv.slice(2);
if (!name) {
  console.error('usage: node tools/preview/shot.mjs <name> [out.png]');
  process.exit(2);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(outArg ?? path.join(here, '../../node_modules/.cache/hoi-mau/preview', `${name}.png`));
fs.mkdirSync(path.dirname(out), { recursive: true });

// Browser: PREVIEW_BROWSER, else a Playwright-cached Chromium, else installed Chrome, else Edge.
function launchOptions() {
  if (process.env.PREVIEW_BROWSER) return { executablePath: process.env.PREVIEW_BROWSER };
  const cache = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).sort().reverse() : [];
  for (const d of dirs.filter(d => d.startsWith('chromium_headless_shell-'))) {
    const exe = path.join(cache, d, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
    if (fs.existsSync(exe)) return { executablePath: exe };
  }
  return { channel: fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'chrome' : 'msedge' };
}

const t0 = Date.now();
const server = await createServer({ configFile: path.join(here, 'vite.config.mjs') });
await server.listen();
const browser = await chromium.launch(launchOptions());
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => ((failed = true), console.error('[pageerror]', e.message)));
  page.on('console', m => m.type() === 'error' && console.error('[console.error]', m.text()));
  await page.goto(`${server.resolvedUrls.local[0]}?screen=${encodeURIComponent(name)}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('body[data-ready]', { state: 'attached', timeout: 20000 });
  if (await page.$('body[data-unknown]')) {
    failed = true;
    console.error(`Unknown screen "${name}"; see tools/preview/registry.tsx`);
  }
  await page.waitForTimeout(400); // let Animated/query settle
  await page.screenshot({ path: out, fullPage: true });
  console.log(`${out} (${Date.now() - t0} ms)`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
