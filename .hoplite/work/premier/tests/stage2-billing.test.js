'use strict';
// Этап 2 «Квоты, списания и публичный API» — часть billing.js: квитанции, резервы, политика исходов, суточные итоги Ultra.
// Запуск: npm test (или node --test tests/stage2-billing.test.js). Функции billing.js вызываются напрямую, без сервера.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { copyApp, rm } = require('../test/helpers');

const DAY = 864e5;
const MODEL = { id: 'm', name: 'Модель', weight: 1, plans: ['free', 'pro', 'max', 'ultra'] };
const LIGHT = { id: 'l', name: 'Лёгкая', weight: 0.1, plans: ['free', 'pro', 'max', 'ultra'] };
const HEAVY = { id: 'h', name: 'Тяжёлая', weight: 3, plans: ['free', 'pro', 'max', 'ultra'] };
const ULTRA = { id: 'claude', name: 'Claude', ultra: true, credits: 3, plans: ['ultra'] };
const ULTRA_CFG = { on: true, ctxFree: 20000, ctxStep: 10000, ctxCredits: 2, maxBuy: 10000 };
const mskDay = (ms) => new Date(ms + 3 * 3600e3).toISOString().slice(0, 10);

// before(store) — подготовить базу до bill.init (нужно для проверки переноса данных)
async function app(t, cfg, before) {
  const dir = copyApp();
  const bill = require(path.join(dir, 'billing.js')), store = require(path.join(dir, 'db.js'));
  if (before) before(store);
  bill.init({ loadSettings: () => ({}), saveSettings() {} });
  const realNow = Date.now;
  t.after(() => { Date.now = realNow; try { bill.flush(); } catch {} store.db.close(); rm(dir); });
  if (cfg) bill.saveCfg(cfg);
  let n = 0;
  const mk = (o = {}) => { n++; const id = 'u' + n + Math.random().toString(16).slice(2, 6); store.users.put({ id, login: 'user' + n + '_' + id, email: id + '@example.com', created: new Date().toISOString(), ...o, id }); return store.users.get(id); };
  const get = (u) => store.users.get(u.id);
  const at = (ms) => { Date.now = () => ms; }; // «перевести часы» (сутки в биллинге считаются по Date.now())
  return { bill, store, mk, get, at, realNow };
}
const paid = (plan) => ({ plan, until: Date.now() + 30 * DAY });
const pack = (left, id = 'pk1') => ({ id, n: 1000, left, until: Date.now() + 30 * DAY });
const ultraUser = (o = {}) => ({ ...paid('ultra'), ...o });
// 23:50 по Москве вчерашних суток — до полуночи остаётся 10 минут
const beforeMidnight = () => Date.parse(mskDay(Date.now()) + 'T00:00:00+03:00') - 10 * 60e3;

/* ---------- BIZ-06 ---------- */
test('BIZ-06: автосброс не тратится, если после него сообщение всё равно не пройдёт', async (t) => {
  const { bill, mk, get } = await app(t, { plans: [{ id: 'free', msgs: 2 }] });
  const u = mk({ resetBal: 1 });
  bill.add(u.id, 'm', 2);
  const ch = bill.charge(get(u), HEAVY, { burst: false }); // вес 3 больше дневного лимита 2: сброс не поможет
  assert.equal(ch.code, 'limit');
  assert.equal(get(u).resetBal, 1, 'сброс остался на балансе');
  assert.equal(bill.used(u.id).m, 2, 'счётчик не тронут');
  assert.equal((get(u).resetLog || []).length, 0);
});

test('BIZ-06: сброс возвращает меньше, чем нужно сообщению, — не тратится; хватает — сброс и сообщение записаны вместе', async (t) => {
  const { bill, mk, get } = await app(t, { resetMsgs: 2, plans: [{ id: 'pro', msgs: 300 }] });
  const u = mk({ ...paid('pro'), resetBal: 2 });
  bill.add(u.id, 'm', 300);
  assert.equal(bill.charge(get(u), HEAVY, { burst: false }).code, 'limit', 'сброс вернёт 2 сообщения, а нужно 3');
  assert.equal(get(u).resetBal, 2);
  const ch = bill.charge(get(u), MODEL, { burst: false });
  assert.equal(ch.ok, true); assert.equal(ch.autoReset, true);
  assert.equal(ch.receipts[0].source, 'reset');
  assert.equal(get(u).resetBal, 1);
  assert.equal(bill.used(u.id).m, 299, '300 − 2 возвращённых + 1 это сообщение');
});

/* ---------- BIZ-07 ---------- */
test('BIZ-07: раунд инструментов берётся из пакета, бонуса и сброса — как первое сообщение; возврат идёт в свой источник', async (t) => {
  const { bill, mk, get } = await app(t, { plans: [{ id: 'free', msgs: 5 }] });
  const u = mk({ msgPacks: [pack(2)], refBonus: { n: 1, until: Date.now() + DAY }, resetBal: 1 });
  bill.add(u.id, 'm', 4);
  const ch = bill.charge(get(u), MODEL, { burst: false });
  assert.equal(ch.receipts[0].source, 'plan');
  assert.equal(bill.left(get(u), 'm'), 0);
  assert.equal(bill.chargeRound(get(u), ch), true); assert.equal(bill.chargeRound(get(u), ch), true);
  assert.equal(get(u).msgPacks[0].left, 0, 'два раунда — из пакета');
  assert.equal(bill.chargeRound(get(u), ch), true);
  assert.equal(get(u).refBonus.n, 0, 'третий раунд — из бонуса за приглашение');
  assert.equal(bill.chargeRound(get(u), ch), true);
  assert.equal(get(u).resetBal, 0, 'четвёртый — сбросом с баланса');
  assert.deepEqual(ch.receipts.map((r) => r.source), ['plan', 'pack', 'pack', 'bonus', 'reset']);
  assert.deepEqual(ch.receipts.map((r) => !!r.round), [false, true, true, true, true]);
  assert.equal(bill.chargedOf(ch), 5);
  bill.refundRounds(get(u), ch);
  assert.equal(get(u).msgPacks[0].left, 2, 'пакет получил своё обратно');
  assert.equal(get(u).refBonus.n, 1, 'бонус получил своё обратно');
  assert.equal(bill.chargedOf(ch), 1, 'первое сообщение осталось списанным');
  const usedAfter = bill.used(u.id).m;
  bill.refundRounds(get(u), ch);
  assert.equal(bill.used(u.id).m, usedAfter, 'повторный возврат ничего не меняет');
  bill.refund(get(u), ch);
  assert.equal(bill.chargedOf(ch), 0);
});

test('BIZ-07: источников не осталось — раунд не списывается', async (t) => {
  const { bill, mk, get } = await app(t, { plans: [{ id: 'free', msgs: 1 }] });
  const u = mk();
  const ch = bill.charge(get(u), MODEL, { burst: false });
  assert.equal(bill.chargeRound(get(u), ch), false);
  assert.equal(ch.receipts.length, 1); assert.equal(bill.used(u.id).m, 1);
});

/* ---------- BIZ-08, BIZ-15, BIZ-19 ---------- */
test('BIZ-08: последнюю картинку получает один из двух одновременных запросов; несостоявшийся результат возвращает единицу', async (t) => {
  const { bill, mk, get } = await app(t, { plans: [{ id: 'free', images: 1, sites: 1, code: 1 }] });
  const u = mk();
  const a = bill.reserve(get(u), 'i'), b = bill.reserve(get(u), 'i'); // оба запроса — до ответа модели картинок
  assert.ok(a); assert.equal(b, null);
  assert.equal(bill.left(get(u), 'i'), 0);
  assert.equal(bill.release(a), true); assert.equal(bill.release(a), false, 'второй раз не возвращается');
  assert.equal(bill.left(get(u), 'i'), 1);
  const c = bill.reserve(get(u), 'i');
  assert.equal(bill.commit(c), true); assert.equal(bill.release(c), false, 'подтверждённый резерв не возвращается');
  assert.equal(bill.used(u.id).i, 1);
  for (const k of ['s', 'c']) { const r = bill.reserve(get(u), k); assert.ok(r); assert.equal(bill.reserve(get(u), k), null); bill.release(r); assert.equal(bill.used(u.id)[k], 0); }
  assert.equal(bill.reserve(get(u), 'zz'), null);
});

/* ---------- BIZ-10 ---------- */
test('BIZ-10: возврат за отмену без результата — не больше ABORT_REFUNDS в сутки; остановка сервером в счёт не идёт', async (t) => {
  const { bill, mk, get } = await app(t, { burst: 0 });
  const u = mk(paid('pro'));
  for (let i = 0; i < bill.ABORT_REFUNDS; i++) {
    const r = bill.settle(get(u), bill.charge(get(u), MODEL), { outcome: 'cancelled', delivered: { text: 0 } });
    assert.equal(r.keep, 'none'); assert.equal(r.charged, 0);
  }
  assert.equal(bill.used(u.id).m, 0);
  const over = bill.settle(get(u), bill.charge(get(u), MODEL), { outcome: 'cancelled', delivered: { text: 0 } });
  assert.deepEqual(over, { keep: 'all', capped: true, charged: 1 });
  assert.equal(bill.used(u.id).m, 1, 'сверх предела отмена остаётся списанной');
  const shut = bill.settle(get(u), bill.charge(get(u), MODEL), { outcome: 'cancelled', delivered: { text: 0 }, shutdown: true });
  assert.equal(shut.keep, 'none'); assert.equal(bill.used(u.id).m, 1, 'ответ остановил сервер — возврат всегда');
  const part = bill.settle(get(u), bill.charge(get(u), MODEL), { outcome: 'cancelled', delivered: { text: 15 } });
  assert.equal(part.keep, 'all'); assert.equal(bill.used(u.id).m, 2, 'после начала ответа отмена не возвращает списание');
});

/* ---------- BIZ-17 ---------- */
test('BIZ-17: продление лимита не превращает безлимит в конечную квоту', async (t) => {
  const { bill, mk, get } = await app(t);
  const ext = { limit: 50, until: Date.now() + DAY };
  const u = mk(ultraUser({ msgExt: ext })); // Ultra: msgs = null и nofair
  assert.equal(bill.planOf(get(u)).msgs, null);
  bill.add(u.id, 'm', 5000);
  assert.equal(bill.left(get(u), 'm'), Infinity);
  assert.equal(bill.charge(get(u), MODEL, { burst: false }).ok, true);
  // обычный тариф: продление по-прежнему поднимает лимит, а меньшее значение его не опускает
  const p = mk({ ...paid('pro'), msgExt: { limit: 500, until: Date.now() + DAY } });
  assert.equal(bill.planOf(get(p)).msgs, 500);
  const q = mk({ ...paid('pro'), msgExt: ext });
  assert.equal(bill.planOf(get(q)).msgs, 300);
});

test('BIZ-17: у безлимита с общим потолком продление поднимает только потолок', async (t) => {
  const { bill, mk, get } = await app(t, { fair: 100, plans: [{ id: 'max', msgs: null }] });
  const low = mk({ ...paid('max'), msgExt: { limit: 50, until: Date.now() + DAY } });
  assert.equal(bill.planOf(get(low)).msgs, null);
  assert.equal(bill.left(get(low), 'm'), 100, 'продление меньше потолка не урезает безлимит (раньше оставалось 50)');
  const high = mk({ ...paid('max'), msgExt: { limit: 250, until: Date.now() + DAY } });
  assert.equal(bill.planOf(get(high)).msgs, null);
  assert.equal(bill.left(get(high), 'm'), 250);
});

/* ---------- BIZ-18 ---------- */
test('BIZ-18: вес 0.1 считается целыми десятыми — десять сообщений дают ровно 1', async (t) => {
  const { bill, mk, get } = await app(t, { burst: 0, plans: [{ id: 'free', msgs: 1 }] });
  const u = mk({ msgPacks: [pack(0.3)] });
  const list = [];
  for (let i = 0; i < 10; i++) { const ch = bill.charge(get(u), LIGHT); assert.equal(ch.ok, true, 'сообщение ' + (i + 1)); list.push(ch); }
  assert.equal(bill.used(u.id).m, 1); assert.equal(bill.left(get(u), 'm'), 0);
  assert.equal(list.every((c) => c.receipts[0].source === 'plan'), true, 'все десять — из дневного лимита, пакет не тронут');
  for (let i = 0; i < 3; i++) assert.equal(bill.charge(get(u), LIGHT).receipts[0].source, 'pack');
  assert.equal(get(u).msgPacks[0].left, 0);
  assert.equal(bill.charge(get(u), LIGHT).code, 'limit');
  for (const ch of list) bill.refund(get(u), ch);
  assert.equal(bill.used(u.id).m, 0.3, 'после возврата десяти сообщений остались ровно три из пакета — без двоичных хвостов');
  assert.equal(bill.left(get(u), 'm'), 0.7);
});

/* ---------- BIZ-20 ---------- */
test('BIZ-20: многошаговый ответ через полночь по Москве — возврат уходит в свои сутки и свой источник', async (t) => {
  const { bill, store, mk, get, at } = await app(t, { plans: [{ id: 'free', msgs: 3 }] });
  const t0 = beforeMidnight(), d1 = mskDay(t0), d2 = mskDay(t0 + 20 * 60e3);
  assert.notEqual(d1, d2);
  at(t0);
  const u = mk({ msgPacks: [{ id: 'pk1', n: 1000, left: 5, until: t0 + 30 * DAY }] });
  bill.add(u.id, 'm', 2);
  const ch = bill.charge(get(u), MODEL, { burst: false }); // 23:50 — последнее сообщение лимита
  assert.equal(bill.chargeRound(get(u), ch), true);         // 23:50 — раунд из пакета
  at(t0 + 20 * 60e3);                                        // 00:10 следующих суток
  assert.equal(bill.used(u.id).m, 0, 'новые сутки — счётчик с нуля');
  assert.equal(bill.chargeRound(get(u), ch), true);         // раунд из нового дневного лимита
  assert.deepEqual(ch.receipts.map((r) => [r.day, r.source]), [[d1, 'plan'], [d1, 'pack'], [d2, 'plan']]);
  assert.equal(store.kv.get('usage:' + d1)[u.id].m, 4, 'вчера: 2 + сообщение + раунд из пакета');
  bill.add(u.id, 'm', 1); // сегодня человек отправил ещё одно сообщение
  bill.refund(get(u), ch);
  assert.equal(store.kv.get('usage:' + d1)[u.id].m, 2, 'вчерашние списания возвращены во вчерашние сутки');
  assert.equal(bill.used(u.id).m, 1, 'из сегодняшних суток возвращён только сегодняшний раунд');
  assert.equal(get(u).msgPacks[0].left, 5, 'пакет получил сообщение обратно');
});

test('BIZ-20: Ultra через полночь — подарок прошлых суток не возвращается, купленные кредиты и сегодняшний раунд возвращаются', async (t) => {
  const { bill, mk, get, at } = await app(t, { plans: [{ id: 'ultra', credits: 4 }], ultra: ULTRA_CFG });
  const t0 = beforeMidnight();
  at(t0);
  const u = mk({ plan: 'ultra', until: t0 + 30 * DAY, ultra: { bal: 10 } });
  const ch = bill.charge(get(u), ULTRA, { burst: false, ctxTokens: 1000 }); // 3 кредита из подарка (4)
  assert.equal(get(u).ultra.bonus, 1);
  at(t0 + 20 * 60e3);
  assert.equal(bill.chargeRound(get(u), ch, { ctxTokens: 1000 }), true);   // новые сутки: подарок снова 4, раунд — 3 из него
  assert.equal(get(u).ultra.bonus, 1); assert.equal(get(u).ultra.bal, 10);
  assert.equal(ch.took[0].day, mskDay(t0)); assert.equal(ch.took[1].day, mskDay(t0 + 20 * 60e3));
  bill.refund(get(u), ch);
  assert.equal(get(u).ultra.bonus, 4, 'вернулся только сегодняшний раунд: вчерашний подарок сгорел в полночь');
  assert.equal(get(u).ultra.bal, 10);
});

/* ---------- BIZ-21, API-01 ---------- */
test('BIZ-21: доплата Ultra за контекст берётся и за раунд инструментов, пересчитывается по факту отдельно для каждого запроса', async (t) => {
  const { bill, mk, get } = await app(t, { plans: [{ id: 'ultra', credits: 0 }], ultra: ULTRA_CFG });
  const u = mk(ultraUser({ ultra: { bal: 100 } }));
  const ch = bill.charge(get(u), ULTRA, { burst: false, ctxTokens: 1000 });
  assert.equal(ch.credits, 3);
  assert.equal(bill.ultraTopUp(get(u), ch, 45000), 6, 'первый запрос: системные заметки и инструменты подняли контекст до 45K');
  assert.equal(bill.chargeRound(get(u), ch, { ctxTokens: 45000 }), true);
  assert.equal(ch.credits, 18, '3 + 6 и раунд 3 + 6 (раньше раунд стоил только 3)');
  assert.equal(bill.ultraTopUp(get(u), ch, 65000, { round: true }), 4, 'раунд по факту оказался длиннее');
  assert.equal(ch.round.cost.total, 13); assert.equal(ch.cost.total, 9, 'пересчёт раунда не трогает цену первого запроса');
  assert.equal(get(u).ultra.bal, 78);
  bill.refundRounds(get(u), ch);
  assert.equal(get(u).ultra.bal, 91, 'возврат раундов: раунд и его доплата');
  bill.refund(get(u), ch);
  assert.equal(get(u).ultra.bal, 100);
});

test('BIZ-21: оценка выше факта возвращается один раз — полный возврат после пересчёта не удваивает её', async (t) => {
  const { bill, mk, get } = await app(t, { plans: [{ id: 'ultra', credits: 0 }], ultra: ULTRA_CFG });
  const u = mk(ultraUser({ ultra: { bal: 100 } }));
  const ch = bill.charge(get(u), ULTRA, { burst: false, ctxTokens: 45000 });
  assert.equal(get(u).ultra.bal, 91);
  assert.equal(bill.ultraTopUp(get(u), ch, 25000), -4);
  assert.equal(get(u).ultra.bal, 95);
  bill.refund(get(u), ch);
  assert.equal(get(u).ultra.bal, 100, 'ровно столько, сколько было (раньше возвращалось 104)');
});

test('BIZ-21, BIZ-20: пересчёт раунда вниз возвращает кредиты своего раунда, а не первого запроса из других суток', async (t) => {
  const { bill, mk, get, at } = await app(t, { plans: [{ id: 'ultra', credits: 4 }], ultra: ULTRA_CFG });
  const t0 = beforeMidnight();
  at(t0);
  const u = mk({ plan: 'ultra', until: t0 + 30 * DAY, ultra: { bal: 20 } });
  const ch = bill.charge(get(u), ULTRA, { burst: false, ctxTokens: 45000 }); // 9 кредитов: подарок 4 + купленные 5
  assert.deepEqual([get(u).ultra.bonus, get(u).ultra.bal], [0, 15]);
  at(t0 + 20 * 60e3);                                                        // новые сутки: подарок снова 4
  assert.equal(bill.chargeRound(get(u), ch, { ctxTokens: 25000 }), true);    // раунд 3 + 2: подарок 4 + купленные 1
  assert.deepEqual([get(u).ultra.bonus, get(u).ultra.bal], [0, 14]);
  assert.equal(bill.ultraTopUp(get(u), ch, 15000, { round: true }), -2, 'контекст раунда по факту короче — доплата 2 возвращается');
  assert.deepEqual([get(u).ultra.bonus, get(u).ultra.bal], [1, 15], 'из списаний раунда: 1 купленный и 1 подарочный (раньше — 2 купленных, один из них от первого запроса)');
  assert.deepEqual([ch.took[0].bonus, ch.took[0].bal], [4, 5], 'списание первого запроса не тронуто');
  bill.refundRounds(get(u), ch);
  assert.deepEqual([get(u).ultra.bonus, get(u).ultra.bal], [4, 15], 'остаток раунда вернулся в сегодняшний подарок');
  bill.refund(get(u), ch);
  assert.deepEqual([get(u).ultra.bonus, get(u).ultra.bal], [4, 20], 'первый запрос: купленные 5 вернулись полностью, вчерашний подарок сгорел');
});

test('API-01: пересчёт доплаты не выходит за переданный остаток предела ключа', async (t) => {
  const { bill, mk, get } = await app(t, { plans: [{ id: 'ultra', credits: 0 }], ultra: ULTRA_CFG });
  const u = mk(ultraUser({ ultra: { bal: 100 } }));
  const ch = bill.charge(get(u), ULTRA, { burst: false, api: true, ctxTokens: 1000 });
  assert.equal(bill.ultraTopUp(get(u), ch, 100000, { cap: 5 }), 5, 'по расчёту 16, остаток предела — 5');
  assert.equal(ch.credits, 8); assert.equal(get(u).ultra.bal, 92);
  assert.equal(bill.ultraTopUp(get(u), ch, 100000, { cap: 0 }), 0);
  assert.equal(get(u).ultra.bal, 92);
  assert.equal(bill.ultraTopUp(get(u), ch, 100000), 11, 'без предела добирается остальное');
});

/* ---------- BIZ-22, BIZ-23 ---------- */
test('BIZ-22, BIZ-23: политика исходов — одна таблица для всех исходов и видов результата', async (t) => {
  const { bill, mk, get } = await app(t, { burst: 0 });
  const u = mk(paid('pro'));
  // исход, что доставлено, ожидаемое keep, сколько остаётся списано из 3 (сообщение + 2 раунда)
  const rows = [
    ['complete', { text: 500 }, 'all', 3],
    ['complete', { text: 0 }, 'none', 0],
    ['complete', { text: 0, images: 1 }, 'all', 3],          // BIZ-22: текста нет, но картинка выдана
    ['complete', { text: 0, files: 2 }, 'all', 3],
    ['complete', { text: 0, actions: 1 }, 'all', 3],
    ['needs_clarification', { text: 80 }, 'all', 3],
    ['error', { text: 0 }, 'none', 0],
    ['error', { text: 199 }, 'none', 0],
    ['error', { text: 200 }, 'first', 1],
    ['timeout', { text: 5000 }, 'first', 1],
    ['upstream_error', { text: 10 }, 'none', 0],              // BIZ-14: оборванный в начале поток
    ['upstream_error', { text: 10, images: 1 }, 'first', 1],  // BIZ-22: картинка выдана — полного возврата нет
    ['upstream_error', { text: 0, actions: 1 }, 'first', 1],
    ['site_limit', { text: 40 }, 'none', 0],
    ['site_limit', { text: 900 }, 'first', 1],
    ['media_error', { text: 0 }, 'none', 0],
    ['edit_rejected', { text: 0 }, 'none', 0],
    ['repair_error', { text: 900 }, 'none', 0],               // BIZ-23: длинное «обещание» без результата — возврат
    ['missing_artifact', { text: 900 }, 'none', 0],
    ['cancelled', { text: 900 }, 'all', 3],
    ['что-то новое', { text: 900 }, 'all', 3],
  ];
  for (const [outcome, delivered, keep, charged] of rows) {
    const before = bill.used(u.id).m;
    const ch = bill.charge(get(u), MODEL); bill.chargeRound(get(u), ch); bill.chargeRound(get(u), ch);
    const r = bill.settle(get(u), ch, { outcome, delivered });
    assert.deepEqual([r.keep, r.charged], [keep, charged], outcome + ' ' + JSON.stringify(delivered));
    assert.equal(bill.used(u.id).m, before + charged, 'счётчик: ' + outcome);
  }
  assert.deepEqual(bill.settle(get(u), { error: 'x' }, { outcome: 'complete' }), { keep: 'none', capped: false, charged: 0 }, 'несостоявшееся списание');
  assert.equal(bill.MIN_TEXT, 200);
});

test('BIZ-23: та же политика для Ultra-кредитов', async (t) => {
  const { bill, mk, get } = await app(t, { plans: [{ id: 'ultra', credits: 0 }], ultra: ULTRA_CFG });
  const u = mk(ultraUser({ ultra: { bal: 100 } }));
  const run = (o) => { const ch = bill.charge(get(u), ULTRA, { burst: false, ctxTokens: 1000 }); bill.chargeRound(get(u), ch, { ctxTokens: 1000 }); return bill.settle(get(u), ch, o); };
  assert.equal(run({ outcome: 'missing_artifact', delivered: { text: 900 } }).charged, 0); assert.equal(get(u).ultra.bal, 100);
  assert.equal(run({ outcome: 'upstream_error', delivered: { text: 900 } }).charged, 3); assert.equal(get(u).ultra.bal, 97);
  assert.equal(run({ outcome: 'complete', delivered: { text: 900 } }).charged, 6); assert.equal(get(u).ultra.bal, 91);
});

/* ---------- BIZ-28 ---------- */
test('BIZ-28: статистика Ultra за 30 дней считается по суточным итогам, а не по журналу из 120 событий', async (t) => {
  const { bill, store, mk, get } = await app(t, { plans: [{ id: 'ultra', credits: 0 }], ultra: ULTRA_CFG });
  const u = mk(ultraUser({ ultra: { bal: 1000 } }));
  for (let i = 0; i < 200; i++) { const ch = bill.charge(get(u), ULTRA, { burst: false, ctxTokens: 1000 }); if (i % 4 === 0) bill.refund(get(u), ch); }
  assert.equal(get(u).ultraLog.length, 120, 'короткая история по-прежнему ограничена');
  const s = bill.ultraStats();
  assert.equal(s.spent, 600, '200 запросов по 3 кредита — все, а не последние 120 событий');
  assert.equal(s.refunded, 150);
  assert.equal(s.balance, 1000 - 600 + 150);
  const row = store.db.prepare('SELECT * FROM ultra_days WHERE day = ?').get(mskDay(Date.now()));
  assert.equal(row.spent, 6000, 'в таблице — десятые доли кредита');
  // сутки старше 30 дней в итог не входят, тридцатые — входят
  const put = (ms, n) => store.db.prepare('INSERT INTO ultra_days (day, bought) VALUES (?, ?)').run(mskDay(ms), n);
  put(Date.now() - 29 * DAY, 70); put(Date.now() - 30 * DAY, 9000);
  assert.equal(bill.ultraStats().bought, 7);
});

test('BIZ-28: при первом запуске суточные итоги собираются из уже записанной истории', async (t) => {
  const now = Date.now();
  const { bill, store } = await app(t, null, (st) => {
    st.users.put({ id: 'old1', login: 'old1', email: 'old1@example.com', created: new Date().toISOString(),
      ultraLog: [{ kind: 'buy', n: 100, at: now - 2 * DAY }, { kind: 'use', n: -12.5, at: now - 2 * DAY }, { kind: 'gift', n: 30, at: now - DAY },
        { kind: 'refund', n: 2, at: now - DAY }, { kind: 'api', n: -40, day: mskDay(now - DAY), at: now - DAY }] });
  });
  const s = bill.ultraStats();
  assert.deepEqual([s.bought, s.spent, s.gifted, s.refunded], [100, 52.5, 30, 2]);
  assert.equal(store.db.prepare('SELECT count(*) n FROM ultra_days').get().n, 2);
  assert.ok(store.kv.get('mig:ultraDays', null), 'перенос отмечен и не повторяется');
});

/* ---------- BIZ-38 ---------- */
test('BIZ-38: записи антиспама неактивных пользователей удаляются', async (t) => {
  const { bill, mk, get, at, realNow } = await app(t);
  const t0 = realNow();
  at(t0);
  const users = [mk(paid('pro')), mk(paid('pro')), mk(paid('pro'))];
  for (const u of users) assert.equal(bill.charge(get(u), MODEL).ok, true);
  assert.equal(bill.burstSize(), 3);
  at(t0 + 4 * 60e3);
  assert.equal(bill.sweepBurst(Date.now()), 3, 'окно 5 минут ещё не прошло');
  assert.equal(bill.charge(get(users[0]), MODEL).ok, true);
  at(t0 + 6 * 60e3);
  assert.equal(bill.sweepBurst(Date.now()), 1, 'остался только тот, кто писал 2 минуты назад');
  at(t0 + 20 * 60e3);
  const fresh = mk(paid('pro'));
  assert.equal(bill.charge(get(fresh), MODEL).ok, true); // очистка идёт сама — при очередном списании
  assert.equal(bill.burstSize(), 1);
});
