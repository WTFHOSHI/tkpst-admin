// Настройка панели (только администратор): пароли ролей + ключ GitHub → «сейф» vault.json,
// и перенос данных со старого сервера на Netlify (если страница открыта на старом адресе).
import {
  makeVault, openVault, loadVault, newDataKey, startSession, checkGithubKey, writeData, api,
  OWNER, DATA_REPO, SCHEDULE_REPO,
} from './backend.js?v=__V__';

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
{
  let theme = 'system';
  try { theme = JSON.parse(localStorage.getItem('theme')) || 'system'; } catch { /* ignore */ }
  document.documentElement.dataset.theme = theme;
}
const bar = (sub) => `<header class="bar"><span class="icon-space"></span>
  <div class="bar-title"><div class="t">Настройка панели</div><div class="s">${esc(sub)}</div></div><span class="icon-space"></span></header>`;
const pw = (id, label) => `<label class="lbl" for="${id}">${label}</label><input id="${id}" type="password" autocomplete="new-password" placeholder="не короче 10 символов">`;
const val = (id) => ($app.querySelector('#' + id)?.value || '').trim();

let existing = null;   // открытый старый сейф (смена паролей) — чтобы сохранить ключ данных
let vaultFile = null;  // новый сейф (текст)

async function start() {
  $app.innerHTML = `<main class="admin"><div class="card">Загружаю…</div></main>`;
  let vault = null;
  try { vault = await loadVault(); } catch (e) { return form(e.message); }
  if (vault && !existing) return unlock(vault);
  form();
}

/** Сейф уже есть: сначала пароль администратора (иначе потеряется ключ данных и всё зашифрованное). */
function unlock(vault, error = '') {
  $app.innerHTML = `${bar('смена паролей и ключа GitHub')}
    <main class="admin"><div class="card">
      <b>Панель уже настроена</b>
      <p class="college">Чтобы сменить пароли или ключ GitHub, введи текущий пароль администратора.</p>
      ${pw('cur', 'Пароль администратора')}
      ${error ? `<p class="warn" style="margin-top:10px">${esc(error)}</p>` : ''}
      <button class="btn" data-go style="margin-top:12px;width:100%">Дальше</button>
      <p class="college" style="margin-top:12px"><a href="./">← В панель</a></p>
    </div></main>`;
  const go = async () => {
    const b = $app.querySelector('[data-go]'); b.disabled = true; b.textContent = 'Проверяю…';
    const s = await openVault(vault, val('cur'));
    if (!s) return unlock(vault, 'Неверный пароль');
    if (s.role !== 'admin') return unlock(vault, 'Это не пароль администратора');
    existing = s; form();
  };
  $app.querySelector('[data-go]').onclick = go;
  $app.querySelector('#cur').onkeydown = (e) => { if (e.key === 'Enter') go(); };
}

function form(error = '') {
  $app.innerHTML = `${bar(existing ? 'смена паролей и ключа GitHub' : 'первый запуск')}
    <main class="admin">
      <div class="card">
        <b>1. Приватный репозиторий для данных</b>
        <p class="college">На GitHub создай репозиторий <b>${DATA_REPO}</b> — обязательно <b>Private</b>
          (<a href="https://github.com/new?name=${DATA_REPO}&visibility=private" target="_blank" rel="noopener">создать</a>).
          ФИО и отметки будут лежать там в зашифрованном виде.</p>
      </div>
      <div class="card">
        <b>2. Ключ GitHub</b>
        ${existing ? '<p class="college">Оставь пустым, чтобы не менять ключ.</p>' : ''}
        <ol class="steps">
          <li>Открой <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Settings → Fine-grained tokens → Generate new token</a>.</li>
          <li>Expiration — самый долгий срок (запомни дату: когда ключ истечёт, зайди сюда и вставь новый).</li>
          <li>Repository access → <b>Only select repositories</b> → <b>${DATA_REPO}</b> и <b>${SCHEDULE_REPO}</b>.</li>
          <li>Permissions → Repository permissions → <b>Contents: Read and write</b>.</li>
          <li>Generate token → скопируй и вставь сюда.</li>
        </ol>
        <label class="lbl" for="ghk">Ключ GitHub</label>
        <input id="ghk" type="password" autocomplete="off" placeholder="github_pat_…">
      </div>
      <div class="card">
        <b>3. Пароли</b>
        <p class="college">Длинные и разные (лучше 3–4 случайных слова). Сейф с данными защищён только паролями — короткий пароль можно подобрать.</p>
        ${pw('p_admin', 'Администратор (ты)')}
        ${pw('p_starosta', 'Староста')}
        ${pw('p_kurator', 'Куратор')}
      </div>
      ${error ? `<p class="warn">${esc(error)}</p>` : ''}
      <button class="btn" data-make style="width:100%">Создать сейф</button>
    </main>`;
  $app.querySelector('[data-make]').onclick = make;
}

async function make() {
  const gh = val('ghk') || (existing && existing.gh) || '';
  const passwords = { admin: val('p_admin'), starosta: val('p_starosta'), kurator: val('p_kurator') };
  if (!gh) return form('Вставь ключ GitHub');
  if (Object.values(passwords).some((p) => p.length < 10)) return form('Каждый пароль — не короче 10 символов');
  if (new Set(Object.values(passwords)).size < 3) return form('Пароли должны быть разными');
  const b = $app.querySelector('[data-make]'); b.disabled = true; b.textContent = 'Проверяю ключ…';
  let problems;
  try { problems = await checkGithubKey(gh); } catch (e) { return form(e.message); }
  if (problems.length) return form('Ключ GitHub: ' + problems.join('; '));
  b.textContent = 'Шифрую… (несколько секунд)';
  const dk = existing ? existing.dk : newDataKey();
  const vault = await makeVault({ passwords, gh, dk });
  vaultFile = JSON.stringify(vault, null, 1);
  startSession({ role: 'admin', gh, dk }, false);
  done();
}

async function oldServerHere() {
  try {
    const r = await fetch('/api/me', { cache: 'no-store' });
    return (r.headers.get('content-type') || '').includes('application/json');
  } catch { return false; }
}

async function done() {
  const migrate = await oldServerHere();
  $app.innerHTML = `${bar('почти готово')}
    <main class="admin">
      <div class="card">
        <b>4. Загрузи сейф на GitHub</b>
        <ol class="steps">
          <li><button class="btn outline" data-dl>Скачать vault.json</button></li>
          <li>Открой <a href="https://github.com/${OWNER}/tkpst-admin/upload/main/public" target="_blank" rel="noopener">загрузку файлов в папку public</a>
            и перетащи туда скачанный <b>vault.json</b> → Commit changes.</li>
          <li>Через 1–2 минуты панель на GitHub Pages начнёт пускать по новым паролям.</li>
        </ol>
        <p class="college">В vault.json нет ни паролей, ни данных в открытом виде — его можно хранить в публичном репозитории.</p>
      </div>
      ${migrate ? `
      <div class="card" data-mig>
        <b>5. Перенос данных со старого сервера</b>
        <p class="college">Заберу список студентов и все отметки (1–3 курс) со старого сервера Netlify,
          зашифрую и положу в ${DATA_REPO}. Введи <b>старый</b> пароль администратора.</p>
        <label class="lbl" for="oldpw">Старый пароль администратора</label>
        <input id="oldpw" type="password" autocomplete="off">
        <button class="btn" data-mig-go style="margin-top:12px;width:100%">Перенести данные</button>
        <div data-mig-log class="college" style="margin-top:10px;white-space:pre-line"></div>
      </div>` : `
      <div class="card"><p class="college">Перенос со старого сервера доступен, только если открыть эту страницу на старом адресе
        (tkpst-poseshchaemost.netlify.app/setup.html, через VPN).</p></div>`}
    </main>`;
  $app.querySelector('[data-dl]').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([vaultFile], { type: 'application/json' }));
    a.download = 'vault.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const mg = $app.querySelector('[data-mig-go]');
  if (mg) mg.onclick = runMigration;
}

async function runMigration() {
  const btn = $app.querySelector('[data-mig-go]');
  const log = $app.querySelector('[data-mig-log]');
  const say = (t) => { log.textContent += t + '\n'; };
  log.textContent = '';
  btn.disabled = true;
  const old = async (path, body, token) => {
    const r = await fetch('/api/' + path, {
      method: body ? 'POST' : 'GET', cache: 'no-store',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error((data && data.error) || 'старый сервер ответил ' + r.status);
    return data;
  };
  try {
    say('Вход на старый сервер…');
    const { token } = await old('login', { password: val('oldpw') });
    const config = await old('config', null, token);
    for (const k of ['1', '2', '3']) {
      const list = (config.courses?.[k]?.students) || [];
      const gone = list.filter((x) => x.to).length;
      say(`${k} курс: в списке ${list.length - gone}` + (gone ? `, ещё ${gone} убраны из списка (их старые отметки сохраняются)` : ''));
    }
    let current = null;
    try { current = await api('config'); } catch (e) { if (e.code === 'no_repo') throw e; }
    const has = current && Object.values(current.courses).some((c) => c.students.length);
    if (has && !confirm(`В ${DATA_REPO} уже есть данные. Заменить их данными со старого сервера?`)) { say('Отменено.'); btn.disabled = false; return; }
    await writeData('config.json', config, 'Перенос: студенты и настройки');
    let total = 0;
    for (const course of ['1', '2', '3']) {
      const { weeks } = await old(`weeks?course=${course}`, null, token);
      const list = Object.entries(weeks || {}).filter(([, w]) => w);
      for (const [monday, week] of list) {
        await writeData(`w/${course}/${monday}.json`, week, 'Перенос: отметки');
        total++;
        say(`${course} курс · неделя ${monday} ✓`);
      }
    }
    say(`\nГотово: перенесено недель — ${total}. Всё зашифровано и лежит в ${DATA_REPO}.`);
    btn.textContent = 'Перенесено';
  } catch (e) {
    say('Ошибка: ' + e.message);
    btn.disabled = false;
  }
}

start();
