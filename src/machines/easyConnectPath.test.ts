import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isPublicRelayName, readEasyConnectPath } from './easyConnectPathModel';

test('reads the bridge path and refuses anything else', () => {
  assert.deepEqual(readEasyConnectPath('{"path":"direct","route":"lan","relay":"relay-eu.ghostex.dev"}'), {
    path: 'direct',
    route: 'lan',
    relay: 'relay-eu.ghostex.dev',
  });
  assert.deepEqual(readEasyConnectPath('{"path":"relay","relay":"region 903","latencyMs":40}'), {
    path: 'relay',
    route: undefined,
    relay: 'region 903',
  });
  assert.equal(readEasyConnectPath(''), null);
  assert.equal(readEasyConnectPath('{"path":"sideways"}'), null);
  assert.equal(readEasyConnectPath('nope'), null);
});

test('names public relays apart from ours', () => {
  assert.equal(isPublicRelayName('region 903'), true);
  assert.equal(isPublicRelayName('relay-eu.ghostex.dev'), false);
});
