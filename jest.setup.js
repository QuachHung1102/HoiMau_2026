/* eslint-env jest */
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
notifyManager.setScheduler(callback =>
  setTimeout(() => {
    if (globalThis.IS_REACT_ACT_ENVIRONMENT && reactInternals.actQueue === null) React.act(() => callback());
    else callback();
  }, 0),
);
