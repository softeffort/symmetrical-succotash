// Ultra-модели за кредиты (только тариф Ultra): списание с кредитов тарифа и купленных, доплата за длинный контекст, возврат, покупка,
// ежедневные кредиты тарифа без накопления, возврат платежа, защита от минуса. Запуск: node --test tests/ultra.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { copyApp, rm } = require('../test/helpers');

const ULTRA = { id: 'claude', name: 'Claude', ultra: true, credits: 3, plans: ['max'] };
const DAY = 864e5;

async function app(t) {
  const dir = copyApp();
  const bill = require(path.join(dir, 'billing.js')), store = require(path.join(dir, 'db.js'));
  bill.init({ loadSettings: () => ({ platega: { merchant: 'test-merchant', secret: 'test-secret' } }), saveSettings() {} });
  t.after(() => { try { bill.flush(); } catch {} store.db.close(); rm(dir); });
  bill.saveCfg({ plans: [{ id: 'ultra', credits: 50 }], ultra: { on: true, price: 13.5, ctxFree: 20000, ctxStep: 10000, ctxCredits: 2, maxBuy: 10000, cost: 5 } });
  let n = 0;
  const mk = (o = {}) => { n++; const id = 'u' + n + Math.random().toString(16).slice(2, 6); store.users.put({ id, login: 'user' + n + '_' + id, email: id + '@example.com', created: new Date().toISOString(), ...o, id }); return store.users.get(id); };
  const get = (u) => store.users.get(u.id);
  const pay = (u, o) => { const id = 'p' + Math.random().toString(16).slice(2, 10); store.payments.put({ id, uid: u.id, status: 'PENDING', created: Date.now(), ...o }); return bill.apply(store.payments.get(id), 'CONFIRMED'); };
  return { bill, store, mk, get, pay };
}
const max = () => ({ plan: 'ultra', until: Date.now() + 10 * DAY }); // тариф с доступом к Ultra-моделям

test('Ultra-модели только на тарифе Ultra (Pro и Max — нет); списывает кредиты (сначала кредиты тарифа), дневной лимит не трогает; возврат при ошибке', async (t) => {
  const { bill, mk, get } = await app(t);
  const pro = mk({ plan: 'pro', until: Date.now() + DAY, ultra: { bal: 100 } });
  assert.match(bill.charge(get(pro), ULTRA, { burst: false }).error, /тарифе Ultra/);
  const mx = mk({ plan: 'max', until: Date.now() + DAY, ultra: { bal: 100 } });
  assert.match(bill.charge(get(mx), ULTRA, { burst: false }).error, /тарифе Ultra/, 'на Max Claude больше нет, даже с купленными кредитами');
  assert.equal(get(mx).ultra.bal, 100, 'купленные кредиты на Max не тронуты');
  const u = mk({ ...max(), ultra: { bal: 10 } });
  assert.equal(bill.ultraInfo(get(u)).bonus, 50, 'кредиты тарифа начислены');
  const ch = bill.charge(get(u), ULTRA, { burst: false, ctxTokens: 1000 });
  assert.equal(ch.ok, true); assert.equal(ch.credits, 3);
  assert.equal(get(u).ultra.bonus, 47); assert.equal(get(u).ultra.bal, 10);
  assert.equal(bill.used(u.id).m, 0, 'сообщения не списаны');
  bill.refund(get(u), ch);
  assert.equal(get(u).ultra.bonus, 50);
});

test('доплата за длинный контекст и нехватка кредитов — code: credits', async (t) => {
  const { bill, mk, get } = await app(t);
  assert.deepEqual(bill.ultraCost(ULTRA, 45000), { base: 3, extra: 6, total: 9 });
  assert.deepEqual(bill.ultraCost(ULTRA, 15000), { base: 3, extra: 0, total: 3 });
  const u = mk(max());
  const r = bill.charge(get(u), ULTRA, { burst: false, ctxTokens: 2e6 });
  assert.equal(r.code, 'credits'); assert.equal(r.have, 50); assert.ok(r.need > 50);
  assert.ok(bill.estimateTokens([{ role: 'user', content: 'x'.repeat(3500) }]) >= 1000);
});

test('раунды инструментов доплачиваются; при обрыве доплаты возвращаются', async (t) => {
  const { bill, mk, get } = await app(t);
  const u = mk(max());
  const ch = bill.charge(get(u), ULTRA, { burst: false });
  assert.equal(bill.ultraMore(get(u), ch), true);
  assert.equal(get(u).ultra.bonus, 44);
  bill.refundUltraRounds(get(u), ch);
  assert.equal(get(u).ultra.bonus, 47);
});

test('подарок выдаётся раз в сутки и не копится; купленные не трогает', async (t) => {
  const { bill, store, mk, get } = await app(t);
  const u = mk({ ...max(), ultra: { bal: 7 } });
  bill.ultraGrant(u.id); bill.charge(get(u), ULTRA, { burst: false });
  assert.equal(bill.ultraGrant(u.id).bonus, 47, 'второй раз в тех же сутках не начисляется');
  assert.ok(get(u).ultra.giftDay, 'сутки запомнены');
  store.users.update(u.id, (y) => { y.ultra.giftDay = '2000-01-01'; });
  assert.equal(bill.ultraGrant(u.id).bonus, 50, 'новые сутки — снова 50, а не 97');
  assert.equal(get(u).ultra.bal, 7, 'купленные не тронуты');
});

test('кредиты тарифа только на Ultra; на Pro и Max не начисляются; сгорают в конце суток', async (t) => {
  const { bill, store, mk, get } = await app(t);
  const pro = mk({ plan: 'pro', until: Date.now() + DAY });
  assert.equal(bill.ultraGrant(pro.id).bonus, 0, 'Pro — без кредитов');
  const mx = mk({ plan: 'max', until: Date.now() + DAY });
  assert.equal(bill.ultraGrant(mx.id).bonus, 0, 'Max — без кредитов');
  const u = mk(max());
  assert.equal(bill.ultraGrant(u.id).bonus, 50);
  const until = get(u).ultra.bonusUntil;
  assert.ok(until > Date.now() && until - Date.now() <= DAY, 'сгорает до конца текущих суток');
  store.users.update(u.id, (y) => { y.plan = 'free'; y.until = 0; y.ultra.bonusUntil = Date.now() - 1; });
  assert.equal(bill.ultraGrant(u.id).bonus, 0, 'просроченный подарок сгорает');
});

test('покупка: от 1 до 10 000, без промокодов; оплата зачисляет, возврат платежа забирает', async (t) => {
  const { bill, mk, get, pay } = await app(t);
  const u = mk(max());
  for (const bad of [0, 10001, 2.5, 'много']) await assert.rejects(bill.create(get(u), 'credits', '', 'http://x', '', 'card', { qty: bad }), /от 1 до 10000/);
  await assert.rejects(bill.create(get(u), 'credits', 'PROMO', 'http://x', '', 'card', { qty: 10 }), /Промокоды/);
  const it = pay(u, { plan: 'credits', qty: 250, amount: 3375 });
  assert.equal(get(u).ultra.bal, 250);
  bill.apply(it, 'CHARGEBACKED');
  assert.equal(get(u).ultra.bal, 0);
  assert.deepEqual(bill.offers(get(u)).first, bill.offers(mk()).first, 'кредиты не тратят скидку первой покупки');
});

test('панель: цена ниже себестоимости не сохраняется; ручное начисление и статистика', async (t) => {
  const { bill, mk } = await app(t);
  assert.throws(() => bill.saveCfg({ ultra: { on: true, price: 4, cost: 5 } }), /ниже себестоимости/);
  const u = mk();
  assert.equal(bill.ultraAdjust(u.id, 30).ultra.bal, 30);
  assert.equal(bill.ultraAdjust(u.id, -100).ultra.bal, 0, 'не уходит в минус');
  assert.ok(bill.ultraStats().gifted >= 0);
});

test('клиент: 21-ultra.js подключён на RU и EN, без синтаксических ошибок; стили — только переменные темы; ключи моделей не уходят в браузер', () => {
  const root = path.resolve(__dirname, '..'), read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  for (const p of ['public/chat.html', 'public/en/chat.html']) { const html = read(p); assert.ok(html.indexOf('/js/21-ultra.js') > html.indexOf('/js/20-chat-ui.js')); assert.match(html, /\/ultra\.css\?v=\d+/); }
  assert.doesNotThrow(() => new vm.Script(read('public/js/21-ultra.js')));
  assert.doesNotMatch(read('public/ultra.css'), /#[0-9a-f]{3,6}\b/i);
  const line = read('server.js').split('\n').find((l) => /const publicModel = /.test(l));
  assert.match(line, /ultra/); assert.doesNotMatch(line, /apiKey|baseUrl/);
});

test('клиент: окно «Ultra-кредиты» — отдельный диалог, доступность, телефон, одинаковые версии RU и EN', () => {
  const root = path.resolve(__dirname, '..'), read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const ver = (html, re) => (html.match(re) || [])[1];
  const ru = read('public/chat.html'), en = read('public/en/chat.html');
  for (const re of [/\/js\/21-ultra\.js\?v=(\d+)/, /\/ultra\.css\?v=(\d+)/]) { assert.ok(ver(ru, re)); assert.equal(ver(ru, re), ver(en, re), 'версии RU и EN совпадают'); }
  const js = read('public/js/21-ultra.js');
  for (const s of ["id = 'ulWin'", 'role="dialog"', 'aria-modal="true"', 'role="radiogroup"', 'role="radio"', "'Escape'", "'Tab'", 'window.openUltra =', "lmBuy('credits'", 'aria-live', "querySelectorAll('#dbody #payMsg')"]) assert.ok(js.includes(s), 'есть ' + s);
  const css = read('public/ultra.css');
  for (const s of ['@media (max-width:700px)', 'prefers-reduced-motion', 'env(safe-area-inset-bottom)', '.ulw-foot', '.ulw-pack[aria-checked=true]']) assert.ok(css.includes(s), 'есть ' + s);
  for (const old of ['.ul-bal', '.ul-calc', '.ul-range']) assert.ok(!css.includes(old), 'старые стили убраны: ' + old);
});

test('клиент: расчёты окна кредитов — пакеты, сумма, шаг −/+, подбор при нехватке', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'public/js/21-ultra.js'), 'utf8');
  const noop = () => {};
  const win = {};
  const ctx = { window: win, document: { documentElement: { lang: 'ru', classList: { add: noop, remove: noop } }, getElementById: () => null, addEventListener: noop, removeEventListener: noop, querySelectorAll: () => [] }, requestAnimationFrame: noop, setTimeout, clearInterval, setInterval };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  const c = win.openUltra.calc;
  assert.equal(typeof win.openUltra, 'function'); assert.ok(c);
  assert.deepEqual([...c.packsFor(10000)], [100, 500, 1000, 5000, 10000]);
  assert.deepEqual([...c.packsFor(5000)], [100, 500, 1000, 5000]);
  assert.deepEqual([...c.packsFor(300)], [100, 300]);
  assert.equal(c.priceOf(3, { price: 15 }), 45);
  assert.equal(c.priceOf(500, { price: 13.5 }), 6750);
  assert.equal(c.priceOf(1, { price: 0.2 }), 1, 'не меньше 1 ₽');
  assert.equal(c.priceOf(3, { price: 0.1 }), 1);
  assert.equal(c.clamp(0, 100), 1); assert.equal(c.clamp(5000, 100), 100); assert.equal(c.clamp('abc', 100), 1);
  assert.equal(c.bump(500, 1, 10000), 600); assert.equal(c.bump(500, -1, 10000), 400);
  assert.equal(c.bump(95, 1, 10000), 100); assert.equal(c.bump(1000, 1, 10000), 2000); assert.equal(c.bump(1000, -1, 10000), 900);
  assert.equal(c.bump(5, -1, 10000), 1, 'не меньше 1'); assert.equal(c.bump(9900, 1, 10000), 10000, 'не больше максимума');
  assert.deepEqual({ ...c.pickFor(40, 10000) }, { qty: 100, own: false });
  assert.deepEqual({ ...c.pickFor(700, 10000) }, { qty: 1000, own: false });
  assert.deepEqual({ ...c.pickFor(20000, 10000) }, { qty: 10000, own: false });
  assert.deepEqual({ ...c.pickFor(250, 200) }, { qty: 200, own: false });
  assert.equal(c.pickFor(0, 1000), null);
});
