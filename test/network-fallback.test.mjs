import test from 'node:test';
import assert from 'node:assert/strict';
import { postApi, resetApiBase, API_BASES } from '../public/network.js';
const ok = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('admin API prefers the always-on address and falls back only when it is unreachable', async () => {
  resetApiBase();
  const calls = [];
  const result = await postApi(async url => { calls.push(url); if (url.startsWith(API_BASES[0])) throw new TypeError('Failed to fetch'); return ok({ users: [] }); }, 'users', { method: 'POST' });
  assert.deepEqual(calls, [API_BASES[0] + 'users', API_BASES[1] + 'users']);
  assert.deepEqual(result.data, { users: [] });
  // The working address is remembered, so later calls do not wait on the broken one again.
  await postApi(async url => { calls.push(url); return ok({}); }, 'link', { method: 'POST' });
  assert.equal(calls.at(-1), API_BASES[1] + 'link');
});

test('an error answer (even 503) is returned as it is and never replayed on the reserve address', async () => {
  resetApiBase();
  let calls = 0;
  const result = await postApi(async () => { calls++; return new Response('{"error":"x"}', { status: 503 }); }, 'attendance/sync', { method: 'POST' });
  assert.equal(calls, 1);
  assert.equal(result.response.status, 503);
});

test('a timeout is never replayed on the reserve address', async () => {
  resetApiBase();
  let calls = 0;
  await assert.rejects(postApi(() => { calls++; return new Promise(() => {}); }, 'sync', { method: 'POST' }, { timeouts: [20, 20] }), /не ответил вовремя/);
  assert.equal(calls, 1);
  resetApiBase();
});

test('ordinary API errors such as 401 are returned as they are', async () => {
  resetApiBase();
  let calls = 0;
  const result = await postApi(async () => { calls++; return new Response('{"error":"Нужен вход"}', { status: 401 }); }, 'users', { method: 'POST' });
  assert.equal(calls, 1); assert.equal(result.response.status, 401);
});
