// Админ-панель → «Изменение расписания». Сохранение — прямо в web/overrides.json репозитория tkpst-schedule
// (ключ GitHub лежит в зашифрованном сейфе, см. backend.js). Вход — по тем же паролям, что и «Посещаемость».
// Сайт и приложения (Android/iOS) скачивают overrides.json сами — обновлять их не нужно.
import {
  T, fmt, buildTimeline, setOverrides, getOverrides, pairSlots, basePairSlots, bellKind, parseHm, hmStr,
  flagSlot, classHourSlot, MORNING_CH, AFTERNOON_CH, parseLessons,
} from './js/core.js?v=__V__';
import { api, loggedIn, logout } from './backend.js?v=__V__';

const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const SCHED = (LOCAL ? '/sched' : 'https://api.thisishyum.ru/schedule_api/tyumen') + '/groups/196/schedules';
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const svg = (d) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = { back: svg('<path d="M15 18l-6-6 6-6"/>'), next: svg('<path d="M9 18l6-6-6-6"/>'), out: svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>') };

// Тема как на сайте
{
  let theme = 'system';
  try { theme = JSON.parse(localStorage.getItem('theme')) || 'system'; } catch { /* ignore */ }
  document.documentElement.dataset.theme = theme;
}

let me = { role: '', title: '' };

// ---------------- Состояние ----------------

const st = {
  data: null,        // черновик overrides
  saved: '',         // JSON последней сохранённой версии — чтобы видеть несохранённое
  sha: null,
  weekStart: T.monday(T.now()),
  selected: T.dayStart(T.now()),
  college: new Map(), // iso → {lessons} | {error}
  saving: false,
  msg: null,          // {kind:'ok'|'warn', text}
  bellsOpen: false,   // открыт редактор «Расписание звонков»
  bellsKind: 'week',  // mon | week | sat
  dayTimesOpen: false,
};
if (T.weekday(st.selected) === 7) { st.selected = T.addDays(st.selected, 1); st.weekStart = T.monday(st.selected); }

const iso = () => T.iso(st.selected);
const dirty = () => JSON.stringify(normalize(st.data)) !== st.saved;

/** Чистый вид: без пустых пар/дней и старых дат. */
// ---------------- Звонки ----------------

const BELL_KINDS = [['mon', 'Понедельник'], ['week', 'Вторник – пятница'], ['sat', 'Суббота']];
const KIND_WD = { mon: 1, week: 2, sat: 6 };

/** Чистый список звонков: [{number, start: "08:15", end: "09:45"}], только верные строки. */
function normSlots(list) {
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    const n = Number(x && x.number), a = parseHm(x && x.start), b = parseHm(x && x.end);
    if (Number.isInteger(n) && n >= 1 && n <= 8 && a != null && b != null && b > a && !out.some((o) => o.number === n)) {
      out.push({ number: n, start: hmStr(a), end: hmStr(b) });
    }
  }
  return out.sort((a, b) => a.number - b.number);
}
const toStr = (slots) => slots.map((x) => ({ number: x.number, start: hmStr(x.start), end: hmStr(x.end) }));
const sameSlots = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function normRange(r, def) {
  const a = parseHm(r && r.start), b = parseHm(r && r.end);
  if (a == null || b == null || b <= a || (a === def.start && b === def.end)) return null;
  return { start: hmStr(a), end: hmStr(b) };
}

/** Выполнить fn с временно подставленными изменениями (core.js хранит их глобально). */
function withOv(o, fn) {
  const prev = getOverrides();
  setOverrides(o);
  try { return fn(); } finally { setOverrides(prev); }
}

/** Чистый вид: без пустых пар/дней и старых дат, звонки — только если отличаются от фото. */
function normalize(d) {
  const out = { announcement: (d.announcement || '').trim(), updatedAt: d.updatedAt || '' };
  const b = d.bells || {};
  const bells = {};
  for (const [k] of BELL_KINDS) {
    const l = normSlots(b[k]);
    if (l.length && !sameSlots(l, toStr(basePairSlots(KIND_WD[k])))) bells[k] = l;
  }
  const f = normRange(b.flag, MORNING_CH); if (f) bells.flag = f;
  const c = normRange(b.classHour, AFTERNOON_CH); if (c) bells.classHour = c;
  if (Object.keys(bells).length) out.bells = bells;
  out.days = {};
  const keepFrom = T.iso(T.addDays(T.dayStart(T.now()), -2));
  for (const k of Object.keys(d.days || {}).sort()) {
    if (k < keepFrom) continue;
    const day = d.days[k];
    const pairs = (day.pairs || [])
      .map((p) => {
        const q = { number: Number(p.number) };
        if (p.status === 'remote' || p.status === 'cancelled') q.status = p.status;
        for (const fld of ['title', 'cabinet', 'teacher']) if ((p[fld] || '').trim()) q[fld] = p[fld].trim();
        return q;
      })
      .filter((p) => Object.keys(p).length > 1)
      .sort((a, b) => a.number - b.number);
    const note = (day.note || '').trim();
    const times = normSlots(day.times);
    const flag = typeof day.flag === 'boolean' ? day.flag : null;
    const classHour = typeof day.classHour === 'boolean' ? day.classHour : null;
    if (!pairs.length && !note && !day.replaceAll && !times.length && flag === null && classHour === null) continue;
    out.days[k] = {
      ...(note ? { note } : {}), ...(day.replaceAll ? { replaceAll: true } : {}), pairs,
      ...(times.length ? { times } : {}), ...(flag !== null ? { flag } : {}), ...(classHour !== null ? { classHour } : {}),
    };
  }
  return out;
}

function dayDraft(create = false) {
  const k = iso();
  if (!st.data.days[k] && create) st.data.days[k] = { note: '', replaceAll: false, pairs: [] };
  return st.data.days[k] || { note: '', replaceAll: false, pairs: [] };
}
function pairDraft(n) {
  const d = dayDraft(true);
  let p = d.pairs.find((x) => Number(x.number) === n);
  if (!p) { p = { number: n }; d.pairs.push(p); }
  return p;
}

// ---------------- Вход ----------------

function login(error = '') {
  $app.innerHTML = `
    <header class="bar"><span class="icon-space"></span>
      <div class="bar-title"><div class="t">Админ-панель</div><div class="s">ИС-25-3С · изменения расписания</div></div>
      <span class="icon-space"></span></header>
    <main class="admin">
      <div class="card">
        <b>Вход по паролю</b>
        <p class="college">Тот же пароль, что и в «Посещаемости»: администратор, староста или куратор.</p>
        <label class="lbl" for="pw">Пароль</label>
        <input id="pw" type="password" autocomplete="current-password" placeholder="Пароль">
        <label class="college" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="remember"> Запомнить на этом устройстве (1 день)</label>
        ${error ? `<p class="warn" style="margin-top:10px">${esc(error)}</p>` : ''}
        <button class="btn" data-login style="margin-top:12px;width:100%">Войти</button>
        <p class="college" style="margin-top:12px">На чужом устройстве галочку не ставь. <a href="setup.html">Настройка</a> — для администратора.</p>
      </div>
    </main>`;
  const input = $app.querySelector('#pw');
  const go = async () => {
    const pw = input.value.trim();
    if (!pw) return;
    const btn = $app.querySelector('[data-login]');
    btn.disabled = true; btn.textContent = 'Проверяю…';
    try { await api('login', { password: pw, remember: $app.querySelector('#remember').checked }); boot(); }
    catch (e) { login(e.status === 401 ? 'Неверный пароль' : e.message); }
  };
  $app.querySelector('[data-login]').onclick = go;
  input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  input.focus();
}

async function boot() {
  if (!loggedIn()) return login();
  $app.innerHTML = `<main class="admin"><div class="card">Загружаю…</div></main>`;
  try {
    me = await api('me');
    await pull();
    editor();
  } catch (e) {
    if (e.status === 401) { logout(); return login('Вход истёк — введи пароль ещё раз.'); }
    $app.innerHTML = `<main class="admin"><div class="card warn">Не удалось загрузить: ${esc(e.message)}</div><button class="btn" data-retry>Ещё раз</button></main>`;
    $app.querySelector('[data-retry]').onclick = boot;
  }
}

async function pull() {
  const f = await api('overrides');
  st.sha = f.sha;
  let json = {};
  try { json = JSON.parse(f.text || '{}'); } catch { json = {}; }
  const n = normalize({ announcement: '', days: {}, ...json });
  st.saved = JSON.stringify(n);
  st.data = JSON.parse(st.saved);
  for (const k of Object.keys(st.data.days)) st.data.days[k] = { note: '', replaceAll: false, ...st.data.days[k] };
}

// ---------------- Редактор ----------------

async function collegeDay(day) {
  const k = T.iso(day);
  if (st.college.has(k)) return st.college.get(k);
  try {
    const r = await fetch(`${SCHED}?date=${k}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('сервер ответил ' + r.status);
    const text = await r.text();
    const v = { lessons: parseLessons(text.trim() ? JSON.parse(text) : null) };
    st.college.set(k, v);
    return v;
  } catch (e) {
    return { lessons: [], error: e.message };
  }
}

function editor() {
  $app.innerHTML = `
    <header class="bar"><span class="icon-space"></span>
      <div class="bar-title"><div class="t">Админ-панель</div><div class="s">ИС-25-3С · ${esc(me.title)} · изменения видны на сайте и в приложениях</div></div>
      <div class="bar-actions"><button class="icon" data-logout aria-label="Выйти">${I.out}</button></div></header>
    <main class="admin">
      <div class="card">
        <label class="lbl" for="ann">Объявление для всех (на главной и в расписании)</label>
        <textarea id="ann" placeholder="Например: 2 октября пар не будет — день здоровья">${esc(st.data.announcement)}</textarea>
      </div>
      <div class="card" data-bells></div>
      <div class="week">
        <div class="week-head">
          <button class="icon" data-prev aria-label="Прошлая неделя">${I.back}</button>
          <div class="week-range" data-range></div>
          <button class="icon" data-next aria-label="Следующая неделя">${I.next}</button>
        </div>
        <div class="chips" data-chips></div>
      </div>
      <div data-day></div>
      <div class="card" data-changed></div>
    </main>
    <div class="savebar"><span class="status-text" data-status></span><button class="btn" data-save>Сохранить</button></div>`;
  $app.querySelector('[data-logout]').onclick = () => {
    if (dirty() && !confirmLeave()) return;
    logout(); login();
  };
  $app.querySelector('#ann').oninput = (e) => { st.data.announcement = e.target.value; status(); };
  $app.querySelector('[data-prev]').onclick = () => shiftWeek(-1);
  $app.querySelector('[data-next]').onclick = () => shiftWeek(1);
  $app.querySelector('[data-save]').onclick = save;
  renderWeek();
  renderBells();
  renderDay();
  renderChanged();
  status();
}

function confirmLeave() { return window.confirm('Есть несохранённые изменения. Выйти без сохранения?'); }

function shiftWeek(n) {
  st.weekStart = T.addDays(st.weekStart, 7 * n);
  st.selected = st.weekStart;
  st.dayTimesOpen = false;
  renderWeek(); renderDay();
}
function select(day) {
  if (T.dayStart(day) !== st.selected) st.dayTimesOpen = false;
  st.selected = T.dayStart(day);
  st.weekStart = T.monday(st.selected);
  renderWeek(); renderDay();
}

// ---------------- Редактор времени пар и перерывов ----------------

/**
 * Пары с полями «начало – конец» и перерывами между ними.
 * Начало сдвигает пару целиком (длина та же), конец меняет длину, перерыв сдвигает все следующие пары.
 * Поля обновляются на месте — фокус при вводе не теряется.
 */
function timesEditor(box, slots, onChange, chs = []) {
  const cur = slots.map((x) => ({ ...x }));
  box.innerHTML = `<div class="bells">${cur.map((x, i) => `
    ${i ? `<div class="bell-gap"><span>перерыв</span><input type="number" min="0" max="300" step="5" inputmode="numeric" data-gap="${i}"><span>мин</span><span class="bell-big" data-gk="${i}"></span></div>` : ''}
    <div class="bell-row"><b>${x.number} пара</b>
      <input type="time" data-s="${i}" aria-label="${x.number} пара, начало"><span>–</span><input type="time" data-e="${i}" aria-label="${x.number} пара, конец">
      <span class="college" data-len="${i}"></span></div>`).join('')}
    <p class="warn" data-bwarn hidden></p></div>`;
  const q = (sel) => box.querySelector(sel);
  const sync = (except) => {
    const problems = [];
    cur.forEach((x, i) => {
      const s = q(`[data-s="${i}"]`), e = q(`[data-e="${i}"]`);
      if (s !== except) s.value = x.start >= 0 && x.start < 1440 ? hmStr(x.start) : '';
      if (e !== except) e.value = x.end >= 0 && x.end < 1440 ? hmStr(x.end) : '';
      q(`[data-len="${i}"]`).textContent = x.end > x.start ? `${x.end - x.start} мин` : '';
      if (!(x.end > x.start) || x.start < 0 || x.end >= 1440) problems.push(`${x.number} пара: конец раньше начала или после полуночи`);
      if (i) {
        const gap = x.start - cur[i - 1].end;
        const g = q(`[data-gap="${i}"]`);
        if (g !== except) g.value = String(gap);
        // Классный час / флаг внутри промежутка — это не перерыв.
        const inside = chs.filter((c) => c.start >= cur[i - 1].end && c.end <= x.start);
        q(`[data-gk="${i}"]`).textContent = inside.length
          ? `из них ${inside.map((c) => `${c.name} ${hmStr(c.start)}–${hmStr(c.end)}`).join(', ')}`
          : gap >= 25 ? 'большой' : '';
        q(`[data-gk="${i}"]`).classList.toggle('in-ch', inside.length > 0);
        if (gap < 0) problems.push(`${x.number} пара начинается раньше, чем кончается ${cur[i - 1].number}`);
      }
    });
    const w = q('[data-bwarn]');
    w.hidden = !problems.length;
    w.textContent = problems.join('. ');
  };
  const emit = (el) => { sync(el); onChange(cur.map((x) => ({ ...x }))); };
  box.querySelectorAll('[data-s]').forEach((el) => {
    el.onchange = () => {
      const v = parseHm(el.value); const x = cur[Number(el.dataset.s)];
      if (v == null) return;
      const len = x.end - x.start; x.start = v; x.end = v + len; emit(el);
    };
  });
  box.querySelectorAll('[data-e]').forEach((el) => {
    el.onchange = () => { const v = parseHm(el.value); if (v == null) return; cur[Number(el.dataset.e)].end = v; emit(el); };
  });
  box.querySelectorAll('[data-gap]').forEach((el) => {
    el.onchange = () => {
      const i = Number(el.dataset.gap), g = Math.round(Number(el.value));
      if (!Number.isFinite(g) || g < 0) return sync();
      const delta = g - (cur[i].start - cur[i - 1].end);
      for (let j = i; j < cur.length; j++) { cur[j].start += delta; cur[j].end += delta; }
      emit(el);
    };
  });
  sync();
}

/** Звонки из черновика (без изменений на отдельные дни). */
const draftGlobal = () => ({ ...normalize(st.data), days: {} });

function renderBells() {
  const box = $app.querySelector('[data-bells]');
  if (!box) return;
  const nb = normalize(st.data).bells || {};
  const changedList = [...BELL_KINDS.filter(([k]) => nb[k]).map(([, t]) => t.toLowerCase()), ...(nb.flag ? ['поднятие флага'] : []), ...(nb.classHour ? ['классный час'] : [])];
  if (!st.bellsOpen) {
    box.innerHTML = `<div class="prow-head"><b>Расписание звонков</b><button class="small-btn" data-open>Изменить</button></div>
      <p class="college" style="margin:6px 0 0">${changedList.length ? 'Изменено: ' + esc(changedList.join(', ')) + '.' : 'Как на фото «Расписание звонков».'}
        Время всех пар и перерывов, поднятия флага и классного часа — для всех недель.</p>`;
    box.querySelector('[data-open]').onclick = () => { st.bellsOpen = true; renderBells(); };
    return;
  }
  const kind = st.bellsKind;
  const g = draftGlobal();
  const slots = withOv(g, () => pairSlots(KIND_WD[kind]));
  const fl = withOv(g, flagSlot), ch = withOv(g, classHourSlot);
  box.innerHTML = `<div class="prow-head"><b>Расписание звонков</b><button class="small-btn" data-close>Свернуть</button></div>
    <p class="college" style="margin:6px 0 10px">Меняется для всех недель. Чтобы поменять время только на один день — открой этот день ниже.</p>
    <div class="seg status">${BELL_KINDS.map(([k, t]) => `<button data-k="${k}" class="${k === kind ? 'on' : ''}">${k === 'week' ? 'Вт – Пт' : t.slice(0, 2) === 'По' ? 'Пн' : 'Сб'}</button>`).join('')}</div>
    <div data-te></div>
    <div class="bell-actions"><button class="small-btn" data-reset-kind ${nb[kind] ? '' : 'disabled'}>Вернуть как на фото (${esc(BELL_KINDS.find(([k]) => k === kind)[1].toLowerCase())})</button></div>
    <b style="display:block;margin-top:14px">Поднятие флага и классный час</b>
    <p class="college" style="margin:4px 0 8px">Обычно — по понедельникам. На любой день их можно добавить или убрать ниже, в карточке дня.</p>
    ${[['flag', 'Поднятие флага', fl, MORNING_CH], ['classHour', 'Классный час', ch, AFTERNOON_CH]].map(([k, t, v, def]) => `
      <div class="ch-row"><span class="ch-name">${t}</span>
        <input type="time" data-chs="${k}" value="${hmStr(v.start)}"><span>–</span><input type="time" data-che="${k}" value="${hmStr(v.end)}">
        ${v.start !== def.start || v.end !== def.end ? `<button class="small-btn" data-chreset="${k}">как на фото</button>` : ''}</div>`).join('')}
    <p class="warn" data-chwarn hidden style="margin-top:8px"></p>`;
  box.querySelector('[data-close]').onclick = () => { st.bellsOpen = false; renderBells(); };
  box.querySelectorAll('[data-k]').forEach((b) => { b.onclick = () => { st.bellsKind = b.dataset.k; renderBells(); }; });
  timesEditor(box.querySelector('[data-te]'), slots, (ns) => {
    (st.data.bells ||= {})[kind] = toStr(ns);
    const rb = box.querySelector('[data-reset-kind]'); if (rb) rb.disabled = !(normalize(st.data).bells || {})[kind];
    bellsChanged();
  }, kind === 'mon' ? [{ name: 'классный час', start: ch.start, end: ch.end }, { name: 'флаг', start: fl.start, end: fl.end }] : []);
  box.querySelector('[data-reset-kind]').onclick = () => { if (st.data.bells) delete st.data.bells[kind]; renderBells(); bellsChanged(); };
  for (const k of ['flag', 'classHour']) {
    const a = box.querySelector(`[data-chs="${k}"]`), b = box.querySelector(`[data-che="${k}"]`);
    const upd = (moved) => {
      let sa = parseHm(a.value), sb = parseHm(b.value);
      if (sa == null || sb == null) return;
      const old = (k === 'flag' ? withOv(draftGlobal(), flagSlot) : withOv(draftGlobal(), classHourSlot));
      if (moved && sb === old.end) { sb = sa + (old.end - old.start); b.value = sb < 1440 ? hmStr(sb) : b.value; } // начало двигает целиком
      const w = box.querySelector('[data-chwarn]');
      w.hidden = sb > sa; w.textContent = sb > sa ? '' : 'Конец должен быть позже начала';
      if (sb <= sa) return;
      (st.data.bells ||= {})[k] = { start: hmStr(sa), end: hmStr(sb) };
      bellsChanged();
    };
    a.onchange = () => upd(true);
    b.onchange = () => upd(false);
    const r = box.querySelector(`[data-chreset="${k}"]`);
    if (r) r.onclick = () => { delete st.data.bells[k]; renderBells(); bellsChanged(); };
  }
}

function bellsChanged() {
  st.msg = null;
  renderDay();
  renderChanged();
  status();
}

function renderWeek() {
  $app.querySelector('[data-range]').textContent = `${fmt.dMon(st.weekStart)} – ${fmt.dMon(T.addDays(st.weekStart, 5))}`;
  const today = T.dayStart(T.now());
  const chips = $app.querySelector('[data-chips]');
  chips.innerHTML = WD.map((w, i) => {
    const d = T.addDays(st.weekStart, i);
    const has = !!normalize({ days: { [T.iso(d)]: st.data.days[T.iso(d)] || {} } }).days[T.iso(d)];
    const cls = ['chip', d === st.selected ? 'sel' : '', d === today ? 'today' : '', has ? 'has' : ''].join(' ');
    return `<button class="${cls}" data-d="${d}"><span>${w}</span><b>${new Date(d).getUTCDate()}</b><i></i></button>`;
  }).join('');
  chips.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => select(Number(b.dataset.d)); });
}

async function renderDay() {
  const box = $app.querySelector('[data-day]');
  const day = st.selected, wd = T.weekday(day), k = T.iso(day);
  box.innerHTML = `<div class="card">Загружаю расписание колледжа на ${fmt.dMon(day)}…</div>`;
  const col = await collegeDay(day);
  if (st.selected !== day) return; // успели переключить день
  const base = withOv(null, () => buildTimeline(wd, col.lessons, null)).filter((e) => e.type === 'pair');
  const draft = dayDraft();
  const nd = normalize(st.data);
  const slots = withOv(nd, () => pairSlots(wd, k));
  const globalSlots = withOv({ ...nd, days: {} }, () => pairSlots(wd));
  const dayTimes = ((nd.days[k] || {}).times || []);
  // Как обычно (без флага/классного часа из этого дня) — чтобы подписать «как обычно: есть / нет».
  const plainDay = { ...(nd.days[k] || { pairs: [] }) }; delete plainDay.flag; delete plainDay.classHour;
  const usual = withOv({ ...nd, days: { ...nd.days, [k]: plainDay } }, () => buildTimeline(wd, col.lessons, k));
  const chInfo = [
    ['flag', 'Поднятие флага', withOv(nd, flagSlot), usual.some((e) => e.kind === 'flag')],
    ['classHour', 'Классный час', withOv(nd, classHourSlot), usual.some((e) => e.kind === 'ch')],
  ];

  const rows = slots.map((s) => {
    const orig = base.find((e) => e.number === s.number);
    const p = (draft.pairs || []).find((x) => Number(x.number) === s.number) || {};
    const status = p.status === 'remote' || p.status === 'cancelled' ? p.status : 'normal';
    const ol = orig ? orig.lessons : [];
    const origText = ol.length
      ? ol.map((l) => `${esc(l.title)}${l.cabinet ? ' · каб. ' + esc(l.cabinet) : ''}${l.teacher ? ' · ' + esc(l.teacher) : ''}`).join('<br>')
      : 'В колледже пары нет';
    const ph = (f, def) => esc((ol[0] && ol[0][f]) || def);
    return `
      <div class="prow" data-n="${s.number}">
        <div class="prow-head"><b>${s.number} пара</b><span class="college" data-ptime>${hm(s.start)}–${hm(s.end)}</span></div>
        <div class="college">${draft.replaceAll ? '<i>Своё расписание — данные колледжа не используются</i>' : origText}</div>
        <div class="seg status">
          <button data-st="normal" class="${status === 'normal' ? 'on' : ''}">Как есть</button>
          <button data-st="remote" class="${status === 'remote' ? 'on remote' : ''}">Дистант</button>
          <button data-st="cancelled" class="${status === 'cancelled' ? 'on cancelled' : ''}">Отменена</button>
        </div>
        <div class="fields">
          <input type="text" data-f="title" value="${esc(p.title)}" placeholder="${orig && !draft.replaceAll ? 'Замена: ' + ph('title', 'предмет') : 'Предмет'}">
          <input type="text" data-f="cabinet" value="${esc(p.cabinet)}" placeholder="${orig && !draft.replaceAll ? ph('cabinet', 'Кабинет') : 'Кабинет'}">
          <input type="text" data-f="teacher" value="${esc(p.teacher)}" placeholder="${orig && !draft.replaceAll ? ph('teacher', 'Преподаватель') : 'Преподаватель'}">
        </div>
      </div>`;
  }).join('');

  box.innerHTML = wd === 7 ? '<div class="card">Воскресенье — выходной.</div>' : `
    <div class="card">
      <div class="prow-head"><h2 style="margin:0">${WD[wd - 1]}, ${fmt.dMon(day)}</h2>
        <button class="small-btn" data-reset>Сбросить день</button></div>
      ${col.error ? `<p class="warn">Сайт колледжа не ответил (${esc(col.error)}). Можно прописать пары вручную — включи «Своё расписание».</p>` : ''}
      ${!col.error && !base.length ? '<p class="college">Колледж пока ничего не опубликовал на этот день.</p>' : ''}
      <label class="switch" style="margin:10px 0"><input type="checkbox" data-all ${draft.replaceAll ? 'checked' : ''}>
        Своё расписание на день (не брать пары колледжа)</label>
      <label class="lbl" for="note">Заметка к дню</label>
      <textarea id="note" placeholder="Например: 3 пара в актовом зале">${esc(draft.note)}</textarea>
    </div>
    <div class="card">
      <b>Поднятие флага и классный час</b>
      ${chInfo.map(([f, t, v, on]) => {
        const val = draft[f] === true ? 'on' : draft[f] === false ? 'off' : 'auto';
        return `<div class="ch-day" data-chk="${f}">
          <div class="ch-row"><span class="ch-name">${t}</span><span>${hm(v.start)}–${hm(v.end)}</span></div>
          <div class="seg status">
            <button data-v="auto" class="${val === 'auto' ? 'on' : ''}">Как обычно (${on ? 'есть' : 'нет'})</button>
            <button data-v="on" class="${val === 'on' ? 'on' : ''}">Добавить</button>
            <button data-v="off" class="${val === 'off' ? 'on cancelled' : ''}">Убрать</button>
          </div></div>`;
      }).join('')}
      <p class="college" style="margin:8px 0 0">Время флага и классного часа меняется в «Расписании звонков» выше.</p>
    </div>
    <div class="card">
      <div class="prow-head"><b>Время пар на этот день</b>
        <button class="small-btn" data-dt>${st.dayTimesOpen ? 'Свернуть' : 'Изменить'}</button></div>
      <p class="college" style="margin:6px 0 0" data-dtinfo>${dayTimes.length ? 'Изменено: ' + dayTimes.map((x) => `${x.number} пара ${x.start}–${x.end}`).join(', ') : 'Как обычно, по расписанию звонков.'}</p>
      ${st.dayTimesOpen ? '<div data-dte></div>' : ''}
      ${dayTimes.length ? '<button class="small-btn" data-dtreset style="margin-top:6px">Вернуть обычное время</button>' : ''}
    </div>
    <div class="card">${rows}
      <p class="college" style="margin:10px 0 0">Заполненный предмет/кабинет/преподаватель — это замена. Если в колледже пары нет — она добавится.</p>
    </div>
    <div class="card preview"><b>Так увидят на сайте и в приложениях</b><div data-preview></div></div>`;
  if (wd === 7) return;

  box.querySelector('[data-reset]').onclick = () => { delete st.data.days[k]; changed(true); };
  box.querySelector('[data-all]').onchange = (e) => { dayDraft(true).replaceAll = e.target.checked; changed(true); };
  box.querySelector('#note').oninput = (e) => { dayDraft(true).note = e.target.value; changed(false); };
  box.querySelectorAll('[data-chk]').forEach((row) => {
    const f = row.dataset.chk;
    row.querySelectorAll('[data-v]').forEach((b) => {
      b.onclick = () => {
        const d = dayDraft(true);
        if (b.dataset.v === 'auto') delete d[f]; else d[f] = b.dataset.v === 'on';
        changed(true);
      };
    });
  });
  box.querySelector('[data-dt]').onclick = () => { st.dayTimesOpen = !st.dayTimesOpen; renderDay(); };
  const dtr = box.querySelector('[data-dtreset]');
  if (dtr) dtr.onclick = () => { delete dayDraft(true).times; changed(true); };
  const dte = box.querySelector('[data-dte]');
  if (dte) {
    timesEditor(dte, slots, (ns) => {
      const diff = ns.filter((x) => !globalSlots.some((y) => y.number === x.number && y.start === x.start && y.end === x.end));
      dayDraft(true).times = toStr(diff);
      const t = normSlots(dayDraft().times);
      box.querySelector('[data-dtinfo]').textContent = t.length ? 'Изменено: ' + t.map((x) => `${x.number} пара ${x.start}–${x.end}`).join(', ') : 'Как обычно, по расписанию звонков.';
      for (const x of ns) {
        const el = box.querySelector(`.prow[data-n="${x.number}"] [data-ptime]`);
        if (el && x.end > x.start) el.textContent = `${hm(x.start)}–${hm(x.end)}`;
      }
      changed(false);
    }, withOv(nd, () => buildTimeline(wd, col.lessons, k)).filter((e) => e.type === 'ch')
      .map((e) => ({ name: e.kind === 'flag' ? 'флаг' : 'классный час', start: e.start, end: e.end })));
  }
  box.querySelectorAll('.prow').forEach((row) => {
    const n = Number(row.dataset.n);
    row.querySelectorAll('[data-st]').forEach((b) => { b.onclick = () => { pairDraft(n).status = b.dataset.st; changed(true); }; });
    row.querySelectorAll('[data-f]').forEach((inp) => { inp.oninput = () => { pairDraft(n)[inp.dataset.f] = inp.value; changed(false); }; });
  });
  renderPreview(col.lessons);
}

function renderPreview(lessons) {
  const el = $app.querySelector('[data-preview]');
  if (!el) return;
  const tl = withOv(normalize(st.data), () => buildTimeline(T.weekday(st.selected), lessons, iso()));
  const d = normalize(st.data).days[iso()];
  el.innerHTML = (d && d.note ? `<div class="pv"><span class="n">Заметка</span><span>${esc(d.note)}</span></div>` : '') +
    (tl.filter((e) => e.type !== 'break').map((e) => {
      if (e.type === 'ch') return `<div class="pv ch"><span class="n">${hm(e.start)}–${hm(e.end)}</span><span>${esc(e.title)}</span></div>`;
      const l = e.lessons.map((x) => `${x.cancelled || e.cancelled ? '<s>' : ''}${esc(x.title)}${x.cabinet ? ' · ' + esc(x.cabinet) : ''}${e.cancelled ? '</s>' : ''}`).join(' / ');
      const tags = [e.remote ? '<span class="tag remote">Дистант</span>' : '', e.cancelled ? '<span class="tag cancel">Отменена</span>' : '',
        e.lessons.some((x) => x.replaced) ? '<span class="tag">Замена</span>' : '', e.lessons.some((x) => x.added) ? '<span class="tag">Добавлена</span>' : ''].join(' ');
      return `<div class="pv"><span class="n">${e.number} · ${hm(e.start)}–${hm(e.end)}</span><span>${l} ${tags}</span></div>`;
    }).join('') || '<p class="college">Пар нет</p>');
}

let previewTimer = null;
function changed(rerender) {
  st.msg = null;
  if (rerender) renderDay();
  else { clearTimeout(previewTimer); previewTimer = setTimeout(() => renderPreview((st.college.get(iso()) || {}).lessons || []), 200); }
  renderWeek();
  renderChanged();
  status();
}

function renderChanged() {
  const el = $app.querySelector('[data-changed]');
  const days = Object.keys(normalize(st.data).days);
  el.innerHTML = `<b>Дни с изменениями</b>` + (days.length
    ? `<div class="changed-days" style="margin-top:8px">${days.map((k) => `<button class="small-btn" data-go="${k}">${fmt.dMon(T.parseIso(k))}</button>`).join('')}</div>`
    : '<p class="college" style="margin:6px 0 0">Пока нет. Прошедшие дни удаляются сами при сохранении.</p>');
  el.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => select(T.parseIso(b.dataset.go)); });
}

function status() {
  const el = $app.querySelector('[data-status]');
  const btn = $app.querySelector('[data-save]');
  if (!el) return;
  const d = dirty();
  btn.disabled = st.saving || !d;
  btn.textContent = st.saving ? 'Сохраняю…' : 'Сохранить';
  el.textContent = st.msg ? st.msg.text : d ? 'Есть несохранённые изменения' : 'Всё сохранено';
  el.style.color = st.msg && st.msg.kind === 'warn' ? '#b3261e' : '';
}

async function save() {
  if (st.saving || !dirty()) return;
  st.saving = true; st.msg = null; status();
  const out = normalize(st.data);
  out.updatedAt = new Date().toISOString();
  const text = JSON.stringify(out, null, 2) + '\n';
  try {
    const r = await api('overrides', { text, sha: st.sha });
    st.sha = r.sha;
    st.data = JSON.parse(JSON.stringify(out));
    for (const k of Object.keys(st.data.days)) st.data.days[k] = { note: '', replaceAll: false, ...st.data.days[k] };
    st.saved = JSON.stringify(normalize(st.data));
    st.msg = { kind: 'ok', text: 'Сохранено. У всех появится через 1–3 минуты.' };
  } catch (e) {
    st.msg = e.code === 'conflict' ? { kind: 'warn', text: 'Расписание изменили в другом месте — обнови страницу и повтори.' }
      : e.status === 401 ? { kind: 'warn', text: 'Вход истёк — выйди и войди по паролю ещё раз.' }
        : { kind: 'warn', text: 'Не сохранилось: ' + e.message };
  } finally {
    st.saving = false;
    renderWeek(); renderChanged(); status();
  }
}

window.addEventListener('beforeunload', (e) => { if (st.data && dirty()) { e.preventDefault(); e.returnValue = ''; } });

// Запуск — из index.html (вкладка «Изменение расписания»).
export const schedule = { start: boot, dirty: () => !!st.data && dirty(), discard: () => { st.data = null; } };
