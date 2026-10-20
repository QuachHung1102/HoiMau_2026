import { Linking } from 'react-native';
import { everythingOnDisk, fetchMock, fireEvent, installTodayTestEnv, landed, openWrite, saveButton, saves, saveText, screen, type, world } from './journalTestKit';

// AR-20 and ruling R-D10: the device's crisis check lives in memory. Its result is never a request, a log or a store, and neither is the text.
installTodayTestEnv();

const CRISIS = 'Mình không thiết sống nữa, riêng tư và kín đáo.';
const ORDINARY = 'Hôm nay mình đi dạo quanh hồ, riêng tư và kín đáo.';
const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;

let spies: jest.SpyInstance[] = [];
beforeEach(() => {
  spies = METHODS.map(method => jest.spyOn(console, method).mockImplementation(() => undefined));
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});
afterEach(() => {
  spies.forEach(spy => spy.mockRestore());
  jest.restoreAllMocks();
});

const requests = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), method: String(init.method), headers: JSON.stringify(init.headers ?? {}), body: init.body === undefined ? undefined : String(init.body) }));
const consoleText = () => JSON.stringify(spies.map(spy => spy.mock.calls));

/** The whole path of a person in crisis: write, save, read the response, open the sources, call. */
async function walk(text: string) {
  const view = await openWrite();
  await saveText(text);
  return view;
}

describe('the crisis check never leaves the device', () => {
  test.each([
    ['a crisis text', CRISIS],
    ['an ordinary text', ORDINARY],
  ])('%s: the one request that carries the text is POST /journal with exactly {"body"}; no URL, header or body of any request names the check', async (_name, text) => {
    const view = await walk(text);
    await landed();
    const all = requests();
    // the body is the text and nothing more: a flag has no place in it
    expect(saves()).toHaveLength(1);
    expect(all.find(request => request.method === 'POST' && request.url.endsWith('/journal'))?.body).toBe(JSON.stringify({ body: text }));
    // no other request carries the text, in its URL or its body; none of them carries any trace of the check
    for (const request of all) {
      const shown = `${request.url}\n${request.headers}\n${request.body ?? ''}`;
      expect(shown).not.toMatch(/crisis|support|hỗ trợ|flag|match/i);
      if (!(request.method === 'POST' && request.url.endsWith('/journal'))) expect(shown).not.toContain('riêng tư');
    }
    view.unmount();
  });

  test('the support block and the sources are drawn from memory: opening them and calling asks the server for nothing new', async () => {
    const view = await walk(CRISIS);
    await landed();
    const before = requests().length;
    fireEvent.press(screen.getByRole('button', { name: 'Xem nguồn hỗ trợ' }));
    await screen.findByRole('header', { name: 'Nguồn hỗ trợ' });
    fireEvent.press(screen.getByRole('button', { name: /^Gọi 115/ }));
    fireEvent.press(screen.getByRole('button', { name: 'Trở lại trang của tôi' }));
    await screen.findByRole('header', { name: 'Một khoảng nghỉ' });
    await landed();
    expect(requests().slice(before).filter(request => request.method !== 'GET')).toEqual([]);
    expect(requests().slice(before).map(request => `${request.url}${request.body ?? ''}`).join('\n')).not.toMatch(/crisis|support|riêng tư/i);
    view.unmount();
  });

  test.each([
    ['a crisis text', CRISIS],
    ['an ordinary text', ORDINARY],
  ])('%s: nothing is logged on the way (no console method is called at all), and nothing of the text or the check is on the disk', async (_name, text) => {
    const view = await walk(text);
    await landed();
    if (text === CRISIS) {
      fireEvent.press(screen.getByRole('button', { name: 'Xem nguồn hỗ trợ' }));
      await screen.findByRole('header', { name: 'Nguồn hỗ trợ' });
      fireEvent.press(screen.getByRole('button', { name: /^Gọi 111/ }));
    }
    spies.forEach(spy => expect(spy).not.toHaveBeenCalled());
    expect(consoleText()).not.toContain('riêng tư');
    const disk = await everythingOnDisk();
    expect(disk).not.toContain('riêng tư');
    expect(disk).not.toMatch(/crisis|support/i);
    view.unmount();
  });

  test('a save that fails and is retried logs nothing either', async () => {
    const view = await openWrite();
    type(CRISIS);
    world.down = true;
    fireEvent.press(saveButton());
    await screen.findByText(/Điều bạn viết vẫn còn ở đây\./);
    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    await screen.findByRole('header', { name: 'Một khoảng nghỉ' });
    await landed();
    spies.forEach(spy => expect(spy).not.toHaveBeenCalled());
    view.unmount();
  });
});
