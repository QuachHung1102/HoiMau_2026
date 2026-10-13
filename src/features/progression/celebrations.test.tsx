import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { GameEvent } from '../../../domain/contract/common.ts';
import { clearCelebrations, dismissCelebration, pushCelebrations, useCelebrationQueue } from './celebrations';

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
