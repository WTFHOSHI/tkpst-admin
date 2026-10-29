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
let cloudLogins = 0;
let cloudBlocked = false;
let cloudRejected = false;
let deferCloud = false, releaseCloud;
const cloudToken = 'a'.repeat(43);
const commits = [];
const attendanceToken = 'w'.repeat(43), attendanceCalls = [], attendanceOrder = [];
let attendanceFail = false, attendanceStartHook = null;
let attendanceTicket = 0;
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: new Map() });
globalThis.fetch = async (url, init = {}) => {
  if (String(url).startsWith('https://tkpst-api.onrender.com/api/admin/attendance/')) {
    if (cloudBlocked) return new Promise(() => {});
    const path = String(url).split('/').at(-1), body = JSON.parse(init.body || '{}');
    attendanceCalls.push({ path, body, auth: init.headers.Authorization }); attendanceOrder.push(path);
    if (path === 'login') return reply(200, { token: attendanceToken, expiresAt: Date.now() + 864e5 });
    assert.ok(['Bearer ' + attendanceToken, 'Bearer ' + cloudToken].includes(init.headers.Authorization));
    if (path === 'start') { if (attendanceStartHook) await attendanceStartHook(); return reply(200, { ticket: String(++attendanceTicket).padStart(43, 't') }); }
    if (path === 'sync' && attendanceFail) return reply(503, { error: 'Synthetic sync failure' });
    return reply(200, { ok: true, syncedAt: Date.now() });
  }
  if (String(url).startsWith('https://tkpst-api.onrender.com/api/admin/')) {
    if (cloudBlocked) return new Promise(() => {});
    if (deferCloud && url.endsWith('/login')) return new Promise(resolve => { releaseCloud = resolve; });
    if (url.endsWith('/login')) { cloudLogins++; return reply(200, { token: cloudToken, expiresAt: Date.now() + 864e5 }); }
    assert.equal(init.headers.Authorization, 'Bearer ' + cloudToken);
    if (cloudRejected) return reply(401, { error: 'Revoked fixture token' });
    return reply(200, { ok: true });
  }
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
  if (path.startsWith('w/')) attendanceOrder.push('read:' + path);
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

test('вход администратора и старосты сохраняется без срока, выход очищает доступ', async () => {
  await assert.rejects(B.api('me'), (e) => e.status === 401);
  await assert.rejects(B.api('login', { password: 'nope-nope-nope' }), (e) => e.status === 401);
  const r = await B.api('login', { password: passwords.starosta, remember: true });
  assert.equal(r.role, 'starosta');
  const saved = JSON.parse(localStorage.getItem('admin_session'));
  assert.equal(saved.exp, undefined);
  assert.equal(sessionStorage.getItem('admin_session'), null);
  B.logout();
  assert.equal(localStorage.getItem('admin_session'), null);
  assert.equal(B.loggedIn(), false);
  await B.api('login', { password: passwords.admin, remember: false });
  assert.ok(localStorage.getItem('admin_session'));
  assert.equal(sessionStorage.getItem('admin_session'), null);
});

test('общий вход: admin server session is persisted with vault role and reused without password', async () => {
  B.logout(); const before = cloudLogins;
  await B.api('login', { password: passwords.admin, remember: true });
  assert.equal(cloudLogins, before + 1);
  const saved = JSON.parse(localStorage.getItem('admin_session'));
  assert.ok(!JSON.stringify(saved).includes(passwords.admin));
  await B.usersApi('users'); assert.equal(cloudLogins, before + 1);
  assert.equal(JSON.parse(localStorage.getItem('admin_session')).cloud.token, cloudToken);
  const reloaded = await import('../public/backend.js?shared-session-reload');
  assert.equal(reloaded.panelReady(), true);
  await reloaded.usersApi('users'); assert.equal(cloudLogins, before + 1, 'reload reuses saved bearer');
  B.logout(); assert.equal(localStorage.getItem('admin_session'), null);
  await assert.rejects(B.usersApi('users'), e => e.status === 401);
  await B.api('login', { password: passwords.kurator });
  assert.equal(cloudLogins, before + 1, 'curator uses existing vault only');
  await assert.rejects(B.usersApi('users'), e => e.status === 403);
  await B.api('login', { password: passwords.admin });
});
test('blocked LK server never blocks vault login, schedule or attendance', async () => {
  B.logout(); cloudBlocked = true;
  try {
    const login = await Promise.race([B.api('login', { password: passwords.admin }), new Promise((_, reject) => setTimeout(() => reject(new Error('login blocked by LK')), 100))]);
    assert.equal(login.role, 'admin'); assert.equal(B.panelReady(), true);
    assert.equal((await B.api('me')).role, 'admin');
    assert.ok((await B.api('config')).courses);
  } finally { B.logout(); cloudBlocked = false; }
  await B.api('login', { password: passwords.admin });
});
test('background LK completion never overwrites a replacement session in another tab', async () => {
  deferCloud = true;
  try {
    await B.api('login', { password: passwords.admin, remember: false });
    localStorage.setItem('admin_session', JSON.stringify({ role: 'kurator', gh: 'other-tab', dk: 'other-key' }));
    releaseCloud(reply(200, { token: cloudToken, expiresAt: Date.now() + 864e5 }));
    await assert.rejects(B.usersApi('users'), error => [401, 503].includes(error.status));
    assert.ok(!localStorage.getItem('admin_session') || JSON.parse(localStorage.getItem('admin_session')).role === 'kurator');
    assert.equal(sessionStorage.getItem('admin_session'), null);
  } finally { deferCloud = false; B.logout(); }
  await B.api('login', { password: passwords.admin });
});
test('expired cloud access preserves the permanent panel session', async () => {
  await B.api('login', { password: passwords.admin });
  await B.usersApi('users');
  const realNow = Date.now;
  Date.now = () => realNow() + 30 * 864e5;
  try {
    await assert.rejects(B.usersApi('users'), error => error.status === 503 && error.code === 'cloud_unavailable');
    assert.equal(B.panelReady(), true);
    assert.equal(B.currentRole(), 'admin');
  } finally { Date.now = realNow; }
  await B.api('login', { password: passwords.admin });
});
test('revoked server bearer only disconnects LK and keeps schedule session saved', async () => {
  await B.api('login', { password: passwords.admin }); await B.usersApi('users');
  cloudRejected = true;
  try {
    await assert.rejects(B.usersApi('users'), e => e.code === 'cloud_unavailable');
    assert.equal(B.panelReady(), true);
    assert.equal(JSON.parse(localStorage.getItem('admin_session')).role, 'admin');
    assert.equal(JSON.parse(localStorage.getItem('admin_session')).cloud, undefined);
  } finally { cloudRejected = false; }
  await B.api('login', { password: passwords.admin });
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
test('student permanent deletion is admin-only, confirmed and cannot be restored', async () => {
  await B.api('login', { password: passwords.admin });
  const cfg = await B.api('students', { course: '2', action: 'add', name: 'Удаляемый Тестовый Студент' });
  const student = cfg.courses[2].students.find(s => s.name === 'Удаляемый Тестовый Студент');
  const body = { course: '2', action: 'delete', id: student.id, confirmName: student.name, to: '2026-10-26' };
  await B.api('login', { password: passwords.kurator });
  await assert.rejects(B.api('students', body), e => e.status === 403);
  await B.api('login', { password: passwords.admin });
  await assert.rejects(B.api('students', { ...body, confirmName: 'Неверное имя' }));
  const next = await B.api('students', body);
  const tombstone = next.courses[2].students.find(s => s.id === student.id);
  assert.equal(tombstone.name, 'Удалённый студент'); assert.equal(tombstone.deleted, true);
  assert.equal(tombstone.to, '2026-10-26');
  assert.ok(!JSON.stringify(next).includes(student.name));
  await assert.rejects(B.api('students', { course: '2', action: 'restore', id: student.id }));
});


test('attendance writers: every vault role sends a scoped minimal authoritative snapshot after reserving ticket', async () => {
  for (const role of ['admin', 'starosta', 'kurator']) {
    await B.api('login', { password: passwords[role] });
    attendanceOrder.length = 0;
    await B.syncAttendanceWeek('2', '2026-10-05', { force: true, knownWeek: { m: { stale: {} } } });
    assert.ok(attendanceOrder.indexOf('start') < attendanceOrder.indexOf('read:w/2/2026-10-05.json'));
    const call = attendanceCalls.filter(c => c.path === 'sync').at(-1);
    assert.equal(call.auth, 'Bearer ' + attendanceToken);
    assert.deepEqual(Object.keys(call.body).sort(), ['course', 'monday', 'ticket', 'week']);
    assert.ok(!call.body.week.m.stale);
    const wire = JSON.stringify(call.body);
    for (const secret of ['gh-test-key', ...Object.values(passwords), JSON.parse((role === 'kurator' ? sessionStorage : localStorage).getItem('admin_session')).dk]) assert.ok(!wire.includes(secret));
  }
});

test('attendance sync failure preserves successful authoritative marks and can retry without saving again', async () => {
  attendanceFail = true;
  try {
    const saved = await B.api('marks', { course: '1', w: '2026-10-19', changes: [{ s: 'synthetic', d: '2026-10-20', p: 1, v: 'P' }] });
    assert.equal(saved.m.synthetic['2026-10-20'][1], 'P');
    await assert.rejects(B.syncAttendanceWeek('1', '2026-10-19', { force: true }), /Synthetic sync failure/);
  } finally { attendanceFail = false; }
  const writes = commits.length;
  await B.syncAttendanceWeek('1', '2026-10-19', { force: true });
  assert.equal(commits.length, writes);
  assert.equal(attendanceCalls.filter(c => c.path === 'sync').at(-1).body.week.m.synthetic['2026-10-20'][1], 'P');
});

test('attendance logout discards in-flight ticket before publishing', async () => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  attendanceStartHook = async () => { entered(); await new Promise(resolve => { release = resolve; }); };
  const before = attendanceCalls.filter(c => c.path === 'sync').length;
  const pending = B.syncAttendanceWeek('2', '2026-10-05', { force: true });
  await started; B.logout(); release();
  await assert.rejects(pending, error => error.status === 409);
  attendanceStartHook = null;
  assert.equal(attendanceCalls.filter(c => c.path === 'sync').length, before);
  await B.api('login', { password: passwords.admin });
});

test('attendance history includes empty clearing snapshots and is reset after logout', async () => {
  await B.writeData('w/3/2026-10-12.json', { m: {}, pairs: {}, hide: {}, at: '', by: '' });
  const result = await B.syncAttendanceHistory('3', { force: true });
  assert.equal(result.failed, 0); assert.equal(result.done, result.total); assert.ok(result.total >= 2);
  const cleared = attendanceCalls.filter(c => c.path === 'sync' && c.body.monday === '2026-10-12').at(-1);
  assert.deepEqual(cleared.body.week.m, {});
  const before = attendanceCalls.filter(c => c.path === 'sync').length;
  await B.syncAttendanceHistory('3'); assert.equal(attendanceCalls.filter(c => c.path === 'sync').length, before);
  B.logout(); await B.api('login', { password: passwords.starosta });
  await B.syncAttendanceHistory('3'); assert.ok(attendanceCalls.filter(c => c.path === 'sync').length > before);
});
