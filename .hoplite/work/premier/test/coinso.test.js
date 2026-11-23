// Coinso: создание счёта (standard, payment_url), вебхук с HMAC-подписью, перепроверка статуса,
// тестовые платежи, отказ, неизвестный счёт, sync, проверка ключа,
// и метод «Карта» через Coinso (с фолбэком на Platega).
'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const { copyApp, rm } = require('./helpers');

const DAY = 864e5, ORIGIN = 'https://eide.pro', SECRET = 'coinso-test-secret';
const ENV = ['COINSO_URL', 'PLATEGA_URL', 'PLATEGA_MERCHANT_ID', 'PLATEGA_SECRET'];

function coinsoMock() {
  const seen = [];
  const fail = { failCreate: false };
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      let body = null; try { body = b ? JSON.parse(b) : null; } catch {}
      seen.push({ m: req.method, path: u.pathname, q: Object.fromEntries(u.searchParams), body, auth: req.headers.authorization || '' });
      res.setHeader('Content-Type', 'application/json');
      if (u.pathname === '/api/payment/create') {
        if (fail.failCreate) { res.statusCode = 503; return res.end(JSON.stringify({ success: false, message: 'банк-партнёр временно недоступен' })); }
        res.end(JSON.stringify({ success: true, invoice_id: 'INV' + seen.length, payment_url: 'https://coinso.io/pay/INV' + seen.length }));
      }
      else if (u.pathname === '/api/payment/status') res.end(JSON.stringify({ success: true, status: u.searchParams.get('uuid') === 'INVFAILED' ? 'failed' : 'paid', amount: '366.00' }));
      else if (u.pathname === '/api/payment/methods') res.end(JSON.stringify({ success: true, methods: [{ method: 'crypto' }, { method: 'sbp' }] }));
      else res.end(JSON.stringify({ success: false, message: 'not found' }));
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, seen, fail, url: 'http://127.0.0.1:' + srv.address().port })));
}

function plategaMock() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      seen.push({ m: req.method, path: u.pathname });
      res.setHeader('Content-Type', 'application/json');
      if (u.pathname === '/v2/transaction/process') res.end(JSON.stringify({ transactionId: 'PL' + seen.length, redirect: 'https://platega.test/pay' }));
      else res.end(JSON.stringify({ status: 'pending' }));
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, seen, url: 'http://127.0.0.1:' + srv.address().port })));
}

async function app(t) {
  for (const k of ENV) delete process.env[k];
  const mock = await coinsoMock();
  const pg = await plategaMock();
  process.env.COINSO_URL = mock.url + '/api';
  process.env.PLATEGA_URL = pg.url;
  process.env.PLATEGA_MERCHANT_ID = 'test-merchant';
  process.env.PLATEGA_SECRET = 'test-secret';
  const dir = copyApp();
  const bill = require(path.join(dir, 'billing.js')), store = require(path.join(dir, 'db.js'));
  bill.init({ loadSettings: () => ({ coinso: { projectId: '745924289', secret: SECRET } }), saveSettings() {} });
  t.after(async () => { try { bill.flush(); } catch {} await Promise.all([new Promise((ok) => mock.srv.close(ok)), new Promise((ok) => pg.srv.close(ok))]); try { store.db.close(); } catch {} rm(dir); for (const k of ENV) delete process.env[k]; });
  let n = 0;
  const mk = (o = {}) => { n++; const id = crypto.randomBytes(6).toString('hex'); store.users.put({ id, login: 'u' + n + '_' + id.slice(0, 4), email: `u${n}@example.com`, created: new Date().toISOString(), plan: 'max', until: Date.now() + 30 * DAY, ...o, id }); return store.users.get(id); };
  const wh = (body, sig) => bill.coinsoCallback({ 'x-signature': sig == null ? crypto.createHmac('sha256', SECRET).update(JSON.stringify(body)).digest('hex') : sig }, JSON.stringify(body));
  return { bill, store, mk, mock, pg, wh, ORIGIN };
}

test('создание счёта: Bearer Secret Key, custom = номер заказа, payment_url, провайдер coinso', async (t) => {
  const { bill, store, mk, mock, ORIGIN: O } = await app(t);
  const u = mk();
  const r = await bill.create(u, 'reset', '', O, '', 'coinso');
  assert.match(r.url, /^https:\/\/coinso\.io\/pay\/INV\d+/);
  const req = mock.seen.find((x) => x.path === '/api/payment/create');
  assert.ok(req, 'запрос к /api/payment/create');
  assert.equal(req.auth, 'Bearer ' + SECRET);
  assert.equal(req.body.project_id, 745924289);
  assert.equal(req.body.custom, r.order);
  assert.equal(req.body.amount, bill.resetQuote(1).amount);
  assert.equal(req.body.client_user_id, u.id);
  const pay = store.payments.get(r.order);
  assert.equal(pay.provider, 'coinso');
  assert.equal(pay.status, 'PENDING');
  assert.ok(pay.tx, 'tx = invoice_id');
});

test('вебхук payment.success: подпись ок + статус paid -> CONFIRMED; чужая подпись -> 401', async (t) => {
  const { bill, store, mk, wh, ORIGIN: O } = await app(t);
  const u = mk();
  const r = await bill.create(u, 'reset', '', O, '', 'coinso');
  const pay = store.payments.get(r.order);
  let res = await wh({ event: 'payment.success', invoice_id: pay.tx, transaction_id: 1, custom: pay.id, amount: pay.amount });
  assert.equal(res.code, 200);
  assert.equal(store.payments.get(r.order).status, 'CONFIRMED');
  res = await wh({ event: 'payment.success', invoice_id: pay.tx, transaction_id: 1, custom: pay.id, amount: pay.amount });
  assert.equal(res.code, 200);
  assert.equal(store.payments.get(r.order).status, 'CONFIRMED');
  const r2 = await bill.create(mk(), 'reset', '', O, '', 'coinso');
  const pay2 = store.payments.get(r2.order);
  res = await wh({ event: 'payment.success', invoice_id: pay2.tx, transaction_id: 2, custom: r2.order, amount: pay2.amount }, 'deadbeef'.repeat(8));
  assert.equal(res.code, 401);
  assert.equal(store.payments.get(r2.order).status, 'PENDING');
});

test('вебхук: test_mode не выдаёт товар; payment.failed -> CANCELED; неизвестный счёт -> 200', async (t) => {
  const { bill, store, mk, wh, ORIGIN: O } = await app(t);
  const u = mk();
  const r = await bill.create(u, 'reset', '', O, '', 'coinso');
  const pay = store.payments.get(r.order);
  let res = await wh({ event: 'payment.success', invoice_id: pay.tx, transaction_id: 3, custom: pay.id, test_mode: true });
  assert.equal(res.code, 200);
  assert.equal(store.payments.get(r.order).status, 'PENDING', 'тестовый платёж не подтверждён');
  res = await wh({ event: 'payment.failed', invoice_id: pay.tx, transaction_id: 4, custom: pay.id, error_code: 'payment_declined' });
  assert.equal(res.code, 200);
  assert.equal(store.payments.get(r.order).status, 'CANCELED');
  res = await wh({ event: 'payment.success', invoice_id: 'UNKNOWN', transaction_id: 5, custom: 'nope' });
  assert.equal(res.code, 200);
});

test('sync: статус paid из API -> CONFIRMED; failed -> CANCELED', async (t) => {
  const { bill, store, mk, ORIGIN: O } = await app(t);
  const r = await bill.create(mk(), 'reset', '', O, '', 'coinso');
  let pay = await bill.sync(store.payments.get(r.order));
  assert.equal(pay.status, 'CONFIRMED');
  const r2 = await bill.create(mk(), 'reset', '', O, '', 'coinso');
  const p2 = store.payments.get(r2.order);
  p2.tx = 'INVFAILED';
  store.payments.put(p2);
  pay = await bill.sync(store.payments.get(r2.order));
  assert.equal(pay.status, 'CANCELED');
});

test('coinsoMe: список способов проекта; methods в summary', async (t) => {
  const { bill, mk } = await app(t);
  const j = await bill.coinsoMe();
  assert.deepEqual(j.methods.map((x) => x.method), ['crypto', 'sbp']);
  const u = mk();
  assert.equal(bill.summary(u).methods.coinso, true);
});

test('метод «Карта» ходит через Coinso, когда он подключён', async (t) => {
  const { bill, store, mk, mock, ORIGIN: O } = await app(t);
  const r = await bill.create(mk(), 'reset', '', O, '', 'card');
  const pay = store.payments.get(r.order);
  assert.equal(pay.provider, 'coinso');
  assert.ok(mock.seen.some((x) => x.path === '/api/payment/create'), 'запрос ушёл в Coinso');
});

test('фолбэк: Coinso (card) сбой, Platega подключён -> платёж через Platega', async (t) => {
  const { bill, store, mk, mock, pg, ORIGIN: O } = await app(t);
  mock.fail.failCreate = true;
  const r = await bill.create(mk(), 'reset', '', O, '', 'card');
  const pay = store.payments.get(r.order);
  assert.equal(pay.tx, 'PL1');
  assert.notEqual(pay.provider, 'coinso');
  assert.ok(pg.seen.some((x) => x.path === '/v2/transaction/process'), 'запрос ушёл в Platega');
});
