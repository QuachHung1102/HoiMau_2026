import { breakStreak, fetchMock, fireEvent, giveTickets, installTodayTestEnv, openTickets, refuse, screen, world, within } from './journalTestKit';

// The real registry: S34 is opened from the journey (the home tab's "xem hành trình", then "Vé giữ nhịp").
installTodayTestEnv();

const YESTERDAY = '2026-10-13';
const dateField = () => screen.getByRole('combobox', { name: /^Ngày sử dụng/ });
const preview = () => screen.getByRole('button', { name: 'Xem trước việc dùng vé' });
const reads = () => fetchMock.mock.calls.filter(([url, init]) => init.method === 'GET' && String(url).endsWith('/freeze-tickets')).length;
const options = async () => {
  fireEvent.press(dateField());
  const labels = (await screen.findAllByRole('radio')).map(option => within(option).getAllByText(/./)[0].props.children as string);
  return labels;
};
const choose = async (label: string) => {
  fireEvent.press(dateField());
  fireEvent.press(await screen.findByRole('radio', { name: label }));
};
/** Yesterday is still open (the day-close has not run) and the streak is alive: it is the day to protect. */
const yesterdayOpen = () => {
  world.hour = 9;
  world.tickets.closed = '2026-10-12';
};

describe('S34', () => {
  test('from the journey: the words of the frame, what a ticket does, how many are held with a glyph per place, the date, the preview', async () => {
    giveTickets(1);
    const view = await openTickets();
    expect(reads()).toBe(1);
    expect(screen.getByRole('header', { name: 'Vé giữ nhịp' })).toBeTruthy();
    expect(screen.getByText('Giữ lại chuỗi khi bạn cần nghỉ.')).toBeTruthy();
    expect(screen.getByText('Một ngày nhẹ hơn')).toBeTruthy();
    expect(screen.getByText('Vé giữ chuỗi, không tăng chuỗi. Số vé khả dụng lấy từ tài khoản của bạn.')).toBeTruthy();
    expect(screen.getByText('Bạn đang có 1 vé · tối đa 2')).toBeTruthy();
    // one glyph per place: the held one filled, the free one an outline; the words say the same
    expect(screen.getAllByTestId('ticket-held')).toHaveLength(1);
    expect(screen.getAllByTestId('ticket-free')).toHaveLength(1);
    expect(screen.getByText('Trước khi dùng, bạn sẽ được xem ngày áp dụng và ảnh hưởng đến chuỗi.')).toBeTruthy();
    expect(screen.queryByText('Cách có vé')).toBeNull();
    expect(preview()).not.toBeDisabled();
    view.unmount();
  });

  test('the cap of the person: three places with the perk', async () => {
    giveTickets(2);
    world.shop.unlocked.push({ perk: 'TICKET_CAP_PLUS', cost: 3 });
    const view = await openTickets();
    expect(screen.getByText('Bạn đang có 2 vé · tối đa 3')).toBeTruthy();
    expect(screen.getAllByTestId('ticket-held')).toHaveLength(2);
    expect(screen.getAllByTestId('ticket-free')).toHaveLength(1);
    view.unmount();
  });

  test('no ticket: how a ticket is earned, the date shown with the reason it cannot be used, the button disabled and nothing opens', async () => {
    const view = await openTickets();
    expect(screen.getByText('Bạn đang có 0 vé · tối đa 2')).toBeTruthy();
    expect(screen.queryAllByTestId('ticket-held')).toHaveLength(0);
    expect(screen.getByText('Cách có vé')).toBeTruthy();
    expect(screen.getByText('Mỗi tuần, trang nhật ký đầu tiên của bạn được tặng một vé giữ nhịp. Tuần bắt đầu từ thứ Hai.')).toBeTruthy();
    expect(screen.getByText('Bạn chưa có vé để dùng.')).toBeTruthy();
    expect(preview()).toBeDisabled();
    fireEvent.press(preview());
    expect(screen.queryByRole('header', { name: /^Dùng vé/ })).toBeNull();
    view.unmount();
  });
});

describe('the date to use a ticket for', () => {
  test('the evening: only today; the afternoon-to-3 window of yesterday is not offered', async () => {
    giveTickets(1);
    const view = await openTickets();
    expect(await options()).toEqual(['Hôm nay']);
    view.unmount();
  });

  test('from 03:00 to 15:00 yesterday is offered too, with the hours left worked out from the deadline and the server\'s clock (rounded down)', async () => {
    giveTickets(1);
    world.hour = 9;
    const view = await openTickets();
    expect(await options()).toEqual(['Hôm nay', 'Hôm qua · còn 6 giờ để dùng']);
    view.unmount();
  });

  test('a clock a few minutes past the hour: 14:30 leaves under an hour, 9:20 leaves five full hours', async () => {
    giveTickets(1);
    world.hour = 9;
    world.tickets.minute = 20;
    const first = await openTickets();
    expect(await options()).toEqual(['Hôm nay', 'Hôm qua · còn 5 giờ để dùng']);
    first.unmount();
    world.hour = 14;
    world.tickets.minute = 30;
    const second = await openTickets();
    expect(await options()).toEqual(['Hôm nay', 'Hôm qua · còn dưới 1 giờ để dùng']);
    second.unmount();
  });

  test('between 03:00 and the day-close, when yesterday needs the ticket: it is chosen already, one calm line says it closes first and for how long, and the preview is for yesterday', async () => {
    giveTickets(1);
    yesterdayOpen();
    const view = await openTickets();
    expect(dateField()).toHaveAccessibleName('Ngày sử dụng, Hôm qua · còn 6 giờ để dùng');
    expect(screen.getByText('Hôm qua khép lại trước nên được chọn sẵn: còn 6 giờ để dùng.')).toBeTruthy();
    fireEvent.press(preview());
    expect(await screen.findByRole('header', { name: 'Dùng vé cho hôm qua?' })).toBeTruthy();
    view.unmount();
  });

  test('yesterday does not need it, or there is no ticket: today is chosen and the line is not shown', async () => {
    giveTickets(1);
    world.hour = 9; // yesterday already closed with no break: nothing to rescue
    const closed = await openTickets();
    expect(dateField()).toHaveAccessibleName('Ngày sử dụng, Hôm nay');
    expect(screen.queryByText(/khép lại trước/)).toBeNull();
    closed.unmount();
    world.tickets.list = [];
    yesterdayOpen();
    const empty = await openTickets();
    expect(dateField()).toHaveAccessibleName('Ngày sử dụng, Hôm nay');
    expect(screen.queryByText(/khép lại trước/)).toBeNull();
    empty.unmount();
  });

  test('a date can be chosen by hand; today, while yesterday is open and about to break the streak, protects nothing and says so', async () => {
    giveTickets(1);
    yesterdayOpen();
    const view = await openTickets();
    await choose('Hôm nay');
    expect(dateField()).toHaveAccessibleName('Ngày sử dụng, Hôm nay');
    expect(screen.getByText(/Ngày này chưa cần vé/)).toBeTruthy();
    expect(preview()).toBeDisabled();
    await choose('Hôm qua · còn 6 giờ để dùng');
    expect(screen.queryByText(/Ngày này chưa cần vé/)).toBeNull();
    expect(preview()).not.toBeDisabled();
    view.unmount();
  });
});

describe('a date that cannot be used says why, and the button is disabled with that reason', () => {
  test('nothing to protect (the story is done): the chuỗi is safe, the ticket stays', async () => {
    giveTickets(1);
    world.day = { ...world.day, quests: world.day.quests.map(quest => (quest.category === 'STORY' ? { ...quest, completed: true } : quest)), story: { done: 2, total: 2 } };
    const view = await openTickets();
    expect(screen.getByText('Ngày này chưa cần vé: chuỗi của bạn không bị đe dọa. Vé vẫn còn nguyên.')).toBeTruthy();
    expect(preview()).toBeDisabled();
    view.unmount();
  });

  test('nothing to protect (no streak)', async () => {
    giveTickets(1);
    world.me = { ...world.me, progression: { ...(world.me.progression as NonNullable<typeof world.me.progression>), streakCurrent: 0 } };
    const view = await openTickets();
    expect(screen.getByText(/Ngày này chưa cần vé/)).toBeTruthy();
    expect(preview()).toBeDisabled();
    view.unmount();
  });

  test('already used: the option says so, the reason is the server\'s, and choosing another date lifts it', async () => {
    giveTickets(2);
    yesterdayOpen();
    world.tickets.list[0].usedFor = YESTERDAY;
    const view = await openTickets();
    // yesterday is used, so today is the one chosen; choose yesterday by hand
    expect(await options()).toEqual(['Hôm nay', 'Hôm qua · còn 6 giờ để dùng · Đã dùng vé']);
    fireEvent.press(await screen.findByRole('radio', { name: /Đã dùng vé/ }));
    expect(screen.getByText('Ngày này đã dùng vé rồi.')).toBeTruthy();
    expect(preview()).toBeDisabled();
    await choose('Hôm nay');
    expect(screen.queryByText('Ngày này đã dùng vé rồi.')).toBeNull();
    expect(preview()).not.toBeDisabled();
    view.unmount();
  });

  test('the closed day that broke the streak is the one to rescue: chosen already, its preview is the break', async () => {
    giveTickets(1);
    world.hour = 9;
    breakStreak(12);
    const view = await openTickets();
    expect(dateField()).toHaveAccessibleName('Ngày sử dụng, Hôm qua · còn 6 giờ để dùng');
    expect(screen.getByText('Hôm qua khép lại trước nên được chọn sẵn: còn 6 giờ để dùng.')).toBeTruthy();
    view.unmount();
  });
});

describe('loading and failing', () => {
  test('the read fails: the calm error with "Thử lại"; the retry shows the tickets', async () => {
    giveTickets(1);
    world.answer = request => {
      if (request === 'GET /freeze-tickets') throw new TypeError('Network request failed');
      return undefined;
    };
    const view = await openTickets();
    expect(await screen.findByText('Chưa tải được dữ liệu')).toBeTruthy();
    world.answer = undefined;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Bạn đang có 1 vé · tối đa 2')).toBeTruthy();
    view.unmount();
  });

  test('a refusal that is not a network failure is worded by its code', async () => {
    world.answer = request => (request === 'GET /freeze-tickets' ? refuse(429, 'RATE_LIMITED') : undefined);
    const view = await openTickets();
    expect(await screen.findByText(/Bạn thao tác hơi nhanh/)).toBeTruthy();
    view.unmount();
  });
});
