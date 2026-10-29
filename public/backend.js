// «Сервер» админ-панели прямо в браузере. Своего сервера больше нет (Netlify в России без VPN не открывается):
// панель лежит на GitHub Pages, а данные — в ПРИВАТНОМ репозитории tkpst-admin-data, и там они ЗАШИФРОВАНЫ.
//
// Как это устроено:
//  • vault.json (лежит рядом со страницей, публичный) — «сейф». На каждую роль (администратор, староста, куратор)
//    в нём одна запись, зашифрованная её паролем (PBKDF2 → AES-GCM). Внутри записи: ключ GitHub и ключ данных.
//    Самих паролей нигде нет. Без пароля сейф — бесполезный набор символов.
//  • Ключ данных (AES-256) шифрует каждый файл в tkpst-admin-data: ФИО и отметки там не читаются даже владельцем
//    репозитория. Расшифровка — только в браузере после входа.
//  • Ключ GitHub — fine-grained, доступ только к tkpst-admin-data и tkpst-schedule (Contents: Read and write).
//
// api(path, body) повторяет адреса и ответы старого сервера (/api/...), поэтому вкладки почти не менялись.
import {
  ROLES, COURSES, isIso, isMonday, defaultConfig, studentOp, courseOp, emptyWeek, applyMarks, prepareImport,
} from './att-logic.js?v=__V__';
import { createUsersClient } from './users-client.js?v=__V__';
import { createAttendanceClient } from './attendance-client.js?v=__V__';
import { fetchJsonWithTimeout } from './network.js?v=__V__';

export const OWNER = 'WTFHOSHI';
export const DATA_REPO = 'tkpst-admin-data';
export const SCHEDULE_REPO = 'tkpst-schedule';
const OVERRIDES = 'web/overrides.json';
const GH = 'https://api.github.com';
const SESSION_KEY = 'admin_session';
export const KDF_ITER = 600000;        // PBKDF2-SHA256: подбор пароля по украденному сейфу очень медленный

// ---------------- Шифрование ----------------

const te = new TextEncoder();
const td = new TextDecoder();
export const b64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = (s) => Uint8Array.from(atob(String(s).replace(/\s/g, '')), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

async function passwordKey(password, salt, iter) {
  const base = await crypto.subtle.importKey('raw', te.encode(String(password)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(salt), iterations: iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const dataKeyFrom = (raw) => crypto.subtle.importKey('raw', unb64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);

/** Зашифровать объект. aad — «адрес» данных: файл нельзя подменить другим файлом. */
async function seal(key, obj, aad) {
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, te.encode(JSON.stringify(obj)));
  return { v: 1, iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}
async function unseal(key, box, aad) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv), additionalData: te.encode(aad) }, key, unb64(box.ct));
  return JSON.parse(td.decode(pt));
}

/** Новый ключ данных (один раз при первой настройке). */
export const newDataKey = () => b64(rand(32));

/** Собрать сейф. passwords: {admin, starosta, kurator}. */
export async function makeVault({ passwords, gh, dk, iter = KDF_ITER }) {
  const salt = b64(rand(16));
  const roles = {};
  for (const role of Object.keys(ROLES)) {
    const key = await passwordKey(passwords[role], salt, iter);
    roles[role] = await seal(key, { role, gh, dk }, 'vault:' + role);
  }
  return { v: 1, kdf: 'PBKDF2-SHA256', iter, salt, roles };
}

/** Открыть сейф паролем. Возвращает {role, gh, dk} или null. */
export async function openVault(vault, password) {
  const key = await passwordKey(password, vault.salt, vault.iter);
  for (const [role, box] of Object.entries(vault.roles || {})) {
    if (!ROLES[role]) continue;
    try {
      const s = await unseal(key, box, 'vault:' + role);
      if (s.role === role) return s;
    } catch { /* не этот пароль */ }
  }
  return null;
}

// ---------------- Ошибки ----------------

function fail(message, status = 400, code) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  if (status === 0) e.offline = true;
  return e;
}

// ---------------- Вход и сессия ----------------

let S = null;        // {role, gh, dk, exp?}
let volatileSession = false;
let dataKey = null;
const usersClient = createUsersClient();
let loginVersion = 0;
let cloudConnection = null;
let attendanceConnection = null;
const attendanceClient = createAttendanceClient();
const attendanceQueues = new Map(), attendanceVersions = new Map(), attendanceHistory = new Map();
function notifyAttendance(detail) { globalThis.dispatchEvent?.(new CustomEvent('attendance-sync', { detail })); }
function sameStoredSession(owner, storage) {
  try { return session() === owner && JSON.parse(ls(SESSION_KEY, undefined, storage) || 'null')?.sessionId === owner.sessionId; }
  catch { return false; }
}
const ls = (k, v, where = localStorage) => {
  try {
    if (v === undefined) return where.getItem(k);
    if (v === null) where.removeItem(k); else where.setItem(k, v);
  } catch { /* приватный режим */ }
  return null;
};

const sessionStorageFor = role => role === 'kurator' ? sessionStorage : localStorage;
const cloudActive = cloud => !!cloud && (cloud.expiresAt === 0 || cloud.expiresAt > Date.now());
function session() {
  if (S) {
    if (volatileSession) return S;
    let stored;
    try { stored = JSON.parse(ls(SESSION_KEY, undefined, sessionStorageFor(S.role)) || 'null'); } catch { /* damaged storage */ }
    if (stored?.sessionId === S.sessionId && stored.role === S.role && stored.gh === S.gh && stored.dk === S.dk) return S;
    // Another tab logged out or replaced the shared identity. Drop the cached key.
    cloudConnection?.controller.abort(); cloudConnection = null;
    attendanceConnection?.controller.abort(); attendanceConnection = null;
    usersClient.clear(); attendanceClient.clear();
    attendanceVersions.clear(); attendanceHistory.clear(); attendanceQueues.clear();
  }
  S = null; dataKey = null;
  for (const where of [sessionStorage, localStorage]) {
    let s = null;
    try { s = JSON.parse(ls(SESSION_KEY, undefined, where) || 'null'); } catch { s = null; }
    if (s && ROLES[s.role] && s.gh && s.dk && (s.role !== 'kurator' || where === sessionStorage)) {
      // Migrate the previous one-day policy without asking privileged roles to log in again.
      delete s.exp; s.sessionId ||= crypto.randomUUID(); S = s; volatileSession = false;
      if (where !== sessionStorageFor(s.role)) ls(SESSION_KEY, null, where);
      ls(SESSION_KEY, JSON.stringify(s), sessionStorageFor(s.role));
      return S;
    }
    if (s) ls(SESSION_KEY, null, where);
  }
  return null;
}

export const loggedIn = () => !!session();
export const currentRole = () => (session() ? S.role : '');
export const panelReady = () => !!session();

export async function usersApi(path, body, signal) {
  const s = session();
  if (!s) { logout(); throw fail('Вход истёк. Войдите в админ-панель заново.', 401); }
  if (s.role !== 'admin') throw fail('Аккаунты доступны только администратору.', 403);
  if (!cloudActive(s.cloud) && cloudConnection?.owner === s) await cloudConnection.promise;
  if (session() !== s) throw fail('Вход отменён. Войдите заново.', 401);
  if (!cloudActive(s.cloud)) throw fail('Нужно переподключить личные кабинеты. Расписание и посещаемость доступны в соседних вкладках.', 503, 'cloud_unavailable');
  usersClient.restore(s.cloud);
  try { return await usersClient.request(path, body, signal); }
  catch (error) {
    if (error.status === 401 && session() === s) {
      delete s.cloud;
      const storage = sessionStorageFor(s.role);
      if (sameStoredSession(s, storage)) ls(SESSION_KEY, JSON.stringify(s), storage);
      throw fail('Доступ к личным кабинетам отозван. Подключите их заново; основные разделы доступны.', 503, 'cloud_unavailable');
    }
    throw error;
  }
}

export async function syncUsers(signal) {
  if (currentRole() !== 'admin') throw fail('Нет доступа к аккаунтам.', 403);
  const owner = session();
  const { ticket } = await usersApi('sync/start', {}, signal);
  const config = await api('config');
  if (session() !== owner || signal?.aborted) throw fail('Обновление отменено. Повторите загрузку.', 409);
  return usersApi('sync', { config, ticket }, signal);
}

async function attendanceApi(path, body, owner, signal) {
  if (!owner || session() !== owner || signal?.aborted) throw fail('Обновление отменено.', 409);
  if (attendanceConnection?.owner === owner) await attendanceConnection.promise;
  if (!owner.attendance && owner.role === 'admin' && cloudConnection?.owner === owner) await cloudConnection.promise;
  if (session() !== owner || signal?.aborted) throw fail('Обновление отменено.', 409);
  const auth = cloudActive(owner.attendance) ? owner.attendance : owner.role === 'admin' && cloudActive(owner.cloud) ? owner.cloud : null;
  if (!auth) throw fail('Для обновления ЛК войдите в админку ещё раз. Отметки в админке сохранены.', 503);
  attendanceClient.restore(auth);
  return attendanceClient.request(path, body, signal);
}
const attendanceVersion = week => JSON.stringify({ m: week.m || {}, pairs: week.pairs || {}, hide: week.hide || {}, at: week.at || '' });

export function syncAttendanceWeek(course, monday, { knownWeek, force = false, signal } = {}) {
  const owner = session(), key = String(course) + '|' + monday;
  if (!owner || !COURSES.includes(String(course)) || !isMonday(monday)) return Promise.reject(fail('Неверная неделя посещаемости.', 400));
  const prior = attendanceQueues.get(key) || Promise.resolve();
  const task = prior.catch(() => {}).then(async () => {
    if (session() !== owner || signal?.aborted) throw fail('Обновление отменено.', 409);
    if (!force && knownWeek && attendanceVersions.get(key) === attendanceVersion(knownWeek)) return { skipped: true };
    notifyAttendance({ course: String(course), monday, state: 'loading' });
    const { ticket } = await attendanceApi('start', { course: String(course), monday }, owner, signal);
    if (session() !== owner || signal?.aborted) throw fail('Обновление отменено.', 409);
    // Ticket must precede this authoritative read, even if the UI already read a week.
    const week = (await readData(weekPath(course, monday))).value || emptyWeek();
    if (session() !== owner || signal?.aborted) throw fail('Обновление отменено.', 409);
    const result = await attendanceApi('sync', { course: String(course), monday, ticket, week }, owner, signal);
    if (session() !== owner) throw fail('Обновление отменено.', 409);
    attendanceVersions.set(key, attendanceVersion(week));
    notifyAttendance({ course: String(course), monday, state: 'ready', syncedAt: result.syncedAt });
    return result;
  }).catch(error => {
    if (session() === owner && !signal?.aborted) notifyAttendance({ course: String(course), monday, state: 'error', message: error.message });
    throw error;
  });
  attendanceQueues.set(key, task);
  const clean = () => { if (attendanceQueues.get(key) === task) attendanceQueues.delete(key); };
  task.then(clean, clean);
  return task;
}

export async function syncAttendanceHistory(course, { force = false, signal, onProgress = () => {} } = {}) {
  const owner = session(); course = String(course);
  if (!owner || !COURSES.includes(course)) throw fail('Войдите в админку.', 401);
  if (!force && attendanceHistory.has(course)) return attendanceHistory.get(course);
  const response = await gh(cpath(DATA_REPO, 'w/' + course) + '?t=' + Date.now());
  if (response.status !== 404 && !response.ok) throw ghError(response, 'посещаемость для ЛК');
  const weeks = (Array.isArray(response.body) ? response.body : []).filter(file => file.type === undefined || file.type === 'file').map(file => file.name.replace(/\.json$/, '')).filter(isMonday).sort();
  if (weeks.length > 520) throw fail('Слишком много недель для одного обновления. Обратитесь к администратору.', 400);
  let done = 0, failed = 0;
  onProgress({ done, failed, total: weeks.length });
  await pool(weeks, 3, async monday => {
    if (session() !== owner || signal?.aborted) throw fail('Обновление отменено.', 409);
    try { await syncAttendanceWeek(course, monday, { force, signal }); done++; }
    catch (error) { if (session() !== owner || signal?.aborted) throw error; failed++; }
    onProgress({ done, failed, total: weeks.length });
  });
  if (session() !== owner || signal?.aborted) throw fail('Обновление отменено.', 409);
  const result = { done, failed, total: weeks.length };
  if (!failed) attendanceHistory.set(course, result);
  return result;
}

export function logout() {
  loginVersion++;
  cloudConnection?.controller.abort(); cloudConnection = null;
  attendanceConnection?.controller.abort(); attendanceConnection = null;
  const saved = session();
  if (saved?.cloud) usersClient.restore(saved.cloud);
  usersClient.logout().catch(() => {});
  if (saved?.attendance) attendanceClient.restore(saved.attendance);
  attendanceClient.logout().catch(() => {});
  attendanceVersions.clear(); attendanceHistory.clear(); attendanceQueues.clear();
  globalThis.dispatchEvent?.(new Event('admin-logout'));
  S = null; dataKey = null;
  volatileSession = false;
  ls(SESSION_KEY, null, localStorage);
  ls(SESSION_KEY, null, sessionStorage);
  globalThis.dispatchEvent?.(new Event('admin-session-change'));
}

/** Роль определяет срок: админ/староста до выхода, куратор до закрытия вкладки. */
export function startSession(secret, remember, cloud = null) {
  logout();
  S = { role: secret.role, gh: secret.gh, dk: secret.dk, sessionId: crypto.randomUUID(), ...(cloud ? { cloud } : {}) };
  ls(SESSION_KEY, JSON.stringify(S), sessionStorageFor(secret.role));
  volatileSession = !ls(SESSION_KEY, undefined, sessionStorageFor(secret.role));
  globalThis.dispatchEvent?.(new Event('admin-session-change'));
}

globalThis.addEventListener?.('storage', event => {
  if (event.key !== SESSION_KEY || event.storageArea !== localStorage || S?.role === 'kurator') return;
  let previous, next;
  try { previous = JSON.parse(event.oldValue || 'null'); next = JSON.parse(event.newValue || 'null'); } catch { /* force refresh */ }
  if (previous?.sessionId && previous.sessionId === next?.sessionId) return;
  session();
  globalThis.dispatchEvent?.(new Event('admin-storage-change'));
});

export async function loadVault() {
  let r, data;
  try { ({ response: r, data } = await fetchJsonWithTimeout(fetch, 'vault.json', { cache: 'no-store' })); } catch { throw fail('Не удалось загрузить сейф админки. Проверьте подключение и повторите вход.', 0); }
  if (r.status === 404) return null;
  if (!r.ok) throw fail('Не удалось загрузить панель: ' + r.status, 502);
  return data;
}

// ---------------- GitHub ----------------

async function gh(path, init = {}) {
  let r, body;
  try {
    ({ response: r, data: body } = await fetchJsonWithTimeout(fetch, GH + path, {
      cache: 'no-store', ...init,
      headers: {
        Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + S.gh, 'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    }));
  } catch { throw fail('Нет связи с GitHub', 0); }
  if (r.status === 401) throw fail('GitHub не принял ключ — возможно, у ключа истёк срок. Администратору: открой «Настройку» и обнови ключ.', 502, 'gh_key');
  if (r.status === 403 && body && /rate limit/i.test(body.message || '')) throw fail('GitHub временно ограничил запросы — подожди пару минут', 503);
  return { status: r.status, ok: r.ok, body };
}

const cpath = (repo, p) => `/repos/${OWNER}/${repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}`;
const ghError = (r, what) => fail(`GitHub (${what}): ` + ((r.body && r.body.message) || r.status), r.status === 404 ? 404 : 502);

async function getFile(repo, p) {
  const r = await gh(cpath(repo, p) + `?t=${Date.now()}`);
  if (r.status === 404) {
    if (repo === DATA_REPO && !(await repoExists(repo))) throw fail(`Нет доступа к приватному репозиторию ${DATA_REPO} — проверь, что он создан и ключ GitHub к нему подключён`, 502, 'no_repo');
    return null;
  }
  if (!r.ok) throw ghError(r, p);
  return { text: td.decode(unb64(r.body.content || '')), sha: r.body.sha };
}

const known = new Set();
async function repoExists(repo) {
  if (known.has(repo)) return true;
  const r = await gh(`/repos/${OWNER}/${repo}`);
  if (r.ok) known.add(repo);
  return r.ok;
}

/** Записать файл. Конфликт (файл изменили в другом месте) — ошибка с code 'conflict'. */
async function putFile(repo, p, text, sha, message) {
  const r = await gh(cpath(repo, p), {
    method: 'PUT',
    body: JSON.stringify({ message, content: b64(te.encode(text)), ...(sha ? { sha } : {}) }),
  });
  if (r.status === 409 || r.status === 422) throw fail('Файл изменили в другом месте', 409, 'conflict');
  if (r.status === 404 && repo === DATA_REPO) throw fail(`Нет доступа к приватному репозиторию ${DATA_REPO} — проверь, что он создан и ключ GitHub к нему подключён`, 502, 'no_repo');
  if (!r.ok) throw ghError(r, p);
  return r.body.content.sha;
}

// Записи идут по очереди: GitHub не любит несколько коммитов в одну ветку одновременно.
let queue = Promise.resolve();
const serial = (fn) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- Зашифрованные данные ----------------

async function key() { return (dataKey ||= await dataKeyFrom(S.dk)); }

async function readData(p) {
  const f = await getFile(DATA_REPO, p);
  if (!f) return { value: null, sha: null };
  let box;
  try { box = JSON.parse(f.text); } catch { throw fail('Повреждён файл данных ' + p, 500); }
  try { return { value: await unseal(await key(), box, 'data:' + p), sha: f.sha }; }
  catch { throw fail('Не удалось расшифровать данные — ключ данных не подходит', 500, 'bad_key'); }
}

/** Прочитать → изменить → записать. mutate(value) возвращает {ok, error?, value}. При конфликте — повтор. */
function updateData(p, mutate, message) {
  return serial(async () => {
    for (let attempt = 0; ; attempt++) {
      const cur = await readData(p);
      const r = mutate(cur.value);
      if (!r.ok) throw fail(r.error);
      try {
        await putFile(DATA_REPO, p, JSON.stringify(await seal(await key(), r.value, 'data:' + p)), cur.sha, message);
        const week = /^w\/([123])\/(\d{4}-\d{2}-\d{2})\.json$/.exec(p);
        if (week) syncAttendanceWeek(week[1], week[2], { knownWeek: r.value }).catch(() => {});
        return r.value;
      } catch (e) {
        if (e.code !== 'conflict' || attempt >= 5) throw e.code === 'conflict' ? fail('Не получилось сохранить — данные меняют одновременно. Повтори.', 409) : e;
        await sleep(300 + Math.random() * 700 * (attempt + 1));
      }
    }
  });
}

/** Записать готовое значение (для переноса данных со старого сервера). */
export function writeData(p, value, message = 'Перенос данных') {
  return updateData(p, () => ({ ok: true, value }), message);
}

const CONFIG = 'config.json';
const weekPath = (course, monday) => `w/${course}/${monday}.json`;

function withDefaults(c) {
  const def = defaultConfig();
  if (!c || !c.courses) return def;
  for (const k of COURSES) c.courses[k] = { ...def.courses[k], ...(c.courses[k] || {}) };
  return c;
}
async function loadConfig() { return withDefaults((await readData(CONFIG)).value); }

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

// ---------------- Адреса старого сервера ----------------

export async function api(path, body) {
  const [route, qs] = String(path).split('?');
  const q = new URLSearchParams(qs || '');

  if (route === 'login') {
    const version = ++loginVersion;
    const vault = await loadVault();
    if (!vault) throw fail('Панель ещё не настроена. Администратору: открой «Настройку» (ссылка внизу).', 503, 'no_vault');
    const secret = await openVault(vault, String((body && body.password) || ''));
    if (!secret) { await sleep(500); throw fail('Неверный пароль', 401); }
    if (version !== loginVersion) throw fail('Вход отменён. Повторите попытку.', 401);
    startSession(secret, !!(body && body.remember));
    {
      const owner = session(), storage = sessionStorageFor(secret.role);
      const controller = new AbortController(), exchange = createAttendanceClient();
      const connection = { owner, controller, promise: null };
      attendanceConnection = connection;
      connection.promise = exchange.login(String(body.password), secret.role, controller.signal).then(() => {
        if (!sameStoredSession(owner, storage)) { exchange.logout().catch(() => {}); return; }
        owner.attendance = exchange.credentials();
        if (owner.attendance) ls(SESSION_KEY, JSON.stringify(owner), storage);
      }).catch(() => {});
    }
    if (secret.role === 'admin') {
      const storage = sessionStorageFor(secret.role);

      const owner = session(), controller = new AbortController(), exchange = createUsersClient();
      const connection = { owner, controller, promise: null };
      cloudConnection = connection;
      connection.promise = exchange.login(String(body.password), controller.signal).then(() => {
        if (!sameStoredSession(owner, storage)) { exchange.logout().catch(() => {}); return; }
        owner.cloud = exchange.credentials();
        if (owner.cloud) ls(SESSION_KEY, JSON.stringify(owner), storage);
      }).catch(() => {});
    }
    return { token: 'ok', role: secret.role, title: ROLES[secret.role].title };
  }

  if (!session()) throw fail('Нужно войти заново', 401);
  const role = ROLES[S.role];
  const by = role.title;
  const courseOf = (v) => { const c = String(v ?? ''); return COURSES.includes(c) ? c : null; };

  if (route === 'me') return { role: S.role, title: role.title };

  if (route === 'config' && !body) return loadConfig();

  if (route === 'students' && body) {
    if (body.action === 'delete' && S.role !== 'admin') throw fail('Удаление навсегда доступно только администратору.', 403);
    if (!role.students) throw fail('Нет права менять список студентов', 403);
    return updateData(CONFIG, (c) => { const config = withDefaults(c); const r = studentOp(config, body); return { ...r, value: config }; }, `${by}: список студентов`);
  }

  if (route === 'course' && body) {
    if (!role.settings) throw fail('Нет права менять группу курса', 403);
    return updateData(CONFIG, (c) => { const config = withDefaults(c); const r = courseOp(config, body); return { ...r, value: config }; }, `${by}: настройки курса`);
  }

  if (route === 'week' && !body) {
    const course = courseOf(q.get('course'));
    const w = q.get('w') || '';
    if (!course || !isMonday(w)) throw fail('Неверная неделя');
    const week = (await readData(weekPath(course, w))).value || emptyWeek();
    syncAttendanceWeek(course, w, { knownWeek: week }).catch(() => {});
    return week;
  }

  if (route === 'marks' && body) {
    const course = courseOf(body.course);
    if (!course) throw fail('Нет такого курса');
    if (!isMonday(body.w)) throw fail('Неделя должна начинаться с понедельника');
    return updateData(weekPath(course, body.w), (cur) => {
      const week = cur || emptyWeek();
      const r = applyMarks(week, body.w, body.changes || [], body.pairs, body.hide);
      if (r.ok && (body.changes || []).length) { week.at = new Date().toISOString(); week.by = by; }
      return { ...r, value: week };
    }, `${by}: отметки`);
  }

  if (route === 'weeks' && !body) {
    // Все недели курса в диапазоне — для выгрузки в Excel.
    const course = courseOf(q.get('course'));
    if (!course) throw fail('Нет такого курса');
    const from = q.get('from') || '';
    const to = q.get('to') || '';
    const r = await gh(cpath(DATA_REPO, 'w/' + course) + `?t=${Date.now()}`);
    if (r.status !== 404 && !r.ok) throw ghError(r, 'список недель');
    const mondays = (Array.isArray(r.body) ? r.body : []).map((f) => f.name.replace(/\.json$/, ''))
      .filter((m) => isIso(m) && (!isIso(from) || m >= from) && (!isIso(to) || m <= to)).sort();
    const weeks = {};
    await pool(mondays, 6, async (m) => { weeks[m] = (await readData(weekPath(course, m))).value; });
    return { weeks };
  }

  // ---------- Изменения расписания (web/overrides.json в публичном tkpst-schedule — не шифруется) ----------

  if (route === 'github' && !body) return { configured: true };

  if (route === 'overrides') {
    if (!body) {
      const f = await getFile(SCHEDULE_REPO, OVERRIDES);
      return { text: f ? f.text : '{}', sha: f ? f.sha : null };
    }
    const text = String(body.text || '');
    if (text.length > 500000) throw fail('Слишком большой файл');
    try { JSON.parse(text); } catch { throw fail('Неверные данные расписания'); }
    try {
      return { sha: await serial(() => putFile(SCHEDULE_REPO, OVERRIDES, text, body.sha, `Админ (${by}): изменения расписания`)) };
    } catch (e) {
      if (e.code === 'conflict') throw fail('Расписание изменили в другом месте — обнови страницу и повтори', 409, 'conflict');
      throw e;
    }
  }

  if (route === 'import' && body) {
    if (!role.import) throw fail('Нет права на импорт', 403);
    const course = courseOf(body.course);
    if (!course) throw fail('Нет такого курса');
    // Сначала добавляем недостающих студентов (чтобы у отметок были id), потом пишем недели.
    let prepared = null;
    const config = await updateData(CONFIG, (c) => {
      const cfg = withDefaults(c);
      const r = prepareImport(cfg, course, body);
      prepared = r;
      return { ...r, value: cfg };
    }, `${by}: импорт — студенты`);
    let marks = 0;
    for (const [monday, changes] of Object.entries(prepared.weeks)) {
      await updateData(weekPath(course, monday), (cur) => {
        const week = cur || emptyWeek();
        const a = applyMarks(week, monday, changes, null);
        week.at = new Date().toISOString(); week.by = by + ' (импорт)';
        return { ...a, value: week };
      }, `${by}: импорт — отметки`);
      marks += changes.length;
    }
    return { ok: true, weeks: Object.keys(prepared.weeks).length, marks, added: prepared.added, config };
  }

  throw fail('Не найдено', 404);
}

/** Проверить ключ GitHub при настройке: доступ к обоим репозиториям на запись. */
export async function checkGithubKey(token) {
  const saved = S;
  S = { gh: token };
  try {
    const problems = [];
    if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(token)) return ['это не похоже на ключ GitHub — он начинается с github_pat_ и копируется целиком кнопкой копирования'];
    for (const repo of [DATA_REPO, SCHEDULE_REPO]) {
      let r;
      try { r = await gh(`/repos/${OWNER}/${repo}`); } catch (e) {
        if (e.code === 'gh_key') {
          const kind = token.startsWith('github_pat_') ? 'fine-grained' : 'classic';
          const want = kind === 'fine-grained' ? 93 : 40;
          return [`GitHub ответил «Bad credentials» (ключ не существует или отозван). Вставлено символов: ${token.length}`
            + (token.length !== want ? ` — а у такого ключа их ${want}, значит скопирован не целиком` : ' — длина правильная, значит этот ключ уже удалён/перевыпущен (в буфере старый ключ?)')
            + `. Начало: ${token.slice(0, 15)}…`];
        }
        throw e;
      }
      if (!r.ok) { problems.push(`нет доступа к репозиторию ${repo}`); continue; }
      if (repo === DATA_REPO && !r.body.private) problems.push(`репозиторий ${repo} должен быть ПРИВАТНЫМ`);
      if (r.body.permissions && !r.body.permissions.push) problems.push(`у ключа нет права записи в ${repo} (Contents: Read and write)`);
    }
    return problems;
  } finally { S = saved; }
}
