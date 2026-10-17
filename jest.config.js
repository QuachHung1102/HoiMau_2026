module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // server/ and domain/ run on node:test; tools/, design/ and .superpowers/ (agent scratch) are not app code;
  // __tests__/e2e/ needs the running dev server (npm run test:e2e, jest.e2e.config.js).
  testPathIgnorePatterns: [
    '/node_modules/',
    '/server/',
    '/domain/',
    '/tools/',
    '/design/',
    '/android/',
    '/ios/',
    '/.superpowers/',
    '/__tests__/e2e/',
  ],
  modulePathIgnorePatterns: ['<rootDir>/server/', '<rootDir>/.superpowers/'],
  // lucide-react-native resolves to .mjs under the "react-native" condition.
  transform: { '^.+\\.mjs$': 'babel-jest' },
  // These packages ship ESM only; the preset transforms just react-native* ones.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-async-storage|@react-navigation|lucide-react-native)/)',
  ],
};
