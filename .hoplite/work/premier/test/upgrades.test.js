// Оплата на несколько месяцев, FAQ на лендинге и воронка по источникам трафика
'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { copyApp, seed, startServer, rm, ROOT } = require('./helpers');
const bill = require('../billing');
const funnel = require('../funnel');
const seo = require('../seo');

test('сроки оплаты: 1 месяц всегда есть, дубли и мусор отбрасываются', () => {
  assert.deepEqual(bill.cleanPeriods([]), [{ months: 1, off: 0 }]);
  assert.deepEqual(bill.cleanPeriods([{ months: 12, off: 25 }, { months: 3, off: 10 }, { months: 3, off: 50 }, { months: 'x' }, { months: 99, off: 5 }, { months: 6, off: 400 }]),
    [{ months: 1, off: 0 }, { months: 3, off: 10 }, { months: 6, off: 90 }, { months: 12, off: 25 }]);
});

test('воронка: источник визита по UTM, меткам рекламы и Referer', () => {
  const u = (s) => new URL(s, 'https://premier.example');
  assert.equal(funnel.detect(u('/?utm_source=Telegram&utm_medium=social&utm_campaign=nov'), '', 'premier.example').s, 'telegram');
  assert.equal(funnel.detect(u('/?yclid=123'), '', 'premier.example').s, 'yandex');
  assert.equal(funnel.detect(u('/'), 'https://premier.example/chat', 'premier.example').s, 'direct');
  const enc = funnel.encode(funnel.detect(u('/?utm_source=vk'), '', 'premier.example'));
  assert.equal(funnel.decode(enc).s, 'vk');
  assert.equal(funnel.decode('мусор'), null);
});

test('FAQ: вопросы с лендинга попадают в разметку FAQPage', () => {
  for (const [file, lang] of [['public/index.html', 'ru'], ['public/en/index.html', 'en']]) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const items = seo.faqItems(html);
    assert.ok(items.length >= 8, file + ': мало вопросов');
    assert.ok(items.every((x) => x.q && x.a && !/[<>]/.test(x.a)));
    const out = seo.landing(html, lang, 'https://premier.example', []);
    assert.match(out, /"@type":"FAQPage"/);
  }
});

test('сервер: сроки в /api/plans, FAQ на главной, шаги воронки и раздел в панели', { timeout: 90000 }, async (t) => {
  const dir = copyApp();
  seed(dir, { users: [{ id: 'u1u1u1u1u1u1', login: 'anna', email: 'anna@example.com', created: new Date().toISOString() }], sessions: { tok1: 'u1u1u1u1u1u1' } });
  const s = await startServer(dir);
  t.after(async () => { await s.stop(); rm(dir); });

  const plans = await s.req('GET', '/api/plans');
  assert.equal(plans.status, 200);
  assert.deepEqual(plans.json.periods.map((x) => x.months), [1, 3, 6, 12]);

  const home = await s.req('GET', '/?utm_source=telegram&utm_medium=social');
  assert.equal(home.status, 200);
  assert.match(home.text, /id="faq"/);
  assert.match(home.text, /FAQPage/);
  assert.match(home.text, /id="perSeg"/);

  assert.equal((await s.req('POST', '/api/track', { body: { step: 'plans' } })).status, 401);
  assert.equal((await s.req('POST', '/api/track', { body: { step: 'plans' }, token: 'tok1' })).status, 200);
  assert.equal((await s.req('POST', '/api/track', { body: { step: 'paid' }, token: 'tok1' })).status, 200); // чужие шаги просто игнорируются

  const login = await s.req('POST', '/api/admin/login', { body: { password: 'Test-Admin-Pass-2026' } });
  assert.equal(login.status, 200);
  const H = { Authorization: 'Bearer ' + login.json.token };
  const f = await s.req('GET', '/api/admin/funnel?days=30&by=source', { headers: H });
  assert.equal(f.status, 200, f.text);
  assert.ok(Array.isArray(f.json.rows));
  assert.equal(f.json.by, 'source');

  const saved = await s.req('POST', '/api/admin/plans', { headers: H, body: { periods: [{ months: 3, off: 5 }, { months: 12, off: 30 }] } });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual((await s.req('GET', '/api/plans')).json.periods, [{ months: 1, off: 0 }, { months: 3, off: 5 }, { months: 12, off: 30 }]);

  assert.equal((await s.req('POST', '/api/admin/metrika', { headers: H, body: { id: 'abc' } })).status, 400);
  assert.equal((await s.req('POST', '/api/admin/metrika', { headers: H, body: { id: '12345678' } })).status, 200);
  assert.match((await s.req('GET', '/')).text, /12345678/);
});
