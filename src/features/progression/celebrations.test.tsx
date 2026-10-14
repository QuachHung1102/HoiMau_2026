import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { GameEvent } from '../../../domain/contract/common.ts';
import { clearCelebrations, dismissCelebration, pushCelebrations, useCelebrationQueue, type Celebration } from './celebrations';

const levelUp: GameEvent = { type: 'LEVEL_UP', level: 6, titleKey: 'NGUOI_KIEN_TRI', perkPointsGained: 1 };
const stageUp: GameEvent = { type: 'PET_STAGE_UP', stage: 'JUVENILE' };

let renders = 0;
function Host() {
  renders += 1;
  return <Text testID="queue">{JSON.stringify(useCelebrationQueue())}</Text>;
}
const shown = () => JSON.parse(screen.getByTestId('queue').props.children);

afterEach(() => act(() => clearCelebrations()));

test('only the events that have a celebration are kept, in the order the server gave them', () => {
  render(<Host />);
  expect(shown()).toEqual([]);
  act(() => pushCelebrations([{ type: 'QUEST_COMPLETED', questCode: 'WATER_8' }, levelUp, { type: 'STORY_ALL_DONE' }, stageUp]));
  expect(shown()).toEqual([levelUp, stageUp]);
  act(() => pushCelebrations([levelUp]));
  expect(shown()).toEqual([levelUp, stageUp, levelUp]);
});

test('events without a celebration do not wake the host', () => {
  render(<Host />);
  const before = renders;
  act(() => pushCelebrations([{ type: 'QUEST_COMPLETED', questCode: 'WATER_8' }]));
  act(() => pushCelebrations([]));
  expect(renders).toBe(before);
});

test('closing one shows the next; clearing leaves none', () => {
  render(<Host />);
  act(() => pushCelebrations([levelUp, stageUp]));
  act(() => dismissCelebration());
  expect(shown()).toEqual([stageUp]);
  act(() => pushCelebrations([levelUp]));
  act(() => clearCelebrations());
  expect(shown()).toEqual([]);
});

test('the same action pushed again (a replayed answer) adds nothing; another action with the same events does', () => {
  render(<Host />);
  act(() => pushCelebrations([levelUp], 'action-1'));
  act(() => pushCelebrations([levelUp], 'action-1'));
  expect(shown()).toEqual([levelUp]);
  act(() => pushCelebrations([levelUp], 'action-2'));
  expect(shown()).toEqual([levelUp, levelUp]);
  // no id: nothing to compare, and an action without a celebration remembers nothing
  act(() => pushCelebrations([levelUp]));
  act(() => pushCelebrations([{ type: 'QUEST_COMPLETED', questCode: 'WATER_8' }], 'action-3'));
  act(() => pushCelebrations([levelUp], 'action-3'));
  expect(shown()).toHaveLength(4);
});

test('clearing forgets the action ids too: the next account may use any id', () => {
  render(<Host />);
  act(() => pushCelebrations([levelUp], 'action-1'));
  act(() => clearCelebrations());
  act(() => pushCelebrations([levelUp], 'action-1'));
  expect(shown()).toEqual([levelUp]);
});

let latest: readonly Celebration[] = [];
function Capture() {
  latest = useCelebrationQueue();
  return null;
}

test('one named celebration can be dismissed from anywhere in the queue; none named drops the first', () => {
  render(<Capture />);
  act(() => pushCelebrations([stageUp, levelUp]));
  act(() => dismissCelebration(latest[1]));
  expect(latest).toEqual([stageUp]);
  act(() => pushCelebrations([levelUp]));
  act(() => dismissCelebration());
  expect(latest).toEqual([levelUp]);
});

test('the ids remembered are bounded: the latest 200 are kept, an older one is forgotten', () => {
  render(<Capture />);
  for (let n = 0; n < 201; n += 1) act(() => pushCelebrations([levelUp], 'action-' + n));
  expect(latest).toHaveLength(201);
  act(() => pushCelebrations([levelUp], 'action-200')); // recent: still remembered
  expect(latest).toHaveLength(201);
  act(() => pushCelebrations([levelUp], 'action-0')); // the first of 201: pushed out
  expect(latest).toHaveLength(202);
});
