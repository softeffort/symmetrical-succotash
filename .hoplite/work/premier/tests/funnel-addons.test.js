// Воронка и допродажи (BIZ-29): пакеты сообщений, сбросы и Ultra-кредиты не считаются покупкой тарифа.
// Запуск: node --test tests/funnel-addons.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { copyApp, seed, startServer, rm } = require('../test/helpers');
const { productKind } = require('../funnel');

test('классификатор продукта: тарифы, пробный период и команда — подписки; сброс, пакет, кредиты — допродажи', () => {
  for (const p of ['pro', 'max', 'ultra', 'team', 'free']) assert.equal(productKind(p), 'subscription', p);
  for (const p of ['reset', 'pack', 'credits']) assert.equal(productKind(p), 'addon', p);
  assert.equal(productKind(undefined), 'subscription');
});

test('воронка: оформление допродаж не пишет шаг checkout, оформление тарифа — пишет', async (t) => {
  const mock = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ transactionId: 'tx-' + Math.random(), redirect: 'https://pay.example/x' })); }); });
  await new Promise((ok) => mock.listen(0, '127.0.0.1', ok));
  const dir = copyApp();
  seed(dir, { users: [{ id: 'u1', login: 'anna', email: 'anna@example.com', created: new Date().toISOString() }], sessions: { tok1: 'u1' } });
  const s = await startServer(dir, { PLATEGA_URL: 'http://127.0.0.1:' + mock.address().port, PLATEGA_MERCHANT_ID: 'm', PLATEGA_SECRET: 's' });
  t.after(async () => { await s.stop(); await new Promise((ok) => mock.close(ok)); rm(dir); });
  const checkout = () => { const d = new DatabaseSync(path.join(dir, 'data', 'premier.db'), { readOnly: true }); try { return d.prepare("SELECT count(*) n FROM funnel WHERE uid = 'u1' AND step = 'checkout'").get().n; } finally { d.close(); } };
  for (const body of [{ plan: 'reset', method: 'card' }, { plan: 'pack', n: 1000, method: 'card' }, { plan: 'credits', qty: 5, method: 'card' }]) {
    const r = await s.req('POST', '/api/pay/create', { token: 'tok1', body });
    if (body.plan !== 'credits') assert.equal(r.status, 200, body.plan + ': ' + r.text); // кредиты зависят от настройки Ultra, шаг не должен появиться в любом случае
    assert.equal(checkout(), 0, 'после ' + body.plan + ' шага checkout быть не должно');
  }
  const pro = await s.req('POST', '/api/pay/create', { token: 'tok1', body: { plan: 'pro', method: 'card' } });
  assert.equal(pro.status, 200, pro.text);
  assert.equal(checkout(), 1);
});

test('статистика воронки: допродажи не дают checkout и paid, считаются отдельно (число и выручка), общая выручка прежняя', async (t) => {
  const now = new Date().toISOString();
  const dir = copyApp();
  seed(dir, { users: ['a', 'b', 'c', 'd'].map((x) => ({ id: 'u' + x, login: 'user' + x, email: x + '@example.com', created: now })), sessions: { tok: 'ua' } });
  const s = await startServer(dir);
  t.after(async () => { await s.stop(); rm(dir); });
  const d = new DatabaseSync(path.join(dir, 'data', 'premier.db'));
  const put = (id, uid, plan, status, amount) => d.prepare('INSERT INTO payments (id, tx, uid, status, at, data) VALUES (?, ?, ?, ?, ?, ?)').run(id, id, uid, status, Date.now(), JSON.stringify({ id, uid, plan, status, amount, created: Date.now() }));
  put('p1', 'ua', 'pack', 'CONFIRMED', 300); // только пакет
  put('p2', 'ub', 'pro', 'CONFIRMED', 500); put('p3', 'ub', 'credits', 'CONFIRMED', 200); // тариф и кредиты
  put('p4', 'uc', 'reset', 'PENDING', 200); // неоплаченный сброс
  put('p5', 'ud', 'reset', 'CONFIRMED', 200); put('p6', 'ud', 'pack', 'CONFIRMED', 100);
  d.close();
  const login = await s.req('POST', '/api/admin/login', { body: { password: 'Test-Admin-Pass-2026' } });
  const f = await s.req('GET', '/api/admin/funnel?days=30&by=source', { headers: { Authorization: 'Bearer ' + login.json.token } });
  assert.equal(f.status, 200, f.text);
  const t0 = f.json.total;
  assert.equal(t0.signups, 4);
  assert.equal(t0.checkout, 1, 'начали оплату тарифа — только ub');
  assert.equal(t0.paid, 1, 'оплатили тариф — только ub');
  assert.equal(t0.addons, 4, 'допродаж оплачено: пакет, кредиты, сброс, пакет');
  assert.equal(t0.addonRevenue, 800);
  assert.equal(t0.revenue, 1300, 'выручка включает все продукты');
});
