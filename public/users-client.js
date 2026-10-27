const API = 'https://tkpst-schedule.vercel.app/api/admin/';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createUsersClient(fetchImpl = fetch) {
  let token = null, revision = 0;
  const clear = () => { token = null; revision++; };
  async function request(path, body = {}, signal) {
    if (!['login', 'users', 'link', 'logout'].includes(path)) throw new Error('Неизвестный адрес API.');
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
    request, clear, authorized: () => !!token,
    async login(password, signal) {
      const version = revision;
      const data = await request('login', { password }, signal);
      if (version === revision && !signal?.aborted) { token = data.token; revision++; }
      return data;
    },
    async logout() {
      const pending = token ? request('logout') : Promise.resolve();
      clear(); // A role switch must stop using the old bearer before the network returns.
      await pending;
    },
  };
}

export function usersMarkup(data, search = '') {
  const active = data.students.filter(s => s.active);
  const rows = data.users.map(user => {
    const linked = user.link ? `${user.link.course}:${user.link.studentId}` : '';
    return `<article class="user-row" data-user="${esc(user.id)}"><div class="user-identity"><h2>${esc(user.displayName)}</h2><p>@${esc(user.username)}</p><p class="college">Регистрация: ${esc(new Date(user.createdAt).toLocaleString('ru-RU'))}</p></div>
      <div class="user-link"><p class="user-link-status">${user.student ? `Подтверждён: ${esc(user.student.displayName)} · ${esc(user.student.groupName)} · ${esc(user.student.course)} курс` : linked ? 'Привязанный студент выбыл или отсутствует в списке' : 'Связь со студентом не подтверждена'}</p>
      <label class="lbl" for="student-${esc(user.id)}">Студент из списка посещаемости</label><select id="student-${esc(user.id)}" data-student><option value="">Выберите студента</option>${active.map(s => `<option value="${esc(s.course + ':' + s.id)}" ${linked === s.course + ':' + s.id ? 'selected' : ''}>${esc(s.displayName)} · ${esc(s.groupName || 'Без группы')} · ${esc(s.course)} курс</option>`).join('')}</select>
      <div class="user-actions"><button class="btn" data-link ${active.length ? '' : 'disabled'}>Подтвердить привязку</button>${linked ? '<button class="btn outline" data-unlink>Снять привязку</button>' : ''}</div><p class="college" data-row-status role="status"></p></div></article>`;
  }).join('');
  return `<div class="users-summary" role="status">${search ? 'Найдено аккаунтов' : 'Зарегистрировано аккаунтов'}: <strong>${data.total}</strong></div>
    ${rows || `<div class="users-empty"><h2>${search ? 'Ничего не найдено' : 'Пока никто не зарегистрировался'}</h2><p>${search ? 'Попробуйте другой логин или имя.' : 'Новые аккаунты появятся здесь после регистрации в приложении.'}</p></div>`}
    ${data.nextOffset !== null ? '<button class="btn outline" data-next>Следующие 100 аккаунтов</button>' : ''}`;
}
