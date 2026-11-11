// Вкладки админ-панели: «Изменение расписания» и «Посещаемость».
// Тяжёлые разделы загружаются только при открытии — экран входа остаётся быстрым.
import { panelReady, currentRole } from './backend.js?v=__V__';
import { showPanelLogin } from './login-view.js?v=__V__';

const app = document.getElementById('app');
document.querySelector('[data-skip-content]').onclick = () => app.focus();
const tabLoaders = {
  schedule: () => import('./admin.js?v=__V__').then((module) => module.schedule),
  att: () => import('./att.js?v=__V__').then((module) => module.attendance),
  users: () => import('./users.js?v=__V__').then((module) => module.users),
};
const tabNames = Object.keys(tabLoaders);
const tabModules = new Map();
let current = null;
let activeTab = null;
let openVersion = 0;
let stopLogin = null;
const want = () => tabNames.includes(location.hash.slice(1)) ? location.hash.slice(1)
  : (() => { try { const saved = localStorage.getItem('admin_tab'); return tabNames.includes(saved) ? saved : 'schedule'; } catch { return 'schedule'; } })();

// Те же палитры и режимы, что в обычном приложении.
const paletteOptions = [
  ['forest', 'Зелёная', '#446327'],
  ['mint', 'Мятная', '#206749'],
  ['teal', 'Бирюзовая', '#0D6565'],
  ['sky', 'Небесная', '#055F86'],
  ['ocean', 'Синяя', '#285994'],
  ['indigo', 'Индиго', '#4A4E99'],
  ['violet', 'Лиловая', '#674689'],
  ['rose', 'Розовая', '#853C58'],
  ['crimson', 'Красная', '#933331'],
  ['sand', 'Тёплая', '#784C2D'],
  ['amber', 'Янтарная', '#725200'],
  ['graphite', 'Графит', '#4F5964'],
  ['mono', 'Чёрно-белая', 'linear-gradient(90deg, #161616 50%, #fff 50%)'],
  ['black', 'Бело-чёрная', 'linear-gradient(90deg, #fff 50%, #000 50%)'],
];
// Стили те же, что в приложении: меняют форму, шрифт и поверхности.
const styleOptions = [['calm', 'Спокойный'], ['quiet', 'Тихий'], ['native', 'Системный'], ['glass', 'Стекло'], ['soft', 'Мягкий'], ['terminal', 'Терминал'], ['paper', 'Бумага'], ['band', 'Цветной'], ['outline', 'Контур']];
const colorRoles = ["primary","on-primary","primary-c","on-primary-c","secondary-c","on-secondary-c","secondary","tertiary","tertiary-c","on-tertiary-c","bg","card","card-high","text","muted","outline"];
const paletteColors = {
  "forest": [
    "#446327 #FFFFFF #DDECD1 #1C2C0C #E7EEE3 #1E241A #555F4D #6D5829 #F3E5C9 #342707 #F9FBF7 #EEF2EB #E2E8DE #171C14 #575D52 #C9D1C3",
    "#AEC89A #17240B #334326 #DCEAD2 #2D3328 #E1E7DD #B1BBA9 #D0BB92 #483B20 #EFE3CB #0F110E #191C16 #252922 #E5E9E3 #ADB4A8 #464D42"
  ],
  "mint": [
    "#206749 #FFFFFF #D2EEDF #092E1F #E2EFE8 #19251F #4C6056 #72552B #F6E3C9 #372508 #F7FBF9 #EBF3EE #DEE9E3 #131D18 #515E57 #C3D2CA",
    "#9BCBB2 #082519 #254536 #D3ECDE #27342D #DDE8E2 #A8BDB2 #D5B993 #4B3A21 #F3E2CB #0D120F #161C19 #212A25 #E2EAE6 #A8B5AE #414E47"
  ],
  "teal": [
    "#0D6565 #FFFFFF #CFEDED #012D2D #E0EFEE #162525 #476060 #785130 #FBE1CC #3B220D #F6FBFB #E9F3F3 #DBEAE9 #101D1D #4E5F5E #C0D2D2",
    "#95C9C8 #042525 #204444 #D0EBEA #243433 #DBE8E7 #A4BDBD #DBB597 #4F3724 #F7E0CE #0D1212 #151C1C #1F2A2A #E1EAEA #A5B5B4 #3E4E4E"
  ],
  "sky": [
    "#055F86 #FFFFFF #CCEBFF #012A3E #E1EDF5 #18232A #4B5E69 #795033 #FCE0CE #3C220F #F7FBFD #EAF2F7 #DDE8EF #121C22 #505D65 #C2D0D9",
    "#90C6E6 #012333 #1C4256 #CDE9FB #273239 #DCE6ED #A7BBC7 #DDB499 #503726 #F8DFCF #0D1114 #161C1F #21292E #E2E9EE #A7B3BB #404C54"
  ],
  "ocean": [
    "#285994 #FFFFFF #D7E8FD #0D2746 #E4ECF6 #1B222B #505C6C #74542C #F8E2CA #382409 #F8FAFD #ECF1F8 #E0E7F0 #151B23 #535C66 #C5CFDB",
    "#9CC1F1 #0B2039 #263E5C #D4E6FE #2A313A #DEE5EE #ACB9CA #D7B894 #4C3922 #F4E1CC #0E1114 #171B20 #23282F #E3E8EF #AAB2BD #434B55"
  ],
  "indigo": [
    "#4A4E99 #FFFFFF #E0E5FE #1F2149 #E8EAF6 #1F212B #57596C #754B67 #FADCEF #391F31 #F9FAFE #EFF0F8 #E3E5F0 #181A23 #585A66 #CACDDB",
    "#B0B9F5 #191B3B #35395F #DEE3FE #2E2F3B #E2E4EE #B3B6CA #D9AFCA #4D3445 #F6DCEC #101014 #191A20 #26272F #E6E7EF #AEB0BD #484A55"
  ],
  "violet": [
    "#674689 #FFFFFF #EDE0FE #2E1D40 #EDE9F4 #241F29 #5F5769 #7E4B47 #FEDEDA #3E1E1C #FBF9FD #F2EFF7 #E8E4EE #1C1921 #5D5864 #D1CBD9",
    "#C9B1E7 #251834 #443557 #EBDEFC #332E39 #E7E2EC #BBB3C6 #E2AFAA #523431 #FBDCD9 #111013 #1C191F #29262E #E9E6ED #B4AEBB #4D4853"
  ],
  "rose": [
    "#853C58 #FFFFFF #FEDCE6 #3E1726 #F5E7EB #2A1E22 #69545B #72552B #F6E3C9 #372508 #FDF9FA #F8EEF1 #EFE2E6 #22171A #65565B #DAC9CE",
    "#E7AABD #32131F #55303D #FCDAE4 #392C30 #EDE1E4 #C7B0B7 #D5B993 #4B3A21 #F3E2CB #140F10 #1F191A #2E2528 #EEE5E8 #BBADB1 #54464A"
  ],
  "crimson": [
    "#933331 #FFFFFF #FDDEDB #451312 #F6E7E6 #2B1E1D #6B5552 #6D5829 #F3E5C9 #342707 #FDF9F8 #F8EEED #F0E3E1 #221716 #665755 #DBC9C7",
    "#F4A69F #38100F #5D2D2A #FDDCD8 #3A2D2B #EEE1E0 #C9B1AE #D0BB92 #483B20 #EFE3CB #140F0F #1F1918 #2F2524 #EEE5E4 #BCADAB #554645"
  ],
  "sand": [
    "#784C2D #FFFFFF #F8E1D3 #372010 #F6E8DF #2B1F17 #6B5648 #45653E #D9EDD4 #1B2F17 #FDF9F6 #F8EFE9 #F0E3DB #231811 #66584E #DBCABF",
    "#DAB59D #2D1A0D #4E3728 #F4E0D3 #3A2D25 #EEE2DA #C9B2A3 #AAC8A3 #30432C #D9EBD5 #140F0D #201915 #2F251F #EFE6E0 #BDAEA4 #55473E"
  ],
  "amber": [
    "#725200 #FFFFFF #F4E4C9 #342300 #F2EADD #272114 #655944 #3D6646 #D4EED8 #15301B #FCFAF6 #F5F0E7 #ECE5D9 #201A0F #625A4C #D6CDBD",
    "#D4BA8B #2A1D01 #4B3A1B #F1E3CA #362F22 #EAE4D8 #C2B6A0 #A3C9AA #2C4431 #D5ECD9 #13100C #1E1A14 #2C271E #ECE7DF #B8B0A2 #51493C"
  ],
  "graphite": [
    "#4F5964 #FFFFFF #E2E7EC #22272D #E7ECF0 #1E2226 #555C63 #74542C #F8E2CA #382409 #F9FAFC #EEF1F4 #E3E7EB #171B1F #575B60 #C9CED4",
    "#B6BFC8 #1B2024 #383E43 #E0E5EA #2D3135 #E1E5E9 #B1B8C0 #D7B894 #4C3922 #F4E1CC #0F1112 #191B1D #25282B #E5E8EB #ADB2B7 #464B50"
  ],
  "mono": [
    "#303030 #fff #E2E2E2 #161616 #ECECEC #222 #555 #424242 #DEDEDE #202020 #fff #F4F4F4 #EAEAEA #161616 #555 #C6C6C6",
    "#E8E8E8 #171717 #383838 #F2F2F2 #303030 #E9E9E9 #C6C6C6 #D2D2D2 #424242 #F4F4F4 #111 #1C1C1C #2A2A2A #F3F3F3 #BDBDBD #4B4B4B"
  ],
  "black": [
    "#F2F2F2 #000000 #262626 #F5F5F5 #1C1C1C #EDEDED #BEBEBE #D6D6D6 #2E2E2E #F5F5F5 #000000 #0E0E0E #1A1A1A #F5F5F5 #B4B4B4 #3A3A3A",
    "#F2F2F2 #000000 #262626 #F5F5F5 #1C1C1C #EDEDED #BEBEBE #D6D6D6 #2E2E2E #F5F5F5 #000000 #0E0E0E #1A1A1A #F5F5F5 #B4B4B4 #3A3A3A"
  ]
};
const themeButton = document.querySelector('[data-admin-theme]');
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
const readPreference = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
let themeMode = readPreference('theme', 'system');
let palette = readPreference('palette', 'forest');
let lookStyle = readPreference('style', 'calm');
const themeDialog = document.createElement('dialog');
themeDialog.className = 'admin-theme-dialog';
themeDialog.setAttribute('aria-labelledby', 'admin-theme-title');
themeDialog.innerHTML = '<div class="theme-dialog-header"><h2 id="admin-theme-title">Оформление</h2><button type="button" class="icon" data-close-theme aria-label="Закрыть настройки темы">✕</button></div>' +
  '<h3>Стиль</h3><div class="theme-grid" role="radiogroup" aria-label="Стиль оформления">' +
  styleOptions.map(([value, label]) => '<label class="theme-choice"><input type="radio" name="admin-style" value="' + value + '"><span>' + label + '</span></label>').join('') + '</div>' +
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
  if (!styleOptions.some(([key]) => key === lookStyle)) lookStyle = 'calm';
  // Чёрная тема тёмная всегда.
  const dark = palette === 'black' || themeMode === 'dark' || (themeMode === 'system' && systemTheme.matches);
  const root = document.documentElement;
  root.dataset.theme = themeMode;
  root.dataset.palette = palette;
  root.dataset.style = lookStyle;
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
    input.checked = input.value === (input.name === 'admin-theme' ? themeMode : input.name === 'admin-style' ? lookStyle : palette);
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
  if (!['admin-theme', 'admin-palette', 'admin-style'].includes(input.name)) return;
  const key = input.name.slice('admin-'.length);
  if (key === 'theme') themeMode = input.value; else if (key === 'style') lookStyle = input.value; else palette = input.value;
  try { localStorage.setItem(key, JSON.stringify(input.value)); } catch { /* приватный режим */ }
  renderTheme();
});
systemTheme.addEventListener('change', renderTheme);
window.addEventListener('storage', event => {
  if (event.key !== null && !['theme', 'palette', 'style'].includes(event.key)) return;
  themeMode = readPreference('theme', 'system');
  palette = readPreference('palette', 'forest');
  lookStyle = readPreference('style', 'calm');
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
async function open(name) {
  if (name === current && activeTab) return;
  const version = ++openVersion;
  const previous = activeTab;
  if (current && previous?.dirty?.()) {
    const ok = confirm(current === 'schedule'
      ? 'В расписании есть несохранённые изменения. Перейти без сохранения?'
      : 'Не все отметки ещё сохранены. Перейти всё равно?');
    if (!ok) { history.replaceState(null, '', '#' + current); return; }
    if (current === 'schedule') previous.discard?.();
  }
  previous?.stop?.();
  activeTab = null;
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
  app.innerHTML = '<main class="admin"><div class="card">Загружаю раздел…</div></main>';
  try {
    const tab = tabModules.get(name) || await tabLoaders[name]();
    if (version !== openVersion || current !== name || !panelReady()) return;
    tabModules.set(name, tab);
    activeTab = tab;
    app.innerHTML = '';
    tab.start(app);
  } catch (error) {
    if (version !== openVersion || current !== name) return;
    app.innerHTML = '<main class="admin"><div class="card warn">Не удалось загрузить раздел: ' + error.message + '</div><button class="btn" data-retry>Ещё раз</button></main>';
    app.querySelector('[data-retry]').onclick = () => open(name);
  }
}
window.addEventListener('hashchange', () => open(want()));
window.addEventListener('admin-logout', () => queueMicrotask(() => {
  if (!panelReady()) { activeTab?.stop?.(); activeTab = null; current = null; open(want()); }
}));
open(want());
