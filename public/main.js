// Вкладки админ-панели: «Изменение расписания» и «Посещаемость».
import { schedule } from './admin.js?v=__V__';
import { attendance } from './att.js?v=__V__';
import { users } from './users.js?v=__V__';

const app = document.getElementById('app');
const tabs = { schedule, att: attendance, users };
let current = null;
const want = () => Object.hasOwn(tabs, location.hash.slice(1)) ? location.hash.slice(1)
  : (() => { try { const saved = localStorage.getItem('admin_tab'); return Object.hasOwn(tabs, saved) ? saved : 'schedule'; } catch { return 'schedule'; } })();

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
  document.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
  document.title = name === 'users' ? 'ТКПСТ · Пользователи' : name === 'att' ? 'ТКПСТ · Посещаемость' : 'ТКПСТ · Админ-панель';
  app.innerHTML = '';
  tabs[name].start(app);
}
window.addEventListener('hashchange', () => open(want()));
open(want());
