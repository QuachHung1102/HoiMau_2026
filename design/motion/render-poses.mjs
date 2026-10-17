// Key-pose PNGs for the exercise demos, rendered from the rig SVG and catalog keyframes in a real browser
// (the same WAAPI path the playground uses), so a poster is exactly the pose the app will draw.
//   node design/motion/render-poses.mjs                    write design/motion/exercises/<id>.png (480x360) for every
//                                                           exercise entry without a WebM (the Task 8A six keep theirs)
//   node design/motion/render-poses.mjs --sheet <out.png>   contact sheet of every exercise poster (+ <out>.html)
//   node design/motion/render-poses.mjs --strip <id> <out>  8 frames across one cycle, for reviewing the motion
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const catalog = JSON.parse(fs.readFileSync(path.join(here, 'catalog.json'), 'utf8')).filter(a => a.kind === 'exercise');
const tokens = JSON.parse(fs.readFileSync(path.join(here, 'tokens.json'), 'utf8'));
const rigs = Object.fromEntries(['side', 'front'].map(r => [r, fs.readFileSync(path.join(root, `design/assets/exercise/rig-${r}.svg`), 'utf8')]));
const outDir = path.join(here, 'exercises');
const [mode, arg1, arg2] = process.argv.slice(2);

// Browser: PREVIEW_BROWSER, else a Playwright-cached Chromium, else installed Chrome, else Edge (as tools/preview/shot.mjs).
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

const STYLE = `html,body{margin:0;background:#EAF0FF}.f{position:relative;overflow:hidden;background:#EAF0FF;float:left}
.f svg{position:absolute;overflow:visible}.f svg g{transform-box:view-box}.f [id^="prop-"]{display:none}`;

// Draws entry `a` at cycle fraction t into every .f frame on the page.
function drawPose({ a, svg, ms, t }) {
  for (const f of document.querySelectorAll('.f')) {
    f.innerHTML = svg;
    for (const n of a.prop) f.querySelectorAll(`[id="prop-${n}"],[id^="prop-${n}-"]`).forEach(e => (e.style.display = 'inline'));
    const at = Number(f.dataset.t ?? t);
    for (const tr of a.tracks) f.querySelectorAll(tr.target).forEach(el => {
      const anim = el.animate(tr.keyframes, { duration: ms, easing: 'linear', fill: 'both' });
      anim.pause();
      anim.currentTime = at * ms;
    });
    let end = 0;
    for (const h of a.highlight ?? []) {
      const start = end; end += h.ms;
      if (at * ms >= start && at * ms < end) f.querySelector(`#${h.region}`).style.filter = 'drop-shadow(0 0 2px #88D64B) drop-shadow(0 0 4px #88D64B)';
    }
  }
}

const browser = await chromium.launch(launchOptions());
try {
  const page = await browser.newPage();
  if (mode === '--sheet') {
    const out = path.resolve(arg1);
    const cells = catalog.map(a => `<figure><img src="${pathToFileURL(path.join(outDir, `${a.id}.png`))}" width="240" height="180" alt=""><figcaption><b>${a.id.replace('exercise-', '')}</b><br>${a.rig ?? 'side'} · ${a.durationToken} · ${[a.prop].flat().join(', ')}</figcaption></figure>`).join('\n');
    const html = `<!doctype html><meta charset="utf-8"><title>Exercise posters</title><style>body{margin:16px;font:12px/1.35 system-ui,sans-serif;color:#182743;background:#fff}main{display:grid;grid-template-columns:repeat(8,240px);gap:12px}figure{margin:0}img{display:block;border-radius:8px}figcaption{padding-top:4px}</style><h1 style="font-size:16px">Exercise demos · ${catalog.length} posters</h1><main>${cells}</main>`;
    fs.writeFileSync(out.replace(/\.png$/, '.html'), html);
    await page.setViewportSize({ width: 8 * 252 + 32, height: 400 });
    await page.goto(pathToFileURL(out.replace(/\.png$/, '.html')).href);
    await page.screenshot({ path: out, fullPage: true });
    console.log(`${out} (${catalog.length} posters)`);
  } else if (mode === '--strip') {
    const a = catalog.find(x => x.id === arg1);
    if (!a) throw new Error(`unknown id ${arg1}`);
    const frames = Array.from({ length: 8 }, (_, i) => `<div class="f" data-t="${i / 8}" style="width:240px;height:180px"></div>`).join('');
    await page.setViewportSize({ width: 1920, height: 180 });
    await page.setContent(`<!doctype html><style>${STYLE}.f svg{left:20px;top:10px;width:200px;height:160px}</style>${frames}`);
    await page.evaluate(drawPose, { a, svg: rigs[a.rig ?? 'side'], ms: tokens.durationsMs[a.durationToken], t: 0 });
    await page.screenshot({ path: path.resolve(arg2) });
    console.log(path.resolve(arg2));
  } else {
    await page.setViewportSize({ width: 480, height: 360 });
    await page.setContent(`<!doctype html><style>${STYLE}.f svg{left:40px;top:20px;width:400px;height:320px}</style><div class="f" style="width:480px;height:360px"></div>`);
    const todo = catalog.filter(a => !fs.existsSync(path.join(outDir, `${a.id}.webm`)));
    for (const a of todo) {
      await page.evaluate(drawPose, { a, svg: rigs[a.rig], ms: tokens.durationsMs[a.durationToken], t: a.poster });
      await page.locator('.f').screenshot({ path: path.join(outDir, `${a.id}.png`) });
    }
    console.log(`wrote ${todo.length} posters to ${path.relative(root, outDir)}`);
  }
} finally {
  await browser.close();
}
