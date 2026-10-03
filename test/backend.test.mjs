// Проверка «сервера в браузере» (backend.js): сейф, шифрование, адреса старого API — на поддельном GitHub.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
globalThis.localStorage = mem();
globalThis.sessionStorage = mem();

// Поддельный GitHub: файлы репозиториев + vault.json рядом со страницей.
const files = new Map();     // 'repo/path' → {text, sha}
let shaN = 0;
let vaultText = null;
const commits = [];
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: new Map() });
globalThis.fetch = async (url, init = {}) => {
  if (url === 'vault.json') return vaultText ? reply(200, JSON.parse(vaultText)) : reply(404, null);
  const u = new URL(url);
  assert.equal(init.headers.Authorization, 'Bearer gh-test-key');
  let m = u.pathname.match(/^\/repos\/WTFHOSHI\/([^/]+)$/);
  if (m) return reply(200, { private: m[1] === 'tkpst-admin-data', permissions: { push: true } });
  m = u.pathname.match(/^\/repos\/WTFHOSHI\/([^/]+)\/contents\/(.+)$/);
  const repo = m[1]; const path = decodeURIComponent(m[2]); const key = repo + '/' + path;
  if (init.method === 'PUT') {
    const b = JSON.parse(init.body);
    const cur = files.get(key);
    if (cur && b.sha !== cur.sha) return reply(409, { message: 'conflict' });
    if (!cur && b.sha) return reply(409, { message: 'conflict' });
    const sha = 'sha' + (++shaN);
    files.set(key, { text: Buffer.from(b.content, 'base64').toString('utf8'), sha });
    commits.push({ repo, path, message: b.message });
    return reply(200, { content: { sha } });
  }
  const f = files.get(key);
  if (f) return reply(200, { content: Buffer.from(f.text).toString('base64').replace(/(.{60})/g, '$1\n'), sha: f.sha });
  const dir = [...files.keys()].filter((k) => k.startsWith(key + '/')).map((k) => ({ name: k.slice(key.length + 1) }));
  return dir.length ? reply(200, dir) : reply(404, { message: 'Not Found' });
};

const B = await import('../public/backend.js');
const passwords = { admin: 'admin-pass-123', starosta: 'starosta-pass-456', kurator: 'kurator-pass-789' };

test('сейф: роли по паролям, неверный пароль', async () => {
  const dk = B.newDataKey();
  const vault = await B.makeVault({ passwords, gh: 'gh-test-key', dk, iter: 1000 });
  assert.ok(!JSON.stringify(vault).includes('gh-test-key'));
  assert.ok(!JSON.stringify(vault).includes(dk));
  assert.equal((await B.openVault(vault, 'kurator-pass-789')).role, 'kurator');
  assert.equal((await B.openVault(vault, 'admin-pass-123')).dk, dk);
  assert.equal(await B.openVault(vault, 'wrong-password'), null);
  vaultText = JSON.stringify(vault);
});

test('вход, запоминание на 1 день, выход', async () => {
  await assert.rejects(B.api('me'), (e) => e.status === 401);
  await assert.rejects(B.api('login', { password: 'nope-nope-nope' }), (e) => e.status === 401);
  const r = await B.api('login', { password: passwords.starosta, remember: true });
  assert.equal(r.role, 'starosta');
  const saved = JSON.parse(localStorage.getItem('admin_session'));
  assert.ok(saved.exp > Date.now() + 864e5 - 5000 && saved.exp <= Date.now() + 864e5);
  assert.equal(sessionStorage.getItem('admin_session'), null);
  B.logout();
  assert.equal(localStorage.getItem('admin_session'), null);
  assert.equal(B.loggedIn(), false);
  await B.api('login', { password: passwords.admin, remember: false });
  assert.ok(sessionStorage.getItem('admin_session'));
  assert.equal(localStorage.getItem('admin_session'), null);
});

test('студенты и отметки зашифрованы в приватном репозитории', async () => {
  const c = await B.api('students', { course: '2', action: 'add', name: 'иванов иван иванович' });
  const sid = c.courses[2].students[0].id;
  const raw = files.get('tkpst-admin-data/config.json').text;
  assert.ok(!raw.includes('Иванов'), 'ФИО не должно лежать открытым текстом');
  assert.equal((await B.api('config')).courses[2].students[0].name, 'Иванов Иван Иванович');

  const w = await B.api('marks', { course: '2', w: '2026-09-28', changes: [{ s: sid, d: '2026-09-29', p: 2, v: 'N' }] });
  assert.equal(w.m[sid]['2026-09-29'][2], 'N');
  assert.equal(w.by, 'Администратор');
  assert.ok(!files.get('tkpst-admin-data/w/2/2026-09-28.json').text.includes(sid));
  assert.equal((await B.api('week?course=2&w=2026-09-28')).m[sid]['2026-09-29'][2], 'N');
  assert.deepEqual((await B.api('week?course=2&w=2026-10-05')).m, {});
  await assert.rejects(B.api('week?course=2&w=2026-09-29'), /Неверная неделя/);

  await B.api('marks', { course: '2', w: '2026-10-05', changes: [{ s: sid, d: '2026-10-06', p: 1, v: 'P' }] });
  const all = await B.api('weeks?course=2');
  assert.deepEqual(Object.keys(all.weeks), ['2026-09-28', '2026-10-05']);
  assert.deepEqual(Object.keys((await B.api('weeks?course=2&from=2026-10-01')).weeks), ['2026-10-05']);
  assert.deepEqual((await B.api('weeks?course=1')).weeks, {});
});

test('подменить файл другим нельзя (привязка к адресу)', async () => {
  const a = files.get('tkpst-admin-data/w/2/2026-09-28.json');
  const b = files.get('tkpst-admin-data/w/2/2026-10-05.json');
  const saved = b.text;
  b.text = a.text;
  await assert.rejects(B.api('week?course=2&w=2026-10-05'), (e) => e.code === 'bad_key');
  b.text = saved;
});

test('права ролей: куратор не меняет настройки и не импортирует', async () => {
  B.logout();
  await B.api('login', { password: passwords.kurator });
  await assert.rejects(B.api('course', { course: '1', groupId: 5 }), (e) => e.status === 403);
  await assert.rejects(B.api('import', { course: '2', weeks: {} }), (e) => e.status === 403);
  const c = await B.api('students', { course: '2', action: 'add', name: 'Петров Пётр' });
  assert.equal(c.courses[2].students.length, 2);
});

test('изменения расписания пишутся в tkpst-schedule открытым текстом', async () => {
  const f0 = await B.api('overrides');
  assert.equal(f0.text, '{}');
  const r = await B.api('overrides', { text: '{"announcement":"Привет"}', sha: f0.sha });
  assert.ok(r.sha);
  assert.equal(files.get('tkpst-schedule/web/overrides.json').text, '{"announcement":"Привет"}');
  assert.match(commits.at(-1).message, /Куратор/);
  await assert.rejects(B.api('overrides', { text: '{}', sha: 'old' }), (e) => e.code === 'conflict');
});

test('импорт старой таблицы и перенос данных', async () => {
  B.logout();
  await B.api('login', { password: passwords.starosta });
  const r = await B.api('import', { course: '3', weeks: { '2026-09-28': { 'Сидоров Сидор': { '2026-09-28': { 1: 'B' } } } } });
  assert.equal(r.added, 1);
  assert.equal(r.marks, 1);
  const sid = r.config.courses[3].students[0].id;
  assert.equal((await B.api('week?course=3&w=2026-09-28')).m[sid]['2026-09-28'][1], 'B');
  await B.writeData('w/1/2026-09-07.json', { m: { x: { '2026-09-08': { 3: 'U' } } }, pairs: {}, hide: {}, at: '', by: '' });
  assert.equal((await B.api('week?course=1&w=2026-09-07')).m.x['2026-09-08'][3], 'U');
});

test('одновременные записи не теряются', async () => {
  const sid = 'sX';
  await Promise.all([1, 2, 3].map((p) => B.api('marks', { course: '1', w: '2026-09-14', changes: [{ s: sid, d: '2026-09-15', p, v: 'P' }] })));
  assert.deepEqual(Object.keys((await B.api('week?course=1&w=2026-09-14')).m[sid]['2026-09-15']).sort(), ['1', '2', '3']);
});
