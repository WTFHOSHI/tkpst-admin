import { createUsersClient, usersMarkup } from './users-client.js?v=__V__';
import { logout as logoutAdmin } from './backend.js?v=__V__';

const client = createUsersClient();
let host, version = 0, controller, last = null, offset = 0, search = '';
const valid = v => v === version && location.hash === '#users';
const message = (text, error = false) => {
  const el = host?.querySelector('[data-users-message]');
  if (el) { el.textContent = text; el.className = error ? 'warn' : 'college'; }
};

function login(note = '') {
  host.innerHTML = `<header class="bar"><div class="bar-title"><div class="t">Пользователи</div><div class="s">Личные кабинеты студентов</div></div></header>
    <main class="admin users-login"><h1>Вход администратора</h1><p>Здесь можно посмотреть зарегистрированные аккаунты и связать их со студентами из «Посещаемости».</p>
    <form data-users-login><label class="lbl" for="users-password">Пароль администратора</label><input id="users-password" name="password" type="password" autocomplete="current-password" maxlength="256" required><p class="college">Введите действующий пароль администратора админки. Доступ открывается на 30 минут; пароль не сохраняется.</p><button class="btn" type="submit">Открыть пользователей</button></form>
    <p data-users-message role="alert" class="college"></p><p class="college">При входе список студентов обновится из зашифрованных данных админки. Пароли старосты и куратора не дают доступ к аккаунтам.</p></main>`;
  message(note, !!note);
  host.querySelector('form').onsubmit = async event => {
    event.preventDefault(); const v = version;
    const input = event.currentTarget.elements.password, button = event.currentTarget.querySelector('button');
    const password = input.value; input.value = ''; button.disabled = true; button.textContent = 'Проверяем доступ…'; message('');
    try {
      await client.login(password, controller.signal);
      if (valid(v)) { offset = 0; search = ''; shell(); await load(); }
    } catch (error) {
      if (valid(v) && error.name !== 'AbortError') { message(error.message, true); button.disabled = false; button.textContent = 'Открыть пользователей'; input.focus(); }
    }
  };
}
function shell() {
  host.innerHTML = `<header class="bar"><div class="bar-title"><div class="t">Пользователи</div><div class="s">Личные кабинеты студентов</div></div></header>
    <main class="admin users-main"><div class="users-heading"><div><h1>Аккаунты студентов</h1><p class="college">Сверьте личность студента перед привязкой. ФИО и группа появятся в его ЛК после подтверждения.</p></div><button class="btn outline" data-users-exit>Выйти</button></div>
    <form class="users-search" data-users-search><label for="users-search">Поиск по имени или логину</label><div><input id="users-search" name="search" type="text" maxlength="120" placeholder="Имя или @логин"><button class="btn" type="submit">Найти</button></div></form>
    <div class="users-tools"><button class="btn outline" data-users-refresh>Обновить аккаунты</button><button class="btn outline" data-users-sync>Обновить список студентов</button><button class="btn outline" data-users-first hidden>К началу списка</button></div>
    <p class="college" data-users-sync-date></p><p data-users-message role="status" class="college"></p><div data-users-list aria-busy="true"></div></main>`;
  host.querySelector('[data-users-search]').onsubmit = event => { event.preventDefault(); search = event.currentTarget.elements.search.value.trim().replace(/^@/, ''); offset = 0; load(); };
  host.querySelector('[data-users-refresh]').onclick = () => load();
  host.querySelector('[data-users-first]').onclick = () => { offset = 0; load(); };
  host.querySelector('[data-users-sync]').onclick = async () => { const v = version; await client.logout().catch(() => {}); if (valid(v)) login('Введите пароль администратора, чтобы заново получить актуальный список студентов.'); };
  host.querySelector('[data-users-exit]').onclick = async event => {
    event.currentTarget.disabled = true; const v = version;
    await client.logout().catch(() => {}); logoutAdmin();
    if (valid(v)) login();
  };
}
let loadNumber = 0;
async function load() {
  const v = version, number = ++loadNumber;
  const list = host.querySelector('[data-users-list]'); if (!list) return;
  list.setAttribute('aria-busy', 'true'); message('Загружаем аккаунты…');
  // Hide stale actionable rows while a new page/search is loading.
  list.replaceChildren(); last = null;
  try {
    const data = await client.request('users', { search, offset }, controller.signal);
    if (!valid(v) || number !== loadNumber) return;
    last = data; list.innerHTML = usersMarkup(data, search); list.setAttribute('aria-busy', 'false'); message('');
    host.querySelector('[data-users-first]').hidden = offset === 0;
    host.querySelector('[data-users-sync-date]').textContent = data.syncedAt ? 'Список студентов обновлён: ' + new Date(data.syncedAt).toLocaleString('ru-RU') : 'Список студентов ещё не загружен.';
    list.querySelector('[data-next]')?.addEventListener('click', () => { offset = data.nextOffset; load(); });
    for (const row of list.querySelectorAll('[data-user]')) {
      row.querySelector('[data-link]').onclick = () => link(row, false);
      row.querySelector('[data-unlink]')?.addEventListener('click', () => link(row, true));
    }
  } catch (error) {
    if (!valid(v) || number !== loadNumber || error.name === 'AbortError') return;
    if (!client.authorized()) { login(error.message); return; }
    list.setAttribute('aria-busy', 'false'); message(error.message, true);
  }
}
async function link(row, unlink) {
  const v = version;
  const user = last?.users.find(u => u.id === row.dataset.user);
  const value = row.querySelector('[data-student]').value;
  const student = last?.students.find(s => s.course + ':' + s.id === value);
  const status = row.querySelector('[data-row-status]');
  if (!user || !unlink && !student) { status.textContent = 'Сначала выберите студента.'; return; }
  const label = unlink ? `Снять привязку аккаунта @${user.username}?` : `Подтвердить: аккаунт @${user.username} принадлежит студенту ${student.displayName}, ${student.course} курс?`;
  if (!confirm(label)) return;
  row.querySelectorAll('button,select').forEach(el => { el.disabled = true; }); status.textContent = 'Сохраняем…';
  try {
    await client.request('link', { userId: user.id, studentId: unlink ? null : student.id, ...(unlink ? {} : { course: student.course }) }, controller.signal);
    if (valid(v)) { await load(); message(unlink ? 'Привязка снята.' : 'Привязка подтверждена. Студент увидит свои ФИО и группу в ЛК.'); }
  } catch (error) {
    if (!valid(v) || error.name === 'AbortError') return;
    if (!client.authorized()) { login(error.message); return; }
    status.textContent = error.message; row.querySelectorAll('button,select').forEach(el => { el.disabled = false; });
  }
}
globalThis.addEventListener?.('admin-logout', () => { client.logout().catch(() => {}); });
export const users = {
  dirty: () => false,
  start(element) { host = element; version++; controller = new AbortController(); if (client.authorized()) { shell(); load(); } else login(); },
  stop() { version++; controller?.abort(); last = null; },
};
