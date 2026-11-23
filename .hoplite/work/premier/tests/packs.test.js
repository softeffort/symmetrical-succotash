// Пакеты сообщений, автосброс и «Мои платежи» (billing.js). Запуск: npm test (или node --test tests/packs.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { copyApp, rm } = require('../test/helpers');

const MODEL = { id: 'm', name: 'Модель', weight: 1, plans: ['free', 'pro', 'max'] };
const HEAVY = { id: 'h', name: 'Тяжёлая', weight: 3, plans: ['free', 'pro', 'max'] };
const DAY = 864e5;

async function app(t) {
  const dir = copyApp();
  const bill = require(path.join(dir, 'billing.js')), store = require(path.join(dir, 'db.js'));
  bill.init({ loadSettings: () => ({ platega: { merchant: 'test-merchant', secret: 'test-secret' } }), saveSettings() {} });
  t.after(() => { try { bill.flush(); } catch {} store.db.close(); rm(dir); });
  let n = 0;
  const mk = (o = {}) => { n++; const id = 'u' + n + Math.random().toString(16).slice(2, 6); store.users.put({ id, login: 'user' + n + '_' + id, email: id + '@example.com', created: new Date().toISOString(), ...o, id }); return store.users.get(id); };
  const get = (u) => store.users.get(u.id);
  const pay = (u, o) => { const id = 'p' + Math.random().toString(16).slice(2, 10); store.payments.put({ id, uid: u.id, status: 'PENDING', created: Date.now(), ...o }); return bill.apply(store.payments.get(id), 'CONFIRMED'); };
  return { bill, store, mk, get, pay };
}
const max = () => ({ plan: 'max', until: Date.now() + 10 * DAY }); // «безлимит» с потолком fair = 1000 в день

test('автосброс: лимит кончился, на балансе есть сброс — тратится сам, сообщение проходит', async (t) => {
  const { bill, mk, get } = await app(t);
  const u = mk({ ...max(), resetBal: 2 });
  bill.add(u.id, 'm', 1000);
  const ch = bill.charge(get(u), MODEL, { burst: false });
  assert.equal(ch.ok, true); assert.equal(ch.autoReset, true);
  assert.equal(bill.used(u.id).m, 1, 'счётчик обнулён и списано это сообщение');
  assert.equal(get(u).resetBal, 1);
  assert.equal(get(u).resetLog.at(-1).kind, 'auto');
});

test('автосброс выключен или сбросов нет — обычный отказ «limit»', async (t) => {
  const { bill, mk, get } = await app(t);
  const off = mk({ ...max(), resetBal: 3, autoReset: false });
  bill.add(off.id, 'm', 1000);
  assert.equal(bill.charge(get(off), MODEL, { burst: false }).code, 'limit');
  assert.equal(get(off).resetBal, 3);
  const none = mk(max());
  bill.add(none.id, 'm', 1000);
  assert.equal(bill.charge(get(none), MODEL, { burst: false }).code, 'limit');
  bill.setAutoReset(off.id, true);
  assert.equal(bill.charge(get(off), MODEL, { burst: false }).ok, true);
  assert.equal(bill.summary(get(off)).autoReset, true);
});

test('сброс оплачен заранее (лимит не исчерпан): не сгорает, ложится на баланс; при исчерпанном — тратится сразу', async (t) => {
  const { bill, mk, get, pay } = await app(t);
  const u = mk(max());
  bill.add(u.id, 'm', 500);
  const early = pay(u, { plan: 'reset', qty: 1, now: true, amount: 200 });
  assert.equal(early.usedNow, false); assert.equal(early.credited, 1);
  assert.equal(bill.used(u.id).m, 500, 'остаток дня не обнулился');
  assert.equal(get(u).resetBal, 1);
  bill.add(u.id, 'm', 500);
  const late = pay(u, { plan: 'reset', qty: 1, now: true, amount: 200 });
  assert.equal(late.usedNow, true);
  assert.equal(bill.used(u.id).m, 0);
  assert.equal(get(u).resetBal, 1, 'первый сброс так и лежит на балансе');
});

test('пакет: оплата зачисляет, тратится только после дневного лимита, возврат при ошибке ответа', async (t) => {
  const { bill, mk, get, pay } = await app(t);
  const u = mk(max());
  pay(u, { plan: 'pack', pack: { n: 1000, days: 30 }, amount: 190 });
  assert.equal(bill.packLeft(get(u)), 1000);
  assert.equal(bill.charge(get(u), MODEL, { burst: false }).pack, undefined, 'пока есть дневной лимит — пакет не трогаем');
  assert.equal(bill.packLeft(get(u)), 1000);
  bill.add(u.id, 'm', 999);
  const ch = bill.charge(get(u), HEAVY, { burst: false });
  assert.equal(ch.ok, true); assert.deepEqual(ch.pack.map((x) => x.n), [3]);
  assert.equal(bill.packLeft(get(u)), 997, 'вес модели учитывается');
  bill.refund(get(u), ch);
  assert.equal(bill.packLeft(get(u)), 1000);
  const s = bill.summary(get(u)).packs;
  assert.equal(s.left, 1000); assert.equal(s.list.length, 1); assert.ok(s.offers.length > 0);
});

test('пакет раньше автосброса; сгоревший пакет не тратится; возврат платежа обнуляет остаток', async (t) => {
  const { bill, store, mk, get, pay } = await app(t);
  const u = mk({ ...max(), resetBal: 1 });
  const it = pay(u, { plan: 'pack', pack: { n: 10, days: 30 }, amount: 190 });
  bill.add(u.id, 'm', 1000);
  assert.ok(bill.charge(get(u), MODEL, { burst: false }).pack);
  assert.equal(get(u).resetBal, 1, 'сброс не тронут — сначала пакет');
  bill.apply(store.payments.get(it.id), 'CHARGEBACKED');
  assert.equal(bill.packLeft(get(u)), 0);
  const old = mk(max());
  store.users.update(old.id, (x) => { x.msgPacks = [{ id: 'x', n: 100, left: 100, until: Date.now() - 1000 }]; });
  bill.add(old.id, 'm', 1000);
  assert.equal(bill.charge(get(old), MODEL, { burst: false }).code, 'limit');
});

test('пакет: промокод и несуществующий размер — отказ; первая покупка −30% пакетом не расходуется', async (t) => {
  const { bill, mk, get, pay } = await app(t);
  const u = mk();
  await assert.rejects(bill.create(get(u), 'pack', 'ANY', 'http://x', '', 'card', { n: 1000 }), /Промокоды на пакеты/);
  await assert.rejects(bill.create(get(u), 'pack', '', 'http://x', '', 'card', { n: 7 }), /Такого пакета/);
  const before = bill.offers(get(u)).first;
  pay(u, { plan: 'pack', pack: { n: 1000, days: 30 }, amount: 190 });
  assert.deepEqual(bill.offers(get(u)).first, before);
});

test('панель: пакеты дешевле себестоимости не сохраняются; нормальные — сохраняются и сортируются', async (t) => {
  const { bill } = await app(t);
  assert.throws(() => bill.saveCfg({ msgCost: 0.5, packs: [{ n: 1000, price: 190 }] }), /дешевле себестоимости/);
  const c = bill.saveCfg({ msgCost: 0.1, minMargin: 40, packDays: 45, packs: [{ n: 3000, price: 490 }, { n: 1000, price: 190 }, { n: 0, price: 5 }] });
  assert.deepEqual(c.packs, [{ n: 1000, price: 190 }, { n: 3000, price: 490 }]);
  assert.equal(c.packDays, 45); assert.equal(c.minMargin, 40); assert.equal(c.msgCost, 0.1);
});

test('«Мои платежи»: свои, новые сверху, с понятными полями', async (t) => {
  const { bill, store, mk } = await app(t);
  const u = mk(), other = mk();
  store.payments.put({ id: 'a', uid: u.id, plan: 'pro', amount: 390, status: 'CONFIRMED', created: Date.now() - 5000 });
  store.payments.put({ id: 'b', uid: u.id, plan: 'pack', pack: { n: 3000, days: 30 }, amount: 490, status: 'PENDING', created: Date.now() });
  store.payments.put({ id: 'c', uid: other.id, plan: 'max', amount: 990, status: 'CONFIRMED', created: Date.now() });
  const list = bill.myPayments(u.id);
  assert.deepEqual(list.map((x) => x.order), ['b', 'a']);
  assert.equal(list[0].pack, 3000); assert.equal(list[0].status, 'PENDING');
});
