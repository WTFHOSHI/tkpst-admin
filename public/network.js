export async function fetchJsonWithTimeout(fetchImpl, url, init = {}, timeoutMs = 8000) {
  const controller = new AbortController(); let timer, onAbort;
  const abortError = () => new DOMException('Запрос отменён', 'AbortError');
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); const error = new Error('Сервер не ответил вовремя. Повторите запрос.'); error.code = 'timeout'; reject(error); }, timeoutMs);
    onAbort = () => { controller.abort(); reject(abortError()); };
    if (init.signal?.aborted) onAbort(); else init.signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([deadline, (async () => {
      if (controller.signal.aborted) throw abortError();
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      let data = null;
      if (response.status !== 204) { try { data = await response.json(); } catch (error) { if (controller.signal.aborted) throw error; } }
      if (controller.signal.aborted) throw abortError();
      return { response, data };
    })()]);
  } finally { clearTimeout(timer); init.signal?.removeEventListener('abort', onAbort); }
}

// Сервис ЛК отвечает по двум адресам. Основной (Cloudflare) работает сразу и без VPN,
// резервный (Render) может просыпаться до минуты. Запрос повторяется на резервном
// адресе только если соединение с основным не состоялось. После тайм-аута или ответа
// с ошибкой повторять нельзя: одноразовый билет синхронизации мог быть уже использован.
export const API_BASES = Object.freeze(['https://tkpst-account.telling-math.workers.dev/api/admin/', 'https://tkpst-api.onrender.com/api/admin/']);
let preferred = 0;
export function resetApiBase() { preferred = 0; }
export async function postApi(fetchImpl, path, init, { bases = API_BASES, timeouts = [20000, 65000] } = {}) {
  let lastError;
  for (let index = preferred; index < bases.length; index++) {
    try {
      const result = await fetchJsonWithTimeout(fetchImpl, bases[index] + path, init, timeouts[index] ?? timeouts.at(-1));
      preferred = index;
      return result;
    } catch (error) {
      if (error.name === 'AbortError' || error.code === 'timeout' || index + 1 >= bases.length) throw error;
      lastError = error; preferred = index + 1;
    }
  }
  throw lastError || new Error('Сервис ЛК недоступен.');
}
