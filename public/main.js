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

// Те же палитры и режимы, что в обычном приложении.
const paletteOptions = [
  ['forest', 'Зелёная', '#4F6F2F'], ['ocean', 'Синяя', '#285A91'],
  ['violet', 'Лиловая', '#6A4EA3'], ['sand', 'Тёплая', '#8B5319'],
  ['mono', 'Чёрно-белая', 'linear-gradient(90deg, #161616 50%, #fff 50%)'],
];
const colorRoles = ["primary","on-primary","primary-c","on-primary-c","secondary-c","on-secondary-c","secondary","tertiary","tertiary-c","on-tertiary-c","bg","card","card-high","text","muted","outline"];
const paletteColors = {
  "ocean": [
    "#285A91 #fff #D9EAFE #0C2A49 #E3ECF7 #172638 #586A7D #7D5D21 #F6E9CC #332405 #F5F8FC #EDF3FA #E1EAF4 #18212D #526173 #BBC8D8",
    "#9BC7F2 #0B3155 #294767 #D5EAFE #314152 #DCE9F6 #B8CADB #E9C98E #5B4523 #FBE9C7 #111820 #1A2430 #263342 #E7EFF7 #BBCBDA #435365"
  ],
  "violet": [
    "#6A4EA3 #fff #E9E0FB #2A1A4A #EFE9F6 #2D2538 #6A6074 #91573E #F7E4D9 #4B2719 #FAF8FC #F4EFF8 #EAE3F1 #251D2E #61576D #CCC0D7",
    "#D1B7F7 #31204C #51366F #F0DBFF #42354E #EFE6F5 #C6B8D1 #E9B39C #633A31 #FFE1D1 #17131C #211B28 #302737 #F0EAF4 #C5B9CC #52475B"
  ],
  "sand": [
    "#8B5319 #fff #F8DEC0 #382005 #F4EADB #34271B #706253 #59672B #E8EECF #27310D #FBF8F2 #F4EEE4 #EBE2D4 #29231C #63594F #D2C4B3",
    "#F2BB7A #422600 #6C451F #FFE3BE #463729 #F2E6D5 #D0BEA7 #BACB80 #454F25 #EAF3BC #191510 #242019 #332A20 #F2E9DC #C8BAA8 #594B3D"
  ],
  "mono": [
    "#303030 #fff #E2E2E2 #161616 #ECECEC #222 #555 #424242 #DEDEDE #202020 #fff #F4F4F4 #EAEAEA #161616 #555 #C6C6C6",
    "#E8E8E8 #171717 #383838 #F2F2F2 #303030 #E9E9E9 #C6C6C6 #D2D2D2 #424242 #F4F4F4 #111 #1C1C1C #2A2A2A #F3F3F3 #BDBDBD #4B4B4B"
  ]
};
const themeButton = document.querySelector('[data-admin-theme]');
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const readPreference = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
let themeMode = readPreference('theme', 'system');
let palette = readPreference('palette', 'forest');
const themeDialog = document.createElement('dialog');
themeDialog.className = 'admin-theme-dialog';
themeDialog.setAttribute('aria-labelledby', 'admin-theme-title');
themeDialog.innerHTML = '<div class="theme-dialog-header"><h2 id="admin-theme-title">Оформление</h2><button type="button" class="icon" data-close-theme aria-label="Закрыть настройки темы">✕</button></div>' +
  '<h3>Цветовая тема</h3><div class="theme-grid" role="radiogroup" aria-label="Цветовая тема">' +
  paletteOptions.map(([value, label, swatch]) => '<label class="theme-choice"><input type="radio" name="admin-palette" value="' + value + '"><span class="theme-swatch" style="--swatch:' + swatch + '" aria-hidden="true"></span><span>' + label + '</span></label>').join('') +
  '</div><h3>Режим</h3><div role="radiogroup" aria-label="Режим оформления">' +
  [['system', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(([value, label]) => '<label class="radio"><input type="radio" name="admin-theme" value="' + value + '"><span>' + label + '</span></label>').join('') + '</div>';
const themeStyle = document.createElement('style');
themeStyle.textContent = ".admin-theme-dialog { width:min(460px,calc(100% - 24px)); max-height:calc(100dvh - 32px); overflow:auto; padding:24px; border:1px solid var(--outline); border-radius:24px; background:var(--bg); color:var(--text); box-shadow:0 24px 80px #0004; } .admin-theme-dialog::backdrop { background:#0006; } .theme-dialog-header { display:flex; align-items:center; justify-content:space-between; gap:12px; } .theme-dialog-header h2 { margin:0; font-size:22px; } .admin-theme-dialog h3 { margin:22px 0 12px; font-size:15px; color:var(--muted); } .theme-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }\r\n.theme-choice { display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 58px; padding: 10px 12px; background: var(--card); border: 2px solid transparent; border-radius: 14px; font-size: 15px; font-weight: 650; cursor: pointer; }\r\n.theme-choice input { position: absolute; width: 1px; height: 1px; opacity: 0; }\r\n.theme-choice:has(input:checked) { background: var(--primary-c); color: var(--on-primary-c); border-color: var(--primary); }\r\n.theme-choice:focus-within { outline: 3px solid var(--primary); outline-offset: 2px; }\r\n.theme-swatch { flex: none; width: 24px; height: 24px; border-radius: 50%; background: var(--swatch); border: 2px solid color-mix(in srgb, var(--text) 12%, transparent); }\r\n@media(max-width:359px) { .admin-theme-dialog { padding:16px; } .theme-choice { padding:8px; gap:7px; font-size:14px; } }";
document.head.append(themeStyle);
document.body.append(themeDialog);
function renderTheme() {
  if (!['system', 'light', 'dark'].includes(themeMode)) themeMode = 'system';
  if (!paletteOptions.some(([key]) => key === palette)) palette = 'forest';
  const dark = themeMode === 'dark' || (themeMode === 'system' && systemTheme.matches);
  const root = document.documentElement;
  root.dataset.theme = themeMode;
  root.dataset.palette = palette;
  root.dataset.appearance = dark ? 'dark' : 'light';
  const colors = paletteColors[palette]?.[dark ? 1 : 0].split(' ');
  colorRoles.forEach((role, i) => {
    if (colors) root.style.setProperty('--' + role, colors[i]);
    else root.style.removeProperty('--' + role);
  });
  root.style.colorScheme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim();
  themeDialog.querySelectorAll('input').forEach(input => {
    input.checked = input.value === (input.name === 'admin-theme' ? themeMode : palette);
  });
  themeButton.setAttribute('aria-label', 'Настроить тему');
  themeButton.title = 'Оформление: ' + paletteOptions.find(([key]) => key === palette)[1];
  themeButton.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor"/></svg>';
}
themeButton.setAttribute('aria-haspopup', 'dialog');
themeButton.onclick = () => { if (!themeDialog.open) themeDialog.showModal(); };
themeDialog.querySelector('[data-close-theme]').onclick = () => themeDialog.close();
themeDialog.addEventListener('close', () => themeButton.focus());
themeDialog.addEventListener('click', event => {
  if (event.target !== themeDialog) return;
  const rect = themeDialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) themeDialog.close();
});
themeDialog.addEventListener('change', event => {
  const input = event.target;
  if (input.name !== 'admin-theme' && input.name !== 'admin-palette') return;
  const key = input.name === 'admin-theme' ? 'theme' : 'palette';
  if (key === 'theme') themeMode = input.value; else palette = input.value;
  try { localStorage.setItem(key, JSON.stringify(input.value)); } catch { /* приватный режим */ }
  renderTheme();
});
systemTheme.addEventListener('change', renderTheme);
window.addEventListener('storage', event => {
  if (event.key !== null && event.key !== 'theme' && event.key !== 'palette') return;
  themeMode = readPreference('theme', 'system');
  palette = readPreference('palette', 'forest');
  renderTheme();
});
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
