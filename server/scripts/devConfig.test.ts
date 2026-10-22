import assert from 'node:assert/strict';
import { test } from 'node:test';
import { devConfig } from './devConfig.ts';

test('the development server loads its own configuration, on the dev cluster, whatever NODE_ENV the shell has', () => {
  for (const NODE_ENV of [undefined, 'production', 'staging']) {
    const config = devConfig({ NODE_ENV });
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.port, 8787);
    assert.match(config.databaseUrl, /@127\.0\.0\.1:54330\/hoimau$/);
    assert.equal(config.journalKey.length, 32);
  }
  assert.equal(devConfig({ PORT: '9000' }).port, 9000);
});
