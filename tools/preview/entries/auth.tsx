import { withApp, type Entries } from '../harness';

const session = { userId: '5f0c2a8e-1d37-4a55-9c1b-0c8a4d2e7b10' };
// The gate decides before any route shows, so the route named here only matters once a tab root exists.
const gate = { session, route: { name: 'Today' } } as const;

export const entries: Entries = {
  's01-welcome': () => withApp(null, { session: null, route: { name: 'Welcome' } }),
  // GET /me never answers (it only ends when the query is cancelled): the session gate stays on its loading state.
  's39-loading': () =>
    withApp(null, {
      ...gate,
      fetchStub: (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    }),
  // No fetch stub = no network, and nothing is cached: the gate shows the load error with both ways forward.
  's39-error': () => withApp(null, gate),
};
