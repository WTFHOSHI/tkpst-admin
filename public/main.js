// Вкладки админ-панели: «Изменение расписания» и «Посещаемость».
import { schedule } from './admin.js?v=__V__';
import { attendance } from './att.js?v=__V__';

const app = document.getElementById('app');
const tabs = { schedule, att: attendance };
let current = null;
const want = () => (location.hash === '#att' ? 'att' : location.hash === '#schedule' ? 'schedule'
  : (() => { try { return localStorage.getItem('admin_tab') || 'schedule'; } catch { return 'schedule'; } })());

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
  current = name;
  try { localStorage.setItem('admin_tab', name); } catch { /* ignore */ }
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  document.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
  document.title = name === 'att' ? 'ТКПСТ · Посещаемость' : 'ТКПСТ · Админ-панель';
  app.innerHTML = '';
  tabs[name].start(app);
}
window.addEventListener('hashchange', () => open(want()));
open(want());
