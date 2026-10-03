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

export const OWNER = 'WTFHOSHI';
export const DATA_REPO = 'tkpst-admin-data';
export const SCHEDULE_REPO = 'tkpst-schedule';
const OVERRIDES = 'web/overrides.json';
const GH = 'https://api.github.com';
const SESSION_KEY = 'admin_session';
export const REMEMBER_MS = 864e5;      // «Запомнить на этом устройстве» — 1 день
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
let dataKey = null;
const ls = (k, v, where = localStorage) => {
  try {
    if (v === undefined) return where.getItem(k);
    if (v === null) where.removeItem(k); else where.setItem(k, v);
  } catch { /* приватный режим */ }
  return null;
};

function session() {
  if (S && (!S.exp || S.exp > Date.now())) return S;
  S = null; dataKey = null;
  for (const where of [sessionStorage, localStorage]) {
    let s = null;
    try { s = JSON.parse(ls(SESSION_KEY, undefined, where) || 'null'); } catch { s = null; }
    if (s && ROLES[s.role] && s.gh && s.dk && (!s.exp || s.exp > Date.now())) { S = s; return S; }
    if (s) ls(SESSION_KEY, null, where); // истёк — стираем
  }
  return null;
}

export const loggedIn = () => !!session();
export const currentRole = () => (session() ? S.role : '');

export function logout() {
  S = null; dataKey = null;
  ls(SESSION_KEY, null, localStorage);
  ls(SESSION_KEY, null, sessionStorage);
}

/** Начать сессию. remember — запомнить на устройстве на 1 день, иначе — до закрытия вкладки. */
export function startSession(secret, remember) {
  logout();
  S = { role: secret.role, gh: secret.gh, dk: secret.dk };
  if (remember) { S.exp = Date.now() + REMEMBER_MS; ls(SESSION_KEY, JSON.stringify(S), localStorage); }
  else ls(SESSION_KEY, JSON.stringify(S), sessionStorage);
}

export async function loadVault() {
  let r;
  try { r = await fetch('vault.json', { cache: 'no-store' }); } catch { throw fail('Нет интернета', 0); }
  if (r.status === 404) return null;
  if (!r.ok) throw fail('Не удалось загрузить панель: ' + r.status, 502);
  return r.json();
}

// ---------------- GitHub ----------------

async function gh(path, init = {}) {
  let r;
  try {
    r = await fetch(GH + path, {
      cache: 'no-store', ...init,
      headers: {
        Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + S.gh, 'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch { throw fail('Нет связи с GitHub', 0); }
  let body = null;
  try { body = await r.json(); } catch { /* пусто */ }
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
    const vault = await loadVault();
    if (!vault) throw fail('Панель ещё не настроена. Администратору: открой «Настройку» (ссылка внизу).', 503, 'no_vault');
    const secret = await openVault(vault, String((body && body.password) || ''));
    if (!secret) { await sleep(500); throw fail('Неверный пароль', 401); }
    startSession(secret, !!(body && body.remember));
    return { token: 'ok', role: secret.role, title: ROLES[secret.role].title };
  }

  if (!session()) throw fail('Нужно войти заново', 401);
  const role = ROLES[S.role];
  const by = role.title;
  const courseOf = (v) => { const c = String(v ?? ''); return COURSES.includes(c) ? c : null; };

  if (route === 'me') return { role: S.role, title: role.title };

  if (route === 'config' && !body) return loadConfig();

  if (route === 'students' && body) {
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
    return (await readData(weekPath(course, w))).value || emptyWeek();
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
    for (const repo of [DATA_REPO, SCHEDULE_REPO]) {
      const r = await gh(`/repos/${OWNER}/${repo}`);
      if (!r.ok) { problems.push(`нет доступа к репозиторию ${repo}`); continue; }
      if (repo === DATA_REPO && !r.body.private) problems.push(`репозиторий ${repo} должен быть ПРИВАТНЫМ`);
      if (r.body.permissions && !r.body.permissions.push) problems.push(`у ключа нет права записи в ${repo} (Contents: Read and write)`);
    }
    return problems;
  } finally { S = saved; }
}
