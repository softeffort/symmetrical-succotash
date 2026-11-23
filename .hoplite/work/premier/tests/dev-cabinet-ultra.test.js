'use strict';
// Кабинет разработчика и Ultra-кредиты: /api/dev/state и /api/dev/usage отдают цену Ultra-моделей в кредитах и баланс кредитов,
// клиент (RU и EN) показывает кредиты на карточках моделей, в боковой панели и на обзоре, а чат открывает окно по /chat?ultra=1.
// Запуск: node --test tests/dev-cabinet-ultra.test.js
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { copyApp, rm } = require('../test/helpers');

const DAY = 864e5, root = path.resolve(__dirname, '..'), read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const MODELS = [
  { id: 'm1', name: 'Plain', slug: 'plain', modelId: 'p', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'k', plans: ['free', 'pro', 'max', 'ultra'], weight: 2 },
  { id: 'mu', name: 'Claude Test', slug: 'claude-test', modelId: 'c', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'k', ultra: true, credits: 5, plans: ['max'], weight: 1 },
];

async function app(t) {
  const dir = copyApp();
  const bill = require(path.join(dir, 'billing.js')), store = require(path.join(dir, 'db.js')), { createApi } = require(path.join(dir, 'api', 'index.js'));
  bill.init({ loadSettings: () => ({}), saveSettings() {} });
  bill.saveCfg({ plans: [{ id: 'ultra', credits: 100 }], ultra: { on: true, ctxFree: 20000, ctxStep: 10000, ctxCredits: 2, maxBuy: 10000 } });
  store.kv.set('models', MODELS);
  t.after(() => { try { bill.flush(); } catch {} store.db.close(); rm(dir); });
  let n = 0, cur = null;
  const mk = (o = {}) => { n++; const id = 'u' + n; store.users.put({ id, login: 'user' + n, email: id + '@example.com', created: new Date().toISOString(), ...o, id }); return id; };
  const api = createApi({ store, bill, loadModels: () => store.kv.get('models', []), loadSettings: () => ({ defaultModel: 'm1' }), monitor: { error() {}, isBug: () => false }, clientIp: () => '127.0.0.1', currentUser: () => cur && store.users.get(cur), json: (res, code, data) => { res.code = code; res.body = data; }, origin: () => 'http://x', languageOf: () => 'ru', readBody: async () => ({}) });
  const get = async (uid, p) => {
    cur = uid; const res = {}, url = new URL('http://x' + p);
    await api.handle({ method: 'GET', headers: {} }, res, url); assert.equal(res.code, 200, JSON.stringify(res.body));
    return res.body;
  };
  return { bill, store, mk, get };
}

test('/api/dev/state: Ultra-модель — ultra_credits и доступность по тарифу; обычная — вес в сообщениях', async (t) => {
  const { mk, get } = await app(t);
  const on = await get(mk({ plan: 'ultra', until: Date.now() + 10 * DAY }), '/api/dev/state');
  const claude = on.models.find((m) => m.id === 'claude-test'), plain = on.models.find((m) => m.id === 'plain');
  assert.equal(claude.ultra, true); assert.equal(claude.ultra_credits, 5); assert.equal(claude.available, true);
  assert.equal(plain.ultra, false); assert.equal(plain.ultra_credits, null); assert.equal(plain.weight, 2, 'старые поля на месте');
  const free = await get(mk(), '/api/dev/state');
  const c2 = free.models.find((m) => m.id === 'claude-test');
  assert.equal(c2.available, false); assert.equal(c2.plan_hint, 'Ultra', 'Ultra-модель — только на Ultra, даже если у модели сохранён «Max»');
  assert.equal(c2.ultra_credits, 5); assert.equal(typeof c2.weight, 'number');
});

test('/api/dev/state и /api/dev/usage: credits {total, plan, bought, resets_at}; лимит безлимита не выдуман', async (t) => {
  const { bill, mk, get } = await app(t);
  const uid = mk({ plan: 'ultra', until: Date.now() + 10 * DAY, ultra: { bal: 40 } });
  const st = await get(uid, '/api/dev/state');
  assert.deepEqual([st.credits.plan, st.credits.bought, st.credits.total], [100, 40, 140]);
  assert.equal(st.credits.resets_at, bill.resetsAt(), 'тарифные кредиты сгорают в конце суток по Москве');
  assert.equal(st.credits.access, true); assert.equal(st.credits.on, true);
  assert.deepEqual([st.credits.ctx_free, st.credits.ctx_step, st.credits.ctx_credits], [20000, 10000, 2]);
  assert.equal(st.usage.limit, null, 'у Ultra нет лимита сообщений'); assert.equal(st.usage.unlimited, true); assert.equal(st.usage.fair, false);
  assert.equal((await get(uid, '/api/dev/usage')).credits.total, 140, 'и в /api/dev/usage');
  // тариф без Ultra: купленные кредиты ждут, тарифных нет
  const pro = await get(mk({ plan: 'pro', until: Date.now() + DAY, ultra: { bal: 7 } }), '/api/dev/state');
  assert.deepEqual([pro.credits.plan, pro.credits.bought, pro.credits.total, pro.credits.access, pro.credits.resets_at], [0, 7, 7, false, null]);
  assert.equal(pro.credits.plan_hint, 'Ultra'); assert.equal(pro.usage.limit, 300); assert.equal(pro.usage.unlimited, false);
  assert.equal((await get(mk(), '/api/dev/state')).credits.total, 0);
});

test('безлимит с защитным потолком помечен fair; без потолка — limit null', async (t) => {
  const { bill, store, mk, get } = await app(t);
  bill.saveCfg({ plans: [{ id: 'max', msgs: null, nofair: false }] });
  const st = await get(mk({ plan: 'max', until: Date.now() + DAY }), '/api/dev/state');
  assert.equal(st.usage.unlimited, true); assert.equal(st.usage.fair, st.usage.limit != null);
});

test('клиент кабинета: RU и EN строки для кредитов, баланс в боковой панели и на обзоре, ссылка на окно кредитов', () => {
  const js = read('public/developers.js');
  assert.doesNotThrow(() => new vm.Script(js));
  const dict = (lang) => { const m = new RegExp('D\\.' + lang + ' = \\{([\\s\\S]*?)\\n\\};').exec(js); assert.ok(m, lang); return m[1]; };
  for (const lang of ['ru', 'en']) {
    const d = dict(lang);
    for (const k of ['cost_credits', 'credits_n', 'ultra_badge', 'ultra_ctx', 'ultra_off', 'cr_t', 'cr_plan', 'cr_bought', 'cr_burn', 'cr_keep', 'cr_topup', 'cr_topup_s', 'cr_noaccess', 'cr_waiting', 'pg_cost_credits', 'usage_fair', 'avail_on']) assert.match(d, new RegExp('\\b' + k + ':'), lang + ': ' + k);
  }
  assert.match(dict('ru'), /кредитов за запрос/); assert.match(dict('en'), /credits per request/);
  for (const s of ['m.ultra_credits', "'/chat?ultra=1'", 'creditsBlock(st, true)', 'creditsBlock(st, false)', 'function hasLimit', 'st.credits']) assert.ok(js.includes(s), s);
  assert.doesNotMatch(read('public/developers.css'), /\.cred[^{]*\{[^}]*#[0-9a-f]{3,6}\b/i, 'стили кредитов — только переменные темы');
  assert.match(read('public/en/developers.js'), /m\.ultra_credits/, 'старый EN-кабинет тоже не пишет «1 message» у Ultra');
});

test('чат открывает окно «Ultra-кредиты» по /chat?ultra=1 (RU и EN чат используют один 21-ultra.js)', () => {
  const js = read('public/js/21-ultra.js');
  assert.doesNotThrow(() => new vm.Script(js));
  assert.match(js, /get\('ultra'\) === '1'/); assert.match(js, /qs\.delete\('ultra'\)/);
  for (const p of ['public/chat.html', 'public/en/chat.html']) assert.match(read(p), /\/js\/21-ultra\.js\?v=6/);
});
