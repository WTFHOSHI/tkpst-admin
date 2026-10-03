// Логика старого сервера на Netlify. Общая часть — в public/att-logic.js (её же использует панель на GitHub Pages).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ROLES } from '../../../public/att-logic.js';
export * from '../../../public/att-logic.js';

const DAY = 864e5;
// ---------------- Вход ----------------

const b64u = (buf) => Buffer.from(buf).toString('base64url');

/** Какая роль у пароля (сравнение без утечки по времени). env: {admin, kurator, starosta} */
export function roleForPassword(password, env) {
  const p = Buffer.from(String(password || ''));
  let found = null;
  for (const role of Object.keys(ROLES)) {
    const want = env[role];
    if (!want) continue;
    const w = Buffer.from(String(want));
    if (w.length === p.length && timingSafeEqual(w, p)) found = role;
  }
  return found;
}

export function signToken(role, secret, now = Date.now(), days = 30) {
  const payload = b64u(JSON.stringify({ role, exp: now + days * DAY }));
  const sig = b64u(createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyToken(token, secret, now = Date.now()) {
  if (!token || !secret) return null;
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return null;
  const want = Buffer.from(b64u(createHmac('sha256', secret).update(payload).digest()));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!ROLES[data.role] || !(data.exp > now)) return null;
    return data;
  } catch { return null; }
}

