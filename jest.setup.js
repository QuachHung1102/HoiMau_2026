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
