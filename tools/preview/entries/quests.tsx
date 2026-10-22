import type { ActionResult } from '../../../domain/contract/common.ts';
import type { DayState, Me } from '../../../domain/contract/core.ts';
import { boardQuestTitle } from '../../../src/shared/i18n/vi/quests';
import { saveAction } from '../../../src/shared/i18n/vi/nutrition';
import type { Entries } from '../harness';
import { PressWhen } from './guild';
import { app, dayOf, meOf, pathOf, respond, settingsOf } from './today';

const HOUR = 60 * 60 * 1000;
const STAND_UP = 'STAND_UP';
const HIDDEN = 'BEDTIME_BEFORE_23';

/** Illustrative values as in frames S10, S45 and S16: 3 of 8 parts, nothing else done, the hidden quest still locked. */
const board = (change: (day: DayState) => Partial<DayState> | void = () => undefined): DayState => {
  const day = dayOf(3);
  return { ...day, ...(change(day) ?? {}) };
};
const withQuest = (day: DayState, code: string, more: Partial<DayState['quests'][number]>): DayState['quests'] =>
  day.quests.map(quest => (quest.code === code ? { ...quest, ...more } : quest));
const open = (day: DayState) => ({ quests: withQuest(day, HIDDEN, { locked: false }) });

const byLabel = (prefix: string) => () => document.querySelector<HTMLElement>(`[aria-label^="${prefix}"]`);
const byText = (text: string) => () => [...document.querySelectorAll<HTMLElement>('[role="button"]')].find(item => item.textContent === text) ?? null;

// The stand-up part recorded and confirmed: the server's answer gives 1 of 6 and +10 XP, the profile read after it the coins.
const standUpAfter = (): DayState => {
  const day = board();
  return { ...day, quests: withQuest(day, STAND_UP, { progress: 1, lastTick: { id: '8a3f6c1e-2b47-4d19-9c05-71e2a4b6d805', at: new Date().toISOString() } }) };
};
const serverAfterTick = (after: DayState, me: Me) => (url: string, init?: RequestInit) => {
  if (init?.method === 'POST') {
    const key = (init.headers as Record<string, string>)['Idempotency-Key'];
    return respond(200, { actionId: key, day: after, delta: { xp: 10, coin: 5, events: [] } } satisfies ActionResult);
  }
  const path = pathOf(url);
  return path === '/day' ? respond(200, after) : path === '/me' ? respond(200, me) : path === '/settings' ? respond(200, settingsOf()) : respond(404);
};

export const entries: Entries = {
  's10-quest-board': () => app({ route: 'QuestBoard', day: board() }),
  's10-quest-board-hidden-revealed': () => app({ route: 'QuestBoard', day: board(open) }),
  // Everything done: both main tasks, the eight parts, the six stand-ups, the hidden quest.
  's10-quest-board-all-done': () => {
    const day = board();
    const quests = day.quests.map(quest => ({ ...quest, completed: true, progress: quest.targetCount, locked: false }));
    return app({ route: 'QuestBoard', day: { ...day, quests, caloriesIn: 2380, story: { done: 2, total: 2 }, bedtimeMarkedAt: new Date(Date.now() - HOUR).toISOString() } });
  },
  // A part of the stand-up recorded from the board: the snackbar with "Hoàn tác" over the tab-less detail screen.
  's11-recorded-undo': () => app({ route: 'QuestBoard', day: board(), fetchStub: serverAfterTick(standUpAfter(), meOf(350, 255, 31)), extra: <PressWhen find={byLabel(boardQuestTitle[STAND_UP] as string)} /> }),
  's45-end-of-day': () => app({ route: 'EndOfDay', day: board(open) }),
  's45-end-of-day-too-early': () => app({ route: 'EndOfDay', day: board() }),
  's45-end-of-day-marked': () => {
    const day = board(open);
    return app({ route: 'EndOfDay', day: { ...day, bedtimeMarkedAt: new Date(Date.now() - HOUR).toISOString(), quests: withQuest(day, HIDDEN, { locked: false, completed: true, progress: 1 }) } });
  },
  's16-manual-kcal': () => app({ route: 'ManualKcal', day: board() }),
  // "Ghi món đã ăn" pressed with nothing typed: the field error and nothing sent.
  's16-manual-kcal-error': () => app({ route: 'ManualKcal', day: board(), extra: <PressWhen find={byText(saveAction)} /> }),
};
