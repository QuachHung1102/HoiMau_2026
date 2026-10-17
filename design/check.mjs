// Design handoff invariants. Run from the repo root: node design/check.mjs
// `node design/check.mjs --sync` first regenerates: the index.html gallery, the playground data block
// and the animation.md catalog table. Never edit those generated blocks by hand.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Requirements appended by plan tasks. Append only.
const REQUIRED_SCREENS = [
  'S57', 'S58',
  'S60', 'S61', 'S62',
  'S59',
  'S63', 'S64', 'S82',
  'S65', 'S66', 'S67', 'S68', 'S69', 'S70',
  'S71', 'S72',
  'S73', 'S74', 'S75', 'S76',
  'S77', 'S78', 'S79', 'S80', 'S81',
];
const REQUIRED_MOTION = [
  'press-scale', 'check-draw', 'switch-slide', 'tab-pill', 'chip-select', 'list-stagger', 'number-roll', 'progress-fill', 'skeleton-shimmer', 'snackbar-undo', 'field-error', 'pending-pulse', 'water-check-in', 'quest-complete', 'mam-idle',
  'mam-happy', 'mam-cheer', 'mam-tired', 'mam-wave', 'mam-sleep',
  'exercise-xoay-vai', 'exercise-squat', 'exercise-chong-day-tua-ban', 'exercise-chung-chan-lui', 'exercise-plank-tua-goi', 'exercise-tha-long-vai',
  'xp-float', 'coin-fly', 'reject-revert', 'hidden-quest-reveal', 'end-of-day-sky', 'welcome-sprout', 'onboarding-step', 'archetype-lift', 'meal-swap', 'focus-ring', 'focus-demo', 'focus-breathe', 'focus-pause', 'workout-complete', 'streak-flame', 'streak-reset-soft', 'purchase-unlock', 'theme-apply', 'nudge-sent', 'rank-roll', 'unread-dot', 'journal-saved', 'quote-reveal', 'ticket-granted', 'ticket-freeze',
  'level-up', 'streak-milestone', 'mam-evolve', 'stage-path',
  'exercise-nghieng-co-nhe', 'exercise-mo-nguc', 'exercise-gian-co-tay', 'exercise-xoay-than-khi-ngoi', 'exercise-cui-nguoi-gian-lung', 'exercise-cong-va-vong-lung', 'exercise-gian-dui-truoc', 'exercise-gian-bap-chan', 'exercise-xoay-hong', 'exercise-dung-len-ngoi-xuong-ghe', 'exercise-chong-day-tua-tuong', 'exercise-nhon-got', 'exercise-cau-mong', 'exercise-tay-chan-doi-dien', 'exercise-squat-cam-ta-tay', 'exercise-day-vai-voi-ta-tay', 'exercise-cheo-ta-tay', 'exercise-gap-hong-voi-ta-tay', 'exercise-cuon-ta-tay-truoc', 'exercise-keo-day-khang-luc', 'exercise-buoc-ngang-voi-day-khang-luc', 'exercise-di-bo-tai-cho', 'exercise-nang-dau-goi', 'exercise-got-cham-mong', 'exercise-dang-tay-buoc-ngang', 'exercise-di-bo-nhanh', 'exercise-chay-bo-nhe', 'exercise-nhun-nhe-tai-cho', 'exercise-leo-nui-tua-ban', 'exercise-di-bo-cham', 'exercise-tho-bung', 'exercise-tho-ra-dai', 'exercise-tho-vuong', 'exercise-tha-long-tung-vung',
];
const REQUIRED_FILES = [
  'design/motion/catalog.json', 'design/motion/playground.html',
  'design/assets/mam/stage-egg.svg', 'design/assets/mam/stage-hatchling.svg', 'design/assets/mam/stage-juvenile.svg', 'design/assets/mam/stage-adult.svg', 'design/assets/mam/stage-mythic.svg', 'design/assets/mam/skin-fox.svg',
  'design/assets/exercise/rig-side.svg',
  'design/motion/exercises/exercise-xoay-vai.webm', 'design/motion/exercises/exercise-xoay-vai.png', 'design/motion/exercises/exercise-squat.webm', 'design/motion/exercises/exercise-squat.png', 'design/motion/exercises/exercise-chong-day-tua-ban.webm', 'design/motion/exercises/exercise-chong-day-tua-ban.png', 'design/motion/exercises/exercise-chung-chan-lui.webm', 'design/motion/exercises/exercise-chung-chan-lui.png', 'design/motion/exercises/exercise-plank-tua-goi.webm', 'design/motion/exercises/exercise-plank-tua-goi.png', 'design/motion/exercises/exercise-tha-long-vai.webm', 'design/motion/exercises/exercise-tha-long-vai.png',
  'design/assets/exercise/rig-front.svg', 'design/motion/rig-keyframes.mjs', 'design/motion/render-poses.mjs',
  'design/motion/exercises/exercise-nghieng-co-nhe.png', 'design/motion/exercises/exercise-mo-nguc.png', 'design/motion/exercises/exercise-gian-co-tay.png', 'design/motion/exercises/exercise-xoay-than-khi-ngoi.png', 'design/motion/exercises/exercise-cui-nguoi-gian-lung.png', 'design/motion/exercises/exercise-cong-va-vong-lung.png', 'design/motion/exercises/exercise-gian-dui-truoc.png', 'design/motion/exercises/exercise-gian-bap-chan.png', 'design/motion/exercises/exercise-xoay-hong.png', 'design/motion/exercises/exercise-dung-len-ngoi-xuong-ghe.png', 'design/motion/exercises/exercise-chong-day-tua-tuong.png', 'design/motion/exercises/exercise-nhon-got.png', 'design/motion/exercises/exercise-cau-mong.png', 'design/motion/exercises/exercise-tay-chan-doi-dien.png', 'design/motion/exercises/exercise-squat-cam-ta-tay.png', 'design/motion/exercises/exercise-day-vai-voi-ta-tay.png', 'design/motion/exercises/exercise-cheo-ta-tay.png', 'design/motion/exercises/exercise-gap-hong-voi-ta-tay.png', 'design/motion/exercises/exercise-cuon-ta-tay-truoc.png', 'design/motion/exercises/exercise-keo-day-khang-luc.png', 'design/motion/exercises/exercise-buoc-ngang-voi-day-khang-luc.png', 'design/motion/exercises/exercise-di-bo-tai-cho.png', 'design/motion/exercises/exercise-nang-dau-goi.png', 'design/motion/exercises/exercise-got-cham-mong.png', 'design/motion/exercises/exercise-dang-tay-buoc-ngang.png', 'design/motion/exercises/exercise-di-bo-nhanh.png', 'design/motion/exercises/exercise-chay-bo-nhe.png', 'design/motion/exercises/exercise-nhun-nhe-tai-cho.png', 'design/motion/exercises/exercise-leo-nui-tua-ban.png', 'design/motion/exercises/exercise-di-bo-cham.png', 'design/motion/exercises/exercise-tho-bung.png', 'design/motion/exercises/exercise-tho-ra-dai.png', 'design/motion/exercises/exercise-tho-vuong.png', 'design/motion/exercises/exercise-tha-long-tung-vung.png',
];
const TEXT_PAIRS = [['ink', 'bg'], ['ink', 'white'], ['muted', 'bg'], ['muted', 'white'], ['muted', 'soft'], ['primary', 'white'], ['primary', 'soft'], ['white', 'primary'], ['ink', 'lime'], ['error', 'white'],
  ['flame', 'white'], ['flame', 'bg'], ['flame', 'flame-soft'], ['ink', 'flame-soft'], ['white', 'flame'], ['frost', 'white'], ['frost', 'frost-soft'], ['ink', 'frost-soft'], ['gold', 'white'], ['gold', 'gold-soft'], ['ink', 'gold-soft'], ['white', 'ink'], ['lime', 'ink'],
  ['white', 'forest-primary'], ['forest-primary', 'forest-soft'], ['forest-primary', 'white'], ['ink', 'forest-bg'], ['muted', 'forest-bg'], ['muted', 'forest-soft'], ['white', 'sky-primary'], ['sky-primary', 'sky-soft'], ['sky-primary', 'white'], ['ink', 'sky-bg'], ['muted', 'sky-bg'], ['muted', 'sky-soft'],
  ['ink', 'soft'], ['primary', 'bg'], ['error', 'bg'], ['lime', 'primary']];

const SYNC = process.argv.includes('--sync');
const D = dirname(fileURLToPath(import.meta.url));
const R = join(D, '..');
const read = p => readFileSync(join(R, p), 'utf8');
const json = p => JSON.parse(read(p));
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

// 1. Screens: screens.json <-> screen-map tables <-> exports
const screens = json('design/screens.json');
const codes = screens.map(s => s.name.match(/^S\d+/)?.[0]);
check(codes.every(Boolean), 'every screens.json name starts with an S-code');
check(new Set(codes).size === codes.length, 'S-codes are unique');
const mapCodes = new Set([...read('docs/design/screen-map.md').matchAll(/^\| (S\d+) \|/gm)].map(m => m[1]));
for (const c of codes) check(mapCodes.has(c), `${c} missing from screen-map tables`);
for (const c of mapCodes) check(codes.includes(c), `${c} in screen-map but not in screens.json`);
for (const c of REQUIRED_SCREENS) check(codes.includes(c), `required screen ${c} not in screens.json`);
const exported = new Set(readdirSync(join(D, 'exports')).map(f => f.replace(/\.png$/, '')));
for (const s of screens) {
  if (!exported.has(s.id)) { fails.push(`export missing for ${s.name} (${s.id})`); continue; }
  check(readFileSync(join(D, 'exports', `${s.id}.png`)).readUInt32BE(16) === 390, `${s.id}.png is not 390px wide`);
}
for (const e of exported) check(screens.some(s => s.id === e), `orphan export ${e}.png`);

// 2. index.html lists every screen (regenerated by --sync), its local links resolve; required files exist
const esc = t => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/\n/g, ' ');
const gallery = screens.map(s => `<a class="screen" href="exports/${s.id}.png"><img src="exports/${s.id}.png" alt="${esc(s.name)}" loading="lazy"><span>${esc(s.name)}</span></a>`).join('\n');
const galleryBlock = /(<section aria-label="Bộ màn hình">\n)[\s\S]*?(\n<\/section><\/main>)/;
let index = read('design/index.html');
if (SYNC) { index = index.replace(galleryBlock, (_, open, close) => open + gallery + close); writeFileSync(join(D, 'index.html'), index); }
check(index.match(galleryBlock)?.[0] === `<section aria-label="Bộ màn hình">\n${gallery}\n</section></main>`, 'index.html gallery out of sync: run node design/check.mjs --sync');
for (const [, u] of index.matchAll(/(?:src|href)="([^"#]+)"/g))
  if (!/^https?:/.test(u)) check(existsSync(join(D, decodeURI(u))), `index.html broken link ${u}`);
for (const f of REQUIRED_FILES) check(existsSync(join(R, f)), `${f} missing`);

// 3. Text contrast >= 4.5:1 (NFR-04) for colour tokens used as text on a background
const colors = Object.fromEntries([...read('DESIGN.md').split('\n---')[0].matchAll(/^ {2}([\w-]+): "(#[0-9A-Fa-f]{6})"/gm)].map(m => [m[1], m[2]]));
const lum = h => {
  const [r, g, b] = h.slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
for (const [fg, bg] of TEXT_PAIRS) {
  if (!colors[fg] || !colors[bg]) { fails.push(`colour token ${fg} or ${bg} missing from DESIGN.md`); continue; }
  const r = ratio(colors[fg], colors[bg]);
  check(r >= 4.5, `contrast ${fg} on ${bg} = ${r.toFixed(2)} (< 4.5)`);
}

// 4. Mầm layered SVGs expose the parts that motion targets
const mamDir = join(D, 'assets/mam');
const stageFiles = existsSync(mamDir) ? readdirSync(mamDir).filter(f => /^stage-[\w-]+\.svg$/.test(f)) : [];
for (const f of stageFiles) {
  const svg = readFileSync(join(mamDir, f), 'utf8');
  const pivoted = ['body', 'leaf-left', 'leaf-right', ...(f === 'stage-egg.svg' ? [] : ['arm-right'])];
  for (const p of pivoted) check(new RegExp(`id="${p}" style="transform-origin:[\\d.]+px [\\d.]+px"`).test(svg), `${f}: #${p} needs style="transform-origin:Xpx Ypx" (viewBox units)`);
  for (const p of ['face-neutral', 'face-happy', 'face-tired']) check(svg.includes(`id="${p}"`), `${f} lacks #${p}`);
  check(svg.includes('viewBox="0 0 128 128"'), `${f} must use viewBox="0 0 128 128"`);
  check((svg.match(/class="eye"/g) ?? []).length >= 2, `${f} needs two class="eye" groups in #face-neutral`);
}

// 4b. Exercise rigs (side, front) expose the joints that exercise keyframes drive, and their props
const rigFile = n => (existsSync(join(D, `assets/exercise/rig-${n}.svg`)) ? readFileSync(join(D, `assets/exercise/rig-${n}.svg`), 'utf8') : '');
const rigs = { side: rigFile('side'), front: rigFile('front') };
const rig = rigs.side, rigFront = rigs.front;
const RIG_PARTS = {
  side: {
    joints: ['rig', 'hips', 'torso', 'head', 'belly', 'arm-f', 'forearm-f', 'hand-f', 'arm-b', 'forearm-b', 'hand-b', 'thigh-f', 'shin-f', 'foot-f', 'thigh-b', 'shin-b', 'foot-b', 'prop-band'],
    props: ['prop-mat', 'prop-bench', 'prop-chair', 'prop-sofa', 'prop-wall', 'prop-anchor', 'prop-band', 'prop-palm-f', 'prop-dumbbell-f', 'prop-dumbbell-b'],
  },
  front: {
    joints: ['rig', 'hips', 'torso', 'head', 'face', 'arm-l', 'forearm-l', 'hand-l', 'arm-r', 'forearm-r', 'hand-r', 'thigh-l', 'shin-l', 'foot-l', 'thigh-r', 'shin-r', 'foot-r', 'prop-miniband'],
    props: ['prop-mat', 'prop-chair', 'prop-miniband', 'prop-dumbbell-l', 'prop-dumbbell-r'],
  },
};
for (const [n, svg] of Object.entries(rigs)) {
  if (!svg) continue;
  for (const p of RIG_PARTS[n].joints)
    check(new RegExp(`id="${p}" style="transform-origin:[\\d.]+px [\\d.]+px"`).test(svg), `rig-${n}.svg: #${p} needs style="transform-origin:Xpx Ypx"`);
  for (const p of RIG_PARTS[n].props) check(svg.includes(`id="${p}"`), `rig-${n}.svg lacks #${p}`);
  check(svg.includes('viewBox="0 0 200 160"'), `rig-${n}.svg must use viewBox="0 0 200 160"`);
}

// 5. Motion: tokens <-> catalog <-> playground <-> animation.md
const catalogPath = join(D, 'motion/catalog.json');
const playgroundPath = join(D, 'motion/playground.html');
const catalog = existsSync(catalogPath) ? json('design/motion/catalog.json') : [];
const ids = catalog.map(a => a.id);
for (const id of REQUIRED_MOTION) check(ids.includes(id), `required motion ${id} not in catalog.json`);
if (catalog.length) {
  const tokens = json('design/motion/tokens.json');
  const mam = Object.fromEntries(stageFiles.map(f => [f.replace(/\.svg$/, ''), readFileSync(join(mamDir, f), 'utf8')]));
  if (!mam['stage-hatchling']) mam['stage-hatchling'] = read('design/assets/mam.svg');
  const payload = JSON.stringify({ tokens, catalog, mam, rig, rigFront }).replace(/</g, '\\u003c');
  const block = /(<script id="motion-data" type="application\/json">)[\s\S]*?(<\/script>)/;
  let playground = readFileSync(playgroundPath, 'utf8');
  if (SYNC) { playground = playground.replace(block, (_, open, close) => open + payload + close); writeFileSync(playgroundPath, playground); }
  check(playground.match(block)?.[0] === `<script id="motion-data" type="application/json">${payload}</script>`, 'playground data out of sync: run node design/check.mjs --sync');
  const table = ['| Mã | Mức | Loại | Màn | Kích hoạt | Khi giảm chuyển động |', '|---|---|---|---|---|---|',
    ...catalog.map(a => `| \`${a.id}\` | ${a.tier} | ${a.kind} | ${a.screens.join(', ')} | ${a.trigger} | ${a.reducedMotion} |`)].join('\n');
  const docBlock = /(<!-- motion-catalog:start -->)[\s\S]*?(<!-- motion-catalog:end -->)/;
  let animDoc = read('docs/design/animation.md');
  if (SYNC) { animDoc = animDoc.replace(docBlock, (_, open, close) => `${open}\n${table}\n${close}`); writeFileSync(join(R, 'docs/design/animation.md'), animDoc); }
  check(animDoc.match(docBlock)?.[0] === `<!-- motion-catalog:start -->\n${table}\n<!-- motion-catalog:end -->`, 'animation.md catalog table out of sync: run node design/check.mjs --sync');
  check(playground.includes('prefers-reduced-motion') && playground.includes('id="rm-toggle"'), 'playground needs the reduced-motion toggle');
  check(new Set(ids).size === ids.length, 'motion ids are unique');
  const timing = t => (t.durationToken === undefined || t.durationToken in tokens.durationsMs) && (t.easingToken === undefined || t.easingToken in tokens.easing || t.easingToken in tokens.springs);
  for (const a of catalog) {
    check([1, 2].includes(a.tier), `${a.id}: tier must be 1 or 2`);
    check(a.durationToken in tokens.durationsMs && timing(a), `${a.id}: unknown duration/easing token`);
    check(a.tracks?.length > 0 && a.tracks.every(timing), `${a.id}: needs tracks with known tokens`);
    check(typeof a.reducedMotion === 'string' && a.reducedMotion.length > 10, `${a.id}: reducedMotion fallback missing`);
    check(playground.includes(`  ${a.demo}: a => `), `${a.id}: playground has no demo "${a.demo}"`);
    for (const s of a.screens) check(s === '*' || codes.includes(s), `${a.id}: unknown screen ${s}`);
    if (['reward', 'celebration'].includes(a.kind)) check(a.trigger.startsWith('confirmed:'), `${a.id}: ${a.kind} must start on a server-confirmed state`);
    if (a.kind === 'exercise') {
      // which rig, which props, the poster moment, targets that exist in that rig, phase guides that fill the loop
      const svg = rigs[a.rig] ?? '';
      const sum = l => l.reduce((n, x) => n + x.ms, 0);
      check(['side', 'front'].includes(a.rig), `${a.id}: rig must be "side" or "front"`);
      check(Array.isArray(a.prop) && a.prop.every(p => svg.includes(`id="prop-${p}"`) || svg.includes(`id="prop-${p}-`)), `${a.id}: prop must list props drawn in rig-${a.rig}.svg`);
      check(typeof a.poster === 'number' && a.poster >= 0 && a.poster < 1, `${a.id}: poster must be a cycle fraction in [0, 1)`);
      check(existsSync(join(D, `motion/exercises/${a.id}.png`)), `${a.id}: poster PNG missing`);
      for (const t of a.tracks) check(svg.includes(`id="${t.target.slice(1)}"`), `${a.id}: ${t.target} is not in rig-${a.rig}.svg`);
      if (a.demo === 'breath')
        check(Array.isArray(a.pattern) && a.pattern.length > 0 && a.pattern.every(p => typeof p.label === 'string' && p.ms > 0) && sum(a.pattern) === tokens.durationsMs[a.durationToken], `${a.id}: breath entries need pattern [{label, ms}] summing to ${a.durationToken}`);
      if (a.highlight)
        check(a.highlight.every(h => svg.includes(`id="${h.region}"`) && h.ms > 0) && sum(a.highlight) === tokens.durationsMs[a.durationToken], `${a.id}: highlight regions must be rig ids, their ms summing to ${a.durationToken}`);
    }
  }
}

if (fails.length) { console.error(`FAIL (${fails.length})\n- ` + fails.join('\n- ')); process.exit(1); }
console.log(`OK: ${screens.length} screens, ${catalog.length} motions, ${stageFiles.length} Mầm stages, ${TEXT_PAIRS.length} contrast pairs`);
