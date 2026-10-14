import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as Keychain from 'react-native-keychain';
import { readCache, writeCache } from '../storage/cache';
import { enqueueAction, resetPendingForTests } from '../storage/pendingActions';
import { api } from './client';
import { SessionProvider, useSession, type Session } from './session';

const TOKEN = 'tok-secret-session-1';
const USER = '5f0c2a8e-1d37-4a55-9c1b-0c8a4d2e7b10';

type Init = { method: string; headers: Record<string, string> };
const fetchMock = jest.fn<Promise<unknown>, [string, Init]>();
const respond = (status: number, body?: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (body === undefined ? '' : JSON.stringify(body)),
});
const sessionInvalid = () => respond(401, { error: { code: 'SESSION_INVALID', message: 'session is not valid' } });
const bearers = () => fetchMock.mock.calls.map(([url, init]) => [url.replace(/^.*\/api\/v1/, ''), init.headers.Authorization]);

let session: Session;
function Probe() {
  session = useSession();
  return <Text>{`${session.status}|${session.userId ?? '-'}|${session.expired ? 'expired' : 'ok'}`}</Text>;
}
let client: QueryClient;
const mount = () =>
  render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <Probe />
      </SessionProvider>
    </QueryClientProvider>,
  );

const realFetch = globalThis.fetch;
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(respond(204));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  client = new QueryClient();
});
afterEach(async () => {
  // RNTL has already unmounted the tree: its automatic cleanup runs first
  client.clear();
  jest.restoreAllMocks();
  await Keychain.resetGenericPassword();
  await AsyncStorage.clear();
  resetPendingForTests();
  jest.clearAllMocks();
  globalThis.fetch = realFetch;
});

test('starts as loading and settles on signedOut when the keychain is empty', async () => {
  mount();
  expect(screen.getByText('loading|-|ok')).toBeTruthy();
  expect(await screen.findByText('signedOut|-|ok')).toBeTruthy();
});

test('signIn keeps the token in the keychain only and requests then carry it', async () => {
  mount();
  await screen.findByText('signedOut|-|ok');
  await act(() => session.signIn(TOKEN, USER));
  expect(screen.getByText(`signedIn|${USER}|ok`)).toBeTruthy();
  expect(Keychain.setGenericPassword).toHaveBeenCalledWith(USER, TOKEN);
  expect(await Keychain.getGenericPassword()).toMatchObject({ username: USER, password: TOKEN });

  await api.get('/me');
  expect(bearers()).toEqual([['/me', `Bearer ${TOKEN}`]]);

  // nothing about the session is in AsyncStorage, and the token is in no query either
  const keys = await AsyncStorage.getAllKeys();
  expect(keys).toEqual([]);
  expect(JSON.stringify(Object.entries(await AsyncStorage.getMany(keys)))).not.toContain(TOKEN);
  expect(JSON.stringify(client.getQueryCache().getAll().map(q => [q.queryKey, q.state.data]))).not.toContain(TOKEN);
});

test('the token is nowhere in AsyncStorage after signIn, also not next to cached data', async () => {
  mount();
  await screen.findByText('signedOut|-|ok');
  await act(() => session.signIn(TOKEN, USER));
  await writeCache(USER, 'me', { user: { id: USER } });
  const stored = JSON.stringify(Object.entries(await AsyncStorage.getMany(await AsyncStorage.getAllKeys())));
  expect(stored).not.toContain(TOKEN);
  expect(await AsyncStorage.getAllKeys()).toEqual([`cache:v1:${USER}:me`]);
});

test('a new provider restores the session from the keychain', async () => {
  mount();
  await screen.findByText('signedOut|-|ok');
  await act(() => session.signIn(TOKEN, USER));
  screen.unmount();

  // unmounting unbinds the client
  await api.get('/me');
  expect(bearers()).toEqual([['/me', undefined]]);

  mount();
  expect(screen.getByText('loading|-|ok')).toBeTruthy();
  expect(await screen.findByText(`signedIn|${USER}|ok`)).toBeTruthy();
  await api.get('/me');
  expect(bearers()[1]).toEqual(['/me', `Bearer ${TOKEN}`]);
});

test('a keychain that cannot be read starts signed out', async () => {
  jest.spyOn(Keychain, 'getGenericPassword').mockRejectedValueOnce(new Error('keystore unavailable'));
  mount();
  expect(await screen.findByText('signedOut|-|ok')).toBeTruthy();
});

test('signOut revokes on the server, then clears keychain, query cache, this user cache and this user queue, in that order', async () => {
  const order: string[] = [];
  mount();
  await screen.findByText('signedOut|-|ok');
  await act(() => session.signIn(TOKEN, USER));
  client.setQueryData(['me'], { user: { id: USER } });
  await writeCache(USER, 'me', { user: { id: USER } });
  await writeCache(USER, 'day', { logicalDate: '2026-10-11' });
  await writeCache('someone-else', 'me', 'kept');

  fetchMock.mockImplementation(async () => {
    order.push('revoke');
    return respond(204);
  });
  const reset = Keychain.resetGenericPassword as jest.Mock;
  const realReset = reset.getMockImplementation()!;
  reset.mockImplementation(async () => {
    order.push('keychain');
    return realReset();
  });
  const clear = client.clear.bind(client);
  jest.spyOn(client, 'clear').mockImplementation(() => {
    order.push('queries');
    clear();
  });
  const removeMany = AsyncStorage.removeMany;
  jest.spyOn(AsyncStorage, 'removeMany').mockImplementation(keys => {
    order.push(keys[0].startsWith('cache:') ? 'cache' : keys[0].startsWith('pending:') ? 'queue' : keys[0]);
    return removeMany(keys);
  });

  await act(() => session.signOut());
  reset.mockImplementation(realReset);

  expect(order).toEqual(['revoke', 'keychain', 'queries', 'cache', 'queue']);
  expect(bearers()).toEqual([['/auth/logout', `Bearer ${TOKEN}`]]);
  expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  expect(screen.getByText('signedOut|-|ok')).toBeTruthy();
  expect(await Keychain.getGenericPassword()).toBe(false);
  expect(client.getQueryData(['me'])).toBeUndefined();
  expect(await readCache(USER, 'me')).toBeUndefined();
  expect(await readCache(USER, 'day')).toBeUndefined();
  expect(await readCache('someone-else', 'me')).toBe('kept');

  await api.get('/me');
  expect(bearers()[1]).toEqual(['/me', undefined]);
});

test.each([
  ['the network is down', () => fetchMock.mockRejectedValue(new TypeError('Network request failed'))],
  ['the server fails', () => fetchMock.mockResolvedValue(respond(500, { error: { code: 'INTERNAL', message: 'x' } }))],
  ['the token is already dead', () => fetchMock.mockResolvedValue(sessionInvalid())],
])('signOut still signs out on the device when %s', async (_name, arrange) => {
  mount();
  await screen.findByText('signedOut|-|ok');
  await act(() => session.signIn(TOKEN, USER));
  client.setQueryData(['me'], { user: { id: USER } });
  arrange();
  await act(() => session.signOut());
  // a sign-out the user asked for is never reported as an expired session
  expect(screen.getByText('signedOut|-|ok')).toBeTruthy();
  expect(await Keychain.getGenericPassword()).toBe(false);
  expect(Keychain.resetGenericPassword).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(['me'])).toBeUndefined();
});

test('signOut waits for a revoke that never answers only until the 10 s timeout', async () => {
  mount();
  await screen.findByText('signedOut|-|ok');
  await act(() => session.signIn(TOKEN, USER));
  jest.useFakeTimers();
  fetchMock.mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => (init as unknown as { signal: AbortSignal }).signal.addEventListener('abort', () => reject(new Error('Aborted')))),
  );
  let done = false;
  let leaving!: Promise<void>;
  act(() => {
    leaving = session.signOut().then(() => {
      done = true;
    });
  });
  await act(() => jest.advanceTimersByTimeAsync(9_999));
  expect(done).toBe(false);
  await act(() => jest.advanceTimersByTimeAsync(1));
  await act(() => leaving);
  jest.useRealTimers();
  expect(screen.getByText('signedOut|-|ok')).toBeTruthy();
  expect(await Keychain.getGenericPassword()).toBe(false);
});

test('entries a screen still uses during sign-out leave no timer behind when that screen unmounts', async () => {
  let save!: () => void;
  function StillMounted() {
    useQuery({ queryKey: ['me'], queryFn: () => api.get('/me') });
    save = useMutation({ mutationFn: () => api.write('POST', '/journal', {}) }).mutate;
    return null;
  }
  fetchMock.mockResolvedValue(respond(200, { ok: true }));
  render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <Probe />
        <StillMounted />
      </SessionProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('signedOut|-|ok');
  await act(() => session.signIn(TOKEN, USER));
  act(() => save());
  await waitFor(() => expect(client.getQueryData(['me'])).toEqual({ ok: true }));
  await waitFor(() => expect(client.getMutationCache().getAll()[0].state.status).toBe('success'));

  const before = [...client.getQueryCache().getAll(), ...client.getMutationCache().getAll()];
  expect(before).toHaveLength(2);
  await act(() => session.signOut());
  const after = [...client.getQueryCache().getAll(), ...client.getMutationCache().getAll()];
  expect(after.filter(entry => before.includes(entry))).toEqual([]);

  // Unmounting detaches the two removed entries from their hooks. A garbage-collection timer started then would
  // belong to an entry no cache can reach, so clearing the client could not cancel it and Jest would not exit.
  jest.useFakeTimers();
  screen.unmount();
  client.clear();
  expect(jest.getTimerCount()).toBe(0);
  jest.useRealTimers();
});

test('two signOut calls share one flight', async () => {
  mount();
  await screen.findByText('signedOut|-|ok');
  await act(() => session.signIn(TOKEN, USER));
  await act(() => Promise.all([session.signOut(), session.signOut()]).then(() => undefined));
  expect(bearers()).toEqual([['/auth/logout', `Bearer ${TOKEN}`]]);
  expect(Keychain.resetGenericPassword).toHaveBeenCalledTimes(1);
});

test('a keychain reset that fails once is retried, and the token is gone', async () => {
  mount();
  await screen.findByText('signedOut|-|ok');
  await act(() => session.signIn(TOKEN, USER));
  client.setQueryData(['me'], { user: { id: USER } });
  await writeCache(USER, 'me', 'x');
  (Keychain.resetGenericPassword as jest.Mock).mockRejectedValueOnce(new Error('keystore busy'));
  await act(() => session.signOut());
  expect(Keychain.resetGenericPassword).toHaveBeenCalledTimes(2);
  expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(1); // the sign-in only: nothing was overwritten
  expect(await Keychain.getGenericPassword()).toBe(false);
  expect(screen.getByText('signedOut|-|ok')).toBeTruthy();
  expect(client.getQueryData(['me'])).toBeUndefined();
  expect(await readCache(USER, 'me')).toBeUndefined();
});

test.each([
  ['rejects', () => (Keychain.resetGenericPassword as jest.Mock).mockRejectedValueOnce(new Error('busy')).mockRejectedValueOnce(new Error('busy'))],
  ['answers false', () => (Keychain.resetGenericPassword as jest.Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(false)],
])('a keychain reset that %s twice: the token is overwritten, and the next cold start is signed out', async (_name, arrange) => {
  mount();
  await screen.findByText('signedOut|-|ok');
  await act(() => session.signIn(TOKEN, USER));
  client.setQueryData(['me'], { user: { id: USER } });
  arrange();
  await act(() => session.signOut());
  expect(Keychain.resetGenericPassword).toHaveBeenCalledTimes(2);
  expect(Keychain.setGenericPassword).toHaveBeenLastCalledWith('signed-out', '');
  expect(JSON.stringify(await Keychain.getGenericPassword())).not.toContain(TOKEN);
  expect(screen.getByText('signedOut|-|ok')).toBeTruthy();
  expect(client.getQueryData(['me'])).toBeUndefined();

  // a shared phone, restarted: the leftover credential signs nobody in
  screen.unmount();
  mount();
  expect(await screen.findByText('signedOut|-|ok')).toBeTruthy();
  await api.get('/me');
  expect(bearers().at(-1)).toEqual(['/me', undefined]);
});

test('a stored credential with an empty password is not a session', async () => {
  await Keychain.setGenericPassword(USER, '');
  mount();
  expect(await screen.findByText('signedOut|-|ok')).toBeTruthy();
});

test('signOut aborts a query that is in flight and passed its signal to the client', async () => {
  let sent: AbortSignal | undefined;
  function Loading() {
    useQuery({ queryKey: ['day'], queryFn: ({ signal }) => api.get('/day', undefined, { signal }) });
    return null;
  }
  // GET /day never answers; it only ends when its signal is aborted
  fetchMock.mockImplementation((url, init) => {
    if (url.endsWith('/auth/logout')) return Promise.resolve(respond(204));
    const signal = (init as unknown as { signal: AbortSignal }).signal;
    sent = signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted'))));
  });
  render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <Probe />
        <Loading />
      </SessionProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('signedOut|-|ok');
  await act(() => session.signIn(TOKEN, USER));
  await waitFor(() => expect(sent).toBeDefined());
  const flight = sent as AbortSignal;
  expect(flight.aborted).toBe(false);
  await act(() => session.signOut());
  expect(flight.aborted).toBe(true);
  expect(screen.getByText('signedOut|-|ok')).toBeTruthy();
});

test('three parallel 401 SESSION_INVALID answers clear the session exactly once and mark it expired', async () => {
  mount();
  await screen.findByText('signedOut|-|ok');
  await act(() => session.signIn(TOKEN, USER));
  client.setQueryData(['me'], { user: { id: USER } });
  await writeCache(USER, 'me', 'x');
  fetchMock.mockResolvedValue(sessionInvalid());

  await act(async () => {
    const results = await Promise.allSettled([api.get('/me'), api.get('/day'), api.get('/settings')]);
    expect(results.map(r => r.status)).toEqual(['rejected', 'rejected', 'rejected']);
  });
  expect(await screen.findByText('signedOut|-|expired')).toBeTruthy();
  expect(Keychain.resetGenericPassword).toHaveBeenCalledTimes(1);
  expect(await Keychain.getGenericPassword()).toBe(false);
  expect(client.getQueryData(['me'])).toBeUndefined();
  expect(await readCache(USER, 'me')).toBeUndefined();
  // a dead token is not revoked: only the three requests went out
  expect(bearers().map(([path]) => path)).toEqual(['/me', '/day', '/settings']);
});

test('signing in again after an expiry clears the expired mark', async () => {
  mount();
  await screen.findByText('signedOut|-|ok');
  await act(() => session.signIn(TOKEN, USER));
  fetchMock.mockResolvedValue(sessionInvalid());
  await act(() => api.get('/me').catch(() => undefined));
  await screen.findByText('signedOut|-|expired');
  await act(() => session.signIn('tok-secret-session-2', USER));
  expect(screen.getByText(`signedIn|${USER}|ok`)).toBeTruthy();
});

test('signIn rejects and stays signed out when the keychain cannot store the token', async () => {
  mount();
  await screen.findByText('signedOut|-|ok');
  (Keychain.setGenericPassword as jest.Mock).mockRejectedValueOnce(new Error('keystore locked'));
  await act(async () => {
    await expect(session.signIn(TOKEN, USER)).rejects.toThrow('keystore locked');
  });
  expect(screen.getByText('signedOut|-|ok')).toBeTruthy();
  await api.get('/me');
  expect(bearers()).toEqual([['/me', undefined]]);
});

test('useSession outside a SessionProvider throws a clear error', () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(() => render(<Probe />)).toThrow('useSession needs a SessionProvider above it');
});

describe('signing out while records are still waiting to be sent', () => {
  const QUEUE = `pending:v1:${USER}`;
  const offline = () => Promise.reject(new TypeError('Network request failed'));
  const record = (id: string) => ({ id, userId: USER, method: 'POST' as const, path: '/day/quests/WATER/progress', body: { amount: 1 }, createdAt: new Date().toISOString() });
  const idsOnDisk = async () => (JSON.parse((await AsyncStorage.getItem(QUEUE)) ?? '[]') as { id: string }[]).map(item => item.id);
  const paths = () => bearers().map(([path]) => path);
  const question = () => screen.queryByRole('header', { name: 'Còn 2 ghi nhận chưa gửi' });

  /** Signed in, two records made, the network goes down and "Đăng xuất" is pressed: `leaving` is that signOut call. */
  async function signOutWithTwoWaiting() {
    mount();
    await screen.findByText('signedOut|-|ok');
    await act(() => session.signIn(TOKEN, USER));
    await enqueueAction(record('a1'));
    await enqueueAction(record('a2'));
    fetchMock.mockImplementation(offline);
    let settled = false;
    let leaving!: Promise<void>;
    act(() => {
      leaving = session.signOut().then(() => {
        settled = true;
      });
    });
    await screen.findByRole('header', { name: 'Còn 2 ghi nhận chưa gửi' });
    return { leaving, isSettled: () => settled };
  }

  test('with nothing waiting there is no question', async () => {
    mount();
    await screen.findByText('signedOut|-|ok');
    await act(() => session.signIn(TOKEN, USER));
    await act(() => session.signOut());
    expect(screen.getByText('signedOut|-|ok')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ở lại' })).toBeNull();
    expect(paths()).toEqual(['/auth/logout']);
  });

  test('records that can still be delivered are delivered first, and then there is no question either', async () => {
    mount();
    await screen.findByText('signedOut|-|ok');
    await act(() => session.signIn(TOKEN, USER));
    await enqueueAction(record('a1'));
    await enqueueAction(record('a2'));
    await act(() => session.signOut());
    expect(paths()).toEqual(['/day/quests/WATER/progress', '/day/quests/WATER/progress', '/auth/logout']);
    expect(bearers().every(([, bearer]) => bearer === `Bearer ${TOKEN}`)).toBe(true);
    expect(screen.getByText('signedOut|-|ok')).toBeTruthy();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  test('the question names how many would be dropped; nothing has been signed out or revoked yet', async () => {
    const { isSettled } = await signOutWithTwoWaiting();
    expect(question()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ở lại' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đăng xuất và bỏ các ghi nhận này' })).toBeTruthy();
    expect(screen.getByText(`signedIn|${USER}|ok`)).toBeTruthy();
    expect(isSettled()).toBe(false);
    expect(paths()).toEqual(['/day/quests/WATER/progress']); // the last attempt to deliver; no /auth/logout
    expect(await idsOnDisk()).toEqual(['a1', 'a2']);
    expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();
  });

  test('"Ở lại" keeps the session and the queue, and the signOut call settles', async () => {
    const { leaving } = await signOutWithTwoWaiting();
    fireEvent.press(screen.getByRole('button', { name: 'Ở lại' }));
    await act(() => leaving);
    expect(question()).toBeNull();
    expect(screen.getByText(`signedIn|${USER}|ok`)).toBeTruthy();
    expect(await idsOnDisk()).toEqual(['a1', 'a2']);
    expect(await Keychain.getGenericPassword()).toMatchObject({ username: USER, password: TOKEN });
    expect(paths()).not.toContain('/auth/logout');

    // and the requests still carry the token
    fetchMock.mockResolvedValue(respond(200, {}));
    await act(() => api.get('/settings').then(() => undefined));
    expect(bearers().at(-1)).toEqual(['/settings', `Bearer ${TOKEN}`]);
  });

  test('Back or a tap outside the dialog is "Ở lại"', async () => {
    const { leaving } = await signOutWithTwoWaiting();
    await act(async () => screen.UNSAFE_getByProps({ transparent: true, visible: true }).props.onRequestClose());
    await act(() => leaving);
    expect(question()).toBeNull();
    expect(screen.getByText(`signedIn|${USER}|ok`)).toBeTruthy();
    expect(await idsOnDisk()).toEqual(['a1', 'a2']);
  });

  test('"Đăng xuất và bỏ các ghi nhận này" signs out as before and removes the queue of that user only', async () => {
    await AsyncStorage.setItem('pending:v1:someone-else', '[]');
    const { leaving } = await signOutWithTwoWaiting();
    fireEvent.press(screen.getByRole('button', { name: 'Đăng xuất và bỏ các ghi nhận này' }));
    await act(() => leaving);
    expect(question()).toBeNull();
    expect(screen.getByText('signedOut|-|ok')).toBeTruthy();
    expect(paths().at(-1)).toBe('/auth/logout');
    expect(await Keychain.getGenericPassword()).toBe(false);
    expect(await AsyncStorage.getAllKeys()).toEqual(['pending:v1:someone-else']);

    // the same user signs in again: nothing of the dropped records comes back
    fetchMock.mockResolvedValue(respond(200, {}));
    await act(() => session.signIn(TOKEN, USER));
    await act(() => session.signOut());
    expect(paths().filter(path => path.includes('/quests/'))).toHaveLength(1);
  });

  test('a session the server ended keeps the queue on this device and asks nothing', async () => {
    mount();
    await screen.findByText('signedOut|-|ok');
    await act(() => session.signIn(TOKEN, USER));
    await enqueueAction(record('a1'));
    fetchMock.mockResolvedValue(sessionInvalid());
    await act(() => api.get('/me').catch(() => undefined));
    expect(await screen.findByText('signedOut|-|expired')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ở lại' })).toBeNull();
    expect(await AsyncStorage.getAllKeys()).toEqual([QUEUE]);
    expect(await idsOnDisk()).toEqual(['a1']);
  });

  test('a queue that cannot be read is not an empty one: the question is asked without a number, and "Ở lại" leaves the stored queue untouched', async () => {
    const storedQueue = JSON.stringify([{ ...record('a1'), attempts: 0, status: 'queued' }]);
    await AsyncStorage.setItem(QUEUE, storedQueue);
    mount();
    await screen.findByText('signedOut|-|ok');
    await act(() => session.signIn(TOKEN, USER));
    jest.spyOn(AsyncStorage, 'getMany').mockRejectedValue(new Error('io'));
    let leaving!: Promise<void>;
    act(() => {
      leaving = session.signOut();
    });
    expect(await screen.findByRole('header', { name: 'Có thể còn ghi nhận chưa gửi' })).toBeTruthy();
    expect(screen.queryByText(/Còn \d+ ghi nhận chưa gửi/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Đăng xuất và bỏ các ghi nhận này' })).toBeTruthy();
    expect(paths()).toEqual([]); // nothing sent, nothing revoked

    fireEvent.press(screen.getByRole('button', { name: 'Ở lại' }));
    await act(() => leaving);
    expect(screen.queryByRole('header', { name: 'Có thể còn ghi nhận chưa gửi' })).toBeNull();
    expect(screen.getByText(`signedIn|${USER}|ok`)).toBeTruthy();
    expect(await AsyncStorage.getItem(QUEUE)).toBe(storedQueue);
    expect(await Keychain.getGenericPassword()).toMatchObject({ username: USER, password: TOKEN });
  });

  test('the session ends while the question is open: the question goes, the queue stays', async () => {
    const { leaving } = await signOutWithTwoWaiting();
    fetchMock.mockResolvedValue(sessionInvalid());
    await act(() => api.get('/me').catch(() => undefined));
    await act(() => leaving);
    expect(await screen.findByText('signedOut|-|expired')).toBeTruthy();
    expect(question()).toBeNull();
    expect(await idsOnDisk()).toEqual(['a1', 'a2']);
  });
});

describe('the stand-up countdown (timing only, standup:v1:<userId>)', () => {
  const key = (user: string) => `standup:v1:${user}`;
  const kept = JSON.stringify({ remainingMs: 1_800_000, at: 1, running: false });

  test('signing out removes this user\'s countdown and nobody else\'s, after the queue', async () => {
    mount();
    await screen.findByText('signedOut|-|ok');
    await act(() => session.signIn(TOKEN, USER));
    await AsyncStorage.setItem(key(USER), kept);
    await AsyncStorage.setItem(key('someone-else'), kept);
    const order: string[] = [];
    const removeItem = AsyncStorage.removeItem.bind(AsyncStorage);
    jest.spyOn(AsyncStorage, 'removeItem').mockImplementation(async stored => {
      order.push(stored);
      return removeItem(stored);
    });
    const removeMany = AsyncStorage.removeMany.bind(AsyncStorage);
    jest.spyOn(AsyncStorage, 'removeMany').mockImplementation(async keys => {
      order.push(keys[0].split(':')[0]);
      return removeMany(keys);
    });
    await act(() => session.signOut());
    expect(order).toEqual(['cache', 'pending', key(USER), `celebrated:v1:${USER}`]);
    expect(await AsyncStorage.getItem(key(USER))).toBeNull();
    expect(await AsyncStorage.getItem(key('someone-else'))).toBe(kept);
  });

  test('a session the server ended removes it too (the countdown is not data worth keeping for the next sign-in)', async () => {
    mount();
    await screen.findByText('signedOut|-|ok');
    await act(() => session.signIn(TOKEN, USER));
    await AsyncStorage.setItem(key(USER), kept);
    fetchMock.mockResolvedValue(sessionInvalid());
    await act(() => api.get('/me').catch(() => undefined));
    expect(await screen.findByText('signedOut|-|expired')).toBeTruthy();
    expect(await AsyncStorage.getItem(key(USER))).toBeNull();
  });
});

describe('the level last celebrated (celebrated:v1:<userId>, a level number only)', () => {
  const key = (user: string) => `celebrated:v1:${user}`;

  test('signing out removes the level of this user and of nobody else', async () => {
    mount();
    await screen.findByText('signedOut|-|ok');
    await act(() => session.signIn(TOKEN, USER));
    await AsyncStorage.setItem(key(USER), '6');
    await AsyncStorage.setItem(key('someone-else'), '9');
    await act(() => session.signOut());
    expect(await AsyncStorage.getItem(key(USER))).toBeNull();
    expect(await AsyncStorage.getItem(key('someone-else'))).toBe('9');
  });

  test('a session the server ended removes it too: the next sign-in seeds it from its first profile', async () => {
    mount();
    await screen.findByText('signedOut|-|ok');
    await act(() => session.signIn(TOKEN, USER));
    await AsyncStorage.setItem(key(USER), '6');
    fetchMock.mockResolvedValue(sessionInvalid());
    await act(() => api.get('/me').catch(() => undefined));
    expect(await screen.findByText('signedOut|-|expired')).toBeTruthy();
    expect(await AsyncStorage.getItem(key(USER))).toBeNull();
  });
});
