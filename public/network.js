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
