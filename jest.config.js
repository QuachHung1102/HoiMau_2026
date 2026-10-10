module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // lucide-react-native resolves to .mjs under the "react-native" condition.
  transform: { '^.+\\.mjs$': 'babel-jest' },
  // These packages ship ESM only; the preset transforms just react-native* ones.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-async-storage|@react-navigation|lucide-react-native)/)',
  ],
};
