import { ticketsKey } from './api';
import { act, breakStreak, fetchMock, fireEvent, giveTickets, hold, installTodayTestEnv, landed, openTickets, queryClient, refuse, requested, screen, uses, world } from './journalTestKit';

// The real registry: S78 is opened from S34, which is opened from the journey.
installTodayTestEnv();

const YESTERDAY = '2026-10-13';
const spendButton = () => screen.getByRole('button', { name: 'Dùng vé cho ngày này' });
const reads = () => fetchMock.mock.calls.filter(([url, init]) => init.method === 'GET' && String(url).endsWith('/freeze-tickets')).length;

/** S34, then "Xem trước việc dùng vé" for the date that is chosen. */
async function openPreview() {
  const view = await openTickets();
  fireEvent.press(screen.getByRole('button', { name: 'Xem trước việc dùng vé' }));
  await screen.findByRole('header', { name: /^Dùng vé cho / });
  await landed();
  return view;
}
/** A closed yesterday that broke a streak of 12, with two tickets in hand: the frame's case. */
function rescue() {
  world.hour = 9;
  breakStreak(12);
  giveTickets(2);
}

describe('S78', () => {
  test('yesterday that broke the streak: the date and the time left, the numbers of the server with and without a ticket, how many tickets remain, the two actions', async () => {
    rescue();
    const view = await openPreview();
    expect(screen.getByRole('header', { name: 'Dùng vé cho hôm qua?' })).toBeTruthy();
    expect(screen.getByText('Thứ Ba, 13/10 · còn 6 giờ để dùng')).toBeTruthy();
    expect(screen.getByText('Nếu không dùng: chuỗi về 0')).toBeTruthy();
    expect(screen.getByText('Nếu dùng: giữ chuỗi 12 ngày')).toBeTruthy();
    expect(screen.getByText('Vé giữ chuỗi, không tăng chuỗi. Sau khi dùng, bạn còn 1 vé.')).toBeTruthy();
    expect(spendButton()).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Để sau' })).toBeTruthy();
    expect(uses()).toEqual([]);
    view.unmount();
  });

  test('today, with a streak of 4: the numbers are the server\'s for an open day, and with the last ticket none remain', async () => {
    giveTickets(1);
    const view = await openPreview();
    expect(screen.getByRole('header', { name: 'Dùng vé cho hôm nay?' })).toBeTruthy();
    expect(screen.getByText('Thứ Tư, 14/10 · còn 20 giờ để dùng')).toBeTruthy();
    expect(screen.getByText('Nếu không dùng: chuỗi về 0')).toBeTruthy();
    expect(screen.getByText('Nếu dùng: giữ chuỗi 4 ngày')).toBeTruthy();
    expect(screen.getByText('Vé giữ chuỗi, không tăng chuỗi. Sau khi dùng, bạn còn 0 vé.')).toBeTruthy();
    view.unmount();
  });

  test('"Để sau" goes back to S34 and sends nothing', async () => {
    rescue();
    const view = await openPreview();
    fireEvent.press(screen.getByRole('button', { name: 'Để sau' }));
    expect(await screen.findByRole('header', { name: 'Vé giữ nhịp' })).toBeTruthy();
    expect(uses()).toEqual([]);
    view.unmount();
  });
});

describe('using the ticket', () => {
  test('one request for one press with a fresh key and the date; the answer takes the person back to S34, which says "Đã dùng vé" and shows the new count', async () => {
    rescue();
    const view = await openPreview();
    // the tickets are read again after the use; until that read lands, S34 already shows the answer of the server (no stale count)
    const reread = hold('GET /freeze-tickets');
    fireEvent.press(spendButton());
    expect(await screen.findByRole('header', { name: 'Vé giữ nhịp' })).toBeTruthy();
    expect(screen.getByText('Bạn đang có 1 vé · tối đa 2')).toBeTruthy();
    await act(async () => reread.release());
    await landed();
    expect(uses()).toHaveLength(1);
    expect(uses()[0].body).toEqual({ date: YESTERDAY });
    expect(uses()[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(world.tickets.list.filter(ticket => ticket.usedFor !== null)).toHaveLength(1);
    expect(screen.getByLabelText('Đã dùng vé')).toBeTruthy();
    expect(screen.getByText('Thứ Ba, 13/10 được giữ chuỗi.')).toBeTruthy();
    expect(screen.getByText('Bạn đang có 1 vé · tối đa 2')).toBeTruthy();
    view.unmount();
  });

  test('nothing on screen changes before the server has answered: the numbers, the count and the screen stay, the button is busy, a second press sends nothing', async () => {
    rescue();
    const view = await openPreview();
    const gate = hold('POST /freeze-tickets/use');
    fireEvent.press(spendButton());
    await landed();
    expect(spendButton()).toHaveProp('accessibilityState', expect.objectContaining({ busy: true }));
    fireEvent.press(spendButton());
    fireEvent.press(spendButton());
    await landed();
    // still S78, still the same numbers, nothing of "used" anywhere
    expect(screen.getByRole('header', { name: 'Dùng vé cho hôm qua?' })).toBeTruthy();
    expect(screen.getByText('Nếu không dùng: chuỗi về 0')).toBeTruthy();
    expect(screen.getByText('Vé giữ chuỗi, không tăng chuỗi. Sau khi dùng, bạn còn 1 vé.')).toBeTruthy();
    expect(screen.queryByLabelText('Đã dùng vé')).toBeNull();
    expect(uses()).toHaveLength(1);
    await act(async () => gate.release());
    expect(await screen.findByText('Thứ Ba, 13/10 được giữ chuỗi.')).toBeTruthy();
    expect(uses()).toHaveLength(1);
    view.unmount();
  });

  test('after the server confirms, the journey, the profile and the day are read again, and the closed day is drawn frozen on the journey', async () => {
    rescue();
    const view = await openPreview();
    const progress = requested('/progression');
    const day = requested('/day');
    const me = requested('/me');
    const history = fetchMock.mock.calls.filter(([url]) => String(url).includes('/day/history?')).length;
    const tickets = reads();
    fireEvent.press(spendButton());
    await screen.findByText('Thứ Ba, 13/10 được giữ chuỗi.');
    await landed();
    expect(reads()).toBeGreaterThan(tickets);
    expect(requested('/progression')).toBeGreaterThan(progress);
    expect(requested('/day')).toBeGreaterThan(day);
    expect(requested('/me')).toBeGreaterThan(me);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/day/history?')).length).toBeGreaterThan(history);
    // back on the journey: the day that was kept is a frozen day, and the streak is the one before the break
    fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
    await screen.findByRole('header', { name: 'Hành trình của bạn' });
    await landed();
    expect(screen.getByLabelText('Thứ Ba, 13/10: Ngày dùng vé')).toBeTruthy();
    expect(screen.getByText('Đang giữ nhịp')).toBeTruthy();
    expect(screen.queryByText('Một khởi đầu mới')).toBeNull();
    view.unmount();
  });

  test('a lost connection: the reason and "Thử lại"; the retry repeats the same key (a ticket is spent once) and goes through', async () => {
    rescue();
    const view = await openPreview();
    world.down = true;
    fireEvent.press(spendButton());
    expect(await screen.findByText(/Không kết nối được mạng/)).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Dùng vé cho hôm qua?' })).toBeTruthy();
    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('Thứ Ba, 13/10 được giữ chuỗi.')).toBeTruthy();
    expect(uses()).toHaveLength(2);
    expect(uses()[1].id).toBe(uses()[0].id);
    expect(world.tickets.list.filter(ticket => ticket.usedFor !== null)).toHaveLength(1);
    view.unmount();
  });

  test('another answer of the server ends the attempt: the next press uses a new key', async () => {
    rescue();
    const view = await openPreview();
    world.answer = request => (request === 'POST /freeze-tickets/use' ? refuse(500, 'INTERNAL') : undefined);
    fireEvent.press(spendButton());
    expect(await screen.findByText(/Hệ thống đang gặp sự cố/)).toBeTruthy();
    world.answer = undefined;
    fireEvent.press(spendButton());
    expect(await screen.findByText('Thứ Ba, 13/10 được giữ chuỗi.')).toBeTruthy();
    expect(uses()[1].id).not.toBe(uses()[0].id);
    view.unmount();
  });
});

describe('the server refuses (the screen was drawn from an older read): each refusal is explained in place, the tickets are read again, nothing is spent', () => {
  const refused = async (setup: () => void, words: string) => {
    rescue();
    const view = await openPreview();
    const before = reads();
    setup();
    // the explanation is the refusal's own: it is there while the re-read of the tickets is still on its way
    const reread = hold('GET /freeze-tickets');
    fireEvent.press(spendButton());
    expect(await screen.findByText(words)).toBeTruthy();
    expect(spendButton()).toBeDisabled();
    await act(async () => reread.release());
    await landed();
    expect(screen.getByRole('header', { name: /^Dùng vé cho / })).toBeTruthy();
    expect(spendButton()).toBeDisabled();
    expect(reads()).toBeGreaterThan(before);
    expect(uses()).toHaveLength(1);
    view.unmount();
  };

  test('NO_TICKET: the last ticket went elsewhere', () =>
    refused(() => {
      world.tickets.list = [];
    }, 'Bạn chưa có vé để dùng.'));

  test('TICKET_DATE_NOT_ELIGIBLE: it is past 15:00 now', () =>
    refused(() => {
      world.hour = 16;
    }, 'Ngày này không còn trong thời gian dùng vé.'));

  test('TICKET_ALREADY_USED_FOR_DATE: another device used one for this date', () =>
    refused(() => {
      world.tickets.list[0].usedFor = YESTERDAY;
    }, 'Ngày này đã dùng vé rồi.'));

  test('TICKET_NOT_NEEDED: the streak the ticket was for is gone', () =>
    refused(() => {
      world.tickets.beforeBreak = null;
    }, 'Ngày này chưa cần vé: chuỗi của bạn không bị đe dọa. Vé vẫn còn nguyên.'));
});

test('the date is no longer on offer when the list is read again (past 15:00): the reason is said in place and the ticket cannot be used', async () => {
  rescue();
  const view = await openPreview();
  world.hour = 16;
  await act(async () => {
    await queryClient().invalidateQueries({ queryKey: ticketsKey });
  });
  await landed();
  expect(screen.getByText('Ngày này không còn trong thời gian dùng vé.')).toBeTruthy();
  expect(spendButton()).toBeDisabled();
  expect(screen.getByText('Thứ Ba, 13/10')).toBeTruthy();
  expect(uses()).toEqual([]);
  view.unmount();
});
