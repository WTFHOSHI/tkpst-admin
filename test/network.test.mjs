import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchJsonWithTimeout } from '../public/network.js';
test('network deadline covers an unresponsive fetch even when abort is ignored', async () => {
  await assert.rejects(fetchJsonWithTimeout(() => new Promise(() => {}), '/test', {}, 15), error => error.code === 'timeout');
});
test('network deadline also covers stalled response JSON', async () => {
  await assert.rejects(fetchJsonWithTimeout(async () => ({ json: () => new Promise(() => {}) }), '/test', {}, 15), error => error.code === 'timeout');
});
