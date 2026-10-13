import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { findBannedTerms, normalizeVi } from '../../domain/language.ts';
import type {
  Archetype,
  Modality,
  SpaceRequirement,
} from '../../domain/types.ts';
import { MOVES, WORKOUTS } from './exercises.ts';
import type { Equipment } from './types.ts';

type Workout = (typeof WORKOUTS)[number];

const DURATIONS = [300, 900, 1800, 2700];
const SPACES: SpaceRequirement[] = ['DESK_SIDE', 'ROOM', 'GYM', 'OUTDOOR'];
const MODALITIES: Modality[] = [
  'RESISTANCE',
  'CARDIO',
  'HIIT',
  'MOBILITY',
  'BREATHING',
];
const ARCHETYPES: Archetype[] = ['TANKER', 'ASSASSIN', 'SUPPORTER'];
const EQUIPMENT = ['tham', 'ta-tay', 'day-khang-luc'] satisfies Equipment[];
const MET_RANGE: Record<Modality, [number, number]> = {
  BREATHING: [1.0, 1.5],
  MOBILITY: [2.0, 3.0],
  RESISTANCE: [3.0, 6.0],
  CARDIO: [4.0, 8.0],
  HIIT: [6.0, 10.0],
};
const PREFERRED: Record<Modality, Archetype> = {
  RESISTANCE: 'TANKER',
  CARDIO: 'ASSASSIN',
  HIIT: 'ASSASSIN',
  MOBILITY: 'SUPPORTER',
  BREATHING: 'SUPPORTER',
};
// The only moves that have a rigged demo (PLAN Task 21); every other move has none.
const DEMO: Record<string, string> = {
  XOAY_VAI: 'exercise-xoay-vai',
  SQUAT_TAY_TRUOC_NGUC: 'exercise-squat',
  CHONG_DAY_TUA_BAN: 'exercise-chong-day-tua-ban',
  CHUNG_CHAN_LUI: 'exercise-chung-chan-lui',
  PLANK_TUA_GOI: 'exercise-plank-tua-goi',
  THA_LONG_VAI: 'exercise-tha-long-vai',
  THO_4_4: 'focus-breathe',
};
const CODE = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;
const unique = (values: string[]) => new Set(values).size === values.length;
const phaseSeconds = (w: Workout, phase: string) =>
  w.steps.filter(s => s.phase === phase).reduce((n, s) => n + s.seconds, 0);
const count = <T>(items: T[], pick: (item: T) => boolean) =>
  items.filter(pick).length;
const noEquipment = (w: Workout) => w.equipment.length === 0;

test('at least 20 moves and 30 workouts', () => {
  assert.ok(MOVES.length >= 20, `${MOVES.length} moves`);
  assert.ok(WORKOUTS.length >= 30, `${WORKOUTS.length} workouts`);
});

test('codes are unique UPPER_SNAKE ASCII; names are unique', () => {
  for (const list of [MOVES, WORKOUTS]) {
    assert.ok(unique(list.map(x => x.code)));
    assert.ok(unique(list.map(x => x.name)));
    for (const x of list) assert.match(x.code, CODE);
  }
});

test('every move has a name, exactly 3 short steps and one caution that says when to stop or ease off', () => {
  for (const m of MOVES) {
    assert.ok(m.name.trim().length > 0, m.code);
    assert.equal(m.steps.length, 3, m.code);
    for (const s of m.steps)
      assert.ok(s.trim().length > 0 && s.length <= 100, `${m.code}: ${s}`);
    assert.ok(m.caution.length <= 130, `${m.code}: caution is ${m.caution.length} characters`);
    assert.match(
      m.caution.toLowerCase(),
      /dừng|nghỉ|giảm|chậm lại|chuyển sang đi bộ|quay về thở/,
      `${m.code}: caution`,
    );
  }
});

test('demoCode: exactly the seven rigged moves carry one, each its own', () => {
  for (const m of MOVES) assert.equal(m.demoCode, DEMO[m.code] ?? null, m.code);
  for (const code of Object.keys(DEMO))
    assert.ok(
      MOVES.some(m => m.code === code),
      `${code} missing`,
    );
  const used = MOVES.map(m => m.demoCode).filter(d => d !== null);
  assert.deepEqual([...used].sort(), Object.values(DEMO).sort());
});

test('every moveCode resolves, and every move is used by some workout', () => {
  const codes = new Set(MOVES.map(m => m.code));
  const used = new Set<string>();
  for (const w of WORKOUTS)
    for (const s of w.steps) {
      assert.ok(codes.has(s.moveCode), `${w.code}: unknown move ${s.moveCode}`);
      used.add(s.moveCode);
    }
  assert.deepEqual(
    [...codes].filter(c => !used.has(c)),
    [],
  );
});

test('timing: WARMUP + sets x MAIN + COOLDOWN = durationSec; each phase present, in order; steps at least 20 s', () => {
  const order = { WARMUP: 0, MAIN: 1, COOLDOWN: 2 };
  for (const w of WORKOUTS) {
    assert.ok(DURATIONS.includes(w.durationSec), `${w.code}: ${w.durationSec}`);
    assert.ok(Number.isInteger(w.sets) && w.sets >= 1, `${w.code}: sets`);
    for (const phase of ['WARMUP', 'MAIN', 'COOLDOWN'])
      assert.ok(
        w.steps.some(s => s.phase === phase),
        `${w.code}: no ${phase}`,
      );
    const phases = w.steps.map(s => order[s.phase]);
    assert.deepEqual(
      phases,
      [...phases].sort((a, b) => a - b),
      `${w.code}: phases out of order`,
    );
    for (const s of w.steps) {
      assert.ok(
        Number.isInteger(s.seconds) && s.seconds >= 20,
        `${w.code}: ${s.moveCode} ${s.seconds} s`,
      );
      assert.ok(s.repsText.trim().length > 0, `${w.code}: ${s.moveCode} repsText`);
    }
    const total =
      phaseSeconds(w, 'WARMUP') +
      w.sets * phaseSeconds(w, 'MAIN') +
      phaseSeconds(w, 'COOLDOWN');
    assert.equal(total, w.durationSec, `${w.code}: steps add up to ${total}`);
  }
});

test('metValue stays inside the range of its modality', () => {
  for (const w of WORKOUTS) {
    const [lo, hi] = MET_RANGE[w.modality];
    assert.ok(
      w.metValue >= lo && w.metValue <= hi,
      `${w.code}: ${w.modality} ${w.metValue}`,
    );
  }
});

test('archetypes: the preferred one for the modality, and nothing else', () => {
  for (const w of WORKOUTS)
    assert.deepEqual(w.archetypes, [PREFERRED[w.modality]], w.code);
});

test('equipment values are members of Equipment, without repeats; no equipment is an empty array', () => {
  for (const w of WORKOUTS) {
    assert.ok(Array.isArray(w.equipment), w.code);
    for (const e of w.equipment)
      assert.ok((EQUIPMENT as string[]).includes(e), `${w.code}: ${e}`);
    assert.equal(new Set(w.equipment).size, w.equipment.length, w.code);
  }
});

test('distribution: durations, modalities, spaces, archetypes, no-equipment', () => {
  const table: Record<string, Record<string, string>> = {};
  for (const d of DURATIONS) {
    table[`${d} s`] = {};
    for (const space of SPACES) {
      const here = WORKOUTS.filter(
        w => w.durationSec === d && w.spaceNeeded === space,
      );
      table[`${d} s`][space] =
        `${here.length} (${count(here, noEquipment)} no equipment)`;
    }
  }
  const modalityCounts = Object.fromEntries(
    MODALITIES.map(m => [m, count(WORKOUTS, w => w.modality === m)]),
  );
  const archetypeCounts = Object.fromEntries(
    ARCHETYPES.map(a => [a, count(WORKOUTS, w => w.archetypes.includes(a))]),
  );
  console.log('workouts per duration x space (of which no equipment)');
  console.table(table);
  console.log('modality counts', modalityCounts);
  console.log('preferred-archetype counts', archetypeCounts);
  console.log(
    'no equipment',
    count(WORKOUTS, noEquipment),
    'of',
    WORKOUTS.length,
  );

  for (const d of DURATIONS)
    assert.ok(count(WORKOUTS, w => w.durationSec === d) >= 5, `duration ${d}`);
  for (const m of MODALITIES)
    assert.ok(modalityCounts[m] >= 4, `modality ${m}`);
  for (const s of SPACES)
    assert.ok(count(WORKOUTS, w => w.spaceNeeded === s) >= 4, `space ${s}`);
  for (const a of ARCHETYPES)
    assert.ok(archetypeCounts[a] >= 8, `archetype ${a}`);
  assert.ok(count(WORKOUTS, noEquipment) >= 18, 'no-equipment workouts');
  for (const d of DURATIONS)
    for (const s of ['DESK_SIDE', 'ROOM'])
      assert.ok(
        WORKOUTS.some(
          w => w.durationSec === d && w.spaceNeeded === s && noEquipment(w),
        ),
        `no no-equipment workout for ${d} s in ${s}`,
      );
});

test('the starter workouts are those of the plan (Task 21), with the frame S18 steps', () => {
  const by = (code: string) => WORKOUTS.find(w => w.code === code);
  const full = by('FULL_BODY_EASY');
  assert.ok(full);
  assert.deepEqual(
    [
      full.name,
      full.modality,
      full.durationSec,
      full.spaceNeeded,
      full.equipment,
      full.sets,
      full.archetypes,
    ],
    ['Toàn thân vừa sức', 'RESISTANCE', 900, 'ROOM', [], 3, ['TANKER']],
  );
  assert.deepEqual(
    full.steps.map(s => [s.moveCode, s.phase, s.repsText]),
    [
      ['XOAY_VAI', 'WARMUP', '30 giây'],
      ['SQUAT_TAY_TRUOC_NGUC', 'MAIN', '12 lần'],
      ['CHONG_DAY_TUA_BAN', 'MAIN', '10 lần'],
      ['CHUNG_CHAN_LUI', 'MAIN', '8 lần mỗi bên'],
      ['PLANK_TUA_GOI', 'MAIN', 'giữ 20 giây'],
      ['THA_LONG_VAI', 'COOLDOWN', '30 giây'],
    ],
  );
  for (const [code, name, modality] of [
    ['DESK_STRETCH', 'Giãn cơ bên bàn làm việc', 'MOBILITY'],
    ['BREATHE_RELAX', 'Thở và thả lỏng', 'BREATHING'],
  ]) {
    const w = by(code);
    assert.ok(w, code);
    assert.deepEqual(
      [w.name, w.modality, w.durationSec, w.spaceNeeded, w.archetypes],
      [name, modality, 300, 'DESK_SIDE', ['SUPPORTER']],
      code,
    );
  }
  assert.ok(by('BREATHE_RELAX')?.steps.some(s => s.moveCode === 'THO_4_4'));
});

const allText = [
  ...MOVES.flatMap(m => [m.name, ...m.steps, m.caution]),
  ...WORKOUTS.flatMap(w => [w.name, ...w.steps.map(s => s.repsText)]),
];

test('no banned term in any text', () => {
  for (const text of allText) assert.deepEqual(findBannedTerms(text), [], text);
});

const FORBIDDEN = [
  'co them',
  'co gang them',
  'chiu dau',
  'rang suc',
  'dau la tot',
  'giam can',
  'dot chay',
  'san chac',
  'chac chan',
  'dam bao',
  'cam ket',
  'hieu qua nhanh',
  'chua benh',
  'dieu tri',
  'vuot qua con dau',
];

test('wording: no exclamation mark, no pain-through language, no promised result', () => {
  for (const text of allText) {
    assert.ok(!/[!！]/.test(text), `"!" in: ${text}`);
    const plain = ` ${normalizeVi(text).replace(/[^a-z0-9]+/g, ' ')} `;
    for (const phrase of FORBIDDEN)
      assert.ok(!plain.includes(` ${phrase} `), `${phrase}: ${text}`);
  }
});

// ------------------------------------------------------------------ fix round 1
// Only the moves that REQUIRE an item; a mat is never required (floor moves offer "thảm hoặc khăn gấp").
const REQUIRES: Record<string, Equipment> = {
  SQUAT_TA_TAY: 'ta-tay',
  DAY_VAI_TA_TAY: 'ta-tay',
  CHEO_TA_TAY: 'ta-tay',
  GAP_HONG_TA_TAY: 'ta-tay',
  CUON_TAY_TA: 'ta-tay',
  KEO_DAY_NGANG: 'day-khang-luc',
  BUOC_NGANG_DAY: 'day-khang-luc',
};
// "tạ" (dumbbell) and "dây" (band) as whole words; normalised text would fold "đẩy" into "day".
const ITEM_WORD = /(?<![\p{L}])(tạ|dây)(?![\p{L}])/u;
const plainText = (text: string) =>
  ` ${normalizeVi(text).replace(/[^a-z0-9]+/g, ' ')} `;
const moveText = (m: (typeof MOVES)[number]) =>
  [m.name, ...m.steps, m.caution].join(' ');

test('equipment declared = equipment the moves require (a mat is optional, never declared)', () => {
  for (const m of MOVES)
    if (ITEM_WORD.test(moveText(m).toLowerCase().normalize('NFC')))
      assert.ok(m.code in REQUIRES, `${m.code} mentions an item but is not in REQUIRES`);
  for (const w of WORKOUTS) {
    const needed = [
      ...new Set(w.steps.map(s => REQUIRES[s.moveCode]).filter(Boolean)),
    ].sort();
    assert.deepEqual([...w.equipment].sort(), needed, w.code);
  }
  for (const m of MOVES)
    if (moveText(m).includes('thảm'))
      assert.ok(moveText(m).includes('khăn'), `${m.code}: mat without towel`);
  for (const code of ['MEO_BO', 'CAU_MONG', 'PLANK_TUA_GOI', 'TAY_CHAN_DOI_DIEN'])
    assert.ok(
      MOVES.find(m => m.code === code)?.steps.join(' ').includes('thảm hoặc khăn'),
      `${code}: floor move offers a mat or towel`,
    );
});

test('a DESK_SIDE workout needs no equipment; dumbbells or a band mean ROOM or GYM', () => {
  for (const w of WORKOUTS) {
    if (w.spaceNeeded === 'DESK_SIDE') assert.deepEqual(w.equipment, [], w.code);
    if (w.equipment.length > 0)
      assert.ok(['ROOM', 'GYM'].includes(w.spaceNeeded), w.code);
  }
});

// Seconds one breath (in + out) takes; a count in the text must fit the step.
const BREATH_SEC: Record<string, number> = { THO_4_4: 8, THO_RA_DAI: 10 };
const ROUND_SEC = 16; // one "vòng thở" of THO_VUONG: 4 + 4 + 4 + 4
const SLACK = 10; // a gap up to 10 s is switching sides or settling; a larger one must be explained

test('step text fits the step seconds, and says what fills the rest', () => {
  const problems: string[] = [];
  for (const w of WORKOUTS)
    for (const s of w.steps) {
      const at = `${w.code}: ${s.moveCode} "${s.repsText}" in ${s.seconds} s`;
      const t = s.repsText;
      let m: RegExpMatchArray | null;
      if ((m = t.match(/^(\d+) giây$/)) || (m = t.match(/^nghỉ (\d+) giây$/))) {
        if (+m[1] !== s.seconds) problems.push(at);
      } else if (
        (m = t.match(/^(\d+) giây, nghỉ (\d+) giây$/)) ||
        (m = t.match(/^nhanh (\d+) giây, nhẹ (\d+) giây$/))
      ) {
        if (+m[1] + +m[2] !== s.seconds) problems.push(at);
      } else if ((m = t.match(/^giữ (\d+) giây(, .+)?$/))) {
        const gap = s.seconds - +m[1];
        if (gap < 0 || (gap > SLACK && !/lặp lại/.test(t))) problems.push(at);
      } else if ((m = t.match(/^(\d+) giây mỗi bên$/))) {
        const need = 2 * +m[1] + 5; // 5 s to change sides
        if (need > s.seconds || s.seconds - need > SLACK) problems.push(at);
      } else if ((m = t.match(/^(\d+) nhịp thở$/))) {
        const need = +m[1] * (BREATH_SEC[s.moveCode] ?? 1e9);
        if (need > s.seconds || s.seconds - need > SLACK) problems.push(at);
      } else if ((m = t.match(/^(\d+) vòng thở$/))) {
        const need = +m[1] * ROUND_SEC;
        if (need > s.seconds || s.seconds - need > SLACK) problems.push(at);
      } else if (t.includes('giây')) problems.push(`${at} (unrecognised timed text)`);
    }
  assert.deepEqual(problems, []);
});

test('workout names: no digit or duration word, no outcome word, at most 28 characters, unique', () => {
  for (const w of WORKOUTS) {
    assert.ok(w.name.length <= 28, `${w.code}: "${w.name}" is ${w.name.length} characters`);
    assert.doesNotMatch(w.name, /\d|phút|tiếng|mười|mươi/i, `${w.code}: ${w.name}`);
    assert.doesNotMatch(w.name, /dẻo dai|khỏe|săn|thon|giảm|đốt|bền/i, `${w.code}: ${w.name}`);
  }
  assert.ok(unique(WORKOUTS.map(w => w.name)));
});

test('the header states the content is not reviewed by a professional (R-D10)', () => {
  const source = readFileSync(new URL('./exercises.ts', import.meta.url), 'utf8');
  assert.match(source, /NOT reviewed by a fitness or medical professional \(R-D10\)/);
});

test('the forbidden-phrase list catches pushing through pain', () => {
  const plain = plainText('Hãy vượt qua cơn đau để tiến bộ.');
  assert.ok(plain.includes(' vuot qua con dau '));
  assert.ok(FORBIDDEN.some(p => plain.includes(` ${p} `)));
});

test('every caution of a move used in a HIIT workout names dizziness or chest tightness', () => {
  const used = new Set(
    WORKOUTS.filter(w => w.modality === 'HIIT').flatMap(w => w.steps.map(s => s.moveCode)),
  );
  for (const m of MOVES)
    if (used.has(m.code))
      assert.match(m.caution, /chóng mặt|tức ngực/, `${m.code}: ${m.caution}`);
});

test('GYM_STRENGTH_15 is its own workout: at least two MAIN moves that ROOM_DUMBBELL_15 lacks', () => {
  const main = (code: string) =>
    new Set(WORKOUTS.find(w => w.code === code)?.steps.filter(s => s.phase === 'MAIN').map(s => s.moveCode));
  const room = main('ROOM_DUMBBELL_15');
  assert.ok([...main('GYM_STRENGTH_15')].filter(c => !room.has(c)).length >= 2);
});

test('stretch moves used outdoors name a support that exists outdoors', () => {
  const outdoor = new Set(
    WORKOUTS.filter(w => w.spaceNeeded === 'OUTDOOR').flatMap(w => w.steps.map(s => s.moveCode)),
  );
  for (const m of MOVES)
    if (outdoor.has(m.code) && /tường|ghế/.test(moveText(m)))
      assert.match(moveText(m), /cây|hàng rào/, `${m.code}: only an indoor support`);
});

test('one word for each body part: no bare "gối", "khuỷu" or "choáng"', () => {
  for (const m of MOVES) {
    // The name "Plank tựa gối" is the plan's fixed name, so it is exempt.
    const own = m.code === 'PLANK_TUA_GOI' ? '' : m.name;
    const text = [own, ...m.steps, m.caution].join(' ').toLowerCase();
    assert.doesNotMatch(text.replace(/đầu gối/g, ''), /\bgối\b/, `${m.code}: gối`);
    assert.doesNotMatch(text.replace(/khuỷu tay/g, ''), /khuỷu/, `${m.code}: khuỷu`);
    assert.doesNotMatch(text, /choáng/, `${m.code}: choáng`);
  }
});

test('a step text fits the row of the frame S18: at most 26 characters', () => {
  for (const w of WORKOUTS)
    for (const s of w.steps)
      assert.ok(s.repsText.length <= 26, `${w.code}: "${s.repsText}" is ${s.repsText.length} characters`);
});
