/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

// Tasks 49 and 50 render every preview entry in Jest, so each entries file must import cleanly and let Jest exit.
// A module-scope QueryClient (gc timer) or any other open handle would hang this suite without --forceExit.
const dir = path.join(__dirname, '../tools/preview/entries');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.tsx'));

test('there are entries files to import', () => {
  expect(files).toEqual(expect.arrayContaining(['demo.tsx', 'kit.tsx']));
});

test.each(files)('%s imports under Jest and exports thunks', file => {
  const { entries } = require(path.join(dir, file));
  expect(Object.keys(entries).length).toBeGreaterThan(0);
  for (const make of Object.values(entries)) expect(typeof make).toBe('function');
});
