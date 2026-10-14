import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';
import type { GameEvent } from '../../../domain/contract/common.ts';
import { celebratedKey } from '../../shared/storage/celebrated';
import { nearLevelUp } from '../dashboard/todayTestKit';
import { tickPath, WATER } from '../quests/api';
import { useStandUpHold } from '../quests/useStandUp';
import { refuse, TOKEN } from '../sync/syncTestKit';
import { CelebrationHost } from './CelebrationHost';
import { pushCelebrations, useCelebrationQueue } from './celebrations';
import { app, dayOf, installTodayTestEnv, keepCelebrated, keptCelebrated, milestoneItem, openToday, queryClient, requested, seedQueue, setLevel, settle, USER, world, writes } from './progressionTestKit';
import { stored } from '../sync/syncTestKit';

// `navigate` of the host, recorded on its way to the navigator: "Xem huy hiệu" goes to a route nobody has registered yet.
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  const wrapped = new WeakMap<object, object>();
  return {
    ...actual,
    useNavigation: (...args: unknown[]) => {
      const navigation = actual.useNavigation(...args);
      if (!wrapped.has(navigation)) {
        wrapped.set(
          navigation,
          new Proxy(navigation, {
            get: (target, key) => (key === 'navigate' ? (...to: unknown[]) => { mockNavigate(...to); return target.navigate(...to); } : target[key]),
          }),
        );
      }
      return wrapped.get(navigation);
    },
  };
});

installTodayTestEnv();
beforeEach(() => mockNavigate.mockClear());

const levelUp = (level: number, titleKey: 'TAN_BINH' | 'NGUOI_KIEN_TRI' | 'CHIEN_BINH_KY_LUAT' = 'NGUOI_KIEN_TRI'): GameEvent => ({ type: 'LEVEL_UP', level, titleKey, perkPointsGained: 1 });
const ITEM = '9d1c2f3a-4b5e-4f60-8a71-b2c3d4e5f601';
const ITEM_2 = '9d1c2f3a-4b5e-4f60-8a71-b2c3d4e5f602';

let setHold: (on: boolean) => void = () => undefined;
function Holding() {
  useStandUpHold();
  return null;
}
/** Stands for a screen of the focus flow: while `setHold(true)` it is mounted and holds the overlays back. */
function HoldProbe() {
  const [on, set] = useState(false);
  setHold = set;
  return on ? <Holding /> : null;
}
function QueueProbe() {
  return <Text testID="queue">{JSON.stringify(useCelebrationQueue())}</Text>;
}
const queued = () => JSON.parse(screen.getByTestId('queue').props.children) as GameEvent[];

/** The app with the host inside the navigation container, as App.tsx mounts it. */
const open = (options: Parameters<typeof openToday>[0] = {}) =>
  openToday({
    ...options,
    inside: (
      <>
        <CelebrationHost />
        <HoldProbe />
        <QueueProbe />
      </>
    ),
  });
const push = (...events: GameEvent[]) => act(() => pushCelebrations(events));
const title = (name: string) => screen.queryByRole('header', { name });
const tracker = () => screen.getByRole('button', { name: /^Nước hôm nay/ });
const closeIt = async (label: string) => {
  fireEvent.press(screen.getByRole('button', { name: label }));
  await settle();
};
const reads = () => writes().filter(request => request.path === '/inbox/read');

describe('S65: a level reached', () => {
  test('a LEVEL_UP of a confirmed write: shown once, with the title and the point; closing it does not bring it back when the profile arrives', async () => {
    await keepCelebrated(5);
    nearLevelUp(5);
    const view = await open();
    fireEvent.press(tracker());
    expect(await screen.findByRole('header', { name: 'Bạn lên cấp 6' })).toBeTruthy();
    expect(screen.getByText('Bạn nhận 1 điểm tiện ích.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xem tiện ích' })).toBeTruthy();
    await settle();
    // the profile read after the write is at level 6 as well: still ONE celebration
    expect(queued()).toEqual([]);
    await closeIt('Để sau');
    expect(title('Bạn lên cấp 6')).toBeNull();
    await act(() => queryClient().invalidateQueries({ queryKey: ['me'] }));
    await settle();
    expect(title('Bạn lên cấp 6')).toBeNull();
    expect(await keptCelebrated()).toBe('6');
    view.unmount();
  });

  test('"Xem tiện ích" closes it at once and goes to the levels screen', async () => {
    await keepCelebrated(5);
    const view = await open();
    await push(levelUp(6));
    await screen.findByRole('header', { name: 'Bạn lên cấp 6' });
    mockNavigate.mockClear();
    fireEvent.press(screen.getByRole('button', { name: 'Xem tiện ích' }));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('Levels');
    expect(title('Bạn lên cấp 6')).toBeNull();
    expect(await screen.findByRole('header', { name: 'Cấp độ & tiện ích' })).toBeTruthy();
    await settle();
    view.unmount();
  });

  test('the close button also closes it, without going anywhere', async () => {
    await keepCelebrated(5);
    const view = await open();
    await push(levelUp(6));
    await screen.findByRole('header', { name: 'Bạn lên cấp 6' });
    mockNavigate.mockClear();
    fireEvent.press(screen.getByRole('button', { name: 'Đóng' }));
    expect(title('Bạn lên cấp 6')).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
    await settle();
    view.unmount();
  });

  test('two events queued: one after the other, lower level first, each once', async () => {
    await keepCelebrated(5);
    const view = await open();
    await push(levelUp(7), levelUp(6));
    expect(await screen.findByRole('header', { name: 'Bạn lên cấp 6' })).toBeTruthy();
    expect(title('Bạn lên cấp 7')).toBeNull();
    await closeIt('Để sau');
    expect(await screen.findByRole('header', { name: 'Bạn lên cấp 7' })).toBeTruthy();
    await closeIt('Để sau');
    expect(title('Bạn lên cấp 7')).toBeNull();
    expect(title('Bạn lên cấp 6')).toBeNull();
    expect(await keptCelebrated()).toBe('7');
    view.unmount();
  });

  test('the same action answered again (the app retried after a lost answer) is one celebration', async () => {
    await keepCelebrated(5);
    const view = await open();
    await push(levelUp(6));
    act(() => pushCelebrations([levelUp(6)], 'action-1'));
    act(() => pushCelebrations([levelUp(6)], 'action-1'));
    await screen.findByRole('header', { name: 'Bạn lên cấp 6' });
    // the one without an action id and the first with one are two events for the same level: one overlay, the other dropped
    await closeIt('Để sau');
    await settle();
    expect(title('Bạn lên cấp 6')).toBeNull();
    expect(queued()).toEqual([]);
    view.unmount();
  });

  test('a level already celebrated is dropped without a word (a replay of an old answer)', async () => {
    await keepCelebrated(6);
    const view = await open();
    await push(levelUp(5, 'NGUOI_KIEN_TRI'), levelUp(6));
    await settle();
    expect(title('Bạn lên cấp 5')).toBeNull();
    expect(title('Bạn lên cấp 6')).toBeNull();
    expect(queued()).toEqual([]);
    view.unmount();
  });

  test('PET_STAGE_UP is not for this host: it stays in the queue, whatever is shown around it', async () => {
    await keepCelebrated(5);
    const view = await open();
    await push({ type: 'PET_STAGE_UP', stage: 'JUVENILE' }, levelUp(6));
    await screen.findByRole('header', { name: 'Bạn lên cấp 6' });
    await closeIt('Để sau');
    expect(queued()).toEqual([{ type: 'PET_STAGE_UP', stage: 'JUVENILE' }]);
    expect(screen.queryByRole('button', { name: 'Để sau' })).toBeNull();
    view.unmount();
  });
});

describe('S65: from the server\'s profile, where no answer came back', () => {
  test('a record the queue delivers later hands back no answer: its level-up is still celebrated, once, from the profile', async () => {
    await keepCelebrated(5);
    nearLevelUp(5);
    await seedQueue([stored('t-1', { path: tickPath(WATER), body: {} })]);
    const view = await open();
    expect(await screen.findByRole('header', { name: 'Bạn lên cấp 6' })).toBeTruthy();
    expect(writes().map(request => request.path)).toEqual([tickPath(WATER)]);
    expect(screen.getByText('Bạn nhận 1 điểm tiện ích.')).toBeTruthy();
    await closeIt('Để sau');
    await settle();
    expect(title('Bạn lên cấp 6')).toBeNull();
    view.unmount();
  });

  test('nothing is celebrated from a record that is only waiting; it is, once the server has it', async () => {
    await keepCelebrated(5);
    nearLevelUp(5);
    const view = await open();
    world.down = true;
    fireEvent.press(tracker());
    await settle();
    expect(tracker().props.accessibilityLabel).toContain('Có phần đang chờ gửi');
    expect(title('Bạn lên cấp 6')).toBeNull();
    expect(queued()).toEqual([]);
    // the network is back; the queue delivers (its own button here), and only then does the server's profile change
    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('header', { name: 'Bạn lên cấp 6' })).toBeTruthy();
    view.unmount();
  });

  test('levels reached while away (another device) are ONE celebration: the highest level, the points of all of them, its title', async () => {
    await keepCelebrated(8);
    setLevel(10, 20);
    const view = await open();
    expect(await screen.findByRole('header', { name: 'Bạn lên cấp 10' })).toBeTruthy();
    expect(screen.getByText('Chiến binh kỷ luật')).toBeTruthy();
    expect(screen.getByText('Bạn nhận 2 điểm tiện ích.')).toBeTruthy();
    expect(title('Bạn lên cấp 9')).toBeNull();
    await closeIt('Để sau');
    await settle();
    expect(screen.queryByRole('button', { name: 'Để sau' })).toBeNull();
    expect(await keptCelebrated()).toBe('10');
    view.unmount();
  });

  // The same jump, whichever the host hears first: the server's event (one event for the jump, +2) or the profile (level 7).
  test.each([
    ['the answer first, then the profile', true],
    ['the profile first, then the answer', false],
  ])('a jump of two levels, %s: one overlay, "Bạn lên cấp 7", +2 points, and nothing after it', async (_name, answerFirst) => {
    await keepCelebrated(5);
    const view = await open();
    const jump: GameEvent = { type: 'LEVEL_UP', level: 7, titleKey: 'NGUOI_KIEN_TRI', perkPointsGained: 2 };
    if (answerFirst) {
      await push(jump);
      await screen.findByRole('header', { name: 'Bạn lên cấp 7' });
      setLevel(7, 20);
      await act(() => queryClient().invalidateQueries({ queryKey: ['me'] }));
    } else {
      // held, so that the profile is read before the answer is handled
      act(() => setHold(true));
      setLevel(7, 20);
      await act(() => queryClient().invalidateQueries({ queryKey: ['me'] }));
      await settle();
      await push(jump);
      act(() => setHold(false));
      await screen.findByRole('header', { name: 'Bạn lên cấp 7' });
    }
    await settle();
    expect(screen.getByText('Bạn nhận 2 điểm tiện ích.')).toBeTruthy();
    expect(title('Bạn lên cấp 6')).toBeNull();
    await closeIt('Để sau');
    await settle();
    expect(screen.queryByRole('button', { name: 'Để sau' })).toBeNull();
    expect(queued()).toEqual([]);
    view.unmount();
  });

  test('a level lost and regained (an undo, then the same level again) is not celebrated twice', async () => {
    await keepCelebrated(5);
    const view = await open();
    await push(levelUp(6));
    await screen.findByRole('header', { name: 'Bạn lên cấp 6' });
    await closeIt('Để sau');
    // the profile drops back to 5 (the tick was undone) ...
    setLevel(5, 340);
    await act(() => queryClient().invalidateQueries({ queryKey: ['me'] }));
    await settle();
    expect(title('Bạn lên cấp 6')).toBeNull();
    // ... and 6 comes again, as a pushed event and as the profile
    await push(levelUp(6));
    setLevel(6, 10);
    await act(() => queryClient().invalidateQueries({ queryKey: ['me'] }));
    await settle();
    expect(title('Bạn lên cấp 6')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Để sau' })).toBeNull();
    expect(queued()).toEqual([]);
    expect(await keptCelebrated()).toBe('6');
    view.unmount();
  });
});

describe('S65: a fresh sign-in does not replay the past', () => {
  test('the first profile after sign-in only seeds the level: nothing is shown, the level is kept', async () => {
    setLevel(7, 20);
    const view = await open();
    await settle();
    expect(screen.queryByRole('button', { name: 'Để sau' })).toBeNull();
    await waitFor(async () => expect(await keptCelebrated()).toBe('7'));
    view.unmount();
  });

  test('an old LEVEL_UP replayed after signing out and in again is dropped; the kept level went with the sign-out', async () => {
    await keepCelebrated(5);
    const view = await open();
    await settle();
    await push({ type: 'PET_STAGE_UP', stage: 'JUVENILE' });
    await act(() => app.session.signOut());
    await settle();
    expect(await keptCelebrated()).toBeNull();
    await act(() => app.session.signIn(TOKEN, USER));
    await screen.findByRole('header', { name: 'Hôm nay' });
    await settle();
    await waitFor(async () => expect(await keptCelebrated()).toBe('5'));
    // nothing of the first session is queued, and an answer that comes back late for level 5 or 4 is old news
    expect(queued()).toEqual([]);
    await push(levelUp(5), levelUp(4, 'TAN_BINH'));
    await settle();
    expect(title('Bạn lên cấp 5')).toBeNull();
    expect(title('Bạn lên cấp 4')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Để sau' })).toBeNull();
    expect(queued()).toEqual([]);
    view.unmount();
  });

  test('the kept level belongs to the account: another account on the same device starts from its own profile', async () => {
    await AsyncStorage.setItem(celebratedKey('someone-else'), JSON.stringify(1));
    setLevel(5, 340);
    const view = await open();
    await settle();
    expect(screen.queryByRole('button', { name: 'Để sau' })).toBeNull();
    expect(await keptCelebrated()).toBe('5');
    expect(await AsyncStorage.getItem(celebratedKey('someone-else'))).toBe('1');
    view.unmount();
  });
});

describe('S66: a streak milestone', () => {
  const withMilestone = (...items: ReturnType<typeof milestoneItem>[]) => {
    world.day = dayOf({ celebrations: items, unreadCount: items.length });
  };

  test('shown once with its days and coins; "POST /inbox/read" goes out for that item when it is shown', async () => {
    await keepCelebrated(5);
    withMilestone(milestoneItem(ITEM, 7, 50));
    const view = await open();
    expect(await screen.findByRole('header', { name: '7 ngày giữ nhịp' })).toBeTruthy();
    expect(screen.getByText('Huy hiệu Người giữ nhịp đã vào kho đồ, kèm 50 xu. Kỷ lục mới của bạn: 7 ngày.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xem huy hiệu' })).toBeTruthy();
    expect(reads()).toHaveLength(1);
    expect(reads()[0].body).toEqual({ ids: [ITEM] });
    expect(typeof reads()[0].id).toBe('string');
    await settle();
    // the server's day no longer has it, and the bell has no dot
    expect(world.day.celebrations).toEqual([]);
    await closeIt('Tiếp tục');
    expect(screen.getByRole('button', { name: 'Hộp thư' })).toBeTruthy();
    view.unmount();
  });

  test('"Xem huy hiệu" closes it at once and goes to the inventory', async () => {
    await keepCelebrated(5);
    withMilestone(milestoneItem(ITEM, 30, 200));
    const view = await open();
    await screen.findByRole('header', { name: '30 ngày giữ nhịp' });
    mockNavigate.mockClear();
    fireEvent.press(screen.getByRole('button', { name: 'Xem huy hiệu' }));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('Inventory');
    expect(title('30 ngày giữ nhịp')).toBeNull();
    await settle();
    view.unmount();
  });

  test('the same item id on a later render shows nothing, even when the server still lists it', async () => {
    await keepCelebrated(5);
    withMilestone(milestoneItem(ITEM));
    world.answer = request => (request === 'POST /inbox/read' ? refuse(500, 'INTERNAL') : undefined);
    const view = await open();
    await screen.findByRole('header', { name: '7 ngày giữ nhịp' });
    await closeIt('Tiếp tục');
    expect(reads()).toHaveLength(1);
    // the read failed: the item is unread on the server and comes with every read of the day
    await act(() => queryClient().invalidateQueries({ queryKey: ['day'] }));
    await settle();
    expect(world.day.celebrations).toHaveLength(1);
    expect(screen.queryByRole('header', { name: '7 ngày giữ nhịp' })).toBeNull();
    expect(reads()).toHaveLength(1);
    view.unmount();
  });

  test('a read that failed leaves the item unread: it is shown again the next time the app starts, and that read goes through', async () => {
    await keepCelebrated(5);
    withMilestone(milestoneItem(ITEM));
    world.answer = request => (request === 'POST /inbox/read' ? refuse(500, 'INTERNAL') : undefined);
    const first = await open();
    await screen.findByRole('header', { name: '7 ngày giữ nhịp' });
    first.unmount();
    world.answer = undefined;
    const second = await open();
    expect(await screen.findByRole('header', { name: '7 ngày giữ nhịp' })).toBeTruthy();
    await settle();
    expect(world.day.celebrations).toEqual([]);
    await closeIt('Tiếp tục');
    second.unmount();
  });

  test('two milestones: one after the other, each with its own read', async () => {
    await keepCelebrated(5);
    withMilestone(milestoneItem(ITEM, 7, 50), milestoneItem(ITEM_2, 30, 200));
    const view = await open();
    expect(await screen.findByRole('header', { name: '7 ngày giữ nhịp' })).toBeTruthy();
    expect(reads().map(request => request.body)).toEqual([{ ids: [ITEM] }]);
    await closeIt('Tiếp tục');
    expect(await screen.findByRole('header', { name: '30 ngày giữ nhịp' })).toBeTruthy();
    expect(reads().map(request => request.body)).toEqual([{ ids: [ITEM] }, { ids: [ITEM_2] }]);
    await closeIt('Tiếp tục');
    expect(screen.queryByRole('header', { name: '30 ngày giữ nhịp' })).toBeNull();
    view.unmount();
  });

  test('a level reached comes first, then the milestone', async () => {
    await keepCelebrated(5);
    const view = await open();
    act(() => setHold(true));
    withMilestone(milestoneItem(ITEM));
    await act(() => queryClient().invalidateQueries({ queryKey: ['day'] }));
    await push(levelUp(6));
    await settle();
    expect(reads()).toHaveLength(0);
    act(() => setHold(false));
    expect(await screen.findByRole('header', { name: 'Bạn lên cấp 6' })).toBeTruthy();
    expect(title('7 ngày giữ nhịp')).toBeNull();
    expect(reads()).toHaveLength(0);
    await closeIt('Để sau');
    expect(await screen.findByRole('header', { name: '7 ngày giữ nhịp' })).toBeTruthy();
    expect(reads()).toHaveLength(1);
    await closeIt('Tiếp tục');
    view.unmount();
  });
});

describe('the focus flow is never covered', () => {
  test('a celebration that arrives while a focus screen is mounted waits, and is shown after it closes', async () => {
    await keepCelebrated(5);
    const view = await open();
    act(() => setHold(true));
    await push(levelUp(6));
    await settle();
    expect(title('Bạn lên cấp 6')).toBeNull();
    expect(queued()).toHaveLength(1);
    act(() => setHold(false));
    expect(await screen.findByRole('header', { name: 'Bạn lên cấp 6' })).toBeTruthy();
    await closeIt('Để sau');
    view.unmount();
  });

  test('a milestone waits as well, and is not read before it is shown', async () => {
    await keepCelebrated(5);
    world.day = dayOf({ celebrations: [milestoneItem(ITEM)], unreadCount: 1 });
    const view = await open();
    // the milestone is on screen already (nothing held it): close it, hold, and queue the next one
    await screen.findByRole('header', { name: '7 ngày giữ nhịp' });
    await closeIt('Tiếp tục');
    world.day = dayOf({ celebrations: [milestoneItem(ITEM_2, 30, 200)], unreadCount: 1 });
    act(() => setHold(true));
    await act(() => queryClient().invalidateQueries({ queryKey: ['day'] }));
    await settle();
    expect(screen.queryByRole('header', { name: '30 ngày giữ nhịp' })).toBeNull();
    expect(reads().map(request => request.body)).toEqual([{ ids: [ITEM] }]);
    act(() => setHold(false));
    expect(await screen.findByRole('header', { name: '30 ngày giữ nhịp' })).toBeTruthy();
    expect(reads().map(request => request.body)).toEqual([{ ids: [ITEM] }, { ids: [ITEM_2] }]);
    await closeIt('Tiếp tục');
    view.unmount();
  });
});

describe('the account', () => {
  test('signing out empties the queue (nothing of this account is shown to the next one)', async () => {
    await keepCelebrated(5);
    const view = await open();
    await settle();
    await push(levelUp(6));
    await act(() => app.session.signOut());
    await settle();
    expect(requested('/auth/logout')).toBe(1);
    expect(await keptCelebrated()).toBeNull();
    view.unmount();
  });
});
