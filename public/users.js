import { usersMarkup, studentRemovalMarkup } from './users-client.js?v=__V__';
import { usersApi, syncUsers, api, currentRole, panelReady, logout } from './backend.js?v=__V__';
import { T } from './js/core.js?v=__V__';
import { showPanelLogin, panelIcon } from './login-view.js?v=__V__';
import { showDeleteConfirmation } from './delete-confirm.js?v=__V__';

let host, version = 0, controller, last = null, offset = 0, search = '', status = 'all', loadNumber = 0;
let initialSyncRequired = true;
let stopReconnect = null;
const valid = v => v === version && location.hash === '#users';
const message = (text, error = false) => {
  const el = host?.querySelector('[data-users-message]');
  if (el) { el.textContent = text; el.className = error ? 'warn' : 'ok'; el.hidden = !text; }
};
const header = () => `<header class="bar"><span class="icon-space"></span><div class="bar-title"><div class="t">Пользователи</div><div class="s">ИС-25-3С · ${currentRole() === 'admin' ? 'Администратор' : currentRole() === 'kurator' ? 'Куратор' : 'Староста'}</div></div><div class="bar-actions"><button class="icon" data-users-exit aria-label="Выйти из админ-панели">${panelIcon('out')}</button></div></header>`;
function exitButton() { host.querySelector('[data-users-exit]').onclick = () => logout(); }
function shell() {
  host.innerHTML = `${header()}<main class="admin users-main"><section class="card users-toolbar"><div class="users-heading"><div><h1>Личные кабинеты</h1><p class="college">Управление аккаунтами и подтверждение студентов</p></div><div class="users-heading-actions"><button type="button" class="btn outline delete-link" data-remove-directory-student disabled>Удалить студента из группы</button><button class="small-btn users-refresh" data-users-refresh aria-label="Обновить аккаунты">${panelIcon('refresh')}<span>Обновить</span></button></div></div>
    <form class="users-search" data-users-search><label class="lbl" for="users-search">Поиск аккаунта</label><div class="users-search-line"><span aria-hidden="true">${panelIcon('search')}</span><input id="users-search" name="search" type="text" maxlength="120" placeholder="Имя, фамилия или логин" autocomplete="off"><button class="btn" type="submit">Найти</button></div></form>
    <div class="users-filter seg" role="group" aria-label="Статус подтверждения"><button type="button" data-filter="all" aria-pressed="true" class="on">Все</button><button type="button" data-filter="pending" aria-pressed="false">Без привязки</button><button type="button" data-filter="linked" aria-pressed="false">Подтверждённые</button></div></section>
    <p data-users-message role="status" hidden></p><section class="card users-list" data-users-list aria-label="Зарегистрированные пользователи" aria-busy="true"></section>
    <div class="users-source"><div><strong>Список студентов</strong><p class="college" data-users-sync-date>Из раздела «Посещаемость»</p></div><div class="users-source-actions"><button class="small-btn" data-users-sync>${panelIcon('refresh')}<span>Обновить список</span></button></div></div><section class="card student-removal-panel" data-student-removal hidden></section></main>`;
  exitButton();
  host.querySelector('[data-users-search]').onsubmit = event => { event.preventDefault(); search = event.currentTarget.elements.search.value.trim().replace(/^@/, ''); offset = 0; load(); };
  host.querySelector('[data-users-refresh]').onclick = () => load();
  host.querySelector('[data-remove-directory-student]').onclick = () => openStudentRemoval();
  host.querySelectorAll('[data-filter]').forEach(button => { button.onclick = () => { status = button.dataset.filter; offset = 0; host.querySelectorAll('[data-filter]').forEach(el => { const on = el === button; el.classList.toggle('on', on); el.setAttribute('aria-pressed', String(on)); }); load(); }; });
  host.querySelector('[data-users-sync]').onclick = async event => {
    const v = version, button = event.currentTarget; button.disabled = true; message('');
    initialSyncRequired = true;
    try { await load(true); if (valid(v) && !initialSyncRequired) message('Список студентов обновлён из «Посещаемости».'); }
    finally { if (valid(v)) button.disabled = false; }
  };
}
async function load(sync = false) {
  const v = version, number = ++loadNumber, list = host.querySelector('[data-users-list]'); if (!list) return;
  const focused = host.contains(document.activeElement) && document.activeElement.closest('[data-users-list]');
  list.setAttribute('aria-busy', 'true'); message(''); last = null;
  host.querySelector('[data-remove-directory-student]').disabled = true;
  host.querySelector('[data-student-removal]').hidden = true;
  list.innerHTML = '<div class="users-loading" role="status"><span class="users-loading-mark" aria-hidden="true"></span><span>Подключаем личные кабинеты…<br><span class="college">Бесплатный сервер может запускаться около минуты. Расписание и посещаемость доступны в соседних вкладках.</span></span></div>';
  try {
    if (sync || initialSyncRequired) { await syncUsers(controller.signal); if (!valid(v) || number !== loadNumber) return; initialSyncRequired = false; }
    const data = await usersApi('users', { search, offset, status }, controller.signal);
    if (!valid(v) || number !== loadNumber) return;
    last = data; list.innerHTML = usersMarkup(data, search, { offset, status }); list.setAttribute('aria-busy', 'false');
    host.querySelector('[data-remove-directory-student]').disabled = !data.students.length;
    host.querySelector('[data-users-sync-date]').textContent = data.syncedAt ? 'Обновлён ' + new Date(data.syncedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' }) : 'Обновите список, чтобы загрузить студентов.';
    list.querySelector('[data-next]').onclick = () => { if (data.nextOffset !== null) { offset = data.nextOffset; load(); } };
    list.querySelector('[data-previous]').onclick = () => { offset = Math.max(0, offset - 100); load(); };
    for (const row of list.querySelectorAll('[data-user]')) {
      row.querySelector('[data-link]').onclick = () => confirmLink(row, false);
      row.querySelector('[data-unlink]')?.addEventListener('click', () => confirmLink(row, true));
      row.querySelector('[data-delete-user]').onclick = () => deleteAccount(row);
      row.querySelector('[data-student]').onchange = () => { row.querySelector('[data-row-confirm]').hidden = true; row.querySelector('[data-row-status]').textContent = ''; };
    }
    if (focused) { list.tabIndex = -1; list.focus({ preventScroll: true }); }
  } catch (error) {
    if (!valid(v) || number !== loadNumber || error.name === 'AbortError') return;
    list.setAttribute('aria-busy', 'false'); message(error.message, true);
    if (error.code === 'cloud_unavailable') {
      list.innerHTML = '<div class="users-empty"><h2>Личные кабинеты временно недоступны</h2><p>Основной вход в админку работает. Для повторного подключения ЛК введите пароль ещё раз; расписание и посещаемость доступны без переподключения.</p><button class="btn outline" data-users-reconnect>Подключить личные кабинеты</button><a class="btn outline" href="#att">К посещаемости</a></div>';
      list.querySelector('[data-users-reconnect]').onclick = () => { version++; controller.abort(); const v = version; stopReconnect = showPanelLogin(host, () => { if (valid(v)) users.start(host); }, 'Повторный вход подключит личные кабинеты. Основные разделы уже доступны.'); };
      return;
    }
    list.innerHTML = '<div class="users-empty"><h2>Не удалось загрузить аккаунты</h2><p>Проверьте соединение и повторите запрос.</p><button class="btn outline" data-users-retry>Попробовать снова</button></div>';
    list.querySelector('[data-users-retry]').onclick = () => load();
  }
}
function deleteAccount(row) {
  const user = last?.users.find(u => u.id === row.dataset.user); if (!user) return;
  row.querySelector('details').open = true;
  const v = version;
  showDeleteConfirmation({ container: row.querySelector('[data-row-confirm]'), title: 'Удалить аккаунт @' + user.username + '?', expected: user.username, label: 'Для подтверждения введите логин', description: 'Аккаунт будет удалён, его сеансы завершатся, а привязка к студенту снимется. Студент и отметки в «Посещаемости» останутся. Восстановить аккаунт нельзя.', onCancel: () => row.querySelector('[data-delete-user]').focus(), onDelete: async confirmUsername => {
    await usersApi('delete-user', { userId: user.id, confirmUsername }, controller.signal);
    if (valid(v)) { if (last?.users.length === 1 && offset > 0) offset = Math.max(0, offset - 100); await load(); message('Аккаунт @' + user.username + ' удалён. Его сеансы завершены.'); }
  } });
}
function openStudentRemoval() {
  if (!last) return;
  const students = last.students.slice(), panel = host.querySelector('[data-student-removal]');
  panel.innerHTML = studentRemovalMarkup(students); panel.hidden = false;
  const select = panel.querySelector('[data-removal-select]');
  panel.querySelector('[data-removal-close]').onclick = () => { panel.hidden = true; host.querySelector('[data-remove-directory-student]').focus(); };
  select.onchange = () => {
    const student = students.find(s => s.course + ':' + s.id === select.value), confirmation = panel.querySelector('[data-directory-delete-confirm]');
    if (!student) { confirmation.hidden = true; return; }
    const v = version;
    showDeleteConfirmation({ container: confirmation, title: 'Удалить студента ' + student.displayName + '?', expected: student.displayName, label: 'Для подтверждения введите ФИО', description: 'Студент будет удалён из списка группы и отвязан от ЛК. Его имя в прежних отметках заменится на «Удалённый студент». Сам аккаунт не удаляется.', onCancel: () => select.focus(), onDelete: async confirmName => {
      select.disabled = true;
      try {
        await api('students', { action: 'delete', course: student.course, id: student.id, confirmName, to: T.iso(T.dayStart(T.now())) });
        let syncError = '';
        try { await syncUsers(controller.signal); } catch (error) { syncError = error.message; }
        if (!valid(v)) return;
        panel.hidden = true;
        if (syncError) {
          initialSyncRequired = true; last = null;
          host.querySelector('[data-remove-directory-student]').disabled = true;
          host.querySelector('[data-users-list]').innerHTML = '<div class="users-empty"><h2>Список группы изменён</h2><p>Обновите список, чтобы применить изменения к личным кабинетам.</p><button class="btn outline" data-retry-removal-sync>Обновить список</button></div>';
          host.querySelector('[data-retry-removal-sync]').onclick = () => load(true);
          message('Студент удалён из группы. Не удалось обновить ЛК: ' + syncError, true);
        } else { await load(); message('Студент удалён из группы, привязка к ЛК снята.'); }
      } finally { if (select.isConnected) select.disabled = false; }
    } });
  };
  select.focus(); panel.scrollIntoView({ block: 'start' });
}
function confirmLink(row, unlink) {
  const user = last?.users.find(u => u.id === row.dataset.user), value = row.querySelector('[data-student]').value;
  const student = last?.students.find(s => s.course + ':' + s.id === value), note = row.querySelector('[data-row-status]');
  if (!user || !unlink && !student) { note.textContent = 'Сначала выберите студента из списка.'; row.querySelector('select').focus(); return; }
  const box = row.querySelector('[data-row-confirm]'); box.hidden = false;
  box.innerHTML = '<p></p><div class="user-actions"><button class="btn" data-confirm-yes>Подтвердить</button><button class="btn outline" data-confirm-cancel>Отмена</button></div>';
  box.querySelector('p').textContent = unlink ? `Снять привязку аккаунта @${user.username}?` : `Аккаунт @${user.username} принадлежит студенту ${student.displayName}, ${student.course} курс?`;
  box.querySelector('[data-confirm-cancel]').onclick = () => { box.hidden = true; row.querySelector(unlink ? '[data-unlink]' : '[data-link]').focus(); };
  box.querySelector('[data-confirm-yes]').onclick = async () => {
    const v = version; row.querySelectorAll('button,select').forEach(el => { el.disabled = true; }); note.textContent = 'Сохраняем…';
    try {
      await usersApi('link', { userId: user.id, studentId: unlink ? null : student.id, ...(unlink ? {} : { course: student.course }) }, controller.signal);
      if (valid(v)) { await load(); message(unlink ? 'Привязка аккаунта снята.' : 'Студент подтверждён. ФИО и группа доступны в его личном кабинете.'); }
    } catch (error) {
      if (!valid(v) || error.name === 'AbortError') return;
      note.textContent = error.message; row.querySelectorAll('button,select').forEach(el => { el.disabled = false; });
    }
  };
  box.querySelector('[data-confirm-yes]').focus();
}
export const users = {
  dirty: () => false,
  start(element) {
    stopReconnect?.(); stopReconnect = null;
    host = element; version++; controller = new AbortController();
    offset = 0; search = ''; status = 'all'; initialSyncRequired = true;
    if (!panelReady()) { showPanelLogin(host, () => users.start(host)); return; }
    if (currentRole() !== 'admin') {
      host.innerHTML = `${header()}<main class="admin"><section class="card users-empty"><h1>Аккаунты доступны администратору</h1><p class="college">Вы вошли как ${currentRole() === 'kurator' ? 'куратор' : 'староста'}. Расписание и посещаемость доступны в соседних вкладках.</p><a class="btn outline" href="#att">К посещаемости</a></section></main>`; exitButton(); return;
    }
    shell(); load(true);
  },
  stop() { version++; controller?.abort(); stopReconnect?.(); stopReconnect = null; last = null; },
};
