'use strict';
// Рост: пробный период за деньги (один раз), скидка первой покупки и промокоды (не суммируются), приглашения
// (бонус обоим только после первой оплаты, потолок, откат при возврате), лимиты Free и их сброс в полночь по Москве,
// публичные ссылки на чат (чтение без входа, ничего личного, отзыв, rate-limit), SEO (meta/OG, robots.txt, sitemap.xml).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const { copyApp, seed, startServer, rm } = require('./helpers');

const DAY = 864e5, ORIGIN = 'https://eide.pro';
const ENV = ['TRIAL_OFFER', 'TRIAL_PRICE', 'TRIAL_DAYS', 'TRIAL_PLAN', 'FIRST_DISCOUNT', 'FIRST_DISCOUNT_PLANS', 'FIRST_DISCOUNT_AFTER_TRIAL', 'REF_MODE', 'REF_BONUS_DAYS',
  'REF_BONUS_PLAN', 'REF_MAX', 'REF_TRIAL_COUNTS', 'REF_BIND_HOURS', 'REF_PAY_DAYS', 'REF_SIGNUP_MSGS', 'FREE_WARN_PCT', 'PLATEGA_URL', 'PLATEGA_MERCHANT_ID', 'PLATEGA_SECRET'];
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 5 * 60000, `${msg || 'время'}: ${new Date(a).toISOString()} ≠ ${new Date(b).toISOString()}`);
const mskDay = (t = Date.now()) => new Date(t + 3 * 3600e3).toISOString().slice(0, 10);

/* ---------- биллинг в процессе теста: Platega — локальная заглушка, сумма счёта видна в запросе ---------- */
async function billingApp(t) {
  for (const k of ENV) delete process.env[k];
  const sent = [];
  const mock = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => { let j = {}; try { j = JSON.parse(b); } catch {} sent.push(j); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ transactionId: 'tx-' + sent.length, redirect: 'https://pay.example/' + sent.length })); });
  });
  await new Promise((ok) => mock.listen(0, '127.0.0.1', ok));
  process.env.PLATEGA_URL = 'http://127.0.0.1:' + mock.address().port; // читается при загрузке billing.js
  const dir = copyApp();
  const bill = require(path.join(dir, 'billing.js')), store = require(path.join(dir, 'db.js'));
  bill.init({ loadSettings: () => ({ platega: { merchant: 'test-merchant', secret: 'test-secret' } }), saveSettings() {} });
  t.after(async () => { try { bill.flush(); } catch {} await new Promise((ok) => mock.close(ok)); store.db.close(); rm(dir); for (const k of ENV) delete process.env[k]; });
  let n = 0;
  const mk = (o = {}) => { n++; const id = crypto.randomBytes(6).toString('hex'); store.users.put({ id, login: 'user' + n + '_' + id.slice(0, 4), email: `user${n}.${id}@example.com`, created: new Date().toISOString(), ...o, id }); return store.users.get(id); };
  const get = (u) => store.users.get(u.id);
  const pay = async (u, plan, promo = '', ip = '') => {
    const was = sent.length, r = await bill.create(get(u), plan, promo, ORIGIN, ip, 'card');
    assert.equal(sent.length, was + 1, 'запрос в Platega');
    // тот же счёт второй раз не создаётся (этап 1, BIZ-03): вместо создания идёт запрос статуса, сумма — из прежнего счёта
    const it = store.payments.get(r.order), last = sent.at(-1);
    return { ...it, sent: last.paymentDetails ? last.paymentDetails.amount : it.amount };
  };
  const confirm = (p) => bill.apply(store.payments.get(p.id), 'CONFIRMED');
  return { bill, store, mk, get, pay, confirm };
}

test('пробный период за 99 ₽: один раз на аккаунт и почту, без промокодов, только до первой оплаты', async (t) => {
  const { bill, store, mk, get, pay, confirm } = await billingApp(t);
  bill.savePromos([{ code: 'SALE10', kind: 'discount', percent: 10, used: 0, by: [] }]);
  const a = mk({ email: 'Anna.Test+promo@gmail.com' });
  assert.deepEqual(bill.offers(a).trial, { price: 99, days: 3, plan: 'pro', name: 'Pro' });
  assert.ok(bill.summary(a).offer.trial, 'предложение видно в /api/billing');
  await assert.rejects(bill.create(a, 'trial', 'SALE10', ORIGIN, '', 'card'), /Промокоды на пробный период не действуют/);

  const p = await pay(a, 'trial');
  assert.equal(p.sent, 99); assert.equal(p.amount, 99); assert.equal(p.plan, 'pro'); assert.equal(p.days, 3); assert.equal(p.offer, 'trial');
  const t0 = Date.now(); confirm(p);
  assert.equal(bill.planOf(get(a)).id, 'pro'); near(get(a).until, t0 + 3 * DAY, 'Pro на 3 дня');
  assert.equal(bill.offers(get(a)).trial, null);
  await assert.rejects(bill.create(get(a), 'trial', '', ORIGIN, '', 'card'), /один раз/);
  const until = get(a).until; confirm(p); bill.apply(store.payments.get(p.id), 'CONFIRMED'); // повторный вебхук — без новых дней
  assert.equal(get(a).until, until);

  // вторая регистрация на ту же почту (регистр, точки и +метка Gmail, googlemail.com) — пробного периода нет, даже после удаления первого аккаунта
  const twin = mk({ email: 'annatest@googlemail.com' });
  assert.equal(bill.offers(twin).trial, null);
  await assert.rejects(bill.create(twin, 'trial', '', ORIGIN, '', 'card'), /один раз/);
  store.users.remove(a.id);
  assert.equal(bill.offers(get(twin)).trial, null);

  // уже плативший за тариф — без пробного периода
  const paid = mk(); confirm(await pay(paid, 'pro'));
  assert.equal(bill.offers(get(paid)).trial, null);

  // цена, срок и выключение — из env
  const b = mk();
  process.env.TRIAL_PRICE = '149'; process.env.TRIAL_DAYS = '5';
  const pb = await pay(b, 'trial'); assert.equal(pb.sent, 149); assert.equal(pb.days, 5);
  process.env.TRIAL_PRICE = '-10'; assert.equal(bill.offers(b).trial.price, 1, 'цена не бывает отрицательной');
  process.env.TRIAL_OFFER = '0'; assert.equal(bill.offers(b).trial, null);
  await assert.rejects(bill.create(get(b), 'trial', '', ORIGIN, '', 'card'), /доступен один раз/);
});

test('скидка первой покупки: автоматически −30% на Pro/Max, с промокодом не суммируется — берётся выгоднее', async (t) => {
  const { bill, mk, get, pay, confirm } = await billingApp(t);
  bill.savePromos([{ code: 'SALE10', kind: 'discount', percent: 10, used: 0, by: [] }, { code: 'SALE50', kind: 'discount', percent: 50, used: 0, by: [] }, { code: 'EQ30', kind: 'discount', percent: 30, used: 0, by: [] }]);
  const c = mk();
  assert.deepEqual(bill.offers(c).first, { percent: 30, plans: ['pro', 'max'] });
  let p = await pay(c, 'pro');
  assert.equal(p.sent, 273); assert.equal(p.amount, 273); assert.equal(p.price, 390); assert.equal(p.promo, null); assert.deepEqual(p.discount, { kind: 'first', percent: 30 });
  assert.equal((await pay(c, 'max')).sent, 693);
  const p10 = await pay(c, 'pro', 'SALE10'); // 30% выгоднее 10% — промокод не применяется и не тратится
  assert.equal(p10.sent, 273); assert.equal(p10.promo, null);
  const p50 = await pay(c, 'pro', 'SALE50'); // 50% выгоднее 30%
  assert.equal(p50.sent, 195); assert.equal(p50.promo, 'SALE50'); assert.deepEqual(p50.discount, { kind: 'promo', percent: 50 });
  const peq = await pay(c, 'pro', 'EQ30'); // поровну — промокод (без суммирования: не 49%)
  assert.equal(peq.sent, 273); assert.equal(peq.promo, 'EQ30');

  confirm(p10);
  assert.equal(bill.loadPromos().find((x) => x.code === 'SALE10').used || 0, 0, 'промокод не израсходован');
  assert.equal(bill.offers(get(c)).first, null, 'после первой покупки скидки нет');
  assert.equal((await pay(c, 'pro')).sent, 390);
  assert.equal((await pay(c, 'pro', 'SALE50')).sent, 195, 'промокод по-прежнему работает');

  // сброс лимита и (по умолчанию) пробный период «первую покупку» не расходуют
  const d = mk(); const r = await pay(d, 'reset'); assert.equal(r.sent, 200); confirm(r);
  assert.ok(bill.offers(get(d)).first);
  const e = mk(); confirm(await pay(e, 'trial'));
  assert.ok(bill.offers(get(e)).first);
  assert.equal((await pay(e, 'pro')).sent, 273);
  process.env.FIRST_DISCOUNT_AFTER_TRIAL = '0'; assert.equal(bill.offers(get(e)).first, null); delete process.env.FIRST_DISCOUNT_AFTER_TRIAL;

  // процент и тарифы из env; границы
  process.env.FIRST_DISCOUNT = '50'; process.env.FIRST_DISCOUNT_PLANS = 'max';
  assert.equal((await pay(d, 'pro')).sent, 390); assert.equal((await pay(d, 'max')).sent, 495);
  process.env.FIRST_DISCOUNT = '0'; assert.equal(bill.offers(get(d)).first, null);
  process.env.FIRST_DISCOUNT = '-20'; assert.equal(bill.offers(get(d)).first, null);
  process.env.FIRST_DISCOUNT = '99'; assert.equal(bill.offers(get(d)).first.percent, 90);
  process.env.FIRST_DISCOUNT = 'много'; assert.equal(bill.offers(get(d)).first.percent, 30);
  assert.equal(bill.discounted(390, -50), 390); assert.equal(bill.discounted(390, 150), 1); assert.equal(bill.discounted(1, 30), 1); assert.equal(bill.discounted(390, 'x'), 390);
});

test('приглашения: +3 дня Pro обоим только после первой оплаты друга, потолок REF_MAX, откат при возврате', async (t) => {
  const { bill, store, mk, get, pay, confirm } = await billingApp(t);
  process.env.REF_MAX = '2';
  const A = mk(), code = bill.refCode(A);
  assert.match(code, /^[0-9A-Za-z]{10}$/); assert.notEqual(code, A.id); assert.equal(bill.refCode(A), code); assert.equal(bill.refOwner(code), A.id);
  assert.equal(bill.refInfo(A).code, code);

  const B = mk();
  const r = bill.refBind(B, code, '10.0.0.1', 'fpB');
  assert.equal(r.code, 200); assert.equal(r.days, 3); assert.equal(r.by, undefined, 'логин пригласившего не раскрывается');
  assert.equal(get(A).until, undefined, 'до оплаты пригласивший ничего не получает'); assert.equal(get(B).until, undefined, 'и приглашённый тоже');
  assert.equal(bill.refInfo(A).total, 1); assert.equal(bill.refInfo(A).rewarded, 0);

  assert.equal(bill.refBind(B, code, '10.0.0.1', 'fpB').code, 409, 'второй раз нельзя');
  assert.equal(bill.refBind(A, code, '10.0.0.2', 'fpA').code, 400, 'себя нельзя');
  assert.equal(bill.refBind(mk(), 'zzzzzzzzzz', '10.0.0.3', 'fp3').code, 404);
  assert.equal(bill.refBind(mk({ created: new Date(Date.now() - 10 * DAY).toISOString() }), code, '10.0.0.4', 'fp4').code, 409, 'только новые аккаунты');
  const P = mk(); confirm(await pay(P, 'pro'));
  assert.equal(bill.refBind(get(P), code, '10.0.0.5', 'fp5').code, 409, 'только до первой оплаты');
  assert.equal(bill.refBind(mk(), code, '10.0.0.1', 'fp6').code, 409, 'тот же IP');
  assert.equal(bill.refBind(mk(), code, '10.0.0.7', 'fpB').code, 409, 'то же устройство');

  confirm(await pay(B, 'reset')); // сброс лимита — не «первая оплата»
  assert.equal(get(A).until, undefined); assert.equal(bill.refInfo(A).paid, 0);

  const t0 = Date.now(); confirm(await pay(B, 'pro'));
  assert.equal(get(A).plan, 'pro'); near(get(A).until, t0 + 3 * DAY, 'пригласившему +3 дня');
  assert.equal(get(B).plan, 'pro'); near(get(B).until, t0 + 33 * DAY, 'другу 30 оплаченных + 3 бонусных');
  let info = bill.refInfo(A); assert.equal(info.paid, 1); assert.equal(info.rewarded, 1); assert.equal(info.left, 1);
  const a1 = get(A).until; confirm(await pay(B, 'pro'));
  assert.equal(get(A).until, a1, 'вторая оплата друга бонуса не даёт');

  // потолок REF_MAX=2: за третьего оплатившего пригласивший уже не получает, друг — получает
  const C = mk(), D = mk();
  assert.equal(bill.refBind(C, code, '10.0.1.1', 'fpC').code, 200); assert.equal(bill.refBind(D, code, '10.0.1.2', 'fpD').code, 200);
  confirm(await pay(C, 'pro')); near(get(A).until, a1 + 3 * DAY, 'второй бонус');
  const a2 = get(A).until, t1 = Date.now();
  confirm(await pay(D, 'pro'));
  assert.equal(get(A).until, a2, 'потолок');
  near(get(D).until, t1 + 33 * DAY, 'другу бонус и после потолка');
  info = bill.refInfo(A); assert.equal(info.paid, 3); assert.equal(info.rewarded, 2); assert.equal(info.left, 0); assert.equal(info.max, 2);

  // возврат платежа забирает оплаченные дни и бонусы обоих; повторная оплата бонус не возвращает
  const A2 = mk(), E = mk();
  assert.equal(bill.refBind(E, bill.refCode(A2), '10.0.2.1', 'fpE').code, 200);
  const pe = await pay(E, 'pro'); confirm(pe);
  assert.ok(get(A2).until > Date.now() + 2 * DAY);
  bill.apply(store.payments.get(pe.id), 'CHARGEBACKED');
  assert.ok(!(get(A2).until > Date.now() + 60000), 'бонус пригласившего забран');
  assert.ok(!(get(E).until > Date.now() + 60000), 'дни друга забраны');
  assert.equal(bill.refInfo(A2).rewarded, 0);
  confirm(await pay(E, 'pro'));
  assert.ok(!(get(A2).until > Date.now() + 60000), 'после возврата бонус заново не начисляется');

  // пробный период за 99 ₽ — тоже первая оплата (REF_TRIAL_COUNTS=1 по умолчанию); REF_TRIAL_COUNTS=0 — ждём полной оплаты
  const A3 = mk(), F = mk(); bill.refBind(F, bill.refCode(A3), '10.0.3.1', 'fpF');
  confirm(await pay(F, 'trial')); assert.ok(get(A3).until > Date.now() + 2 * DAY);
  process.env.REF_TRIAL_COUNTS = '0';
  const A4 = mk(), G = mk(); bill.refBind(G, bill.refCode(A4), '10.0.4.1', 'fpG');
  confirm(await pay(G, 'trial')); assert.equal(get(A4).until, undefined);
  confirm(await pay(G, 'pro')); assert.ok(get(A4).until > Date.now() + 2 * DAY);
  delete process.env.REF_TRIAL_COUNTS;

  // старые ссылки /r/<ID пользователя> продолжают работать
  const H = mk(); assert.equal(bill.refBind(H, A4.id, '10.0.5.1', 'fpH').code, 200);
  // REF_MODE=legacy — прежние правила (+50 сообщений сразу)
  process.env.REF_MODE = 'legacy';
  const I = mk(); const lr = bill.refBind(I, A4.id, '10.0.6.1', 'fpI');
  assert.equal(lr.code, 200); assert.equal(lr.bonus, 50);
});

test('лимиты Free: 20 в день, исчерпание, время сброса и сброс в полночь по Москве', async (t) => {
  const { bill, mk, get } = await billingApp(t);
  const u = mk(), model = { id: 'm', name: 'M', plans: ['free', 'pro', 'max'] }, realNow = Date.now;
  let s = bill.summary(u);
  assert.equal(s.limits.m, 20); assert.equal(s.used.m, 0); assert.equal(s.warnPct, 20);
  try {
    const T = Date.parse('2026-11-02T20:50:00Z'); // 23:50 по Москве
    Date.now = () => T;
    for (let i = 0; i < 20; i++) assert.ok(bill.charge(get(u), model).ok, 'сообщение ' + (i + 1));
    const ch = bill.charge(get(u), model);
    assert.equal(ch.code, 'limit'); assert.match(ch.error, /закончились/);
    assert.equal(bill.left(get(u), 'm'), 0);
    assert.equal(bill.resetsAt(), Date.parse('2026-11-02T21:00:00Z'), 'сброс в 00:00 по Москве');
    s = bill.summary(get(u)); assert.equal(s.used.m, 20); assert.equal(s.resetsAt, Date.parse('2026-11-02T21:00:00Z'));
    Date.now = () => T + 10 * 60000; // 00:00 по Москве — новые сутки (и антиспам «20 за 5 минут» уже не мешает)
    assert.equal(bill.used(u.id).m, 0); assert.equal(bill.left(get(u), 'm'), 20);
    assert.ok(bill.charge(get(u), model).ok);
    assert.equal(bill.resetsAt(), Date.parse('2026-11-03T21:00:00Z'));
  } finally { Date.now = realNow; }
  const rs = bill.resetsAt(); assert.ok(rs > Date.now() && rs <= Date.now() + DAY); assert.equal((rs + 3 * 3600e3) % DAY, 0);
  process.env.FREE_WARN_PCT = '150'; assert.equal(bill.summary(get(u)).warnPct, 100);
  process.env.FREE_WARN_PCT = '-5'; assert.equal(bill.summary(get(u)).warnPct, 0);
  process.env.FREE_WARN_PCT = 'abc'; assert.equal(bill.summary(get(u)).warnPct, 20);
});

/* ---------- через HTTP: «Поделиться», 402 с временем сброса, защита привязки, SEO ---------- */
const U1 = 'a1b2c3d4e5f6', U2 = 'b1b2c3d4e5f6', U3 = 'c1b2c3d4e5f6';
function app(extraFiles) {
  const dir = copyApp();
  seed(dir, { users: [
    { id: U1, login: 'secretlogin42', email: 'hidden.mail@example.com', created: new Date().toISOString() },
    { id: U2, login: 'bobby', email: 'bob@example.com', created: new Date().toISOString() },
    { id: U3, login: 'limited', email: 'lim@example.com', created: new Date().toISOString() },
  ], sessions: { tok1: U1, tok2: U2, tok3: U3 } });
  if (extraFiles) extraFiles(dir);
  return dir;
}
const CHAT = { id: 'c1', title: 'Сайт для кофейни', msgs: [
  { id: 'm1', r: 'u', t: 'Сделай сайт для кофейни', files: [{ name: 'passport-scan.txt', size: 9, text: 'top-secret' }] },
  { id: 'm2', r: 'a', m: 'GPT Test', t: 'Готово:\n```html\n<!doctype html><html><head><title>Кофейня</title></head><body><h1>Кофе</h1><script>alert(1)</script></body></html>\n```\nЕщё **жирный** текст, [сайт](https://example.com/page) и [ловушка](javascript:alert(1)) <img src=x onerror=alert(1)>' },
] };

test('«Поделиться»: короткая неугадываемая ссылка только для чтения, без личных данных, отзывается', async (t) => {
  const dir = app();
  const s = await startServer(dir, { PUBLIC_URL: ORIGIN, SHARE_RATE: '3' });
  t.after(async () => { await s.stop(); rm(dir); });
  let r = await s.req('POST', '/api/sync', { token: 'tok1', body: { base: 0, put: [CHAT], meta: { projects: [], order: ['c1'] } } });
  assert.equal(r.status, 200);
  assert.equal((await s.req('POST', '/api/share', { body: { cid: 'c1' } })).status, 401);
  assert.equal((await s.req('POST', '/api/share', { token: 'tok1', body: { cid: 'c1' }, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 400);
  assert.equal((await s.req('POST', '/api/share', { token: 'tok2', body: { cid: 'c1' } })).status, 404, 'чужой чат не опубликовать');

  r = await s.req('POST', '/api/share', { token: 'tok1', body: { cid: 'c1' } });
  assert.equal(r.status, 200);
  const sh = r.json.share;
  assert.match(sh.id, /^[0-9A-Za-z]{12}$/); assert.equal(sh.url, ORIGIN + '/c/' + sh.id); assert.equal(sh.msgs, 2);
  r = await s.req('POST', '/api/share', { token: 'tok1', body: { cid: 'c1' } });
  assert.equal(r.json.share.id, sh.id, 'повторно — та же ссылка (обновлённый снимок)');
  assert.equal((await s.req('GET', '/api/share?cid=c1', { token: 'tok1' })).json.share.id, sh.id);
  assert.equal((await s.req('GET', '/api/share?cid=c1', { token: 'tok2' })).json.share, null);

  // страница открывается без входа; в ней нет логина, почты, ID и вложений; HTML модели не исполняется
  r = await s.req('GET', '/c/' + sh.id);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /script-src 'none'/);
  assert.match(r.headers.get('x-robots-tag') || '', /noindex/);
  assert.match(r.headers.get('cache-control') || '', /no-store/);
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  for (const leak of ['secretlogin42', 'hidden.mail@example.com', U1, 'passport-scan', 'top-secret', '<script>alert']) assert.ok(!r.text.includes(leak), 'утечка: ' + leak);
  assert.doesNotMatch(r.text, /href="javascript:/i); assert.doesNotMatch(r.text, /<img[^>]*onerror/i); assert.match(r.text, /&lt;img src=x onerror/);
  assert.match(r.text, /Сайт для кофейни/); assert.match(r.text, /<strong>жирный<\/strong>/); assert.match(r.text, /Сделай сайт для кофейни/);
  assert.match(r.text, /href="https:\/\/example\.com\/page"[^>]*rel="[^"]*nofollow/);
  assert.match(r.text, /href="\/login"/); assert.match(r.text, /Попробовать самому/); assert.match(r.text, /ИИ, у которого есть компьютер/);
  assert.match(r.text, /<iframe[^>]+sandbox/, 'сайт из ответа — в песочнице');
  assert.match((await s.req('GET', '/c/' + sh.id + '?lang=en')).text, /Try it yourself/);
  // сайт из ответа: только во фрейме страницы, с песочницей; напрямую — обёртка с кнопкой
  r = await s.req('GET', '/c/' + sh.id + '/a/1-0', { headers: { 'Sec-Fetch-Dest': 'iframe' } });
  assert.equal(r.status, 200); assert.match(r.headers.get('content-security-policy'), /sandbox/); assert.match(r.text, /<h1>Кофе<\/h1>/);
  r = await s.req('GET', '/c/' + sh.id + '/a/1-0', { headers: { 'Sec-Fetch-Dest': 'document' } });
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/c/' + sh.id + '/v/1-0');
  // подбор кода и чужие ссылки
  assert.equal((await s.req('GET', '/c/' + sh.id.slice(0, 11) + 'x')).status, 404);
  assert.equal((await s.req('GET', '/c/..%2F..%2Fetc')).status, 404);
  assert.equal((await s.req('DELETE', '/api/share/' + sh.id, { token: 'tok2' })).status, 404, 'чужую ссылку не отключить');
  assert.equal((await s.req('GET', '/c/' + sh.id)).status, 200);

  // отзыв: ссылка гаснет навсегда; новая ссылка — новый код
  assert.equal((await s.req('DELETE', '/api/share/' + sh.id, { token: 'tok1' })).status, 200);
  assert.equal((await s.req('GET', '/c/' + sh.id)).status, 404);
  assert.equal((await s.req('GET', '/c/' + sh.id + '/a/1-0', { headers: { 'Sec-Fetch-Dest': 'iframe' } })).status, 404);
  assert.equal((await s.req('GET', '/api/share?cid=c1', { token: 'tok1' })).json.share, null);
  r = await s.req('POST', '/api/share', { token: 'tok1', body: { cid: 'c1' } });
  assert.equal(r.status, 200); const id2 = r.json.share.id; assert.notEqual(id2, sh.id);
  // лимит SHARE_RATE=3 в час
  assert.equal((await s.req('POST', '/api/share', { token: 'tok1', body: { cid: 'c1' } })).status, 429);
  // чат удалён — ссылка тоже
  r = await s.req('POST', '/api/sync', { token: 'tok1', body: { base: r.json.rev || 0, del: ['c1'] } });
  assert.equal(r.status, 200);
  assert.equal((await s.req('GET', '/c/' + id2)).status, 404);
});

test('лимиты через API: /api/billing и 402 с временем сброса; привязка приглашения — с лимитом попыток', async (t) => {
  const dir = app((d) => {
    fs.writeFileSync(path.join(d, 'data', 'models.json'), JSON.stringify([{ id: 'm1', name: 'Free Mock', modelId: 'mock', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'test', plans: ['free', 'pro', 'max'] }]));
    fs.mkdirSync(path.join(d, 'data', 'usage'));
    fs.writeFileSync(path.join(d, 'data', 'usage', mskDay() + '.json'), JSON.stringify({ [U3]: { m: 20, c: 0, s: 0, i: 0, v: 0 } }));
  });
  const s = await startServer(dir, { PUBLIC_URL: ORIGIN, REF_RATE_USER: '2' });
  t.after(async () => { await s.stop(); rm(dir); });
  let r = await s.req('GET', '/api/billing', { token: 'tok3' });
  assert.equal(r.status, 200);
  assert.equal(r.json.limits.m, 20); assert.equal(r.json.used.m, 20); assert.equal(r.json.warnPct, 20);
  assert.ok(r.json.resetsAt > Date.now() && r.json.resetsAt <= Date.now() + DAY);
  assert.deepEqual(r.json.offer.trial, { price: 99, days: 3, plan: 'pro', name: 'Pro' }); assert.deepEqual(r.json.offer.first, { percent: 30, plans: ['pro', 'max'] });
  assert.equal(r.json.ref.mode, 'pay'); assert.match(r.json.ref.code, /^[0-9A-Za-z]{10}$/); assert.notEqual(r.json.ref.code, U3);
  const resetsAt = r.json.resetsAt;
  r = await s.req('POST', '/api/chat', { token: 'tok3', body: { model: 'm1', messages: [{ role: 'user', content: 'Привет' }] } });
  assert.equal(r.status, 402); assert.equal(r.json.code, 'limit'); assert.equal(r.json.resetsAt, resetsAt); assert.equal(r.json.plan, 'free');
  r = await s.req('GET', '/api/config', { token: 'tok3' });
  assert.equal(r.json.growth.warnPct, 20); assert.equal(r.json.growth.share, true); assert.equal(r.json.growth.texts.trialBadge, 'Популярный старт');
  r = await s.req('GET', '/api/plans');
  assert.equal(r.json.offers.trial.price, 99); assert.equal(r.json.offers.first.percent, 30);
  r = await s.req('GET', '/api/billing?lang=en', { token: 'tok3', headers: { Cookie: 'premier_session=tok3; premier_lang=en' } });
  assert.equal(r.status, 200);

  // привязка: только JSON со своего сайта; перебор кодов ограничен (REF_RATE_USER=2 за 10 минут)
  assert.equal((await s.req('POST', '/api/referrals/bind', { token: 'tok2', body: { code: 'zzzzzzzzzz' }, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 400);
  assert.equal((await s.req('POST', '/api/referrals/bind', { token: 'tok2', body: { code: 'yyyyyyyyyy' } })).status, 404);
  r = await s.req('POST', '/api/referrals/bind', { token: 'tok2', body: { code: 'xxxxxxxxxx' } });
  assert.equal(r.status, 429);
  // другой аккаунт по настоящему коду — привязка без бонуса до оплаты
  const code = (await s.req('GET', '/api/billing', { token: 'tok1' })).json.ref.code;
  r = await s.req('POST', '/api/referrals/bind', { token: 'tok3', body: { code, fp: 'abc' } });
  assert.equal(r.status, 200); assert.equal(r.json.days, 3);
  assert.equal((await s.req('GET', '/api/billing', { token: 'tok1' })).json.plan.id, 'free', 'пригласивший — без бонуса до оплаты');
  assert.equal((await s.req('GET', '/r/' + code)).headers.get('location'), '/login?ref=' + code);
});

test('SEO: серверные title/description/OG на главной (RU и EN), robots.txt, sitemap.xml, OG-картинки', async (t) => {
  const dir = app();
  const s = await startServer(dir, { PUBLIC_URL: ORIGIN });
  t.after(async () => { await s.stop(); rm(dir); });
  let r = await s.req('GET', '/');
  assert.equal(r.status, 200);
  assert.match(r.text, /<title>Premier — ИИ, у которого есть компьютер<\/title>/);
  assert.match(r.text, /<meta name="description" content="ИИ, который не только отвечает/);
  assert.match(r.text, /<link rel="canonical" href="https:\/\/eide\.pro\/">/);
  assert.match(r.text, /hreflang="en" href="https:\/\/eide\.pro\/\?lang=en"/);
  assert.match(r.text, /<meta property="og:image" content="https:\/\/eide\.pro\/og\.png">/);
  assert.match(r.text, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(r.text, /application\/ld\+json/);
  assert.match(r.text, /ИИ, у которого<br><span>есть компьютер<\/span>/);
  r = await s.req('GET', '/?lang=en');
  assert.match(r.text, /<html lang="en"/); assert.match(r.text, /og-en\.png/); assert.match(r.text, /Top AI models in one place/); assert.match(r.text, /its own computer/);
  assert.match(r.text, /<title>Premier — the AI that has its own computer<\/title>/);
  r = await s.req('GET', '/robots.txt');
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/plain/);
  assert.match(r.text, /Disallow: \/api\//); assert.doesNotMatch(r.text, /panelp/); assert.match(r.text, /Sitemap: https:\/\/eide\.pro\/sitemap\.xml/); // адрес панели не раскрываем
  r = await s.req('GET', '/sitemap.xml');
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /xml/); assert.match(r.text, /<loc>https:\/\/eide\.pro\/<\/loc>/);
  for (const img of ['/og.png', '/og-en.png']) { r = await s.req('GET', img); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /image\/png/); }
  assert.equal((await s.req('GET', '/en')).headers.get('location'), '/?lang=en');
});

test('SHARE=0 и TRIAL_OFFER=0/FIRST_DISCOUNT=0: функции выключаются из env', async (t) => {
  const dir = app();
  const s = await startServer(dir, { PUBLIC_URL: ORIGIN, SHARE: '0', TRIAL_OFFER: '0', FIRST_DISCOUNT: '0' });
  t.after(async () => { await s.stop(); rm(dir); });
  assert.equal((await s.req('POST', '/api/sync', { token: 'tok1', body: { base: 0, put: [CHAT] } })).status, 200);
  assert.equal((await s.req('POST', '/api/share', { token: 'tok1', body: { cid: 'c1' } })).status, 403);
  assert.equal((await s.req('GET', '/c/AAAAAAAAAAAA')).status, 404);
  const b = (await s.req('GET', '/api/billing', { token: 'tok1' })).json;
  assert.equal(b.offer.trial, null); assert.equal(b.offer.first, null);
  assert.equal((await s.req('GET', '/api/config', { token: 'tok1' })).json.growth.share, false);
  assert.equal((await s.req('POST', '/api/pay/create', { token: 'tok1', body: { plan: 'trial', method: 'card' } })).status >= 400, true);
});
