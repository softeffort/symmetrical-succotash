'use strict';
// BIZ-09 (каталог): тариф с Ultra-моделями не продаётся и не показывается, пока Ultra выключен в панели (billing.js: planOpen).
// Запуск: npm test (или node --test tests/biz09-ultra-catalog.test.js).
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto'), fs = require('node:fs');
const { copyApp, seed, startServer, rm } = require('../test/helpers');

const DAY = 864e5, ORIGIN = 'https://eide.pro', ENV = ['TRIAL_OFFER', 'FIRST_DISCOUNT', 'FIRST_DISCOUNT_PLANS', 'REF_MODE', 'PLATEGA_URL'];
const ids = (l) => l.map((p) => p.id);

async function app(t, ultraOn) {
  for (const k of ENV) delete process.env[k];
  const sent = [], mock = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => { sent.push(1); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ transactionId: 'tx-' + sent.length, redirect: 'https://pay.example/' + sent.length })); });
  });
  await new Promise((ok) => mock.listen(0, '127.0.0.1', ok));
  process.env.PLATEGA_URL = 'http://127.0.0.1:' + mock.address().port;
  const dir = copyApp(), bill = require(path.join(dir, 'billing.js')), store = require(path.join(dir, 'db.js'));
  bill.init({ loadSettings: () => ({ platega: { merchant: 'm', secret: 's' } }), saveSettings() {} });
  if (ultraOn) bill.saveCfg({ ultra: { on: true } });
  t.after(async () => { try { bill.flush(); } catch {} await new Promise((ok) => mock.close(ok)); store.db.close(); rm(dir); for (const k of ENV) delete process.env[k]; });
  let n = 0;
  const mk = (o = {}) => { n++; const id = crypto.randomBytes(6).toString('hex'); store.users.put({ id, login: 'user' + n + '_' + id.slice(0, 4), email: `u${n}.${id}@example.com`, created: new Date().toISOString(), ...o, id }); return store.users.get(id); };
  return { bill, store, mk, sent };
}

test('planOpen: тариф с ultra: true закрыт, пока Ultra выключен; остальные тарифы открыты всегда', async (t) => {
  const { bill } = await app(t), c = bill.cfg(), by = (id) => c.plans.find((p) => p.id === id);
  assert.equal(bill.ultraCfg().on, false, 'по умолчанию Ultra выключен');
  assert.equal(bill.planOpen(by('ultra')), false);
  for (const id of ['free', 'pro', 'max']) assert.equal(bill.planOpen(by(id)), true, id);
  assert.equal(bill.planOpen(by('ultra'), { ...c, ultra: { on: true } }), true, 'конфиг можно передать явно');
  bill.saveCfg({ ultra: { on: true } });
  assert.equal(bill.planOpen(by('ultra')), true);
});

test('каталог: закрытый тариф не попадает в publicPlans и сводку аккаунта, но есть в полном списке для панели', async (t) => {
  const { bill, mk } = await app(t), u = mk();
  assert.ok(!ids(bill.publicPlans()).includes('ultra'));
  assert.ok(ids(bill.publicPlans(true)).includes('ultra'), 'панель видит все тарифы');
  assert.ok(!ids(bill.summary(u).plans).includes('ultra'));
  assert.ok(ids(bill.cfg().plans).includes('ultra'), 'в настройках тариф остаётся');
  bill.saveCfg({ ultra: { on: true } });
  assert.ok(ids(bill.publicPlans()).includes('ultra')); assert.ok(ids(bill.summary(u).plans).includes('ultra'));
});

test('скидка на первую покупку: закрытый тариф не входит в список тарифов предложения', async (t) => {
  const { bill, mk } = await app(t), u = mk();
  process.env.FIRST_DISCOUNT_PLANS = 'pro,ultra';
  assert.deepEqual(bill.offers(u).first.plans, ['pro']); assert.deepEqual(bill.publicOffers().first.plans, ['pro']);
  bill.saveCfg({ ultra: { on: true } });
  assert.deepEqual(bill.offers(u).first.plans, ['pro', 'ultra']); assert.deepEqual(bill.publicOffers().first.plans, ['pro', 'ultra']);
});

test('create: покупка закрытого тарифа отказывает до запроса в платёжку; открытые тарифы продаются; при включённом Ultra — продаётся', async (t) => {
  const { bill, mk, sent } = await app(t), u = mk();
  await assert.rejects(bill.create(u, 'ultra', '', ORIGIN, '', 'card'), /Тариф Ultra сейчас недоступен/);
  await assert.rejects(bill.create(u, 'ultra', '', ORIGIN, '', 'card', { months: 3 }), /Тариф Ultra сейчас недоступен/);
  assert.equal(sent.length, 0, 'платёж не создавался');
  assert.ok((await bill.create(u, 'pro', '', ORIGIN, '', 'card')).order, 'Pro продаётся');
  bill.saveCfg({ ultra: { on: true } });
  assert.ok((await bill.create(u, 'ultra', '', ORIGIN, '', 'card')).order, 'Ultra включён — тариф продаётся');
});

test('действующий подписчик Ultra видит свой тариф и срок, хотя в каталоге тарифа нет', async (t) => {
  const { bill, mk } = await app(t), until = Date.now() + 10 * DAY, u = mk({ plan: 'ultra', until });
  const s = bill.summary(u);
  assert.equal(s.plan.id, 'ultra'); assert.equal(s.plan.name, 'Ultra'); assert.equal(s.plan.until, until);
  assert.equal(bill.planOf(u).id, 'ultra'); assert.ok(!ids(s.plans).includes('ultra'));
});

test('HTTP: GET /api/plans, /api/billing и лендинг без Ultra по умолчанию; с включённым Ultra тариф есть', async (t) => {
  const run = async (on) => {
    const dir = copyApp(); seed(dir);
    if (on) { const bill = require(path.join(dir, 'billing.js')), store = require(path.join(dir, 'db.js')); bill.saveCfg({ ultra: { on: true } }); store.db.close(); }
    const s = await startServer(dir, {}); t.after(async () => { await s.stop(); rm(dir); });
    const pl = await s.req('GET', '/api/plans'), me = await s.req('GET', '/api/billing', { token: 'tok1' }), home = await s.req('GET', '/');
    assert.equal(pl.status, 200); assert.equal(me.status, 200);
    return { api: pl.json.plans.some((p) => p.ultra), bill: me.json.plans.some((p) => p.ultra), landing: home.text.includes('"price":"6666"') };
  };
  assert.deepEqual(await run(false), { api: false, bill: false, landing: false }, 'по умолчанию Ultra-тарифа нет нигде');
  const on = await run(true); assert.equal(on.api, true); assert.equal(on.bill, true); assert.equal(on.landing, true);
});

test('панель: плашка «скрыт с продажи» у закрытого тарифа и полный список тарифов в админских ответах', () => {
  const panel = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'v-legacy.js'), 'utf8'), srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(panel, /скрыт с продажи: Ultra выключен/);
  assert.match(srv, /register: regOpen\(\), plans: bill\.publicPlans\(true\)/);
});
