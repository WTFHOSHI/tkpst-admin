import { api } from './backend.js?v=__V__';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const panelIcon = name => {
  const paths = { eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>', refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 2M4 16l2 2a7 7 0 0 0 12-1"/>', search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>', back: '<path d="m14 6-6 6 6 6"/>', next: '<path d="m10 6 6 6-6 6"/>' };
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
};
export function loginMarkup(note = '') {
  return `<main class="admin panel-login"><section class="card panel-login-card" aria-labelledby="login-title"><h1 id="login-title">Вход в панель</h1>
    <form data-panel-login><label class="lbl" for="panel-password">Пароль</label><div class="panel-password"><input id="panel-password" name="password" type="password" autocomplete="current-password" maxlength="256" required><button type="button" class="icon" data-show-password aria-label="Показать пароль" aria-pressed="false">${panelIcon('eye')}</button></div>
    <p class="warn" data-login-error role="alert" ${note ? '' : 'hidden'}>${escapeHtml(note)}</p>
    <button class="btn panel-submit" type="submit">Войти</button></form></section></main>`;
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
    const password = input.value;
    input.value = ''; button.disabled = true; button.textContent = 'Проверяем доступ…'; error.hidden = true; input.removeAttribute('aria-invalid'); form.setAttribute('aria-busy', 'true');
    try {
      await api('login', { password });
      if (!controller.signal.aborted) onSuccess();
    } catch (e) {
      if (controller.signal.aborted) return;
      error.textContent = e.status === 401 ? 'Неверный пароль или вход отменён. Повторите попытку.' : e.message; error.hidden = false; input.setAttribute('aria-invalid', 'true');
      button.disabled = false; button.textContent = 'Войти'; form.setAttribute('aria-busy', 'false'); input.focus();
    }
  };
  input.focus();
  return () => controller.abort();
}
