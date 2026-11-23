'use strict';
// Тариф Ultra: появляется в старых настройках сам, открывает Ultra-модели (Claude) только себе, 100 кредитов в день
// (доначисление при переходе днём), скидки за срок как у всех, только именные промокоды, без бонусных дней за приглашения.
// Запуск: node --test tests/ultra-plan.test.js
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const { copyApp, rm } = require('../test/helpers');

const DAY = 864e5, ORIGIN = 'https://eide.pro';
const ENV = ['TRIAL_OFFER', 'FIRST_DISCOUNT', 'FIRST_DISCOUNT_PLANS', 'REF_MODE', 'REF_BONUS_DAYS', 'REF_BONUS_PLAN', 'REF_MAX', 'PLATEGA_URL'];
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 5 * 60000, `${msg || 'время'}: ${new Date(a).toISOString()} ≠ ${new Date(b).toISOString()}`);
const CLAUDE = { id: 'claude', name: 'Claude', ultra: true, credits: 5, plans: ['max'] }; // так Ultra-модель сохранялась раньше — «только Max»

// биллинг в процессе теста; Platega — локальная заглушка, сумма счёта видна в запросе
async function app(t, before) {
  for (const k of ENV) delete process.env[k];
  const sent = [];
  const mock = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => { let j = {}; try { j = JSON.parse(b); } catch {} sent.push(j); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ transactionId: 'tx-' + sent.length, redirect: 'https://pay.example/' + sent.length })); });
  });
  await new Promise((ok) => mock.listen(0, '127.0.0.1', ok));
  process.env.PLATEGA_URL = 'http://127.0.0.1:' + mock.address().port;
  const dir = copyApp();
  const bill = require(path.join(dir, 'billing.js')), store = require(path.join(dir, 'db.js'));
  if (before) before(store);
  bill.init({ loadSettings: () => ({ platega: { merchant: 'test-merchant', secret: 'test-secret' } }), saveSettings() {} });
  t.after(async () => { try { bill.flush(); } catch {} await new Promise((ok) => mock.close(ok)); store.db.close(); rm(dir); for (const k of ENV) delete process.env[k]; });
  let n = 0;
  const mk = (o = {}) => { n++; const id = crypto.randomBytes(6).toString('hex'); store.users.put({ id, login: 'user' + n + '_' + id.slice(0, 4), email: `user${n}.${id}@example.com`, created: new Date().toISOString(), ...o, id }); return store.users.get(id); };
  const get = (u) => store.users.get(u.id);
  const pay = async (u, plan, promo = '', months = 1) => {
    const was = sent.length, r = await bill.create(get(u), plan, promo, ORIGIN, '', 'card', { months });
    assert.equal(sent.length, was + 1, 'запрос в Platega');
    return { ...store.payments.get(r.order), sent: sent.at(-1).paymentDetails.amount };
  };
  const confirm = (p) => bill.apply(store.payments.get(p.id), 'CONFIRMED');
  return { bill, store, mk, get, pay, confirm };
}

test('старые настройки без Ultra: тариф добавляется сам; обычные модели Max открываются и на Ultra; Claude — только на Ultra', async (t) => {
  const old = [
    { id: 'free', name: 'Free', price: 0, days: 0, tier: 0, msgs: 20 },
    { id: 'pro', name: 'Pro', price: 390, days: 30, tier: 1, msgs: 300 },
    { id: 'max', name: 'Max', price: 1290, days: 30, tier: 2, msgs: null, desc: 'Без ограничений — для работы' },
  ];
  const { bill, store } = await app(t, (st) => {
    st.kv.set('plans', { plans: old, ultra: { on: true, price: 15, daily: 30 } });
    st.kv.set('models', [{ id: 'gpt', name: 'GPT', plans: ['free', 'pro', 'max'] }, { id: 'mini', name: 'Mini', plans: ['free'] }, CLAUDE]);
  });
  const c = bill.cfg(), up = c.plans.find((p) => p.id === 'ultra');
  assert.deepEqual(c.plans.map((p) => p.id), ['free', 'pro', 'max', 'ultra']);
  const mx = c.plans.find((p) => p.id === 'max');
  assert.equal(mx.price, 1290, 'цена Max не тронута');
  assert.equal(mx.msgs, 1000, 'Max: «безлимит» с потолком 1000 → честные 1000 сообщений в день');
  assert.equal(mx.desc, 'Высокие лимиты — для работы');
  assert.equal(up.msgs, null); assert.equal(up.nofair, true, 'Ultra — безлимит без потолка');
  assert.equal(up.price, 6666); assert.equal(up.days, 30); assert.equal(up.credits, 100); assert.equal(up.ultra, true); assert.equal(up.strict, true); assert.ok(up.tier > 2);
  assert.equal(c.plans.find((p) => p.id === 'max').ultra, false, 'у Max доступа к Ultra-моделям больше нет');

  const models = store.kv.get('models');
  assert.deepEqual(models[0].plans, ['free', 'pro', 'max', 'ultra'], 'модель Max — и на Ultra');
  assert.deepEqual(models[1].plans, ['free'], 'остальные модели не тронуты');
  assert.deepEqual(bill.modelPlans(CLAUDE), ['ultra'], 'Claude — только Ultra, хотя у модели сохранено «max»');

  // миграция моделей — один раз: если владелец убрал модель с Ultra, она туда не вернётся
  models[0].plans = ['free', 'pro', 'max']; store.kv.set('models', models);
  bill.init({ loadSettings: () => ({}), saveSettings() {} });
  assert.deepEqual(store.kv.get('models')[0].plans, ['free', 'pro', 'max']);

  // панель: цена, кредиты и доступ сохраняются
  bill.saveCfg({ plans: [{ id: 'ultra', price: 7777, credits: 150 }, { id: 'max', ultra: true, credits: 10 }] });
  const c2 = bill.cfg();
  assert.equal(c2.plans.find((p) => p.id === 'ultra').price, 7777); assert.equal(c2.plans.find((p) => p.id === 'ultra').credits, 150);
  assert.equal(c2.plans.find((p) => p.id === 'max').ultra, true);
  const pub = bill.publicPlans().find((p) => p.id === 'ultra');
  assert.equal(pub.credits, 150); assert.equal(pub.ultra, true); assert.equal(pub.strict, true);
});

test('кредиты тарифа: 100 в день; переход на тариф с большим числом кредитов днём — доначисляется разница', async (t) => {
  const { bill, store, mk, get } = await app(t);
  bill.saveCfg({ plans: [{ id: 'max', ultra: true, credits: 20 }], ultra: { on: true, price: 15 } });
  const u = mk({ plan: 'max', until: Date.now() + 10 * DAY });
  assert.equal(bill.ultraGrant(u.id).bonus, 20);
  const ch = bill.charge(get(u), CLAUDE, { burst: false });
  assert.equal(ch.ok, true); assert.equal(get(u).ultra.bonus, 15);
  store.users.update(u.id, (y) => { y.plan = 'ultra'; });
  assert.equal(bill.ultraGrant(u.id).bonus, 95, '15 осталось + 80 разницы');
  assert.equal(bill.ultraGrant(u.id).bonus, 95, 'второй раз в те же сутки — без начисления');
  const info = bill.ultraInfo(get(u));
  assert.equal(info.access, true); assert.equal(info.max, true); assert.equal(info.daily, 100); assert.equal(info.plan.id, 'ultra');
  const pro = mk({ plan: 'pro', until: Date.now() + DAY });
  const pi = bill.ultraInfo(pro);
  assert.equal(pi.access, false); assert.equal(pi.plan.name, 'Max', 'подсказка — самый дешёвый тариф с доступом');
});

test('оплата Ultra: 6666 ₽, без скидки первой покупки; скидки за срок как у всех; переход с Max пересчитывает остаток по цене', async (t) => {
  const { bill, mk, get, pay, confirm } = await app(t); bill.saveCfg({ ultra: { on: true } }); // тариф Ultra продаётся только при включённых Ultra-моделях
  const a = mk();
  const p = await pay(a, 'ultra');
  assert.equal(p.sent, 6666, 'скидка первой покупки (Pro и Max) на Ultra не действует');
  const t0 = Date.now(); confirm(p);
  assert.equal(bill.planOf(get(a)).id, 'ultra'); near(get(a).until, t0 + 30 * DAY, 'Ultra на 30 дней');

  const y = await pay(mk(), 'ultra', '', 12);
  assert.equal(y.sent, Math.round(6666 * 12 * 0.75), 'за 12 месяцев — −25%, как у остальных тарифов');

  const m = mk({ plan: 'max', until: Date.now() + 30 * DAY });
  const t1 = Date.now(); confirm(await pay(m, 'ultra'));
  near(get(m).until, t1 + 30 * DAY * 990 / 6666 + 30 * DAY, '30 дней Max = 30 × 990 / 6666 дней Ultra, плюс 30 оплаченных');
});

test('промокоды: на Ultra — только выпущенные для Ultra; общие работают на других тарифах', async (t) => {
  const { bill, mk, get, pay } = await app(t); bill.saveCfg({ ultra: { on: true } }); // тариф Ultra продаётся только при включённых Ultra-моделях
  process.env.FIRST_DISCOUNT = '0';
  bill.savePromos([{ code: 'ALL50', kind: 'discount', percent: 50, used: 0, by: [] }, { code: 'ULTRA10', kind: 'discount', percent: 10, plan: 'ultra', used: 0, by: [] }]);
  const u = mk();
  await assert.rejects(bill.create(get(u), 'ultra', 'ALL50', ORIGIN, '', 'card'), /только промокоды, выпущенные именно для него/);
  assert.equal((await pay(u, 'ultra', 'ULTRA10')).sent, 5999, 'именной промокод: 6666 − 10%');
  assert.equal((await pay(mk(), 'pro', 'ALL50')).sent, 195, 'общий промокод на Pro работает');
});

test('приглашения: у пользователя Ultra нет бонусных дней, и тариф не меняется на Pro', async (t) => {
  const { bill, mk, get, pay, confirm } = await app(t); bill.saveCfg({ ultra: { on: true } }); // тариф Ultra продаётся только при включённых Ultra-моделях
  // пригласивший на Ultra: друг оплатил Pro — бонусных дней нет, Ultra и его срок не тронуты
  const A = mk({ plan: 'ultra', until: Date.now() + 10 * DAY }), code = bill.refCode(A), a0 = get(A).until;
  const B = mk();
  assert.equal(bill.refBind(B, code, '10.0.0.1', 'fpB').code, 200);
  confirm(await pay(B, 'pro'));
  assert.equal(get(A).plan, 'ultra'); assert.equal(get(A).until, a0, 'дни не добавлены и не пересчитаны');
  assert.equal(get(B).plan, 'pro', 'друг на Pro свой бонус получает');

  // приглашённый первой оплатой купил Ultra: ровно 30 дней Ultra, без перевода на Pro; пригласивший (Free) получает свой бонус
  const C = mk(), D = mk();
  assert.equal(bill.refBind(D, bill.refCode(C), '10.0.0.2', 'fpD').code, 200);
  const t0 = Date.now(); confirm(await pay(D, 'ultra'));
  assert.equal(get(D).plan, 'ultra'); near(get(D).until, t0 + 30 * DAY, 'Ultra 30 дней, без бонуса');
  assert.equal(get(C).plan, 'pro', 'пригласивший не на Ultra — бонус как раньше');
});

test('сообщения на обычных моделях: Max — 1000 в день, Ultra — безлимит без потолка; потолок «безлимита» для остальных — как раньше', async (t) => {
  const { bill, mk, get } = await app(t);
  const GPT = { id: 'gpt', name: 'GPT', plans: ['free', 'pro', 'max', 'ultra'] };
  const run = (u, n) => { let last; for (let i = 0; i < n; i++) { last = bill.charge(get(u), GPT, { burst: false }); if (last.error) return { sent: i, last }; } return { sent: n, last }; };
  const m = mk({ plan: 'max', until: Date.now() + 10 * DAY }), u = mk({ plan: 'ultra', until: Date.now() + 10 * DAY });
  assert.equal(bill.summary(get(m)).limits.m, 1000); assert.equal(bill.summary(get(u)).limits.m, null);
  const rm = run(m, 1001); assert.equal(rm.sent, 1000); assert.equal(rm.last.code, 'limit');
  const ru = run(u, 1500); assert.equal(ru.sent, 1500, 'Ultra: 1500 сообщений за день — без отказа');
  // галочка «Безлимит без потолка» снята — у Ultra снова общий потолок
  bill.saveCfg({ plans: [{ id: 'ultra', nofair: false }], fair: 1600 });
  assert.equal(bill.cfg().plans.find((p) => p.id === 'ultra').nofair, false);
  const r2 = run(u, 200); assert.equal(r2.sent, 100, 'упёрлись в общий потолок 1600');
});
