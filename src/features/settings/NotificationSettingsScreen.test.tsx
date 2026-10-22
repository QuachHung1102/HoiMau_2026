import { PermissionsAndroid } from 'react-native';
import { act, app, fetchMock, fireEvent, hold, installTodayTestEnv, openNotifications, openSettings, queryClient, refuse, reads, respond, screen, settingsOf, settingsPatches, settle, switchOf, waitFor, world } from './settingsTestKit';

installTodayTestEnv();

const NUDGES = 'Nhận lời nhắc từ tổ đội';
const REMINDER = 'Nhắc thói quen';
const FAILED = 'Chưa lưu được thay đổi này, nên mình đã để lại như cũ.';
const windowField = () => screen.getByRole('combobox', { name: /^Khoảng giờ nhắc thói quen/ });
const choose = (label: string) => {
  fireEvent.press(windowField());
  fireEvent.press(screen.getByRole('radio', { name: label }));
};
const PATCH = 'PATCH /settings';
/** The first PATCH of a test is held until `release`; the ones after it are answered by the server. */
function holdFirst() {
  let open!: (answer: unknown) => void;
  const gate = new Promise<unknown>(resolve => (open = resolve));
  let held = false;
  world.answer = request => {
    if (request !== PATCH || held) return undefined;
    held = true;
    return gate;
  };
  return { release: (answer?: unknown) => open(answer) };
}

describe('S36 with the S80 layout', () => {
  test('the title, the subtitle, the truthful notice, the two switches as the server has them, the window and the footer', async () => {
    world.settings = settingsOf({ nudgesEnabled: true, reminderEnabled: false, reminderWindow: 'NOON' });
    const view = await openNotifications();
    expect(screen.getByRole('header', { name: 'Thông báo' })).toBeTruthy();
    expect(screen.getByText('Nhắc vừa đủ, vào lúc bạn muốn.')).toBeTruthy();
    expect(screen.getByText('Bản này chưa gửi thông báo ra ngoài ứng dụng. Lời nhắc vẫn nằm trong Hộp thư.')).toBeTruthy();
    expect(switchOf(NUDGES).props.accessibilityState).toMatchObject({ checked: true });
    expect(switchOf(REMINDER).props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getAllByText('Đang bật')).toHaveLength(1);
    expect(screen.getAllByText('Đang tắt')).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: 'Khoảng giờ nhắc thói quen, Buổi trưa 11:30–13:30' })).toBeTruthy();
    expect(screen.getByText('Lời nhắc từ tổ đội vẫn tuân theo giờ địa phương và giới hạn của người nhận.')).toBeTruthy();
    view.unmount();
  });

  test('"Mở Hộp thư" opens the inbox; no permission is asked for, and nothing was written', async () => {
    const asked = jest.spyOn(PermissionsAndroid, 'request');
    const view = await openNotifications();
    fireEvent.press(screen.getByRole('button', { name: 'Mở Hộp thư' }));
    expect(await screen.findByRole('header', { name: 'Hộp thư' })).toBeTruthy();
    expect(asked).not.toHaveBeenCalled();
    expect(settingsPatches()).toEqual([]);
    view.unmount();
  });

  test('the notice has no button that asks the system for anything', async () => {
    const view = await openNotifications();
    expect(screen.queryByRole('button', { name: /Cho phép|Mở cài đặt máy/ })).toBeNull();
    view.unmount();
  });
});

describe('each control patches its own field, once, with the server\'s own words', () => {
  test('the nudge switch: nudgesEnabled', async () => {
    const view = await openNotifications();
    fireEvent.press(switchOf(NUDGES));
    await waitFor(() => expect(settingsPatches()).toHaveLength(1));
    expect(settingsPatches()[0].body).toEqual({ nudgesEnabled: false });
    expect(world.settings.nudgesEnabled).toBe(false);
    await settle();
    expect(switchOf(NUDGES).props.accessibilityState).toMatchObject({ checked: false });
    fireEvent.press(switchOf(NUDGES));
    await waitFor(() => expect(settingsPatches()).toHaveLength(2));
    expect(settingsPatches()[1].body).toEqual({ nudgesEnabled: true });
    view.unmount();
  });

  test('the habit reminder switch: reminderEnabled', async () => {
    const view = await openNotifications();
    fireEvent.press(switchOf(REMINDER));
    await waitFor(() => expect(settingsPatches()).toHaveLength(1));
    expect(settingsPatches()[0].body).toEqual({ reminderEnabled: true });
    expect(world.settings.reminderEnabled).toBe(true);
    view.unmount();
  });

  test.each([
    ['Buổi sáng 07:00–09:00', 'MORNING'],
    ['Buổi trưa 11:30–13:30', 'NOON'],
    ['Buổi tối 18:00–20:00', 'EVENING'],
  ])('the window "%s" sends reminderWindow %s: the three words of the server\'s enum, nothing else', async (label, word) => {
    // a window other than the one being chosen, so that choosing it is a change
    world.settings = settingsOf({ reminderEnabled: true, reminderWindow: word === 'MORNING' ? 'EVENING' : 'MORNING' });
    const view = await openNotifications();
    choose(label);
    await waitFor(() => expect(settingsPatches()).toHaveLength(1));
    expect(settingsPatches()[0].body).toEqual({ reminderWindow: word });
    expect(world.settings.reminderWindow).toBe(word);
    await settle();
    expect(screen.getByRole('combobox', { name: `Khoảng giờ nhắc thói quen, ${label}` })).toBeTruthy();
    view.unmount();
  });

  test('choosing the window that is already chosen sends nothing', async () => {
    world.settings = settingsOf({ reminderEnabled: true, reminderWindow: 'NOON' });
    const view = await openNotifications();
    choose('Buổi trưa 11:30–13:30');
    await settle();
    expect(settingsPatches()).toEqual([]);
    view.unmount();
  });

  test('every PATCH carries an Idempotency-Key of its own (a UUID); two changes never share one', async () => {
    const view = await openNotifications();
    fireEvent.press(switchOf(NUDGES));
    await waitFor(() => expect(settingsPatches()).toHaveLength(1));
    fireEvent.press(switchOf(REMINDER));
    await waitFor(() => expect(settingsPatches()).toHaveLength(2));
    const [first, second] = settingsPatches().map(request => request.key);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).not.toBe(first);
    view.unmount();
  });
});

describe('the window follows the reminder', () => {
  test('while the reminder is off the window is disabled, says why, and does not open; turning the reminder on enables it at once', async () => {
    world.settings = settingsOf({ reminderEnabled: false });
    const view = await openNotifications();
    expect(windowField()).toBeDisabled();
    expect(screen.getByText('Bật "Nhắc thói quen" để chọn khoảng giờ.')).toBeTruthy();
    fireEvent.press(windowField());
    expect(screen.queryByRole('radio')).toBeNull();
    fireEvent.press(switchOf(REMINDER));
    await settle();
    expect(windowField()).not.toBeDisabled();
    expect(screen.queryByText('Bật "Nhắc thói quen" để chọn khoảng giờ.')).toBeNull();
    fireEvent.press(windowField());
    expect(await screen.findAllByRole('radio')).toHaveLength(3);
    view.unmount();
  });

  test('with the reminder on from the start the window is enabled and nothing explains a reason', async () => {
    world.settings = settingsOf({ reminderEnabled: true });
    const view = await openNotifications();
    expect(windowField()).not.toBeDisabled();
    expect(screen.queryByText('Bật "Nhắc thói quen" để chọn khoảng giờ.')).toBeNull();
    view.unmount();
  });

  test('turning the reminder off again disables the window (the chosen window is kept)', async () => {
    world.settings = settingsOf({ reminderEnabled: true, reminderWindow: 'MORNING' });
    const view = await openNotifications();
    fireEvent.press(switchOf(REMINDER));
    await settle();
    expect(windowField()).toBeDisabled();
    expect(windowField().props.accessibilityLabel).toContain('Buổi sáng 07:00–09:00');
    view.unmount();
  });
});

describe('optimistic: shown at once, taken back with a message when the server says no', () => {
  test('the new value is on screen before the server has answered, and the answer keeps it', async () => {
    const gate = hold(PATCH);
    const view = await openNotifications();
    fireEvent.press(switchOf(NUDGES));
    await settle();
    expect(switchOf(NUDGES).props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getAllByText('Đang tắt')).toHaveLength(2);
    await act(async () => gate.release());
    await settle();
    expect(switchOf(NUDGES).props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.queryByText(FAILED, { exact: false })).toBeNull();
    view.unmount();
  });

  test('a 500: the switch goes back, the message says so with the reason, and exactly one PATCH was sent', async () => {
    const slow = holdFirst();
    const view = await openNotifications();
    const readsBefore = reads('/settings');
    fireEvent.press(switchOf(REMINDER));
    await settle();
    // shown while the answer is still out
    expect(switchOf(REMINDER).props.accessibilityState).toMatchObject({ checked: true });
    await act(async () => slow.release(refuse(500, 'INTERNAL')));
    expect(await screen.findByText(`${FAILED} Hệ thống đang gặp sự cố. Bạn thử lại sau ít phút nhé.`)).toBeTruthy();
    expect(switchOf(REMINDER).props.accessibilityState).toMatchObject({ checked: false });
    expect(settingsPatches()).toHaveLength(1);
    // the settings are read again: the server's truth is what stays
    await waitFor(() => expect(reads('/settings')).toBe(readsBefore + 1));
    expect(switchOf(REMINDER).props.accessibilityState).toMatchObject({ checked: false });
    view.unmount();
  });

  test('a refused window goes back to the one before', async () => {
    world.settings = settingsOf({ reminderEnabled: true, reminderWindow: 'EVENING' });
    world.answer = request => (request === PATCH ? refuse(500, 'INTERNAL') : undefined);
    const view = await openNotifications();
    choose('Buổi sáng 07:00–09:00');
    expect(await screen.findByText(FAILED, { exact: false })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Khoảng giờ nhắc thói quen, Buổi tối 18:00–20:00' })).toBeTruthy();
    view.unmount();
  });

  test('no connection: taken back with the reason; the same change again repeats the key (the first may have arrived), another change does not', async () => {
    const view = await openNotifications();
    world.down = true;
    fireEvent.press(switchOf(NUDGES));
    expect(await screen.findByText(`${FAILED} Không kết nối được mạng. Bạn kiểm tra kết nối rồi thử lại nhé.`)).toBeTruthy();
    expect(switchOf(NUDGES).props.accessibilityState).toMatchObject({ checked: true });
    fireEvent.press(switchOf(NUDGES));
    await waitFor(() => expect(settingsPatches()).toHaveLength(2));
    fireEvent.press(switchOf(REMINDER));
    await waitFor(() => expect(settingsPatches()).toHaveLength(3));
    const [first, again, other] = settingsPatches();
    expect(again.body).toEqual(first.body);
    expect(again.key).toBe(first.key);
    expect(other.key).not.toBe(first.key);
    view.unmount();
  });

  test('after the server has answered (a refusal included) the next attempt of the same change is a new action with a new key', async () => {
    world.answer = request => (request === PATCH ? refuse(500, 'INTERNAL') : undefined);
    const view = await openNotifications();
    fireEvent.press(switchOf(NUDGES));
    await waitFor(() => expect(settingsPatches()).toHaveLength(1));
    await screen.findByText(FAILED, { exact: false });
    fireEvent.press(switchOf(NUDGES));
    await waitFor(() => expect(settingsPatches()).toHaveLength(2));
    expect(settingsPatches()[1].key).not.toBe(settingsPatches()[0].key);
    view.unmount();
  });
});

describe('rapid toggles: an older failure never overwrites a newer success', () => {
  test('toggle A fails slowly, toggle B succeeds: A is taken back, B stays, the server has B and not A, and what is shown is what the server says', async () => {
    const slow = holdFirst();
    const view = await openNotifications();
    fireEvent.press(switchOf(REMINDER)); // A: reminder on, will fail
    await settle();
    fireEvent.press(switchOf(NUDGES)); // B: nudges off, will succeed
    await settle();
    // both are shown at once
    expect(switchOf(REMINDER).props.accessibilityState).toMatchObject({ checked: true });
    expect(switchOf(NUDGES).props.accessibilityState).toMatchObject({ checked: false });
    // and A is the only one on the wire: the changes go in the order they were made
    expect(settingsPatches().map(request => request.body)).toEqual([{ reminderEnabled: true }]);
    await act(async () => slow.release(refuse(500, 'INTERNAL')));
    await waitFor(() => expect(settingsPatches()).toHaveLength(2));
    expect(settingsPatches()[1].body).toEqual({ nudgesEnabled: false });
    expect(await screen.findByText(FAILED, { exact: false })).toBeTruthy();
    await settle();
    await settle();
    expect(switchOf(REMINDER).props.accessibilityState).toMatchObject({ checked: false });
    expect(switchOf(NUDGES).props.accessibilityState).toMatchObject({ checked: false });
    expect(world.settings).toMatchObject({ reminderEnabled: false, nudgesEnabled: false });
    expect(queryClient().getQueryData(['settings'])).toEqual(world.settings);
    view.unmount();
  });

  test('toggle A succeeds slowly, toggle B is refused: A stays, B is taken back (not the snapshot from before A)', async () => {
    const slow = holdFirst();
    const view = await openNotifications();
    let calls = 0;
    const before = world.answer;
    world.answer = (request, init) => {
      if (request === PATCH && (calls += 1) === 2) return refuse(500, 'INTERNAL');
      return before?.(request, init);
    };
    fireEvent.press(switchOf(NUDGES)); // A: nudges off, succeeds
    await settle();
    fireEvent.press(switchOf(REMINDER)); // B: reminder on, refused
    await settle();
    await act(async () => slow.release());
    await waitFor(() => expect(settingsPatches()).toHaveLength(2));
    expect(await screen.findByText(FAILED, { exact: false })).toBeTruthy();
    await settle();
    await settle();
    expect(switchOf(NUDGES).props.accessibilityState).toMatchObject({ checked: false });
    expect(switchOf(REMINDER).props.accessibilityState).toMatchObject({ checked: false });
    expect(world.settings).toMatchObject({ nudgesEnabled: false, reminderEnabled: false });
    view.unmount();
  });

  test('the same switch toggled twice quickly: two PATCHes in order, the last word wins on the screen and on the server', async () => {
    const slow = holdFirst();
    const view = await openNotifications();
    fireEvent.press(switchOf(REMINDER));
    await settle();
    fireEvent.press(switchOf(REMINDER));
    await settle();
    expect(switchOf(REMINDER).props.accessibilityState).toMatchObject({ checked: false });
    await act(async () => slow.release());
    await waitFor(() => expect(settingsPatches()).toHaveLength(2));
    expect(settingsPatches().map(request => request.body)).toEqual([{ reminderEnabled: true }, { reminderEnabled: false }]);
    await settle();
    await settle();
    expect(world.settings.reminderEnabled).toBe(false);
    expect(switchOf(REMINDER).props.accessibilityState).toMatchObject({ checked: false });
    view.unmount();
  });

  test('a read that is on its way when a toggle is made does not undo it', async () => {
    const view = await openNotifications();
    const out = hold(PATCH);
    const late = hold('GET /settings');
    act(() => {
      queryClient().invalidateQueries({ queryKey: ['settings'] });
    });
    await settle();
    fireEvent.press(switchOf(NUDGES));
    await settle();
    // the read answers with what the server held before the change, while the PATCH is still out
    await act(async () => late.release(respond(200, settingsOf())));
    await settle();
    expect(switchOf(NUDGES).props.accessibilityState).toMatchObject({ checked: false });
    await act(async () => out.release());
    await waitFor(() => expect(settingsPatches()).toHaveLength(1));
    await settle();
    expect(switchOf(NUDGES).props.accessibilityState).toMatchObject({ checked: false });
    view.unmount();
  });
});

describe('a person who has left', () => {
  test('an answer that arrives after signing out does not put the old settings back into the cache, and says nothing', async () => {
    const slow = holdFirst();
    const view = await openNotifications();
    fireEvent.press(switchOf(NUDGES));
    await settle();
    expect(settingsPatches()).toHaveLength(1);
    await act(() => app.session.signOut());
    await act(async () => slow.release());
    await settle();
    expect(queryClient().getQueryData(['settings'])).toBeUndefined();
    expect(screen.queryByText(FAILED, { exact: false })).toBeNull();
    view.unmount();
  });
});

describe('before the settings are known', () => {
  test('a first load that fails offers "Thử lại"; the controls come with the settings', async () => {
    world.answer = request => (request === 'GET /settings' ? refuse(500, 'INTERNAL') : undefined);
    const view = await openSettings();
    fireEvent.press(screen.getByRole('button', { name: /^Thông báo\./ }));
    expect(await screen.findByRole('button', { name: 'Thử lại' })).toBeTruthy();
    expect(screen.getByText('Hệ thống đang gặp sự cố. Bạn thử lại sau ít phút nhé.')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('switch', { name: NUDGES })).toBeTruthy();
    view.unmount();
  });

  test('it asks for the settings once the screen opens, and not twice while it stays', async () => {
    const view = await openNotifications();
    expect(reads('/settings')).toBeGreaterThanOrEqual(1);
    const count = reads('/settings');
    await settle();
    expect(reads('/settings')).toBe(count);
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === 'PATCH')).toHaveLength(0);
    view.unmount();
  });
});
