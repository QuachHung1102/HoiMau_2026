import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as Keychain from 'react-native-keychain';
import type { Me } from '../../../domain/contract/core.ts';
import { SessionProvider, useSession, type Session } from '../../shared/api/session';
import { readCache } from '../../shared/storage/cache';
import { useMe } from './api';

const USER = '5f0c2a8e-1d37-4a55-9c1b-0c8a4d2e7b10';
const me: Me = {
  user: { id: USER, email: 'an@example.vn', displayName: 'An', timezone: 'Asia/Ho_Chi_Minh', archetype: null, archetypeChangeAvailableAt: null, onboarded: true },
  progression: null,
  stats: null,
  pet: null,
  appearance: null,
};
const respond = (status: number, body?: unknown) => ({ ok: status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });

type Init = { signal: AbortSignal };
const fetchMock = jest.fn<Promise<unknown>, [string, Init]>();
const realFetch = globalThis.fetch;
let client: QueryClient;
let session: Session;

function Probe() {
  session = useSession();
  const query = useMe();
  return <Text>{`${session.status}|${query.data ? query.data.user.displayName : query.status}`}</Text>;
}
const mount = () =>
  render(
    <QueryClientProvider client={client}>
      <SessionProvider>
        <Probe />
      </SessionProvider>
    </QueryClientProvider>,
  );

beforeEach(async () => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await Keychain.setGenericPassword(USER, 'tok-1');
});
afterEach(async () => {
  client.clear();
  jest.restoreAllMocks();
  await Keychain.resetGenericPassword();
  await AsyncStorage.clear();
  globalThis.fetch = realFetch;
});

test('GET /me carries the query signal, so cancelling the query cancels the request', async () => {
  let sent: AbortSignal | undefined;
  fetchMock.mockImplementation((_url, init) => {
    sent = init.signal;
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('Aborted'))));
  });
  mount();
  await waitFor(() => expect(sent).toBeDefined());
  expect(sent?.aborted).toBe(false);
  screen.unmount();
  expect(sent?.aborted).toBe(true);
});

test('the answer is on screen without waiting for the disk, and a failed cache write does not fail the query', async () => {
  let finishWrite!: () => void;
  const setItem = jest.spyOn(AsyncStorage, 'setItem').mockImplementation(() => new Promise<void>((_resolve, reject) => (finishWrite = () => reject(new Error('disk full')))));
  fetchMock.mockResolvedValue(respond(200, me));
  mount();
  // shown while the write is still pending
  expect(await screen.findByText('signedIn|An')).toBeTruthy();
  expect(setItem).toHaveBeenCalledWith(`cache:v1:${USER}:me`, JSON.stringify(me));
  await act(async () => finishWrite());
  expect(screen.getByText('signedIn|An')).toBeTruthy();
});

test('an answer that arrives after sign-out is neither shown nor written to disk, even from a fetch that ignores abort', async () => {
  let answer!: (response: unknown) => void;
  fetchMock.mockImplementation(url => (url.endsWith('/auth/logout') ? Promise.resolve(respond(204)) : new Promise(resolve => (answer = resolve))));
  mount();
  await screen.findByText('signedIn|pending');
  await waitFor(() => expect(answer).toBeDefined());
  await act(() => session.signOut());
  expect(screen.getByText('signedOut|pending')).toBeTruthy();

  await act(async () => answer(respond(200, me)));
  await act(async () => undefined);
  expect(screen.getByText('signedOut|pending')).toBeTruthy();
  expect(await readCache(USER, 'me')).toBeUndefined();
  expect(await AsyncStorage.getAllKeys()).toEqual([]);
  expect(client.getQueryData(['me'])).toBeUndefined();
});
