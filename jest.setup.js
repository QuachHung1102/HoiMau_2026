/* eslint-env jest, es2020 */
// Official mocks for native modules (see each library's Jest docs).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest'),
);

// react-native-keychain: in-memory stand-in for the generic-password API.
jest.mock('react-native-keychain', () => {
  let stored = false;
  let creds = { username: '', password: '' };
  return {
    setGenericPassword: jest.fn(async (username, password) => {
      stored = true;
      creds = { username, password };
      return { service: 'mock', storage: 'mock' };
    }),
    getGenericPassword: jest.fn(async () =>
      stored ? { ...creds, service: 'mock', storage: 'mock' } : false,
    ),
    resetGenericPassword: jest.fn(async () => {
      stored = false;
      return true;
    }),
  };
});

// SafeAreaProvider renders nothing until the native side reports insets.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// TanStack Query hands every change of a query to its observers on a timer of its own (`setTimeout(cb, 0)`). A read that
// finishes after a test's last await (the stand-up reminder reads the day in every onboarded shell) used to re-render a
// screen in the gap before testing-library's cleanup, outside act(), and React reported it against that test. The
// notification is delivered inside act() instead, wherever the timer fires; inside an act scope already open it is
// delivered as it is. Not while testing-library is waiting (`findBy…` / `waitFor` switch the act environment off).
const React = require('react');
const { notifyManager } = require('@tanstack/react-query');
const reactInternals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
// A private field: if a React upgrade renames it, `actQueue === null` is never true again and every notification is
// delivered outside act() as before, silently. Stop here instead.
if (reactInternals === null || typeof reactInternals !== 'object' || !('actQueue' in reactInternals)) {
  throw new Error(
    "jest.setup.js: React's client internals have no `actQueue` any more (React upgrade?). The TanStack notification " +
      'scheduler in this file reads it to deliver query updates inside act(); find the new way to tell "an act scope ' +
      'is open" and update the scheduler before running the suite.',
  );
}
notifyManager.setScheduler(callback =>
  setTimeout(() => {
    if (globalThis.IS_REACT_ACT_ENVIRONMENT && reactInternals.actQueue === null) React.act(() => callback());
    else callback();
  }, 0),
);
