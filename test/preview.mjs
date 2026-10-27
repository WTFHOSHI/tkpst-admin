// Isolated browser QA: real frontend modules with synthetic vault/GitHub/API.
// Never contacts the production services or uses real session credentials.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createCipheriv } from 'node:crypto';
import { makeVault } from '../public/backend.js';
const origin = 'http://127.0.0.1:4181', root = fileURLToPath(new URL('../public/', import.meta.url));
const passwords = { admin: 'qa-admin-only', starosta: 'qa-starosta-only', kurator: 'qa-kurator-only' };
const dk = randomBytes(32), token = 'q'.repeat(43);
const vault = await makeVault({ passwords, gh: 'qa-github', dk: dk.toString('base64'), iter: 1000 });
const config = { courses: { 1: { groupId: null, groupName: '', students: [] }, 2: { groupId: 196, groupName: 'ИС-25-3С', students: [{ id: 's1', name: 'Тестовый Студент' }, { id: 's2', name: 'Второй Тестовый Студент' }] }, 3: { groupId: null, groupName: '', students: [] } } };
const students = config.courses[2].students.map(s => ({ id: s.id, displayName: s.name, course: '2', groupName: 'ИС-25-3С', active: true }));
const users = [{ id: 'u1', username: 'test_student', displayName: 'Тестовый Студент', createdAt: Date.now(), student: null }, { id: 'u2', username: 'verified_test', displayName: 'Второй Тестовый Студент', createdAt: Date.now() - 864e5, student: students[1], link: { course: '2', studentId: 's2' } }];
function encryptedConfig() { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', dk, iv); c.setAAD(Buffer.from('data:config.json')); return JSON.stringify({ v: 1, iv: iv.toString('base64'), ct: Buffer.concat([c.update(JSON.stringify(config)), c.final(), c.getAuthTag()]).toString('base64') }); }
const server = createServer(async (req, res) => {
  const url = new URL(req.url, origin), path = url.pathname;
  const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  if (path === '/vault.json') return json(200, vault);
  if (path.startsWith('/sched')) return json(200, []);
  if (path.startsWith('/qa-github/')) {
    if (path.endsWith('/config.json')) return json(200, { content: Buffer.from(encryptedConfig()).toString('base64'), sha: 'qa-config' });
    if (path.endsWith('/overrides.json')) return json(200, { content: Buffer.from('{}').toString('base64'), sha: 'qa-overrides' });
    if (!path.includes('/contents/')) return json(200, { permissions: { push: true } });
    return json(404, {});
  }
  if (path.startsWith('/qa-api/')) {
    const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if (path.endsWith('/login')) return body.password === passwords.admin ? json(200, { token, expiresAt: Date.now() + 864e5 }) : json(401, { error: 'Неверный тестовый пароль' });
    if (req.headers.authorization !== 'Bearer ' + token) return json(401, { error: 'Нужен тестовый вход' });
    if (path.endsWith('/users')) { const list = users.filter(u => (!body.search || (u.displayName + u.username).toLowerCase().includes(body.search.toLowerCase())) && (!body.status || body.status === 'all' || (body.status === 'linked' ? !!u.student : !u.student))); return json(200, { users: list, students, total: list.length, nextOffset: null, syncedAt: Date.now() }); }
    if (path.endsWith('/link')) { const user = users.find(u => u.id === body.userId); user.student = students.find(s => s.id === body.studentId) || null; user.link = user.student ? { course: body.course, studentId: body.studentId } : null; return json(200, { ok: true }); }
    if (path.endsWith('/sync/start')) return json(200, { ticket: 't'.repeat(43) });
    return json(200, { ok: true });
  }
  try {
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path)); if (!file.startsWith(resolve(root) + '\\') && !file.startsWith(resolve(root) + '/')) return json(403, {});
    let data = await readFile(file); const ext = extname(file);
    if (ext === '.js') data = Buffer.from(data.toString().replace("const API = 'https://tkpst-schedule.onrender.com/api/admin/';", `const API = '${origin}/qa-api/';`).replace("const GH = 'https://api.github.com';", `const GH = '${origin}/qa-github';`));
    if (ext === '.html') data = Buffer.from(data.toString().replace('<body>', '<body><aside style="text-align:center;padding:6px;font-size:12px">Тестовый стенд · демонстрационные данные</aside>'));
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' })[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data);
  } catch { json(404, {}); }
});
server.listen(4181, '127.0.0.1', () => console.log('Synthetic admin QA: ' + origin));
