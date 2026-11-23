'use strict';
// Личные уведомления: администратор выбирает пользователей (по одному, выделением или целым сегментом),
// а они видят карточку в левом нижнем углу сайта. Закрытое уведомление больше не показывается никогда.
// Хранение — две таблицы (db.js): notices (сама рассылка) и notice_to (получатели и что с уведомлением сделали).
const crypto = require('crypto');
const store = require('./db'), bill = require('./billing');

const DAY = 864e5;
const POLL = 60; // как часто открытая вкладка спрашивает новые уведомления, секунд
const LEVELS = ['info', 'warn', 'urgent', 'critical'];
const RANK = { info: 1, warn: 2, urgent: 3, critical: 4 };
const MAX_ACTIVE = 10; // сколько непрочитанных уведомлений отдаём одному пользователю за раз
const MAX_TO = 50000;
const KEEP_DAYS = 400;
const E = (status, error) => Object.assign(new Error(error), { status });
const q = (sql) => store.db.prepare(sql);
const parse = (s) => { try { return JSON.parse(s) || {}; } catch { return {}; } };
const str = (v, max) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
const tms = (v) => (v == null || v === '' ? null : Number.isFinite(+v) ? +v : Date.parse(v) || null);

function okLink(s) {
  s = String(s || '').trim(); if (!s) return '';
  if (s.startsWith('/') && !s.startsWith('//')) return s.slice(0, 300);
  try { const u = new URL(s); if (/^https?:$/.test(u.protocol)) return u.href.slice(0, 300); } catch {}
  throw E(400, 'Ссылка: https://… или путь на сайте, например /chat?pay=1');
}

// проверка и нормализация текста рассылки из панели
function clean(b = {}, now = Date.now()) {
  const n = {
    level: LEVELS.includes(b.level) ? b.level : 'info',
    title: str(b.title, 90), text: str(b.text, 1000), titleEn: str(b.titleEn, 90), textEn: str(b.textEn, 1000),
    link: okLink(b.link), linkText: str(b.linkText, 40), linkTextEn: str(b.linkTextEn, 40), reply: !!b.reply,
  };
  if (!n.text) throw E(400, 'Напишите текст уведомления');
  if (String(b.text || '').trim().length > 1000) throw E(400, 'Текст уведомления — не длиннее 1000 символов');
  if (n.link && !n.linkText) n.linkText = 'Открыть';
  if (n.link && n.textEn && !n.linkTextEn) n.linkTextEn = 'Open';
  let starts = tms(b.starts);
  if (!starts || starts < now) starts = now;
  if (starts > now + 365 * DAY) throw E(400, 'Запланировать можно не дальше чем на год вперёд');
  let expires = null;
  const days = Number(b.days);
  if (Number.isFinite(days) && days > 0) { if (days > 365) throw E(400, 'Показывать можно не дольше 365 дней'); expires = starts + Math.round(days * DAY); }
  else if (b.expires) { expires = tms(b.expires); if (!expires || expires <= starts) throw E(400, 'Срок показа должен заканчиваться позже начала'); }
  return { n, starts, expires };
}

/* ---------- подстановки: {name}, {login}, {plan}, {until}, {days}, {email} ---------- */
const VARS = ['name', 'login', 'email', 'plan', 'until', 'days'];
function vars(u, lang) {
  const p = bill.planOf(u), until = p && p.until ? p.until : null;
  return {
    name: u.name || u.login, login: u.login, email: u.email || '', plan: p ? p.name : '',
    until: until ? new Date(until).toLocaleDateString(lang === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }) : '—',
    days: until ? String(Math.max(0, Math.ceil((until - Date.now()) / DAY))) : '0',
  };
}
const fill = (s, v) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));

/* ---------- отправка ---------- */
// ids — получатели; заблокированных и удалённых пропускаем. audience — как их выбрали (для панели).
function send(b, { ids, admin, audience } = {}) {
  const now = Date.now(), { n, starts, expires } = clean(b, now);
  const uniq = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter((id) => /^[a-f0-9]{4,32}$/.test(id));
  if (uniq.length > MAX_TO) throw E(400, `За один раз — не больше ${MAX_TO} получателей`);
  const to = [];
  let skipped = 0;
  for (const id of uniq) { const u = store.users.get(id); if (u && !u.banned) to.push(id); else skipped++; }
  if (!to.length) throw E(400, 'Нет получателей: пользователи не найдены или заблокированы');
  const id = crypto.randomBytes(6).toString('hex');
  const data = { ...n, audience: audience && typeof audience === 'object' ? audience : { kind: 'ids' }, byName: admin ? admin.name || admin.login : '' };
  store.tx(() => {
    q('INSERT INTO notices (id, level, data, created, starts, expires, revoked, total, by) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)')
      .run(id, n.level, JSON.stringify(data), now, starts, expires, to.length, admin ? admin.login : null);
    const ins = q('INSERT OR IGNORE INTO notice_to (nid, uid) VALUES (?, ?)');
    for (const uid of to) ins.run(id, uid);
  });
  return { id, total: to.length, skipped, starts, expires, scheduled: starts > now + 1000 };
}

/* ---------- для сайта ---------- */
// непрочитанные уведомления пользователя: сначала самые срочные, внутри — свежие
function active(u, lang = 'ru') {
  if (!u) return [];
  const now = Date.now();
  const rows = q(`SELECT n.id, n.level, n.data, n.starts, n.expires, t.seen FROM notice_to t JOIN notices n ON n.id = t.nid
    WHERE t.uid = ? AND t.closed IS NULL AND n.revoked IS NULL AND n.starts <= ? AND (n.expires IS NULL OR n.expires > ?) ORDER BY n.starts DESC LIMIT 100`).all(u.id, now, now);
  if (!rows.length) return [];
  const v = vars(u, lang), en = lang === 'en';
  return rows.sort((a, b) => (RANK[b.level] || 0) - (RANK[a.level] || 0) || b.starts - a.starts).slice(0, MAX_ACTIVE).map((r) => {
    const d = parse(r.data), useEn = en && !!d.textEn;
    return {
      id: r.id, level: r.level, at: r.starts, expires: r.expires || null, seen: !!r.seen,
      title: fill(useEn ? d.titleEn : d.title, v), text: fill(useEn ? d.textEn : d.text, v),
      link: d.link || '', linkText: d.link ? (useEn ? d.linkTextEn || d.linkText : d.linkText) || '' : '', reply: !!d.reply,
    };
  });
}
// что пользователь сделал с карточкой: увидел, нажал кнопку, закрыл, ответил (кнопка и ответ тоже закрывают)
function act(uid, nid, kind, text) {
  const row = q('SELECT t.seen, t.closed, t.replied, n.data, n.revoked FROM notice_to t JOIN notices n ON n.id = t.nid WHERE t.nid = ? AND t.uid = ?').get(nid, uid);
  if (!row) throw E(404, 'Уведомление не найдено');
  const now = Date.now();
  if (kind === 'seen') q('UPDATE notice_to SET seen = COALESCE(seen, ?) WHERE nid = ? AND uid = ?').run(now, nid, uid);
  else if (kind === 'click') q('UPDATE notice_to SET seen = COALESCE(seen, ?), clicked = COALESCE(clicked, ?), closed = COALESCE(closed, ?) WHERE nid = ? AND uid = ?').run(now, now, now, nid, uid);
  else if (kind === 'close') q('UPDATE notice_to SET seen = COALESCE(seen, ?), closed = COALESCE(closed, ?) WHERE nid = ? AND uid = ?').run(now, now, nid, uid);
  else if (kind === 'reply') {
    if (!parse(row.data).reply) throw E(400, 'На это уведомление нельзя ответить');
    if (row.replied) throw E(409, 'Вы уже ответили на это уведомление');
    const t = str(text, 4000);
    if (!t || t.length > 2000) throw E(400, 'Напишите ответ — до 2000 символов');
    q('UPDATE notice_to SET seen = COALESCE(seen, ?), closed = COALESCE(closed, ?), reply = ?, replied = ? WHERE nid = ? AND uid = ? AND replied IS NULL').run(now, now, t, now, nid, uid);
  } else throw E(400, 'Неизвестное действие');
  return { ok: true };
}

/* ---------- для панели ---------- */
function stateOf(r, now = Date.now()) {
  if (r.revoked) return 'revoked';
  if (r.starts > now) return 'scheduled';
  if (r.expires && r.expires <= now) return 'expired';
  if (r.n > 0 && r.closed >= r.n) return 'done';
  return 'active';
}
const STATS = `SELECT n.id, n.level, n.data, n.created, n.starts, n.expires, n.revoked, n.total, n.by,
    count(t.uid) n, count(t.seen) seen, count(t.clicked) clicked, count(t.closed) closed, count(t.replied) replied,
    sum(CASE WHEN t.replied > COALESCE(json_extract(n.data, '$.repliesRead'), 0) THEN 1 ELSE 0 END) unread, max(t.replied) lastReply
  FROM notices n LEFT JOIN notice_to t ON t.nid = n.id`;
function pub(r, now = Date.now()) {
  const d = parse(r.data);
  return {
    id: r.id, level: r.level, title: d.title || '', text: d.text || '', titleEn: d.titleEn || '', textEn: d.textEn || '', link: d.link || '', linkText: d.linkText || '', linkTextEn: d.linkTextEn || '',
    reply: !!d.reply, audience: d.audience || { kind: 'ids' }, by: r.by || null, byName: d.byName || r.by || '',
    created: r.created, starts: r.starts, expires: r.expires || null, revoked: r.revoked || null, total: r.total,
    n: r.n || 0, seen: r.seen || 0, clicked: r.clicked || 0, closed: r.closed || 0, replied: r.replied || 0, unread: r.unread || 0, lastReply: r.lastReply || null,
    state: stateOf(r, now),
  };
}
const FILTERS = {
  active: (x) => x.state === 'active', scheduled: (x) => x.state === 'scheduled', replies: (x) => x.replied > 0,
  done: (x) => x.state === 'done' || x.state === 'expired' || x.state === 'revoked',
};
function list({ state = '', q: text = '', page = 1, size = 30 } = {}) {
  const now = Date.now();
  let items = q(STATS + ' GROUP BY n.id ORDER BY n.created DESC').all().map((r) => pub(r, now));
  const s = String(text || '').trim().toLowerCase();
  if (s) items = items.filter((x) => x.id === s || [x.title, x.text, x.textEn, x.by, x.byName, x.audience.label].some((v) => String(v || '').toLowerCase().includes(s)));
  const counts = { all: items.length }; for (const [k, f] of Object.entries(FILTERS)) counts[k] = items.filter(f).length;
  if (FILTERS[state]) items = items.filter(FILTERS[state]);
  size = Math.min(100, Math.max(10, +size || 30));
  const total = items.length, pages = Math.max(1, Math.ceil(total / size)); page = Math.min(pages, Math.max(1, +page || 1));
  return { items: items.slice((page - 1) * size, page * size), total, page, size, pages, counts, summary: summary(now) };
}
function summary(now = Date.now()) {
  const since = now - 30 * DAY;
  const r = q(`SELECT count(DISTINCT n.id) sent, count(t.uid) n, count(t.seen) seen, count(t.clicked) clicked, count(t.replied) replied,
      sum(CASE WHEN json_extract(n.data, '$.link') != '' THEN 1 ELSE 0 END) withLink FROM notices n LEFT JOIN notice_to t ON t.nid = n.id WHERE n.created >= ?`).get(since) || {};
  const live = q('SELECT count(*) n FROM notices WHERE revoked IS NULL AND starts <= ? AND (expires IS NULL OR expires > ?) AND id IN (SELECT nid FROM notice_to WHERE closed IS NULL)').get(now, now).n;
  const sched = q('SELECT count(*) n FROM notices WHERE revoked IS NULL AND starts > ?').get(now).n;
  return { sent: r.sent || 0, recipients: r.n || 0, seen: r.seen || 0, clicked: r.clicked || 0, withLink: r.withLink || 0, replied: r.replied || 0, active: live, scheduled: sched, unread: unreadReplies() };
}
const WHO = {
  all: '', unseen: 'AND t.seen IS NULL', seen: 'AND t.seen IS NOT NULL', open: 'AND t.closed IS NULL', closed: 'AND t.closed IS NOT NULL',
  clicked: 'AND t.clicked IS NOT NULL', noclick: 'AND t.clicked IS NULL', replied: 'AND t.replied IS NOT NULL', noreply: 'AND t.replied IS NULL',
};
function get(id, { who = 'all', q: text = '', page = 1, size = 50 } = {}) {
  const r = q(STATS + ' WHERE n.id = ? GROUP BY n.id').get(id); if (!r) throw E(404, 'Уведомление не найдено');
  const x = pub(r);
  const w = WHO[who] != null ? WHO[who] : '', s = String(text || '').trim().toLowerCase().replace(/[%_]/g, '');
  const args = [id]; let extra = '';
  if (s) { extra = 'AND (lower(u.login) LIKE ? OR lower(u.email) LIKE ? OR t.uid = ?)'; args.push('%' + s + '%', '%' + s + '%', s); }
  size = Math.min(200, Math.max(10, +size || 50));
  const total = q(`SELECT count(*) n FROM notice_to t LEFT JOIN users u ON u.id = t.uid WHERE t.nid = ? ${w} ${extra}`).get(...args).n;
  const pages = Math.max(1, Math.ceil(total / size)); page = Math.min(pages, Math.max(1, +page || 1));
  const recipients = q(`SELECT t.uid, u.login, u.email, t.seen, t.clicked, t.closed, t.replied FROM notice_to t LEFT JOIN users u ON u.id = t.uid
    WHERE t.nid = ? ${w} ${extra} ORDER BY COALESCE(t.replied, t.clicked, t.closed, t.seen, 0) DESC, u.login LIMIT ? OFFSET ?`).all(...args, size, (page - 1) * size);
  const replies = q(`SELECT t.uid, u.login, u.email, t.reply, t.replied FROM notice_to t LEFT JOIN users u ON u.id = t.uid WHERE t.nid = ? AND t.replied IS NOT NULL ORDER BY t.replied DESC LIMIT 300`).all(id);
  const read = parse(r.data).repliesRead || 0;
  return { notice: x, recipients, rtotal: total, page, pages, size, who: WHO[who] != null ? who : 'all',
    replies: replies.map((y) => ({ ...y, unread: y.replied > read })), resend: resendCounts(id) };
}
function resendCounts(id) {
  const r = q(`SELECT count(*) n, sum(t.seen IS NULL) unseen, sum(t.clicked IS NULL) noclick, sum(t.replied IS NULL) noreply, sum(t.closed IS NULL) open
    FROM notice_to t JOIN users u ON u.id = t.uid WHERE t.nid = ?`).get(id) || {};
  return { all: r.n || 0, unseen: r.unseen || 0, noclick: r.noclick || 0, noreply: r.noreply || 0, open: r.open || 0 };
}
// кому отправить повторно: все получатели или те, кто ещё не открыл / не нажал / не ответил
function recipients(id, who = 'all') {
  if (!q('SELECT 1 FROM notices WHERE id = ?').get(id)) throw E(404, 'Уведомление не найдено');
  const w = { all: '', unseen: 'AND t.seen IS NULL', noclick: 'AND t.clicked IS NULL', noreply: 'AND t.replied IS NULL', open: 'AND t.closed IS NULL' }[who];
  if (w == null) throw E(400, 'Кому отправить повторно: all, unseen, noclick, noreply или open');
  return q(`SELECT t.uid FROM notice_to t JOIN users u ON u.id = t.uid WHERE t.nid = ? ${w}`).all(id).map((r) => r.uid);
}
function markRead(id) {
  store.tx(() => {
    const r = q('SELECT data FROM notices WHERE id = ?').get(id); if (!r) return;
    const d = parse(r.data); d.repliesRead = Date.now(); q('UPDATE notices SET data = ? WHERE id = ?').run(JSON.stringify(d), id);
  });
}
function revoke(id) {
  const r = q('SELECT revoked FROM notices WHERE id = ?').get(id); if (!r) throw E(404, 'Уведомление не найдено');
  if (!r.revoked) q('UPDATE notices SET revoked = ? WHERE id = ?').run(Date.now(), id);
  return { ok: true, revoked: r.revoked || Date.now() };
}
// история уведомлений одного пользователя (карточка в панели)
function forUser(uid, n = 50) {
  const now = Date.now(), u = store.users.get(uid), v = u ? vars(u, 'ru') : null, pf = (s) => (v ? fill(s, v) : s || ''); // текст — как его видит этот пользователь
  return q(`SELECT n.id, n.level, n.data, n.created, n.starts, n.expires, n.revoked, n.by, t.seen, t.clicked, t.closed, t.reply, t.replied
    FROM notice_to t JOIN notices n ON n.id = t.nid WHERE t.uid = ? ORDER BY n.created DESC LIMIT ?`).all(uid, n).map((r) => {
    const d = parse(r.data);
    return { id: r.id, level: r.level, title: pf(d.title), text: pf(d.text), link: d.link || '', reply: !!d.reply, by: d.byName || r.by || '', created: r.created, starts: r.starts, expires: r.expires || null,
      revoked: r.revoked || null, seen: r.seen || null, clicked: r.clicked || null, closed: r.closed || null, answer: r.reply || '', replied: r.replied || null,
      live: !r.revoked && !r.closed && r.starts <= now && !(r.expires && r.expires <= now), scheduled: !r.revoked && r.starts > now };
  });
}
// сколько из этих пользователей уже видят непрочитанное уведомление (чтобы не заваливать)
function busy(ids) {
  if (!ids.length) return 0;
  const now = Date.now(), set = new Set(ids);
  const rows = q('SELECT DISTINCT t.uid FROM notice_to t JOIN notices n ON n.id = t.nid WHERE t.closed IS NULL AND n.revoked IS NULL AND n.starts <= ? AND (n.expires IS NULL OR n.expires > ?)').all(now, now);
  let k = 0; for (const r of rows) if (set.has(r.uid)) k++;
  return k;
}
const unreadReplies = () => q(`SELECT count(*) n FROM notice_to t JOIN notices n ON n.id = t.nid WHERE t.replied IS NOT NULL AND t.replied > COALESCE(json_extract(n.data, '$.repliesRead'), 0)`).get().n || 0;

// старые рассылки больше года не нужны
function prune() { try { store.tx(() => { const old = Date.now() - KEEP_DAYS * DAY; q('DELETE FROM notice_to WHERE nid IN (SELECT id FROM notices WHERE created < ?)').run(old); q('DELETE FROM notices WHERE created < ?').run(old); }); } catch {} }
prune(); setInterval(prune, 12 * 3600e3).unref();

module.exports = { LEVELS, RANK, POLL, VARS, clean, send, active, act, list, get, summary, recipients, resendCounts, markRead, revoke, forUser, busy, unreadReplies, stateOf, fill, vars };
