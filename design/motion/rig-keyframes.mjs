// Exercise demonstrations (Task 31A): joint-angle tables -> `exercise-*` keyframes in catalog.json.
//   node design/motion/rig-keyframes.mjs          regenerate the generated entries (and normalise the six rigged in Task 8A)
//   node design/motion/rig-keyframes.mjs --check  exit 1 when catalog.json differs from what this script generates
// Each move is a pose function of the cycle phase t in [0, 1): world joint angles, inverse kinematics for planted
// hands and feet, prop contacts. The script samples it into keyframes, then replays those keyframes the way the
// browser does (linear between keys, values as written to the catalog) and asserts: the loop closes, planted
// points drift <= 1.5 px, no foot sinks below the floor, every joint stays inside a safe adult range.
// Angles: degrees, 0 = the rest direction of the segment in the SVG (limbs down, torso and head up),
// positive = clockwise on screen. Side rig faces right (+x); `-f` limbs are near the viewer, `-b` far.
// Front rig faces the viewer; `-r` is the figure's right (viewer's left), `-l` its left.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const D = dirname(fileURLToPath(import.meta.url));
const R = join(D, '../..');
const read = p => readFileSync(join(R, p), 'utf8');
const CATALOG = 'design/motion/catalog.json';
const FLOOR = 150;
const DRIFT = 1.5;

// ---------------------------------------------------------------- rig: joints, pivots, parents from the SVG
function parseRig(svg) {
  const joints = {};
  const stack = [];
  for (const m of svg.matchAll(/<g\b([^>]*)>|<\/g>/g)) {
    if (m[0] === '</g>') { stack.pop(); continue; }
    const id = m[1].match(/id="([^"]+)"/)?.[1];
    const o = m[1].match(/transform-origin:([\d.]+)px ([\d.]+)px/);
    if (id && o) joints[id] = { origin: [+o[1], +o[2]], parent: stack.findLast(Boolean) ?? null };
    stack.push(id && o ? id : null);
  }
  return { joints, ids: new Set([...svg.matchAll(/id="([^"]+)"/g)].map(m => m[1])) };
}
export const RIGS = {
  side: parseRig(read('design/assets/exercise/rig-side.svg')),
  front: parseRig(read('design/assets/exercise/rig-front.svg')),
};

// ---------------------------------------------------------------- 2D affine [a b c d e f], CSS order
const rad = d => (d * Math.PI) / 180;
const deg = r => (r * 180) / Math.PI;
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
// transform-origin o; transform: translate(tx, ty) rotate(rot) scale(sx, sy)
function localMatrix(o, p) {
  const c = Math.cos(rad(p.rot ?? 0)), s = Math.sin(rad(p.rot ?? 0)), sx = p.sx ?? 1, sy = p.sy ?? 1;
  const a = c * sx, b = s * sx, cc = -s * sy, d = c * sy;
  const ex = (p.tx ?? 0) + o[0], ey = (p.ty ?? 0) + o[1];
  return [a, b, cc, d, ex - a * o[0] - cc * o[1], ey - b * o[0] - d * o[1]];
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const dirAngle = v => deg(Math.atan2(-v[0], v[1])); // angle of a vector measured from "down", clockwise positive
const norm = a => ((((a + 180) % 360) + 360) % 360) - 180;

class Pose {
  constructor(rig) { this.rig = rig; this.v = {}; }
  get(id) { return this.v[id] ?? {}; }
  set(id, p) { this.v[id] = { ...this.v[id], ...p }; return this; }
  m(id) { return id ? mul(this.m(this.rig.joints[id].parent), localMatrix(this.rig.joints[id].origin, this.get(id))) : [1, 0, 0, 1, 0, 0]; }
  pt(id, p) { return apply(this.m(id), p); }
  pivot(id) { return this.pt(id, this.rig.joints[id].origin); }
  angle(id) { if (!id) return 0; const m = this.m(id); return deg(Math.atan2(m[1], m[0])); }
  // rotate joint so that its frame has world angle `w`
  aim(id, w) { return this.set(id, { rot: norm(w - this.angle(this.rig.joints[id].parent)) }); }
  hip(x, y) { return this.set('hips', { tx: x - this.rig.joints.hips.origin[0], ty: y - this.rig.joints.hips.origin[1], rot: 0 }); }
  // two-segment IK: j1 -> j2 -> effector (point in j2's frame) onto `target`; `sign` = sign of (j2 - j1) bend
  ik(j1, j2, eff, target, sign) {
    const root = this.pivot(j1), knee = this.pivot(j2), end = this.pt(j2, eff);
    const l1 = dist(root, knee), l2 = dist(knee, end), d = dist(root, target);
    if (d > l1 + l2 + 0.3 || d < Math.abs(l1 - l2) - 0.3) throw new Error(`ik ${j1}: target at ${d.toFixed(2)} out of reach [${Math.abs(l1 - l2).toFixed(1)}, ${(l1 + l2).toFixed(1)}]`);
    const A = deg(Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)))));
    const base = dirAngle([target[0] - root[0], target[1] - root[1]]);
    let best;
    for (const a1 of [base + A, base - A]) {
      const k = [root[0] - l1 * Math.sin(rad(a1)), root[1] + l1 * Math.cos(rad(a1))];
      const rel = norm(dirAngle([target[0] - k[0], target[1] - k[1]]) - a1);
      if (!best || rel * sign > best.rel * sign) best = { a1, rel };
    }
    const cur1 = dirAngle([knee[0] - root[0], knee[1] - root[1]]);
    this.set(j1, { rot: norm((this.get(j1).rot ?? 0) + best.a1 - cur1) });
    const k2 = this.pivot(j2), e2 = this.pt(j2, eff);
    const cur2 = dirAngle([e2[0] - k2[0], e2[1] - k2[1]]);
    this.set(j2, { rot: norm((this.get(j2).rot ?? 0) + dirAngle([target[0] - k2[0], target[1] - k2[1]]) - cur2) });
    return this;
  }
  // straight chain (front-view leg): rotate j1 toward target and scale it along its axis (knee bending toward the viewer)
  stretch(j1, j2, eff, target) {
    this.set(j2, { rot: 0, sy: 1 }).set(j1, { sy: 1 });
    const root = this.pivot(j1), end0 = this.pt(j2, eff);
    const delta = dirAngle([target[0] - root[0], target[1] - root[1]]) - dirAngle([end0[0] - root[0], end0[1] - root[1]]);
    this.set(j1, { rot: norm((this.get(j1).rot ?? 0) + delta) });
    return this.set(j1, { sy: dist(root, target) / dist(root, this.pt(j2, eff)) });
  }
}

// ---------------------------------------------------------------- shared shapes
const clamp01 = x => Math.min(1, Math.max(0, x));
const ease = x => (1 - Math.cos(Math.PI * clamp01(x))) / 2;
const bump = x => Math.sin(Math.PI * clamp01(x));
const lerp = (a, b, u) => a + (b - a) * u;
const mix = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
const wave = t => (1 - Math.cos(2 * Math.PI * t)) / 2; // 0 -> 1 -> 0
// move in over [0, a], hold until b, return over [b, 1]
const hold = (t, a = 0.35, b = 0.65) => (t < a ? ease(t / a) : t < b ? 1 : ease((1 - t) / (1 - b)));
// out over [0, a], pause to b, back over [b, c], rest to 1
const rep = (t, a, b, c = 1) => (t < a ? ease(t / a) : t < b ? 1 : t < c ? ease((c - t) / (c - b)) : 0);
const rot = (v, w) => [v[0] * Math.cos(rad(w)) - v[1] * Math.sin(rad(w)), v[0] * Math.sin(rad(w)) + v[1] * Math.cos(rad(w))];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];

const side = () => new Pose(RIGS.side).hip(100, 92);
const front = () => new Pose(RIGS.front).hip(100, 92);
// side-rig points (rest coordinates inside each joint's frame)
const SP = {
  heel: s => [`foot-${s}`, [97, 150]], toe: s => [`foot-${s}`, [109, 150]], knee: s => [`shin-${s}`, [100, 121]],
  hand: s => [`hand-${s}`, [100, 90.5]], hip: ['hips', [100, 92]],
};
const FP = {
  heel: s => [`foot-${s}`, s === 'r' ? [90, 150] : [102, 150]], toe: s => [`foot-${s}`, s === 'r' ? [98, 150] : [110, 150]],
  hand: s => [`hand-${s}`, s === 'r' ? [86, 90.5] : [114, 90.5]],
};
const feetSide = ['f', 'b'].flatMap(s => [SP.heel(s), SP.toe(s)]);
const feetFront = ['r', 'l'].flatMap(s => [FP.heel(s), FP.toe(s)]);

function legSide(P, s, ankle, foot = 0) { P.ik(`thigh-${s}`, `shin-${s}`, [100, 146], ankle, 1); return P.aim(`foot-${s}`, foot); }
function armSide(P, s, target) { P.set(`hand-${s}`, { rot: 0 }); return P.ik(`arm-${s}`, `forearm-${s}`, [100, 90.5], target, -1); }
function armAngles(P, s, arm, forearm, hand = forearm) { P.aim(`arm-${s}`, arm).aim(`forearm-${s}`, forearm); return P.aim(`hand-${s}`, hand); }
function legAngles(P, s, thigh, shin, foot) { P.aim(`thigh-${s}`, thigh).aim(`shin-${s}`, shin); return P.aim(`foot-${s}`, foot); }
const worldArm = (P, s) => [P.angle(`arm-${s}`), P.angle(`forearm-${s}`)];
function legFront(P, s, ankle) { P.stretch(`thigh-${s}`, `shin-${s}`, [s === 'r' ? 94 : 106, 146], ankle); return P.aim(`foot-${s}`, 0); }
function armFront(P, s, target, sign) { P.set(`hand-${s}`, { rot: 0 }); return P.ik(`arm-${s}`, `forearm-${s}`, s === 'r' ? [86, 90.5] : [114, 90.5], target, sign); }
const relaxedSide = (P, swing = 0) => ['f', 'b'].forEach(s => armAngles(P, s, P.angle('torso') + 3 + swing, P.angle('torso') - 5 + swing));
function relaxedFront(P) { armAngles(P, 'r', 6, 3); armAngles(P, 'l', -6, -3); return P; }

// seated on the side chair: hips on the seat, thighs level, shins vertical, feet flat
const SEAT = [90, 121];
function seatedSide(P) { P.hip(...SEAT); legSide(P, 'f', [119, 146]); return legSide(P, 'b', [119, 146]); }
// hands and knees on the mat (toes pointing back), hips at x
function quadruped(P, hx, tau) {
  P.hip(hx, 116.25).aim('torso', tau);
  for (const s of ['f', 'b']) legAngles(P, s, 0, 90, 140);
  return P;
}
// shoulders straight above the hands, arms straight (hand centre 36.42 px from the shoulder: elbow < 10 deg)
const QUAD_TAU = deg(Math.acos((116.25 - (146.4 - 36.42)) / 38));
const QUAD_HAND = hx => [hx + 38 * Math.sin(rad(QUAD_TAU)), 146.4];

// treadmill gait (side): legs alternate, the stance foot slides back at constant speed on the floor
function gait(P, t, { stance, reach, lift, arm, elbow, lean, bounce = 0 }) {
  const feet = {};
  let m = 0, squash = 0;
  for (const [s, ph] of [['f', t], ['b', (t + 0.5) % 1]]) {
    if (ph < stance) {
      feet[s] = { x: 100 + reach - (2 * reach * ph) / stance, y: 146, foot: 0 };
      m = Math.max(m, Math.abs(feet[s].x - 100)); squash += bump(ph / stance);
    } else { const p = (ph - stance) / (1 - stance); feet[s] = { x: 100 - reach + 2 * reach * ease(p), y: 146 - lift * bump(p), point: bounce ? bump(p) ** 2 : undefined }; }
  }
  // walking vaults over a straight stance leg (hips highest mid-stance); running sinks into the stance knee
  const y = bounce ? 146 - Math.sqrt(53.8 ** 2 - reach * reach) + bounce * squash : 146 - Math.sqrt(53.8 ** 2 - m * m);
  P.hip(100, y).aim('torso', lean).aim('head', 0);
  for (const s of ['f', 'b']) {
    legSide(P, s, [feet[s].x, feet[s].y]);
    if (feet[s].point !== undefined) P.aim(`foot-${s}`, (P.angle(`shin-${s}`) + 15) * feet[s].point); // running swing foot: slightly pointed; walking keeps it level to clear the floor
  }
  const a = arm * Math.cos(2 * Math.PI * t);
  armAngles(P, 'f', lean + a, lean + a + elbow);
  armAngles(P, 'b', lean - a, lean - a + elbow);
  return P;
}
const gaitFloor = stance => [
  ...['heel', 'toe'].map(k => ({ floor: SP[k]('f'), during: [0, stance] })),
  ...['heel', 'toe'].map(k => ({ floor: SP[k]('b'), during: [0.5, 0.5 + stance] })),
];

// ---------------------------------------------------------------- the 34 moves
const RM = 'Ảnh tư thế chính đứng yên, kèm 3 bước hướng dẫn bằng chữ.';
const M = [];
const move = (code, name, spec) => M.push({ code, name, id: `exercise-${slug(name)}`, ...spec });
function slug(name) {
  return name.replace(/đ/g, 'd').replace(/Đ/g, 'D').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

move('NGHIENG_CO', 'Nghiêng cổ nhẹ', {
  rig: 'front', prop: ['mat'], durationToken: 'sideHoldCycle', poster: 0.25,
  pose: t => {
    const P = front();
    legFront(P, 'r', [94, 146]); legFront(P, 'l', [106, 146]);
    // ear toward the right shoulder (viewer's left) then the left; 30 deg of the 45 deg normal range
    return relaxedFront(P.aim('head', t < 0.5 ? -30 * hold(2 * t) : 30 * hold(2 * t - 1)));
  },
  contacts: feetFront.map(p => ({ fixed: p })),
});

move('MO_NGUC', 'Mở ngực', {
  rig: 'side', prop: ['mat'], durationToken: 'holdCycle', poster: 0.5,
  pose: t => {
    const u = hold(t), P = side();
    legSide(P, 'f', [100, 146]); legSide(P, 'b', [100, 146]);
    P.aim('torso', 2 * u).aim('head', -6 * u).set('belly', { sx: 1 + 0.5 * u }); // chest lifts, no lean back
    // hands clasped behind, shoulders extend 35 deg (normal 60), elbows soft; far arm 3 deg apart so both read
    for (const s of ['f', 'b']) { const k = s === 'b' ? 3 : 0; armAngles(P, s, 2 * u + 2 + 33 * u + k, 2 * u - 2 + 33 * u + k); }
    return P;
  },
  contacts: feetSide.map(p => ({ fixed: p })),
});

const FINGERS = ['hand-f', [106, 96]]; // just above the fingers of the outstretched hand
move('GIAN_CO_TAY', 'Giãn cổ tay', {
  rig: 'side', prop: ['mat', 'palm-f'], durationToken: 'holdCycle', poster: 0.5,
  pose: t => {
    const u = hold(t), P = side();
    legSide(P, 'f', [100, 146]); legSide(P, 'b', [100, 146]);
    P.aim('head', 8);
    // the outstretched arm reaches across the body, so it is drawn foreshortened (0.8) in side view
    P.set('arm-f', { sy: 0.8 });
    armAngles(P, 'f', -86, -90, -90 + 60 * u); // wrist extension 60 deg (normal 70)
    return armSide(P, 'b', P.pt(...FINGERS));
  },
  contacts: [...feetSide.map(p => ({ fixed: p })), { attach: [SP.hand('b'), FINGERS] }],
});

move('XOAY_THAN_NGOI', 'Xoay thân khi ngồi', {
  rig: 'front', prop: ['chair'], durationToken: 'sideHoldCycle', poster: 0.25,
  pose: t => {
    const P = front().hip(100, 121 - 29 * 0.35);
    // thighs point at the viewer: drawn at 0.35 so the knees sit in front of the seat; shins undo the scale
    for (const s of ['r', 'l']) P.set(`thigh-${s}`, { rot: 0, sy: 0.35 }).set(`shin-${s}`, { rot: 0, sy: 1 / 0.35 }).set(`foot-${s}`, { rot: 0 });
    const a = t < 0.5 ? -hold(2 * t) : hold(2 * t - 1); // -1 = turned to the right
    // the turn reads as the shoulders narrowing (0.7) and shifting 4 px toward the turn, face and hair part 7 px
    const sx = 1 - 0.3 * Math.abs(a);
    P.set('torso', { tx: 4 * a, ty: 0, rot: 0, sx }).set('head', { rot: 0, sx: 1 / sx }).set('face', { tx: 7 * a, ty: 0, sx: 1 - 0.2 * Math.abs(a) });
    // arms crossed, hands toward the shoulders
    P.set('arm-r', { rot: -35 }).set('forearm-r', { rot: -120 }).set('hand-r', { rot: 0 });
    return P.set('arm-l', { rot: 35 }).set('forearm-l', { rot: 120 }).set('hand-l', { rot: 0 });
  },
  contacts: feetFront.map(p => ({ fixed: p })),
});

let seatedHands; // arm angles with the hands resting on the thighs
const restSeatedHands = () => (seatedHands ??= (() => { const P = seatedSide(side()).aim('torso', 0); armSide(P, 'f', [108, 112]); armSide(P, 'b', [108, 112]); return worldArm(P, 'f'); })());
move('GIAN_LUNG_NGOI', 'Cúi người giãn lưng', {
  rig: 'side', prop: ['chair'], durationToken: 'holdCycle', poster: 0.5,
  pose: t => {
    const u = hold(t, 0.4, 0.65), P = seatedSide(side());
    P.aim('torso', 50 * u).aim('head', 50 * u + 15 * u);
    const [a, f] = restSeatedHands();
    for (const s of ['f', 'b']) armAngles(P, s, lerp(a, 4, u), lerp(f, 0, u));
    return P;
  },
  contacts: [...feetSide.map(p => ({ fixed: p })), { fixed: SP.hip }],
});

const QX = 72;
move('MEO_BO', 'Cong và võng lưng', {
  rig: 'side', prop: ['mat'], durationToken: 'breathCycle', poster: 0.75,
  pose: t => {
    const a = t < 0.5 ? -hold(2 * t) : hold(2 * t - 1); // -1 cat (exhale), +1 cow (inhale)
    // shoulders stay put over straight arms; the back rounds up (cat) or the belly drops (cow)
    const P = quadruped(side(), QX, QUAD_TAU);
    P.aim('head', QUAD_TAU - 10 + (a < 0 ? -35 : -30) * a);
    P.set('back', { sx: 1 + 1.3 * Math.max(0, -a) }).set('belly', { sx: 1 + 1.2 * Math.max(0, a) });
    armSide(P, 'f', QUAD_HAND(QX)); return armSide(P, 'b', QUAD_HAND(QX));
  },
  contacts: [...['f', 'b'].map(s => ({ fixed: SP.hand(s) })), ...['f', 'b'].map(s => ({ fixed: SP.knee(s) })), ...feetSide.map(p => ({ fixed: p }))],
  straight: ['f', 'b'],
});

const GRIP = ['shin-b', [91.6, 142.6]]; // front of the far ankle, hand touching it
const WALL = 146.4; // hand centre against the wall
let quadGrip;
move('GIAN_DUI_TRUOC', 'Giãn đùi trước', {
  rig: 'side', prop: ['mat', 'wall'], durationToken: 'holdCycle', poster: 0.5,
  pose: t => {
    const u = hold(t), P = side().hip(117, 92);
    legSide(P, 'f', [117, 146]);
    // knee bends 144 deg (normal 135-150), thigh just behind vertical, the far hand holds the ankle
    const knee = (Q, v) => legAngles(Q.aim('torso', -5 * v), 'b', 12 * v, 156 * v, 156 * v + 30 * v * v);
    knee(P, u);
    armSide(P, 'f', [WALL, 64]);
    // the far arm is drawn 23 % longer: the rig's arms are short for a hand-to-ankle reach
    P.set('arm-b', { sy: 1.23 });
    quadGrip ??= (() => { const Q = knee(side().hip(117, 92), 1); Q.set('arm-b', { sy: 1.23 }); armSide(Q, 'b', Q.pt(...GRIP)); return worldArm(Q, 'b'); })();
    return armAngles(P, 'b', lerp(3, quadGrip[0], u), lerp(-5, quadGrip[1], u));
  },
  contacts: [SP.heel('f'), SP.toe('f')].map(p => ({ fixed: p })).concat({ at: [WALL, 64], pt: SP.hand('f') }, { attach: [SP.hand('b'), GRIP], during: [0.35, 0.65] }),
});

move('GIAN_BAP_CHAN', 'Giãn bắp chân', {
  rig: 'side', prop: ['mat', 'wall'], durationToken: 'holdCycle', poster: 0.5,
  pose: t => {
    const th = lerp(12, 18, hold(t)); // back shin leans 12 -> 18 deg: ankle dorsiflexion within the normal 20
    const P = side().hip(92 + 53.9 * Math.sin(rad(th)), 146 - 53.9 * Math.cos(rad(th)));
    legSide(P, 'f', [92, 146]); legSide(P, 'b', [114, 146]);
    P.aim('torso', th).aim('head', th * 0.4);
    armSide(P, 'f', [WALL, 60]); return armSide(P, 'b', [WALL, 60]);
  },
  contacts: [...feetSide.map(p => ({ fixed: p })), ...['f', 'b'].map(s => ({ at: [WALL, 60], pt: SP.hand(s) }))],
});

const HIPHAND = { r: ['hips', [85.5, 86]], l: ['hips', [114.5, 86]] };
move('XOAY_HONG', 'Xoay hông', {
  rig: 'front', prop: ['mat'], durationToken: 'repCycle', poster: 0.25,
  pose: t => {
    // the pelvis traces an ellipse: side to side, and forward (lower, nearer: larger) / back
    const c = Math.cos(2 * Math.PI * t), dx = 7 * Math.sin(2 * Math.PI * t), P = front().hip(100 + dx, 96 + 1.5 * c); // knees gently bent
    P.set('pelvis', { sx: 1 + 0.06 * c, sy: 1 + 0.06 * c });
    legFront(P, 'r', [86, 146]); legFront(P, 'l', [114, 146]);
    const tilt = -0.55 * dx; // upper body stays over the feet
    P.aim('torso', tilt).aim('head', 0);
    armFront(P, 'r', P.pt(...HIPHAND.r), -1); return armFront(P, 'l', P.pt(...HIPHAND.l), 1);
  },
  contacts: [...feetFront.map(p => ({ fixed: p })), ...['r', 'l'].map(s => ({ attach: [FP.hand(s), HIPHAND[s]] }))],
});

move('DUNG_LEN_NGOI_XUONG', 'Đứng lên ngồi xuống ghế', {
  rig: 'side', prop: ['chair'], durationToken: 'repCycle', poster: 0.22,
  pose: t => {
    const u = rep(t, 0.45, 0.5), P = side();
    P.hip(lerp(SEAT[0], 116.5, ease(Math.min(1, u * 1.15))), lerp(SEAT[1], 92.3, ease((u - 0.12) / 0.88)));
    legSide(P, 'f', [117, 146]); legSide(P, 'b', [117, 146]);
    const lean = 42 * bump(u ** 0.8); // lean forward to rise, upright when standing and seated
    P.aim('torso', lean).aim('head', lean * 0.5);
    for (const s of ['f', 'b']) armAngles(P, s, lean - 25, lean - 100); // arms crossed on the chest
    return P;
  },
  contacts: feetSide.map(p => ({ fixed: p })),
});

move('CHONG_DAY_TUONG', 'Chống đẩy tựa tường', {
  rig: 'side', prop: ['mat', 'wall'], durationToken: 'repCycle', poster: 0.5,
  pose: t => {
    const a = lerp(12, 23, wave(t)); // body leans as one straight line from the ankles
    const P = side().hip(92 + 53.9 * Math.sin(rad(a)), 146 - 53.9 * Math.cos(rad(a)));
    legSide(P, 'f', [92, 146]); legSide(P, 'b', [92, 146]);
    P.aim('torso', a).aim('head', a - 6);
    armSide(P, 'f', [WALL, 62]); return armSide(P, 'b', [WALL, 62]);
  },
  contacts: [...feetSide.map(p => ({ fixed: p })), ...['f', 'b'].map(s => ({ at: [WALL, 62], pt: SP.hand(s) }))],
});

move('NHON_GOT', 'Nhón gót', {
  rig: 'side', prop: ['mat', 'wall'], durationToken: 'slowRepCycle', poster: 0.45,
  pose: t => {
    const phi = 32 * rep(t, 0.4, 0.5, 0.9); // heels up: plantarflexion 32 deg (normal 50), about the toes
    const ankle = add([127, 150], rot([-9, -4], phi));
    const P = side().hip(ankle[0], ankle[1] - 53.9);
    legSide(P, 'f', ankle, phi); legSide(P, 'b', ankle, phi);
    armSide(P, 'f', [WALL, 74]);
    return armAngles(P, 'b', 3, -5);
  },
  contacts: [...['f', 'b'].map(s => ({ fixed: SP.toe(s) })), { at: [WALL, 74], pt: SP.hand('f') }],
});

const BACK = ['torso', [89.5, 50]]; // top of the shoulders, on the mat
move('CAU_MONG', 'Cầu mông', {
  rig: 'side', prop: ['mat'], durationToken: 'repCycle', poster: 0.5,
  pose: t => {
    const beta = 20 * rep(t, 0.4, 0.6); // hips lift: shoulders-hips line rises 20 deg
    const tau = -90 - beta;
    const H = add([60, 150], rot([10.5, 42], tau));
    const P = side().hip(...H).aim('torso', tau).aim('head', -90);
    legSide(P, 'f', [130, 146]); legSide(P, 'b', [130, 146]);
    // arms lie straight on the mat; the palms slide a few px as the shoulders roll
    const sp = P.pivot('arm-f'), hand = [sp[0] + Math.sqrt(36.3 ** 2 - (146.4 - sp[1]) ** 2), 146.4];
    armSide(P, 'f', hand); return armSide(P, 'b', hand);
  },
  contacts: [{ at: [60, 150], pt: BACK }, ...feetSide.map(p => ({ fixed: p }))],
});

let quadArm;
move('TAY_CHAN_DOI_DIEN', 'Tay chân đối diện', {
  rig: 'side', prop: ['mat'], durationToken: 'holdCycle', poster: 0.5,
  pose: t => {
    const u = hold(t), P = quadruped(side(), QX, QUAD_TAU);
    P.aim('head', QUAD_TAU - 18 * u); // the head lifts a little so the reaching arm shows below it
    armSide(P, 'f', QUAD_HAND(QX));
    quadArm ??= (() => { const Q = quadruped(side(), QX, QUAD_TAU); armSide(Q, 'b', QUAD_HAND(QX)); return worldArm(Q, 'b'); })();
    // far arm forward (a little below level, so it shows under the head) and near leg back
    armAngles(P, 'b', lerp(quadArm[0], -80, u), lerp(quadArm[1], -80, u));
    return legAngles(P, 'f', 92 * u, lerp(90, 92, u), lerp(140, 102, u));
  },
  contacts: [{ fixed: SP.hand('f') }, { fixed: SP.knee('b') }, { fixed: SP.toe('b') }, { fixed: SP.heel('b') }],
  straight: ['f'],
});

move('SQUAT_TA_TAY', 'Squat cầm tạ tay', {
  rig: 'side', prop: ['mat', 'dumbbell-f'], durationToken: 'repCycle', poster: 0.47,
  pose: t => {
    const u = rep(t, 0.45, 0.5), P = side().hip(100 - 15 * u, 92 + 25 * u);
    legSide(P, 'f', [100, 146]); legSide(P, 'b', [100, 146]);
    const lean = 28 * u;
    P.aim('torso', lean).aim('head', lean * 0.4);
    for (const s of ['f', 'b']) armAngles(P, s, lean - 30, lean - 155); // one dumbbell held at the chest
    return P;
  },
  contacts: feetSide.map(p => ({ fixed: p })),
});

move('DAY_VAI_TA_TAY', 'Đẩy vai với tạ tay', {
  rig: 'front', prop: ['mat', 'dumbbell'], durationToken: 'repCycle', poster: 0.45,
  pose: t => {
    const u = rep(t, 0.4, 0.5), P = front().hip(100, 92.5);
    legFront(P, 'r', [92, 146]); legFront(P, 'l', [108, 146]);
    // from weights at shoulder level (shoulder 68) to arms nearly straight overhead
    armAngles(P, 'r', lerp(68, 162, u), lerp(180, 188, u));
    return armAngles(P, 'l', lerp(-68, -162, u), lerp(-180, -188, u));
  },
  contacts: feetFront.map(p => ({ fixed: p })),
});

const ROW_HIP = [77, 92.25];
move('CHEO_TA_TAY', 'Chèo tạ tay', {
  rig: 'side', prop: ['sofa', 'dumbbell-f'], durationToken: 'repCycle', poster: 0.45,
  pose: t => {
    const u = rep(t, 0.4, 0.5), P = side().hip(...ROW_HIP).aim('torso', 84.2).aim('head', 70);
    legAngles(P, 'b', 0, 90, 140); // far knee and shin on the seat
    legSide(P, 'f', [74, 146]);
    armSide(P, 'b', [114.8, 122.4]);
    return armAngles(P, 'f', 100 * u, -5 * u); // elbow drives back along the body
  },
  contacts: [{ fixed: SP.knee('b') }, { fixed: SP.hand('b') }, { fixed: SP.heel('f') }, { fixed: SP.toe('f') }],
});

move('GAP_HONG_TA_TAY', 'Gập hông với tạ tay', {
  rig: 'side', prop: ['mat', 'dumbbell'], durationToken: 'repCycle', poster: 0.47,
  pose: t => {
    const u = rep(t, 0.45, 0.5), P = side().hip(lerp(99, 86, u), lerp(93, 95, u));
    legSide(P, 'f', [100, 146]); legSide(P, 'b', [100, 146]);
    const lean = 60 * u; // hinge at the hips, knees stay soft, weights to knee height
    P.aim('torso', lean).aim('head', lean * 0.95);
    for (const s of ['f', 'b']) armAngles(P, s, 0, 0);
    return P;
  },
  contacts: feetSide.map(p => ({ fixed: p })),
});

move('CUON_TAY_TA', 'Cuộn tạ tay trước', {
  rig: 'side', prop: ['mat', 'dumbbell'], durationToken: 'repCycle', poster: 0.3,
  pose: t => {
    const u = rep(t, 0.35, 0.42, 0.95), P = side();
    legSide(P, 'f', [100, 146]); legSide(P, 'b', [100, 146]);
    for (const s of ['f', 'b']) armAngles(P, s, 4 - 6 * u, 4 - 6 * u - lerp(8, 135, u)); // elbow flexion to 135 (normal 145)
    return P;
  },
  contacts: feetSide.map(p => ({ fixed: p })),
});

const BAND_END = ['prop-band', [100, 98]];
move('KEO_DAY_NGANG', 'Kéo dây kháng lực', {
  rig: 'side', prop: ['chair', 'wall', 'anchor', 'band'], durationToken: 'repCycle', poster: 0.42,
  pose: t => {
    const u = rep(t, 0.35, 0.5), P = seatedSide(side()).aim('torso', -3 * u).aim('head', 0);
    const hand = mix([122, 96], [104, 104], u);
    armSide(P, 'f', hand); armSide(P, 'b', hand);
    const v = [hand[0] - 148, hand[1] - 98];
    return P.set('prop-band', { tx: 0, ty: 0, rot: norm(deg(Math.atan2(v[1], v[0])) - 180), sx: Math.hypot(...v) / 48 });
  },
  contacts: [...feetSide.map(p => ({ fixed: p })), { attach: [SP.hand('f'), BAND_END] }, { fixed: SP.hip }],
});

const BAND = { r: ['thigh-r', [94, 112]], l: ['thigh-l', [106, 112]] };
move('BUOC_NGANG_DAY', 'Bước ngang với dây kháng lực', {
  rig: 'front', prop: ['mat', 'miniband'], durationToken: 'repCycle', poster: 0.15,
  pose: t => {
    const q = Math.min(3, Math.floor(t * 4)), e = ease(t * 4 - q), lift = 4 * bump(t * 4 - q);
    // left out, right follows, right out, left follows: the figure goes 14 px and back
    const L = [[lerp(106, 120, e), 146 - lift], [120, 146], [120, 146], [lerp(120, 106, e), 146 - lift]][q];
    const Rr = [[94, 146], [lerp(94, 104, e), 146 - lift], [lerp(104, 94, e), 146 - lift], [94, 146]][q]; // follow foot stops short: band stays taut
    const P = front().hip((L[0] + Rr[0]) / 2, 95); // quarter squat held: knees bent toward the viewer
    legFront(P, 'r', Rr); legFront(P, 'l', L);
    armAngles(P, 'r', 12, -10); armAngles(P, 'l', -12, 10);
    const A = P.pt(...BAND.r), B = P.pt(...BAND.l);
    return P.set('prop-miniband', { tx: A[0] - 94, ty: A[1] - 112, rot: deg(Math.atan2(B[1] - A[1], B[0] - A[0])), sx: dist(A, B) / 12 });
  },
  contacts: [
    ...[FP.heel('l'), FP.toe('l')].map(p => ({ fixed: p, during: [0.25, 0.75] })),
    ...[FP.heel('r'), FP.toe('r')].flatMap(p => [{ fixed: p, during: [0, 0.25] }, { fixed: p, during: [0.75, 1] }]),
    { attach: [['prop-miniband', [94, 112]], BAND.r] }, { attach: [['prop-miniband', [106, 112]], BAND.l] },
  ],
});

// marching family: leg f lifts in the first half, leg b in the second; the stance foot stays put
function march(t, leg, arms) {
  const P = side(), l = { f: t < 0.5 ? bump(2 * t) : 0, b: t >= 0.5 ? bump(2 * t - 1) : 0 };
  for (const s of ['f', 'b']) legAngles(P, s, ...leg(l[s]));
  for (const s of ['f', 'b']) armAngles(P, s, ...arms(l[s], l[s === 'f' ? 'b' : 'f']));
  return P;
}
const marchContacts = ['heel', 'toe'].flatMap(k => [{ fixed: SP[k]('f'), during: [0.5, 1] }, { fixed: SP[k]('b'), during: [0, 0.5] }]);

move('DI_TAI_CHO', 'Đi bộ tại chỗ', {
  rig: 'side', prop: ['mat'], durationToken: 'stepCycle', poster: 0.25,
  pose: t => march(t, l => [-45 * l, 25 * l, 35 * l], (own, other) => [18 * own - 22 * other, 18 * own - 22 * other - 45]),
  contacts: marchContacts,
});

move('NANG_GOI', 'Nâng đầu gối', {
  rig: 'side', prop: ['mat'], durationToken: 'stepCycle', poster: 0.25,
  pose: t => march(t, l => [-85 * l, 5 * l, 20 * l], (own, other) => [12 * own - 30 * other, 12 * own - 30 * other - 90]),
  contacts: marchContacts,
});

move('GOT_CHAM_MONG', 'Gót chạm mông', {
  rig: 'side', prop: ['mat'], durationToken: 'stepCycle', poster: 0.25,
  pose: t => march(t, l => [6 * l, 126 * l, 156 * l * l], (own, other) => [10 * other - 10 * own, 10 * other - 10 * own - 45]),
  contacts: marchContacts,
});

move('DANG_TAY_BUOC_NGANG', 'Dang tay bước ngang', {
  rig: 'front', prop: ['mat'], durationToken: 'demoLoop', poster: 0.21,
  pose: t => {
    const q = Math.min(3, Math.floor(t * 4)), p = t * 4 - q, lift = 4 * bump(p);
    const outR = [ease(p), 1 - ease(p), 0, 0][q], outL = [0, 0, ease(p), 1 - ease(p)][q];
    const P = front().hip(100 - 5 * outR + 5 * outL, 92.5 + 3 * (outR + outL));
    legFront(P, 'r', [95 - 20 * outR, 146 - (q < 2 ? lift : 0)]); legFront(P, 'l', [105 + 20 * outL, 146 - (q >= 2 ? lift : 0)]);
    const up = outR + outL; // both arms sweep overhead: abduction to 168 deg
    armAngles(P, 'r', lerp(6, 168, up), lerp(3, 172, up));
    return armAngles(P, 'l', lerp(-6, -168, up), lerp(-3, -172, up));
  },
  contacts: [...[FP.heel('l'), FP.toe('l')].map(p => ({ fixed: p, during: [0, 0.5] })), ...[FP.heel('r'), FP.toe('r')].map(p => ({ fixed: p, during: [0.5, 1] }))],
});

move('DI_BO_NHANH', 'Đi bộ nhanh', {
  rig: 'side', prop: ['mat'], durationToken: 'stepBrisk', poster: 0.02,
  pose: t => gait(side(), t, { stance: 0.6, reach: 18, lift: 6, arm: 32, elbow: -80, lean: 3 }),
  contacts: gaitFloor(0.6),
});

move('CHAY_BO_NHE', 'Chạy bộ nhẹ', {
  rig: 'side', prop: ['mat'], durationToken: 'stepRun', poster: 0.3,
  pose: t => gait(side(), t, { stance: 0.38, reach: 13, lift: 16, arm: 35, elbow: -95, lean: 7, bounce: 4 }),
  contacts: gaitFloor(0.38),
});

move('NHUN_NHE', 'Nhún nhẹ tại chỗ', {
  rig: 'side', prop: ['mat'], durationToken: 'stepBrisk', poster: 0.25,
  pose: t => {
    const u = wave(2 * t), phi = 12 * u, k = 16 * (1 - u) + 4; // heels just leave the floor, knees soft
    const ankle = add([109, 150], rot([-9, -4], phi));
    const P = side().hip(ankle[0] - 4 * Math.sin(rad(k / 2)), ankle[1] - 54 * Math.cos(rad(k / 2))).aim('torso', 2);
    for (const s of ['f', 'b']) legAngles(P, s, -k / 2, k / 2, phi);
    relaxedSide(P, 2 * u);
    return P;
  },
  contacts: ['f', 'b'].map(s => ({ fixed: SP.toe(s) })),
});

const BENCH = [168, 106.4];
move('LEO_NUI_TUA_BAN', 'Leo núi tựa bàn', {
  rig: 'side', prop: ['bench'], durationToken: 'demoLoop', poster: 0.25,
  pose: t => {
    const ankle = add([110, 150], rot([-9, -4], 30)), a = 40; // on the toes, body one line at 40 deg
    const hip = add(ankle, [53.9 * Math.sin(rad(a)), -53.9 * Math.cos(rad(a))]);
    const P = side().hip(...hip).aim('torso', a).aim('head', a - 15);
    const swing = t < 0.5 ? 'f' : 'b', l = bump(t < 0.5 ? 2 * t : 2 * t - 1);
    legSide(P, swing === 'f' ? 'b' : 'f', ankle, 30);
    legSide(P, swing, add(mix(ankle, [hip[0] + 4, 127], l), [0, -6 * bump(l)])); // knee drives toward the chest
    P.aim(`foot-${swing}`, lerp(30, P.angle(`shin-${swing}`) + 20, l * l));
    const sh = P.pivot('arm-f'), hand = [sh[0] + Math.sqrt(36.42 ** 2 - (BENCH[1] - sh[1]) ** 2), BENCH[1]]; // straight arms onto the bench
    armSide(P, 'f', hand); return armSide(P, 'b', hand);
  },
  contacts: [...['f', 'b'].map(s => ({ fixed: SP.hand(s) })), { fixed: SP.toe('f'), during: [0.5, 1] }, { fixed: SP.toe('b'), during: [0, 0.5] }],
  straight: ['f', 'b'],
});

move('DI_BO_CHAM', 'Đi bộ chậm', {
  rig: 'side', prop: ['mat'], durationToken: 'stepSlow', poster: 0.02,
  pose: t => gait(side(), t, { stance: 0.62, reach: 14, lift: 5, arm: 14, elbow: -12, lean: 0 }),
  contacts: gaitFloor(0.62),
});

// breathing: seated, the belly fills on the in-breath; `level` 0..1 follows the phases
const BELLY_HAND = ['belly', [113.5, 71]]; // mid-abdomen
function seatedBreath(level, handOnBelly) {
  const P = seatedSide(side()).aim('torso', -1.5 * level).aim('head', 0).set('belly', { sx: 1 + level, sy: 1 + 0.12 * level }); // belly fills forward on the in-breath
  armSide(P, 'b', [108, 112]);
  return armSide(P, 'f', handOnBelly ? P.pt(...BELLY_HAND) : [108, 112]);
}
const breathContacts = onBelly => [...feetSide.map(p => ({ fixed: p })), { fixed: SP.hip }, { fixed: SP.hand('b') }, onBelly ? { attach: [SP.hand('f'), BELLY_HAND] } : { fixed: SP.hand('f') }];
const RM_BREATH = 'Nhân vật ngồi yên; chữ hướng dẫn nhịp thở đổi theo từng pha, kèm 3 bước hướng dẫn bằng chữ.';

move('THO_BUNG', 'Thở bụng', {
  rig: 'side', prop: ['chair'], durationToken: 'breathLong', poster: 0.5, demo: 'breath', reducedMotion: RM_BREATH, onBelly: true,
  breath: [{ label: 'Hít vào', ms: 5000, to: 1 }, { label: 'Thở ra', ms: 5000, to: 0 }],
});
move('THO_RA_DAI', 'Thở ra dài', {
  rig: 'side', prop: ['chair'], durationToken: 'breathLong', poster: 0.4, demo: 'breath', reducedMotion: RM_BREATH,
  breath: [{ label: 'Hít vào', ms: 4000, to: 1 }, { label: 'Thở ra', ms: 6000, to: 0 }],
});
move('THO_VUONG', 'Thở vuông', {
  rig: 'side', prop: ['chair'], durationToken: 'boxBreath', poster: 0.375, demo: 'breath', reducedMotion: RM_BREATH,
  breath: [{ label: 'Hít vào', ms: 4000, to: 1 }, { label: 'Giữ', ms: 4000, to: 1 }, { label: 'Thở ra', ms: 4000, to: 0 }, { label: 'Nghỉ', ms: 4000, to: 0 }],
});
const SCAN = [['Thả lỏng trán', 'head'], ['Thả lỏng vai', 'shoulder-f'], ['Thả lỏng tay', 'forearm-f'], ['Thả lỏng bụng', 'belly'], ['Thả lỏng chân', 'thigh-f']];
move('QUET_CO_THE', 'Thả lỏng từng vùng', {
  rig: 'side', prop: ['chair'], durationToken: 'bodyScan', poster: 0.1, demo: 'breath',
  reducedMotion: 'Nhân vật ngồi yên; tên từng vùng cơ thể hiện lần lượt bằng chữ, kèm 3 bước hướng dẫn bằng chữ.',
  pattern: SCAN.map(([label]) => ({ label, ms: 4000 })),
  highlight: SCAN.map(([, region]) => ({ region, ms: 4000 })),
  // one slow breath per region: in 1.6 s, out 2.4 s
  breath: SCAN.flatMap(() => [{ ms: 1600, to: 1 }, { ms: 2400, to: 0 }]),
});

// ---------------------------------------------------------------- sampling, formatting, replay checks
const f1 = x => { const r = Math.round(x * 10) / 10; return Object.is(r, -0) ? 0 : r; };
const f3 = x => { const r = Math.round(x * 1000) / 1000; return Object.is(r, -0) ? 0 : r; };
const TRANSLATED = new Set(['hips', 'face', 'prop-band', 'prop-miniband']);
function formatValue(p, withS) {
  const parts = [];
  if (p.withT) parts.push(`translate(${f1(p.tx ?? 0)}px, ${f1(p.ty ?? 0)}px)`);
  parts.push(`rotate(${f1(p.rot ?? 0)}deg)`);
  if (withS) parts.push(`scale(${f3(p.sx ?? 1)}, ${f3(p.sy ?? 1)})`);
  return parts.join(' ');
}
const num = (s, re, d) => { const m = s.match(re); return m ? m.slice(1).map(Number) : d; };
function parseValue(s) {
  const [tx, ty] = num(s, /translate\(([-\d.]+)px, ([-\d.]+)px\)/, [0, 0]);
  const [r] = num(s, /rotate\(([-\d.]+)deg\)/, [0]);
  const [sx, sy] = num(s, /scale\(([-\d.]+), ([-\d.]+)\)/, [1, 1]);
  return { tx, ty, rot: r, sx, sy };
}

const breathLevel = (segs, t) => {
  const total = segs.reduce((n, s) => n + s.ms, 0);
  let at = 0, from = segs.at(-1).to;
  for (const s of segs) {
    if (t * total <= at + s.ms) return lerp(from, s.to, ease((t * total - at) / s.ms));
    at += s.ms; from = s.to;
  }
  return segs.at(-1).to;
};

function times(m, n) {
  if (!m.breath) return Array.from({ length: n }, (_, i) => i / (n - 1));
  const total = m.breath.reduce((s, b) => s + b.ms, 0), out = [];
  let at = 0;
  for (const b of m.breath) { for (let j = 0; j < 4; j++) out.push((at + (b.ms * j) / 4) / total); at += b.ms; }
  return [...out, 1];
}

function sample(m, n) {
  const ts = times(m, n);
  const poseAt = m.breath ? t => seatedBreath(breathLevel(m.breath, t), m.onBelly) : m.pose;
  const poses = ts.map(t => poseAt(t >= 1 ? 0 : t)); // the last key is the first pose again: the loop closes
  const ids = [...new Set(poses.flatMap(p => Object.keys(p.v)))].filter(id => id !== 'rig').sort((a, b) => order(m.rig, a) - order(m.rig, b));
  const tracks = ids.map(id => {
    const vals = poses.map(p => ({ ...p.get(id) }));
    // keep rotations continuous so the browser never spins the long way round
    for (let i = 1; i < vals.length; i++) vals[i].rot = (vals[i - 1].rot ?? 0) + norm((vals[i].rot ?? 0) - (vals[i - 1].rot ?? 0));
    const withT = TRANSLATED.has(id) || vals.some(v => (v.tx ?? 0) !== 0 || (v.ty ?? 0) !== 0), withS = vals.some(v => (v.sx ?? 1) !== 1 || (v.sy ?? 1) !== 1);
    const frames = vals.map((v, i) => ({ transform: formatValue({ ...v, withT }, withS), ...(m.breath ? { offset: f3(ts[i]) } : {}) }));
    if (m.breath) { frames[0].offset = 0; frames.at(-1).offset = 1; }
    if (frames.at(-1).transform !== frames[0].transform) throw new Error(`${m.id} ${id}: loop does not close (${frames[0].transform} vs ${frames.at(-1).transform})`);
    return { target: `#${id}`, keyframes: frames, easingToken: 'linear' };
  });
  return { tracks, ts };
}
const order = (rig, id) => Object.keys(RIGS[rig].joints).indexOf(id);

// replay: rebuild poses from the written keyframes, linear between keys (what WAAPI and Reanimated do)
function replay(m, tracks, t) {
  const P = new Pose(RIGS[m.rig]);
  for (const tr of tracks) {
    const k = tr.keyframes, off = i => k[i].offset ?? i / (k.length - 1);
    let i = 0;
    while (i < k.length - 2 && off(i + 1) <= t) i++;
    const u = clamp01((t - off(i)) / (off(i + 1) - off(i)));
    const a = parseValue(k[i].transform), b = parseValue(k[i + 1].transform);
    P.set(tr.target.slice(1), Object.fromEntries(Object.keys(a).map(key => [key, lerp(a[key], b[key], u)])));
  }
  return P;
}

const RANGES = {
  side: { knee: [-3, 150], ankle: [-40, 50], shoulder: [-180, 60], elbow: [-150, 3], wrist: [-75, 75], neck: [-45, 50], hip: [-150, 30] }, // hip = thigh vs trunk; the rig trunk is one segment, so it carries spine flexion too
  front: { knee: [-3, 3], ankle: [-25, 25], elbow: [-160, 160], wrist: [-75, 75], neck: [-45, 45], trunk: [-30, 30], 'shoulder-r': [-70, 180], 'shoulder-l': [-180, 70], 'hip-r': [-25, 50], 'hip-l': [-50, 25] },
};
function checkRanges(m, P, where) {
  const g = id => P.get(id), errs = [];
  const within = (name, v, r = RANGES[m.rig][name]) => { if (r && (v < r[0] - 0.05 || v > r[1] + 0.05)) errs.push(`${m.id} ${where}: ${name} ${v.toFixed(1)} outside [${r}]`); };
  if ((g('hips').rot ?? 0) !== 0) errs.push(`${m.id}: hips must not rotate`);
  for (const s of m.rig === 'side' ? ['f', 'b'] : ['r', 'l']) {
    within('knee', g(`shin-${s}`).rot ?? 0); within('ankle', g(`foot-${s}`).rot ?? 0);
    within('elbow', g(`forearm-${s}`).rot ?? 0); within('wrist', g(`hand-${s}`).rot ?? 0);
    if (m.rig === 'side') { within('shoulder', g(`arm-${s}`).rot ?? 0); within('hip', (g(`thigh-${s}`).rot ?? 0) - (g('torso').rot ?? 0)); }
    else { within(`shoulder-${s}`, g(`arm-${s}`).rot ?? 0); within(`hip-${s}`, g(`thigh-${s}`).rot ?? 0); }
    const leg = (g(`thigh-${s}`).sy ?? 1) * (g(`shin-${s}`).sy ?? 1);
    if (leg < 0.85 - 1e-6 || leg > 1.0001) errs.push(`${m.id} ${where}: leg ${s} drawn at ${leg.toFixed(3)} of its length`);
  }
  within('neck', g('head').rot ?? 0);
  if (m.rig === 'front') { within('trunk', g('torso').rot ?? 0); const sx = g('torso').sx ?? 1; if (sx < 0.7 - 1e-6 || sx > 1) errs.push(`${m.id}: torso width ${sx}`); }
  for (const id of ['arm-f', 'arm-b']) { const sy = g(id).sy ?? 1; if (sy < 0.8 || sy > 1.23 + 1e-6) errs.push(`${m.id}: ${id} drawn at ${sy}`); }
  return errs;
}

const inWindow = (t, [a, b]) => t >= a - 1e-9 && t <= b + 1e-9;
function verify(m, tracks, ts) {
  const errs = [], feet = m.rig === 'side' ? feetSide : feetFront;
  const samples = [];
  for (let i = 0; i < ts.length - 1; i++) for (let j = 0; j < 8; j++) samples.push(lerp(ts[i], ts[i + 1], j / 8));
  samples.push(1);
  const poses = samples.map(t => [t, replay(m, tracks, t)]);
  // ranges on every interpolated sample, not only the keys: scales multiply between keys
  for (const [t, P] of poses) errs.push(...checkRanges(m, P, `t ${t.toFixed(3)}`));
  // supporting arms the steps want straight (hands planted on the floor or a bench): elbow <= 10 deg
  for (const s of m.straight ?? []) for (const [t, P] of poses) { const e = Math.abs(P.get(`forearm-${s}`).rot ?? 0); if (e > 10) errs.push(`${m.id}: support arm ${s} elbow bent ${e.toFixed(1)} deg at t ${t.toFixed(3)}`); }
  let worst = 0;
  const drift = (d, what) => { worst = Math.max(worst, d); if (d > DRIFT) errs.push(`${m.id}: ${what} drifts ${d.toFixed(2)} px`); };
  for (const c of m.contacts ?? breathContactsOf(m)) {
    const during = c.during ?? [0, 1];
    const in_ = poses.filter(([t]) => inWindow(t, during));
    if (c.fixed) {
      const ref = in_[0][1].pt(...c.fixed);
      drift(Math.max(...in_.map(([, P]) => dist(P.pt(...c.fixed), ref))), `${c.fixed[0]} ${c.fixed[1]}`);
    } else if (c.at) drift(Math.max(...in_.map(([, P]) => dist(P.pt(...c.pt), c.at))), `${c.pt[0]} on its prop`);
    else if (c.attach) drift(Math.max(...in_.map(([, P]) => dist(P.pt(...c.attach[0]), P.pt(...c.attach[1])))), `${c.attach[0][0]} to ${c.attach[1][0]}`);
    else if (c.floor) drift(Math.max(...in_.map(([, P]) => Math.abs(P.pt(...c.floor)[1] - FLOOR))), `${c.floor[0]} on the floor`);
  }
  for (const [t, P] of poses) for (const f of feet) { const y = P.pt(...f)[1]; if (y > FLOOR + DRIFT) errs.push(`${m.id}: ${f[0]} sinks to y ${y.toFixed(2)} at t ${t.toFixed(3)}`); }
  return { errs, worst };
}
const breathContactsOf = m => breathContacts(m.onBelly);

// ---------------------------------------------------------------- catalog entries
function entry(m) {
  for (const n of [13, 17, 25, 33, 49]) {
    const { tracks, ts } = sample(m, n);
    const { errs, worst } = verify(m, tracks, ts);
    const rangeErrs = errs.filter(e => !e.includes('drifts'));
    if (rangeErrs.length) throw new Error(rangeErrs.slice(0, 8).join('\n'));
    if (errs.length && !m.breath && n < 49) continue;
    if (errs.length) throw new Error(errs.slice(0, 8).join('\n'));
    const pattern = m.pattern ?? m.breath?.reduce((out, b) => (b.label ? [...out, { label: b.label, ms: b.ms }] : out), []);
    return {
      stats: { keys: ts.length, worst },
      entry: {
        id: m.id, tier: 1, kind: 'exercise', screens: ['S18', 'S19', 'S82'], trigger: 'visible:exercise-demo',
        durationToken: m.durationToken, easingToken: 'linear', loop: true, demo: m.demo ?? 'rig', rig: m.rig, prop: m.prop, poster: m.poster,
        ...(pattern ? { pattern } : {}), ...(m.highlight ? { highlight: m.highlight } : {}),
        reducedMotion: m.reducedMotion ?? RM, tracks,
      },
    };
  }
}

// the six rigged in Task 8A keep their keyframes; they get the shared fields (poster = their PNG's moment)
const ORIGINAL = { 'exercise-xoay-vai': 0.3, 'exercise-squat': 0.5, 'exercise-chong-day-tua-ban': 0.5, 'exercise-chung-chan-lui': 0.5, 'exercise-plank-tua-goi': 0.5, 'exercise-tha-long-vai': 0.28 };
const FIELDS = ['id', 'tier', 'kind', 'screens', 'trigger', 'durationToken', 'easingToken', 'loop', 'demo', 'rig', 'prop', 'poster', 'pattern', 'highlight', 'reducedMotion', 'tracks'];
const reorder = e => Object.fromEntries(FIELDS.filter(k => k in e).map(k => [k, e[k]]));

export const MOVES = M;
export function build() {
  const catalog = JSON.parse(read(CATALOG));
  const made = M.map(m => { try { return { code: m.code, ...entry(m) }; } catch (e) { e.message = `${m.code}: ${e.message}`; throw e; } });
  const mine = new Set(made.map(x => x.entry.id));
  const kept = catalog.filter(a => !mine.has(a.id)).map(a => (a.id in ORIGINAL ? reorder({ ...a, rig: 'side', prop: [a.prop].flat(), poster: ORIGINAL[a.id] }) : a));
  const at = kept.findIndex(a => a.id === 'exercise-tha-long-vai') + 1;
  kept.splice(at, 0, ...made.map(x => x.entry));
  return { text: JSON.stringify(kept, null, 2) + '\n', made };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { text, made } = build();
  for (const x of made) console.log(`${x.entry.id.padEnd(46)} ${x.code.padEnd(20)} ${x.entry.rig.padEnd(5)} ${x.entry.durationToken.padEnd(13)} keys ${String(x.stats.keys).padStart(2)}  worst contact ${x.stats.worst.toFixed(2)} px`);
  if (process.argv.includes('--check')) {
    if (read(CATALOG).replace(/\r\n/g, '\n') !== text) { console.error('FAIL: catalog.json differs from the generated entries: run node design/motion/rig-keyframes.mjs'); process.exit(1); }
    console.log(`OK: ${made.length} generated entries match catalog.json; all asserts pass`);
  } else {
    writeFileSync(join(R, CATALOG), text);
    console.log(`wrote ${made.length} entries to ${CATALOG}; all asserts pass`);
  }
}
