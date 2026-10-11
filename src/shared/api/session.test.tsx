import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as Keychain from 'react-native-keychain';
import { readCache, writeCache } from '../storage/cache';
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

test('signOut revokes on the server, then clears keychain, query cache and this user cache, in that order', async () => {
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
    order.push('cache');
    return removeMany(keys);
  });

  await act(() => session.signOut());
  reset.mockImplementation(realReset);

  expect(order).toEqual(['revoke', 'keychain', 'queries', 'cache']);
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

test('signOut clears memory even when the keychain refuses to reset', async () => {
  mount();
  await screen.findByText('signedOut|-|ok');
  await act(() => session.signIn(TOKEN, USER));
  client.setQueryData(['me'], { user: { id: USER } });
  await writeCache(USER, 'me', 'x');
  (Keychain.resetGenericPassword as jest.Mock).mockRejectedValueOnce(new Error('keystore busy'));
  await act(() => session.signOut());
  expect(screen.getByText('signedOut|-|ok')).toBeTruthy();
  expect(client.getQueryData(['me'])).toBeUndefined();
  expect(await readCache(USER, 'me')).toBeUndefined();
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
