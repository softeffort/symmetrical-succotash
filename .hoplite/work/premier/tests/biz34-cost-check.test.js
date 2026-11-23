// BIZ-34: проверка «не ниже себестоимости» идёт по итоговому конфигу, а не по полям запроса (billing.js, saveCfg).
// Запуск: npm test (или node --test tests/biz34-cost-check.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { copyApp, rm } = require('../test/helpers');

function app(t) {
  const dir = copyApp(), bill = require(path.join(dir, 'billing.js')), store = require(path.join(dir, 'db.js'));
  bill.init({ loadSettings: () => ({}), saveSettings() {} });
  t.after(() => { try { bill.flush(); } catch {} store.db.close(); rm(dir); });
  return { bill, store };
}

test('смена одной себестоимости не обходит проверку пакетов: 10000 сообщений за 1390 ₽ при 0,15 ₽ — отказ с минимальной ценой', (t) => {
  const { bill } = app(t), pack = bill.cfg().packs.find((x) => x.n === 10000);
  assert.equal(pack.price, 1390, 'в настройках по умолчанию пакет 10000 за 1390 ₽');
  assert.throws(() => bill.saveCfg({ msgCost: 0.15 }), (e) => /Пакет 10000 сообщений за 1390 ₽ дешевле себестоимости/.test(e.message) && /1500 ₽/.test(e.message));
  assert.equal(bill.cfg().msgCost, 0, 'ничего не сохранено');
  assert.doesNotThrow(() => bill.saveCfg({ msgCost: 0.13 }), '1300 ₽ ≤ 1390 ₽ — можно');
  assert.equal(bill.cfg().msgCost, 0.13);
});

test('пакеты: проверка идёт и вместе с новой себестоимостью, и без неё; minMargin сам по себе не блокирует', (t) => {
  const { bill } = app(t);
  assert.throws(() => bill.saveCfg({ msgCost: 0.2, packs: [{ n: 1000, price: 150 }] }), /Пакет 1000 сообщений за 150 ₽ дешевле себестоимости.*200 ₽/);
  bill.saveCfg({ msgCost: 0.1, packs: [{ n: 1000, price: 150 }] });
  assert.throws(() => bill.saveCfg({ packs: [{ n: 1000, price: 90 }] }), /Пакет 1000 сообщений за 90 ₽ дешевле себестоимости.*100 ₽/);
  assert.doesNotThrow(() => bill.saveCfg({ minMargin: 80 }), 'наценка — предупреждение в панели, не запрет');
});

test('сброс: смена только resetMsgs или msgCost проверяется по итоговой цене сброса', (t) => {
  const { bill } = app(t);
  bill.saveCfg({ msgCost: 0.1, packs: [{ n: 1000, price: 500 }] }); // сброс 200 ₽ (в пачке 150 ₽) за 1000 сообщений — 100 ₽ себестоимости
  assert.throws(() => bill.saveCfg({ resetMsgs: 2000 }), (e) => /Сброс лимита за 200 ₽/.test(e.message) && /минимальная цена сброса — 266 ₽/.test(e.message));
  assert.throws(() => bill.saveCfg({ msgCost: 0.16 }), /Сброс лимита за 200 ₽.*дешевле себестоимости/);
  assert.equal(bill.cfg().resetMsgs, 1000);
  assert.doesNotThrow(() => bill.saveCfg({ resetMsgs: 2000, resetPrice: 266 }));
});

test('цена Ultra-кредита против себестоимости кредита проверяется при любом сохранении', (t) => {
  const { bill } = app(t);
  assert.throws(() => bill.saveCfg({ ultra: { on: true, price: 4, cost: 5 } }), /Цена кредита 4 ₽ ниже себестоимости 5 ₽.*5 ₽/);
  assert.doesNotThrow(() => bill.saveCfg({ ultra: { on: true, price: 6, cost: 5 } }));
  assert.throws(() => bill.saveCfg({ ultra: { on: true, price: 6, cost: 7 } }), /ниже себестоимости/);
});

test('сохранённый конфиг уже убыточен (историческая причина): сохранение без экономики отказывает и объясняет нарушение', (t) => {
  const { bill, store } = app(t);
  store.kv.set('plans', { ...bill.cfg(), msgCost: 0.15 });
  assert.throws(() => bill.saveCfg({ plans: [{ id: 'pro', name: 'Про' }] }), /Пакет 10000 сообщений за 1390 ₽ дешевле себестоимости.*1500 ₽/);
  assert.notEqual(bill.cfg().plans.find((p) => p.id === 'pro').name, 'Про', 'имя тарифа не сохранилось');
  assert.doesNotThrow(() => bill.saveCfg({ msgCost: 0.13 }), 'исправление экономики сохраняется');
  assert.doesNotThrow(() => bill.saveCfg({ plans: [{ id: 'pro', name: 'Про' }] }));
  store.kv.set('plans', { ...bill.cfg(), ultra: { ...bill.ultraCfg(), price: 1, cost: 5 } });
  assert.throws(() => bill.saveCfg({ burst: 7 }), /Цена кредита 1 ₽ ниже себестоимости 5 ₽/);
});
