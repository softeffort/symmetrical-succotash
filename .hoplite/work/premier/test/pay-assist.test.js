'use strict';
// Помощь с оплатой и выручкой: сбросы на Pro (свой баланс), лимит Free через API, продающий текст при исчерпании лимита,
// пробный период, непрошедшие способы оплаты, воронка по шлюзам, оповещение о сбойном шлюзе, фоновая сверка «Ожидает»,
// ссылки /chat?buy=… (и после входа), /api/pay/check с данными платежа, воронка в панели.
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const { copyApp, seed, startServer, rm } = require('./helpers');

const DAY = 864e5, ORIGIN = 'https://eide.pro';
const ENV = ['PLATEGA_URL', 'PLATEGA_MERCHANT_ID', 'PLATEGA_SECRET', 'FIRST_DISCOUNT', 'TRIAL_OFFER', 'REF_MODE'];
const MODEL = { id: 'm1', name: 'Model One', plans: ['free', 'pro', 'max'], weight: 1 };

/* ---------- биллинг в процессе теста; Platega — заглушка: создаёт счета и отдаёт статус транзакции из st ---------- */
async function billingApp(t) {
  for (const k of ENV) delete process.env[k];
  const sent = [], st = {}, gets = [];
  const mock = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      const m = req.method === 'GET' && req.url.match(/\/transaction\/([^/?]+)/);
      if (m) { const tx = decodeURIComponent(m[1]); gets.push(tx); if (st[tx] === 'ERR') { res.statusCode = 502; return res.end('{"message":"down"}'); } return res.end(JSON.stringify({ status: st[tx] || 'PENDING' })); }
      let j = {}; try { j = JSON.parse(b); } catch {} sent.push(j); res.end(JSON.stringify({ transactionId: 'tx-' + sent.length, redirect: 'https://pay.example/' + sent.length }));
    });
  });
  await new Promise((ok) => mock.listen(0, '127.0.0.1', ok));
  process.env.PLATEGA_URL = 'http://127.0.0.1:' + mock.address().port;
  const dir = copyApp();
  const bill = require(path.join(dir, 'billing.js')), store = require(path.join(dir, 'db.js'));
  const alerts = [];
  bill.init({ loadSettings: () => ({ platega: { merchant: 'test-merchant', secret: 'test-secret' } }), saveSettings() {}, alert: (x) => alerts.push(x) });
  t.after(async () => { try { bill.flush(); } catch {} await new Promise((ok) => mock.close(ok)); store.db.close(); rm(dir); for (const k of ENV) delete process.env[k]; });
  let n = 0;
  const mk = (o = {}) => { n++; const id = crypto.randomBytes(6).toString('hex'); store.users.put({ id, login: 'user' + n + '_' + id.slice(0, 4), email: `user${n}.${id}@example.com`, created: new Date().toISOString(), ...o, id }); return store.users.get(id); };
  const on = (plan, o = {}) => mk({ plan, until: Date.now() + 20 * DAY, ...o });
  const get = (u) => store.users.get(u.id);
  const pay = async (u, plan = 'reset', opts = {}, method = 'card') => store.payments.get((await bill.create(get(u), plan, '', ORIGIN, '', method, opts)).order);
  const confirm = (p) => bill.apply(store.payments.get(p.id), 'CONFIRMED');
  let k = 0;
  const put = (o) => store.payments.put({ id: 'p' + (++k) + '_' + crypto.randomBytes(3).toString('hex'), tx: 't' + k, plan: 'pro', days: 30, amount: 390, status: 'CANCELED', provider: 'platega', method: 'card', created: Date.now() - 3600e3, ...o });
  return { bill, store, mk, on, get, pay, confirm, put, alerts, st, gets, sent };
}

test('сбросы на Pro: свой баланс; купленные на Pro не работают на Max, купленные на Max работают и на Pro; возврат и панель — по тарифу', async (t) => {
  const { bill, on, get, pay, confirm, store } = await billingApp(t);
  const u = on('pro');
  bill.add(u.id, 'm', 10);
  let p = await pay(u, 'reset', { qty: 3, now: true }); confirm(p);
  assert.equal(p.amount, 338); assert.equal(p.tier, 'pro');
  assert.equal(get(u).resetsPro, 2, 'один сразу, два — на баланс Pro'); assert.equal(get(u).resets, undefined);
  assert.equal(bill.used(u.id).m, 0);
  let i = bill.resetInfo(get(u));
  assert.equal(i.n, 2); assert.equal(i.pro, 2); assert.equal(i.max, 0); assert.equal(i.tier, 'pro'); assert.equal(i.price, 125);
  assert.deepEqual(bill.resetHistory(u.id).map((x) => [x.kind, x.tier]), [['use', 'pro'], ['buy', 'pro']]);

  // перешёл на Max — сбросы с Pro остались, но обнулять ими лимит Max нельзя
  store.users.update(u.id, (x) => { x.plan = 'max'; });
  bill.add(u.id, 'm', 5);
  let r = bill.useReset(u.id);
  assert.equal(r.status, 403); assert.equal(r.code, 'tier'); assert.match(r.error, /куплены на тарифе Pro и работают только на нём/);
  i = bill.resetInfo(get(u)); assert.equal(i.n, 0); assert.equal(i.pro, 2); assert.equal(i.price, 366);
  bill.adjustResets(u.id, 1, 'owner', 'подарок'); // по умолчанию — для Max
  assert.equal(bill.useReset(u.id).ok, true); assert.equal(get(u).resets, undefined); assert.equal(get(u).resetsPro, 2);

  // снова на Pro: сначала тратятся купленные на Pro, потом — на Max
  bill.saveCfg({ reset: { dayMax: 0 } }); // без потолка в сутки
  store.users.update(u.id, (x) => { x.plan = 'pro'; x.resets = 1; });
  for (const [left, pro, max] of [[2, 1, 1], [1, 0, 1], [0, 0, 0]]) {
    bill.add(u.id, 'm', 3); r = bill.useReset(u.id);
    assert.equal(r.ok, true); assert.equal(r.left, left); assert.equal(bill.resetInfo(get(u)).pro, pro); assert.equal(bill.resetInfo(get(u)).max, max);
  }

  // возврат пакета, купленного на Pro, забирает из баланса Pro
  const v = on('pro');
  p = await pay(v, 'reset', { qty: 3, now: false }); confirm(p);
  bill.adjustResets(v.id, 2, 'owner', '', 'max');
  assert.equal(get(v).resetsPro, 3); assert.equal(get(v).resets, 2);
  bill.apply(store.payments.get(p.id), 'CHARGEBACKED');
  assert.equal(get(v).resetsPro, undefined); assert.equal(get(v).resets, 2, 'сбросы для Max не тронуты');
  assert.equal(bill.adjustResets(v.id, 4, 'owner', '', 'pro'), 6, 'возвращает весь баланс');
  assert.equal(get(v).resetsPro, 4);
  assert.throws(() => bill.adjustResets(v.id, -5, 'owner', '', 'pro'), /столько не списать/);
});

test('Free через API: отдельный потолок запросов в сутки; возврат при ошибке; продление из панели и чат — без него; настройка', async (t) => {
  const { bill, mk, get, store } = await billingApp(t);
  assert.equal(bill.cfg().apiFree, 20);
  bill.saveCfg({ apiFree: '5' });
  const u = mk();
  for (let i = 0; i < 5; i++) { const ch = bill.charge(get(u), MODEL, { api: true, burst: false }); assert.equal(ch.ok, true); assert.equal(ch.api, true); }
  let ch = bill.charge(get(u), MODEL, { api: true, burst: false });
  assert.equal(ch.code, 'api'); assert.equal(ch.limit, 5); assert.equal(ch.error, 'Лимит Free через API исчерпан: 5 запросов в сутки');
  assert.equal(bill.used(u.id).m, 5); assert.equal(bill.used(u.id).a, 5);
  assert.equal(bill.charge(get(u), MODEL, { burst: false }).ok, true, 'в чате — общий лимит сообщений');
  assert.equal(bill.summary(get(u)).apiFree, 5);

  // ответа не было — запрос возвращается
  bill.saveCfg({ apiFree: 6 }); ch = bill.charge(get(u), MODEL, { api: true, burst: false }); assert.equal(ch.ok, true);
  bill.refund(get(u), ch); assert.equal(bill.used(u.id).a, 5);
  assert.equal(bill.charge(get(u), MODEL, { api: true, burst: false }).ok, true);

  // администратор временно поднял лимит — отдельного потолка API нет; на Pro его тоже нет
  store.users.update(u.id, (x) => { x.msgExt = { limit: 100, until: Date.now() + DAY }; });
  assert.equal(bill.charge(get(u), MODEL, { api: true, burst: false }).ok, true); assert.equal(bill.summary(get(u)).apiFree, null);
  const pro = mk({ plan: 'pro', until: Date.now() + DAY });
  for (let i = 0; i < 8; i++) assert.equal(bill.charge(get(pro), MODEL, { api: true, burst: false }).ok, true);
  assert.equal(bill.used(pro.id).a || 0, 0);

  // пусто — без отдельного потолка; неверное значение — прежнее
  bill.saveCfg({ apiFree: 'abc' }); assert.equal(bill.cfg().apiFree, 6);
  bill.saveCfg({ apiFree: '' }); assert.equal(bill.cfg().apiFree, null);
  const w = mk();
  for (let i = 0; i < 20; i++) assert.equal(bill.charge(get(w), MODEL, { api: true, burst: false }).ok, true);
  assert.notEqual(bill.charge(get(w), MODEL, { api: true, burst: false }).code, 'api');
});

test('продающий текст при исчерпании лимита: пробный, скидка первой покупки, сбросы со ссылкой на пакет, следующий тариф', async (t) => {
  const { bill, mk, on } = await billingApp(t);
  let s = bill.upsell(mk(), ORIGIN, [MODEL]);
  assert.equal(s.url, ORIGIN + '/chat?buy=trial'); assert.match(s.ru, /^Pro на 3 дня за 99 ₽: 300 сообщений в день — https:\/\/eide\.pro\/chat\?buy=trial$/);
  assert.match(s.en, /^Try Pro for 3 days for 99 ₽ \(300 messages a day\): /);

  s = bill.upsell(mk({ trialUsed: Date.now() }), ORIGIN);
  assert.equal(s.url, ORIGIN + '/chat?buy=pro'); assert.match(s.ru, /Pro — 273 ₽ вместо 390 ₽ \(−30% на первую покупку\) за 30 дней/);

  s = bill.upsell(on('pro'), ORIGIN, [{ name: 'Big', plans: ['max'] }]);
  assert.equal(s.url, ORIGIN + '/chat?buy=reset&qty=3');
  assert.equal(s.ru, `Сбросить лимит сейчас — 125 ₽, 3 сброса — 338 ₽ (−10%): ${ORIGIN}/chat?buy=reset&qty=3. Или Max: без дневного лимита сообщений, модели Big — ${ORIGIN}/chat?buy=max`);
  assert.match(s.en, /^Reset the limit now — 125 ₽, 3 resets — 338 ₽ \(−10%\): .*\. Or Max: no daily message limit, models Big — /);

  s = bill.upsell(on('pro', { resets: 2 }), ORIGIN);
  assert.equal(s.url, ORIGIN + '/chat?buy=reset'); assert.match(s.ru, /^На балансе 2 сброса лимита — потратить один: /);

  s = bill.upsell(on('max'), ORIGIN);
  assert.equal(s.ru, `Сбросить лимит сейчас — 366 ₽, 3 сброса — 988 ₽ (−10%): ${ORIGIN}/chat?buy=reset&qty=3`, 'выше Max тарифа нет');
  bill.saveCfg({ reset: { pricePro: 0 } });
  s = bill.upsell(on('pro'), ORIGIN);
  assert.equal(s.url, ORIGIN + '/chat?buy=max', 'на Pro без сбросов — только переход на Max');
});

test('пробный период: идёт, закончился, уже платил — нет; в /api/billing — trialEnd', async (t) => {
  const { bill, mk, on, put, get } = await billingApp(t);
  const a = on('pro', { trial: true, until: Date.now() + 5 * 3600e3 });
  assert.deepEqual(bill.trialState(get(a)), { state: 'on', until: get(a).until, plan: 'pro', name: 'Pro' });
  assert.deepEqual(bill.summary(get(a)).trialEnd, bill.trialState(get(a)));
  const b = mk({ plan: 'pro', until: Date.now() - 3600e3, trialUsed: Date.now() - 4 * DAY });
  assert.equal(bill.trialState(get(b)).state, 'ended');
  const c = on('pro', { trialUsed: Date.now() - DAY });
  put({ uid: c.id, status: 'CONFIRMED', offer: 'trial', amount: 99 });
  assert.equal(bill.trialState(get(c)).state, 'on', 'оплаченный пробный за 99 ₽ — ещё пробный');
  put({ uid: c.id, status: 'CONFIRMED', plan: 'pro' });
  assert.equal(bill.trialState(get(c)), null, 'заплатил за полный тариф');
  assert.equal(bill.trialState(on('max')), null); assert.equal(bill.trialState(mk()), null);
});

test('оплата: метод в счёте, непрошедшие способы за сутки, воронка по шлюзам и людям, оповещение о сбойном шлюзе', async (t) => {
  const { bill, mk, pay, put, alerts, store } = await billingApp(t);
  const u = mk();
  const p = await pay(u, 'pro', {}, 'card');
  assert.equal(p.method, 'card'); assert.equal(p.provider || 'platega', 'platega');

  put({ uid: u.id, method: 'cispay', provider: 'cispay' }); put({ uid: u.id, method: 'card', created: Date.now() - 2 * DAY });
  assert.deepEqual(bill.failedMethods(u.id), ['cispay'], 'отмена позже суток назад не считается');
  put({ uid: u.id, method: 'crypto', provider: 'crypto', status: 'CANCELED' }); put({ uid: u.id, method: 'crypto', provider: 'crypto', status: 'CONFIRMED', created: Date.now() - 1000 });
  assert.deepEqual(bill.failedMethods(u.id), ['cispay'], 'после отмены оплатил тем же способом — способ рабочий');
  assert.deepEqual(bill.summary(store.users.get(u.id)).payFailed, ['cispay']);

  // воронка: v не смог в cISPay и оплатил через Platega («спасён»), w дважды не смог, x оплатил сразу
  const v = mk(), w = mk({ login: 'stuckman' }), x = mk();
  put({ uid: v.id, provider: 'cispay', method: 'cispay' }); put({ uid: v.id, status: 'CONFIRMED', created: Date.now() - 600e3 });
  put({ uid: w.id, provider: 'cispay', method: 'cispay', login: 'stuckman' }); put({ uid: w.id, provider: 'cispay', method: 'cispay', created: Date.now() - 1800e3, plan: 'max', amount: 990, login: 'stuckman' });
  put({ uid: x.id, provider: 'coinso', status: 'CONFIRMED', amount: 990, plan: 'max' });
  put({ uid: x.id, status: 'CONFIRMED', created: Date.now() - 40 * DAY }); // вне периода
  const f = bill.payFunnel(7);
  const g = Object.fromEntries(f.gateways.map((y) => [y.id, y]));
  assert.equal(f.days, 7);
  assert.deepEqual([g.cispay.created, g.cispay.paid, g.cispay.canceled, g.cispay.conv, g.cispay.users, g.cispay.payers], [4, 0, 4, 0, 3, 0]);
  assert.deepEqual([g.platega.created, g.platega.paid, g.platega.pending, g.platega.canceled, g.platega.sum], [3, 1, 1, 1, 390]);
  assert.equal(g.coinso.sum, 990); assert.equal(g.coinso.conv, 100); assert.equal(g.crypto.paid, 1);
  assert.equal(f.people.tried, 4); assert.equal(f.people.paid, 3); assert.equal(f.people.lost, 1); assert.equal(f.people.rescued, 2, 'v и сам u: не прошло картой и в cISPay — оплатил криптой');
  assert.equal(f.stuck.length, 1); assert.equal(f.stuck[0].uid, w.id); assert.equal(f.stuck[0].tries, 2); assert.equal(f.stuck[0].failed, 2); assert.deepEqual(f.stuck[0].gateways, ['cISPay']);
  assert.equal(bill.payFunnel(60).gateways.find((y) => y.id === 'platega').created, 4);

  // 8 закрытых счетов подряд без оплаты в шлюзе — одно оповещение, повтор не раньше чем через 6 часов
  assert.deepEqual(bill.gatewayWatch(), []); assert.equal(alerts.length, 0);
  for (let i = 0; i < 4; i++) put({ uid: mk().id, provider: 'cispay', method: 'cispay', created: Date.now() - 60e3 * (10 - i) });
  assert.deepEqual(bill.gatewayWatch(), ['cispay']);
  assert.equal(alerts.length, 1); assert.match(alerts[0], /cISPay — 8 последних счетов подряд не оплачены/);
  bill.gatewayWatch(); assert.equal(alerts.length, 1, 'не спамим');
  put({ uid: mk().id, provider: 'cispay', method: 'cispay', status: 'CONFIRMED', created: Date.now() - 1000 });
  assert.deepEqual(bill.gatewayWatch(), [], 'оплата прошла — серия прервана');
});

test('фоновая сверка «Ожидает»: подтверждает потерянную оплату, реже проверяет старые, Robokassa не трогает, ошибки шлюза не роняют', async (t) => {
  const { bill, mk, get, pay, put, st, gets } = await billingApp(t);
  const u = mk(), now = Date.now();
  const a = await pay(u, 'pro'), b = await pay(mk(), 'max');
  put({ uid: u.id, status: 'PENDING', provider: 'robokassa', method: 'robokassa', tx: 'rk1' });
  put({ uid: u.id, status: 'PENDING', tx: 'old1', created: now - 3 * DAY });
  st[a.tx] = 'CONFIRMED';
  let r = await bill.recheckPending(now);
  assert.deepEqual(r, { checked: 2, changed: 1 });
  assert.equal(bill.findPay(a.id).status, 'CONFIRMED'); assert.equal(get(u).plan, 'pro', 'тариф включился без вебхука и без открытой вкладки');
  assert.ok(!gets.includes('rk1') && !gets.includes('old1'));
  r = await bill.recheckPending(now + 30e3); assert.equal(r.checked, 0, 'свежий счёт — не чаще раза в минуту');
  st[b.tx] = 'ERR';
  r = await bill.recheckPending(now + 61e3); assert.deepEqual(r, { checked: 1, changed: 0 }, 'ошибка шлюза — без исключения');
  st[b.tx] = 'CANCELED';
  r = await bill.recheckPending(now + 122e3); assert.deepEqual(r, { checked: 1, changed: 1 });
  assert.equal(bill.findPay(b.id).status, 'CANCELED');
  assert.deepEqual(await bill.recheckPending(now + 300e3), { checked: 0, changed: 0 });
});

test('HTTP: ссылка «купить» переживает вход, /api/pay/check отдаёт что это был за платёж, воронка в панели', { timeout: 60000 }, async (t) => {
  const P = 'a1a1a1a1a1a1';
  const dir = copyApp();
  seed(dir, { users: [{ id: P, login: 'prouser', email: 'pro@example.com', created: new Date().toISOString(), plan: 'pro', until: Date.now() + 10 * 864e5 }], sessions: { tokP: P } });
  const mock = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(req.method === 'GET' ? '{"status":"PENDING"}' : JSON.stringify({ transactionId: 'tx-h1', redirect: 'https://pay.example/h1' })); }); });
  await new Promise((ok) => mock.listen(0, '127.0.0.1', ok));
  const s = await startServer(dir, { PLATEGA_MERCHANT_ID: 'test-merchant', PLATEGA_SECRET: 'test-secret', PLATEGA_URL: 'http://127.0.0.1:' + mock.address().port });
  t.after(async () => { await s.stop(); await new Promise((ok) => mock.close(ok)); rm(dir); });

  let r = await s.req('GET', '/chat?buy=reset&qty=3');
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/login');
  const ck = r.headers.get('set-cookie'); assert.match(ck, /premier_buy=buy%3Dreset%26qty%3D3/); assert.match(ck, /HttpOnly/);
  r = await s.req('GET', '/chat?buy=<script>'); assert.equal(r.headers.get('set-cookie'), null, 'мусор не запоминаем');
  r = await s.req('GET', '/chat', { headers: { Cookie: 'premier_session=tokP; premier_buy=buy%3Dreset%26qty%3D3' } });
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/chat?buy=reset&qty=3'); assert.match(r.headers.get('set-cookie'), /premier_buy=;.*Max-Age=0/);
  r = await s.req('GET', '/chat?buy=reset&qty=3', { token: 'tokP' }); assert.equal(r.status, 200);
  r = await s.req('GET', '/chat?pay=success&order=x', { headers: { Cookie: 'premier_session=tokP; premier_buy=buy%3Dmax' } }); assert.equal(r.status, 200, 'возврат с оплаты важнее');

  r = await s.req('POST', '/api/pay/create', { token: 'tokP', body: { plan: 'reset', method: 'card', qty: 3, now: false } });
  assert.equal(r.status, 200); const order = r.json.order;
  r = await s.req('GET', '/api/pay/check?order=' + order, { token: 'tokP' });
  assert.equal(r.json.status, 'PENDING'); assert.equal(r.json.plan, 'reset'); assert.equal(r.json.method, 'card'); assert.equal(r.json.amount, 338);
  assert.equal(r.json.qty, 3); assert.equal(r.json.now, false); assert.equal(r.json.tier, 'pro'); assert.equal(r.json.billing.resets.price, 125);
  assert.equal((await s.req('GET', '/api/pay/check?order=nope', { token: 'tokP' })).status, 404);

  const login = await s.req('POST', '/api/admin/login', { body: { password: 'Test-Admin-Pass-2026' } });
  const owner = (method, url, body) => s.req(method, url, { body, headers: { Authorization: 'Bearer ' + login.json.token } });
  r = await owner('GET', '/api/admin/payments/funnel?days=7');
  assert.equal(r.status, 200); assert.equal(r.json.days, 7); assert.deepEqual(r.json.alarm, []);
  assert.equal(r.json.gateways[0].id, 'platega'); assert.equal(r.json.gateways[0].pending, 1); assert.equal(r.json.people.tried, 1);
  r = await owner('POST', `/api/admin/users/${P}/resets`, { delta: 2, tier: 'pro', note: 'тест' });
  assert.equal(r.status, 200); assert.equal(r.json.resets.pro, 2); assert.equal(r.json.log[0].tier, 'pro');
  assert.equal((await s.req('GET', '/api/admin/payments/funnel')).status, 401);
});
