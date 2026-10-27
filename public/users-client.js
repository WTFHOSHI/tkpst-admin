const API = 'https://tkpst-schedule.vercel.app/api/admin/';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createUsersClient(fetchImpl = fetch) {
  let token = null, expiresAt = 0, revision = 0;
  const clear = () => { token = null; expiresAt = 0; revision++; };
  async function request(path, body = {}, signal) {
    if (!['login', 'users', 'link', 'logout', 'sync', 'sync/start'].includes(path)) throw new Error('Неизвестный адрес API.');
    const version = revision;
    let response;
    try {
      response = await fetchImpl(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000) });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new Error('Нет связи с сервисом ЛК. Проверьте интернет и повторите.');
    }
    const data = response.status === 204 ? {} : await response.json();
    if (!response.ok) {
      if (response.status === 401 && version === revision) clear();
      const error = new Error(data.error || 'Не удалось выполнить запрос.'); error.status = response.status; throw error;
    }
    return data;
  }
  return {
    request, clear, authorized: () => !!token && expiresAt > Date.now(),
    credentials: () => token ? { token, expiresAt } : null,
    restore(saved) {
      if (!saved || typeof saved.token !== 'string' || !Number.isFinite(saved.expiresAt) || saved.expiresAt <= Date.now()) { clear(); return; }
      if (saved.token !== token || saved.expiresAt !== expiresAt) { token = saved.token; expiresAt = saved.expiresAt; revision++; }
    },
    async login(password, signal) {
      const version = revision;
      const data = await request('login', { password }, signal);
      if (version === revision && !signal?.aborted) { token = data.token; expiresAt = data.expiresAt || Date.now() + 864e5; revision++; }
      return data;
    },
    async logout() {
      const pending = token ? request('logout') : Promise.resolve();
      clear(); // A role switch must stop using the old bearer before the network returns.
      await pending;
    },
  };
}

export function usersMarkup(data, search = '', { offset = 0, status = 'all' } = {}) {
  const active = data.students.filter(s => s.active);
  const rows = data.users.map(user => {
    const linked = user.link ? `${user.link.course}:${user.link.studentId}` : '';
    const initials = String(user.displayName).trim().split(/\s+/).slice(0, 2).map(s => s[0]).join('').toLocaleUpperCase('ru');
    const date = new Date(user.createdAt);
    return `<details class="user-row" data-user="${esc(user.id)}"><summary class="user-summary">
      <span class="user-person"><span class="user-avatar" aria-hidden="true">${esc(initials)}</span><span class="user-name"><strong>${esc(user.displayName)}</strong><span>@${esc(user.username)}</span></span></span>
      <span class="user-badge ${user.student ? 'verified' : ''}">${user.student ? 'Подтверждён' : 'Без привязки'}</span>
      <time class="user-date" datetime="${esc(date.toISOString())}" title="${esc(date.toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' }))}">${esc(date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Yekaterinburg' }))}</time>
      <svg class="user-chevron" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary>
      <div class="user-detail"><div class="user-record"><h2>${user.student ? 'Связь подтверждена' : 'Подтверждение студента'}</h2><p>${user.student ? `${esc(user.student.displayName)}<br>${esc(user.student.groupName || 'Группа не указана')} · ${esc(user.student.course)} курс` : linked ? 'Прежняя привязка неактивна: студент выбыл или отсутствует в текущем списке.' : 'Сверьте личность владельца аккаунта и выберите его из списка посещаемости.'}</p><p class="college">После подтверждения ФИО и группа появятся в личном кабинете студента.</p></div>
      <div class="user-link"><label class="lbl" for="student-${esc(user.id)}">Студент из «Посещаемости»</label><select id="student-${esc(user.id)}" data-student><option value="">Выберите студента</option>${active.map(s => `<option value="${esc(s.course + ':' + s.id)}" ${linked === s.course + ':' + s.id ? 'selected' : ''}>${esc(s.displayName)} · ${esc(s.groupName || 'Без группы')} · ${esc(s.course)} курс</option>`).join('')}</select>
      ${active.length ? '' : '<p class="college">В списке нет активных студентов. Проверьте «Посещаемость» и обновите список.</p>'}
      <div class="user-actions"><button class="btn" data-link ${active.length ? '' : 'disabled'}>Подтвердить привязку</button>${linked ? '<button class="btn outline" data-unlink>Снять привязку</button>' : ''}</div>
      <div class="user-confirm" data-row-confirm hidden></div><p class="college user-row-status" data-row-status role="status"></p></div></div></details>`;
  }).join('');
  return `<div class="users-list-head"><span>${search || status !== 'all' ? 'Найдено' : 'Всего аккаунтов'}: <strong>${data.total}</strong></span><span class="college">Нажмите на аккаунт, чтобы открыть</span></div>
    ${rows ? '<div class="users-column-head" aria-hidden="true"><span>Студент / логин</span><span>Статус</span><span>Регистрация</span><span></span></div>' + rows : `<div class="users-empty"><h2>${search || status !== 'all' ? 'Подходящих аккаунтов нет' : 'Пока никто не зарегистрировался'}</h2><p>${search || status !== 'all' ? 'Измените запрос или выберите фильтр «Все».' : 'Здесь появятся студенты, которые зарегистрируются в приложении.'}</p></div>`}
    <div class="users-pagination"><span class="college">${data.total ? `${offset + 1}–${offset + data.users.length} из ${data.total}` : '0 аккаунтов'}</span><div><button class="small-btn" data-previous ${offset ? '' : 'disabled'}>Назад</button><button class="small-btn" data-next ${data.nextOffset !== null ? '' : 'disabled'}>Далее</button></div></div>`;
}
