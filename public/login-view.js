import { api } from './backend.js?v=__V__';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const panelIcon = name => {
  const paths = { eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>', refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 2M4 16l2 2a7 7 0 0 0 12-1"/>', search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>', back: '<path d="m14 6-6 6 6 6"/>', next: '<path d="m10 6 6 6-6 6"/>' };
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
};
export function loginMarkup(note = '') {
  return `<header class="bar"><span class="icon-space"></span><div class="bar-title"><div class="t">Админ-панель</div><div class="s">ИС-25-3С · единый вход</div></div><span class="icon-space"></span></header>
    <main class="admin panel-login"><section class="card"><h1>Вход по паролю</h1><p class="college panel-login-intro">Один вход для расписания, посещаемости и пользователей. Введите пароль своей роли.</p>
    <form data-panel-login><label class="lbl" for="panel-password">Пароль</label><div class="panel-password"><input id="panel-password" name="password" type="password" autocomplete="current-password" placeholder="Введите пароль" maxlength="256" required><button type="button" class="icon" data-show-password aria-label="Показать пароль" aria-pressed="false">${panelIcon('eye')}</button></div>
    <label class="panel-remember"><input type="checkbox" name="remember">Запомнить на этом устройстве на 1 день</label>
    <p class="warn" data-login-error role="alert" ${note ? '' : 'hidden'}>${escapeHtml(note)}</p>
    <button class="btn panel-submit" type="submit">Войти в админ-панель</button></form>
    <p class="college panel-login-foot">На общем устройстве не включайте запоминание и выходите после работы.</p></section>
    <div class="panel-access-note"><p class="college">Расписание и посещаемость доступны администратору, старосте и куратору. Управление аккаунтами — администратору.</p><a href="setup.html">Настройка админ-панели</a></div></main>`;
}
export function showPanelLogin(host, onSuccess, note = '') {
  const controller = new AbortController(); host.innerHTML = loginMarkup(note);
  const form = host.querySelector('[data-panel-login]'), input = form.elements.password, button = form.querySelector('[type=submit]'), error = form.querySelector('[data-login-error]');
  host.querySelector('[data-show-password]').onclick = event => {
    const visible = input.type === 'password'; input.type = visible ? 'text' : 'password';
    event.currentTarget.setAttribute('aria-pressed', String(visible)); event.currentTarget.setAttribute('aria-label', visible ? 'Скрыть пароль' : 'Показать пароль'); input.focus();
  };
  form.onsubmit = async event => {
    event.preventDefault(); if (button.disabled) return;
    const password = input.value, remember = form.elements.remember.checked;
    input.value = ''; button.disabled = true; button.textContent = 'Проверяем доступ…'; error.hidden = true; form.setAttribute('aria-busy', 'true');
    try {
      await api('login', { password, remember });
      if (!controller.signal.aborted) onSuccess();
    } catch (e) {
      if (controller.signal.aborted) return;
      error.textContent = e.status === 401 ? 'Неверный пароль или вход отменён. Повторите попытку.' : e.message; error.hidden = false;
      button.disabled = false; button.textContent = 'Войти в админ-панель'; form.setAttribute('aria-busy', 'false'); input.focus();
    }
  };
  input.focus();
  return () => controller.abort();
}
