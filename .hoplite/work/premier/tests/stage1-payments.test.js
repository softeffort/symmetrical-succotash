// Этап 1 плана: платежи и оплаченные права. Журнал выдач (entitlements.js), строгие статусы платежа, возвраты после смены тарифа,
// пакеты, счёт команды, одноразовые предложения. Запуск: npm test (или node --test tests/stage1-payments.test.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { copyApp, rm } = require('../test/helpers');

const DAY = 864e5;
const U = (id, login) => ({ id, login, email: login + '@example.com', created: new Date().toISOString() });
const near = (a, b, msg, ms = 5000) => assert.ok(Math.abs(a - b) < ms, `${msg || ''}: ${a} ≈ ${b} (разница ${Math.round((a - b) / 1000)} с)`);

// копия приложения со своей базой; before(store) — данные «до обновления», которые должны лежать в базе к запуску
function app(t, { users = [U('u1', 'anna')], before, settings = {} } = {}) {
  const dir = copyApp();
  const store = require(path.join(dir, 'db.js'));
  for (const u of users) store.users.put(u);
  if (before) before(store);
  const bill = require(path.join(dir, 'billing.js')), ent = require(path.join(dir, 'entitlements.js'));
  bill.init({ loadSettings: () => settings, saveSettings() {}, onPaid() {} });
  t.after(() => { try { bill.flush(); } catch {} store.db.close(); rm(dir); });
  let n = 0;
  const order = (uid, plan, days, amount, o = {}) => { const id = o.id || 'p' + (++n); store.payments.put({ id, tx: 'tx-' + id, uid, login: uid, plan, days, amount, status: 'PENDING', created: Date.now(), ...o }); return id; };
  const set = (id, status, o) => bill.apply(store.payments.get(id), status, o);
  const buy = (uid, plan, days, amount, o) => { const id = order(uid, plan, days, amount, o); set(id, 'CONFIRMED'); return id; };
  return { dir, bill, store, ent, order, set, buy, get: (id) => store.users.get(id), pay: (id) => store.payments.get(id) };
}
// часы теста: только Date, таймеры настоящие
const clock = (t) => { t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); return (ms) => t.mock.timers.tick(ms); };

/* ---------- BIZ-01: возврат после смены тарифа ---------- */
test('BIZ-01: Pro → Max → возврат первого платежа уменьшает срок ровно на долю первого платежа', (t) => {
  const { bill, ent, buy, set, get, pay } = app(t), t0 = Date.now();
  const p1 = buy('u1', 'pro', 30, 390);
  near(get('u1').until, t0 + 30 * DAY, 'Pro на 30 дней');
  const p2 = buy('u1', 'max', 30, 990);
  const share = 30 * DAY * (390 / 30) / (990 / 30); // остаток Pro в днях Max: по цене дня
  assert.equal(get('u1').plan, 'max'); near(get('u1').until, t0 + share + 30 * DAY, 'остаток Pro пересчитан в Max и стоит перед оплаченным Max');

  set(p1, 'CHARGEBACKED');
  assert.equal(get('u1').plan, 'max'); near(get('u1').until, t0 + 30 * DAY, 'ушла ровно доля первого платежа');
  assert.equal(bill.planOf(get('u1')).id, 'max');
  const rows = ent.bySrc(p1);
  assert.deepEqual(rows.map((r) => [r.plan, r.why]), [['pro', 'convert'], ['max', 'refund']], 'строка Pro закрыта сменой тарифа, полученная из неё строка Max отозвана возвратом');
  assert.equal(rows[1].from_id, rows[0].id, 'новая строка помнит, из какой получена');
  assert.equal(pay(p1).applied, false); assert.ok(pay(p1).revoked > 0);

  set(p2, 'CHARGEBACKED');
  assert.ok(!(get('u1').until > Date.now()), 'после возврата обоих платежей доступа нет');
  assert.equal(bill.planOf(get('u1')).id, 'free');
});

test('BIZ-01: возврат забирает неизрасходованные дни своего платежа, а чужие дни сдвигаются раньше', (t) => {
  const { ent, buy, set, get } = app(t), tick = clock(t), t0 = Date.now();
  const p1 = buy('u1', 'pro', 30, 390), p2 = buy('u1', 'pro', 30, 390);
  assert.equal(get('u1').until, t0 + 60 * DAY);
  tick(10 * DAY); // 10 дней первого платежа израсходованы
  set(p1, 'CHARGEBACKED');
  assert.equal(get('u1').until, Date.now() + 30 * DAY, 'остались 30 дней второго платежа, они начинаются сейчас');
  assert.deepEqual(ent.live({ uid: 'u1' }).map((r) => [r.pay_id, r.starts, r.ends]), [[p2, Date.now(), Date.now() + 30 * DAY]]);
  tick(31 * DAY);
  set(p2, 'CHARGEBACKED'); // срок уже вышел — забирать нечего
  assert.equal(get('u1').until, Date.now() - DAY, 'израсходованное не уходит в минус');
});

test('BIZ-01: бонусные дни за приглашение отзываются возвратом платежа и после смены тарифа пригласившим', (t) => {
  const { bill, store, buy, set, get } = app(t, { users: [U('inv', 'inna'), U('fr', 'fedor')] }), t0 = Date.now();
  store.db.prepare("INSERT INTO referrals (id, ref, ip, fp, status, msg, paid, at) VALUES ('fr', 'inv', '', '', 'pending', 0, 0, ?)").run(t0);
  const p = buy('fr', 'pro', 30, 390);
  near(get('inv').until, t0 + 3 * DAY, 'пригласившему +3 дня Pro'); near(get('fr').until, t0 + 33 * DAY, 'другу 30 + 3');
  const own = buy('inv', 'max', 30, 990); // пригласивший перешёл на Max: его бонус пересчитан в дни Max
  const bonusInMax = 3 * DAY * 13 / 33;
  near(get('inv').until, t0 + bonusInMax + 30 * DAY, 'бонус стал днями Max');

  set(p, 'CHARGEBACKED');
  assert.equal(get('inv').plan, 'max'); near(get('inv').until, t0 + 30 * DAY, 'бонус ушёл, оплаченный Max остался');
  assert.ok(!(get('fr').until > Date.now()), 'у друга забраны и оплаченные, и бонусные дни');
  assert.equal(bill.refInfo(get('inv')).rewarded, 0);
  set(own, 'CHARGEBACKED'); assert.ok(!(get('inv').until > Date.now()));
});

test('BIZ-01: срок задан из панели после оплаты — возврат действует по прежнему правилу (минус дни, если тариф тот же)', (t) => {
  const { bill, ent, buy, set, get } = app(t), t0 = Date.now();
  const p1 = buy('u1', 'pro', 30, 390);
  bill.setPlan('u1', 'pro', 90, false); // панель: «Pro на 90 дней» вместо прежнего срока
  near(get('u1').until, t0 + 90 * DAY, 'срок из панели');
  assert.deepEqual(ent.bySrc(p1).map((r) => r.why), ['override']);
  set(p1, 'CHARGEBACKED');
  near(get('u1').until, t0 + 60 * DAY, 'минус 30 дней платежа');
  const p2 = buy('u1', 'pro', 30, 390);
  bill.setPlan('u1', 'max', 10, false);
  set(p2, 'CHARGEBACKED');
  assert.equal(get('u1').plan, 'max'); near(get('u1').until, t0 + 10 * DAY, 'другой тариф, заданный вручную, возврат не трогает');
  bill.setPlan('u1', 'free');
  assert.equal(get('u1').plan, undefined); assert.equal(ent.live({ uid: 'u1' }).length, 0);
  bill.setPlan('u1', 'pro', 5, true); bill.setPlan('u1', 'pro', 5, true);
  near(get('u1').until, t0 + 10 * DAY, 'продление из панели складывается');
});

test('BIZ-01: подписки, оплаченные до обновления, получают строки журнала и возвращаются по ним', (t) => {
  const now = Date.now();
  const { bill, store, ent, buy, set, get } = app(t, { users: [{ ...U('u1', 'anna'), plan: 'pro', until: now + 50 * DAY }, U('u2', 'boris')], before: (store) => {
    store.payments.put({ id: 'old1', tx: 'o1', uid: 'u1', login: 'anna', plan: 'pro', days: 30, amount: 390, status: 'CONFIRMED', applied: true, created: now - 40 * DAY, paid: now - 40 * DAY });
    store.payments.put({ id: 'old2', tx: 'o2', uid: 'u1', login: 'anna', plan: 'pro', days: 30, amount: 390, status: 'CONFIRMED', applied: true, created: now - 10 * DAY, paid: now - 10 * DAY });
  } });
  assert.equal(store.kv.get('ent:migrated').users, 1);
  const live = ent.live({ uid: 'u1' });
  assert.deepEqual(live.map((r) => r.pay_id), ['old1', 'old2'], 'оплаты уложены от конца срока назад');
  near(live[1].ends, now + 50 * DAY, 'конец очереди — срок пользователя'); near(live[1].starts, now + 20 * DAY, 'новая оплата — последние 30 дней');
  near(live[0].starts, now - 10 * DAY, 'старая оплата частично израсходована');
  assert.equal(get('u1').until, now + 50 * DAY, 'срок пользователя не изменился');

  buy('u1', 'max', 30, 990); // смена тарифа уже после обновления
  const before = get('u1').until;
  set('old2', 'CHARGEBACKED');
  near(before - get('u1').until, 30 * DAY * 13 / 33, 'возврат старой оплаты после смены тарифа забирает её долю');
  bill.migrateLedger(); assert.equal(ent.bySrc('old1').length, 2, 'повторный запуск ничего не добавляет');
});

/* ---------- BIZ-02: строгие статусы ---------- */
test('BIZ-02: CONFIRMED → CHARGEBACKED → CONFIRMED: права выданы один раз и отозваны один раз', (t) => {
  const { order, set, get, pay } = app(t), t0 = Date.now();
  const p = order('u1', 'pro', 30, 390);
  set(p, 'CONFIRMED'); set(p, 'CONFIRMED');
  near(get('u1').until, t0 + 30 * DAY, 'выдано один раз');
  set(p, 'CHARGEBACKED'); set(p, 'CHARGEBACKED');
  assert.ok(!(get('u1').until > Date.now()), 'отозвано');
  set(p, 'CONFIRMED'); set(p, 'CONFIRMED', { verified: true });
  assert.equal(pay(p).status, 'CHARGEBACKED', 'возврат окончателен');
  assert.ok(!(get('u1').until > Date.now()), 'повторное «оплачен» ничего не выдаёт');
  assert.deepEqual([pay(p).ignored.from, pay(p).ignored.to], ['CHARGEBACKED', 'CONFIRMED'], 'отклонённый переход записан в платеже');
});

test('BIZ-02: сбросы, кредиты и пакет не выдаются повторно и не отзываются дважды', (t) => {
  const { bill, order, set, get, pay } = app(t);
  const r = order('u1', 'reset', 0, 900, { qty: 5 }), c = order('u1', 'credits', 0, 500, { qty: 50 }), k = order('u1', 'pack', 0, 190, { pack: { n: 1000, days: 30 } });
  for (const id of [r, c, k]) set(id, 'CONFIRMED');
  assert.equal(get('u1').resetBal, 5); assert.equal(get('u1').ultra.bal, 50); assert.equal(bill.packLeft(get('u1')), 1000);
  for (const id of [r, c, k]) { set(id, 'CHARGEBACKED'); set(id, 'CONFIRMED'); set(id, 'CHARGEBACKED'); }
  assert.equal(get('u1').resetBal, 0); assert.equal(get('u1').ultra.bal, 0); assert.equal(bill.packLeft(get('u1')), 0);
  for (const id of [r, c, k]) { assert.equal(pay(id).status, 'CHARGEBACKED'); assert.equal(pay(id).applied, false); }
  // купленное позже другим платежом повторный возврат первого не трогает
  const r2 = order('u1', 'reset', 0, 900, { qty: 5 }); set(r2, 'CONFIRMED'); set(r, 'CHARGEBACKED'); set(r, 'CONFIRMED');
  assert.equal(get('u1').resetBal, 5);
});

test('BIZ-02: оплаченный счёт не возвращается в «ожидает» и «отменён»; отменённый оплачивается только по подтверждению провайдера', (t) => {
  const { order, set, get, pay } = app(t), t0 = Date.now();
  const a = order('u1', 'pro', 30, 390);
  set(a, 'CONFIRMED'); set(a, 'PENDING'); set(a, 'CANCELED');
  assert.equal(pay(a).status, 'CONFIRMED'); near(get('u1').until, t0 + 30 * DAY, 'доступ на месте');

  const b = order('u1', 'pro', 30, 390);
  set(b, 'CANCELED'); set(b, 'PENDING'); assert.equal(pay(b).status, 'CANCELED');
  set(b, 'CONFIRMED'); // уведомление без подтверждения
  assert.equal(pay(b).status, 'CANCELED'); near(get('u1').until, t0 + 30 * DAY, 'без подтверждения дни не выданы');
  set(b, 'CONFIRMED', { verified: true });
  assert.equal(pay(b).status, 'CONFIRMED'); near(get('u1').until, t0 + 60 * DAY, 'с подтверждением провайдера — выданы');

  const c = order('u1', 'pro', 30, 390);
  set(c, 'EXPIRED'); set(c, ''); set(c, 'confirmed-ish');
  assert.equal(pay(c).status, 'PENDING', 'незнакомый статус не записывается');
  set(c, 'chargeback'); assert.equal(pay(c).status, 'CHARGEBACKED', 'возврат неоплаченного счёта — только статус');
  near(get('u1').until, t0 + 60 * DAY, 'ничего не отозвано: по этому счёту ничего не выдавали');
  const d = order('u1', 'pro', 30, 390); set(d, 'CANCELLED'); assert.equal(pay(d).status, 'CANCELED', 'вариант написания');
});

/* ---------- BIZ-16: пересчёт по цене дня ---------- */
test('BIZ-16: остаток при смене тарифа считается по цене дня, а не по цене периода', (t) => {
  const { bill, store, buy, get } = app(t), t0 = Date.now();
  const c = bill.cfg(); c.plans.find((p) => p.id === 'max').price = 2970; c.plans.find((p) => p.id === 'max').days = 90; store.kv.set('plans', c); // Max продаётся кварталом: те же 33 ₽ в день
  buy('u1', 'pro', 30, 390); buy('u1', 'max', 90, 2970);
  near(get('u1').until, t0 + 30 * DAY * 13 / 33 + 90 * DAY, '30 дней Pro по 13 ₽ = 11,8 дня Max по 33 ₽ (по цене периода вышло бы 3,9 дня)');
});

/* ---------- BIZ-26: бонусные дни участника команды ---------- */
test('BIZ-26: бонусные дни участника команды включаются после доступа команды, а не сгорают под ним', (t) => {
  const { bill, store, order, buy, set, get } = app(t, { users: [U('own', 'olga'), U('mem', 'mark'), U('fr', 'fedor')] }), T = bill.teams, t0 = Date.now();
  const tp = buy('own', 'team', 30, 1050, { team: { seats: 3, months: 1, days: 30, name: 'Отдел' } });
  T.join(get('mem'), T.info(get('own')).code);
  assert.equal(bill.planOf(get('mem')).team, 'Отдел');
  store.db.prepare("INSERT INTO referrals (id, ref, ip, fp, status, msg, paid, at) VALUES ('fr', 'mem', '', '', 'pending', 0, 0, ?)").run(t0);
  buy('fr', 'pro', 30, 390); // друг участника оплатил: участнику +3 дня Pro

  let m = get('mem');
  near(m.planFrom, t0 + 30 * DAY, 'бонус начнётся, когда закончится доступ команды'); near(m.until, t0 + 33 * DAY, 'и продлится 3 дня');
  assert.equal(bill.planOf(m).team, 'Отдел', 'пока действует место в команде');
  near(bill.planOf(m).until, t0 + 30 * DAY, 'срок в кабинете — срок команды');

  // команду продлили — бонус сдвигается дальше
  buy('own', 'team', 30, 1050, { team: { seats: 3, months: 1, days: 30 } });
  near(get('mem').planFrom, t0 + 60 * DAY, 'после продления команды'); near(get('mem').until, t0 + 63 * DAY, 'те же 3 дня');

  // участник вышел — бонус начинается сейчас
  T.leave(get('mem')); bill.reanchor('mem');
  m = get('mem');
  assert.equal(m.planFrom, undefined); near(m.until, t0 + 3 * DAY, '3 дня с выхода из команды');
  assert.equal(bill.planOf(m).id, 'pro'); assert.equal(bill.planOf(m).team, undefined);

  // владелец команды: возврат оплаты команды забирает срок команды, бонус участника не страдает
  set(tp, 'CHARGEBACKED');
  near(T.info(get('own')).until, t0 + 30 * DAY, 'у команды остался срок второй оплаты');
});

test('BIZ-26: оплата своего тарифа включает отложенный бонус сразу; без места в команде бонус начинается сразу', (t) => {
  const { bill, store, buy, get } = app(t, { users: [U('own', 'olga'), U('mem', 'mark'), U('f1', 'fedor'), U('solo', 'sasha'), U('f2', 'faina')] }), T = bill.teams, t0 = Date.now();
  buy('own', 'team', 30, 1050, { team: { seats: 3, months: 1, days: 30, name: 'Отдел' } });
  T.join(get('mem'), T.info(get('own')).code);
  const ins = store.db.prepare("INSERT INTO referrals (id, ref, ip, fp, status, msg, paid, at) VALUES (?, ?, '', '', 'pending', 0, 0, ?)");
  ins.run('f1', 'mem', t0); ins.run('f2', 'solo', t0);
  buy('f1', 'pro', 30, 390); buy('f2', 'pro', 30, 390);
  near(get('solo').until, t0 + 3 * DAY, 'без команды бонус идёт сразу'); assert.equal(get('solo').planFrom, undefined);
  assert.ok(get('mem').planFrom > t0 + 29 * DAY);
  buy('mem', 'pro', 30, 390); // участник сам купил Pro
  assert.equal(get('mem').planFrom, undefined); near(get('mem').until, t0 + 33 * DAY, 'бонус и оплаченные дни идут подряд с сегодняшнего дня');
});

/* ---------- выставление счетов: подставной Platega ---------- */
const PLATEGA = { platega: { merchant: 'm1', secret: 's1' } };
// fetch отвечает как Platega: создание счёта — ссылка, запрос статуса — то, что задано в st[tx] (по умолчанию PENDING; 'ERR' — провайдер недоступен)
function platega(t, { delay = 0 } = {}) {
  const st = {}, log = { made: 0, asked: [], peak: 0 }; let n = 0, busy = 0;
  t.mock.method(globalThis, 'fetch', async (url, o = {}) => {
    url = String(url);
    if (o.method === 'POST') { log.made++; const tx = 'tx' + (++n); return new Response(JSON.stringify({ transactionId: tx, redirect: 'https://pay.example/' + tx }), { status: 200 }); }
    const tx = decodeURIComponent(url.split('/').pop()); log.asked.push(tx); busy++; log.peak = Math.max(log.peak, busy);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    busy--;
    if (st[tx] === 'ERR') throw new Error('сеть недоступна');
    return new Response(JSON.stringify({ status: st[tx] || 'PENDING' }), { status: 200 });
  });
  return { st, log };
}
const make = (bill, u, plan, o = {}) => bill.create(u, plan, o.promo || null, o.origin || 'https://premier.example', '10.0.0.1', 'card', o.opts);

/* ---------- BIZ-04: счёт команды ---------- */
test('BIZ-04: счёт команды, выставленный до изменения команды, применяется пересчётом, а не старыми числами', (t) => {
  const { bill, order, set, get, pay } = app(t, { users: [U('own', 'olga')] }), T = bill.teams, per = bill.periods(), t0 = Date.now();
  const inv = (q) => order('own', 'team', q.days, q.amount, { team: { seats: q.seats, months: q.months, days: q.days, ver: q.ver, addSeats: q.addSeats, restDays: q.restDays } });
  const team = () => T.info(get('own'));
  const q0 = T.quote(get('own'), 3, 1, per); assert.equal(q0.ver, -1, 'команды ещё нет');
  set(inv(q0), 'CONFIRMED');
  assert.equal(team().seats, 3); near(team().until, t0 + 30 * DAY, 'новая команда: 3 места на 30 дней');

  // два счёта посчитаны для одной и той же команды: «продлить 3 места» и «10 мест на месяц»
  const qa = T.quote(get('own'), 3, 1, per), qb = T.quote(get('own'), 10, 1, per);
  assert.equal(qa.ver, qb.ver); assert.equal(qb.addSeats, 7);
  const a = inv(qa), b = inv(qb);
  set(b, 'CONFIRMED');
  assert.equal(team().seats, 10); near(team().until, t0 + 60 * DAY, 'свежий счёт применён как выставлен');
  assert.equal(pay(b).team.recalc, undefined); assert.equal(pay(b).team.delta, 7);
  assert.notEqual(T.quote(get('own'), 10, 1, per).ver, qa.ver, 'состояние команды изменилось');

  set(a, 'CONFIRMED'); // устаревший счёт: 3 места × 30 дней = 90 место-дней на команду из 10 мест
  assert.equal(team().seats, 10, 'оплаченные 10 мест не превращаются в 3');
  near(team().until, t0 + 69 * DAY, '90 место-дней на 10 мест = 9 дней');
  assert.deepEqual([pay(a).team.recalc.seats, pay(a).team.recalc.days, pay(a).team.delta], [10, 9, 0]);

  set(a, 'CHARGEBACKED');
  assert.equal(team().seats, 10); near(team().until, t0 + 60 * DAY, 'возврат забирает то, что счёт дал после пересчёта: 9 дней');
  set(b, 'CHARGEBACKED');
  assert.equal(team().seats, 3, 'возврат забирает 7 мест этого счёта'); near(team().until, t0 + 30 * DAY, 'и его 30 дней');
});

test('BIZ-04: устаревшая докупка мест не уменьшает команду; счёт без версии (до обновления) применяется как раньше', (t) => {
  const { bill, order, set, get, pay } = app(t, { users: [U('own', 'olga')] }), T = bill.teams, per = bill.periods(), t0 = Date.now();
  const inv = (q) => order('own', 'team', q.days, q.amount, { team: { seats: q.seats, months: q.months, days: q.days, ver: q.ver, addSeats: q.addSeats, restDays: q.restDays } });
  const team = () => T.info(get('own'));
  set(inv(T.quote(get('own'), 3, 1, per)), 'CONFIRMED');
  const c = inv(T.quote(get('own'), 5, 0, per)), d = inv(T.quote(get('own'), 10, 0, per)); // докупки до 5 и до 10 мест, обе от 3 мест
  set(d, 'CONFIRMED'); assert.equal(team().seats, 10); near(team().until, t0 + 30 * DAY, 'докупка срок не меняет');
  set(c, 'CONFIRMED'); // оплачено 2 места × 30 дней; мест уже 10
  assert.equal(team().seats, 10, 'не 5'); near(team().until, t0 + 36 * DAY, '60 место-дней на 10 мест = 6 дней');
  assert.equal(pay(c).team.recalc.seats, 10);

  const old = order('own', 'team', 30, 1050, { team: { seats: 4, months: 1, days: 30 } }); // без ver
  set(old, 'CONFIRMED');
  assert.equal(team().seats, 4, 'прежнее правило: числа из счёта'); near(team().until, t0 + 66 * DAY, '+30 дней'); assert.equal(pay(old).team.recalc, undefined);
});

/* ---------- BIZ-05: пакеты сообщений ---------- */
test('BIZ-05: 21 оплаченный пакет — все остатки на месте; при 20 действующих новый счёт не выставляется', async (t) => {
  const { bill, buy, set, get } = app(t, { settings: PLATEGA }); const pg = platega(t);
  const ids = []; for (let i = 0; i < 19; i++) ids.push(buy('u1', 'pack', 0, 190, { pack: { n: 1000, days: 30 } }));
  const r = await make(bill, get('u1'), 'pack', { opts: { n: 1000 } }); assert.ok(r.url && r.order, 'при 19 пакетах счёт выставляется');
  set(r.order, 'CONFIRMED');
  await assert.rejects(make(bill, get('u1'), 'pack', { opts: { n: 3000 } }), /уже 20 действующих пакетов/);
  assert.equal(pg.log.made, 1, 'отказ — до обращения к провайдеру');
  buy('u1', 'pack', 0, 190, { pack: { n: 1000, days: 30 } }); // счёт, выставленный раньше предела, оплачен 21-м
  assert.equal(bill.packList(get('u1')).length, 21); assert.equal(bill.packLeft(get('u1')), 21000, 'ни один оплаченный пакет не пропал');
  set(ids[0], 'CHARGEBACKED'); assert.equal(bill.packLeft(get('u1')), 20000, 'возврат гасит только свой пакет');
});

/* ---------- BIZ-03: одноразовые предложения ---------- */
test('BIZ-03: повторный запрос того же счёта возвращает прежнюю ссылку; оплата двух счетов с пробным периодом даёт пробный период один раз', async (t) => {
  const { bill, set, get, pay } = app(t, { settings: PLATEGA }); const pg = platega(t), t0 = Date.now();
  bill.saveCfg({ trials: { pro: { on: true, price: 9, days: 3 } } }); // пробный дешевле обычной цены дня (13 ₽)
  const a = await make(bill, get('u1'), 'trial'), again = await make(bill, get('u1'), 'trial');
  assert.equal(again.order, a.order, 'тот же счёт'); assert.equal(again.url, a.url); assert.equal(again.reused, true);
  assert.equal(pg.log.made, 1, 'второй счёт у провайдера не создан');
  const b = await make(bill, get('u1'), 'trial', { origin: 'https://www.premier.example' }); // другой адрес сайта — счёт другой
  assert.notEqual(b.order, a.order);

  set(a.order, 'CONFIRMED');
  near(get('u1').until, t0 + 3 * DAY, 'пробный период: 3 дня');
  set(b.order, 'CONFIRMED');
  near(get('u1').until, t0 + (3 + 0.69) * DAY, 'второй счёт: 9 ₽ по обычной цене дня = 0,69 дня, а не ещё 3 дня');
  assert.deepEqual([pay(b.order).recalc.why, pay(b.order).recalc.days, pay(b.order).days], ['trial', 3, 0.69]);
  await assert.rejects(make(bill, get('u1'), 'trial'), /доступен один раз/);

});

test('BIZ-03: скидка первой покупки и промокод с лимитом срабатывают один раз, даже если счетов выставлено несколько', async (t) => {
  const { bill, store, set, get, pay } = app(t, { users: [U('u1', 'anna'), U('u2', 'boris')], settings: PLATEGA }); platega(t); const t0 = Date.now();
  // скидка первой покупки: два счёта по 273 ₽ вместо 390 ₽
  const a = await make(bill, get('u1'), 'pro'), b = await make(bill, get('u1'), 'pro', { origin: 'https://www.premier.example' });
  assert.equal(pay(a.order).amount, 273); assert.equal(pay(b.order).discount.kind, 'first');
  set(a.order, 'CONFIRMED'); set(b.order, 'CONFIRMED');
  near(get('u1').until, t0 + (30 + 21) * DAY, 'второй счёт: 273 ₽ по обычной цене = 21 день, а не 30');
  assert.equal(pay(b.order).recalc.why, 'first'); assert.equal(pay(a.order).recalc, undefined);

  // промокод на одну активацию: счёт первого человека занимает её, второму счёт со скидкой не выставляется
  store.kv.set('promos', [{ code: 'ONCE', kind: 'discount', percent: 50, max: 1, used: 0, by: [] }]);
  const c = await make(bill, get('u1'), 'max', { promo: 'ONCE' }); assert.equal(pay(c.order).amount, 495);
  await assert.rejects(make(bill, get('u2'), 'max', { promo: 'ONCE' }), /уже выставлены счета на все оставшиеся активации/);
  const d = await make(bill, get('u1'), 'max', { promo: 'ONCE', origin: 'https://www.premier.example' }); // свой второй счёт — можно
  set(c.order, 'CONFIRMED'); const mid = get('u1').until; set(d.order, 'CONFIRMED');
  near(mid, t0 + (51 * 13 / 33 + 30) * DAY, '51 день Pro пересчитан в Max, плюс 30 оплаченных дней');
  assert.equal(store.kv.get('promos')[0].used, 1, 'промокод израсходован один раз'); assert.deepEqual(store.kv.get('promos')[0].by, ['u1']);
  assert.equal(pay(d.order).recalc.why, 'promo'); near(get('u1').until - mid, 15 * DAY, '495 ₽ по обычной цене Max = 15 дней');
  await assert.rejects(make(bill, get('u2'), 'max', { promo: 'ONCE' }), /использован максимальное число раз/);
});

/* ---------- BIZ-25: подарки и бонусы за приглашение ---------- */
test('BIZ-25: сбой при начислении за приглашение отменяет начисление целиком, оплата проходит, начисление повторяется', (t) => {
  const { bill, store, buy, get, pay } = app(t, { users: [U('inv', 'inna'), U('fr', 'fedor')] }), t0 = Date.now();
  store.db.prepare("INSERT INTO referrals (id, ref, ip, fp, status, msg, paid, at) VALUES ('fr', 'inv', '', '', 'pending', 0, 0, ?)").run(t0);
  const real = store.users.update; let broken = true;
  store.users.update = (id, fn) => { if (broken && id === 'inv') throw new Error('диск переполнен'); return real(id, fn); };
  const p = buy('fr', 'pro', 30, 390);
  assert.equal(pay(p).status, 'CONFIRMED'); near(get('fr').until, t0 + 30 * DAY, 'оплаченные дни выданы; бонус друга отменён вместе с бонусом пригласившего');
  assert.ok(!get('inv').until, 'пригласившему ничего не начислено');
  assert.equal(pay(p).refPending.n, 1); assert.match(pay(p).refPending.err, /диск переполнен/); assert.equal(pay(p).ref, undefined);
  assert.equal(store.db.prepare("SELECT paid FROM referrals WHERE id = 'fr'").get().paid, 0, 'приглашение не отмечено оплаченным');
  assert.deepEqual(store.kv.get('ref:pending'), [p]);

  assert.equal(bill.refRetry(), 0); assert.equal(pay(p).refPending.n, 2, 'повтор не прошёл — остаётся в очереди');
  broken = false;
  assert.equal(bill.refRetry(), 1);
  near(get('fr').until, t0 + 33 * DAY, 'другу +3 дня'); near(get('inv').until, t0 + 3 * DAY, 'пригласившему +3 дня');
  assert.equal(pay(p).refPending, undefined); assert.equal(pay(p).ref.inviter.uid, 'inv'); assert.equal(store.kv.get('ref:pending', null), null);
  assert.equal(bill.refRetry(), 0); near(get('inv').until, t0 + 3 * DAY, 'второй раз не начисляется');
  bill.apply(pay(p), 'CHARGEBACKED'); assert.ok(!(get('inv').until > Date.now()), 'возврат забирает и начисленное повтором');
});

test('BIZ-25: подарочный промокод — дни и расход кода вместе: сбой выдачи не сжигает код', (t) => {
  const { bill, store, get } = app(t), t0 = Date.now();
  store.kv.set('promos', [{ code: 'GIFT', kind: 'gift', plan: 'pro', days: 7, max: 1, used: 0, by: [] }]);
  const real = store.users.put; let broken = true;
  store.users.put = (u) => { if (broken) throw new Error('диск переполнен'); return real(u); };
  assert.throws(() => bill.redeem(get('u1'), 'gift'), /диск переполнен/);
  assert.equal(store.kv.get('promos')[0].used, 0, 'код не израсходован'); assert.equal(bill.ent.live({ uid: 'u1' }).length, 0, 'строка журнала отменена');
  broken = false;
  const r = bill.redeem(get('u1'), 'gift'); assert.equal(r.gift, true); near(get('u1').until, t0 + 7 * DAY, '7 дней');
  assert.equal(store.kv.get('promos')[0].used, 1); assert.ok(bill.redeem(get('u1'), 'gift').error, 'второй раз код не действует');
});

/* ---------- BIZ-27: автопроверка неоплаченных счетов ---------- */
test('BIZ-27: автопроверка берёт только неоплаченные счета, не больше 4 одновременно, старые — реже, недоступный провайдер — с паузой', async (t) => {
  const { bill, store, order, get, pay } = app(t, { settings: PLATEGA }); const pg = platega(t, { delay: 15 }), now = Date.now(), MIN = 60e3;
  for (let i = 0; i < 30; i++) order('u1', 'pro', 30, 390, { id: 'done' + i, status: 'CONFIRMED', applied: true, created: now - 5 * MIN }); // оплаченные не опрашиваются
  for (let i = 0; i < 9; i++) order('u1', 'reset', 0, 180, { id: 'new' + i, tx: 'n' + i, qty: 1, created: now - MIN });
  order('u1', 'reset', 0, 180, { id: 'mid', tx: 'mid', qty: 1, created: now - 30 * MIN });
  order('u1', 'reset', 0, 180, { id: 'old', tx: 'old', qty: 1, created: now - 5 * 60 * MIN });
  order('u1', 'reset', 0, 180, { id: 'gone', tx: 'gone', qty: 1, created: now - 25 * 60 * MIN }); // старше суток
  order('u1', 'reset', 0, 180, { id: 'rb', tx: 'rb', qty: 1, provider: 'robokassa', created: now - MIN });
  pg.st.n0 = 'CONFIRMED'; pg.st.n1 = 'ERR';

  assert.equal(await bill.autoConfirmTick(now), 11);
  assert.deepEqual([...pg.log.asked].sort(), ['mid', 'n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'old'], 'оплаченные, суточной давности и Robokassa не опрашиваются');
  assert.ok(pg.log.peak <= 4 && pg.log.peak > 1, 'одновременно не больше 4 запросов: ' + pg.log.peak);
  assert.equal(pay('new0').status, 'CONFIRMED'); assert.equal(get('u1').resetBal, 1, 'оплаченное выдано');

  pg.log.asked.length = 0;
  assert.equal(await bill.autoConfirmTick(Date.now() + 20e3), 7, 'через 20 с: только свежие счета, кроме оплаченного и того, где провайдер не ответил');
  assert.deepEqual([...pg.log.asked].sort(), ['n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8']);
  pg.log.asked.length = 0; pg.st.n1 = 'PENDING';
  await bill.autoConfirmTick(Date.now() + 70e3);
  assert.ok(pg.log.asked.includes('mid') && pg.log.asked.includes('n1') && !pg.log.asked.includes('old'), 'через минуту: счёт получасовой давности и счёт после паузы; пятичасовой — раз в 10 минут');
  pg.log.asked.length = 0;
  await bill.autoConfirmTick(Date.now() + 11 * MIN); assert.ok(pg.log.asked.includes('old'));
  assert.equal(store.payments.pendingIds(now - 24 * 60 * MIN).length, 10, 'в выборке автопроверки нет оплаченных, старше суток и Robokassa');
});

test('BIZ-27: больше 10 неоплаченных счетов за час одному человеку не выставляется', async (t) => {
  const { bill, set, get } = app(t, { settings: PLATEGA }); const pg = platega(t);
  const made = []; for (let i = 0; i < 10; i++) made.push(await make(bill, get('u1'), 'reset', { opts: { qty: i + 1 } }));
  assert.equal(new Set(made.map((x) => x.order)).size, 10);
  await assert.rejects(make(bill, get('u1'), 'reset', { opts: { qty: 11 } }), /уже 10 неоплаченных счетов/);
  assert.equal(pg.log.made, 10);
  assert.equal((await make(bill, get('u1'), 'reset', { opts: { qty: 3 } })).order, made[2].order, 'уже выставленный счёт получить можно');
  set(made[0].order, 'CONFIRMED');
  assert.ok((await make(bill, get('u1'), 'reset', { opts: { qty: 11 } })).order, 'после оплаты одного — можно');
});

/* ---------- BIZ-09: компенсация за выключенный Ultra ---------- */
test('BIZ-09: Ultra выключили и включили — подписчикам возвращается время простоя; возвращённые платежи не считаются', (t) => {
  const { bill, store, buy, set, get } = app(t, { users: [U('u1', 'anna'), U('u2', 'boris'), U('u3', 'vera'), U('u4', 'gleb')] }), tick = clock(t), t0 = Date.now();
  bill.saveCfg({ ultra: { on: true } });
  buy('u1', 'ultra', 30, 6666); const p2 = buy('u2', 'ultra', 30, 6666); buy('u3', 'ultra', 7, 1555); buy('u4', 'pro', 30, 390);
  tick(5 * DAY);
  bill.saveCfg({ ultra: { on: false } });
  assert.equal(store.kv.get('ultra:offAt'), Date.now());
  tick(DAY); set(p2, 'CHARGEBACKED'); // u2 вернул деньги
  tick(3 * DAY);                       // u3: подписка закончилась через 2 дня после выключения
  bill.saveCfg({ msgCost: 0 }); assert.equal(store.kv.get('ultra:offAt'), t0 + 5 * DAY, 'другие правки настроек момент выключения не трогают');
  bill.saveCfg({ ultra: { on: true } });

  assert.equal(get('u1').until, t0 + 34 * DAY, 'u1: +4 дня простоя');
  assert.ok(!(get('u2').until > Date.now()), 'u2: платёж возвращён — компенсации нет');
  assert.equal(get('u3').plan, 'ultra'); assert.equal(get('u3').until, Date.now() + 2 * DAY, 'u3: 2 дня простоя возвращены с сегодняшнего дня');
  assert.equal(get('u4').until, t0 + 30 * DAY, 'u4: Pro не затронут');
  assert.deepEqual([store.kv.get('ultra:comp').users, store.kv.get('ultra:comp').days], [2, 6]);
  assert.equal(store.kv.get('ultra:offAt', null), null);
  bill.saveCfg({ ultra: { on: true } }); bill.saveCfg({ ultra: { on: false } }); tick(30e3); bill.saveCfg({ ultra: { on: true } });
  assert.equal(get('u1').until, t0 + 34 * DAY, 'простой короче минуты и повторное включение ничего не добавляют');
});

/* ---------- находки проверки кода этапа 1 ---------- */
test('BIZ-02: счёт, который до обновления стал «отменён» с уже выданным тарифом, всё ещё можно вернуть — один раз', (t) => {
  const now = Date.now();
  const { set, get, pay } = app(t, { before: (store) => {
    store.users.put({ ...U('u1', 'anna'), plan: 'pro', until: now + 30 * DAY });
    store.payments.put({ id: 'old', tx: 'tx-old', uid: 'u1', login: 'anna', plan: 'pro', days: 30, amount: 390, status: 'CANCELED', applied: true, paid: now, created: now });
  } });
  set('old', 'CHARGEBACKED');
  assert.equal(pay('old').status, 'CHARGEBACKED'); assert.ok(pay('old').revoked > 0); assert.equal(pay('old').applied, false);
  assert.ok(!(get('u1').until > Date.now() + 1000), 'оплаченные дни забраны');
  set('old', 'CONFIRMED'); assert.equal(pay('old').status, 'CHARGEBACKED', 'возврат окончателен');
});

test('BIZ-02: такой счёт получает строку журнала — его возврат после смены тарифа забирает ровно его долю', (t) => {
  const now = Date.now();
  const { ent, buy, set, get } = app(t, { before: (store) => {
    store.users.put({ ...U('u1', 'anna'), plan: 'pro', until: now + 30 * DAY });
    store.payments.put({ id: 'old', tx: 'tx-old', uid: 'u1', login: 'anna', plan: 'pro', days: 30, amount: 390, status: 'CANCELED', applied: true, paid: now, created: now });
    store.payments.put({ id: 'back', tx: 'tx-back', uid: 'u1', login: 'anna', plan: 'pro', days: 30, amount: 390, status: 'CHARGEBACKED', applied: true, paid: now - DAY, created: now - DAY });
  } });
  assert.deepEqual(ent.live({ uid: 'u1' }).map((r) => r.pay_id), ['old'], 'возвращённый счёт строки не получает');
  buy('u1', 'max', 30, 990);
  assert.ok(get('u1').until > Date.now() + 40 * DAY, 'остаток Pro пересчитан в дни Max');
  set('old', 'CHARGEBACKED');
  near(get('u1').until, Date.now() + 30 * DAY, 'остались только 30 оплаченных дней Max'); assert.equal(get('u1').plan, 'max');
});

test('BIZ-01: подписки до обновления — порядок выдач берётся по времени оплаты, а не по времени создания счёта', (t) => {
  const now = Date.now();
  const { set, get } = app(t, { before: (store) => {
    store.users.put({ ...U('u1', 'anna'), plan: 'pro', until: now + 51 * DAY }); // 30 дней оплачены 9 дней назад, ещё 30 — вчера
    const p = (id, created, paid) => store.payments.put({ id, tx: 'tx-' + id, uid: 'u1', login: 'anna', plan: 'pro', days: 30, amount: 390, status: 'CONFIRMED', applied: true, created, paid });
    p('early', now - 10 * DAY, now - DAY);     // счёт выставлен раньше, а оплачен позже
    p('late', now - 9.5 * DAY, now - 9 * DAY);
  } });
  set('early', 'CHARGEBACKED');
  near(get('u1').until, now + 21 * DAY, 'ушли все 30 неизрасходованных дней позже оплаченного счёта');
});

test('BIZ-09: компенсация простоя Ultra привязана к платежу: возврат платежа забирает и её; второй простой компенсируется отдельно', (t) => {
  const { bill, buy, set, get, ent } = app(t), tick = clock(t), t0 = Date.now();
  bill.saveCfg({ ultra: { on: true } });
  const p = buy('u1', 'ultra', 30, 6666);
  tick(5 * DAY); bill.saveCfg({ ultra: { on: false } }); tick(5 * DAY); bill.saveCfg({ ultra: { on: true } });
  assert.equal(get('u1').until, t0 + 35 * DAY, '+5 дней простоя');
  tick(DAY); bill.saveCfg({ ultra: { on: false } }); tick(2 * DAY); bill.saveCfg({ ultra: { on: true } });
  assert.equal(get('u1').until, t0 + 37 * DAY, 'второй простой: ещё +2 дня');
  assert.deepEqual(ent.bySrc(p).map((r) => r.kind), ['plan', 'bonus', 'bonus'], 'компенсации записаны на тот же платёж');
  set(p, 'CHARGEBACKED');
  assert.ok(!(get('u1').until > Date.now()), 'после возврата платежа не остаётся ни оплаченных дней, ни компенсации');
  assert.equal(bill.planOf(get('u1')).id, 'free');
});

test('BIZ-09: тариф сменили во время простоя Ultra — компенсируется простой на обоих тарифах', (t) => {
  const { bill, order, buy, set, get } = app(t), tick = clock(t), t0 = Date.now();
  bill.saveCfg({ plans: [{ id: 'max', ultra: true }], ultra: { on: true } });
  const day = (id) => { const p = bill.cfg().plans.find((x) => x.id === id); return p.price / p.days; }, k = day('max') / day('ultra');
  buy('u1', 'max', 30, 990); const inv = order('u1', 'ultra', 30, 6666);
  bill.saveCfg({ ultra: { on: false } }); tick(5 * DAY);
  set(inv, 'CONFIRMED'); // счёт выставлен до выключения: 25 дней Max пересчитаны в 25k дней Ultra, за ними 30 оплаченных
  near(get('u1').until, t0 + (5 + 25 * k + 30) * DAY, 'смена тарифа');
  tick(2 * DAY); bill.saveCfg({ ultra: { on: true } });
  near(get('u1').until, t0 + (5 + 25 * k + 30 + 5 * k + 2) * DAY, '5 дней простоя на Max (по цене дня) и 2 дня на Ultra');
});

test('BIZ-26: команду продлили из панели — отложенный бонус переносится сразу; продление перед самым началом бонуса не даёт ему сгореть', (t) => {
  const { bill, store, buy, get } = app(t, { users: [U('own', 'olga'), U('mem', 'mark'), U('fr', 'fedor')] }), T = bill.teams, tick = clock(t), t0 = Date.now();
  buy('own', 'team', 30, 1050, { team: { seats: 3, months: 1, days: 30, name: 'Отдел' } });
  const team = { ...T.info(get('own')), id: store.db.prepare("SELECT id FROM teams WHERE owner = 'own'").get().id }; T.join(get('mem'), team.code);
  store.db.prepare("INSERT INTO referrals (id, ref, ip, fp, status, msg, paid, at) VALUES ('fr', 'mem', '', '', 'pending', 0, 0, ?)").run(t0);
  buy('fr', 'pro', 30, 390);
  assert.equal(get('mem').planFrom, t0 + 30 * DAY);
  T.addDays(team.id, 10); // продление из панели: перенос без ожидания обхода
  assert.deepEqual([get('mem').planFrom, get('mem').until], [t0 + 40 * DAY, t0 + 43 * DAY]);

  // срок команды изменился в обход уведомления, за минуту до начала бонуса; обход пришёл через 3 минуты — бонус уже 2 минуты как «начался»
  tick(40 * DAY - 60e3);
  store.db.prepare('UPDATE teams SET until = until + ? WHERE id = ?').run(20 * DAY, team.id);
  tick(3 * 60e3); bill.reanchor('mem');
  assert.deepEqual([get('mem').planFrom, get('mem').until], [t0 + 60 * DAY, t0 + 63 * DAY], 'все 3 дня бонуса — после доступа команды');
  assert.equal(bill.planOf(get('mem')).team, 'Отдел');
  tick(20 * DAY + 60e3); bill.reanchor('mem'); // бонус идёт, места в команде уже нет — обход его не трогает
  assert.equal(get('mem').until, t0 + 63 * DAY); assert.equal(bill.planOf(get('mem')).id, 'pro');
});

test('BIZ-04: возврат пересчитанного счёта команды забирает только то, что он выдал; место-дни других счетов при уменьшении мест сохраняются', (t) => {
  const { bill, store, order, set, get, pay } = app(t, { users: [U('own', 'olga'), U('own2', 'oleg')] }), T = bill.teams, per = bill.periods(); clock(t); const t0 = Date.now();
  const inv = (uid, q) => order(uid, 'team', q.days, q.amount, { team: { seats: q.seats, months: q.months, days: q.days, ver: q.ver, addSeats: q.addSeats, restDays: q.restDays } });
  const team = (uid) => T.info(get(uid));

  // счёт «6 мест и ещё месяц» устарел: команду продлили на 180 дней, и все его место-дни ушли на шестое место до конца срока
  set(inv('own', T.quote(get('own'), 5, 1, per)), 'CONFIRMED');
  const b = inv('own', T.quote(get('own'), 6, 1, per));
  T.addDays(store.db.prepare("SELECT id FROM teams WHERE owner = 'own'").get().id, 180);
  set(b, 'CONFIRMED');
  assert.deepEqual([team('own').seats, team('own').until, pay(b).team.recalc.days, pay(b).team.ms], [6, t0 + 210 * DAY, 0, 0]);
  set(b, 'CHARGEBACKED');
  assert.deepEqual([team('own').seats, team('own').until], [5, t0 + 210 * DAY], 'срока этот счёт не давал — возврат срок не трогает');

  // «продлить 3 места» (A) устарел после «10 мест и месяц» (B): A дал 9 дней на 10 мест. Вернули B — мест снова 3, и 90 место-дней A — это 30 дней
  set(inv('own2', T.quote(get('own2'), 3, 1, per)), 'CONFIRMED');
  const qa = T.quote(get('own2'), 3, 1, per), qb = T.quote(get('own2'), 10, 1, per), a2 = inv('own2', qa), b2 = inv('own2', qb);
  set(b2, 'CONFIRMED'); set(a2, 'CONFIRMED');
  assert.deepEqual([team('own2').seats, team('own2').until], [10, t0 + 69 * DAY]);
  set(b2, 'CHARGEBACKED');
  assert.deepEqual([team('own2').seats, team('own2').until], [3, t0 + 60 * DAY], 'два оставшихся счёта на 3 места × 30 дней = 60 дней');
  set(a2, 'CHARGEBACKED');
  assert.deepEqual([team('own2').seats, team('own2').until], [3, t0 + 30 * DAY]);
});

test('BIZ-03: одновременные запросы — один счёт на одинаковые, предел 10 на разные, одна активация промокода на двоих', async (t) => {
  const { bill, store, get, pay } = app(t, { users: [U('u1', 'anna'), U('u2', 'boris'), U('u3', 'vera')], settings: PLATEGA }); const pg = platega(t, { delay: 5 });
  const same = await Promise.all(Array.from({ length: 12 }, () => make(bill, get('u1'), 'max')));
  assert.equal(new Set(same.map((x) => x.order)).size, 1, '12 одинаковых запросов — один счёт'); assert.equal(pg.log.made, 1);
  assert.equal(same.filter((x) => x.reused).length, 11);

  const diff = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => make(bill, get('u2'), 'reset', { opts: { qty: i + 1 } })));
  assert.equal(diff.filter((x) => x.status === 'fulfilled').length, 10, 'не больше 10 неоплаченных счетов');
  assert.match(diff.find((x) => x.status === 'rejected').reason.message, /неоплаченных счетов/); assert.equal(pg.log.made, 11);

  store.kv.set('promos', [{ code: 'ONCE', kind: 'discount', percent: 50, max: 1, used: 0, by: [] }]);
  const two = await Promise.allSettled([make(bill, get('u1'), 'pro', { promo: 'ONCE' }), make(bill, get('u3'), 'pro', { promo: 'ONCE' })]);
  assert.deepEqual(two.map((x) => x.status), ['fulfilled', 'rejected'], 'счёт со скидкой получает один'); assert.match(two[1].reason.message, /уже выставлены счета/);
  assert.equal(pay(two[0].value.order).promo, 'ONCE');
});

test('BIZ-03: один человек не занимает две активации промокода, а перепроверка прежнего счёта — второе место в пределе', async (t) => {
  const { bill, store, get } = app(t, { users: [U('u1', 'anna'), U('u2', 'boris'), U('u3', 'vera')], settings: PLATEGA }); const pg = platega(t, { delay: 5 });
  store.kv.set('promos', [{ code: 'TWO', kind: 'discount', percent: 50, max: 2, used: 0, by: [] }]);
  await make(bill, get('u1'), 'pro', { promo: 'TWO' }); // у первого уже есть счёт с кодом, и он создаёт ещё один — это по-прежнему одна активация
  const two = await Promise.allSettled([make(bill, get('u1'), 'max', { promo: 'TWO' }), make(bill, get('u3'), 'pro', { promo: 'TWO' })]);
  assert.deepEqual(two.map((x) => x.status), ['fulfilled', 'fulfilled'], 'вторая активация свободна');
  await assert.rejects(make(bill, get('u2'), 'pro', { promo: 'TWO' }), /уже выставлены счета/, 'третьему человеку активации не осталось');

  for (let i = 1; i <= 9; i++) await make(bill, get('u2'), 'reset', { opts: { qty: i } });
  const made = pg.log.made;
  const r = await Promise.allSettled([make(bill, get('u2'), 'reset', { opts: { qty: 1 } }), make(bill, get('u2'), 'reset', { opts: { qty: 10 } })]);
  assert.deepEqual(r.map((x) => x.status), ['fulfilled', 'fulfilled'], 'десятый счёт выставлен, пока прежний перепроверяется');
  assert.ok(r[0].value.reused); assert.equal(pg.log.made, made + 1);
  await assert.rejects(make(bill, get('u2'), 'reset', { opts: { qty: 11 } }), /неоплаченных счетов/);
});

test('BIZ-03: пробный период не срабатывает, если до его оплаты уже оплачен этот тариф', async (t) => {
  const { bill, buy, set, get, pay } = app(t, { settings: PLATEGA }); platega(t); const t0 = Date.now();
  bill.saveCfg({ trials: { pro: { on: true, price: 9, days: 3 } } });
  const a = await make(bill, get('u1'), 'trial');
  buy('u1', 'pro', 30, 390);
  set(a.order, 'CONFIRMED');
  assert.deepEqual([pay(a.order).recalc.why, pay(a.order).days], ['trial', 0.69]); near(get('u1').until, t0 + 30.69 * DAY, '9 ₽ по обычной цене дня');
  assert.ok(!get('u1').trialUsed, 'пробный период не отмечен использованным');
});

test('BIZ-25: повтор начисления за приглашение после конца срока приглашения не теряет бонус — срок считается по моменту оплаты', (t) => {
  const { bill, store, buy, get, pay, dir } = app(t, { users: [U('inv', 'inna'), U('fr', 'fedor')] }), tick = clock(t), t0 = Date.now();
  const payDays = require(path.join(dir, 'growth.js')).conf().ref.payDays;
  store.db.prepare("INSERT INTO referrals (id, ref, ip, fp, status, msg, paid, at) VALUES ('fr', 'inv', '', '', 'pending', 0, 0, ?)").run(t0 - payDays * DAY + 60e3); // до конца срока — минута
  const real = store.users.update; let broken = true;
  store.users.update = (id, fn) => { if (broken && id === 'inv') throw new Error('диск переполнен'); return real(id, fn); };
  const p = buy('fr', 'pro', 30, 390); assert.equal(pay(p).refPending.n, 1);
  tick(5 * 60e3); broken = false;
  assert.equal(bill.refRetry(), 1);
  assert.equal(get('inv').until, Date.now() + 3 * DAY, 'пригласившему +3 дня'); assert.equal(pay(p).ref.inviter.uid, 'inv');
  assert.equal(store.db.prepare("SELECT paid FROM referrals WHERE id = 'fr'").get().paid, 1);
});

test('BIZ-27: очередь автопроверки продвигается при потоке свежих счетов; ошибка HTTP у провайдера даёт паузу', async (t) => {
  const { bill, order } = app(t, { settings: { ...PLATEGA, cispay: { shopId: 's', apiKey: 'k' } } }); const pg = platega(t), now = Date.now(), MIN = 60e3;
  for (let i = 0; i < 205; i++) order('u1', 'reset', 0, 180, { id: 'f' + i, tx: 'f' + i, qty: 1, created: now - MIN + i });
  order('u1', 'reset', 0, 180, { id: 'old', tx: 'old', qty: 1, created: now - 5 * 60 * MIN });
  for (let i = 0; i < 30; i++) order('u1', 'reset', 0, 180, { id: 'rb' + i, tx: 'rb' + i, qty: 1, provider: 'robokassa', created: now });
  assert.equal(await bill.autoConfirmTick(now), 200); assert.ok(!pg.log.asked.includes('old'));
  pg.log.asked.length = 0;
  assert.equal(await bill.autoConfirmTick(now + 20e3), 200);
  assert.deepEqual(pg.log.asked.slice(0, 6).sort(), ['f0', 'f1', 'f2', 'f3', 'f4', 'old'], 'сначала те, кого ещё не проверяли');

  // больше 5000 неоплаченных счетов: очередь идёт по всем, самый старый не остаётся за пределом выборки
  const c = app(t, { settings: PLATEGA }), n3 = Date.now();
  c.store.tx(() => { for (let i = 0; i < 5001; i++) c.order('u1', 'reset', 0, 180, { id: 'n' + i, tx: 'n' + i, qty: 1, created: n3 - MIN + i }); });
  c.order('u1', 'reset', 0, 180, { id: 'last', tx: 'last', qty: 1, created: n3 - 5 * 60 * MIN });
  pg.log.asked.length = 0; let ticks = 0;
  while (!pg.log.asked.includes('last') && ticks < 40) await c.bill.autoConfirmTick(n3 + 20e3 * ticks++);
  assert.equal(ticks, 26, '5002 счёта по 200 за тик: до самого старого очередь доходит на 26-м тике');
  assert.equal(new Set(pg.log.asked.slice(0, 5002)).size, 5002, 'пока есть ни разу не проверенные, никто не проверяется дважды');

  // cISPay отвечает 503: это не исключение, но статус не получен — пауза растёт, как при недоступной сети
  let asked = 0;
  t.mock.method(globalThis, 'fetch', async () => { asked++; return new Response('', { status: 503 }); });
  const b = app(t, { settings: { cispay: { shopId: 's', apiKey: 'k' } } }), n2 = Date.now();
  b.order('u1', 'reset', 0, 180, { id: 'c1', tx: 'c1', qty: 1, provider: 'cispay', created: n2 - MIN });
  assert.equal(await b.bill.autoConfirmTick(n2), 1); assert.equal(asked, 1);
  assert.equal(await b.bill.autoConfirmTick(Date.now() + 20e3), 0, 'следующий тик счёт не трогает'); assert.equal(asked, 1);
  assert.equal(await b.bill.autoConfirmTick(Date.now() + 41e3), 1); assert.equal(asked, 2);
});

test('BIZ-09: пробный период тарифа с Ultra при выключенном Ultra — отказ с понятной причиной', async (t) => {
  const { bill, get } = app(t, { settings: PLATEGA }); const pg = platega(t);
  bill.saveCfg({ ultra: { on: true }, trials: { ultra: { on: true, price: 990, days: 3 } } });
  bill.saveCfg({ ultra: { on: false } });
  await assert.rejects(async () => make(bill, get('u1'), 'trial:ultra'), /сейчас недоступен/);
  assert.equal(pg.log.made, 0);
});
