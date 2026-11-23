'use strict';
// Командный тариф: владелец платит за N мест, каждый участник на месте получает тариф Pro со своими лимитами.
// Владелец — тоже участник и занимает место. Люди вступают по ссылке /t/<код>; если людей больше, чем мест,
// Pro получают первые по времени вступления (владелец всегда первый). Настройки — в kv «team» (Панель → Команды).
const crypto = require('crypto');
const store = require('./db');
const ent = require('./entitlements');
const DAY = 864e5;
const PLAN = 'team'; // id тарифа в платежах
const DEF = { on: true, price: 350, min: 3, max: 50, plan: 'pro', days: 30 };

store.db.exec(`
  CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, owner TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seats INTEGER NOT NULL,
    until INTEGER NOT NULL DEFAULT 0, code TEXT NOT NULL UNIQUE, created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS team_members (uid TEXT PRIMARY KEY, team TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS team_members_team ON team_members (team, at);
`);
// ver — номер состояния команды: растёт при каждой смене числа мест или срока. Счёт помнит ver, с которым его считали;
// если к оплате он другой, счёт устарел и применяется пересчётом (onPaid), а не записанными в нём числами.
if (!store.db.prepare('PRAGMA table_info(teams)').all().some((c) => c.name === 'ver')) store.db.exec('ALTER TABLE teams ADD COLUMN ver INTEGER NOT NULL DEFAULT 0');
const P = new Map(); const q = (sql) => { let s = P.get(sql); if (!s) { s = store.db.prepare(sql); P.set(sql, s); } return s; };
const int = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : NaN; };
const seatsRu = (n) => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'место' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'места' : 'мест');
const cleanName = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
const newCode = () => crypto.randomBytes(9).toString('base64url');

/* ---------- настройки ---------- */
const conf = () => ({ ...DEF, ...store.kv.get('team', {}) });
function saveConf(b) {
  const c = conf(), n = (k) => int(b && b[k]);
  if (b && 'on' in b) c.on = !!b.on;
  if (b && 'price' in b) { const v = n('price'); if (!(v >= 1 && v <= 100000)) throw new Error('Цена места — от 1 до 100 000 ₽'); c.price = v; }
  if (b && 'min' in b) { const v = n('min'); if (!(v >= 1 && v <= 100)) throw new Error('Минимум мест — от 1 до 100'); c.min = v; }
  if (b && 'max' in b) { const v = n('max'); if (!(v >= 1 && v <= 1000)) throw new Error('Максимум мест — от 1 до 1000'); c.max = v; }
  if (c.max < c.min) throw new Error('Максимум мест не может быть меньше минимума');
  store.kv.set('team', { on: c.on, price: c.price, min: c.min, max: c.max }); return conf();
}
const offer = () => { const c = conf(); return { on: !!c.on, price: c.price, min: c.min, max: c.max, days: c.days }; };

/* ---------- данные ---------- */
const byId = (id) => (id ? q('SELECT * FROM teams WHERE id = ?').get(String(id)) || null : null);
const byOwner = (uid) => (uid ? q('SELECT * FROM teams WHERE owner = ?').get(String(uid)) || null : null);
const byCode = (code) => (code && /^[A-Za-z0-9_-]{6,40}$/.test(code) ? q('SELECT * FROM teams WHERE code = ?').get(String(code)) || null : null);
const memberRow = (uid) => (uid ? q('SELECT * FROM team_members WHERE uid = ?').get(String(uid)) || null : null);
const members = (tid) => q('SELECT * FROM team_members WHERE team = ? ORDER BY at, rowid').all(tid);
const setTeam = (t) => q('UPDATE teams SET name = ?, ver = ver + (seats <> ? OR until <> ?), seats = ?, until = ?, code = ? WHERE id = ?').run(t.name, t.seats, t.until, t.seats, t.until, t.code, t.id);
const memberIds = (tid) => members(tid).map((x) => x.uid);
const addMember = (uid, tid, at) => q('INSERT INTO team_members (uid, team, at) VALUES (?, ?, ?) ON CONFLICT(uid) DO UPDATE SET team = excluded.team, at = excluded.at').run(uid, tid, at);

// есть ли у пользователя оплаченное место в команде: { plan, until, name } или null
function seatOf(uid, now = Date.now()) {
  const m = memberRow(uid); if (!m) return null;
  const t = byId(m.team); if (!t || !(t.until > now)) return null;
  const i = members(t.id).findIndex((x) => x.uid === uid);
  return i >= 0 && i < t.seats ? { plan: conf().plan, until: t.until, name: t.name, team: t.id } : null;
}

/* ---------- расчёт цены ---------- */
// months ≥ 1 — оплата на срок (скидка за срок — как у обычных тарифов); months = 0 — только докупить места до конца текущего срока.
// Новые места в оплаченной команде доплачиваются за оставшиеся дни (prorate) и начинают работать сразу после оплаты.
function quote(u, seats, months, periods, now = Date.now()) {
  const c = conf(); if (!c.on) throw new Error('Командный тариф сейчас недоступен');
  const m = memberRow(u.id), t = byOwner(u.id);
  if (m && !t) { const o = byId(m.team); if (o) throw new Error(`Вы участник команды «${o.name}». Чтобы оплатить свою команду, сначала выйдите из неё`); }
  seats = int(seats); months = int(months);
  if (!(seats >= c.min && seats <= c.max)) throw new Error(`Количество мест — от ${c.min} до ${c.max}`);
  const used = t ? members(t.id).length : 1;
  if (seats < used) throw new Error(`В команде уже ${used} чел. — выберите не меньше ${seatsRu(used)} или сначала уберите лишних`);
  const active = !!(t && t.until > now), price = c.price;
  const restDays = active ? Math.max(1, Math.ceil((t.until - now) / DAY)) : 0;
  const addSeats = active && seats > t.seats ? seats - t.seats : 0;
  const prorate = addSeats ? Math.max(1, Math.round(addSeats * price * restDays / c.days)) : 0;
  if (months === 0) {
    if (!active) throw new Error('Докупить места можно, пока команда оплачена. Выберите срок оплаты');
    if (!addSeats) throw new Error(`Чтобы докупить места, укажите больше мест, чем сейчас (${t.seats})`);
    return { seats, months: 0, days: 0, price, base: 0, off: 0, prorate, addSeats, restDays, list: prorate, amount: prorate, until: t.until, team: t.name, renew: true, fewer: false, ver: t.ver };
  }
  const per = (Array.isArray(periods) ? periods : []).find((x) => x.months === months) || (months === 1 ? { months: 1, off: 0 } : null);
  if (!per) throw new Error('Такого срока оплаты нет — выберите другой');
  const off = Math.min(90, Math.max(0, int(per.off) || 0)), base = seats * price * months, days = c.days * months;
  const amount = Math.max(1, Math.round(base * (100 - off) / 100)) + prorate;
  return { seats, months, days, price, base, off, prorate, addSeats, restDays, list: base + prorate, amount,
    until: Math.max(t ? t.until : 0, now) + days * DAY, team: t ? t.name : null, renew: !!t, fewer: !!(t && seats < t.seats), ver: t ? t.ver : -1 };
}

/* ---------- оплата и возврат (вызываются из billing.apply внутри транзакции) ---------- */
// Срок команды — очередь строк журнала выдач (держатель { team }), число мест от платежа — строка «seats» с разницей.
// Счёт хранит, что куплено: seats × days (оплата срока) + addSeats × restDays (докупка мест до конца срока), и ver команды на момент расчёта.
// Команда с тех пор изменилась (другой счёт, Панель) — купленные место-дни те же, но раскладываются на команду, какая она сейчас:
// мест меньше, чем есть, не становится; новые места берутся, если их хватает оплатить до конца текущего срока; остаток идёт в срок.
function onPaid(pay, now = Date.now()) {
  const T = pay.team || {}; let t = byOwner(pay.uid);
  const seats = Math.max(1, int(T.seats) || conf().min), days = Math.max(0, int(T.days) || 0);
  const addSeats = Math.max(0, int(T.addSeats) || 0), restDays = Math.max(0, int(T.restDays) || 0), paid = (seats * days + addSeats * restDays) * DAY; // куплено место-мс
  if (!t) {
    const u = store.users.get(pay.uid), ms = Math.floor(paid / seats);
    t = { id: crypto.randomUUID(), owner: pay.uid, name: cleanName(T.name) || 'Команда ' + ((u && u.login) || pay.login || ''), seats, until: now + ms, code: newCode(), created: now };
    q('DELETE FROM team_members WHERE uid = ?').run(pay.uid);
    q('INSERT INTO teams (id, owner, name, seats, until, code, created) VALUES (?, ?, ?, ?, ?, ?, ?)').run(t.id, t.owner, t.name.trim() || 'Команда', t.seats, t.until, t.code, t.created);
    addMember(pay.uid, t.id, 0);
    if (ms) ent.grantTime({ team: t.id }, { src: pay.id, plan: PLAN, ms, units: seats, cur: null, now });
    T.created = true; T.delta = seats; T.ms = ms;
  } else {
    const used = members(t.id).length, active = t.until > now, rest = active ? t.until - now : 0;
    T.prevSeats = t.seats; T.prevUntil = t.until;
    let ns = seats, ms = days * DAY;
    // счёт без ver выставлен до обновления — применяется как раньше
    if (T.ver != null && (int(T.ver) !== t.ver || seats < used || (!days && !active))) {
      let sd = paid; const have = active ? t.seats : 0, want = Math.max(seats, used);
      ns = have || want;
      if (want > have && sd >= (want - have) * rest) { sd -= (want - have) * rest; ns = want; }
      ms = Math.floor(sd / ns);
      T.recalc = { seats: ns, days: Math.round(ms / DAY * 10) / 10, at: now };
    }
    if (ms >= 1) t.until = ent.grantTime({ team: t.id }, { src: pay.id, plan: PLAN, ms, units: ns, cur: active ? { plan: PLAN, until: t.until } : null, now }).state.until;
    T.delta = ns - t.seats; T.ms = ms >= 1 ? ms : 0; t.seats = ns; setTeam(t); // ms — сколько срока этот платёж выдал на самом деле (после пересчёта может быть 0)
    if (!memberRow(pay.uid)) addMember(pay.uid, t.id, 0);
  }
  ent.record({ src: pay.id, team: t.id, kind: 'seats', units: T.delta, starts: now, at: now });
  T.teamId = t.id; pay.team = T; return t;
}
// Возврат: забирается неизрасходованный срок этого платежа и его разница в местах. Срок, который после платежа правили из Панели, —
// минус то, что платёж выдал. Платёж, оплаченный до обновления (в нём нет T.ms), — прежнее правило: минус оплаченные дни,
// места — к прежним, если с тех пор не менялись. Мест стало меньше — срок, оплаченный другими счетами за большее число мест,
// растёт во столько же раз: их место-дни остаются при команде.
function onChargeback(pay, now = Date.now()) {
  const T = pay.team || {}, t = byId(T.teamId) || byOwner(pay.uid); if (!t) return null;
  const h = { team: t.id }, cur = () => (t.until > now ? { plan: PLAN, until: t.until } : null), was = t.seats;
  ent.reconcile(h, cur(), now);
  const fate = ent.fate(pay.id, h, 'plan'), old = T.ms == null ? Math.max(0, int(T.days) || 0) * DAY : fate === 'override' ? T.ms : 0;
  if (fate === 'ok') { const s = ent.revokeTime(h, pay.id, cur(), now).state; t.until = s ? s.until : Math.min(t.until, now); }
  else if (old && cur()) { const s = ent.cut(h, old, cur(), now).state; t.until = s ? s.until : now; }
  if (T.delta != null) { if (ent.revokeUnits(pay.id, 'seats', now).length && t.seats - int(T.delta) >= 1) t.seats -= int(T.delta); }
  else if (T.prevSeats != null && t.seats === int(T.seats)) t.seats = int(T.prevSeats);
  if (t.seats < was && cur()) { const s = ent.reseat(h, was, t.seats, cur(), now).state; if (s) t.until = s.until; }
  setTeam(t); return t;
}

/* ---------- участники ---------- */
// кому сообщить, что у этих людей изменился доступ команды (срок, вход, выход): биллинг переносит их отложенные бонусные дни
let changed = () => {};
const onChange = (fn) => { changed = fn; };
function join(u, code, now = Date.now()) {
  return store.tx(() => {
    const t = byCode(code); if (!t) throw new Error('Ссылка-приглашение недействительна — попросите у владельца новую');
    const m = memberRow(u.id);
    if (m && m.team === t.id) return t;
    if (byOwner(u.id)) throw new Error('У вас уже есть своя команда — в другую вступить нельзя');
    if (m) { const o = byId(m.team); if (o) throw new Error(`Вы уже в команде «${o.name}» — сначала выйдите из неё`); }
    const used = members(t.id).length, c = conf();
    if (used >= t.seats) throw new Error('В команде нет свободных мест — попросите владельца докупить место');
    if (used >= c.max) throw new Error('В команде максимальное число участников');
    addMember(u.id, t.id, now); changed([u.id]); return t;
  });
}
function leave(u) {
  if (byOwner(u.id)) throw new Error('Владелец не может выйти из своей команды');
  if (!memberRow(u.id)) throw new Error('Вы не состоите в команде');
  q('DELETE FROM team_members WHERE uid = ?').run(u.id); changed([u.id]); return true;
}
function ownTeam(u) { const t = byOwner(u.id); if (!t) throw new Error('У вас нет своей команды'); return t; }
function remove(u, uid) {
  const t = ownTeam(u); uid = String(uid || '');
  if (uid === u.id) throw new Error('Владелец не может убрать себя');
  const m = memberRow(uid); if (!m || m.team !== t.id) throw new Error('Такого участника в команде нет');
  q('DELETE FROM team_members WHERE uid = ?').run(uid); changed([uid]); return t;
}
function relink(u) { const t = ownTeam(u); t.code = newCode(); setTeam(t); return t; }
function rename(u, name) { const t = ownTeam(u), n = cleanName(name); if (n.length < 2) throw new Error('Название — от 2 до 60 символов'); t.name = n; setTeam(t); return t; }
// удаление аккаунта: владелец забирает команду с собой, участник просто выбывает
function removeUser(uid) {
  store.tx(() => {
    const t = byOwner(uid);
    if (t) { q('DELETE FROM team_members WHERE team = ?').run(t.id); q('DELETE FROM teams WHERE id = ?').run(t.id); q('DELETE FROM entitlements WHERE team_id = ?').run(t.id); }
    q('DELETE FROM team_members WHERE uid = ?').run(uid);
  });
}

/* ---------- для кабинета ---------- */
function info(u, now = Date.now()) {
  const m = memberRow(u.id); if (!m) return null;
  const t = byId(m.team); if (!t) return null;
  const list = members(t.id), active = t.until > now, owner = store.users.get(t.owner), i = list.findIndex((x) => x.uid === u.id);
  const out = { name: t.name, until: t.until, active, seats: t.seats, used: list.length, owner: owner ? owner.login : '—', role: t.owner === u.id ? 'owner' : 'member', mine: active && i >= 0 && i < t.seats };
  if (out.role === 'owner') {
    out.code = t.code; out.created = t.created;
    out.members = list.map((x, k) => { const v = store.users.get(x.uid); return { id: x.uid, login: v ? v.login : '—', email: (v && v.email) || '', at: x.at, owner: x.uid === t.owner, seat: k < t.seats }; });
  }
  return out;
}
function preview(code, now = Date.now(), uid = '') {
  const t = byCode(code); if (!t) return null;
  const o = store.users.get(t.owner);
  return { name: t.name, owner: o ? o.login : '—', free: Math.max(0, t.seats - members(t.id).length), active: t.until > now, until: t.until, member: !!uid && (memberRow(uid) || {}).team === t.id };
}
// команды, у которых срок заканчивается в ближайшие сутки (для push-напоминания владельцу)
const expiring = (now = Date.now()) => q('SELECT * FROM teams WHERE until > ? AND until <= ?').all(now, now + DAY);

/* ---------- для Панели ---------- */
function list(now = Date.now()) {
  return q('SELECT * FROM teams ORDER BY until DESC, created DESC').all().map((t) => {
    const o = store.users.get(t.owner), mem = members(t.id), active = t.until > now;
    const pays = store.payments.byUid(t.owner).filter((x) => x.plan === PLAN && x.status === 'CONFIRMED');
    return { id: t.id, name: t.name, owner: t.owner, login: o ? o.login : '—', email: (o && o.email) || '', seats: t.seats, used: mem.length, until: t.until, active, created: t.created,
      paid: pays.reduce((n, x) => n + (x.amount || 0), 0), pays: pays.length,
      people: mem.map((x, i) => { const v = store.users.get(x.uid); return { login: v ? v.login : '—', owner: x.uid === t.owner, seat: active && i < t.seats }; }) };
  });
}
function stats(now = Date.now()) {
  const l = list(now), act = l.filter((x) => x.active), ok = store.payments.byStatus('CONFIRMED').filter((x) => x.plan === PLAN);
  return { teams: l.length, active: act.length, seats: act.reduce((n, x) => n + x.seats, 0), members: act.reduce((n, x) => n + Math.min(x.used, x.seats), 0),
    revenue30: ok.filter((x) => (x.paid || x.created) > now - 30 * DAY).reduce((n, x) => n + (x.amount || 0), 0), revenue: ok.reduce((n, x) => n + (x.amount || 0), 0) };
}
// ручное продление или сокращение срока (поддержка, компенсации)
function addDays(id, days, now = Date.now()) {
  const t = byId(id); if (!t) throw new Error('Команда не найдена');
  days = int(days); if (!days || Math.abs(days) > 366) throw new Error('Дни — от −366 до 366, кроме нуля');
  t.until = (days > 0 ? Math.max(t.until, now) : t.until) + days * DAY; setTeam(t); changed(memberIds(t.id));
  return { ...t };
}

module.exports = { onChange, memberIds, PLAN, DEF, conf, saveConf, offer, quote, onPaid, onChargeback, seatOf, join, leave, remove, relink, rename, info, preview, removeUser, expiring, list, stats, addDays, seatsRu, cleanName };
