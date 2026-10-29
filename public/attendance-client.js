import { fetchJsonWithTimeout } from './network.js?v=__V__';
const API = 'https://tkpst-api.onrender.com/api/admin/attendance/';

export function createAttendanceClient(fetchImpl = fetch) {
  let saved = null, revision = 0;
  const clear = () => { saved = null; revision++; };
  const validExpiry = value => Number.isFinite(value) && (value === 0 || value > Date.now());
  const credentials = () => saved && validExpiry(saved.expiresAt) ? { ...saved } : null;
  async function request(path, body = {}, signal) {
    if (!['login', 'start', 'sync', 'logout'].includes(path)) throw new Error('Неизвестный адрес посещаемости.');
    const version = revision, auth = credentials();
    let response, data;
    try {
      ({ response, data } = await fetchJsonWithTimeout(fetchImpl, API + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth.token } : {}) },
        body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', redirect: 'error', signal,
      }, 65000));
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new Error('Не удалось обновить посещаемость в ЛК. Отметки в админке сохранены.');
    }
    if (response.status !== 204 && (!data || typeof data !== 'object')) throw new Error('Сервис посещаемости вернул неверный ответ.');
    if (!response.ok) {
      if (response.status === 401 && version === revision) clear();
      const error = new Error(data?.error || 'Не удалось обновить посещаемость в ЛК.'); error.status = response.status; throw error;
    }
    return data || {};
  }
  return {
    request, clear, credentials,
    restore(value) {
      if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value.token || '') || !validExpiry(value.expiresAt)) { clear(); return; }
      if (value.token !== saved?.token || value.expiresAt !== saved?.expiresAt) { saved = { token: value.token, expiresAt: value.expiresAt }; revision++; }
    },
    async login(password, role, signal) {
      if (!['admin', 'starosta', 'kurator'].includes(role)) throw new Error('Неизвестная роль.');
      const version = revision;
      const data = await request('login', { password, role }, signal);
      if (version === revision && !signal?.aborted) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(data.token || '') || !validExpiry(data.expiresAt)) throw new Error('Сервис посещаемости не подтвердил вход.');
        saved = { token: data.token, expiresAt: data.expiresAt }; revision++;
      }
      return data;
    },
    async logout() {
      const pending = credentials() ? request('logout') : Promise.resolve();
      clear(); await pending;
    },
  };
}
