import { QUOTES } from '../../../server/content/quotes.ts';
import { journalKey, ticketsKey } from './api';
import * as celebrations from '../progression/celebrations';
import { draws, fireEvent, giveTickets, installTodayTestEnv, landed, nearLevelUp, openWrite, profileTab, queryClient, requested, saves, saveText, screen, seedJournal, world } from './journalTestKit';

jest.mock('../progression/celebrations', () => {
  const actual = jest.requireActual('../progression/celebrations');
  return { ...actual, pushCelebrations: jest.fn(actual.pushCelebrations) };
});

// The real registry: S33 is reached by saving on S32, which is opened from the profile tab.
installTodayTestEnv();

const QUOTE = `“${QUOTES[0].text}”`; // the stand-in gives the first quote that was not received lately
const TEXT = 'Hôm nay mình đã chậm lại một chút.';
const THIS_WEEK = '2026-10-12';
/** The stand-in's logical day is 2026-10-14. */
const TODAY = '2026-10-14';
const LIST = [...journalKey, 'list'] as const;
const ticketCard = () => screen.getByTestId('ticket-card');
const seeTicketsRow = () => screen.getByRole('button', { name: /^Xem vé\./ });

describe('S33: always', () => {
  test('"Đã lưu", the quote, the thanks and "Về Hôm nay"; the first entry of the day pays its XP', async () => {
    const view = await openWrite();
    await saveText(TEXT);
    expect(screen.getByRole('header', { name: 'Một khoảng nghỉ' })).toBeTruthy();
    expect(screen.getByText('Bạn không phải làm tốt mọi ngày.')).toBeTruthy();
    expect(screen.getByText(QUOTE)).toBeTruthy();
    expect(screen.getByText('Cảm ơn bạn đã dành một khoảng riêng để lắng nghe mình.')).toBeTruthy();
    expect(screen.getByText('Đã lưu')).toBeTruthy();
    expect(screen.getByText('+15 XP')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Về Hôm nay' })).toBeTruthy();
    // an ordinary entry: no support block, none of the words of one
    expect(draws('Bạn không cần ở một mình')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Xem nguồn hỗ trợ' })).toBeNull();
    view.unmount();
  });

  test('XP 0: a second entry of the same logical day pays nothing, so no "+15 XP" is drawn', async () => {
    seedJournal([{ id: '00000000-0000-4000-8000-0000000000f1', createdAt: new Date(Date.now() - 3_600_000).toISOString(), body: 'Trang đầu.', quoteCode: 'Q002', logicalDate: TODAY }]);
    const view = await openWrite();
    await saveText(TEXT);
    expect(screen.getByText('Đã lưu')).toBeTruthy();
    expect(screen.queryByText(/\+\d+ XP/)).toBeNull();
    view.unmount();
  });

  test('"Về Hôm nay" closes the flow: the Today tab, and the profile tab is back on its root (no page of the quote left behind it)', async () => {
    const view = await openWrite();
    await saveText(TEXT);
    fireEvent.press(screen.getByRole('button', { name: 'Về Hôm nay' }));
    expect(await screen.findByRole('tab', { name: 'Hôm nay', selected: true })).toBeTruthy();
    fireEvent.press(profileTab());
    expect(await screen.findByRole('header', { name: 'Cá nhân' })).toBeTruthy();
    expect(screen.queryByText('Một khoảng nghỉ')).toBeNull();
    view.unmount();
  });
});

describe('S77: by the outcome of the weekly ticket', () => {
  test('GRANTED: the card with a 2 px dashed border in the primary colour, "+1 vé giữ nhịp của tuần", how many are held, and "Xem vé" opens the tickets', async () => {
    const view = await openWrite();
    await saveText(TEXT);
    expect(screen.getByText('+1 vé giữ nhịp của tuần')).toBeTruthy();
    expect(screen.getByText('Đang có 1 / 2 vé')).toBeTruthy();
    expect(ticketCard()).toHaveStyle({ borderWidth: 2, borderStyle: 'dashed', borderColor: '#2458D3' });
    expect(world.tickets.list).toHaveLength(1);
    fireEvent.press(seeTicketsRow());
    expect(await screen.findByRole('header', { name: 'Vé giữ nhịp' })).toBeTruthy();
    await landed();
    expect(screen.getByText('Bạn đang có 1 vé · tối đa 2')).toBeTruthy();
    view.unmount();
  });

  test('AT_CAP: "Bạn đang giữ đủ N vé. Vé tuần này không được cấp thêm." with N the cap, and no ticket card', async () => {
    giveTickets(2);
    const view = await openWrite();
    await saveText(TEXT);
    expect(screen.getByText('Bạn đang giữ đủ 2 vé. Vé tuần này không được cấp thêm.')).toBeTruthy();
    expect(screen.queryByTestId('ticket-card')).toBeNull();
    expect(screen.queryByText('+1 vé giữ nhịp của tuần')).toBeNull();
    view.unmount();
  });

  test('AT_CAP says the cap of the person: three with the perk', async () => {
    giveTickets(3);
    world.shop.unlocked.push({ perk: 'TICKET_CAP_PLUS', cost: 3 });
    const view = await openWrite();
    await saveText(TEXT);
    expect(screen.getByText('Bạn đang giữ đủ 3 vé. Vé tuần này không được cấp thêm.')).toBeTruthy();
    view.unmount();
  });

  test('ALREADY_DECIDED: nothing is said about tickets at all', async () => {
    world.tickets.decided[THIS_WEEK] = true;
    const view = await openWrite();
    await saveText(TEXT);
    expect(screen.getByText('Đã lưu')).toBeTruthy();
    expect(screen.queryByTestId('ticket-card')).toBeNull();
    expect(draws('vé')).toBe(false);
    view.unmount();
  });
});

describe('S56 beside the response', () => {
  test('a crisis match shows the support block AND the quote, the saved line and the way back, never one instead of the others; "Xem nguồn hỗ trợ" opens the sources', async () => {
    const view = await openWrite();
    await saveText('Mình không thiết sống nữa');
    expect(screen.getByText(QUOTE)).toBeTruthy();
    expect(screen.getByText('Đã lưu')).toBeTruthy();
    expect(screen.getByText('+15 XP')).toBeTruthy();
    expect(screen.getByText('+1 vé giữ nhịp của tuần')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Bạn không cần ở một mình' })).toBeTruthy();
    expect(screen.getByText('Nếu muốn, bạn có thể liên hệ một người mình tin tưởng hoặc tìm dịch vụ hỗ trợ tại nơi bạn sống.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Về Hôm nay' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Xem nguồn hỗ trợ' }));
    expect(await screen.findByRole('header', { name: 'Nguồn hỗ trợ' })).toBeTruthy();
    view.unmount();
  });

  test('ordinary sad words are not a crisis: no block', async () => {
    const view = await openWrite();
    await saveText('Hôm nay mình buồn và mệt, thấy cô đơn một chút.');
    expect(draws('Bạn không cần ở một mình')).toBe(false);
    expect(screen.getByText(QUOTE)).toBeTruthy();
    view.unmount();
  });
});

describe('after the server confirms', () => {
  test('the journal list, the tickets (granted) and the day, profile and progression (XP) are marked stale', async () => {
    const view = await openWrite();
    const client = queryClient();
    client.setQueryData(ticketsKey, { stale: true });
    client.setQueryData(LIST, { pages: [], pageParams: [] });
    const days = requested('/day');
    const mes = requested('/me');
    await saveText(TEXT);
    expect(client.getQueryState(LIST)?.isInvalidated).toBe(true);
    expect(client.getQueryState(ticketsKey)?.isInvalidated).toBe(true);
    expect(requested('/day')).toBeGreaterThan(days);
    expect(requested('/me')).toBeGreaterThan(mes);
    view.unmount();
  });

  test('nothing granted and nothing paid: the tickets, the day and the profile are left alone', async () => {
    giveTickets(2);
    seedJournal([{ id: '00000000-0000-4000-8000-0000000000f2', createdAt: new Date(Date.now() - 3_600_000).toISOString(), body: 'Trang đầu.', quoteCode: 'Q002', logicalDate: TODAY }]);
    const view = await openWrite();
    const client = queryClient();
    client.setQueryData(ticketsKey, { stale: true });
    client.setQueryData(LIST, { pages: [], pageParams: [] });
    const days = requested('/day');
    const mes = requested('/me');
    await saveText(TEXT);
    expect(client.getQueryState(LIST)?.isInvalidated).toBe(true); // the list is stale after every save
    expect(client.getQueryState(ticketsKey)?.isInvalidated).toBe(false);
    expect(requested('/day')).toBe(days);
    expect(requested('/me')).toBe(mes);
    view.unmount();
  });

  test('the level-ups of the answer are handed to the celebration host once, under the entry id', async () => {
    nearLevelUp(5);
    const view = await openWrite();
    await saveText(TEXT);
    expect(celebrations.pushCelebrations).toHaveBeenCalledWith([expect.objectContaining({ type: 'LEVEL_UP', level: 6 })], saves()[0].id);
    view.unmount();
  });
});
