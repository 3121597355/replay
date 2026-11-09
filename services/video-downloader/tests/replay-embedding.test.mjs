import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptsReplayMessage, isReplayOrigin } from '../public/replay-origins.js';

test('rejects forged parent messages, tokens and Replay lookalike origins', () => {
  const source = {};
  const origin = 'https://www.replayen.com';
  const token = '12345678-1234-1234-1234-123456789abc';
  const event = { origin, source, data: { token, type: 'replay:theme' } };
  assert.equal(acceptsReplayMessage(event, source, origin, token), true);
  assert.equal(acceptsReplayMessage({ ...event, source: {} }, source, origin, token), false);
  assert.equal(acceptsReplayMessage({ ...event, origin: 'https://www.replayen.com.attacker.example' }, source, origin, token), false);
  assert.equal(acceptsReplayMessage({ ...event, data: { token: 'wrong' } }, source, origin, token), false);
  assert.equal(acceptsReplayMessage(event, null, origin, token), false);
  assert.equal(acceptsReplayMessage(event, source, origin, ''), false);
  assert.equal(isReplayOrigin('https://www.replayen.com/path'), false);
  assert.equal(isReplayOrigin('http://localhost:4310'), true);
});
