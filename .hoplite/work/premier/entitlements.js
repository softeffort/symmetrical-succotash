'use strict';
// Журнал выдач: за каждым правом (дни тарифа, бонусные дни, пакет сообщений, кредиты, сбросы, места команды) стоит источник —
// платёж, промокод, приглашение или панель. Одна строка на выдачу; возврат отзывает строки своего источника и всё, что из них получено.
//
// Дни тарифа держателя (пользователя или команды) — очередь строк без разрывов: раньше купленное тратится раньше.
// Смена тарифа закрывает строки (why = 'convert') и создаёт новые со ссылкой from_id; стоимость остатка сохраняется:
// остаток × цена дня старой строки = новый срок × цена дня нового тарифа. Поля пользователя plan/until — производные от очереди.
const crypto = require('crypto');
const store = require('./db');

store.db.exec(`
  CREATE TABLE IF NOT EXISTS entitlements (
    id TEXT PRIMARY KEY,
    pay_id TEXT NOT NULL,                 -- источник: номер платежа либо promo:…, admin:…, state:…, legacy:…
    uid TEXT NOT NULL DEFAULT '',         -- кому выдано: пользователь…
    team_id TEXT NOT NULL DEFAULT '',     -- …или команда
    kind TEXT NOT NULL,                   -- plan | bonus | pack | credits | reset | seats
    plan TEXT, units REAL,                -- тариф либо количество (сообщения, кредиты, сбросы, места)
    starts INTEGER, ends INTEGER,
    day_price REAL,                       -- цена дня тарифа на момент выдачи, ₽ — для пересчёта при смене тарифа
    from_id TEXT NOT NULL DEFAULT '',     -- из какой строки получено при смене тарифа
    revoked INTEGER, why TEXT,            -- когда и почему строка перестала действовать: refund | convert | override
    at INTEGER NOT NULL,
    UNIQUE (pay_id, kind, uid, team_id, from_id));
  CREATE INDEX IF NOT EXISTS ent_uid ON entitlements (uid, kind, revoked);
  CREATE INDEX IF NOT EXISTS ent_team ON entitlements (team_id, kind, revoked);
`);
const P = new Map(); const q = (sql) => { let s = P.get(sql); if (!s) { s = store.db.prepare(sql); P.set(sql, s); } return s; };
const TIME = "kind IN ('plan', 'bonus')";
const H = (h) => [String((h && h.uid) || ''), String((h && h.team) || '')];
const rnd = (v) => (v == null ? null : Math.round(v)); // момент времени — целое число мс; пустое остаётся пустым
const ins = (r) => { const id = crypto.randomUUID();
  q(`INSERT INTO entitlements (id, pay_id, uid, team_id, kind, plan, units, starts, ends, day_price, from_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, String(r.src), ...H(r), r.kind, r.plan || null, r.units ?? null, rnd(r.starts), rnd(r.ends), r.dayPrice || 0, r.from || '', r.at || Date.now());
  return id; };
const close = (id, why, now, ends) => q('UPDATE entitlements SET revoked = ?, why = ?, ends = COALESCE(?, ends) WHERE id = ?').run(now, why, rnd(ends), id);
const move = (id, starts, ends) => q('UPDATE entitlements SET starts = ?, ends = ? WHERE id = ?').run(rnd(starts), rnd(ends), id);
const slide = (rows, d) => { for (const r of rows) move(r.id, r.starts - d, r.ends - d); }; // вся очередь на d мс раньше
// есть ли уже выдача этого вида от этого источника этому держателю
// tag — метка повторяемой выдачи от одного источника (компенсация простоя): тогда «уже выдано» значит «с этой же меткой»
const TAG = (t) => (t ? 'tag:' + t : '');
const issued = (src, kind, h, tag) => !!(tag ? q('SELECT 1 x FROM entitlements WHERE pay_id = ? AND kind = ? AND uid = ? AND team_id = ? AND from_id = ?').get(String(src), kind, ...H(h), TAG(tag))
  : q("SELECT 1 x FROM entitlements WHERE pay_id = ? AND kind = ? AND uid = ? AND team_id = ? AND from_id NOT LIKE 'tag:%'").get(String(src), kind, ...H(h)));

// действующая очередь держателя: строки дней, которые не отозваны и ещё не закончились
const live = (h, now = Date.now()) => q(`SELECT * FROM entitlements WHERE uid = ? AND team_id = ? AND ${TIME} AND revoked IS NULL AND ends > ? ORDER BY starts, rowid`).all(...H(h), now);
// состояние по очереди: { plan, from, until } или null
const stateOf = (rows) => (rows.length ? { plan: rows[0].plan, from: rows[0].starts, until: rows[rows.length - 1].ends } : null);
const state = (h, now = Date.now()) => stateOf(live(h, now));

// Сверка очереди с тем, что реально записано у держателя (cur = { plan, until, dayPrice } или null).
// Расхождение значит, что срок меняли в обход журнала (панель, старый код, перенос базы): прежние строки закрываются,
// текущее состояние становится одной стартовой строкой. Привязка к платежам при этом теряется — так и должно быть: срок задали вручную.
function reconcile(h, cur, now = Date.now()) {
  const rows = live(h, now), s = stateOf(rows);
  if (!cur && !s) return rows;
  if (cur && s && s.plan === cur.plan && s.until === Math.round(cur.until)) return rows;
  for (const r of rows) close(r.id, 'override', now, Math.max(Math.min(r.starts, now), Math.min(r.ends, now)));
  if (cur) ins({ ...h, src: 'state:' + crypto.randomUUID(), kind: 'plan', plan: cur.plan, starts: now, ends: cur.until, dayPrice: cur.dayPrice || 0, at: now });
  return live(h, now);
}

// Выдать дни тарифа. o = { src, kind ('plan' | 'bonus'), plan, ms, dayPrice, cur, now, defer, units, tag }.
// units — на сколько мест рассчитан срок (команда); tag — метка повторяемой выдачи от того же источника.
// defer — не раньше этого момента (бонус участнику команды включается после оплаченного доступа); действует только при пустой очереди.
// Повтор с тем же источником ничего не меняет (dup: true).
function grantTime(h, o) {
  const now = o.now || Date.now(), kind = o.kind || 'plan';
  return store.tx(() => {
    let rows = reconcile(h, o.cur, now);
    if (issued(o.src, kind, h, o.tag)) return { dup: true, state: stateOf(rows) };
    if (rows.length && rows[0].plan !== o.plan) { // другой тариф: остаток каждой строки пересчитывается по цене дня и сохраняет свой источник
      let at = o.defer > now ? Math.max(rows[0].starts, now) : now; // отложенная очередь остаётся отложенной только для бонуса
      for (const r of rows) {
        const rest = r.ends - Math.max(r.starts, now), ms = o.dayPrice > 0 && r.day_price > 0 ? Math.floor(rest * r.day_price / o.dayPrice) : 0;
        close(r.id, 'convert', now, Math.max(r.starts, now));
        if (ms >= 1) { ins({ ...h, src: r.pay_id, kind: r.kind, plan: o.plan, starts: at, ends: at + ms, dayPrice: o.dayPrice, from: r.id, at: now }); at += ms; }
      }
      rows = live(h, now);
    } else if (rows.length && rows[0].starts > now && !(o.defer > now)) { // очередь ещё не началась (отложенный бонус), а доступ выдаётся сейчас — начинаем её сейчас
      slide(rows, rows[0].starts - now);
      rows = live(h, now);
    }
    const start = rows.length ? rows[rows.length - 1].ends : o.defer > now ? o.defer : now;
    const id = ins({ ...h, src: o.src, kind, plan: o.plan, units: o.units, starts: start, ends: start + o.ms, dayPrice: o.dayPrice || 0, from: TAG(o.tag), at: now });
    return { id, state: state(h, now) };
  });
}

// Отозвать дни источника у держателя: неизрасходованная часть его строк убирается, следующие строки сдвигаются раньше.
// Израсходованное не возвращается. Возвращает { cut — сколько мс убрано, state }.
function revokeTime(h, src, cur, now = Date.now()) {
  return store.tx(() => {
    const rows = reconcile(h, cur, now); let freed = 0;
    for (const r of rows) {
      const s = r.starts - freed, e = r.ends - freed;
      if (r.pay_id === String(src)) { const from = Math.max(s, now); freed += e - from; close(r.id, 'refund', now, from); }
      else if (freed) move(r.id, s, e);
    }
    q(`UPDATE entitlements SET revoked = ?, why = 'refund' WHERE pay_id = ? AND uid = ? AND team_id = ? AND ${TIME} AND revoked IS NULL`).run(now, String(src), ...H(h));
    return { cut: freed, state: state(h, now) };
  });
}
// Убрать ms с конца очереди, не глядя на источник — правило для платежей, которых в журнале нет (оплачены до его появления)
// или чьи строки закрыты ручной правкой срока. Возвращает то же, что revokeTime.
function cut(h, ms, cur, now = Date.now()) {
  return store.tx(() => {
    const rows = reconcile(h, cur, now); let left = Math.max(0, Math.round(ms));
    for (let i = rows.length - 1; i >= 0 && left > 0; i--) {
      const r = rows[i], from = Math.max(r.starts, now), take = Math.min(left, r.ends - from); left -= take;
      if (r.ends - take <= from) close(r.id, 'refund', now, from); else move(r.id, r.starts, r.ends - take);
    }
    return { cut: Math.round(ms) - left, state: state(h, now) };
  });
}
// Перенести начало ещё не начавшейся очереди (отложенные бонусные дни) на момент to.
// grace — очередь из одних бонусных дней, начавшуюся не раньше чем grace мс назад, тоже можно отодвинуть:
// доступ команды продлили перед самым её началом, а обход отложенных дней пришёл чуть позже.
function shift(h, to, cur, now = Date.now(), grace = 0) {
  return store.tx(() => {
    const rows = reconcile(h, cur, now), at = Math.max(to, now);
    if (rows.length && (rows[0].starts > now || (at > now && rows[0].starts > now - grace && rows.every((r) => r.kind === 'bonus')))) { const d = rows[0].starts - at; if (d) slide(rows, d); }
    return { state: state(h, now) };
  });
}
// пользователи, у которых очередь ещё не началась (или началась не раньше чем grace мс назад)
const deferred = (now = Date.now(), grace = 0) => q(`SELECT DISTINCT uid FROM entitlements WHERE uid <> '' AND ${TIME} AND revoked IS NULL AND starts > ? AND ends > ?`).all(now - grace, now).map((r) => r.uid);
// У команды стало меньше мест (было was, стало seats): срок, оплаченный за большее число мест, растёт во столько же раз —
// оплаченные место-дни сохраняются. Строки без units (ручной срок, выдачи до журнала) не меняются.
function reseat(h, was, seats, cur, now = Date.now()) {
  return store.tx(() => {
    const rows = reconcile(h, cur, now); let d = 0;
    for (const r of rows) {
      const n = Math.min(r.units || 0, was), add = n > seats && seats > 0 ? Math.floor((r.ends - Math.max(r.starts, now)) * (n / seats - 1)) : 0;
      if (d || add) move(r.id, r.starts + d, r.ends + d + add);
      if (n > seats) q('UPDATE entitlements SET units = ? WHERE id = ?').run(seats, r.id);
      d += add;
    }
    return { state: state(h, now) };
  });
}
// что журнал знает о днях источника у держателя: 'none' — строк нет, 'override' — закрыты ручной правкой срока, 'ok' — учтены
function fate(src, h, kind) {
  const rows = q('SELECT why FROM entitlements WHERE pay_id = ? AND uid = ? AND team_id = ? AND kind = ?').all(String(src), ...H(h), kind);
  return !rows.length ? 'none' : rows.some((r) => r.why === 'override') ? 'override' : 'ok';
}

/* ---------- количественные права: пакет, кредиты, сбросы, места ---------- */
// записать выдачу один раз; false — такая запись уже есть (повтор уведомления)
function record(o) {
  if (issued(o.src, o.kind, o)) return false;
  ins({ ...o, starts: o.starts == null ? Date.now() : o.starts }); return true;
}
// отозвать один раз: возвращает строки, отозванные этим вызовом (пусто — выдачи не было или она уже отозвана)
function revokeUnits(src, kind, now = Date.now()) {
  const rows = q('SELECT * FROM entitlements WHERE pay_id = ? AND kind = ? AND revoked IS NULL').all(String(src), kind);
  for (const r of rows) close(r.id, 'refund', now);
  return rows;
}
const has = (src) => !!q('SELECT 1 x FROM entitlements WHERE pay_id = ?').get(String(src));
const bySrc = (src) => q('SELECT * FROM entitlements WHERE pay_id = ? ORDER BY at, rowid').all(String(src));
// сколько мс оплаченного срока тарифов plans пришлось на отрезок [a, b] — по каждому пользователю и источнику; возвращённое (refund) не считается
const overlap = (plans, a, b) => q(`SELECT uid, plan, pay_id src, SUM(MIN(ends, ?) - MAX(starts, ?)) ms FROM entitlements WHERE uid <> '' AND ${TIME} AND plan IN (SELECT value FROM json_each(?))
  AND ends > ? AND starts < ? AND (revoked IS NULL OR why <> 'refund') GROUP BY uid, plan, pay_id ORDER BY uid, MIN(starts)`).all(b, a, JSON.stringify(plans), a, b);
const removeUser = (uid) => q("DELETE FROM entitlements WHERE uid = ? AND team_id = ''").run(String(uid));

module.exports = { overlap, live, reconcile, grantTime, revokeTime, cut, shift, reseat, deferred, fate, record, revokeUnits, has, bySrc, removeUser, ins };
