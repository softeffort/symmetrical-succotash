'use strict';
// Двухфакторная защита входа для пользователей сайта: код из приложения-аутентификатора (TOTP, 6 цифр, 30 с —
// Google Authenticator, Яндекс Ключ, 1Password и т. п.) и 10 одноразовых резервных кодов на случай потери телефона.
// Вход через Google/GitHub при включённой защите не создаёт сессию сразу: сервер выдаёт «билет» на 10 минут
// (кука premier_2fa) и просит код на странице /login?step=2fa. Сброс — в Панели (карточка пользователя) или
// на сервере: node admin/cli.js reset-user-2fa <логин|почта>.
const crypto = require('crypto');
const store = require('./db');
const { totpCheck, b32enc } = require('./admin/auth');

const TICKET_TTL = 10 * 60000; // время на ввод кода после входа через Google/GitHub
const TICKET_TRIES = 5; // неверных кодов на один билет, дальше — войти заново
const CODES = 10; // резервных кодов в наборе
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789'; // без похожих символов (0/o, 1/l/i)

store.db.exec(`
  CREATE TABLE IF NOT EXISTS user_totp (uid TEXT PRIMARY KEY, secret TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
    last INTEGER NOT NULL DEFAULT 0, codes TEXT NOT NULL DEFAULT '[]', created INTEGER NOT NULL, since INTEGER);
`);
const P = new Map(); const q = (sql) => { let s = P.get(sql); if (!s) { s = store.db.prepare(sql); P.set(sql, s); } return s; };
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const fail = (status, msg) => Object.assign(new Error(msg), { status });
const row = (uid) => q('SELECT * FROM user_totp WHERE uid = ?').get(String(uid || ''));
const codesOf = (r) => { try { const a = JSON.parse(r.codes || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const normBackup = (c) => String(c == null ? '' : c).toLowerCase().replace(/[^a-z0-9]/g, '');
const normTotp = (c) => String(c == null ? '' : c).replace(/\s+/g, '');

function newCodes() {
  const plain = [];
  while (plain.length < CODES) {
    const b = crypto.randomBytes(8); let s = '';
    for (let i = 0; i < 8; i++) s += ALPHA[b[i] % ALPHA.length];
    const c = s.slice(0, 4) + '-' + s.slice(4);
    if (!plain.includes(c)) plain.push(c);
  }
  return { plain, hashes: plain.map((c) => sha(normBackup(c))) };
}

const isOn = (uid) => { const r = row(uid); return !!(r && r.enabled); };
function status(uid) {
  const r = row(uid);
  if (!r || !r.enabled) return { on: false, codesLeft: 0, since: null };
  return { on: true, codesLeft: codesOf(r).length, since: r.since || r.created };
}

// шаг 1: новый секрет (пока не подтверждён кодом — защита не действует)
function setup(u) {
  const r = row(u.id);
  if (r && r.enabled) throw fail(409, 'Двухфакторная защита уже включена');
  const secret = b32enc(crypto.randomBytes(20));
  q(`INSERT INTO user_totp (uid, secret, enabled, last, codes, created) VALUES (?, ?, 0, 0, '[]', ?)
     ON CONFLICT(uid) DO UPDATE SET secret = excluded.secret, enabled = 0, last = 0, codes = '[]', created = excluded.created, since = NULL`).run(u.id, secret, Date.now());
  const name = String(u.email || u.login || u.id).replace(/:/g, '');
  const uri = `otpauth://totp/${encodeURIComponent('Premier:' + name)}?secret=${secret}&issuer=Premier&algorithm=SHA1&digits=6&period=30`;
  return { secret, uri };
}

// шаг 2: код из приложения подтверждает, что секрет сохранён; выдаются резервные коды (показываются один раз)
function enable(u, code, now = Date.now()) {
  const r = row(u.id);
  if (r && r.enabled) throw fail(409, 'Двухфакторная защита уже включена');
  if (!r) throw fail(400, 'Сначала начните подключение заново');
  const step = totpCheck(r.secret, normTotp(code), r.last, now);
  if (!step) throw fail(400, 'Код не подошёл — проверьте время на телефоне и введите новый код');
  const c = newCodes();
  q('UPDATE user_totp SET enabled = 1, last = ?, codes = ?, since = ? WHERE uid = ?').run(step, JSON.stringify(c.hashes), now, u.id);
  return { codes: c.plain };
}

// проверка кода: 'totp' | 'backup' | null. Код из приложения нельзя повторить, резервный код сгорает.
function verify(uid, code, now = Date.now()) {
  const r = row(uid); if (!r || !r.enabled) return null;
  const t = normTotp(code);
  if (/^\d{6}$/.test(t)) {
    const step = totpCheck(r.secret, t, r.last, now);
    if (!step) return null;
    q('UPDATE user_totp SET last = ? WHERE uid = ? AND last < ?').run(step, uid, step);
    return 'totp';
  }
  const b = normBackup(code); if (b.length !== 8) return null;
  const h = sha(b), list = codesOf(r), i = list.indexOf(h);
  if (i < 0) return null;
  list.splice(i, 1);
  const ch = q('UPDATE user_totp SET codes = ? WHERE uid = ? AND codes = ?').run(JSON.stringify(list), uid, r.codes).changes;
  return ch ? 'backup' : null; // одновременное использование одного кода — пройдёт только один запрос
}

function disable(u, code, now = Date.now()) {
  if (!isOn(u.id)) throw fail(400, 'Двухфакторная защита не включена');
  if (!verify(u.id, code, now)) throw fail(400, 'Неверный код');
  q('DELETE FROM user_totp WHERE uid = ?').run(u.id);
  return status(u.id);
}

function regen(u, code, now = Date.now()) {
  if (!isOn(u.id)) throw fail(400, 'Двухфакторная защита не включена');
  if (!verify(u.id, code, now)) throw fail(400, 'Неверный код');
  const c = newCodes();
  q('UPDATE user_totp SET codes = ? WHERE uid = ?').run(JSON.stringify(c.hashes), u.id);
  return { codes: c.plain };
}

// сброс администратором и удаление аккаунта
const reset = (uid) => q('DELETE FROM user_totp WHERE uid = ?').run(String(uid || '')).changes;
const removeUser = reset;
const stats = () => ({ on: q('SELECT count(*) n FROM user_totp WHERE enabled = 1').get().n || 0 });

// «билеты» входа: OAuth прошёл, ждём второй фактор. В памяти процесса — при перезапуске нужно войти заново.
const T = new Map();
function ticket(uid, now = Date.now()) {
  for (const [k, t] of T) if (t.exp <= now) T.delete(k);
  const token = crypto.randomBytes(24).toString('base64url');
  T.set(sha(token), { uid, exp: now + TICKET_TTL, tries: 0 });
  return token;
}
const pending = (token, now = Date.now()) => { const t = token && T.get(sha(token)); return !!(t && t.exp > now); };
function redeem(token, code, now = Date.now()) {
  const k = sha(token || ''), t = token ? T.get(k) : null;
  if (!t || t.exp <= now) { T.delete(k); throw fail(410, 'Время на ввод кода вышло — войдите заново'); }
  const via = verify(t.uid, code, now);
  if (!via) {
    if (!isOn(t.uid)) { T.delete(k); throw fail(410, 'Защита для аккаунта сброшена — войдите заново'); }
    t.tries += 1;
    if (t.tries >= TICKET_TRIES) { T.delete(k); throw fail(410, 'Слишком много неверных кодов — войдите заново'); }
    throw fail(401, 'Неверный код');
  }
  T.delete(k);
  return { uid: t.uid, via, codesLeft: status(t.uid).codesLeft };
}

module.exports = { isOn, status, setup, enable, verify, disable, regen, reset, removeUser, stats, ticket, pending, redeem, TICKET_TTL, TICKET_TRIES };
