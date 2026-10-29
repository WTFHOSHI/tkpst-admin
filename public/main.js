// Вкладки админ-панели: «Изменение расписания» и «Посещаемость».
import { schedule } from './admin.js?v=__V__';
import { attendance } from './att.js?v=__V__';
import { users } from './users.js?v=__V__';
import { panelReady, currentRole } from './backend.js?v=__V__';
import { showPanelLogin } from './login-view.js?v=__V__';

const app = document.getElementById('app');
document.querySelector('[data-skip-content]').onclick = () => app.focus();
const tabs = { schedule, att: attendance, users };
let current = null;
let stopLogin = null;
const want = () => Object.hasOwn(tabs, location.hash.slice(1)) ? location.hash.slice(1)
  : (() => { try { const saved = localStorage.getItem('admin_tab'); return Object.hasOwn(tabs, saved) ? saved : 'schedule'; } catch { return 'schedule'; } })();

const themeButton = document.querySelector('[data-admin-theme]');
function renderTheme() {
  const dark = document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  themeButton.setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
  themeButton.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${dark ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>' : '<path d="M20.5 13a8.5 8.5 0 0 1-9.5-9.5A8.5 8.5 0 1 0 20.5 13Z"/>'}</svg>`;
}
themeButton.onclick = () => {
  const dark = themeButton.getAttribute('aria-label') === 'Включить светлую тему';
  const theme = dark ? 'light' : 'dark'; document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('theme', JSON.stringify(theme)); } catch { /* private mode */ }
  renderTheme();
};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderTheme);
renderTheme();
function renderSession() {
  const role = currentRole();
  document.body.dataset.auth = role ? 'signed-in' : 'signed-out';
  const label = document.querySelector('[data-session-label]');
  label.textContent = role ? ({ admin: 'Администратор', starosta: 'Староста', kurator: 'Куратор' }[role]) : 'Доступ по паролю';
  label.dataset.saved = role ? (role === 'kurator' ? 'До закрытия вкладки' : 'Вход сохранён') : '';
}

window.addEventListener('admin-session-change', renderSession);
window.addEventListener('admin-storage-change', () => location.reload());
function open(name) {
  if (name === current) return;
  if (current && tabs[current].dirty()) {
    const ok = confirm(current === 'schedule'
      ? 'В расписании есть несохранённые изменения. Перейти без сохранения?'
      : 'Не все отметки ещё сохранены. Перейти всё равно?');
    if (!ok) { history.replaceState(null, '', '#' + current); return; }
    if (current === 'schedule') schedule.discard();
  }
  if (current === 'att') attendance.stop();
  if (current === 'users') users.stop();
  current = name;
  try { localStorage.setItem('admin_tab', name); } catch { /* ignore */ }
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  renderSession();
  document.querySelectorAll('[data-tab]').forEach(a => { const active = a.dataset.tab === name; a.classList.toggle('on', active); if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  document.title = name === 'users' ? 'ТКПСТ · Пользователи' : name === 'att' ? 'ТКПСТ · Посещаемость' : 'ТКПСТ · Админ-панель';
  if (!panelReady()) {
    if (stopLogin) return;
    stopLogin = showPanelLogin(app, () => { stopLogin?.(); stopLogin = null; current = null; open(want()); });
    return;
  }
  stopLogin?.(); stopLogin = null;
  app.innerHTML = '';
  tabs[name].start(app);
}
window.addEventListener('hashchange', () => open(want()));
window.addEventListener('admin-logout', () => queueMicrotask(() => {
  if (!panelReady()) { if (current === 'att') attendance.stop(); if (current === 'users') users.stop(); current = null; open(want()); }
}));
open(want());
