// npm run test:e2e: the real app tree against the running dev server (E2E_BASE_URL). Never part of `npm test`.
const base = require('./jest.config');

module.exports = {
  ...base,
  testPathIgnorePatterns: base.testPathIgnorePatterns.filter(pattern => pattern !== '/__tests__/e2e/'),
  testMatch: ['<rootDir>/__tests__/e2e/**/*.e2e.test.tsx'],
};
