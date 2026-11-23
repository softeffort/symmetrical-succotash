'use strict';
// Биллинг и безопасность API: node --test tests/api-billing.test.js (Node.js 22.13+, без npm-зависимостей).
// Часть 1 — функции billing.js и api/keys.js напрямую; часть 2 — настоящий сервер и поддельный провайдер (как в tests/api.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { copyApp, rm } = require('../test/helpers');

const DAY = 864e5, delay = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const mskDay = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const ULTRA = { id: 'claude', name: 'Claude', ultra: true, credits: 3, plans: ['ultra'] };
const PLAIN = { id: 'plain', name: 'Plain', plans: ['free', 'pro', 'max', 'ultra'], weight: 1 };

/* ---------- часть 1: billing.js ---------- */
async function app(t, cfg = { plans: [{ id: 'ultra', credits: 0 }], ultra: { on: true, ctxFree: 20000, ctxStep: 10000, ctxCredits: 2, maxBuy: 10000 } }) {
  const dir = copyApp();
  const bill = require(path.join(dir, 'billing.js')), store = require(path.join(dir, 'db.js'));
  bill.init({ loadSettings: () => ({}), saveSettings() {} });
  t.after(() => { try { bill.flush(); } catch {} store.db.close(); rm(dir); });
  bill.saveCfg(cfg);
  let n = 0;
  const mk = (o = {}) => { n++; const id = 'u' + n + Math.random().toString(16).slice(2, 6); store.users.put({ id, login: 'user' + n + '_' + id, email: id + '@example.com', created: new Date().toISOString(), ...o, id }); return store.users.get(id); };
  const get = (u) => store.users.get(u.id);
  return { bill, store, mk, get, dir };
}
const ultraUser = (o = {}) => ({ plan: 'ultra', until: Date.now() + 10 * DAY, ...o });

test('bonus race: stale snapshots of one user give exactly one bonus; refund restores only what was taken', async (t) => {
  const { bill, store, mk, get } = await app(t);
  const u = mk({ refBonus: { n: 1, until: Date.now() + DAY } });
  bill.add(u.id, 'm', 100000); // дневной лимит исчерпан — дальше только бонус
  const stale = get(u); // «снимок» пользователя, как в шлюзе, где он читается до тела запроса
  const results = Array.from({ length: 6 }, () => bill.charge(stale, PLAIN, { burst: false, api: true }));
  const ok = results.filter((r) => r.ok);
  assert.equal(ok.length, 1, 'бонус достаётся ровно одному запросу');
  assert.equal(ok[0].bonus, true); assert.equal(ok[0].bonusTaken, 1);
  assert.equal(get(u).refBonus.n, 0, 'остаток бонуса не ушёл в минус');
  assert.ok(results.filter((r) => !r.ok).every((r) => r.code === 'limit'));
  bill.refund(get(u), ok[0]); bill.refund(get(u), ok[0]); // повторный возврат ничего не добавляет
  assert.equal(get(u).refBonus.n, 1, 'вернули ровно списанное');

  // возврат запроса, который бонус не тратил (списан из пакета), бонус не увеличивает
  store.users.update(u.id, (x) => { x.refBonus = { n: 1, until: Date.now() + DAY }; x.msgPacks = [{ id: 'p1', n: 10, left: 10, until: Date.now() + DAY }]; });
  const viaPack = bill.charge(get(u), PLAIN, { burst: false });
  assert.ok(viaPack.ok && !viaPack.bonus && viaPack.pack, 'пакет тратится раньше бонуса');
  bill.refund(get(u), viaPack);
  assert.equal(get(u).refBonus.n, 1); assert.equal(get(u).msgPacks[0].left, 10);
});

test('Ultra surcharge counts tools, tool calls / tool_use inputs, tool_result, thinking and documents', async (t) => {
  const { bill } = await app(t);
  const big = 'x'.repeat(80000); // ~23k токенов
  const base = bill.estimateTokens({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
  assert.ok(base < 100);
  const cases = {
    'chat tools[]': { messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function', function: { name: 'f', description: big, parameters: { type: 'object', properties: {} } } }] },
    'chat tool_calls arguments': { messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: JSON.stringify({ a: big }) } }] }] },
    'anthropic tool_use input': { messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'f', input: { code: big } }] }] },
    'anthropic tool_result': { messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: big }] }] }] },
    'anthropic thinking': { messages: [{ role: 'assistant', content: [{ type: 'thinking', thinking: big, signature: 's' }] }] },
    'anthropic tools[] input_schema': { messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'f', description: big, input_schema: { type: 'object', properties: {} } }] },
    'responses input + function_call output': { input: [{ type: 'function_call_output', call_id: 'c', output: big }] },
    'document (base64 pdf)': { messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from('x'.repeat(300000)).toString('base64') } }] }] }, // ~1 токен на 12 байт файла
  };
  // подписи и зашифрованные блоки не считаются; документ дешевле, чем его base64
  assert.ok(bill.estimateTokens({ messages: [{ role: 'assistant', content: [{ type: 'thinking', thinking: 'a', signature: big }, { type: 'redacted_thinking', data: big }] }] }) < 100);
  assert.ok(bill.estimateTokens({ input: [{ type: 'reasoning', encrypted_content: big, summary: [] }] }) < 100);
  assert.ok(bill.estimateTokens({ messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(big).toString('base64') } }] }] }) < 10000);
  for (const [name, body] of Object.entries(cases)) assert.ok(bill.estimateTokens(body) > 20000, name + ' должно учитываться (больше бесплатных 20 000 токенов)');
  // картинка считается ~1000 токенов, а не длиной base64
  const img = bill.estimateTokens({ messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(500000) } }] }] });
  assert.ok(img >= 1000 && img < 1500, 'image ' + img);
  const img2 = bill.estimateTokens({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'A'.repeat(500000) } }] }] });
  assert.ok(img2 >= 1000 && img2 < 1500, 'image_url ' + img2);
  // старый вызов (messages, system) работает как раньше
  assert.ok(bill.estimateTokens([{ role: 'user', content: 'x'.repeat(3500) }]) >= 1000);
  assert.ok(bill.estimateTokens([], 'x'.repeat(3500)) >= 1000);
  // очень глубокая вложенность не роняет оценку
  let deep = {}; for (let i = 0; i < 5000; i++) deep = { a: deep }; assert.doesNotThrow(() => bill.estimateTokens(deep));
});

test('Ultra top-up: real usage.input above the estimate charges the difference, capped at the balance', async (t) => {
  const { bill, mk, get } = await app(t);
  const u = mk(ultraUser({ ultra: { bal: 100 } }));
  const ch = bill.charge(get(u), ULTRA, { burst: false, api: true, ctxTokens: 1000 });
  assert.equal(ch.credits, 3);
  assert.equal(bill.ultraTopUp(get(u), ch, 45000), 6, 'ctxFree 20000, шаг 10000 по 2 кредита: ceil(25000/10000)*2');
  assert.equal(ch.credits, 9); assert.equal(get(u).ultra.bal, 91);
  assert.equal(bill.ultraTopUp(get(u), ch, 45000), 0, 'повторно разницы нет');
  assert.equal(bill.ultraTopUp(get(u), ch, 1000), -6, 'реальный контекст меньше — лишняя доплата возвращается');
  assert.equal(ch.credits, 3); assert.equal(get(u).ultra.bal, 97);
  assert.equal(bill.ultraTopUp(get(u), ch, 1000), 0, 'повторно не возвращаем');
  // оценка выше реального: возврат доплаты, базовая цена остаётся
  const o = mk(ultraUser({ ultra: { bal: 100 } }));
  const c0 = bill.charge(get(o), ULTRA, { burst: false, api: true, ctxTokens: 45000 });
  assert.equal(c0.credits, 9);
  assert.equal(bill.ultraTopUp(get(o), c0, 25000), -4);
  assert.equal(c0.credits, 5); assert.equal(get(o).ultra.bal, 95);
  // нехватка баланса: добираем не больше, чем есть, в минус не уходим
  const p = mk(ultraUser({ ultra: { bal: 5 } }));
  const c2 = bill.charge(get(p), ULTRA, { burst: false, api: true, ctxTokens: 1000 });
  assert.equal(bill.ultraTopUp(get(p), c2, 100000), 2);
  assert.equal(get(p).ultra.bal, 0); assert.equal(c2.credits, 5);
  assert.equal(bill.ultraTopUp(get(p), c2, 100000), 0);
});

test('Ultra ledger: API requests are aggregated per day and never push out purchases and gifts', async (t) => {
  const { bill, store, mk, get } = await app(t);
  const u = mk(ultraUser({ ultra: { bal: 1000 }, ultraLog: [{ kind: 'buy', n: 500, at: Date.now() - 5000 }, { kind: 'gift', n: 50, at: Date.now() - 4000 }] }));
  let net = 0;
  for (let i = 0; i < 150; i++) {
    const ch = bill.charge(get(u), ULTRA, { burst: false, api: true, ctxTokens: 1000 });
    assert.ok(ch.ok); net -= 3;
    if (i % 3 === 0) { bill.refund(get(u), ch); net += 3; }
  }
  const log = get(u).ultraLog;
  assert.ok(log.length <= 5, 'журнал не раздувается: ' + log.length);
  assert.ok(log.some((e) => e.kind === 'buy' && e.n === 500) && log.some((e) => e.kind === 'gift'), 'покупка и подарок на месте');
  const api = log.filter((e) => e.api);
  assert.equal(api.length, 1); assert.equal(api[0].day, mskDay()); assert.equal(api[0].n, net);
  assert.equal(bill.ultraHistory(u.id, 30)[0].kind, 'api', 'история для окна кредитов читается; свежая запись первой');
  { const st = bill.ultraStats(); assert.equal(st.spent - st.refunded, -net, 'статистика считает траты по суточным итогам: списано минус возвращено'); } // BIZ-28: возвраты — отдельным числом
  // запросы из чата по-прежнему пишутся по одному
  const before = get(u).ultraLog.length;
  bill.charge(get(u), ULTRA, { burst: false, ctxTokens: 1000 });
  assert.equal(get(u).ultraLog.length, before + 1);
  assert.equal(store.users.get(u.id).ultra.bal, 1000 + net - 3);
});

test('Ultra refund across midnight does not inflate today\'s plan credits', async (t) => {
  const { bill, mk, get } = await app(t, { plans: [{ id: 'ultra', credits: 50 }], ultra: { on: true, ctxFree: 20000, ctxStep: 10000, ctxCredits: 2, maxBuy: 10000 } });
  const u = mk(ultraUser({ ultra: { bal: 10 } }));
  const ch = bill.charge(get(u), ULTRA, { burst: false, api: true, ctxTokens: 1000 });
  assert.equal(get(u).ultra.bonus, 47);
  bill.refund(get(u), { ...ch, took: ch.took.map((x) => ({ ...x, day: '2000-01-01' })), day: '2000-01-01' }); // запрос начат «вчера» (BIZ-20: сутки записаны в каждом списании)
  assert.equal(get(u).ultra.bonus, 47, 'подарок вчерашних суток не возвращается в сегодняшний');
  const ch2 = bill.charge(get(u), ULTRA, { burst: false, api: true, ctxTokens: 1000 });
  assert.equal(get(u).ultra.bonus, 44);
  bill.refund(get(u), ch2); // в те же сутки — возвращается
  assert.equal(get(u).ultra.bonus, 47);
  // купленные кредиты возвращаются в любой день
  const p = mk(ultraUser({ ultra: { bal: 10 } }));
  bill.saveCfg({ plans: [{ id: 'ultra', credits: 0 }] });
  const c3 = bill.charge(get(p), ULTRA, { burst: false, api: true, ctxTokens: 1000 });
  assert.equal(get(p).ultra.bal, 7);
  bill.refund(get(p), { ...c3, day: '2000-01-01' });
  assert.equal(get(p).ultra.bal, 10);
});

test('abort refunds: at most 20 per user per MSK day', async (t) => {
  const { bill, store } = await app(t);
  for (let i = 0; i < bill.ABORT_REFUNDS; i++) assert.equal(bill.takeAbortRefund('a'), true);
  assert.equal(bill.ABORT_REFUNDS, 20);
  assert.equal(bill.takeAbortRefund('a'), false, '21-й возврат отклонён');
  assert.equal(bill.takeAbortRefund('b'), true, 'у другого пользователя свой счётчик');
  store.kv.set('abortrefund:2000-01-01', { a: 99 });
  store.kv.del('abortrefund:' + mskDay()); // «новые сутки»: старые счётчики удаляются, у a снова 20
  assert.equal(bill.takeAbortRefund('a'), true);
  assert.deepEqual(store.kv.keys('abortrefund:'), ['abortrefund:' + mskDay()]);
});

/* ---------- ключи: api/keys.js ---------- */
function keysStore() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id TEXT PRIMARY KEY); CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT, at INTEGER); INSERT INTO users VALUES (\'u1\');');
  return { db, tx: (fn) => fn() };
}

test('per-key limits: old keys keep Ultra access, new and connect-flow keys do not; limits are validated', async () => {
  const { createKeys } = require('../api/keys'), { createConnect } = require('../api/connect');
  const store = keysStore();
  // база до обновления: таблица без новых колонок и уже выданный ключ
  store.db.exec(`CREATE TABLE api_tokens (id TEXT PRIMARY KEY, uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL, hint TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER, last_used INTEGER, last_ip TEXT, last_client TEXT, models TEXT, ips TEXT);
    INSERT INTO api_tokens (id, uid, hash, name, hint, created) VALUES ('old1', 'u1', 'h1', 'Old', 'prm_abc…wxyz', 1);`);
  const keys = createKeys(store);
  const old = keys.get('u1', 'old1');
  assert.equal(old.allow_ultra, true, 'существующий ключ сохраняет доступ к Ultra'); assert.equal(old.req_cap, null); assert.equal(old.ultra_cap, null);

  const fresh = keys.create('u1', { name: 'New' });
  assert.equal(fresh.item.allow_ultra, false, 'новый ключ — без Ultra');
  assert.equal(keys.verify(fresh.key, '127.0.0.1').key.allow_ultra, false);
  const on = keys.create('u1', { name: 'Ultra', allow_ultra: true, req_cap: 50, ultra_cap: 20 });
  assert.deepEqual([on.item.allow_ultra, on.item.req_cap, on.item.ultra_cap], [true, 50, 20]);

  const upd = keys.update('u1', on.item.id, { allow_ultra: false, req_cap: null, ultra_cap: 7 });
  assert.deepEqual([upd.allow_ultra, upd.req_cap, upd.ultra_cap], [false, null, 7]);
  assert.equal(keys.update('u1', on.item.id, { name: 'Renamed' }).ultra_cap, 7, 'правка других полей лимиты не трогает');
  for (const bad of [{ req_cap: 0 }, { req_cap: 1.5 }, { ultra_cap: -1 }, { ultra_cap: 'ten' }, { req_cap: 2e6 }, { allow_ultra: 'yes' }]) assert.throws(() => keys.update('u1', on.item.id, bad), (e) => e.status === 400, JSON.stringify(bad));

  // ключ из «подключения одной командой»
  const connect = createConnect({ keys, pickModels: () => ({ model: 'm', fast: 'm' }) });
  const s = connect.start({ client: 'codex', os: 'linux', host: 'h' }, '127.0.0.1');
  const r = connect.decide(s.code, { id: 'u1' }, 'approve');
  assert.equal(keys.get('u1', r.item.id).allow_ultra, false, 'ключ подключения без Ultra');
  assert.equal(connect.info(s.code), null);
});

test('connect codes: per-user limit on wrong codes', () => {
  const { createConnect } = require('../api/connect');
  const c = createConnect({ keys: {}, pickModels: () => ({}) });
  for (let i = 0; i < 10; i++) { assert.doesNotThrow(() => c.guard('u1')); c.miss('u1'); }
  assert.throws(() => c.guard('u1'), (e) => e.status === 429);
  assert.doesNotThrow(() => c.guard('u2'));
});

/* ---------- часть 2: сервер + поддельный провайдер ---------- */
function createProvider() {
  const state = { calls: 0, hung: 0, bodies: [] };
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch {}
      state.calls++; state.bodies.push(body);
      const last = (body.messages || [])[(body.messages || []).length - 1] || {};
      const text = typeof last.content === 'string' ? last.content : JSON.stringify(last.content || '');
      if (/HANG/.test(text)) { state.hung++; res.on('close', () => { state.hung--; }); return; } // ни заголовков, ни токенов — клиент уходит до первого токена
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
      send({ id: 'g', object: 'chat.completion.chunk', created: 1, model: 'fake', choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] });
      send({ id: 'g', object: 'chat.completion.chunk', created: 1, model: 'fake', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      send({ id: 'g', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: /BIGUSAGE/.test(text) ? 45000 : /SMALLUSAGE/.test(raw) ? 10 : Math.round((raw || '').length / 3.5), completion_tokens: 2 } });
      res.write('data: [DONE]\n\n'); res.end();
    });
  });
  return { state, listen: () => new Promise((r) => srv.listen(0, '127.0.0.1', () => r('http://127.0.0.1:' + srv.address().port))), close: () => new Promise((r) => { srv.closeAllConnections(); srv.close(r); }) };
}

test('API billing end to end: surcharge, top-up, api_log credits, per-key limits, aborts, bonus race, lockout, connect codes', { timeout: 180000 }, async (t) => {
  const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'premier-apibill-'));
  const fake = createProvider(), fakeUrl = await fake.listen();
  let child, store, logs = '';
  t.after(async () => {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([new Promise((r) => child.once('exit', r)), delay(6000)]); if (child.exitCode === null) child.kill('SIGKILL'); }
    if (store) store.db.close();
    await fake.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  fs.cpSync(root, dir, { recursive: true, filter: (src) => {
    const rel = path.relative(root, src), top = rel.split(path.sep)[0];
    return !rel || ['public', 'locales', 'desktop', 'api', 'admin'].includes(top) || (!rel.includes(path.sep) && !top.startsWith('.') && /\.(js|json)$/.test(top));
  } });
  store = require(path.join(dir, 'db.js'));
  const bill = require(path.join(dir, 'billing.js'));
  bill.init({ loadSettings: () => ({}), saveSettings() {} });
  bill.saveCfg({ plans: [{ id: 'ultra', credits: 0 }], ultra: { on: true, ctxFree: 20000, ctxStep: 10000, ctxCredits: 2, maxBuy: 10000, maxOut: 8000 } });
  const sessions = new Map();
  const user = (id, o = {}) => {
    store.users.put({ id, login: id, email: id + '@example.invalid', plan: 'free', created: new Date().toISOString(), ...o });
    const token = crypto.randomBytes(32).toString('hex'); store.sessions.put(sha(token), id, Date.now() + 3600e3); sessions.set(id, token);
  };
  const ultra = (id, bal) => user(id, { plan: 'ultra', until: Date.now() + 10 * DAY, ultra: { bal } });
  const prov = { baseUrl: fakeUrl + '/v1', apiKey: 'sk-fake' };
  store.kv.set('models', [
    { id: 'm1', name: 'Test Model', modelId: 'fake-1', ...prov, plans: ['free', 'pro', 'max', 'ultra'], weight: 1 },
    { id: 'mu', name: 'Ultra Model', modelId: 'fake-u', ...prov, ultra: true, credits: 3, plans: ['ultra'] },
  ]);
  store.kv.set('settings', { defaultModel: 'm1' });

  const reservation = net.createServer(); await new Promise((r) => reservation.listen(0, '127.0.0.1', r));
  const port = reservation.address().port; await new Promise((r) => reservation.close(r));
  const base = 'http://127.0.0.1:' + port;
  child = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ADMIN_PASSWORD: crypto.randomBytes(24).toString('base64url'), PUBLIC_URL: base, API_BASE_URL: base, CODE_RUNNER: 'off', API_RPM: '1000', API_CONCURRENCY: '50' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (b) => { logs += b; }); child.stderr.on('data', (b) => { logs += b; });
  for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error('server did not start: ' + logs); try { if ((await fetch(base + '/healthz')).ok) break; } catch {} await delay(100); }

  const dev = async (p, { uid, body, method } = {}) => {
    const r = await fetch(base + p, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { Cookie: 'premier_session=' + sessions.get(uid), 'Content-Type': 'application/json', Origin: base }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, data: await r.json() };
  };
  const mkKey = async (uid, body = {}) => { const r = await dev('/api/dev/keys', { uid, body: { name: 'k', ...body } }); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data; };
  const chat = (key, model, content, extra = {}, signal) => fetch(base + '/v1/chat/completions', { method: 'POST', signal, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content }], max_tokens: 50, ...extra }) });
  const bal = (id) => store.users.get(id).ultra.bal;
  const row = (uid) => store.db.prepare('SELECT * FROM api_log WHERE uid = ? ORDER BY id DESC LIMIT 1').get(uid);
  const rows = (uid) => store.db.prepare('SELECT count(*) n FROM api_log WHERE uid = ?').get(uid).n;
  const waitFor = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await delay(50); } return false; };

  await t.test('per-key allow_ultra: new keys have no Ultra access, enabling and disabling takes effect at once', async () => {
    ultra('ua', 1000);
    const k = await mkKey('ua');
    assert.equal(k.item.allow_ultra, false);
    let r = await chat(k.key, 'ultra-model', 'hi');
    assert.equal(r.status, 403); assert.match((await r.json()).error.message, /not allowed to use Ultra/);
    assert.equal(bal('ua'), 1000, 'ничего не списано');
    assert.equal((await chat(k.key, 'test-model', 'hi')).status, 200, 'обычные модели работают');
    assert.equal((await dev('/api/dev/keys/' + k.item.id, { uid: 'ua', method: 'PATCH', body: { allow_ultra: true } })).data.item.allow_ultra, true);
    r = await chat(k.key, 'ultra-model', 'hi'); assert.equal(r.status, 200); await r.text();
    assert.equal(bal('ua'), 997);
    await dev('/api/dev/keys/' + k.item.id, { uid: 'ua', method: 'PATCH', body: { allow_ultra: false } });
    assert.equal((await chat(k.key, 'ultra-model', 'hi')).status, 403);
    assert.equal((await dev('/api/dev/keys/' + k.item.id, { uid: 'ua', method: 'PATCH', body: { req_cap: 0 } })).status, 400);
    const st = (await dev('/api/dev/state', { uid: 'ua' })).data.keys[0];
    assert.deepEqual([st.allow_ultra, st.req_cap, st.ultra_cap], [false, null, null]);
  });

  await t.test('Ultra surcharge counts tools[] and tool inputs; api_log keeps the credits', async () => {
    ultra('ub', 1000);
    const { key } = await mkKey('ub', { allow_ultra: true });
    let r = await chat(key, 'ultra-model', 'hi'); await r.text();
    // запись в api_log сервер делает уже после конца ответа — на загруженной машине клиент успевает раньше, поэтому ждём её
    assert.equal(bal('ub'), 997); assert.equal(await waitFor(() => row('ub')?.credits === 3), true, 'credits: ' + row('ub')?.credits); assert.equal(row('ub').cost, 0);
    const tools = [{ type: 'function', function: { name: 'big', description: 'd'.repeat(130000), parameters: { type: 'object', properties: {} } } }]; // ~37k токенов только в tools
    r = await chat(key, 'ultra-model', 'hi', { tools }); assert.equal(r.status, 200); await r.text();
    // 3 базовых + ceil((37000 − 20000) / 10000) × 2 = 4 за контекст
    assert.equal(bal('ub'), 997 - 7, 'доплата за tools[] списана');
    assert.equal(await waitFor(() => row('ub').credits === 7), true, 'credits: ' + row('ub').credits);
    r = await fetch(base + '/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'ultra-model', max_tokens: 50, messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'f', input: { code: 'c'.repeat(130000) } }] }, { role: 'user', content: 'go' }] }) });
    assert.equal(r.status, 200); await r.text();
    assert.equal(row('ub').credits, 7, 'tool_use.input тоже в оценке');
    // провайдер насчитал меньше оценки — лишняя доплата возвращается (базовая цена остаётся)
    const b0 = bal('ub');
    r = await chat(key, 'ultra-model', 'SMALLUSAGE', { tools }); assert.equal(r.status, 200); await r.text();
    assert.equal(await waitFor(() => row('ub').credits === 3), true, 'credits: ' + row('ub').credits);
    assert.equal(bal('ub'), b0 - 3);
    const logs = (await dev('/api/dev/logs', { uid: 'ub' })).data.items;
    assert.deepEqual(logs.slice(0, 4).map((x) => x.credits), [3, 7, 7, 3], 'история запросов отдаёт credits');
    const stats = (await dev('/api/dev/usage', { uid: 'ub' })).data;
    assert.equal(stats.days[stats.days.length - 1].credits, 20);
    // журнал кредитов не засорён по строке на запрос
    assert.equal(store.users.get('ub').ultraLog.filter((e) => e.api).length, 1);
  });

  await t.test('after the answer, real usage above the estimate is charged (capped at balance)', async () => {
    ultra('uc', 1000);
    const { key } = await mkKey('uc', { allow_ultra: true });
    const r = await chat(key, 'ultra-model', 'BIGUSAGE'); await r.text();
    assert.equal(await waitFor(() => rows('uc') === 1), true);
    assert.equal(bal('uc'), 1000 - 9, '3 базовых + ceil(25000 / 10000) × 2 = 6 по факту (provider: 45000 входных токенов)');
    assert.equal(row('uc').credits, 9);
    ultra('ud', 4);
    const k2 = await mkKey('ud', { allow_ultra: true });
    await (await chat(k2.key, 'ultra-model', 'BIGUSAGE')).text();
    assert.equal(await waitFor(() => rows('ud') === 1), true);
    assert.equal(bal('ud'), 0, 'баланс не ушёл в минус'); assert.equal(row('ud').credits, 4);
  });

  await t.test('per-key daily caps: requests and Ultra credits', async () => {
    ultra('ue', 1000);
    const a = await mkKey('ue', { allow_ultra: true, req_cap: 2 });
    for (let i = 0; i < 2; i++) { const r = await chat(a.key, 'test-model', 'hi'); assert.equal(r.status, 200); await r.text(); }
    let r = await chat(a.key, 'test-model', 'hi');
    assert.equal(r.status, 429); const j = await r.json(); assert.equal(j.error.code, 'insufficient_quota'); assert.match(j.error.message, /daily limit of 2 requests/);
    assert.ok(Number(r.headers.get('retry-after')) >= 60);
    const b = await mkKey('ue', { allow_ultra: true, ultra_cap: 7 });
    for (let i = 0; i < 2; i++) { r = await chat(b.key, 'ultra-model', 'hi'); assert.equal(r.status, 200); await r.text(); }
    const before = bal('ue');
    r = await chat(b.key, 'ultra-model', 'hi');
    assert.equal(r.status, 429); assert.match((await r.json()).error.message, /daily limit of 7 Ultra credits/);
    assert.equal(bal('ue'), before, 'отказ ничего не списал');
    assert.equal((await chat(b.key, 'test-model', 'hi')).status, 200, 'кап Ultra-кредитов не мешает обычным моделям');
    // параллельные запросы не перепрыгивают кап (учитываются ещё не записанные в журнал)
    const c = await mkKey('ue', { req_cap: 3 });
    const res = await Promise.all(Array.from({ length: 8 }, () => chat(c.key, 'test-model', 'hi')));
    await Promise.all(res.map((x) => x.text()));
    assert.equal(res.filter((x) => x.status === 200).length, 3);
  });

  // API-01 (этап 2): пересчёт доплаты за контекст после ответа не выходит за суточный предел Ultra-кредитов ключа
  await t.test('API-01: parallel requests with ultra_cap stay within the cap after the context top-up', async () => {
    ultra('ug', 1000);
    const k = await mkKey('ug', { allow_ultra: true, ultra_cap: 20 });
    const spent = () => (store.db.prepare('SELECT credits FROM api_key_spend WHERE key_id = ?').get(k.item.id) || { credits: 0 }).credits;
    // 6 запросов по 3 кредита проходят проверку (18 ≤ 20); по факту контекст 45K — каждый хочет доплатить ещё 6 (без предела вышло бы 54)
    const res = await Promise.all(Array.from({ length: 6 }, () => chat(k.key, 'ultra-model', 'BIGUSAGE')));
    await Promise.all(res.map((x) => x.text()));
    assert.equal(res.filter((x) => x.status === 200).length, 6);
    assert.equal(await waitFor(() => rows('ug') === 6), true);
    assert.equal(spent(), 20, 'счётчик ключа — ровно предел');
    assert.equal(bal('ug'), 980, 'с баланса ушло не больше предела ключа');
    assert.equal(store.db.prepare('SELECT sum(credits) n FROM api_log WHERE uid = ?').get('ug').n, 20, 'журнал сходится со счётчиком');
    const r = await chat(k.key, 'ultra-model', 'hi');
    assert.equal(r.status, 429); assert.match((await r.json()).error.message, /daily limit of 20 Ultra credits/);
    assert.equal(bal('ug'), 980);
    // ключ без предела доплачивает полностью: 3 + 6
    const free = await mkKey('ug', { allow_ultra: true });
    await (await chat(free.key, 'ultra-model', 'BIGUSAGE')).text();
    assert.equal(await waitFor(() => rows('ug') === 8), true);
    assert.equal(bal('ug'), 971);
  });

  await t.test('client abort before the first token: refunded up to 20 times per day, then kept', async () => {
    user('uf');
    const { key } = await mkKey('uf');
    const used = () => (store.kv.get('usage:' + mskDay(), {}).uf || {}).m || 0;
    const abort = async (n) => {
      const ac = new AbortController(), p = chat(key, 'test-model', 'HANG', {}, ac.signal).catch(() => {});
      assert.equal(await waitFor(() => fake.state.hung > 0), true);
      ac.abort(); await p;
      assert.equal(await waitFor(() => rows('uf') === n && fake.state.hung === 0), true);
    };
    const flushed = async () => { await delay(3300); return used(); }; // счётчик дня пишется в базу с задержкой 3 с
    for (let i = 1; i <= 20; i++) await abort(i);
    assert.equal(await flushed(), 0, 'первые 20 отказов вернули сообщение');
    assert.equal(row('uf').cost, 0);
    await abort(21);
    assert.equal(await flushed(), 1, 'двадцать первый остался списанным');
    assert.equal(row('uf').cost, 1); assert.equal(row('uf').status, 499);
    assert.equal(store.kv.get('abortrefund:' + mskDay(), {}).uf, 20);
    await abort(22);
    assert.equal(await flushed(), 2);
  });

  await t.test('referral bonus: concurrent requests spend one bonus message once', async () => {
    bill.saveCfg({ plans: [{ id: 'free', msgs: 2 }] }); // у Free — 2 сообщения в день
    user('ug');
    const k = await mkKey('ug');
    for (let i = 0; i < 2; i++) { const r = await chat(k.key, 'test-model', 'hi'); assert.equal(r.status, 200); await r.text(); }
    assert.equal((await chat(k.key, 'test-model', 'hi')).status, 429, 'дневной лимит исчерпан');
    store.users.update('ug', (x) => { x.refBonus = { n: 1, until: Date.now() + DAY }; });
    const res = await Promise.all(Array.from({ length: 6 }, () => chat(k.key, 'test-model', 'hi')));
    await Promise.all(res.map((x) => x.text()));
    assert.equal(res.filter((x) => x.status === 200).length, 1, 'бонус на одно сообщение — один успешный запрос');
    assert.equal(store.users.get('ug').refBonus.n, 0);
  });

  await t.test('auth lockout: failed attempts lock the IP, valid keys still pass, message tells the real wait', async () => {
    user('uh');
    const { key } = await mkKey('uh');
    const bad = 'prm_' + 'x'.repeat(42);
    let last;
    for (let i = 0; i < 31; i++) last = await fetch(base + '/v1/models', { headers: { Authorization: 'Bearer ' + bad } });
    assert.equal(last.status, 429);
    const j = await last.json();
    assert.match(j.error.message, /Wait \d+ min/); assert.doesNotMatch(j.error.message, /a minute/);
    assert.ok(Number(last.headers.get('retry-after')) > 60 && Number(last.headers.get('retry-after')) <= 600);
    const ok = await fetch(base + '/v1/models', { headers: { Authorization: 'Bearer ' + key } });
    assert.equal(ok.status, 200, 'верный ключ с заблокированного адреса проходит');
    assert.equal((await fetch(base + '/v1/models', { headers: { Authorization: 'Bearer ' + bad } })).status, 429);
  });

  await t.test('connect codes: guessing wrong codes is rate-limited per user; the device is shown as reported', async () => {
    user('ui');
    let status;
    for (let i = 0; i < 11; i++) status = (await dev('/api/dev/connect/BBBB-CCCC', { uid: 'ui' })).status;
    assert.equal(status, 429);
    assert.equal((await dev('/api/dev/connect/BBBB-DDDD', { uid: 'ui' })).status, 429);
    assert.equal((await dev('/api/dev/connect/BBBB-DDDD', { uid: 'uh' })).status, 404, 'у другого пользователя свой счётчик');
    const js = fs.readFileSync(path.join(dir, 'public', 'developers.js'), 'utf8');
    assert.match(js, /dv_dev_note/); assert.match(js, /allow_ultra/);
  });

  await t.test('connect flow never picks an Ultra model (the new key has no Ultra access)', async () => {
    ultra('cu', 100);
    const keep = store.kv.get('settings', {});
    store.kv.set('settings', { ...keep, defaultModel: 'mu' });
    await delay(2200); // кэш настроек — 2 с
    try {
      const st = await (await fetch(base + '/api/connect/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client: 'codex', os: 'linux', host: 'h' }) })).json();
      assert.equal((await dev('/api/dev/connect/' + st.code, { uid: 'cu', body: { action: 'approve' } })).status, 200);
      await delay(1100);
      const r = await (await fetch(base + '/api/connect/poll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: st.device }) })).json();
      assert.equal(r.status, 'approved');
      const slugs = store.kv.get('models', []).filter((m) => m.ultra).map((m) => m.slug || 'ultra-model');
      assert.ok(r.model && !slugs.includes(r.model) && r.model !== 'ultra-model', 'model: ' + r.model);
      assert.ok(r.fast && !slugs.includes(r.fast) && r.fast !== 'ultra-model', 'fast: ' + r.fast);
      const ok = await chat(r.key, r.model, 'hi'); assert.equal(ok.status, 200); await ok.text();
    } finally { store.kv.set('settings', keep); }
  });

  await t.test('playground obeys the admin switch for the API', async () => {
    user('uj');
    const body = { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] };
    store.kv.set('settings', { defaultModel: 'm1', api: false });
    let r;
    for (let i = 0; i < 50; i++) { r = await dev('/api/dev/playground', { uid: 'uj', body }); if (r.status === 403) break; await delay(100); }
    store.kv.set('settings', { defaultModel: 'm1' });
    assert.equal(r.status, 403); assert.match(r.data.error, /turned off/);
  });
});
