import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Keychain from 'react-native-keychain';
import { clearUserCache } from '../storage/cache';
import { api, bindApiSession } from './client';

export type Session = {
  status: 'loading' | 'signedOut' | 'signedIn';
  userId: string | null;
  /** True after the server ended the session (401 SESSION_INVALID) until the next signIn or signOut: SignIn shows the notice. */
  expired: boolean;
  signIn(token: string, userId: string): Promise<void>;
  signOut(): Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession needs a SessionProvider above it');
  return session;
}

const bestEffort = (step: Promise<unknown>) => step.catch(() => undefined);

/**
 * `queryClient.clear()` that leaves no timer behind. An entry removed while a mounted screen still uses it would
 * start its garbage-collection timer (5 min) when that screen unmounts, with nothing left to cancel it; entries
 * that are being dropped anyway need no collection.
 */
export function wipeQueries(queryClient: QueryClient) {
  for (const entry of [...queryClient.getQueryCache().getAll(), ...queryClient.getMutationCache().getAll()]) entry.gcTime = Infinity;
  queryClient.clear();
}

/**
 * The session lives here: the token only in the keychain (and in the client's memory while signed in), never in
 * AsyncStorage, a query, a log or an error. Needs a QueryClientProvider above it.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<Pick<Session, 'status' | 'userId' | 'expired'>>({ status: 'loading', userId: null, expired: false });
  const userIdRef = useRef<string | null>(null);
  const leaving = useRef<Promise<void> | null>(null);

  // One flight for every way out: a second signOut, or a 401 that arrives while signing out, joins the first.
  const leave = useCallback(
    (expired: boolean) => {
      leaving.current ??= (async () => {
        const userId = userIdRef.current;
        if (userId && !expired) {
          // Revoke on the server while the token is still bound. Best effort: signing out must work offline, so a
          // failure or a timeout (the client's 10 s) just continues on the device.
          await bestEffort(api.write('POST', '/auth/logout'));
        }
        userIdRef.current = null;
        bindApiSession(null);
        await bestEffort(Keychain.resetGenericPassword());
        wipeQueries(queryClient); // also cancels what is in flight, before the disk cache goes
        if (userId) await bestEffort(clearUserCache(userId));
        setState({ status: 'signedOut', userId: null, expired });
      })().finally(() => {
        leaving.current = null;
      });
      return leaving.current;
    },
    [queryClient],
  );

  const enter = useCallback(
    (token: string, userId: string) => {
      userIdRef.current = userId;
      bindApiSession({
        token,
        onInvalid: () => {
          leave(true);
        },
      });
      setState({ status: 'signedIn', userId, expired: false });
    },
    [leave],
  );

  useEffect(() => {
    let current = true;
    Keychain.getGenericPassword()
      .catch(() => false as const)
      .then(stored => {
        if (!current || userIdRef.current) return;
        if (stored && stored.username && stored.password) enter(stored.password, stored.username);
        else setState({ status: 'signedOut', userId: null, expired: false });
      });
    return () => {
      current = false;
      bindApiSession(null);
    };
  }, [enter]);

  const session = useMemo<Session>(
    () => ({
      ...state,
      async signIn(token, userId) {
        await Keychain.setGenericPassword(userId, token);
        enter(token, userId);
      },
      signOut: () => leave(false),
    }),
    [state, enter, leave],
  );
  return createElement(SessionContext.Provider, { value: session }, children);
}
