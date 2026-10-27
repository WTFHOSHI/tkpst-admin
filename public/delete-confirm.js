import { escapeHtml as esc } from './login-view.js?v=__V__';
let sequence = 0;

export function deleteConfirmationMarkup({ title, description, expected, label, id = 'delete-confirmation' }) {
  return `<form class="delete-confirm-form"><h3>${esc(title)}</h3><p id="${id}-hint">${esc(description)}</p><label class="lbl" for="${id}">${esc(label)}: <strong>${esc(expected)}</strong></label><input id="${id}" name="confirmation" type="text" autocomplete="off" spellcheck="false" required aria-describedby="${id}-hint"><p class="warn" data-delete-error role="alert" hidden></p><div class="user-actions"><button type="submit" class="btn delete-action" disabled>Удалить навсегда</button><button type="button" class="btn outline" data-delete-cancel>Отмена</button></div></form>`;
}
export function showDeleteConfirmation({ container, title, description, expected, label, onDelete, onCancel = () => {} }) {
  container.innerHTML = deleteConfirmationMarkup({ title, description, expected, label, id: 'delete-confirm-' + ++sequence }); container.hidden = false;
  const form = container.querySelector('form'), input = form.elements.confirmation, submit = form.querySelector('[type=submit]'), cancel = form.querySelector('[data-delete-cancel]'), error = form.querySelector('[data-delete-error]');
  let busy = false;
  input.oninput = () => { submit.disabled = input.value !== expected; error.hidden = true; };
  const close = () => { if (!busy) { container.hidden = true; onCancel(); } };
  cancel.onclick = close; form.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
  form.onsubmit = async event => {
    event.preventDefault(); if (busy || input.value !== expected) return;
    busy = true; error.hidden = true; input.disabled = true; cancel.disabled = true; submit.disabled = true; submit.textContent = 'Удаляем…';
    try { await onDelete(input.value); }
    catch (e) { error.textContent = e.message; error.hidden = false; busy = false; input.disabled = false; cancel.disabled = false; submit.disabled = input.value !== expected; submit.textContent = 'Удалить навсегда'; input.focus(); }
  };
  input.focus(); container.scrollIntoView({ block: 'start' });
}
