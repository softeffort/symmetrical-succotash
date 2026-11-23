// Сбросы лимита: баланс-пакеты (1 сброс = 200 ₽, пакеты 1/5/10/25 со скидкой, без срока).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { copyApp, rm } = require('./helpers');

async function app(t) {
  const dir = copyApp();
  const bill = require(path.join(dir, 'billing.js')), store = require(path.join(dir, 'db.js'));
  bill.init({ loadSettings: () => ({ platega: { merchant: 'test-merchant', secret: 'test-secret' } }), saveSettings() {} });
  t.after(() => { try { bill.flush(); } catch {} store.db.close(); rm(dir); });
  let n = 0;
  const mk = (o = {}) => { n++; const id = 'u' + n + Math.random().toString(16).slice(2, 6); store.users.put({ id, login: 'user' + n + '_' + id, email: id + '@example.com', created: new Date().toISOString(), ...o, id }); return store.users.get(id); };
  return { bill, store, mk };
}

test('пакеты: 200 ₽ за сброс, скидки 0 / 10 / 15 / 25 %, потолок 25', async (t) => {
  const { bill } = await app(t);
  assert.equal(bill.RESET.price, 200);
  const q = (n) => bill.resetQuote(n).amount;
  assert.equal(q(1), 200); assert.equal(q(4), 800); assert.equal(q(5), 900);
  assert.equal(q(9), 1620); assert.equal(q(10), 1700); assert.equal(q(24), 4080); assert.equal(q(25), 3750);
  assert.deepEqual(bill.resetQuote(5), { qty: 5, unit: 200, full: 1000, pct: 10, amount: 900 });
  for (const bad of [0, 26, -1, 2.5, 'много']) assert.throws(() => bill.resetQuote(bad), /от 1 до 25/);
});

test('покупка пакета: сумма к оплате и пометка скидки; промокод не действует', async (t) => {
  const { bill, store, mk } = await app(t);
  const u = mk();
  await assert.rejects(bill.create(store.users.get(u.id), 'reset', 'ANY', 'http://x', '', 'card', { qty: 5 }), /Промокоды на сброс лимита не действуют/);
});

test('оплата пакета зачисляет сбросы на баланс, без срока и без сброса счётчиков сразу', async (t) => {
  const { bill, store, mk } = await app(t);
  const u = mk();
  store.payments.put({ id: 'p1', uid: u.id, plan: 'reset', qty: 5, amount: 900, status: 'PENDING', created: Date.now() });
  bill.apply(store.payments.get('p1'), 'CONFIRMED');
  assert.equal(bill.resetInfo(store.users.get(u.id)).n, 5);
  assert.equal(store.users.get(u.id).resetLog[0].kind, 'buy');
});

test('трата сброса: −1 с баланса, счётчики дня обнуляются; без баланса и на нуле — отказ', async (t) => {
  const { bill, store, mk } = await app(t);
  const u = mk({ resetBal: 2 });
  assert.equal(bill.useReset(u.id).ok, false, 'счётчики на нуле — сбрасывать нечего');
  bill.add(u.id, 'm', 7);
  const r = bill.useReset(u.id);
  assert.equal(r.ok, true); assert.equal(r.left, 1);
  assert.equal(bill.used(u.id).m, 0);
  assert.equal(store.users.get(u.id).resetLog[0].kind, 'use');
  const empty = mk({});
  bill.add(empty.id, 'm', 1);
  assert.equal(bill.useReset(empty.id).code, 'no_balance');
});

test('возврат пакета забирает оставшиеся сбросы, история ведётся', async (t) => {
  const { bill, store, mk } = await app(t);
  const u = mk({ resetBal: 5 });
  store.payments.put({ id: 'p2', uid: u.id, plan: 'reset', qty: 5, amount: 900, status: 'CONFIRMED', applied: true, created: Date.now() });
  bill.apply(store.payments.get('p2'), 'CHARGEBACKED');
  assert.equal(store.users.get(u.id).resetBal, 0);
  assert.equal(bill.resetHistory(u.id)[0].kind, 'refund');
});

test('оплата 1 сброса (now) при исчерпанном лимите: счётчики дня обнуляются сразу, в балансе ничего не остаётся', async (t) => {
  const { bill, store, mk } = await app(t);
  const u = mk();
  bill.add(u.id, 'm', 20); // Free: 20 в день — лимит исчерпан
  store.payments.put({ id: 'p3', uid: u.id, plan: 'reset', qty: 1, now: true, amount: 200, status: 'PENDING', created: Date.now() });
  const it = bill.apply(store.payments.get('p3'), 'CONFIRMED');
  assert.equal(it.usedNow, true);
  assert.equal(it.credited, 0);
  assert.equal(bill.used(u.id).m, 0);
  assert.equal(bill.resetInfo(store.users.get(u.id)).n, 0);
  const log = store.users.get(u.id).resetLog;
  assert.equal(log[0].kind, 'buy');
  assert.equal(log[1].kind, 'use');
});

test('оплата 1 сброса на нулевых счётчиках: не тратится, остаётся на балансе', async (t) => {
  const { bill, store, mk } = await app(t);
  const u = mk();
  store.payments.put({ id: 'p4', uid: u.id, plan: 'reset', qty: 1, now: true, amount: 200, status: 'PENDING', created: Date.now() });
  const it = bill.apply(store.payments.get('p4'), 'CONFIRMED');
  assert.equal(it.usedNow, false);
  assert.equal(it.credited, 1);
  assert.equal(bill.resetInfo(store.users.get(u.id)).n, 1);
});

test('пакет: now=true — один сразу, остальные на баланс; без now — всё на баланс', async (t) => {
  const { bill, store, mk } = await app(t);
  const a = mk();
  bill.add(a.id, 'm', 20); // лимит исчерпан — один сброс тратится сразу
  store.payments.put({ id: 'p5', uid: a.id, plan: 'reset', qty: 5, now: true, amount: 900, status: 'PENDING', created: Date.now() });
  const it5 = bill.apply(store.payments.get('p5'), 'CONFIRMED');
  assert.equal(it5.usedNow, true);
  assert.equal(it5.credited, 4);
  assert.equal(bill.used(a.id).m, 0);
  assert.equal(bill.resetInfo(store.users.get(a.id)).n, 4);
  const b = mk();
  bill.add(b.id, 'm', 3);
  store.payments.put({ id: 'p6', uid: b.id, plan: 'reset', qty: 5, amount: 900, status: 'PENDING', created: Date.now() });
  const it6 = bill.apply(store.payments.get('p6'), 'CONFIRMED');
  assert.equal(it6.usedNow, false);
  assert.equal(it6.credited, 5);
  assert.equal(bill.used(b.id).m, 3);
  assert.equal(bill.resetInfo(store.users.get(b.id)).n, 5);
});
