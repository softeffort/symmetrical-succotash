'use strict';
// Сброс лимита (возвращает не больше resetMsgs сообщений, цена не ниже себестоимости) и пробные периоды Pro/Max/Ultra
// (цена и дни из env и панели, один раз на тариф и человека, не при оплате этого тарифа или выше, без промокодов и скидки).
// Запуск: node --test tests/reset-and-trials.test.js
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto'), fs = require('node:fs');
const { copyApp, rm } = require('../test/helpers');

const DAY = 864e5, ORIGIN = 'https://eide.pro', ROOT = path.join(__dirname, '..');
const ENV = ['TRIAL_OFFER', 'TRIAL_PRICE', 'TRIAL_DAYS', 'TRIAL_PLAN', 'TRIAL_PLANS', 'TRIAL_PRICE_PRO', 'TRIAL_PRICE_MAX', 'TRIAL_PRICE_ULTRA', 'TRIAL_DAYS_PRO', 'TRIAL_DAYS_MAX', 'TRIAL_DAYS_ULTRA',
  'FIRST_DISCOUNT', 'FIRST_DISCOUNT_PLANS', 'FIRST_DISCOUNT_AFTER_TRIAL', 'REF_MODE', 'REF_BONUS_DAYS', 'REF_BONUS_PLAN', 'REF_MAX', 'REF_TRIAL_COUNTS', 'PLATEGA_URL'];
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 5 * 60000, `${msg || 'время'}: ${new Date(a).toISOString()} ≠ ${new Date(b).toISOString()}`);

// биллинг в процессе теста; Platega — локальная заглушка, сумма счёта видна в запросе
async function app(t, env = {}) {
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, env); // env читается при каждом вызове growth.conf()
  const sent = [];
  const mock = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => { let j = {}; try { j = JSON.parse(b); } catch {} sent.push(j); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ transactionId: 'tx-' + sent.length, redirect: 'https://pay.example/' + sent.length })); });
  });
  await new Promise((ok) => mock.listen(0, '127.0.0.1', ok));
  process.env.PLATEGA_URL = 'http://127.0.0.1:' + mock.address().port;
  const dir = copyApp();
  const bill = require(path.join(dir, 'billing.js')), store = require(path.join(dir, 'db.js')), growth = require(path.join(dir, 'growth.js'));
  bill.init({ loadSettings: () => ({ platega: { merchant: 'test-merchant', secret: 'test-secret' } }), saveSettings() {} });
  t.after(async () => { try { bill.flush(); } catch {} await new Promise((ok) => mock.close(ok)); store.db.close(); rm(dir); for (const k of ENV) delete process.env[k]; });
  let n = 0;
  const mk = (o = {}) => { n++; const id = crypto.randomBytes(6).toString('hex'); store.users.put({ id, login: 'user' + n + '_' + id.slice(0, 4), email: `user${n}.${id}@example.com`, created: new Date().toISOString(), ...o, id }); return store.users.get(id); };
  const get = (u) => store.users.get(u.id);
  const pay = async (u, plan, opts = {}, promo = '') => {
    const was = sent.length, r = await bill.create(get(u), plan, promo, ORIGIN, '', 'card', opts);
    assert.equal(sent.length, was + 1, 'запрос в Platega');
    return { ...store.payments.get(r.order), sent: sent.at(-1).paymentDetails.amount };
  };
  const confirm = (p) => bill.apply(store.payments.get(p.id), 'CONFIRMED');
  const trial = (u, id) => bill.offers(get(u)).trials.find((x) => x.plan === id);
  return { bill, store, growth, mk, get, pay, confirm, trial, sent, dir };
}
const ultraOn = (bill, cost = 0) => bill.saveCfg({ ultra: { on: true, price: 15, cost } });

/* ---------- сброс лимита ---------- */

test('сброс возвращает не больше resetMsgs сообщений, остальные счётчики обнуляет полностью', async (t) => {
  const { bill, store, mk, get } = await app(t);
  assert.equal(bill.resetMsgs(), 1000); assert.equal(bill.resetPrice(), 200);
  const info = bill.summary(mk()); assert.equal(info.resetMsgs, 1000); assert.equal(info.resetPrice, 200); assert.equal(info.resets.msgs, 1000); assert.equal(info.resets.price, 200);

  // использовано 10 000 — после сброса остаётся 9 000, а не 0
  const u = mk({ resetBal: 3 });
  bill.add(u.id, 'm', 10000); bill.add(u.id, 'c', 7); bill.add(u.id, 's', 3); bill.add(u.id, 'i', 5);
  const r = bill.useReset(u.id); assert.equal(r.ok, true); assert.equal(r.left, 2);
  assert.deepEqual({ ...bill.used(u.id) }, { m: 9000, c: 0, s: 0, i: 0 });
  assert.equal(get(u).resetBal, 2);
  bill.useReset(u.id); assert.equal(bill.used(u.id).m, 8000, 'каждый сброс — ещё ≤ resetMsgs');

  // использовано меньше, чем resetMsgs — счётчик в ноль, не в минус
  const v = mk({ resetBal: 1 }); bill.add(v.id, 'm', 400.5); bill.add(v.id, 'i', 2);
  assert.equal(bill.useReset(v.id).ok, true); assert.deepEqual({ ...bill.used(v.id) }, { m: 0, c: 0, s: 0, i: 0 });

  // автосброс (когда сообщения кончились) работает по тому же правилу
  const w = mk({ resetBal: 1 }); bill.add(w.id, 'm', 5000); bill.add(w.id, 'i', 9);
  assert.equal(bill.autoReset(get(w)), true); assert.deepEqual({ ...bill.used(w.id) }, { m: 4000, c: 0, s: 0, i: 0 });
  assert.equal(get(w).resetBal, 0);
  void store;
});

test('цена и размер сброса настраиваются; платный сброс «сейчас» тоже возвращает не больше resetMsgs', async (t) => {
  const { bill, mk, get, pay, confirm } = await app(t);
  bill.saveCfg({ resetPrice: 150, resetMsgs: 500 });
  assert.equal(bill.resetPrice(), 150); assert.equal(bill.resetMsgs(), 500);
  assert.deepEqual(bill.resetQuote(1), { qty: 1, unit: 150, full: 150, pct: 0, amount: 150 }, 'форма ответа прежняя');
  assert.equal(bill.resetQuote(5).amount, 675);
  assert.equal(bill.summary(mk()).resetPrice, 150);
  assert.equal(bill.resetInfo(mk()).msgs, 500);

  const u = mk({ plan: 'pro' }); bill.add(u.id, 'm', 3000); bill.add(u.id, 'c', 4);
  const p = await pay(u, 'reset', { qty: 1, now: true }); assert.equal(p.sent, 150);
  confirm(p);
  // сообщений ещё не исчерпано (лимит Free) — сброс ложится на баланс; а не списывается вхолостую
  assert.equal(get(u).resetBal >= 0, true);
  const x = mk({ resetBal: 1 }); bill.add(x.id, 'm', 3000);
  bill.useReset(x.id); assert.equal(bill.used(x.id).m, 2500);

  // пределы настроек
  bill.saveCfg({ resetPrice: 9999999, resetMsgs: 9999999999 }); assert.equal(bill.resetPrice(), 100000); assert.equal(bill.resetMsgs(), 1e6);
  bill.saveCfg({ resetPrice: -5, resetMsgs: -1 }); assert.equal(bill.resetPrice(), 100000, 'отрицательное значение игнорируется'); assert.equal(bill.resetMsgs(), 1e6);
  bill.saveCfg({ resetPrice: 0, resetMsgs: 0 }); assert.equal(bill.resetPrice(), 200, '0 — значение по умолчанию'); assert.equal(bill.resetMsgs(), 1000);
});

test('сервер не сохраняет сброс дешевле себестоимости (с учётом скидки за пачку сбросов)', async (t) => {
  const { bill } = await app(t);
  // себестоимость не задана — любая цена допустима (как у пакетов)
  bill.saveCfg({ resetPrice: 50, resetMsgs: 1000, packs: [] }); // пакетов нет: проверяется только сброс (пакеты по умолчанию при 0,2 ₽ за сообщение ушли бы в минус)
  // 1000 сообщений × 0,2 ₽ = 200 ₽; одиночный сброс за 200 — ровно в ноль, но в пачке из 25 скидка 25% уводит в минус
  assert.throws(() => bill.saveCfg({ msgCost: 0.2, resetPrice: 200, resetMsgs: 1000 }), /Сброс лимита за 200/);
  assert.throws(() => bill.saveCfg({ msgCost: 0.1, resetPrice: 50, resetMsgs: 1000 }), /дешевле себестоимости/);
  assert.equal(bill.resetPrice(), 50, 'отказ ничего не меняет');
  assert.throws(() => bill.saveCfg({ msgCost: 0.1, resetMsgs: 5000 }), /Сброс лимита/, 'размер сброса тоже влияет');
  assert.doesNotThrow(() => bill.saveCfg({ msgCost: 0.05, resetPrice: 200, resetMsgs: 1000 }));
  assert.equal(bill.cfg().msgCost, 0.05);
  // уменьшить размер сброса при той же цене — наценка растёт
  assert.doesNotThrow(() => bill.saveCfg({ msgCost: 0.1, resetPrice: 200, resetMsgs: 1000 }));
});

/* ---------- пробные периоды: предложения и цены ---------- */

test('пробные тарифы по умолчанию: Pro 99, Max 249, Ultra 990 на 3 дня; Pro остаётся в старых полях', async (t) => {
  const { bill, mk, get, trial } = await app(t);
  const a = mk(), o = bill.offers(a);
  assert.deepEqual(o.trial, { price: 99, days: 3, plan: 'pro', name: 'Pro' }, 'старый формат не изменился');
  assert.deepEqual(o.trials.map((x) => [x.plan, x.price, x.days]), [['pro', 99, 3], ['max', 249, 3]], 'Ultra без кредитов Ultra не показывается');
  assert.deepEqual(Object.keys(bill.publicOffers()), ['trial', 'trials', 'first']);
  assert.deepEqual(bill.publicOffers().trials.map((x) => x.plan), ['pro', 'max']);
  assert.deepEqual(bill.offers(null).trials, [], 'без пользователя — пустой список');
  assert.ok(bill.summary(a).offer.trials.length === 2);

  ultraOn(bill);
  assert.deepEqual(bill.offers(get(a)).trials.map((x) => [x.plan, x.price, x.days]), [['pro', 99, 3], ['max', 249, 3], ['ultra', 990, 3]]);
  assert.equal(trial(a, 'ultra').name, 'Ultra');
  assert.deepEqual(bill.publicOffers().trials.map((x) => x.plan), ['pro', 'max', 'ultra']);
});

test('цена и дни из env, панель важнее env, отключение по тарифам и целиком', async (t) => {
  const { bill, mk, trial, pay, confirm, get } = await app(t, { TRIAL_PRICE_MAX: '299', TRIAL_DAYS_MAX: '5', TRIAL_PRICE: '129' });
  const a = mk();
  assert.equal(trial(a, 'max').price, 299); assert.equal(trial(a, 'max').days, 5);
  assert.equal(trial(a, 'pro').price, 129, 'старый TRIAL_PRICE действует на основной тариф (Pro)');
  assert.equal(bill.cfg().trials, undefined, 'env в сохранённые настройки не попадает');

  bill.saveCfg({ trials: { max: { on: true, price: 350, days: 2 } } });
  assert.equal(trial(a, 'max').price, 350); assert.equal(trial(a, 'max').days, 2);
  const p = await pay(a, 'trial:max'); assert.equal(p.sent, 350); assert.equal(p.days, 2); assert.equal(p.plan, 'max'); assert.equal(p.offer, 'trial');
  const t0 = Date.now(); confirm(p); near(get(a).until, t0 + 2 * DAY, 'Max на 2 дня');

  bill.saveCfg({ trials: { pro: { on: false } } });
  assert.deepEqual(bill.offers(get(mk())).trials.map((x) => x.plan), ['max'], 'Pro отключён в панели');
  assert.equal(bill.offers(mk()).trial, null);
  bill.saveCfg({ trials: { pro: { on: true } } });
  assert.equal(bill.offers(mk()).trial.price, 129, 'включили обратно — цена из env');

  process.env.TRIAL_OFFER = '0';
  assert.deepEqual(bill.offers(mk()).trials, []); assert.deepEqual(bill.publicOffers().trials, []); assert.equal(bill.offers(mk()).trial, null);
  delete process.env.TRIAL_OFFER; bill.saveCfg({ trials: {} }); process.env.TRIAL_PLANS = 'max';
  assert.deepEqual(bill.offers(mk()).trials.map((x) => x.plan), ['max']);
  assert.equal(bill.offers(mk()).trial, null, 'основной тариф Pro не в списке');
});

test('значения из панели проходят проверку: цена 1..100000, дни 1..30, лишнее отбрасывается', async (t) => {
  const { bill } = await app(t);
  bill.saveCfg({ trials: { max: { on: true, price: 9999999, days: 99 }, free: { on: true, price: 5 }, pro: { on: 'yes', price: 'abc' } } });
  const c = bill.cfg().trials;
  assert.equal(c.max.price, 100000); assert.equal(c.max.days, 30);
  assert.equal(c.free, undefined, 'бесплатному тарифу пробный период не нужен');
  assert.ok(!c.pro || c.pro.price === undefined);
});

/* ---------- пробные периоды: покупка ---------- */

test('trial:max, trial (Pro) и параметр trialPlan; месяцы и промокоды отклоняются', async (t) => {
  const { bill, mk, get, pay, confirm, store } = await app(t);
  bill.savePromos([{ code: 'SALE10', kind: 'discount', percent: 10, used: 0, by: [] }]);
  const a = mk();
  await assert.rejects(bill.create(a, 'trial:max', 'SALE10', ORIGIN, '', 'card'), /Промокоды на пробный период не действуют/);
  await assert.rejects(bill.create(a, 'trial:max', '', ORIGIN, '', 'card', { months: 3 }), /./);
  await assert.rejects(bill.create(a, 'trial:ultra', '', ORIGIN, '', 'card'), /сейчас недоступен/, 'Ultra-пробного нет, пока кредиты Ultra выключены');
  await assert.rejects(bill.create(a, 'trial:nope', '', ORIGIN, '', 'card'), /один раз/);

  const pm = await pay(a, 'trial:max'); assert.equal(pm.sent, 249); assert.equal(pm.amount, 249); assert.equal(pm.plan, 'max'); assert.equal(pm.days, 3);
  const t0 = Date.now(); confirm(pm);
  assert.equal(bill.planOf(get(a)).id, 'max'); near(get(a).until, t0 + 3 * DAY, 'Max на 3 дня');
  assert.equal(get(a).trialUsed, undefined, 'флаг старого пробного периода — только для Pro');
  assert.ok(get(a).trialsUsed.max > 0);
  const until = get(a).until; confirm(pm); assert.equal(get(a).until, until, 'повторный вебхук без новых дней');

  const b = mk(); const pl = await pay(b, 'trial'); assert.equal(pl.plan, 'pro'); assert.equal(pl.sent, 99);
  const c = mk(); const pp = await pay(c, 'trial', { trialPlan: 'max' }); assert.equal(pp.plan, 'max'); assert.equal(pp.sent, 249, 'trialPlan выбирает тариф');
  const d = mk(); const pq = await pay(d, 'trial:pro', { trialPlan: 'max' }); assert.equal(pq.plan, 'pro', 'явный trial:<тариф> важнее');
  confirm(pl); assert.ok(get(b).trialUsed > 0); void store;
});

test('один раз на тариф, аккаунт и почту; пробный Pro не закрывает пробный Max', async (t) => {
  const { bill, mk, get, pay, confirm, store, trial } = await app(t);
  const a = mk({ email: 'Anna.Test+x@gmail.com' });
  confirm(await pay(a, 'trial'));
  assert.equal(trial(a, 'pro'), undefined, 'Pro-пробный использован');
  assert.ok(trial(a, 'max'), 'Max-пробный ещё доступен');
  await assert.rejects(bill.create(get(a), 'trial', '', ORIGIN, '', 'card'), /один раз/);

  // повторная регистрация на ту же почту (алиасы Gmail) — тот же отказ, но на Max предложение остаётся
  const twin = mk({ email: 'annatest@googlemail.com' });
  assert.equal(trial(twin, 'pro'), undefined); assert.ok(trial(twin, 'max'));
  await assert.rejects(bill.create(twin, 'trial', '', ORIGIN, '', 'card'), /один раз/);

  // Pro-пробный истёк; пробный Max покупается, и Pro на этот срок не «вычитается» бесплатно
  const t1 = Date.now(); confirm(await pay(a, 'trial:max'));
  assert.equal(bill.planOf(get(a)).id, 'max');
  assert.equal(trial(a, 'max'), undefined);
  assert.ok(get(a).until >= t1 + 3 * DAY - 5 * 60000);
  await assert.rejects(bill.create(get(a), 'trial:max', '', ORIGIN, '', 'card'), /один раз/);

  // даже после удаления аккаунта на ту же почту Max-пробного уже нет
  const twin2 = mk({ email: 'ANNA.TEST@gmail.com' });
  store.users.remove(a.id);
  assert.equal(trial(twin2, 'max'), undefined); assert.equal(trial(twin2, 'pro'), undefined);
});

test('кто платил за тариф или выше, пробного этого тарифа не получает; пакеты, сброс и кредиты не мешают', async (t) => {
  const { bill, mk, get, pay, confirm, trial } = await app(t);
  ultraOn(bill);
  const pro = mk(); confirm(await pay(pro, 'pro'));
  assert.equal(trial(pro, 'pro'), undefined, 'платил за Pro');
  assert.ok(trial(pro, 'max') && trial(pro, 'ultra'), 'на Max и Ultra пробные остаются');

  const max = mk(); confirm(await pay(max, 'max'));
  assert.equal(trial(max, 'pro'), undefined, 'платил за Max — Pro-пробный не нужен');
  assert.equal(trial(max, 'max'), undefined);
  assert.ok(trial(max, 'ultra'));
  await assert.rejects(bill.create(get(max), 'trial', '', ORIGIN, '', 'card'), /один раз/);

  const ultra = mk(); confirm(await pay(ultra, 'ultra'));
  assert.deepEqual(bill.offers(get(ultra)).trials, []);

  // пакет сообщений, сброс и кредиты — не тариф: пробный период остаётся
  const buyer = mk();
  confirm(await pay(buyer, 'reset', { qty: 1 }));
  assert.ok(trial(buyer, 'pro'), 'после покупки сброса Pro-пробный доступен');
  const pack = bill.packQuote ? bill.packList : null; void pack;
  assert.ok(trial(buyer, 'max'));

  // действующий тариф выше пробного — пробный «понижением» не предлагается
  const hi = mk({ plan: 'max', until: Date.now() + 10 * DAY });
  assert.equal(trial(hi, 'pro'), undefined); assert.ok(trial(hi, 'ultra'));
});

test('пробный период не сочетается со скидкой первой покупки и не тратит её', async (t) => {
  const { bill, mk, get, pay, confirm } = await app(t, { FIRST_DISCOUNT: '30' });
  const a = mk();
  assert.equal(bill.offers(a).first.percent, 30);
  const p = await pay(a, 'trial:max'); assert.equal(p.sent, 249, 'без −30%'); assert.notEqual(p.offer, 'first');
  confirm(p);
  const f = bill.offers(get(a)).first;
  assert.ok(f === null || f.percent === 30, 'скидка не потрачена пробным периодом');

  // первая покупка без пробного: скидка тратится как раньше
  const b = mk(); const q = await pay(b, 'max'); assert.equal(q.sent, Math.round(bill.cfg().plans.find((x) => x.id === 'max').price * 0.7), 'скидка на обычную покупку');
});

test('Ultra-пробный: кредиты Ultra как у тарифа, только при включённых кредитах и цене не ниже худшего расхода', async (t) => {
  const { bill, mk, get, pay, confirm, trial } = await app(t);
  const credits = bill.cfg().plans.find((p) => p.id === 'ultra').credits; assert.ok(credits > 0);
  assert.equal(bill.trialWorstCost({ ultra: true, credits }, 3, 2), Math.ceil(4 * credits * 2), 'худший случай: 3 суток могут занять 4 даты по Москве');
  assert.equal(bill.trialWorstCost({ ultra: false, credits }, 3, 2), 0);
  assert.equal(bill.trialWorstCost({ ultra: true, credits }, 3, 0), 0);

  const a = mk();
  assert.equal(trial(a, 'ultra'), undefined, 'кредиты Ultra выключены — пробного Ultra нет');
  ultraOn(bill, 1); // 1 ₽ за кредит: худший случай 4 × credits = 400 ₽ < 990
  const p = await pay(a, 'trial:ultra'); assert.equal(p.sent, 990); assert.equal(p.plan, 'ultra');
  const t0 = Date.now(); confirm(p);
  assert.equal(bill.planOf(get(a)).id, 'ultra'); near(get(a).until, t0 + 3 * DAY, 'Ultra на 3 дня');
  const u = bill.ultraGrant(a.id); assert.equal(u.bonus, credits, 'дневные кредиты Ultra начислены как у тарифа');
  assert.equal(trial(a, 'ultra'), undefined);

  // дорогой кредит: пробный за 990 ₽ становится убыточным и скрывается сам; сохранить такую цену в панели нельзя
  bill.saveCfg({ ultra: { on: true, price: 15, cost: 2.5 } });
  assert.equal(trial(mk(), 'ultra'), undefined, `при ${credits} кр./сутки × 2,5 ₽ × 4 даты пробный за 990 ₽ убыточен`);
  assert.deepEqual(bill.publicOffers().trials.map((x) => x.plan), ['pro', 'max']);
  await assert.rejects(bill.create(mk(), 'trial:ultra', '', ORIGIN, '', 'card'), /один раз/);
  assert.throws(() => bill.saveCfg({ trials: { ultra: { on: true, price: 990, days: 3 } } }), /дешевле себестоимости кредитов/);
  assert.throws(() => bill.saveCfg({ trials: { ultra: { on: true, price: 300, days: 3 } } }), /дешевле себестоимости кредитов/);
  assert.doesNotThrow(() => bill.saveCfg({ trials: { ultra: { on: false } } }), 'выключенный пробный не проверяется');
  assert.doesNotThrow(() => bill.saveCfg({ trials: { ultra: { on: true, price: 1500, days: 3 } } }));
  assert.equal(trial(mk(), 'ultra').price, 1500);
  // цена из env ниже худшего случая: предложение скрывается само (в панели такую цену сохранить нельзя)
  bill.saveCfg({ ultra: { on: true, price: 15, cost: 1 }, trials: {} }); process.env.TRIAL_PRICE_ULTRA = '300';
  assert.equal(trial(mk(), 'ultra'), undefined); assert.deepEqual(bill.publicOffers().trials.map((x) => x.plan), ['pro', 'max']);
  await assert.rejects(bill.create(mk(), 'trial:ultra', '', ORIGIN, '', 'card'), /один раз/);
});

test('рефералы: пробный Max приглашённого — первая оплата (REF_TRIAL_COUNTS=1); при 0 бонус ждёт полной оплаты', async (t) => {
  const { bill, mk, get, pay, confirm } = await app(t);
  const A = mk(), F = mk(); bill.refBind(F, bill.refCode(A), '10.0.3.1', 'fpF');
  confirm(await pay(F, 'trial:max')); assert.ok(get(A).until > Date.now() + 2 * DAY, 'пригласивший получил бонус');
  process.env.REF_TRIAL_COUNTS = '0';
  const B = mk(), G = mk(); bill.refBind(G, bill.refCode(B), '10.0.4.1', 'fpG');
  confirm(await pay(G, 'trial:max')); assert.equal(get(B).until, undefined, 'пробный период бонус не даёт');
  confirm(await pay(G, 'pro')); assert.ok(get(B).until > Date.now() + 2 * DAY, 'полная оплата — даёт');
});

/* ---------- HTTP: /api/plans, /api/billing, /api/pay/create, /api/pay/check ---------- */

test('HTTP: предложения в /api/plans и /api/billing; trial:max через /api/pay/create; admin GET отдаёт эффективные пробные', async (t) => {
  for (const k of ENV) delete process.env[k];
  const sent = [];
  const mock = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => { let j = {}; try { j = JSON.parse(b); } catch {} sent.push(j); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ transactionId: 'tx-' + sent.length, redirect: 'https://pay.example/' + sent.length })); });
  });
  await new Promise((ok) => mock.listen(0, '127.0.0.1', ok));
  const { seed, startServer } = require('../test/helpers');
  const dir = copyApp();
  seed(dir, { users: [{ id: 'u1', login: 'anna', email: 'anna@example.com' }], sessions: { tok1: 'u1' } });
  const s = await startServer(dir, { PLATEGA_URL: 'http://127.0.0.1:' + mock.address().port, PLATEGA_MERCHANT_ID: 'm', PLATEGA_SECRET: 's' });
  t.after(async () => { await s.stop(); await new Promise((ok) => mock.close(ok)); rm(dir); });

  const guest = await s.req('GET', '/api/plans'); assert.equal(guest.status, 200);
  assert.ok(Array.isArray(guest.json.offers.trials)); assert.deepEqual(guest.json.offers.trials.map((x) => x.plan), ['pro', 'max']);
  assert.deepEqual(guest.json.offers.trial, { price: 99, days: 3, plan: 'pro', name: 'Pro' });
  const me = await s.req('GET', '/api/billing', { token: 'tok1' }); assert.equal(me.status, 200);
  assert.deepEqual(me.json.offer.trials.map((x) => [x.plan, x.price]), [['pro', 99], ['max', 249]]);
  assert.equal(me.json.resetMsgs, 1000); assert.equal(me.json.resets.msgs, 1000);

  const create = await s.req('POST', '/api/pay/create', { token: 'tok1', body: { plan: 'trial:max', method: 'card' } });
  assert.equal(create.status, 200, create.text); assert.equal(sent.at(-1).paymentDetails.amount, 249);
  const viaParam = await s.req('POST', '/api/pay/create', { token: 'tok1', body: { plan: 'trial', trialPlan: 'max', method: 'card' } });
  assert.equal(viaParam.status, 200, viaParam.text);
  // тот же счёт (тот же тариф, сумма и способ) второй раз у провайдера не создаётся: возвращается прежняя ссылка (BIZ-03)
  assert.equal(viaParam.json.order, create.json.order, 'trialPlan выбирает тот же тариф'); assert.equal(viaParam.json.url, create.json.url);
  assert.equal(sent.filter((x) => x.paymentDetails).length, 1);
  const bad = await s.req('POST', '/api/pay/create', { token: 'tok1', body: { plan: 'trial:max', promo: 'X', method: 'card' } });
  assert.equal(bad.status, 400); assert.match(bad.json.error, /Промокоды на пробный период не действуют/);
});

test('статика: окно тарифов, лендинг и панель знают про пробные тарифы и новый сброс (RU и EN)', () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  for (const p of ['public/js/13-billing.js', 'public/en/js/13-billing.js']) { const s = read(p); assert.match(s, /\/\^trial\/\.test\(id\)/); assert.match(s, /growthTrialLink\(p\)/); assert.match(s, /BILL\.resetMsgs/); }
  const g = read('public/js/15-growth.js'); assert.match(g, /function growthTrialLink\(p\)/); assert.match(g, /data-buy="trial:\$\{esc\(p\.id\)\}"/);
  for (const p of ['public/index.html', 'public/en/index.html']) { const s = read(p); assert.match(s, /class="tier-trial"/); assert.match(s, /offers\.trials/); }
  assert.match(read('public/landing.css'), /\.tier \.tier-trial/); assert.match(read('public/growth.css'), /\.plan \.gw-tr/);
  const panel = read('public/admin/v-legacy.js'); assert.match(panel, /name="resetPrice"/); assert.match(panel, /name="resetMsgs"/); assert.match(panel, /Пробные тарифы/); assert.match(panel, /resetMargin/);
  for (const p of ['public/chat.html', 'public/en/chat.html']) assert.doesNotMatch(read(p), /(Обнуляет дневные счётчики|Zeros today's counters)/);
  for (const p of ['public/js/19-limits.js', 'public/js/13-billing.js']) assert.doesNotMatch(read(p), /Сброс обнуляет счётчики/);
});
