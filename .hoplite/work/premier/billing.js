// Тарифы, дневные лимиты, промокоды и оплата через Platega (platega.io)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { needsBranding } = require('./publication');
const store = require('./db'); // SQLite: тарифы, промокоды, расход — ключ→JSON; платежи — отдельная таблица
const teams = require('./teams'); // командный тариф: места, участники, расчёт цены
const ent = require('./entitlements'); // журнал выдач: какие дни тарифа и пакеты выданы каким платежом
const growth = require('./growth'); // пробный период за деньги, скидка первой покупки, приглашения — настройки из env
const API = (process.env.PLATEGA_URL || 'https://app.platega.io').replace(/\/+$/, '');
const DAY = 864e5;

// null = без лимита
const DEF = {
  burst: 20,   // антиабуз: не больше N сообщений за 5 минут на одного пользователя
  fair: 1000,  // антиабуз для «безлимита»: потолок сообщений в день (у тарифа с nofair — не действует)
  plans: [
    { id: 'free', name: 'Free', price: 0, days: 0, tier: 0, msgs: 20, code: 3, sites: 3, images: 3, pc: 0, desc: 'Чтобы попробовать' },
    { id: 'pro', name: 'Pro', price: 390, days: 30, tier: 1, msgs: 300, code: 50, sites: 30, images: 30, pc: 1024, desc: 'Все модели и запас на каждый день' },
    { id: 'max', name: 'Max', price: 990, days: 30, tier: 2, msgs: 1000, code: null, sites: null, images: 100, pc: 5120, desc: 'Высокие лимиты — для работы' },
    // ultra — доступ к Ultra-моделям (Claude), credits — Ultra-кредитов в день (не копятся),
    // strict — дорогой тариф: только именные промокоды и без бонусных дней за приглашения;
    // nofair — безлимит сообщений на обычных моделях без общего потолка «безлимита» (fair)
    { id: 'ultra', name: 'Ultra', price: 6666, days: 30, tier: 3, msgs: null, code: null, sites: null, images: 100, pc: 5120, ultra: true, credits: 100, strict: true, nofair: true, desc: 'Claude и 100 Ultra-кредитов каждый день' },
  ],
  // оплата сразу на несколько сроков со скидкой: months — сколько сроков тарифа (обычно месяцев), off — скидка в %
  periods: [{ months: 1, off: 0 }, { months: 3, off: 10 }, { months: 6, off: 15 }, { months: 12, off: 25 }],
  // пакеты сообщений: n — сообщений (с учётом веса модели), price — ₽; сгорают через packDays дней
  packs: [{ n: 1000, price: 190 }, { n: 3000, price: 490 }, { n: 10000, price: 1390 }],
  packDays: 30,
  // защита от минуса: себестоимость одного сообщения веса 1, ₽ (0 — не задана) и минимальная наценка, %
  msgCost: 0, minMargin: 30,
  // платный сброс: цена за 1 сброс, ₽, и сколько сообщений он возвращает (не больше, чем израсходовано сегодня) — иначе при лимите 10 000/день сброс за 200 ₽ давал бы 10 000 сообщений
  resetPrice: 200, resetMsgs: 1000,
};
const cfg = () => {
  const c = store.kv.get('plans', null); if (!(c && Array.isArray(c.plans) && c.plans.length)) return JSON.parse(JSON.stringify(DEF));
  for (const p of c.plans) {
    if (p.images === undefined) p.images = (DEF.plans.find((x) => x.id === p.id) || { images: 10 }).images; // картинки стоят денег — по умолчанию с лимитом
    delete p.videos; // генерация видео удалена (2026-11): анимации делаются кодом и не лимитируются отдельно
    if (p.pc === undefined) p.pc = (DEF.plans.find((x) => x.id === p.id) || { pc: 0 }).pc; // облачный компьютер, МБ (null — потолок сервера)
    const d = DEF.plans.find((x) => x.id === p.id) || {}; // доступ к Ultra-моделям и кредиты в день — из настроек по умолчанию
    if (p.ultra === undefined) p.ultra = !!d.ultra;
    if (p.credits === undefined) p.credits = d.credits || 0;
    if (p.strict === undefined) p.strict = !!d.strict;
    if (p.nofair === undefined) p.nofair = !!d.nofair;
  }
  // тариф Ultra появился позже остальных: в сохранённых настройках его нет — добавляем из настроек по умолчанию
  for (const d of DEF.plans) if (!c.plans.some((p) => p.id === d.id)) c.plans.push(JSON.parse(JSON.stringify(d)));
  return { ...DEF, ...c };
};
const KEYS = { m: 'msgs', c: 'code', s: 'sites', i: 'images' };
// платный сброс дневного лимита: обнуляет счётчики картинок/кода/сайтов и возвращает не больше resetMsgs сообщений (кнопка у тарифа Max)
const RESET = { id: 'reset', name: 'Сброс лимита', price: 200, days: 0 };
const resetPriceOf = (c) => { const v = Math.round(Number(c.resetPrice)); return v > 0 ? v : RESET.price; };
const resetMsgsOf = (c) => { const v = Math.round(Number(c.resetMsgs)); return v > 0 ? v : DEF.resetMsgs; };
const resetPrice = () => resetPriceOf(cfg()), resetMsgs = () => resetMsgsOf(cfg());
// пакеты сбросов: 1 сброс = 200 ₽; скидка — от самого большого пакета, в который вошло число сбросов (баланс без срока)
const RESET_PACKS = [{ n: 1, pct: 0 }, { n: 5, pct: 10 }, { n: 10, pct: 15 }, { n: 25, pct: 25 }];
const RESET_MAX = 25;
// пакеты сообщений: докупаются сверх дневного лимита и тратятся только после него
const PACK = { id: 'pack', name: 'Пакет сообщений' };
const PACK_MAX = 20; // столько действующих пакетов может быть у одного человека: предел проверяется до оплаты, оплаченный пакет не теряется никогда
function packQuote(n) {
  const p = (cfg().packs || []).find((x) => x.n === Math.round(Number(n)));
  if (!p) throw new Error('Такого пакета сообщений нет — выберите из списка');
  return { n: p.n, price: p.price };
}
function resetQuote(n) {
  const qty = Number(n);
  if (!Number.isInteger(qty) || qty < 1 || qty > RESET_MAX) throw new Error(`Количество сбросов: от 1 до ${RESET_MAX}`);
  const pack = RESET_PACKS.filter((x) => x.n <= qty).pop(), unit = resetPrice(), full = unit * qty;
  return { qty, unit, full, pct: pack.pct, amount: Math.round(full * (100 - pack.pct) / 100) };
}
const addResetLog = (x, kind, n) => { x.resetLog = [...(x.resetLog || []), { kind, delta: n, at: Date.now() }].slice(-50); };
const dayWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'день' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'дня' : 'дней');
const payDesc = (p, login) => 'Premier ' + p.name + (p.months > 1 ? ' — ' + p.months + ' мес.' : p.days ? ' — ' + p.days + ' ' + dayWord(p.days) : '') + (login ? ' (' + login + ')' : '');
// сроки оплаты: 1 срок всегда есть и без скидки; остальные — от 2 до 24, скидка 0–90 %, без повторов, по возрастанию
const cleanPeriods = (list) => {
  const m = new Map([[1, 0]]);
  for (const x of Array.isArray(list) ? list : []) {
    const n = Math.round(Number(x && x.months)), off = Math.round(Number(x && x.off));
    if (n >= 2 && n <= 24 && !m.has(n)) m.set(n, Number.isFinite(off) ? Math.min(90, Math.max(0, off)) : 0);
  }
  return [...m].sort((a, b) => a[0] - b[0]).map(([months, off]) => ({ months, off }));
};
const periods = () => cleanPeriods(cfg().periods);

let US = null; // { loadUsers, saveUsers, loadSettings, saveSettings }
const init = (x) => { US = x; dropFreeTrial(); migrateUltraPlan(); migrateMaxMsgs(); migrateLedger(); migrateUltraDays(); };
// один раз: обычные модели, открытые на Max, открываем и на Ultra (Ultra включает всё, что есть в Max)
function migrateUltraPlan() {
  if (store.kv.get('mig:ultraPlan', null)) return;
  const list = store.kv.get('models', null);
  if (Array.isArray(list)) {
    let ch = false;
    for (const m of list) if (!m.ultra && Array.isArray(m.plans) && m.plans.includes('max') && !m.plans.includes('ultra')) { m.plans.push('ultra'); ch = true; }
    if (ch) store.kv.set('models', list);
  }
  store.kv.set('mig:ultraPlan', Date.now());
}

// один раз: у Max был «безлимит» с общим потолком 1000 в день — теперь честные 1000 сообщений в день
// (настоящий безлимит — у Ultra); описание меняем, только если владелец его не правил
function migrateMaxMsgs() {
  if (store.kv.get('mig:maxMsgs', null)) return;
  const c = store.kv.get('plans', null), mx = c && Array.isArray(c.plans) ? c.plans.find((p) => p.id === 'max') : null;
  if (mx) {
    if (mx.msgs == null) mx.msgs = 1000;
    if (mx.desc === 'Без ограничений — для работы') mx.desc = 'Высокие лимиты — для работы';
    store.kv.set('plans', c);
  }
  store.kv.set('mig:maxMsgs', Date.now());
}

/* ---------- тариф пользователя ---------- */
function planOf(u) {
  const now = Date.now();
  let p = null;
  if (u.plan && u.until > now && !(u.planFrom > now)) { const x = cfg().plans.find((y) => y.id === u.plan); p = x ? { ...x, until: u.until } : null; } // until — для плашки публикаций и срока в кабинете
  // место в оплаченной команде даёт Pro; свой тариф выше (Max) или тот же с более дальним сроком остаётся
  const seat = u && u.id ? teams.seatOf(u.id, now) : null;
  if (seat) { const tp = cfg().plans.find((y) => y.id === seat.plan); if (tp && (!p || (p.tier || 0) < (tp.tier || 0) || ((p.tier || 0) === (tp.tier || 0) && p.until < seat.until))) p = { ...tp, until: seat.until, team: seat.name }; }
  if (!p) p = cfg().plans.find((x) => x.id === 'free');
  // временное админское продление лимита сообщений (u.msgExt = {limit, until}) — только вверх
  const ext = u && u.msgExt && u.msgExt.until > now && Number(u.msgExt.limit) > 0 ? Math.floor(Number(u.msgExt.limit)) : 0;
  // BIZ-17: безлимит (msgs == null) — это бесконечность, продление не делает его конечной квотой; у безлимита с общим
  // потолком (fair) продление поднимает только этот потолок (fairExt), сам тариф остаётся безлимитным
  if (ext && p.msgs != null && ext > p.msgs) return Object.assign({}, p, { msgs: ext, extUntil: u.msgExt.until, extLimit: ext });
  if (ext && p.msgs == null && !p.nofair && cfg().fair > 0 && ext > cfg().fair) return Object.assign({}, p, { fairExt: ext, extUntil: u.msgExt.until, extLimit: ext });
  return p;
}
// цена дня тарифа по каталогу, ₽ (0 — тариф не продаётся: его остаток при смене тарифа не переносится, как и раньше)
const dayPrice = (id, c = cfg()) => { const p = c.plans.find((x) => x.id === id); return p && p.price > 0 && p.days > 0 ? p.price / p.days : 0; };
// действующий личный тариф пользователя в том виде, в каком его сверяет журнал выдач
const curOf = (u, now = Date.now()) => (u && u.plan && u.until > now ? { plan: u.plan, until: u.until, dayPrice: dayPrice(u.plan) } : null);
// поля plan / until / planFrom пользователя — отражение очереди журнала (planFrom — когда начнутся отложенные бонусные дни)
function setState(u, s, now = Date.now()) {
  if (s) { u.plan = s.plan; u.until = s.until; if (s.from > now) u.planFrom = s.from; else delete u.planFrom; }
  else { if (u.until > now) u.until = now; delete u.planFrom; }
}
// до какого момента место в команде закрывает тариф p (0 — места нет или его тариф ниже)
const seatCover = (uid, p, c, now) => { const seat = teams.seatOf(uid, now), tp = seat && c.plans.find((x) => x.id === seat.plan); return tp && p && (tp.tier || 0) >= (p.tier || 0) ? seat.until : 0; };
// Продление: тот же тариф — в конец очереди; другой — остаток пересчитывается по цене дня (цена тарифа / его срок), записанной в журнале выдач.
// o.src — источник (номер платежа, promo:…); без него выдача считается ручной. o.kind = 'bonus' — бонусные дни:
// участнику оплаченной команды без своего тарифа они включаются после доступа команды, а не сгорают под ним.
function extend(u, planId, days, o = {}) {
  const c = cfg(), np = c.plans.find((p) => p.id === planId), now = Date.now();
  if (!np) throw new Error('Нет такого тарифа');
  const cur = curOf(u, now), defer = o.kind === 'bonus' && (!cur || u.planFrom > now) ? seatCover(u.id, np, c, now) : 0;
  setState(u, ent.grantTime({ uid: u.id }, { src: o.src || 'grant:' + crypto.randomUUID(), kind: o.kind || 'plan', plan: planId, ms: Math.round(days * DAY), dayPrice: dayPrice(planId, c), cur, now, defer, tag: o.tag }).state, now);
}
// выдача тарифа из панели: free — снять; ext — продлить, как оплата; иначе — задать срок заново (прежние выдачи в журнале закрываются)
function setPlan(uid, plan, days, ext) {
  return updateUser(uid, (x) => {
    const now = Date.now();
    if (plan !== 'free' && ext) return extend(x, plan, days, { src: 'admin:' + crypto.randomUUID() });
    if (plan === 'free') { delete x.plan; delete x.until; } else { x.plan = plan; x.until = Math.round(now + days * DAY); }
    delete x.planFrom; ent.reconcile({ uid: x.id }, curOf(x, now), now);
  });
}
// Отложенные бонусные дни держатся за конец доступа команды: команду продлили — сдвигаются дальше, места больше нет — начинаются сейчас.
// Перенос идёт сразу при изменении команды (teams.onChange) и обходом раз в ANCHOR.tick. Если бонусные дни успели начаться не раньше
// чем ANCHOR.grace назад, а место в команде всё ещё действует (её продлили перед самым их началом), они тоже отодвигаются.
const ANCHOR = { tick: 5 * 60e3, grace: 15 * 60e3 };
function reanchor(uid, now = Date.now()) {
  const u = store.users.get(uid); if (!u || !(u.planFrom > now - ANCHOR.grace) || !curOf(u, now)) return;
  const c = cfg(), to = seatCover(uid, c.plans.find((p) => p.id === u.plan), c, now) || now;
  if (to !== u.planFrom && (to > now || u.planFrom > now)) updateUser(uid, (x) => setState(x, ent.shift({ uid }, to, curOf(x, now), now, ANCHOR.grace).state, now));
}
const reanchorAll = (uids, now = Date.now()) => { for (const uid of uids) { try { reanchor(uid, now); } catch (e) { console.log('Отложенные бонусные дни:', e.message); } } };
teams.onChange(reanchorAll); // команду продлили или сократили, участник вошёл или вышел
setInterval(() => { try { reanchorAll(ent.deferred(Date.now(), ANCHOR.grace)); } catch (e) { console.log('Отложенные бонусные дни:', e.message); } try { refRetry(); } catch (e) { console.log('refRetry:', e.message); } }, ANCHOR.tick).unref();
// Забрать у пользователя дни, выданные источником (возврат платежа): по журналу — неизрасходованную часть его строк.
// Источника в журнале нет (оплата до появления журнала) или срок после неё задали вручную — прежнее правило: минус дни, если тариф тот же.
function takeDays(src, uid, plan, days, kind, now = Date.now()) {
  updateUser(uid, (x) => {
    const h = { uid }, cur = curOf(x, now); ent.reconcile(h, cur, now);
    const r = ent.fate(src, h, kind) === 'ok' ? ent.revokeTime(h, src, cur, now) : cur && x.plan === plan ? ent.cut(h, days * DAY, cur, now) : null;
    if (r) setState(x, r.state, now);
  });
}
// один раз: журнал выдач для уже действующих подписок. Оплаты текущего тарифа, от последней оплаченной к первой, укладываются от конца срока назад;
// что оплатами не объясняется (подарки, панель, пересчёты) — одна строка без платежа в начале очереди.
function migrateLedger() {
  if (store.kv.get('ent:migrated', null)) return;
  store.tx(() => {
    const now = Date.now(), c = cfg(); let users = 0, rows = 0;
    for (const u of store.users.all()) {
      const cur = curOf(u, now), h = { uid: u.id }; if (!cur || ent.live(h, now).length) continue;
      let end = cur.until; const row = (src, starts, at) => { ent.ins({ ...h, src, kind: 'plan', plan: u.plan, starts, ends: end, dayPrice: cur.dayPrice, at }); rows++; };
      const when = (p) => p.paid || p.created || 0; // порядок выдач — по времени оплаты: счёт могли оплатить позже, чем следующий за ним
      // выдача действует, пока счёт не возвращён: прежний код допускал «оплачен → отменён/ожидает» с выданным тарифом — такие счета тоже получают строки
      const pays = store.payments.byUid(u.id).filter((p) => p.applied && !p.revoked && p.status !== 'CHARGEBACKED' && Number(p.days) > 0 && c.plans.some((x) => x.id === p.plan)).sort((a, b) => when(b) - when(a));
      for (const p of pays) { if (p.plan !== u.plan || end <= now || ent.has(p.id)) break; const st = end - p.days * DAY; row(p.id, st, p.paid || p.created || now); end = st; }
      if (end > now) row('legacy:' + u.id, now, now);
      users++;
    }
    store.kv.set('ent:migrated', { at: now, users, rows });
    if (users) console.log(`Журнал выдач: перенесено подписок — ${users}, строк — ${rows}`);
  });
}
const updateUser = (uid, fn) => store.users.update(uid, fn);
// бесплатного пробного периода при регистрации больше нет: при старте снимаем его следы со старых аккаунтов
// (флаг trial ставился только бесплатному периоду — оплата и выдача тарифа из панели его снимали)
function dropFreeTrial() {
  store.tx(() => {
    for (const u of store.users.all()) if (u.trial) store.users.update(u.id, (x) => { delete x.trial; delete x.plan; delete x.until; });
    store.kv.del('trials');
    const c = store.kv.get('plans', null);
    if (c && typeof c === 'object' && ('trialDays' in c || 'trialPlan' in c)) { delete c.trialDays; delete c.trialPlan; store.kv.set('plans', c); }
  });
}

/* ---------- дневной расход (сутки по Москве) ---------- */
const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
let U = { day: null, u: {} }, flushT = null;
function usage() { const d = today(); if (U.day !== d) { if (U.day) flush(); U = { day: d, u: store.kv.get('usage:' + d, {}) }; } return U; }
function flush() { clearTimeout(flushT); flushT = null; if (U.day) store.kv.set('usage:' + U.day, U.u); }
// BIZ-18: расход и остатки считаются целыми десятыми (r1 после каждого действия): вес 0.1 не копит двоичную дробь
// (0.1 × 10 раньше давало 0.9999999999999999 и лимит кончался на сообщение раньше или позже)
const r1 = (n) => Math.round(n * 10) / 10;
const used = (uid) => { const x = usage().u[uid] || {}; return { m: r1(x.m || 0), c: r1(x.c || 0), s: r1(x.s || 0), i: r1(x.i || 0) }; };
function add(uid, k, n = 1) { const x = usage(); const r = (x.u[uid] ||= { m: 0, c: 0, s: 0, i: 0 }); r[k] = Math.max(0, r1((r[k] || 0) + n)); if (!flushT) flushT = setTimeout(flush, 3000); }
// BIZ-20: поправка счётчика конкретных суток (возврат по квитанции уходит в день списания, а не в «сегодня»)
function addDay(day, uid, k, n) {
  usage(); // сутки могли смениться: прошлый день уже записан в базу
  if (!day || day === U.day) return add(uid, k, n);
  const key = 'usage:' + day, m = store.kv.get(key, null);
  if (!m || !m[uid]) return;
  m[uid][k] = Math.max(0, r1((m[uid][k] || 0) + n)); store.kv.set(key, m);
}
function limitOf(p, k) { const v = p[KEYS[k]]; return v == null ? (k === 'm' && !p.nofair ? (cfg().fair ? Math.max(cfg().fair, p.fairExt || 0) : null) : null) : v; }
function left(u, k) { const lim = limitOf(planOf(u), k); return lim == null ? Infinity : Math.max(0, r1(lim - used(u.id)[k])); }
// живые пакеты пользователя: с остатком и не сгоревшие; первыми тратятся те, что сгорят раньше
const packList = (u, now = Date.now()) => ((u && u.msgPacks) || []).filter((x) => x.left > 0 && x.until > now).sort((a, b) => a.until - b.until);
const packLeft = (u) => r1(packList(u).reduce((n, x) => n + x.left, 0));
function packSpend(uid, w) {
  const took = [];
  updateUser(uid, (x) => { let need = w; for (const p of packList(x)) { if (need <= 0) break; const d = Math.min(p.left, need); p.left = r1(p.left - d); need = r1(need - d); took.push({ id: p.id, n: d }); } });
  return took;
}
function packInfo(u) {
  const c = cfg();
  return { left: packLeft(u), list: packList(u).map(({ n, left: l, until }) => ({ n, left: l, until })), offers: (c.packs || []).map(({ n, price }) => ({ n, price })), days: c.packDays };
}
// исчерпан ли хоть один дневной лимит (нулевые лимиты вроде «видео на Free» не в счёт)
function exhausted(u) { const p = planOf(u); return Object.keys(KEYS).some((k) => { const lim = limitOf(p, k); return lim != null && lim > 0 && left(u, k) < 1; }); }
// применить сброс к счётчикам суток: картинки/код/сайты — в ноль, сообщений возвращаем не больше resetMsgs (при лимите 10 000 сброс не даёт 10 000)
function resetUsage(uid) {
  const s = used(uid); usage().u[uid] = { m: r1(Math.max(0, (s.m || 0) - resetMsgs())), c: 0, s: 0, i: 0 }; flush();
}
// автосброс: сообщения кончились, на балансе есть сброс — тратим его сами (можно выключить: u.autoReset = false)
// BIZ-06: need > 0 — сброс нужен ради сообщения такого веса. Результат сброса считается заранее: если после него
// сообщение всё равно не пройдёт (лимит тарифа меньше веса модели и т. п.), сброс не тратится. Сброс и само сообщение
// записываются одной транзакцией — «сброс списан, а в запросе отказано» больше не бывает
function afterReset(u) { const lim = limitOf(planOf(u), 'm'); return lim == null ? Infinity : Math.max(0, r1(lim - Math.max(0, r1(used(u.id).m - resetMsgs())))); }
function autoReset(u, need = 0) {
  const x = store.users.get(u.id);
  if (!x || x.autoReset === false || !(x.resetBal > 0)) return false;
  if (need > 0 && afterReset(x) < need) return false;
  store.tx(() => {
    updateUser(u.id, (y) => { y.resetBal = Math.max(0, (y.resetBal || 0) - 1); addResetLog(y, 'auto', -1); });
    resetUsage(u.id);
    if (need > 0) { add(u.id, 'm', need); flush(); }
  });
  return true;
}
const setAutoReset = (uid, on) => updateUser(uid, (x) => { x.autoReset = !!on; });
// ---------- Ultra-модели за кредиты (тарифы с ultra: true, по умолчанию — Ultra): купленные не сгорают, кредиты тарифа — каждый день, не копятся ----------
const ULTRA_DEF = { on: false, price: 15, maxBuy: 10000, daily: 0, ctxFree: 20000, ctxStep: 10000, ctxCredits: 1, maxOut: 8000, cost: 0, minByMethod: {} };
// daily — ежедневный подарок Max; в старых конфигах он лежал в monthly (тогда это была выдача раз в 30 дней)
const ultraCfg = () => { const u = cfg().ultra || {}, o = { ...ULTRA_DEF, ...u }; if (u.daily == null && u.monthly != null) o.daily = u.monthly; delete o.monthly; return o; };
const ULTRA_LOG_MAX = 120;
// BIZ-28: суточные итоги по всем пользователям лежат отдельно (таблица ultra_days, десятые доли кредита) — короткая история
// пользователя (ULTRA_LOG_MAX последних событий) для статистики за 30 дней не годится: активный пользователь вытесняет её за день
const ULTRA_COL = { buy: 'bought', use: 'spent', gift: 'gifted', refund: 'refunded' };
function ultraDayAdd(kind, n, day = today()) {
  const col = ULTRA_COL[kind], v = Math.round(Math.abs(Number(n) || 0) * 10);
  if (!col || !v) return;
  store.db.prepare(`INSERT INTO ultra_days (day, ${col}) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET ${col} = ${col} + excluded.${col}`).run(day, v);
}
const addUltraLog = (y, kind, n) => { y.ultraLog = [...(y.ultraLog || []), { kind, n, at: Date.now() }].slice(-ULTRA_LOG_MAX); ultraDayAdd(kind, n); };
// Запросы через API не пишем в журнал по одному (они вытесняли покупки и подарки): одна строка на сутки по Москве, итог за день (траты минус возвраты);
// каждый запрос с его кредитами лежит в api_log.credits
function addApiUltraLog(y, n) {
  const day = today(), list = [...(y.ultraLog || [])], i = list.findLastIndex((e) => e && e.api && e.day === day);
  const e = i >= 0 ? list.splice(i, 1)[0] : { kind: 'api', api: true, day, n: 0 };
  e.n = r1(e.n + n); e.kind = 'api'; e.at = Date.now(); // одна строка «API за день» (итог списаний и возвратов)
  list.push(e); y.ultraLog = list.slice(-ULTRA_LOG_MAX);
  ultraDayAdd(n < 0 ? 'use' : 'refund', n, day);
}
// один раз: суточные итоги за прошлое собираются из того, что ещё есть в историях пользователей (точнее узнать неоткуда)
function migrateUltraDays() {
  if (store.kv.get('mig:ultraDays', null)) return;
  store.tx(() => {
    if (!store.db.prepare('SELECT 1 x FROM ultra_days LIMIT 1').get()) {
      for (const u of store.users.all()) for (const e of u.ultraLog || []) {
        if (!e || !(e.at > 0)) continue;
        const day = e.day || new Date(e.at + 3 * 3600e3).toISOString().slice(0, 10);
        if (e.kind === 'api') ultraDayAdd(e.n < 0 ? 'use' : 'refund', e.n, day); else ultraDayAdd(e.kind, e.n, day);
      }
    }
    store.kv.set('mig:ultraDays', Date.now());
  });
}
const logUltra = (y, kind, n, api) => (api ? addApiUltraLog(y, kind === 'refund' ? n : -Math.abs(n)) : addUltraLog(y, kind, n));
const ultraOf = (u) => { const x = (u && u.ultra) || {}; return { bal: r1(x.bal || 0), bonus: r1(x.bonus || 0), bonusUntil: x.bonusUntil || 0, giftDay: x.giftDay || '', giftN: x.giftN || 0 }; };
// тарифы с доступом к Ultra-моделям; самый дешёвый из них — для подсказок «доступно на …»
const ultraPlans = () => cfg().plans.filter((p) => p.ultra);
const ultraPlan = () => ultraPlans().sort((a, b) => a.price - b.price)[0] || null;
// конец текущих суток по Москве — до этого момента живёт ежедневный подарок
const dayEnd = () => { const d = new Date(Date.now() + 3 * 3600e3); d.setUTCHours(24, 0, 0, 0); return d.getTime() - 3 * 3600e3; };
// оценка размера запроса в токенах: ~3,5 символа на токен, картинка ~1000; считаем весь запрос целиком —
// сообщения, system, tools (описания и схемы), tool_calls / tool_use / tool_result, thinking, документы, поля Responses (input, instructions)
const IMAGE_TYPES = new Set(['image', 'image_url', 'input_image']);
function walkSize(v, st, depth) {
  if (v == null || depth > 64) return;
  if (typeof v === 'string') { st.chars += v.length; return; }
  if (typeof v !== 'object') return;
  if (Array.isArray(v)) { for (const x of v) walkSize(x, st, depth + 1); return; }
  if (IMAGE_TYPES.has(v.type)) { st.imgs++; return; }
  if (v.type === 'redacted_thinking') return; // зашифрованные размышления — не текст контекста
  const b64 = v.type === 'base64' || v.media_type != null;
  for (const k of Object.keys(v)) {
    const x = v[k];
    if (k === 'signature' || k === 'encrypted_content') continue; // подписи и зашифрованные блоки (Codex шлёт их каждый ход) — не считаем
    // base64-документ: провайдер считает извлечённый текст, а не байты файла — примерно 1 токен на 12 байт (PDF ~ 1500–3000 токенов на страницу)
    if (typeof x === 'string' && (k === 'file_data' || (k === 'data' && b64))) { st.chars += Math.round(x.length * 0.75 / 12 * 3.5); continue; }
    st.chars += k.length; walkSize(x, st, depth + 1);
  }
}
function estimateTokens(list, system, extra) {
  const st = { chars: 0, imgs: 0 };
  walkSize(system, st, 0); walkSize(list, st, 0); walkSize(extra, st, 0);
  return Math.round(st.chars / 3.5) + st.imgs * 1000;
}
// цена запроса: кредиты модели + доплата за каждый шаг контекста сверх бесплатного
function ultraCost(model, ctxTokens) {
  const U = ultraCfg(), base = Math.max(1, Math.round(Number(model && model.credits) || 1));
  const extra = Math.ceil(Math.max(0, (Number(ctxTokens) || 0) - U.ctxFree) / Math.max(1, U.ctxStep)) * U.ctxCredits;
  return { base, extra, total: base + extra };
}
// кредиты тарифа: раз в сутки (по Москве) подарочный баланс становится равным credits тарифа — вчерашний остаток сгорает, не копится;
// перешёл днём на тариф с большим числом кредитов — доначисляем разницу; тариф закончился — кредиты сгорают в конце суток
function ultraGrant(uid) {
  const U = ultraCfg(), u0 = store.users.get(uid); if (!u0) return ultraOf(null);
  const now = Date.now(), x = ultraOf(u0), p = planOf(u0), daily = p.ultra ? Math.max(0, Math.round(p.credits || 0)) : 0;
  if (U.on && daily > 0 && x.giftDay !== today()) {
    const nu = updateUser(uid, (y) => { y.ultra = { ...(y.ultra || {}), bonus: daily, bonusUntil: dayEnd(), giftDay: today(), giftN: daily }; addUltraLog(y, 'gift', daily); });
    return ultraOf(nu);
  }
  if (U.on && daily > x.giftN && x.giftDay === today()) {
    const add = daily - x.giftN;
    const nu = updateUser(uid, (y) => { const o = { bonus: 0, ...(y.ultra || {}) }; y.ultra = { ...o, bonus: r1(o.bonus + add), bonusUntil: dayEnd(), giftN: daily }; addUltraLog(y, 'gift', add); });
    return ultraOf(nu);
  }
  if (x.bonus > 0 && x.bonusUntil && now > x.bonusUntil) { const nu = updateUser(uid, (y) => { y.ultra = { ...(y.ultra || {}), bonus: 0 }; }); return ultraOf(nu); }
  return x;
}
function ultraSpend(uid, n, kind = 'use', api = false) {
  const took = { bonus: 0, bal: 0 };
  updateUser(uid, (y) => { const x = { bal: 0, bonus: 0, ...(y.ultra || {}) }; const b = Math.min(x.bonus, n); x.bonus = r1(x.bonus - b); x.bal = r1(x.bal - (n - b)); took.bonus = b; took.bal = r1(n - b); y.ultra = x; logUltra(y, kind, -n, api); });
  took.day = today(); // BIZ-20: у каждого списания свои сутки (раунды одного ответа могут попасть в разные)
  return took;
}
function ultraReturn(uid, list, api = false) {
  const b = r1(list.reduce((n, t) => n + (t.bonus || 0), 0)), p = r1(list.reduce((n, t) => n + (t.bal || 0), 0));
  if (!b && !p) return;
  updateUser(uid, (y) => { const x = { bal: 0, bonus: 0, ...(y.ultra || {}) }; x.bonus = r1(x.bonus + b); x.bal = r1(x.bal + p); y.ultra = x; logUltra(y, 'refund', r1(b + p), api); });
}
// подарок тарифа живёт до конца суток: если запрос начат вчера, а возвращаем сегодня — подарочную часть не возвращаем (иначе вчерашнее вернулось бы в сегодняшний подарок)
const tookToday = (ch) => (ch.took || []).map((t) => ((t.day || ch.day) === today() ? t : { ...t, bonus: 0 }));
function chargeUltra(u, model, opts, h, now) {
  const U = ultraCfg(); if (!U.on) return { error: 'Ultra-модели сейчас выключены', code: 'model' };
  const x = ultraGrant(u.id), cost = ultraCost(model, opts.ctxTokens), have = r1(x.bal + x.bonus);
  if (have < cost.total) return { error: 'Не хватает Ultra-кредитов: нужно ' + cost.total + (cost.extra ? ' (+' + cost.extra + ' за длинный контекст)' : '') + ', у вас ' + have + '. Пополнить — в окне «Ultra-кредиты».', code: 'credits', need: cost.total, have, cost };
  const took = [ultraSpend(u.id, cost.total, 'use', !!opts.api)];
  if (opts.burst !== false) { h.push(now); burstHits.set(u.id, h); }
  return { ok: true, ultra: true, api: !!opts.api, weight: 0, credits: cost.total, cost, took, day: today(), bonus: false };
}
// ещё один раунд инструментов у Ultra-модели — ещё base кредитов и доплата за контекст этого запроса (BIZ-21: раньше доплата
// бралась только с первого запроса, хотя к раундам контекст только растёт); ch.round — цена текущего раунда для пересчёта по факту
function ultraMore(u, ch, ctxTokens) {
  if (!ch || !ch.ultra) return false;
  const cost = ultraCost({ credits: ch.cost.base }, ctxTokens), x = ultraGrant(u.id);
  if (r1(x.bal + x.bonus) < cost.total) return false;
  // у каждого раунда свой номер: пересчёт доплаты трогает только списания своего раунда (их сутки и источник), а не чужие
  ch.rounds = (ch.rounds || 0) + 1;
  ch.took.push({ ...ultraSpend(u.id, cost.total, 'use', !!ch.api), round: ch.rounds }); ch.credits = r1(ch.credits + cost.total); ch.round = { cost, n: ch.rounds };
  return true;
}
function refundUltraRounds(u, ch) { if (!ch || !ch.ultra || !ch.took) return; const r = ch.took.filter((t) => t.round); ch.took = ch.took.filter((t) => !t.round); ultraReturn(u.id, tookToday({ day: ch.day, took: r }), !!ch.api); ch.credits = r1(ch.took.reduce((n, t) => n + (t.bonus || 0) + (t.bal || 0), 0)); ch.round = null; }
// после ответа известно, сколько токенов контекста было на самом деле: если доплата за длинный контекст выше уже списанной — добираем разницу
// (не больше, чем есть на балансе, в минус не уходим); возвращает, сколько добрали
// opts.round — пересчитать текущий раунд инструментов (ch.round), а не первый запрос; opts.cap — сколько кредитов ещё можно
// списать сверху (API-01: остаток суточного предела ключа; сверх него не добираем)
function ultraTopUp(u, ch, inTokens, opts = {}) {
  if (!ch || !ch.ultra || !ch.ok || !ch.cost || !(inTokens > 0)) return 0;
  const c = opts.round ? ch.round : ch; if (!c || !c.cost) return 0;
  const diff = r1(ultraCost({ credits: ch.cost.base }, inTokens).extra - c.cost.extra);
  if (diff < 0) { // оценка оказалась выше реального контекста — возвращаем лишнюю доплату (сначала купленные: они списаны последними)
    // возвращённое вычитается из самих списаний (ch.took): иначе полный возврат после пересчёта вернул бы эту часть второй раз
    let n = Math.min(-diff, c.cost.extra); const back = [];
    const mine = ch.took.filter((t) => (opts.round ? t.round === c.n : !t.round)); // только списания пересчитываемого запроса
    for (const key of ['bal', 'bonus']) for (const t of [...mine].reverse()) { if (n <= 0) break; const a = Math.min(n, t[key] || 0); if (!(a > 0)) continue; t[key] = r1(t[key] - a); n = r1(n - a); back.push({ [key]: a, day: t.day }); }
    const ret = tookToday({ day: ch.day, took: back }); ultraReturn(u.id, ret, !!ch.api);
    const got = r1(ret.reduce((s, t) => s + (t.bal || 0) + (t.bonus || 0), 0)); if (!got) return 0;
    ch.credits = r1(ch.credits - got); c.cost = { ...c.cost, extra: r1(c.cost.extra - got), total: r1(c.cost.total - got) };
    return -got;
  }
  if (!(diff > 0)) return 0;
  const x = ultraGrant(u.id), n = r1(Math.min(diff, r1(x.bal + x.bonus), opts.cap == null ? Infinity : Math.max(0, Number(opts.cap) || 0)));
  if (!(n > 0)) return 0;
  ch.took.push({ ...ultraSpend(u.id, n, 'use', !!ch.api), round: opts.round ? c.n : false }); ch.credits = r1(ch.credits + n); c.cost = { ...c.cost, extra: r1(c.cost.extra + n), total: r1(c.cost.total + n) };
  return n;
}
function ultraInfo(u) {
  const U = ultraCfg(), x = u && u.id ? ultraGrant(u.id) : ultraOf(null);
  const p = u && u.id ? planOf(u) : null, up = p && p.ultra ? p : ultraPlan(), daily = up ? up.credits || 0 : 0;
  // max — есть ли доступ к Ultra-моделям (имя поля прежнее — для старых клиентов); plan — свой тариф с доступом или самый дешёвый такой
  return { on: !!U.on, bal: x.bal, bonus: x.bonus, bonusUntil: x.bonusUntil, price: U.price, maxBuy: U.maxBuy, daily, monthly: daily, ctxFree: U.ctxFree, ctxStep: U.ctxStep, ctxCredits: U.ctxCredits, max: !!(p && p.ultra), access: !!(p && p.ultra), plan: up ? { id: up.id, name: up.name, credits: up.credits || 0 } : null };
}
const ultraHistory = (uid, n = 30) => (((store.users.get(uid) || {}).ultraLog) || []).slice(-n).reverse();
function ultraAdjust(uid, n) {
  return updateUser(uid, (y) => { const x = { bal: 0, bonus: 0, ...(y.ultra || {}) }; x.bal = Math.max(0, r1(x.bal + n)); y.ultra = x; addUltraLog(y, 'admin', n); });
}
// итоги за 30 суток по Москве (включая сегодня) — из суточных итогов ultra_days (BIZ-28); балансы — как есть сейчас
function ultraStats() {
  const s = { bought: 0, spent: 0, gifted: 0, refunded: 0, balance: 0, bonus: 0, users: 0 };
  for (const u of store.users.all()) { const x = ultraOf(u); s.balance += x.bal; s.bonus += x.bonus; if (x.bal + x.bonus > 0) s.users++; }
  const since = new Date(Date.now() + 3 * 3600e3 - 29 * DAY).toISOString().slice(0, 10);
  const t = store.db.prepare('SELECT sum(bought) b, sum(spent) s, sum(gifted) g, sum(refunded) r FROM ultra_days WHERE day >= ?').get(since) || {};
  s.bought = (t.b || 0) / 10; s.spent = (t.s || 0) / 10; s.gifted = (t.g || 0) / 10; s.refunded = (t.r || 0) / 10;
  for (const k of Object.keys(s)) s[k] = r1(s[k]);
  return s;
}

// последние платежи пользователя — для «Мои платежи»
function myPayments(uid, n = 15) {
  return store.payments.byUid(uid).sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, n).map((x) => ({
    order: x.id, plan: x.plan, amount: x.amount, status: x.status, method: x.method || x.provider || null, created: x.created || null, paid: x.paid || null,
    qty: x.qty || null, pack: x.pack ? x.pack.n : null, usedNow: x.usedNow, credited: x.credited, months: x.months || null }));
}
const burstHits = new Map(), BURST_MS = 5 * 60000;
let burstSweepAt = 0;
// BIZ-38: записи пользователей, которые не писали дольше окна антиспама, удаляются (раньше карта росла до перезапуска)
function sweepBurst(now = Date.now()) {
  for (const [k, h] of burstHits) if (!h.length || now - h[h.length - 1] >= BURST_MS) burstHits.delete(k);
  burstSweepAt = now; return burstHits.size;
}

/* ---------- квитанции списаний (этап 2: BIZ-06, BIZ-07, BIZ-20) ----------
   Каждое списание сообщения — первое и за каждый дополнительный раунд инструментов — оставляет квитанцию:
   { day — сутки по Москве, source — источник (plan: дневной лимит тарифа, pack: пакет, bonus: бонус за приглашение,
   reset: сброс с баланса), amount — сколько сообщений, pack — из каких пакетов, round — это раунд инструментов }.
   Возврат идёт по квитанции: пакету и бонусу — в любой день, счётчик суток — в день списания (а не в «сегодня»). */
// одно сообщение веса w из первого подходящего источника: дневной лимит → пакет (сгорает) → бонус за приглашение → автосброс
function takeMsg(u, w) {
  const day = today(); let source = 'plan', pack = null;
  if (left(u, 'm') < w) {
    if (packLeft(u) >= w) { pack = packSpend(u.id, w); source = 'pack'; }
    else if (takeRefBonus(u.id, w)) source = 'bonus';
    else if (autoReset(u, w)) return { day, source: 'reset', amount: w }; // сообщение уже записано вместе со сбросом
    else return null;
  }
  add(u.id, 'm', w);
  return { day, source, amount: w, ...(pack ? { pack } : {}) };
}
function giveBack(uid, r) {
  if (!r || r.back) return 0;
  r.back = true;
  if (r.pack && r.pack.length) updateUser(uid, (x) => { for (const t of r.pack) { const p = (x.msgPacks || []).find((y) => y.id === t.id); if (p) p.left = r1(p.left + t.n); } }); // пакету — в любой день
  if (r.source === 'bonus') store.users.update(uid, (x) => { if (x.refBonus) x.refBonus.n = r1(x.refBonus.n + r.amount); }); // вернуть ровно то, что списали (бонус не по суткам)
  addDay(r.day, uid, 'm', -r.amount);
  return r.amount;
}
// квитанции списания; у списаний без них (объект собран не через charge) — одна квитанция по прежним полям
const receiptsOf = (ch) => (ch.receipts ||= [{ day: ch.day, source: ch.bonusTaken > 0 ? 'bonus' : ch.pack && ch.pack.length ? 'pack' : 'plan', amount: ch.bonusTaken > 0 ? ch.bonusTaken : ch.weight, ...(ch.pack ? { pack: ch.pack } : {}) }]);
// сколько сейчас списано за ответ: сообщения (с весом) или Ultra-кредиты
const chargedOf = (ch) => (!ch || !ch.ok ? 0 : ch.ultra ? r1(ch.credits || 0) : r1(receiptsOf(ch).reduce((n, r) => n + (r.back ? 0 : r.amount), 0)));

// можно ли отправить сообщение этой модели; при успехе сразу списывает
// opts.burst === false — без антиспама «N сообщений за 5 минут» (у API свой лимит запросов в минуту)
function charge(u, model, opts = {}) {
  u = (u && u.id && store.users.get(u.id)) || u; // свежие данные: запрос мог долго читаться, пока рядом списывались бонусы/пакеты
  const c = cfg(), p = planOf(u), allowed = modelPlans(model);
  if (!allowed.includes(p.id)) { const np = c.plans.filter((x) => allowed.includes(x.id)).sort((a, b) => a.price - b.price)[0]; return { error: np ? `Модель «${model.name}» доступна на тарифе ${np.name}` : `Модель «${model.name}» сейчас недоступна`, code: 'model' }; }
  const w = Math.max(0.1, r1(Number(model.weight) || 1));
  // антиспам проверяем до списаний: иначе отказ «слишком часто» съел бы сообщение из пакета или сброс
  const now = Date.now(), h = (burstHits.get(u.id) || []).filter((t) => now - t < BURST_MS);
  if (now - burstSweepAt >= 60000) sweepBurst(now);
  if (opts.burst !== false && c.burst > 0 && h.length >= c.burst) return { error: 'Слишком много сообщений подряд. Подождите пару минут.', code: 'burst' };
  if (model.ultra) return chargeUltra(u, model, opts, h, now); // Ultra: кредиты вместо сообщений
  // дневной лимит кончился: сначала пакет сообщений (сгорает), потом бонус за приглашение, потом сброс с баланса (автосброс)
  const rcp = takeMsg(u, w);
  if (!rcp) return { error: p.msgs == null ? 'Достигнут дневной предел. Он обновится в полночь по Москве.' : `Сообщения на сегодня закончились (${p.name}: ${p.msgs} в день). Лимит обновится в полночь по Москве.`, code: 'limit' };
  if (opts.burst !== false) { h.push(now); burstHits.set(u.id, h); }
  const bonus = rcp.source === 'bonus';
  return { ok: true, weight: w, day: rcp.day, bonus, ...(bonus ? { bonusTaken: w } : {}), ...(rcp.pack ? { pack: rcp.pack } : {}), ...(rcp.source === 'reset' ? { autoReset: true } : {}), receipts: [rcp] };
}
// BIZ-07: дополнительный раунд инструментов списывается тем же механизмом, что и первое сообщение (лимит → пакет → бонус → автосброс),
// со своей квитанцией. У Ultra-модели — кредиты: base и доплата за контекст этого запроса (opts.ctxTokens)
function chargeRound(u, ch, opts = {}) {
  if (!ch || !ch.ok) return false;
  u = (u && u.id && store.users.get(u.id)) || u;
  if (ch.ultra) return ultraMore(u, ch, opts.ctxTokens);
  const r = takeMsg(u, ch.weight); if (!r) return false;
  r.round = true; receiptsOf(ch).push(r);
  return true;
}
// бонус за приглашение: проверка и списание — одним шагом на свежих данных (параллельные запросы не спишут один и тот же остаток)
function takeRefBonus(uid, w) {
  let ok = false;
  store.users.update(uid, (x) => { const rb = x.refBonus; if (rb && rb.n >= w && rb.until > Date.now()) { rb.n = r1(rb.n - w); ok = true; } });
  return ok;
}
// отказ клиента до первого токена возвращает списание, но не больше ABORT_REFUNDS раз в сутки по Москве на пользователя (дальше — остаётся списанным)
const ABORT_REFUNDS = 20;
function takeAbortRefund(uid) {
  const day = today(), k = 'abortrefund:' + day, m = store.kv.get(k, null) || {};
  if ((m[uid] || 0) >= ABORT_REFUNDS) return false;
  if (!Object.keys(m).length) for (const o of store.kv.keys('abortrefund:')) if (o !== k) store.kv.del(o);
  m[uid] = (m[uid] || 0) + 1; store.kv.set(k, m);
  return true;
}
// вернуть всё списание за ответ (первое сообщение и все раунды) — каждую квитанцию в свои сутки и свой источник
function refund(u, ch) {
  if (!ch || !ch.ok) return;
  if (ch.ultra) { ultraReturn(u.id, tookToday(ch), !!ch.api); ch.took = []; ch.credits = 0; return; } // Ultra — кредиты обратно, дневной лимит не трогали
  for (const r of receiptsOf(ch)) giveBack(u.id, r);
  ch.bonusTaken = 0;
}
// вернуть только доплаты за раунды инструментов (первое сообщение остаётся списанным)
function refundRounds(u, ch) {
  if (!ch || !ch.ok) return;
  if (ch.ultra) return refundUltraRounds(u, ch);
  for (const r of receiptsOf(ch)) if (r.round) giveBack(u.id, r);
}

/* ---------- одна политика исходов для веб-чата и API (этап 2: BIZ-10, BIZ-22, BIZ-23) ----------
   o.outcome — чем закончился ответ; o.delivered — что пользователь реально получил: { text: число символов, images, files, actions };
   o.shutdown — ответ оборвал сам сервер (перезапуск, внутренний срок): такая отмена не идёт в счёт ABORT_REFUNDS.
     complete, needs_clarification — списание остаётся; пользователь не получил ничего — полный возврат;
     cancelled (пользователь остановил ответ) — что-то уже получено: списание остаётся; ничего не получено: полный возврат,
       но не больше ABORT_REFUNDS раз в сутки (дальше списание остаётся — иначе отменой можно бесплатно нагружать модели);
     error, timeout, upstream_error (сбой или обрыв потока модели), site_limit (сайт не выдан из-за лимита) — получено меньше
       MIN_TEXT символов и ни картинок, ни файлов, ни действий: полный возврат; иначе первое сообщение остаётся, доплаты за раунды возвращаются;
     media_error, edit_rejected, repair_error, missing_artifact — заказанный результат (картинка, правка, сайт) не выдан: полный возврат.
   Возвращает { keep: 'all' | 'first' | 'none', capped — сработал предел возвратов за отмену, charged — сколько осталось списано }. */
const MIN_TEXT = 200;
const OUT_FAILED = new Set(['error', 'timeout', 'upstream_error', 'site_limit']), OUT_NOT_DONE = new Set(['media_error', 'edit_rejected', 'repair_error', 'missing_artifact']);
function settle(u, ch, o = {}) {
  if (!ch || !ch.ok) return { keep: 'none', capped: false, charged: 0 };
  const d = o.delivered || {}, text = Math.max(0, Number(d.text) || 0), other = !!(d.images || d.files || d.actions), none = !text && !other;
  const outcome = o.outcome || 'complete';
  let keep = 'all', capped = false;
  if (outcome === 'cancelled') { if (none) { if (o.shutdown || takeAbortRefund(u.id)) keep = 'none'; else capped = true; } }
  else if (OUT_NOT_DONE.has(outcome)) keep = 'none';
  else if (OUT_FAILED.has(outcome)) keep = text < MIN_TEXT && !other ? 'none' : 'first';
  else if (none) keep = 'none';
  if (keep === 'none') refund(u, ch); else if (keep === 'first') refundRounds(u, ch);
  return { keep, capped, charged: chargedOf(ch) };
}

/* ---------- резерв единицы дневной квоты (этап 2: BIZ-08, BIZ-15, BIZ-19) ----------
   Картинка, запуск Python, сайт: единица занимается синхронно — проверка остатка и запись идут без await между ними,
   поэтому параллельные запросы не потратят один и тот же остаток. Результат не доставлен (сбой, отмена, программа не
   запустилась, сайт не выдан) — release возвращает единицу в сутки резерва; доставлен — commit. */
function reserve(u, k, n = 1) {
  const x = (u && u.id && store.users.get(u.id)) || u;
  if (!x || !KEYS[k] || left(x, k) < n) return null;
  add(x.id, k, n);
  return { uid: x.id, k, n, day: today(), open: true };
}
function release(r) { if (!r || !r.open) return false; r.open = false; addDay(r.day, r.uid, r.k, -r.n); return true; }
function commit(r) { if (!r || !r.open) return false; r.open = false; return true; }
// когда обнулится дневной лимит (полночь по Москве)
const resetsAt = () => Date.parse(today() + 'T00:00:00+03:00') + 86400000;

// на каких тарифах доступна модель (старые модели без списка — по «уровню»)
// Ultra-модели — только на тарифах с ultra: true (что бы ни было сохранено у модели); остальные — по списку тарифов модели
function modelPlans(m) { const c = cfg(); if (m && m.ultra) return c.plans.filter((p) => p.ultra).map((p) => p.id); return Array.isArray(m.plans) ? m.plans.filter((id) => c.plans.some((p) => p.id === id)) : c.plans.filter((p) => p.tier >= (m.tier || 0)).map((p) => p.id); }
// тариф продаётся: тариф с Ultra-моделями закрыт, пока Ultra выключен в панели (c — конфиг тарифов, по умолчанию сохранённый)
const planOpen = (p, c = cfg()) => !(p && p.ultra && !({ ...ULTRA_DEF, ...(c.ultra || {}) }).on);
// all — полный список (для панели администратора); иначе без закрытых от продажи тарифов
const publicPlans = (all = false) => cfg().plans.filter((p) => all || planOpen(p)).map(({ id, name, price, days, tier, msgs, code, sites, images, pc, desc, ultra, credits, strict }) => ({ id, name, price, days, tier, msgs, code, sites, images, pc, desc, ultra: !!ultra, credits: ultra ? credits || 0 : 0, strict: !!strict }));
// баланс сбросов для клиента: количество, пакеты и история (покупки, траты, возвраты)
function resetInfo(u) {
  return { n: (u && u.resetBal) || 0, price: resetPrice(), msgs: resetMsgs(), packs: RESET_PACKS.map((x) => ({ n: x.n, pct: x.pct })), qtyMax: RESET_MAX, dayMax: 0, today: 0, on: true, pro: 0, tier: null, plans: '' };
}
function resetHistory(uid, limit = 30) {
  const u = store.users.get(uid);
  return ((u && u.resetLog) || []).slice(-limit).reverse();
}
// потратить один сброс с баланса: картинки/код/сайты — в ноль, сообщения — на resetMsgs назад
function useReset(uid) {
  const u = store.users.get(uid);
  if (!u) return { ok: false, status: 404, error: 'Аккаунт не найден' };
  if (!(u.resetBal > 0)) return { ok: false, status: 400, code: 'no_balance', error: 'На балансе нет сбросов. Купить пакет можно в настройках.' };
  const s = used(uid);
  if (!(s.m || s.c || s.s || s.i)) return { ok: false, status: 400, code: 'zero', error: 'Счётчики на нуле — сбрасывать пока нечего.' };
  store.tx(() => {
    updateUser(uid, (x) => { x.resetBal = Math.max(0, (x.resetBal || 0) - 1); addResetLog(x, 'use', -1); });
    resetUsage(uid);
  });
  const user = store.users.get(uid);
  return { ok: true, left: user.resetBal, user };
}
function summary(u) {
  const p = planOf(u), x = used(u.id);
  return { publicationBranding: needsBranding(u, p), plan: { id: p.id, name: p.name, tier: p.tier, until: p.until, team: p.team || null }, used: x,
    limits: { m: limitOf(p, 'm'), c: limitOf(p, 'c'), s: limitOf(p, 's'), i: limitOf(p, 'i') }, images: !!(US.imagesOn && US.imagesOn()), cloud: !!(US.cloudOn && US.cloudOn()), unlimited: p.msgs == null,
    plans: publicPlans(), periods: periods(), resetPrice: resetPrice(), resetMsgs: resetMsgs(), resets: resetInfo(u), pay: payReady() || cryptoReady() || cisReady() || rbReady() || coinsoReady(), methods: { card: payReady() || coinsoReady(), robokassa: rbReady(), cispay: cisReady(), crypto: cryptoReady(), coinso: coinsoReady() }, ref: refInfo(u),
    offer: offers(u), packs: packInfo(u), ultra: ultraInfo(u), autoReset: u.autoReset !== false, resetsAt: resetsAt(), warnPct: growth.conf().limits.warnPct, teamOffer: teams.offer() };
}

/* ---------- первая покупка и пробный период за деньги ---------- */
// цена со скидкой: процент обрезается до 0–100, итог — целые рубли и не меньше 1 ₽ (отрицательной или нулевой суммы не бывает)
const discounted = (price, percent) => Math.max(1, Math.round(Number(price) * (100 - Math.min(100, Math.max(0, Number(percent) || 0))) / 100));
// оплаченные покупки пользователя: подтверждённые и возвращённые (возврат не даёт права на «первую покупку» снова)
const paidPays = (uid) => (uid ? store.payments.byUid(uid).filter((x) => x.status === 'CONFIRMED' || x.status === 'CHARGEBACKED') : []);
// ---------- пробные тарифы: 3 дня каждого платного тарифа за небольшую плату (по умолчанию Pro 99 ₽, Max 249 ₽, Ultra 990 ₽) ----------
// Настройки: env (growth.conf().trials: TRIAL_PLANS, TRIAL_PRICE_<ПЛАН>, TRIAL_DAYS_<ПЛАН>; прежние TRIAL_PRICE/TRIAL_DAYS/TRIAL_PLAN — для основного тарифа)
// и переопределения из панели (cfg().trials[план] = {on, price, days}) — панель главнее env. TRIAL_OFFER=0 выключает всё.
// Ключи «один раз на человека»: у основного тарифа (Pro) — прежние trial:uid:/trial:email:, у остальных — trial:<план>:uid:/trial:<план>:email:
const trialKeys = (u, plan) => {
  const ne = growth.normEmail(u.email), p = plan === growth.conf().trial.plan ? '' : plan + ':';
  return ['trial:' + p + 'uid:' + u.id, ...(ne ? ['trial:' + p + 'email:' + growth.hashKey('email', ne)] : [])];
};
const trialTaken = (u, plan = growth.conf().trial.plan) => !!u && ((plan === growth.conf().trial.plan && !!u.trialUsed) || !!(u.trialsUsed && u.trialsUsed[plan]) || trialKeys(u, plan).some((k) => store.db.prepare('SELECT 1 x FROM offers WHERE k = ?').get(k)));
function markTrial(u, plan) { if (!u) return; const now = Date.now(); for (const k of trialKeys(u, plan)) store.db.prepare('INSERT OR IGNORE INTO offers (k, uid, at) VALUES (?, ?, ?)').run(k, u.id, now); }
// предельная цена пробного тарифа с кредитами по себестоимости кредита: клиент тратит все кредиты каждые сутки по Москве, а пробный период захватывает на одни сутки больше, чем дней (стартовал днём — 4 даты при 3 днях)
const trialWorstCost = (p, days, creditCost) => (p && p.ultra && p.credits > 0 && creditCost > 0 ? Math.ceil((Math.ceil(days) + 1) * p.credits * creditCost) : 0);
// пробные тарифы по настройкам: { planId: {plan, name, price, days, tier} }; c — конфиг тарифов (по умолчанию сохранённый)
function trialCfg(c = cfg()) {
  const g = growth.conf().trials, ov = c.trials || {}, out = {}; if (!g.on) return out;
  for (const id of new Set([...Object.keys(g.plans), ...Object.keys(ov).filter((k) => ov[k] && ov[k].on === true)])) {
    const p = c.plans.find((x) => x.id === id && x.price > 0 && x.days > 0), e = g.plans[id] || { price: 0, days: 3 }, o = ov[id] || {};
    if (!p || o.on === false) continue;
    const days = Math.min(30, Math.max(1, Math.round(Number(o.days)) || e.days || 3));
    const price = Math.round(Number(o.price)) > 0 ? Math.round(Number(o.price)) : e.price > 0 ? e.price : Math.max(1, Math.round(p.price / p.days * days * 2.5)); // нет цены — 2,5 × пропорциональная
    out[id] = { plan: id, name: p.name, price, days, tier: p.tier || 0 };
  }
  return out;
}
// пробный тариф доступен вообще (не лично): тариф с Ultra-кредитами — только при включённых кредитах и цене не ниже худшего случая по себестоимости
function trialOpen(t, c = cfg()) {
  const p = c.plans.find((x) => x.id === t.plan); if (!p) return false;
  if (p.ultra && p.credits > 0 && !({ ...ULTRA_DEF, ...(c.ultra || {}) }).on) return false;
  return !(t.price < trialWorstCost(p, t.days, Number((c.ultra || {}).cost) || 0));
}
// тариф (или выше), за который человек уже платил: пробный период ему не нужен; сброс, пакеты и кредиты в счёт не идут
const paidTier = (plan) => { const c = cfg(), p = c.plans.find((x) => x.id === (plan === teams.PLAN ? 'pro' : plan)); return p ? p.tier || 0 : -1; };
function trialFor(u, t) {
  if (!u || !u.id || !t || !trialOpen(t) || trialTaken(u, t.plan)) return false;
  if (paidPays(u.id).some((x) => paidTier(x.plan) >= t.tier)) return false;
  return (planOf(u).tier || 0) <= t.tier; // уже действует тариф выше — «пробный» был бы понижением
}
const trialPub = (t) => ({ price: t.price, days: t.days, plan: t.plan, name: t.name });
const trialList = (u) => Object.values(trialCfg()).filter((t) => (u ? trialFor(u, t) : trialOpen(t))).sort((a, b) => a.tier - b.tier).map(trialPub);
// оплата, которая расходует «первую покупку»: период тарифа или команды; сброс, пакет, кредиты и (по настройке) пробный период — нет
const fullPay = (x, g = growth.conf()) => planPay(x) && !(g.first.afterTrial && x.offer === 'trial');
// Одноразовое предложение проверяется ещё раз в момент оплаты: счетов с ним можно выставить несколько, а сработать оно должно один раз.
// Возвращает, какое предложение к оплате этого счёта уже израсходовано: 'trial' | 'first' | 'promo' | null.
function offerLost(it) {
  const u = store.users.get(it.uid); if (!u) return null;
  // те же условия, что при выставлении счёта (trialFor): пробный этого тарифа уже был либо уже оплачен этот тариф или выше
  if (it.offer === 'trial') { const tier = paidTier(it.plan); return trialTaken(u, it.plan) || paidPays(it.uid).some((x) => x.id !== it.id && paidTier(x.plan) >= tier) ? 'trial' : null; }
  if (it.discount && it.discount.kind === 'first') return paidPays(it.uid).some((x) => x.id !== it.id && fullPay(x)) ? 'first' : null;
  if (it.promo) { const pr = loadPromos().find((x) => x.code === it.promo); return pr && ((pr.by || []).includes(it.uid) || (pr.max && (pr.used || 0) >= pr.max)) ? 'promo' : null; }
  return null;
}
// что предложить этому пользователю: { trial: {price, days, plan, name} | null (основной — Pro, как раньше), trials: [те же поля — по всем доступным тарифам], first: {percent, plans} | null }
function offers(u) {
  const g = growth.conf(), c = cfg(), pays = u && u.id ? paidPays(u.id) : [];
  const buyable = (id) => c.plans.find((p) => p.id === id && p.price > 0 && p.days > 0 && planOpen(p, c));
  const trials = u && u.id ? trialList(u) : [], trial = trials.find((t) => t.plan === g.trial.plan) || null;
  // «первая покупка» — первый оплаченный период Pro/Max; сброс лимита и (по умолчанию) пробный период её не расходуют
  const full = pays.filter((x) => fullPay(x, g));
  const plans = g.first.plans.filter((id) => buyable(id));
  const first = u && g.first.percent > 0 && plans.length && !full.length ? { percent: g.first.percent, plans } : null;
  return { trial, trials, first };
}
// для лендинга (без входа): какие предложения включены
function publicOffers() {
  const g = growth.conf(), c = cfg(), buyable = (id) => c.plans.find((p) => p.id === id && p.price > 0 && p.days > 0 && planOpen(p, c)), plans = g.first.plans.filter((id) => buyable(id));
  const trials = trialList(null);
  return { trial: trials.find((t) => t.plan === g.trial.plan) || null, trials, first: g.first.percent > 0 && plans.length ? { percent: g.first.percent, plans } : null };
}


/* ---------- реферальная программа ---------- */
// По умолчанию (REF_MODE=pay): по ссылке /r/<код> приглашённый получает +REF_BONUS_DAYS дней тарифа REF_BONUS_PLAN,
// и пригласивший — столько же, но только после ПЕРВОЙ оплаты приглашённого; у пригласившего не больше REF_MAX таких бонусов.
// Дни начисляются тем же extend(), что и оплата. REF_MODE=legacy — прежние правила (ступени и +50 сообщений), код ниже не менялся.
const refOn = () => US.loadSettings().referrals !== false;
const refLegacy = () => growth.conf().ref.mode === 'legacy';
// код для ссылки: случайный (не ID пользователя), создаётся один раз
function refCode(u) {
  const get = () => store.db.prepare('SELECT code FROM refcodes WHERE uid = ?').get(u.id);
  let row = get(); if (row) return row.code;
  for (let i = 0; i < 5; i++) {
    try { const code = growth.token(10); store.db.prepare('INSERT INTO refcodes (code, uid, at) VALUES (?, ?, ?)').run(code, u.id, Date.now()); return code; }
    catch { row = get(); if (row) return row.code; } // совпадение кода (почти невозможно) или параллельный запрос уже создал
  }
  return u.id;
}
// чей код; старые ссылки /r/<ID пользователя> продолжают работать
function refOwner(code) {
  const row = store.db.prepare('SELECT uid FROM refcodes WHERE code = ?').get(code); if (row) return row.uid;
  return /^[a-f0-9]{12}$/.test(code) && store.users.get(code) ? code : null;
}
// бонус не понижает тариф: у того, кто уже на тарифе выше (Max), продлевается его тариф
// на тарифе со strict (Ultra) бонусных дней нет — null; тариф при этом не меняется
function refPlanFor(x, want) {
  const c = cfg(), wp = c.plans.find((p) => p.id === want) || c.plans.find((p) => p.id === 'pro'); if (!wp) return null;
  const cur = planOf(x); if (cur && cur.until && cur.strict) return null; return cur && cur.until && cur.id !== wp.id && cur.tier > wp.tier ? cur.id : wp.id;
}
const planName = (id) => (cfg().plans.find((p) => p.id === id) || { name: 'Pro' }).name;
const NEW_ONLY = 'Приглашение действует только для новых пользователей до первой оплаты';
function refBind(u, code, ip, fp) {
  if (!refOn()) return { code: 403, error: 'Реферальная программа сейчас выключена' };
  if (refLegacy()) return refBindLegacy(u, code, ip, fp);
  const g = growth.conf().ref;
  code = String(code || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  if (code.length < 8) return { code: 400, error: 'Некорректная ссылка приглашения' };
  const owner = refOwner(code);
  if (owner === u.id) return { code: 400, error: 'Нельзя пригласить самого себя' };
  const ref = owner ? store.users.get(owner) : null;
  if (!ref || ref.banned) return { code: 404, error: 'Ссылка приглашения недействительна' };
  if (store.db.prepare('SELECT 1 x FROM referrals WHERE id = ?').get(u.id)) return { code: 409, error: 'У вас уже есть пригласивший' };
  if (paidPays(u.id).length) return { code: 409, error: NEW_ONLY };
  if (g.bindHours > 0 && !(Date.parse(u.created || '') > Date.now() - g.bindHours * 3600e3)) return { code: 409, error: NEW_ONLY };
  const d30 = Date.now() - 30 * DAY;
  if (ip && store.db.prepare('SELECT 1 x FROM referrals WHERE ip = ? AND at > ?').get(ip, d30)) return { code: 409, error: 'С этого адреса уже был приглашён другой человек' };
  if (fp && store.db.prepare('SELECT 1 x FROM referrals WHERE fp = ? AND at > ?').get(fp, d30)) return { code: 409, error: 'С этого устройства уже был приглашён другой человек' };
  store.db.prepare("INSERT OR IGNORE INTO referrals (id, ref, ip, fp, status, msg, paid, at) VALUES (?, ?, ?, ?, 'pending', 0, 0, ?)").run(u.id, owner, ip || '', fp || '', Date.now());
  if (g.signupMsgs > 0) refMergeBonus(u.id, g.signupMsgs, 3);
  console.log('ref: ' + u.id + ' -> ' + owner + ' (привязка, бонус после первой оплаты)');
  return { code: 200, ok: true, days: g.days, plan: planName(g.plan), bonus: g.signupMsgs };
}
// Первая подтверждённая оплата приглашённого (вызывается из apply внутри той же транзакции): дни обоим.
// Начисление идёт отдельной частью транзакции: ошибка отменяет его целиком (никаких «другу начислили, пригласившему нет»),
// оплата при этом проходит, а платёж помечается refPending и начисление повторяется (refRetry) — молча оно не пропадает.
const REF_TRIES = 12;
const refQueue = (id, on) => { const l = store.kv.get('ref:pending', []).filter((x) => x !== id); if (on) l.push(id); if (l.length) store.kv.set('ref:pending', l); else store.kv.del('ref:pending'); };
function refPayHook(u, pay) {
  if (!refOn() || !u) return;
  try { store.sp(() => (refLegacy() ? refPayHookLegacy(u) : refPay(u, pay))); if (pay) delete pay.refPending; }
  catch (e) {
    console.log('refPayHook:', e.message);
    if (pay && pay.id) { pay.refPending = { at: Date.now(), n: ((pay.refPending || {}).n || 0) + 1, err: String(e.message).slice(0, 200) }; refQueue(pay.id, true); }
  }
}
function refPay(u, pay) {
  if (pay && !planPay(pay)) return; // сброс лимита и пакет сообщений — не покупка тарифа
  const g = growth.conf().ref;
  if (pay && pay.offer === 'trial' && !g.trialCounts) return; // REF_TRIAL_COUNTS=0: ждём первой полной оплаты
  const row = store.db.prepare('SELECT ref, at, paid, status FROM referrals WHERE id = ?').get(u.id);
  if (!row || row.paid || row.status === 'rejected') return;
  if (((pay && pay.paid) || Date.now()) - row.at > g.payDays * DAY) return; // срок считается по моменту оплаты: повтор начисления (refRetry) может прийти позже
  const out = { at: Date.now() }, src = pay && pay.id ? pay.id : 'ref:' + u.id; // источник бонусных дней — платёж: при возврате они отзываются вместе с ним
  if (g.days > 0) {
    const fp = refPlanFor(u, g.plan);
    if (fp) { updateUser(u.id, (x) => extend(x, fp, g.days, { src, kind: 'bonus' })); out.invitee = { uid: u.id, plan: fp, days: g.days }; }
    const inv = store.users.get(row.ref), n = store.db.prepare('SELECT COUNT(*) c FROM referrals WHERE ref = ? AND bonus > 0').get(row.ref).c;
    if (inv && !inv.banned && n < g.max) { const rp = refPlanFor(inv, g.plan); if (rp) { updateUser(row.ref, (x) => extend(x, rp, g.days, { src, kind: 'bonus' })); out.inviter = { uid: row.ref, plan: rp, days: g.days }; } }
  }
  store.db.prepare("UPDATE referrals SET paid = 1, status = 'active', bonus = ? WHERE id = ?").run(out.inviter ? out.inviter.days : 0, u.id);
  if (pay) pay.ref = out; // для отката при возврате платежа
  console.log('ref: первая оплата ' + u.id + ' -> +' + g.days + ' дн. обоим' + (out.inviter ? '' : ' (пригласившему — нет: потолок ' + g.max + ' или тариф без бонусов)') + (out.invitee ? '' : ' (приглашённому — нет: тариф без бонусов)') + ' (' + row.ref + ')');
}
// повтор начислений, которые не прошли при оплате; после REF_TRIES попыток платёж остаётся с пометкой refPending — для разбора вручную
function refRetry() {
  let done = 0;
  for (const id of store.kv.get('ref:pending', [])) {
    try {
      store.tx(() => {
        const it = store.payments.get(id), u = it && store.users.get(it.uid);
        if (!it || !u || !it.refPending || it.status !== 'CONFIRMED' || !it.applied) return refQueue(id, false);
        if (it.refPending.n >= REF_TRIES) { console.log(`refRetry: ${id} — начисление за приглашение не прошло за ${REF_TRIES} попыток, нужна ручная проверка (${it.refPending.err})`); return refQueue(id, false); }
        refPayHook(u, it); store.payments.put(it);
        if (!it.refPending) { refQueue(id, false); done++; }
      });
    } catch (e) { console.log('refRetry:', e.message); }
  }
  return done;
}
function refInfo(u) {
  if (refLegacy()) return refInfoLegacy(u);
  const g = growth.conf().ref;
  let total = 0, pending = 0, active = 0, paid = 0, rewarded = 0;
  try {
    const r = store.db.prepare("SELECT COUNT(*) total, COALESCE(SUM(status = 'pending'), 0) pending, COALESCE(SUM(status = 'active'), 0) active, COALESCE(SUM(paid), 0) paid, COALESCE(SUM(bonus > 0), 0) rewarded FROM referrals WHERE ref = ?").get(u.id);
    ({ total, pending, active, paid, rewarded } = r);
  } catch {}
  let code = u.id; try { code = refCode(u); } catch {}
  return { on: refOn(), mode: 'pay', code, total, invited: total, pending, active, paid, rewarded, max: g.max, left: Math.max(0, g.max - rewarded), days: g.days, plan: planName(g.plan), trial: g.trialCounts, tiers: [], next: null,
    bonus: u.refBonus && u.refBonus.n > 0 && u.refBonus.until > Date.now() ? { n: u.refBonus.n, until: u.refBonus.until } : null };
}
// правила для панели
const refRules = () => { const g = growth.conf().ref; return { mode: g.mode, days: g.days, plan: planName(g.plan), max: g.max, bindHours: g.bindHours, payDays: g.payDays, trial: g.trialCounts }; };

/* ---------- прежние правила (REF_MODE=legacy) ---------- */
const REF_TIERS = [ { n: 3, kind: 'bonus' }, { n: 10, plan: 'pro', days: 7 }, { n: 25, plan: 'pro', days: 14 }, { n: 50, plan: 'pro', days: 30 }, { n: 100, plan: 'max', days: 30 } ];
function refMergeBonus(uid, n, days) {
  const now = Date.now();
  store.users.update(uid, (x) => {
    const rb = x.refBonus && x.refBonus.n > 0 && x.refBonus.until > now ? x.refBonus : null;
    if (rb) { rb.n += n; rb.until = Math.max(rb.until, now + days * DAY); } else x.refBonus = { n, until: now + days * DAY };
    return x;
  });
}
function refBindLegacy(u, code, ip, fp) {
  code = String(code || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  if (code.length < 8) return { code: 400, error: 'Некорректная ссылка приглашения' };
  if (code === u.id) return { code: 400, error: 'Нельзя пригласить самого себя' };
  const ref = store.users.get(code);
  if (!ref) return { code: 404, error: 'Такого пользователя нет' };
  if (store.db.prepare('SELECT 1 x FROM referrals WHERE id = ?').get(u.id)) return { code: 409, error: 'У вас уже есть пригласивший' };
  const d30 = Date.now() - 30 * 864e5;
  if (ip && store.db.prepare('SELECT 1 x FROM referrals WHERE ip = ? AND at > ?').get(ip, d30)) return { code: 409, error: 'С этого адреса уже был приглашён другой человек' };
  if (fp && store.db.prepare('SELECT 1 x FROM referrals WHERE fp = ? AND at > ?').get(fp, d30)) return { code: 409, error: 'С этого устройства уже был приглашён другой человек' };
  store.db.prepare("INSERT OR IGNORE INTO referrals (id, ref, ip, fp, status, msg, paid, at) VALUES (?, ?, ?, ?, 'pending', 0, 0, ?)").run(u.id, code, ip || '', fp || '', Date.now());
  refMergeBonus(u.id, 50, 3);
  console.log('ref: ' + u.id + ' -> ' + code + ' (привязка)');
  return { code: 200, ok: true, bonus: 50, by: ref.login };
}
function refMsgTick(uid) {
  if (!refLegacy()) return; // по умолчанию активность приглашённого засчитывается только оплатой
  try {
    const row = store.db.prepare("SELECT ref, status FROM referrals WHERE id = ?").get(uid);
    if (!row || row.status !== 'pending') return;
    const c = store.db.prepare('SELECT COALESCE(msg, 0) + 1 c FROM referrals WHERE id = ?').get(uid).c;
    store.db.prepare('UPDATE referrals SET msg = ? WHERE id = ?').run(c, uid);
    if (c >= 3) {
      store.db.prepare("UPDATE referrals SET status = 'active' WHERE id = ? AND status = 'pending'").run(uid);
      console.log('ref: ' + uid + ' активен -> ' + row.ref);
      refTierCheck(row.ref);
    }
  } catch (e) { console.log('refMsgTick:', e.message); }
}
function refTierCheck(inviterUid) {
  if (!refOn() || !refLegacy()) return;
  const active = store.db.prepare("SELECT COUNT(*) c FROM referrals WHERE ref = ? AND status = 'active'").get(inviterUid).c;
  const u = store.users.get(inviterUid); if (!u) return;
  const done = Array.isArray(u.refTiers) ? u.refTiers.slice() : [];
  let granted = false;
  for (const t of REF_TIERS) {
    if (active >= t.n && !done.includes(t.n)) {
      done.push(t.n); granted = true;
      if (t.kind === 'bonus') refMergeBonus(inviterUid, 50, 7);
      else if (planOf(u).strict) continue; // Ultra: без бонусных дней (иначе дни Pro пересчитали бы Ultra в Pro)
      else {
        const plan = t.plan === 'max' ? 'max' : (planOf(u).id === 'max' ? 'max' : 'pro');
        Object.assign(u, updateUser(inviterUid, (x) => extend(x, plan, t.days, { src: 'reftier:' + inviterUid + ':' + t.n, kind: 'bonus' }))); // следующий порог считается уже от нового тарифа
        console.log('ref: ' + inviterUid + ' порог ' + t.n + ' -> ' + plan + ' на ' + t.days + ' дн.');
      }
    }
  }
  if (granted) store.users.update(inviterUid, (x) => { x.refTiers = done; return x; });
}
function refPayHookLegacy(u) { // ошибки ловит refPayHook: начисление отменяется целиком и повторяется
  if (!u) return;
  const row = store.db.prepare('SELECT ref, at, paid FROM referrals WHERE id = ?').get(u.id);
  if (!row || row.paid) return;
  if (Date.now() - row.at > 365 * 864e5) return;
  store.db.prepare('UPDATE referrals SET paid = 1 WHERE id = ?').run(u.id);
  const r = store.users.get(row.ref); if (!r || planOf(r).strict) return; // Ultra: без бонусных дней
  const plan = planOf(r).id === 'max' ? 'max' : 'pro';
  updateUser(row.ref, (x) => extend(x, plan, 2, { src: 'refpay:' + u.id, kind: 'bonus' }));
  console.log('ref: платёж ' + u.id + ' -> +2 дн. ' + plan + ' (' + row.ref + ')');
}
function refInfoLegacy(u) {
  let active = 0, pending = 0, total = 0;
  try {
    for (const r of store.db.prepare('SELECT status, COUNT(*) c FROM referrals WHERE ref = ? GROUP BY status').all(u.id)) { total += r.c; if (r.status === 'active') active = r.c; else if (r.status === 'pending') pending = r.c; }
  } catch {}
  const tiers = REF_TIERS.map((t) => ({ n: t.n, done: (u.refTiers || []).includes(t.n) }));
  const next = tiers.find((t) => !t.done) || null;
  return { on: refOn(), code: u.id, active, pending, total, tiers, next: next ? { n: next.n, have: active, need: next.n - active } : null,
    bonus: u.refBonus && u.refBonus.n > 0 && u.refBonus.until > Date.now() ? { n: u.refBonus.n, until: u.refBonus.until } : null };
}

/* ---------- Robokassa: зарубежные карты Visa/MC/UnionPay ---------- */
function rbKeys() { return (US.loadSettings() || {}).robokassa || {}; }
// ROBOKASSA=off — способ оплаты не предлагается, уведомления не принимаются (ответ 503), даже если ключи сохранены в настройках
const rbOff = () => /^(off|0|false|no)$/i.test(String(process.env.ROBOKASSA || '').trim());
function rbReady() { const k = rbKeys(); return !rbOff() && !!(k.login && k.pass1 && k.pass2); }
async function createRobokassa(u, p, amount, promo, origin, id, extra = {}) {
  const k = rbKeys();
  const outSum = (Math.round(amount * 100) / 100).toFixed(2).replace('.', ',');
  const sig = crypto.createHash('md5').update(k.login + ':' + outSum + ':' + k.pass1).digest('hex');
  const params = new URLSearchParams({ MerchantLogin: k.login, OutSum: outSum, InvId: id, Description: payDesc(p, u.login), SignatureProvider: sig, Culture: 'ru-RU', Encoding: 'utf-8', IsReturn: 'true', ReturnUrl: origin + '/chat?pay=ok&order=' + id, IsAccount: 'false' });
  if (u.email) params.set('ReceiptEmail', u.email);
  const r = await fetch('https://auth.robokassa.ru/IncomingGate/Payment/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(), signal: AbortSignal.timeout(20000) });
  const html = await r.text();
  const m = html.match(/<form[^>]*>[\s\S]*?<\/form>/i);
  if (!r.ok || !m) throw new Error('Robokassa не принял платёж (HTTP ' + r.status + ') — попробуйте СБП или крипту');
  store.payments.put({ id, tx: id, uid: u.id, login: u.login, plan: p.id, days: p.days, amount, promo, ...extra, status: 'PENDING', provider: 'robokassa', created: Date.now() });
  return { form: m[0], order: id };
}
// вебхук Robokassa (ResultUrl): параметры формы; подпись = MD5(MerchantLogin:OutSum:OperationId:Password2).
// InvId и Result в подпись не входят, поэтому уведомление принимается, только если подписанные поля сходятся с заказом:
// сумма OutSum равна сумме заказа, а операция OperationId ещё не привязана к другому заказу. Оплаченный заказ уведомлением не отменяется.
// Остаётся незакрытым: Result не подписан, а у заказов, оплаченных до появления реестра, операция не записана. До сверки с документацией
// провайдера способ оплаты можно выключить целиком: ROBOKASSA=off.
const rbSum = (v) => { const n = Number(String(v == null ? '' : v).trim().replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
const rbReject = (why, InvId) => { console.log(`Robokassa: уведомление отклонено (${why}), заказ ${String(InvId || '').slice(0, 64)}`); return { code: 400, ok: false, body: 'FAIL', rejected: why }; };
function rbCallback(b) {
  const k = rbKeys(); if (rbOff() || !k.pass2) return { code: 503, ok: false };
  const { MerchantLogin, OutSum, InvId, OperationId, Result, SignatureProvider } = b || {};
  const exp = crypto.createHash('md5').update([MerchantLogin, OutSum, OperationId, k.pass2].join(':')).digest();
  const got = Buffer.from(String(SignatureProvider || '').trim().toLowerCase(), 'hex');
  if (got.length !== exp.length || !crypto.timingSafeEqual(got, exp)) return { code: 401, ok: false };
  if (k.login && String(MerchantLogin || '') !== String(k.login)) return rbReject('чужой магазин', InvId);
  const pay = store.payments.get(String(InvId || ''));
  if (!pay) return { code: 200, ok: true, body: 'OK', ignored: 'no order' };
  if (pay.provider !== 'robokassa') return rbReject('заказ другого способа оплаты', InvId);
  if (!OperationId) return rbReject('нет номера операции', InvId);
  if (rbSum(OutSum) !== Math.round(Number(pay.amount) * 100)) return rbReject('сумма не совпадает с заказом', InvId);
  // реестр операций: запись «операция → заказ» создаётся один раз и не меняется, даже когда заказ оплачивают повторно другой операцией
  const op = String(OperationId), opKey = 'rb:op:' + op.slice(0, 200), bound = store.kv.get(opKey);
  const owner = bound ? bound.id : (store.payments.byTx(op, 'robokassa') || {}).id;
  if (owner && owner !== pay.id) return rbReject('операция уже привязана к другому заказу', InvId);
  if (!bound) store.kv.set(opKey, { id: pay.id, at: Date.now() });
  const ns = { success: 'CONFIRMED', fail: 'CANCELED', cancel: 'CANCELED' }[String(Result || '').toLowerCase()];
  if (!ns) return { code: 200, ok: true, body: 'FAIL' };
  if (pay.status === 'CONFIRMED' || pay.status === 'CHARGEBACKED') return { code: 200, ok: true, body: pay.status === 'CONFIRMED' && ns === 'CONFIRMED' ? 'OK' : 'FAIL', ignored: 'final status' };
  if (pay.tx !== op) { pay.tx = op; store.payments.put(pay); } // номер последней операции — для панели и поиска платежа
  apply(pay, ns, { verified: true }); // у Robokassa нет запроса статуса: уведомление подписано и привязано к операции — оно и есть подтверждение
  return { code: 200, ok: true, body: ns === 'CONFIRMED' ? 'OK' : 'FAIL' };
}
/* ---------- промокоды ---------- */
const loadPromos = () => store.kv.get('promos', []);
const savePromos = (x) => store.kv.set('promos', x);
function findPromo(code, uid) {
  const k = String(code || '').trim().toUpperCase(); if (!k) return { error: 'Введите промокод' };
  const pr = loadPromos().find((x) => x.code === k);
  if (!pr || pr.paused || (pr.until && pr.until < Date.now())) return { error: 'Промокод не найден или истёк' };
  if (pr.max && pr.used >= pr.max) return { error: 'Промокод уже использован максимальное число раз' };
  if ((pr.by || []).includes(uid)) return { error: 'Вы уже использовали этот промокод' };
  const pp = pr.plan && cfg().plans.find((x) => x.id === pr.plan); if (pp && !planOpen(pp)) return { error: `Тариф ${pp.name} сейчас недоступен` }; // тариф закрыт от продажи (Ultra выключен)
  return { promo: pr };
}
function usePromo(code, uid) { const list = loadPromos(), pr = list.find((x) => x.code === code); if (pr) { pr.used = (pr.used || 0) + 1; pr.by = [...(pr.by || []), uid]; savePromos(list); } }
// подарочный промокод — сразу даёт тариф; скидочный — возвращает процент для оплаты
function redeem(u, code) {
  const r = findPromo(code, u.id); if (r.error) return r;
  const pr = r.promo;
  // подарок и расход кода — одной транзакцией: либо дни выданы и код отмечен, либо не изменилось ничего
  if (pr.kind === 'gift') return store.tx(() => { const nu = updateUser(u.id, (x) => extend(x, pr.plan, pr.days, { src: 'promo:' + pr.code + ':' + u.id })); if (!nu) throw new Error('Пользователь не найден'); usePromo(pr.code, u.id); return { gift: true, plan: pr.plan, days: pr.days, until: nu.until }; });
  return { discount: pr.percent, plan: pr.plan || null, code: pr.code };
}

/* ---------- Platega ---------- */
function keys() {
  const st = US.loadSettings().platega || {};
  return { id: process.env.PLATEGA_MERCHANT_ID || st.merchant || '', secret: process.env.PLATEGA_SECRET || st.secret || '', env: !!process.env.PLATEGA_MERCHANT_ID };
}
const payReady = () => { const k = keys(); return !!(k.id && k.secret); };
async function pg(method, p, body) {
  const k = keys();
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', 'X-MerchantId': k.id, 'X-Secret': k.secret }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'Platega: неверный Merchant ID или секрет' : `Platega ${r.status}: ${String(j.message || j.error || t).slice(0, 200)}`);
  return j;
}
const loadPays = (n) => (n ? store.payments.recent(n) : store.payments.all()); // история платежей не обрезается

function pickMethod(method) {
  const avail = { card: payReady() || coinsoReady(), robokassa: rbReady(), cispay: cisReady(), crypto: cryptoReady(), coinso: coinsoReady() };
  if (!method) method = avail.card ? 'card' : avail.robokassa ? 'robokassa' : avail.cispay ? 'cispay' : avail.crypto ? 'crypto' : 'coinso';
  if (!avail[method]) throw new Error(Object.values(avail).some(Boolean) ? 'Этот способ оплаты сейчас недоступен — выберите другой' : 'Оплата пока не подключена. Напишите нам в Telegram.');
  return method;
}
async function create(u, planId, promoCode, origin, ip, method, opts) {
  method = pickMethod(method);
  if (planId === RESET.id) { // покупка пакета сбросов: на баланс, без срока
    if (promoCode) throw new Error('Промокоды на сброс лимита не действуют');
    method = pickMethod(method);
    const q = resetQuote(opts && opts.qty != null ? opts.qty : 1), p = { id: RESET.id, name: `Сбросы лимита × ${q.qty}`, price: q.amount, days: 0 };
    const extra = { qty: q.qty, now: q.qty === 1 ? true : !!(opts && opts.now), reset: true }; // один сброс — сразу после оплаты (как раньше); пакет — по флагу из окна покупки
    if (q.pct) extra.discount = { kind: 'pack', percent: q.pct }, extra.price = q.full;
    return dispatch(u, p, q.amount, null, origin, ip, method, extra);
  }
  if (planId === 'credits') { // Ultra-кредиты: от 1 до maxBuy, сумма = ceil(кол-во × цена), без промокодов
    if (promoCode) throw new Error('Промокоды на Ultra-кредиты не действуют');
    const U = ultraCfg(); if (!U.on) throw new Error('Ultra-кредиты сейчас недоступны');
    const qty = Number(opts && opts.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > U.maxBuy) throw new Error('Количество кредитов: от 1 до ' + U.maxBuy);
    const amount = Math.max(1, Math.ceil(qty * U.price - 1e-9)), min = Number((U.minByMethod || {})[method]) || 0;
    if (amount < min) throw new Error('Этот способ оплаты принимает от ' + min + ' ₽ — выберите другой способ или больше кредитов');
    return dispatch(u, { id: 'credits', name: 'Ultra-кредиты × ' + qty, price: amount, days: 0 }, amount, null, origin, ip, method, { qty });
  }
  if (planId === PACK.id) { // пакет сообщений: сверх дневного лимита, сгорает через packDays дней
    if (promoCode) throw new Error('Промокоды на пакеты сообщений не действуют');
    const q = packQuote(opts && opts.n), days = Math.max(1, Math.round(cfg().packDays) || 30);
    if (packList(store.users.get(u.id) || u).length >= PACK_MAX) throw new Error(`У вас уже ${PACK_MAX} действующих пакетов сообщений. Новый можно купить, когда один из них закончится`);
    return dispatch(u, { id: PACK.id, name: `Пакет ${q.n} сообщений`, price: q.price, days: 0 }, q.price, null, origin, ip, method, { pack: { n: q.n, days } });
  }
  const tm = /^trial(?::([a-z0-9_-]{1,20}))?$/.exec(planId), isTrial = !!tm; // 'trial' — основной (Pro), 'trial:max' / 'trial:ultra' (или opts.trialPlan) — пробный период этого тарифа
  let p = isTrial ? null : cfg().plans.find((x) => x.id === planId), extra = {};
  if (p && !planOpen(p)) throw new Error(`Тариф ${p.name} сейчас недоступен`); // закрыт от продажи (Ultra выключен); промокод на закрытый тариф — то же в redeem
  if (isTrial) { // «Pro на 3 дня за 99 ₽», «Max на 3 дня за 249 ₽»: один раз на тариф, в платеже — обычный тариф и дни, offer: 'trial'
    if (promoCode) throw new Error('Промокоды на пробный период не действуют');
    const want = tm[1] || String((opts && opts.trialPlan) || '').toLowerCase() || growth.conf().trial.plan;
    const o = offers(u).trials.find((x) => x.plan === want), t = trialCfg()[want], wp = cfg().plans.find((x) => x.id === want);
    if (wp && !planOpen(wp)) throw new Error(`Тариф ${wp.name} сейчас недоступен`); // не «доступен один раз»: дело не в человеке, а в выключенном Ultra
    if (!o) throw new Error('Пробный период за ' + (t ? t.price : growth.conf().trial.price) + ' ₽' + (t ? ' (' + t.name + ')' : '') + ' доступен один раз — до первой оплаты этого тарифа (или выше)');
    p = { id: o.plan, name: o.name + ' (пробный период)', price: o.price, days: o.days }; extra = { offer: 'trial' };
  }
  if (!p || !(p.price > 0) || !(p.days > 0)) throw new Error('Этот тариф нельзя купить');
  // оплата на несколько месяцев: цена и дни умножаются на число сроков, скидка за срок — из настроек тарифов
  const months = Math.round(Number(opts && opts.months)) || 1; let per = null;
  if (months !== 1) {
    if (isTrial) throw new Error('Этот платёж оплачивается только на один срок');
    per = periods().find((x) => x.months === months); if (!per) throw new Error('Такого срока оплаты нет — выберите другой');
    p = { ...p, price: p.price * months, days: p.days * months, months };
    if (per.off) extra = { price: p.price, discount: { kind: 'period', percent: per.off } };
  }
  let amount = per ? discounted(p.price, per.off) : p.price, promo = null;
  if (promoCode) {
    const r = findPromo(promoCode, u.id); if (r.error) throw new Error(r.error);
    if (r.promo.kind !== 'discount') throw new Error('Это подарочный промокод — активируйте его в поле «Промокод»');
    if (r.promo.plan && r.promo.plan !== planId) throw new Error('Промокод действует на другой тариф');
    if (!r.promo.plan && p.strict) throw new Error('На тариф ' + p.name + ' действуют только промокоды, выпущенные именно для него');
    // скидки не суммируются: промокод применяется (и расходуется), только если с ним не дороже скидки за срок
    const pa = discounted(p.price, r.promo.percent);
    // неоплаченные счета других людей с этим кодом занимают его активации на HOLD_MS: иначе скидку увидят больше людей, чем её получат
    if (pa <= amount && r.promo.max && (r.promo.used || 0) + promoHolders(r.promo.code, u.id) >= r.promo.max) throw new Error('По этому промокоду уже выставлены счета на все оставшиеся активации. Попробуйте позже или оплатите без промокода');
    if (pa <= amount) { promo = r.promo.code; amount = pa; extra = { price: p.price, discount: { kind: 'promo', percent: r.promo.percent } }; }
  }
  // скидка на первую покупку не суммируется с промокодом: берётся меньшая цена (при равенстве — промокод)
  const first = !isTrial ? offers(u).first : null;
  if (first && first.plans.includes(p.id)) {
    const fa = discounted(p.price, first.percent);
    if (fa < amount) { amount = fa; promo = null; extra = { price: p.price, discount: { kind: 'first', percent: first.percent } }; }
  }
  if (per) extra.months = months;
  return dispatch(u, p, amount, promo, origin, ip, method, extra);
}
const HOLD_MS = 60 * 60e3;  // неоплаченный счёт занимает активацию промокода и идёт в предел счетов
const REUSE_MS = 10 * 60e3; // повторный запрос того же счёта в этот срок возвращает прежнюю ссылку
const PEND_MAX = 10;        // неоплаченных счетов одного человека за HOLD_MS
// Выставить счёт. Тот же запрос (товар, сумма, способ) в течение REUSE_MS не плодит счета: возвращается прежняя ссылка,
// если провайдер подтверждает, что счёт ещё ждёт оплаты. Больше PEND_MAX неоплаченных счетов за час не выставляется.
// Счёт появляется в базе только после ответа провайдера, поэтому на время создания он числится в making: одновременный такой же
// запрос ждёт этот же счёт, а не создаёт второй; создаваемые счета идут в предел PEND_MAX и занимают активацию промокода.
const making = new Map(); // «пользователь:подпись» → { uid, promo, add: создаётся новый счёт (а не перепроверяется прежний), job }
const makingOf = (uid) => [...making.values()].filter((x) => x.uid === uid && x.add).length;
// сколько других людей держат активацию промокода: неоплаченным счётом или счётом, который сейчас создаётся (один человек — одна активация)
const promoHolders = (code, uid) => new Set([...store.payments.promoHolds(code, uid, Date.now() - HOLD_MS), ...[...making.values()].filter((x) => x.promo === code && x.uid !== uid).map((x) => x.uid)]).size;
function dispatch(u, p, amount, promo, origin, ip, method, extra = {}) {
  const sig = crypto.createHash('sha256').update(JSON.stringify([p.id, p.days, amount, promo || '', method, origin || '', extra])).digest('hex').slice(0, 32);
  const key = u.id + ':' + sig, run = making.get(key);
  if (run) return run.job.then((r) => ({ ...r, reused: true }));
  const slot = { uid: u.id, promo: promo || '', add: true };
  slot.job = dispatch1(u, p, amount, promo, origin, ip, method, extra, sig, slot).finally(() => making.delete(key)); // до первого await dispatch1 идёт синхронно: проверки видят всех, кто уже создаёт счёт
  making.set(key, slot);
  return slot.job;
}
async function dispatch1(u, p, amount, promo, origin, ip, method, extra, sig, slot) {
  const now = Date.now(), mine = store.payments.pendingOf(u.id, now - HOLD_MS), busy = mine.length + makingOf(u.id);
  const same = mine.find((x) => x.sig === sig && x.link && now - (x.created || 0) < REUSE_MS);
  if (same) {
    slot.add = false; // прежний счёт уже посчитан среди неоплаченных — второе место в пределе он не занимает
    try { await sync(same); } catch { /* провайдер не ответил — считаем, что счёт ещё ждёт */ }
    const cur = store.payments.get(same.id) || same;
    if (cur.status === 'CONFIRMED') throw new Error('Этот счёт уже оплачен. Обновите страницу');
    if (cur.status === 'PENDING') return { ...cur.link, order: cur.id, reused: true };
    slot.add = true; // прежний счёт отменён — вместо него создаётся новый
  } else if (busy >= PEND_MAX) throw new Error(`У вас уже ${busy} неоплаченных счетов за последний час. Оплатите один из них или попробуйте позже`);
  const r = await issue(u, p, amount, promo, origin, ip, method, extra);
  slot.add = false; // счёт уже в базе
  store.tx(() => { const it = r && r.order && store.payments.get(r.order); if (it) { const { order, ...link } = r; it.sig = sig; it.link = link; store.payments.put(it); } });
  return r;
}
async function issue(u, p, amount, promo, origin, ip, method, extra) {
  const id = crypto.randomUUID();
  if (method === 'crypto') return createCrypto(u, p, amount, promo, origin, id, extra);
  if (method === 'robokassa') return createRobokassa(u, p, amount, promo, origin, id, extra);
  if (method === 'cispay') return createCispay(u, p, amount, promo, origin, id, extra);
  if (method === 'coinso') return createCoinso(u, p, amount, promo, origin, id, extra);
  // «Карта» идёт через Coinso: на странице Coinso плательщик сам выбирает — карта, ATM, наличные, СБП или крипта.
  // Если Coinso не создал счёт и Platega подключён — автоматически фолбэк на Platega.
  if (method === 'card' && coinsoReady()) {
    try { return await createCoinso(u, p, amount, promo, origin, id, extra); }
    catch (e) { if (!payReady()) throw e; console.log('Coinso (card): ' + e.message + ' — фолбэк на Platega'); }
  }
  const j = await pg('POST', '/v2/transaction/process', {
    paymentDetails: { amount, currency: 'RUB' },
    description: payDesc(p, u.login),
    return: `${origin}/chat?pay=ok&order=${id}`, failedUrl: `${origin}/chat?pay=fail&order=${id}`,
    payload: id, orderId: id, metadata: { userId: u.id, userName: u.login, ...(ip ? { clientIp: ip } : {}) },
  });
  const url = j.redirect || j.url || j.paymentUrl;
  if (!j.transactionId || !url) throw new Error('Platega не вернула ссылку на оплату');
  store.payments.put({ id, tx: j.transactionId, uid: u.id, login: u.login, plan: p.id, days: p.days, amount, promo, ...extra, status: 'PENDING', created: Date.now() });
  return { url, order: id };
}
// оплата командного тарифа: сумма — из teams.quote, промокоды и скидка первой покупки не действуют, скидка за срок — да
async function createTeam(u, b, origin, ip) {
  const method = pickMethod(b && b.method);
  const qt = teams.quote(u, b && b.seats, b && b.months, periods());
  const p = { id: teams.PLAN, name: 'Pro для команды, ' + teams.seatsRu(qt.seats), price: qt.amount, days: qt.days, ...(qt.months > 1 ? { months: qt.months } : {}) };
  const extra = { team: { seats: qt.seats, months: qt.months, days: qt.days, name: teams.cleanName(b && b.name), ver: qt.ver, addSeats: qt.addSeats, restDays: qt.restDays } };
  if (qt.months > 1) extra.months = qt.months;
  if (qt.amount < qt.list) { extra.price = qt.list; extra.discount = { kind: 'period', percent: qt.off }; }
  return dispatch(u, p, qt.amount, null, origin, ip, method, extra);
}

// Статусы платежа идут только вперёд: PENDING → CONFIRMED | CANCELED | CHARGEBACKED; CONFIRMED → CHARGEBACKED;
// CANCELED → CONFIRMED — только когда оплату подтвердил сам провайдер (o.verified: ответ его API или подписанное уведомление без API).
// Возврат окончателен, оплаченный счёт не становится снова «ожидает» или «отменён». Незнакомый статус не записывается.
const ST_NEXT = { PENDING: ['CONFIRMED', 'CANCELED', 'CHARGEBACKED'], CONFIRMED: ['CHARGEBACKED'], CANCELED: [], CHARGEBACKED: [] };
const ST_ALIAS = { CANCELLED: 'CANCELED', CHARGEBACK: 'CHARGEBACKED' };
const normStatus = (v) => { const x = String(v || '').toUpperCase(), y = ST_ALIAS[x] || x; return ST_NEXT[y] ? y : ''; };
const provName = (it) => (it.provider === 'crypto' ? 'Crypto Bot' : it.provider === 'robokassa' ? 'Robokassa' : it.provider === 'cispay' ? 'cISPay' : it.provider === 'coinso' ? 'Coinso' : 'Platega');
const planPay = (it) => it.plan !== RESET.id && it.plan !== PACK.id && it.plan !== 'credits'; // платёж за срок: личный тариф или команда
const qtyOf = (it) => Math.max(1, Math.round(it.qty) || 1);

// применить новый статус платежа: права выдаются один раз (первое CONFIRMED) и отзываются один раз (CHARGEBACKED после выдачи)
function apply(pay, status, o = {}) {
  const ns = normStatus(status);
  if (!ns) { if (status && String(status).toUpperCase() !== pay.status) console.log(`${provName(pay)}: ${pay.id} — незнакомый статус «${String(status).slice(0, 40)}», пропущен`); return pay; }
  if (ns === pay.status) return pay;
  return store.tx(() => { // статус, дни тарифа и промокод меняются вместе или не меняются вовсе
    const it = store.payments.get(pay.id); if (!it || it.status === ns) return it || pay;
    const was = it.status, now = Date.now();
    // возврат платежа, права по которому выданы и не отозваны, проходит при любом прежнем статусе:
    // до этих правил оплаченный счёт мог стать «отменён» с выданным тарифом — деньги по нему всё ещё можно вернуть
    const owed = ns === 'CHARGEBACKED' && it.applied && !it.revoked;
    if (!(owed || (ST_NEXT[was] || ST_NEXT.PENDING).includes(ns) || (was === 'CANCELED' && ns === 'CONFIRMED' && o.verified))) {
      // переход назад или повтор старого уведомления: права не трогаем; в платеже остаётся последний отклонённый переход (без записи на каждый повтор)
      if (!it.ignored || it.ignored.from !== was || it.ignored.to !== ns) { it.ignored = { from: was, to: ns, at: now }; store.payments.put(it); console.log(`${provName(it)}: ${it.id} ${was} → ${ns} не применён (${it.login}, ${it.plan})`); }
      return it;
    }
    it.status = ns; it.updated = now;
    if (ns === 'CONFIRMED' && !it.applied && !it.revoked) grant(it, now);
    else if (ns === 'CHARGEBACKED' && it.applied && !it.revoked) { revoke(it, now); it.applied = false; it.revoked = now; }
    store.payments.put(it); console.log(`${provName(it)}: ${it.id} ${was} → ${ns} (${it.login}, ${it.plan})`);
    return it;
  });
}
// выдать оплаченное (внутри транзакции apply); каждая выдача записывается в журнал с номером платежа
function grant(it, now) {
  const rec = (kind, units, ends) => ent.record({ src: it.id, uid: it.uid, kind, units, starts: now, ends, at: now });
  if (it.plan === RESET.id) { // сбросы: на баланс, и один — сразу, если просили и счётчики дня не на нуле
    // один сброс тратим сразу, только если лимит уже исчерпан; иначе он ждёт на балансе и спишется сам (автосброс)
    const n = qtyOf(it), uu = store.users.get(it.uid);
    const useNow = it.now === true && !!uu && exhausted(uu);
    updateUser(it.uid, (x) => { x.resetBal = (x.resetBal || 0) + n; addResetLog(x, 'buy', n); if (useNow) { x.resetBal = Math.max(0, (x.resetBal || 0) - 1); addResetLog(x, 'use', -1); } });
    if (useNow) resetUsage(it.uid);
    it.usedNow = useNow; it.credited = n - (useNow ? 1 : 0); rec('reset', n);
  }
  else if (it.plan === 'credits') { const n = qtyOf(it); updateUser(it.uid, (x) => { x.ultra = { ...(x.ultra || {}), bal: r1(((x.ultra && x.ultra.bal) || 0) + n) }; addUltraLog(x, 'buy', n); }); it.credited = n; rec('credits', n); }
  else if (it.plan === PACK.id) { // пакет сообщений: добавляем к живым; сгоревшие и пустые убираем, живые не трогаем (предел числа пакетов проверяется при создании счёта)
    const pk = it.pack || {}, n = Math.max(1, Math.round(pk.n) || 0), until = now + Math.max(1, Math.round(pk.days) || 30) * DAY;
    updateUser(it.uid, (x) => { x.msgPacks = [...packList(x), { id: it.id, n, left: n, until }]; }); rec('pack', n, until);
  }
  else if (it.plan === teams.PLAN) { const t = teams.onPaid(it, now); for (const uid of teams.memberIds(t.id)) reanchor(uid, now); }
  else {
    // предложение уже израсходовано другим счётом: за эти деньги — столько дней, сколько они стоят без него (не больше, чем в счёте)
    const lost = offerLost(it);
    if (lost) {
      const per = it.months > 1 ? periods().find((x) => x.months === it.months) : null, dp = dayPrice(it.plan) * (per && per.off ? (100 - per.off) / 100 : 1);
      it.recalc = { why: lost, days: it.days, at: now }; if (dp > 0) it.days = Math.min(it.days, Math.max(0.01, Math.floor(it.amount / dp * 100) / 100));
      console.log(`${provName(it)}: ${it.id} — предложение «${lost}» уже использовано, вместо ${it.recalc.days} дн. выдано ${it.days} (${it.login}, ${it.plan})`);
    }
    const trial = it.offer === 'trial' && !lost;
    updateUser(it.uid, (x) => { extend(x, it.plan, it.days, { src: it.id }); if (trial) { if (it.plan === growth.conf().trial.plan) x.trialUsed = now; x.trialsUsed = { ...(x.trialsUsed || {}), [it.plan]: now }; } });
    if (trial) markTrial(store.users.get(it.uid), it.plan); // второй раз этот тариф — ни этому аккаунту, ни этой почте
  }
  it.applied = true; it.paid = now; if (it.promo && !(it.recalc && it.recalc.why === 'promo')) usePromo(it.promo, it.uid);
  refPayHook(store.users.get(it.uid), it);
  if (US && US.onPaid) setImmediate(() => { try { US.onPaid(it); } catch {} });
}
// отозвать выданное платежом (внутри транзакции apply). Израсходованное не возвращается: забирается то, что ещё осталось
function revoke(it, now) {
  // количественные права: строка журнала отзывается один раз; у платежей, оплаченных до журнала, она создаётся здесь же
  const once = (kind, units) => { ent.record({ src: it.id, uid: it.uid, kind, units, at: it.paid || now }); return ent.revokeUnits(it.id, kind, now).length > 0; };
  if (it.plan === RESET.id) { // возврат пакета: забираем сбросы, которые ещё на балансе
    if (once('reset', qtyOf(it))) updateUser(it.uid, (x) => { const n = Math.min(x.resetBal || 0, qtyOf(it)); x.resetBal = (x.resetBal || 0) - n; addResetLog(x, 'refund', -n); });
  } else if (it.plan === 'credits') { // возврат: забираем купленные, что ещё на балансе
    if (once('credits', qtyOf(it))) updateUser(it.uid, (x) => { const cur = (x.ultra && x.ultra.bal) || 0, n = Math.min(cur, qtyOf(it)); x.ultra = { ...(x.ultra || {}), bal: r1(cur - n) }; addUltraLog(x, 'chargeback', -n); });
  } else if (it.plan === PACK.id) { // возврат пакета: остаток сгорает
    if (once('pack', (it.pack && it.pack.n) || 0)) updateUser(it.uid, (x) => { const p = (x.msgPacks || []).find((y) => y.id === it.id); if (p) p.left = 0; });
  } else { // возврат платежа за срок: дни этого платежа забираются у всех, кому он их дал, — в том числе после смены тарифа
    if (it.plan === teams.PLAN) { const t = teams.onChargeback(it, now); if (t) for (const uid of teams.memberIds(t.id)) reanchor(uid, now); }
    else takeDays(it.id, it.uid, it.plan, it.days, 'plan', now);
    if (it.ref) { // бонусы за приглашение, начисленные этим платежом, тоже забираются
      for (const side of [it.ref.invitee, it.ref.inviter]) if (side) takeDays(it.id, side.uid, side.plan, side.days, 'bonus', now);
      if (it.ref.inviter) store.db.prepare('UPDATE referrals SET bonus = 0 WHERE id = ?').run(it.uid);
    }
  }
}
const API_SAYS = { verified: true }; // статус получен запросом к API провайдера, а не из уведомления
// info.fail = true — провайдер ответил ошибкой (не исключением): статус не узнали, автопроверка сделает паузу
async function sync(pay, info = {}) {
  if (!pay || !pay.tx) return pay;
  if (pay.provider === 'cispay') {
    const k = cisKeys(); if (!k.shopId || !k.apiKey) return pay;
    const r = await fetch('https://api.cispay.app/payments/status?id=' + encodeURIComponent(pay.tx), { headers: { 'X-Shop-Id': k.shopId, 'X-Api-Key': k.apiKey }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) { info.fail = true; return pay; }
    const j = await r.json().catch(() => ({}));
    return apply(pay, { pending: 'PENDING', paid: 'CONFIRMED', failed: 'CANCELED', expired: 'CANCELED', refunded: 'CHARGEBACKED' }[String(j.status || '').toLowerCase()] || pay.status, API_SAYS);
  }
  if (pay.provider === 'crypto') {
    const r = await cb('getInvoices', { invoice_ids: String(pay.tx) }), inv = (r.items || [])[0];
    if (!inv) return pay;
    return apply(pay, { active: 'PENDING', paid: 'CONFIRMED', expired: 'CANCELED' }[inv.status] || pay.status, API_SAYS);
  }
  if (pay.provider === 'coinso') {
    const j = await coinsoStatus(pay.tx);
    if (!j.success) { info.fail = true; return pay; }
    return apply(pay, { paid: 'CONFIRMED', failed: 'CANCELED' }[String(j.status || '').toLowerCase()] || pay.status, API_SAYS);
  }
  if (pay.provider === 'robokassa') return pay; // статус приходит только вебхуком (Robokassa его дублирует)
  const j = await pg('GET', '/transaction/' + encodeURIComponent(pay.tx));
  return apply(pay, String(j.status || '').toUpperCase(), API_SAYS);
}
const findPay = (q) => (q ? store.payments.find(q) : null);

// Автоподтверждение платежей на стороне сервера: товар и сбросы выдаются,
// даже если пользователь закрыл вкладку или вебхук опоздал (клиентский поллинг
// /api/pay/check и вебхуки — более быстрые пути, это финальная гарантия).
// Неоплаченные счета выбираются запросом по статусу (не вся таблица) и проверяются по SYNC.par одновременно.
// Чем старше счёт, тем реже проверка: первые 15 минут — каждый тик, до часа — раз в минуту, дальше — раз в 10 минут.
// Провайдер не ответил — пауза для этого счёта удваивается (до 10 минут). Robokassa статус не отдаёт: её счета не опрашиваются.
const SYNC = { tick: 20e3, par: 4, batch: 200, age: 24 * 3600e3, max: 600e3 };
const syncNext = new Map(); // id счёта → { at: когда проверять снова, err: ошибок подряд }
let autoSyncBusy = false;
async function autoConfirmTick(now = Date.now()) {
  if (autoSyncBusy) return 0;
  autoSyncBusy = true;
  try {
    // только счета, статус которых можно спросить (не Robokassa, есть номер операции); в пачку — те, кого дольше всех не проверяли,
    // сначала ни разу не проверенные: очередь всегда продвигается, сколько бы свежих счетов ни было
    // Очередь строится по номерам всех таких счетов (без предела выборки), а сами счета читаются только для пачки.
    const all = store.payments.pendingIds(now - SYNC.age), live = new Set(all), next = (id) => (syncNext.get(id) || {}).at || 0;
    for (const id of syncNext.keys()) if (!live.has(id)) syncNext.delete(id);
    const due = all.filter((id) => !(next(id) > now)).sort((a, b) => next(a) - next(b)).slice(0, SYNC.batch).map((id) => store.payments.get(id)).filter((p) => p && p.status === 'PENDING');
    let i = 0;
    const worker = async () => {
      while (i < due.length) {
        const p = due[i++], w = syncNext.get(p.id) || { err: 0 }, age = Date.now() - (p.created || 0);
        let gap = age < 15 * 60e3 ? 0 : age < 3600e3 ? 60e3 : SYNC.max;
        try { const info = {}; await sync(p, info); if (info.fail) throw new Error('провайдер ответил ошибкой'); w.err = 0; } catch { w.err++; gap = Math.max(gap, Math.min(SYNC.max, SYNC.tick * 2 ** Math.min(w.err, 6))); }
        w.at = Math.max(Date.now() + gap, now + 1); syncNext.set(p.id, w); // проверенный в этом тике идёт в очереди после ни разу не проверенных
      }
    };
    await Promise.all(Array.from({ length: Math.min(SYNC.par, due.length) }, worker));
    return due.length;
  } finally { autoSyncBusy = false; }
}
setInterval(() => { autoConfirmTick().catch(() => {}); }, SYNC.tick).unref(); // ошибка БД на тике не должна ронять процесс

// колбэк Platega: проверяем заголовки, затем перепроверяем статус запросом к API
async function callback(headers, body) {
  const k = keys(), eq = (a, b) => { a = Buffer.from(String(a || '')); b = Buffer.from(String(b || '')); return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b); };
  if (!eq(headers['x-merchantid'], k.id) || !eq(headers['x-secret'], k.secret)) return { code: 401 };
  const pay = findPay(String(body.id || '')) || findPay(String(body.payload || ''));
  if (!pay) return { code: 200 }; // чужой/старый платёж — подтверждаем, чтобы не было повторов
  try { await sync(pay); } catch (e) { console.log('Platega: перепроверка не удалась, беру статус из колбэка:', e.message); apply(pay, String(body.status || '').toUpperCase()); }
  return { code: 200 };
}

/* ---------- Crypto Bot (Crypto Pay API, @CryptoBot / @CryptoTestnetBot) ---------- */
const CRYPTO_ASSETS = 'USDT,TON,BTC,ETH,LTC,BNB,TRX,USDC';
function cryptoKeys() {
  const st = US.loadSettings().cryptobot || {};
  const token = process.env.CRYPTOPAY_TOKEN || st.token || '';
  const testnet = process.env.CRYPTOPAY_TESTNET ? process.env.CRYPTOPAY_TESTNET === '1' : !!st.testnet;
  return { token, testnet, env: !!process.env.CRYPTOPAY_TOKEN, assets: (st.assets || CRYPTO_ASSETS).toUpperCase().replace(/[^A-Z,]/g, '').split(',').filter(Boolean).join(',') || CRYPTO_ASSETS };
}
const cryptoReady = () => !!cryptoKeys().token;
async function cb(method, params) {
  const k = cryptoKeys(); if (!k.token) throw new Error('Crypto Bot не подключён');
  const r = await fetch(`https://${k.testnet ? 'testnet-' : ''}pay.crypt.bot/api/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Crypto-Pay-API-Token': k.token }, body: JSON.stringify(params || {}), signal: AbortSignal.timeout(20000) });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
  if (!j.ok) {
    const n = j.error?.name || j.error?.code || r.status;
    throw new Error(/UNAUTHORIZED|401|EXPIRED_TOKEN/i.test(String(n)) ? 'Crypto Bot: неверный API-токен' + (k.testnet ? ' (включена тестовая сеть — токен должен быть из @CryptoTestnetBot)' : '') : `Crypto Bot: ${String(j.error?.name || j.error?.message || t).slice(0, 200)}`);
  }
  return j.result;
}
async function createCrypto(u, p, amount, promo, origin, id, extra = {}) {
  const k = cryptoKeys();
  const inv = await cb('createInvoice', {
    currency_type: 'fiat', fiat: 'RUB', amount: String(amount), accepted_assets: k.assets,
    description: payDesc(p).slice(0, 1024), payload: id, expires_in: 3600, allow_comments: false, allow_anonymous: true,
    ...(/^https:\/\//.test(origin) ? { paid_btn_name: 'callback', paid_btn_url: `${origin}/chat?pay=ok&order=${id}` } : {}),
  });
  const url = inv.bot_invoice_url || inv.mini_app_invoice_url || inv.web_app_invoice_url || inv.pay_url;
  if (!inv.invoice_id || !url) throw new Error('Crypto Bot не вернул ссылку на оплату');
  store.payments.put({ id, tx: String(inv.invoice_id), provider: 'crypto', uid: u.id, login: u.login, plan: p.id, days: p.days, amount, promo, ...extra, status: 'PENDING', created: Date.now() });
  return { url, order: id, method: 'crypto' };
}
// вебхук Crypto Pay: подпись = HMAC-SHA256(тело запроса, ключ = SHA256(токен)), затем перепроверка статуса запросом к API
async function cryptoCallback(headers, raw) {
  const k = cryptoKeys(); if (!k.token) return { code: 401 };
  const sig = String(headers['crypto-pay-api-signature'] || ''), want = crypto.createHmac('sha256', crypto.createHash('sha256').update(k.token).digest()).update(raw).digest('hex');
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return { code: 401 };
  let body = {}; try { body = JSON.parse(raw); } catch { return { code: 400 }; }
  if (body.update_type !== 'invoice_paid') return { code: 200 };
  const inv = body.payload || {}, pay = findPay(String(inv.payload || '')) || store.payments.byTx(String(inv.invoice_id), 'crypto');
  if (!pay || pay.provider !== 'crypto' || pay.tx !== String(inv.invoice_id)) return { code: 200 };
  try { await sync(pay); } catch (e) { console.log('Crypto Bot: перепроверка не удалась, беру статус из вебхука:', e.message); if (inv.status === 'paid') apply(pay, 'CONFIRMED'); }
  return { code: 200 };
}
const cryptoMe = () => cb('getMe');
// Регистрируем вебхук при старте: Crypto Bot сам пришлёт invoice_paid на /api/pay/crypto
// и платёж подтвердится, даже если пользователь уже закрыл сайт
setImmediate(() => { // отложенно: в тестах billing.js грузится без инициализированного хранилища
  try {
    if (!cryptoReady() || !process.env.PUBLIC_URL) return;
    const whUrl = String(process.env.PUBLIC_URL).replace(/\/+$/, '') + '/api/pay/crypto';
    cb('setWebhook', { webhook_address: whUrl }).then(() => console.log('Crypto Bot: webhook зарегистрирован (' + whUrl + ')')).catch((e) => console.log('Crypto Bot: не удалось зарегистрировать webhook: ' + e.message));
  } catch (e) { console.log('Crypto Bot: webhook не зарегистрирован: ' + e.message); }
});

// cISPay (СБП): настройки магазина, создание платежа, вебхук
const cisKeys = () => US.loadSettings().cispay || {};
const cisReady = () => { const k = cisKeys(); return !!(k.shopId && k.apiKey); };
async function cisPost(body) {
  const k = cisKeys();
  const r = await fetch('https://api.cispay.app/payments', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shop-Id': k.shopId, 'X-Api-Key': k.apiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'cISPay: неверный Shop ID или API Key' : `cISPay ${r.status}: ${String(j.detail || t).slice(0, 200)}`);
  return j;
}
async function createCispay(u, p, amount, promo, origin, id, extra = {}) {
  const j = await cisPost({ amount: Math.round(amount * 100), currency: 'RUB', order_id: id, customer_id: u.email || u.login, description: payDesc(p, u.login) });
  if (!j.payment_url) throw new Error('cISPay не вернул ссылку на оплату');
  store.payments.put({ id, tx: j.id, uid: u.id, login: u.login, plan: p.id, days: p.days, amount, promo, ...extra, status: 'PENDING', provider: 'cispay', created: Date.now() });
  return { url: j.payment_url, order: id };
}
// вебхук cISPay: подпись = HMAC-SHA256(тело как есть, ключ = API Key) в x-signature
function cisCallback(hd, raw) {
  const k = cisKeys(); if (!k.apiKey) return { code: 503, ok: false };
  const sig = String(hd['x-signature'] || ''), exp = crypto.createHmac('sha256', k.apiKey).update(raw).digest('hex');
  if (!sig || sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return { code: 401, ok: false };
  let ev; try { ev = JSON.parse(raw); } catch { return { code: 400, ok: false }; }
  const pay = store.payments.get(ev.order_id);
  if (!pay) return { code: 200, ok: true, ignored: 'no order' };
  if (ev.is_sandbox && k.sandboxOk === false) return { code: 200, ok: true, ignored: 'sandbox' };
  const map = { paid: 'CONFIRMED', failed: 'CANCELED', expired: 'CANCELED', refunded: 'CHARGEBACKED' };
  const ns = map[String(ev.status || '').toLowerCase()];
  // «оплачен» по счёту, который у нас уже отменён, принимается только после запроса статуса у cISPay
  if (ns === 'CONFIRMED' && pay.status === 'CANCELED') sync(pay).catch((e) => console.log('cispay: перепроверка ' + pay.id + ' не удалась: ' + e.message));
  else if (ns) { apply(pay, ns); console.log('cispay webhook ' + pay.id + ' ' + ev.status + (ev.is_sandbox ? ' (sandbox)' : '') + ' -> ' + ns); }
  return { code: 200, ok: true };
}

/* ---------- Coinso (СБП, карты, крипта) ---------- */
const CSAPI = process.env.COINSO_URL || 'https://coinso.io/api';
const coinsoKeys = () => US.loadSettings().coinso || {};
const coinsoReady = () => { const k = coinsoKeys(); return !!(k.projectId && k.secret); };
async function coinsoPost(body) {
  const k = coinsoKeys();
  const r = await fetch(CSAPI + '/payment/create', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k.secret }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) }); // до 45 с: банк-партнёр может думать
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
  if (!r.ok || j.success === false) throw new Error(r.status === 401 ? 'Coinso: неверный Secret Key' : `Coinso ${r.status}: ${String(j.message || t).slice(0, 200)}`);
  return j;
}
// статус счёта — без авторизации: знание invoice_id и есть доступ
const coinsoStatus = (uuid) => fetch(CSAPI + '/payment/status?uuid=' + encodeURIComponent(uuid), { signal: AbortSignal.timeout(20000) }).then((r) => r.json().catch(() => ({})));
async function createCoinso(u, p, amount, promo, origin, id, extra = {}) {
  const k = coinsoKeys();
  const j = await coinsoPost({
    project_id: +k.projectId, amount,
    description: payDesc(p, u.login),
    custom: id, // наш номер заказа — вернётся в вебхуке без изменений
    client_email: u.email || '', client_user_id: String(u.id),
    success_url: `${origin}/chat?pay=ok&order=${id}`, fail_url: `${origin}/chat?pay=fail&order=${id}`,
  });
  if (!j.payment_url) throw new Error('Coinso не вернул ссылку на оплату');
  store.payments.put({ id, tx: String(j.invoice_id), uid: u.id, login: u.login, plan: p.id, days: p.days, amount, promo, ...extra, status: 'PENDING', provider: 'coinso', created: Date.now() });
  return { url: j.payment_url, order: id };
}
// вебхук Coinso: подпись X-Signature = HMAC-SHA256(тело как есть, ключ = Secret Key); товар — только после перепроверки статуса
async function coinsoCallback(hd, raw) {
  const k = coinsoKeys(); if (!k.secret) return { code: 503, ok: false };
  const sig = String(hd['x-signature'] || ''), exp = crypto.createHmac('sha256', k.secret).update(raw).digest('hex');
  if (!sig || sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return { code: 401, ok: false };
  let ev; try { ev = JSON.parse(raw); } catch { return { code: 400, ok: false }; }
  const pay = (ev.invoice_id ? store.payments.byTx(String(ev.invoice_id), 'coinso') : null) || (ev.custom ? store.payments.get(ev.custom) : null);
  if (!pay || pay.provider !== 'coinso') return { code: 200, ok: true, ignored: 'no order' };
  if (ev.test_mode) return { code: 200, ok: true, ignored: 'тестовый платёж — товар не выдаём' };
  if (ev.event === 'payment.success') {
    let st = null; try { st = await coinsoStatus(String(ev.invoice_id)); } catch {}
    if (st && st.success && st.status !== 'paid') return { code: 200, ok: true, ignored: 'статус: ' + (st.status || '?') };
    apply(pay, 'CONFIRMED', { verified: !!(st && st.success) }); console.log('Coinso: webhook ' + pay.id + ' paid' + (st && st.test_mode ? ' (test)' : '') + ' -> CONFIRMED');
  } else if (ev.event === 'payment.failed') {
    apply(pay, 'CANCELED'); console.log('Coinso: webhook ' + pay.id + ' failed (' + (ev.error_code || 'no reason') + ') -> CANCELED');
  }
  return { code: 200, ok: true };
}
// проверка ключа из панели: список доступных сейчас способов оплаты проекта
const coinsoMe = async () => {
  const k = coinsoKeys();
  const r = await fetch(CSAPI + '/payment/methods?project_id=' + encodeURIComponent(k.projectId), { headers: { 'Authorization': 'Bearer ' + k.secret }, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) throw new Error('Coinso ' + r.status + ': ' + String(j.message || 'ошибка'));
  return j;
};

/* ---------- статистика для панели ---------- */
function stats() {
  const users = store.users.all(), c = cfg(), now = Date.now(), days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now + 3 * 3600e3 - i * DAY).toISOString().slice(0, 10);
    const u = d === today() ? usage().u : store.kv.get('usage:' + d, {});
    const v = Object.values(u); days.push({ d, m: v.reduce((n, x) => n + (x.m || 0), 0), c: v.reduce((n, x) => n + (x.c || 0), 0), s: v.reduce((n, x) => n + (x.s || 0), 0), i: v.reduce((n, x) => n + (x.i || 0), 0), users: v.filter((x) => x.m > 0).length });
  }
  const plans = Object.fromEntries(c.plans.map((p) => [p.id, 0]));
  for (const u of users) plans[planOf(u).id] = (plans[planOf(u).id] || 0) + 1;
  const ok = store.payments.byStatus('CONFIRMED');
  return { days, plans, users: users.length, revenue30: ok.filter((x) => (x.paid || x.created) > now - 30 * DAY).reduce((n, x) => n + x.amount, 0), revenue: ok.reduce((n, x) => n + x.amount, 0), paid: ok.length };
}

function saveCfg(b) {
  const c = cfg(), num = (v, d) => (v === null || v === '' ? null : Number.isFinite(+v) && +v >= 0 ? Math.round(+v) : d);
  for (const p of c.plans) {
    const n = (b.plans || []).find((x) => x.id === p.id); if (!n) continue;
    if (typeof n.name === 'string' && n.name.trim()) p.name = n.name.trim().slice(0, 30);
    if (typeof n.desc === 'string') p.desc = n.desc.trim().slice(0, 120);
    if (p.id !== 'free') { p.price = num(n.price, p.price) ?? p.price; p.days = Math.max(1, num(n.days, p.days) ?? p.days); }
    for (const k of ['msgs', 'code', 'sites', 'images', 'pc']) if (k in n) p[k] = num(n[k], p[k]);
    if (p.id !== 'free' && 'ultra' in n) p.ultra = !!n.ultra;
    if (p.id !== 'free' && 'nofair' in n) p.nofair = !!n.nofair;
    if ('credits' in n) p.credits = Math.min(100000, num(n.credits, p.credits || 0) ?? 0);
  }
  delete c.trialDays; delete c.trialPlan;
  if ('periods' in b) c.periods = cleanPeriods(b.periods);
  if ('burst' in b) c.burst = num(b.burst, c.burst) ?? 0;
  if ('fair' in b) c.fair = num(b.fair, c.fair);
  if ('msgCost' in b) c.msgCost = Number.isFinite(+b.msgCost) && +b.msgCost >= 0 ? Math.round(+b.msgCost * 10000) / 10000 : (c.msgCost || 0);
  if ('minMargin' in b) c.minMargin = Math.min(500, num(b.minMargin, c.minMargin) ?? 0);
  if ('packDays' in b) c.packDays = Math.max(1, Math.min(365, num(b.packDays, c.packDays) || 30));
  if ('packs' in b) {
    const seen = new Set();
    c.packs = (Array.isArray(b.packs) ? b.packs : []).map((x) => ({ n: Math.round(+x.n), price: Math.round(+x.price) }))
      .filter((x) => x.n > 0 && x.price > 0 && !seen.has(x.n) && seen.add(x.n)).sort((a, b2) => a.n - b2.n).slice(0, 6);
  }
  if ('resetPrice' in b) c.resetPrice = Math.min(100000, Math.max(1, num(b.resetPrice, c.resetPrice) || RESET.price));
  if ('resetMsgs' in b) c.resetMsgs = Math.min(1e6, Math.max(1, num(b.resetMsgs, c.resetMsgs) || DEF.resetMsgs));
  if (b.ultra && typeof b.ultra === 'object') {
    const u = b.ultra, o = { ...ultraCfg() }, n = (v, d, lo, hi) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
    o.on = !!u.on; o.price = Math.round(n(u.price, o.price, 0.01, 1e6) * 100) / 100; o.maxBuy = Math.round(n(u.maxBuy, o.maxBuy, 1, 100000));
    const dg = u.daily == null ? u.monthly : u.daily; // monthly — прежнее имя поля (панель из кеша браузера)
    o.daily = Math.round(n(dg, o.daily, 0, 1e6)); delete o.monthly; o.ctxFree = Math.round(n(u.ctxFree, o.ctxFree, 1000, 2e6)); o.ctxStep = Math.round(n(u.ctxStep, o.ctxStep, 500, 2e6));
    o.ctxCredits = Math.round(n(u.ctxCredits, o.ctxCredits, 0, 1000)); o.maxOut = Math.round(n(u.maxOut, o.maxOut, 256, 128000)); o.cost = Math.round(n(u.cost, o.cost, 0, 1e6) * 100) / 100;
    if (u.minByMethod && typeof u.minByMethod === 'object') o.minByMethod = Object.fromEntries(Object.entries(u.minByMethod).filter(([k, v]) => /^[a-z]{2,12}$/.test(k) && Number(v) > 0).map(([k, v]) => [k, Math.round(+v)]));
    c.ultra = o;
  }
  // экономику проверяем на итоговом конфиге (сохранённое + запрос), а не по полям запроса: смена себестоимости не должна обходить проверку цен
  // ниже себестоимости продавать нельзя: иначе каждый пакет — минус
  const cost = c.msgCost || 0, badPack = cost > 0 && (c.packs || []).find((x) => x.price < x.n * cost);
  if (badPack) throw new Error(`Пакет ${badPack.n} сообщений за ${badPack.price} ₽ дешевле себестоимости (${Math.ceil(badPack.n * cost)} ₽): минимальная цена пакета — ${Math.ceil(badPack.n * cost)} ₽`);
  const uc = { ...ULTRA_DEF, ...(c.ultra || {}) };
  if (uc.cost > 0 && uc.price < uc.cost) throw new Error('Цена кредита ' + uc.price + ' ₽ ниже себестоимости ' + uc.cost + ' ₽ — каждый проданный кредит был бы в минус: минимальная цена Ultra-кредита — ' + uc.cost + ' ₽');
  // сброс возвращает до resetMsgs сообщений, а в пакете из RESET_MAX сбросов он дешевле всего
  const rp = resetPriceOf(c), rm = resetMsgsOf(c), rpct = RESET_PACKS[RESET_PACKS.length - 1].pct, cheapest = Math.round(rp * (100 - rpct) / 100);
  let rmin = Math.max(1, Math.ceil(rm * cost * 100 / (100 - rpct)) - 1); while (Math.round(rmin * (100 - rpct) / 100) < rm * cost) rmin++;
  if (cost > 0 && cheapest < rm * cost) throw new Error(`Сброс лимита за ${rp} ₽ (в пакете из ${RESET_PACKS[RESET_PACKS.length - 1].n} — ${cheapest} ₽ за штуку) дешевле себестоимости ${rm} сообщений (${Math.ceil(rm * cost)} ₽): минимальная цена сброса — ${rmin} ₽`);
  if ('trials' in b) { // пробные тарифы: {план: {on, price, days}} — только платные тарифы; тариф с Ultra-кредитами не продаём ниже худшего случая по себестоимости кредита
    const t = {};
    for (const p of c.plans) { const x = b.trials && b.trials[p.id]; if (!x || typeof x !== 'object' || !(p.price > 0)) continue;
      t[p.id] = { on: x.on !== false, ...(Math.round(+x.price) > 0 ? { price: Math.min(100000, Math.round(+x.price)) } : {}), ...(Math.round(+x.days) > 0 ? { days: Math.min(30, Math.round(+x.days)) } : {}) }; }
    c.trials = t;
  }
  for (const t of Object.values(trialCfg(c))) { // проверяем только то, что админ сохраняет сейчас в блоке trials (смена себестоимости пробный не блокирует: убыточный Ultra-пробный просто скрывается)
    if (!('trials' in b) || !b.trials || !b.trials[t.plan] || b.trials[t.plan].on === false) continue;
    const p = c.plans.find((x) => x.id === t.plan), need = trialWorstCost(p, t.days, Number((c.ultra || {}).cost) || 0);
    if (t.price < need) throw new Error(`Пробный тариф ${t.name} за ${t.price} ₽ дешевле себестоимости кредитов (${need} ₽: ${Math.ceil(t.days) + 1} суток × ${p.credits} кр. × ${c.ultra.cost} ₽)`);
  }
  const wasOn = !!ultraCfg().on, nowOn = !!uc.on;
  store.tx(() => { store.kv.set('plans', c); if (wasOn !== nowOn) ultraSwitch(nowOn, c); });
  return c;
}
// Ultra выключили — запоминаем когда. Включили обратно — подписчикам тарифов с Ultra время простоя возвращается бонусными днями:
// столько, сколько их оплаченный срок шёл при выключенном Ultra. Срок, за который деньги вернули, не считается.
function ultraSwitch(on, c, now = Date.now()) {
  if (!on) { if (!store.kv.get('ultra:offAt', 0)) store.kv.set('ultra:offAt', now); return; }
  const offAt = store.kv.get('ultra:offAt', 0); store.kv.del('ultra:offAt');
  const ids = c.plans.filter((p) => p.ultra && p.id !== 'free').map((p) => p.id); if (!offAt || !ids.length) return;
  // Компенсация записывается на тот же источник, что и потерянный срок (платёж, промокод, панель): вернули платёж — уходит и она.
  const seen = new Set(); let ms = 0;
  for (const r of ent.overlap(ids, offAt, now)) {
    if (!(r.ms >= 60e3) || !store.users.get(r.uid)) continue;
    updateUser(r.uid, (x) => {
      // у человека сейчас другой тариф — компенсация той же стоимости идёт в его дни, а не меняет ему тариф
      const cur = curOf(x, now), other = cur && cur.plan !== r.plan, a = dayPrice(r.plan, c), b = other ? dayPrice(cur.plan, c) : a;
      if (other && !(a > 0 && b > 0)) return;
      extend(x, other ? cur.plan : r.plan, (other ? r.ms * a / b : r.ms) / DAY, { src: r.src, kind: 'bonus', tag: 'ultraoff:' + offAt + ':' + r.plan }); // у одного источника могут быть строки двух тарифов с Ultra (смена тарифа во время простоя)
      seen.add(r.uid); ms += r.ms;
    });
  }
  const users = seen.size;
  const out = { at: now, offAt, users, days: Math.round(ms / DAY * 10) / 10 }; store.kv.set('ultra:comp', out);
  console.log(`Ultra снова включён: простой с ${new Date(offAt).toISOString()}, компенсация — ${users} чел., всего ${out.days} дн.`);
}

module.exports = { chargeRound, refundRounds, settle, chargedOf, reserve, release, commit, sweepBurst, burstSize: () => burstHits.size, addDay, MIN_TEXT, setPlan, reanchor, migrateLedger, ent, refRetry, autoConfirmTick, resetPrice, resetMsgs, trialCfg, trialTaken, trialWorstCost, refund, takeAbortRefund, ABORT_REFUNDS, ultraTopUp, RESET, RESET_PACKS, PACK, ultraCfg, ultraInfo, ultraCost, ultraGrant, ultraSpend, ultraMore, refundUltraRounds, ultraHistory, ultraAdjust, ultraStats, estimateTokens, packQuote, packInfo, packLeft, packList, autoReset, setAutoReset, exhausted, myPayments, resetQuote, resetInfo, resetHistory, useReset, resetsAt, today, modelPlans, planOpen, init, cfg, saveCfg, planOf, extend, updateUser, used, add, left, limitOf, charge, summary, publicPlans, redeem, loadPromos, savePromos, keys, payReady, cryptoKeys, cryptoReady, cryptoCallback, cryptoMe, create, sync, findPay, cisKeys, cisReady, cisCallback, createCispay, coinsoKeys, coinsoReady, coinsoCallback, coinsoMe, createCoinso, rbKeys, rbReady, rbCallback, refBind, refMsgTick, refInfo, refTierCheck, refMergeBonus, refPayHook, loadPays, callback, stats, flush, apply,
  offers, publicOffers, discounted, refCode, refOwner, refRules, periods, cleanPeriods, teams, dispatch, createTeam, pickMethod };
