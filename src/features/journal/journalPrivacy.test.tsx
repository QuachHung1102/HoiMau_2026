import { Linking } from 'react-native';
import { matchesCrisis } from '../../shared/i18n/vi/crisisMatch';
import { everythingOnDisk, fetchMock, fireEvent, installTodayTestEnv, landed, openWrite, saveButton, saves, saveText, screen, type, world } from './journalTestKit';

// Decision D-10: the device's crisis check lives in memory. Its result is never a request, a log or a store, and neither is the text.
installTodayTestEnv();

const CRISIS = 'Mình không thiết sống nữa, riêng tư và kín đáo.';
// the same length to the code point: what the two runs differ in is the check and nothing else
const ORDINARY = 'Mình đi dạo quanh hồ Gươm, riêng tư và kín đáo.';
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
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const STAMP = /\d{4}-\d\d-\d\dT[\d:.]+Z/g;
/** A trace with the text, the ids and the times replaced, so two runs of different words can be compared. */
const scrub = (value: string, text: string) => value.split(text).join('<TEXT>').replace(UUID, '<ID>').replace(STAMP, '<TIME>');
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

  test.each([
    ['a crisis text', CRISIS],
    ['an ordinary text', ORDINARY],
  ])('%s, a save that fails and is retried: nothing is logged, every POST carries exactly {"body"}, and the failure adds nothing to the disk', async (_name, text) => {
    const view = await openWrite();
    const before = scrub(await everythingOnDisk(), text);
    type(text);
    world.down = true;
    fireEvent.press(saveButton());
    await screen.findByText(/Điều bạn viết vẫn còn ở đây\./);
    await landed();
    // the failed save (with the support block on the screen for the crisis text): nothing new on the disk
    expect(scrub(await everythingOnDisk(), text)).toBe(before);
    world.down = false;
    fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
    await screen.findByRole('header', { name: 'Một khoảng nghỉ' });
    await landed();
    spies.forEach(spy => expect(spy).not.toHaveBeenCalled());
    const posts = requests().filter(request => request.method === 'POST');
    expect(posts).toHaveLength(2);
    for (const post of posts) expect(post.body).toBe(JSON.stringify({ body: text }));
    expect(await everythingOnDisk()).not.toMatch(/crisis|support/i);
    view.unmount();
  });
});

// The tests above look for names. A leak under a name nobody thought of (a `?c=1` on some request, a storage key `j:m`) passes every
// one of them, so this compares instead: the same walk with a crisis text and with an ordinary text of the same length must leave the
// same traces, in what is sent and in what is kept. A flag can only get out by making the two differ.
describe('a crisis text and an ordinary one leave the same traces', () => {
  type Trace = { requests: string[]; disk: string };
  const runs: Record<string, Trace[]> = {};
  /** Every request so far (method, URL, header names and values, body) in order, and the whole disk, with the text, ids and times replaced. */
  const trace = async (text: string): Promise<Trace> => ({
    requests: requests().map(request => scrub(JSON.stringify([request.method, request.url, Object.entries(JSON.parse(request.headers)).sort(), request.body ?? null]), text)),
    disk: scrub(await everythingOnDisk(), text),
  });
  const flows: Record<string, (text: string) => Promise<Trace[]>> = {
    saved: async text => {
      await saveText(text);
      await landed();
      return [await trace(text)];
    },
    'failed, then retried': async text => {
      type(text);
      world.down = true;
      fireEvent.press(saveButton());
      await screen.findByText(/Điều bạn viết vẫn còn ở đây\./);
      await landed();
      const failed = await trace(text);
      world.down = false;
      fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
      await screen.findByRole('header', { name: 'Một khoảng nghỉ' });
      await landed();
      return [failed, await trace(text)];
    },
  };

  test('the two texts are the same length, and only one of them matches', () => {
    expect([...CRISIS]).toHaveLength([...ORDINARY].length);
    expect(matchesCrisis(CRISIS)).toBe(true);
    expect(matchesCrisis(ORDINARY)).toBe(false);
  });

  test.each(Object.keys(flows).flatMap(flow => [[flow, 'crisis', CRISIS] as const, [flow, 'ordinary', ORDINARY] as const]))('%s, with a %s text: traced', async (flow, kind, text) => {
    const view = await openWrite();
    runs[`${flow}/${kind}`] = await flows[flow](text);
    view.unmount();
  });

  // these two read what the traced runs above left; they fail (not pass) when a run is missing
  test.each(Object.keys(flows))('%s: the requests and the disk are the same for both texts', flow => {
    const crisis = runs[`${flow}/crisis`];
    const ordinary = runs[`${flow}/ordinary`];
    expect(crisis).toBeDefined();
    expect(ordinary).toBeDefined();
    // not vacuous: the save and something on the disk are in what is compared
    expect(crisis.at(-1)?.requests.some(request => request.includes('POST') && request.includes('/journal'))).toBe(true);
    expect(crisis.at(-1)?.disk.length).toBeGreaterThan(2);
    expect(crisis).toEqual(ordinary);
  });
});
