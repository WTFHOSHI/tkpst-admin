import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsersClient, usersMarkup } from '../public/users-client.js';

test('users: token is sent only to fixed API, never cookies, logout revokes and clears', async () => {
  const calls = [];
  const client = createUsersClient(async (url, init) => { calls.push({ url, init }); return Response.json(url.endsWith('/login') ? { token: 'secret-token' } : { users: [] }); });
  await client.login('admin password'); await client.request('users', {});
  assert.equal(calls[1].url, 'https://tkpst-api.onrender.com/api/admin/users');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer secret-token');
  assert.equal(calls[1].init.credentials, 'omit');
  assert.equal(calls[1].init.cache, 'no-store');
  await client.logout(); assert.equal(client.authorized(), false);
  assert.equal(calls[2].init.headers.Authorization, 'Bearer secret-token');
  await assert.rejects(client.request('https://evil.example'), /адрес/i);
});

test('users: 401 clears authorization, late login cannot restore a cleared session', async () => {
  let resolve;
  const client = createUsersClient(() => new Promise(r => { resolve = r; }));
  const login = client.login('password'); client.clear(); resolve(Response.json({ token: 'late-token' })); await login;
  assert.equal(client.authorized(), false);
  const expired = createUsersClient(async url => Response.json(url.endsWith('/login') ? { token: 'token' } : { error: 'Истёк вход' }, { status: url.endsWith('/login') ? 200 : 401 }));
  await expired.login('password'); await assert.rejects(expired.request('users'), /Истёк/); assert.equal(expired.authorized(), false);
});

test('users: real empty state, escaped names, explicit linking with roster course', () => {
  assert.match(usersMarkup({ users: [], students: [], total: 0, nextOffset: null }), /Пока никто не зарегистрировался/);
  const html = usersMarkup({ users: [{ id: 'a', username: 'login', displayName: '<script>', createdAt: 1, student: null }], students: [{ id: 's', course: '2', displayName: 'Студент', groupName: 'ИС', active: true }], total: 1, nextOffset: null });
  assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;'));
  assert.match(html, /2:s/); assert.match(html, /Подтвердить привязку/);
  assert.ok(html.indexOf('data-delete-user') < html.indexOf('</details>'), 'delete stays inside the expanded account card');
});
test('users: role switch clears bearer immediately and late logout cannot clear a new login', async () => {
  let finish;
  const headers = [];
  const client = createUsersClient(async (url, init) => {
    headers.push(init.headers);
    if (url.endsWith('/logout')) return new Promise(resolve => { finish = resolve; });
    return Response.json({ token: 'new-token' });
  });
  await client.login('first'); const pending = client.logout();
  assert.equal(client.authorized(), false);
  await client.request('users'); assert.equal(headers.at(-1).Authorization, undefined);
  await client.login('second'); finish(new Response(null, { status: 204 })); await pending;
  assert.equal(client.authorized(), true);
});
