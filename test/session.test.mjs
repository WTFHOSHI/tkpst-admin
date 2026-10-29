import test from 'node:test';
import assert from 'node:assert/strict';
const memory = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }; };
globalThis.localStorage = memory(); globalThis.sessionStorage = memory();
const key = 'admin_session', secret = role => ({ role, gh: 'fixture', dk: 'fixture-key' });
let version = 0;
const reload = () => import('../public/backend.js?session-' + ++version);

test('admin/starosta survive a browser restart and passage of years without storing a password', async () => {
  for (const role of ['admin', 'starosta']) {
    const app = await reload(); app.startSession(secret(role), false);
    assert.equal(JSON.parse(localStorage.getItem(key)).exp, undefined);
    assert.equal(sessionStorage.getItem(key), null);
    globalThis.sessionStorage = memory();
    const realNow = Date.now; Date.now = () => realNow() + 10 * 365 * 864e5;
    try { assert.equal((await reload()).currentRole(), role); } finally { Date.now = realNow; }
    app.logout(); assert.equal((await reload()).panelReady(), false);
  }
});
test('curator stays in this tab only even when legacy callers request remember', async () => {
  const app = await reload(); app.startSession(secret('kurator'), true);
  assert.equal(localStorage.getItem(key), null);
  assert.equal((await reload()).currentRole(), 'kurator');
  globalThis.sessionStorage = memory();
  assert.equal((await reload()).panelReady(), false);
});
test('legacy privileged sessions migrate to persistent storage; legacy persistent curator is discarded', async () => {
  for (const role of ['admin', 'starosta']) {
    globalThis.localStorage = memory(); globalThis.sessionStorage = memory();
    sessionStorage.setItem(key, JSON.stringify({ ...secret(role), exp: 1 }));
    assert.equal((await reload()).currentRole(), role);
    assert.equal(JSON.parse(localStorage.getItem(key)).exp, undefined);
    assert.equal(sessionStorage.getItem(key), null);
  }
  globalThis.localStorage = memory(); globalThis.sessionStorage = memory();
  localStorage.setItem(key, JSON.stringify(secret('kurator')));
  assert.equal((await reload()).panelReady(), false);
  assert.equal(localStorage.getItem(key), null);
});
