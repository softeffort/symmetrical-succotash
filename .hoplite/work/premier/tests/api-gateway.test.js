'use strict';
// Путь запроса через шлюз /v1: прямая передача провайдеру (allowlist), слот до чтения тела, ранний 413, лимиты,
// API_BASE_URL и корректная остановка по SIGTERM. node --test tests/api-gateway.test.js (Node.js 22.13+, без зависимостей).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createFakeProvider } = require('./fixtures/fake-provider');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const mskDay = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const root = path.resolve(__dirname, '..');

// Провайдер OpenAI Responses: запоминает тела запросов, отвечает готовым response.
function createResponsesProvider() {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch {}
      calls.push({ path: req.url, headers: req.headers, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'resp_1', object: 'response', status: 'completed', model: body.model, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'native responses' }] }], usage: { input_tokens: 5, output_tokens: 3 } }));
    });
  });
  return { calls, last: () => calls[calls.length - 1], listen: () => new Promise((r) => srv.listen(0, '127.0.0.1', () => r('http://127.0.0.1:' + srv.address().port))), close: () => new Promise((r) => { srv.closeAllConnections(); srv.close(r); }) };
}

// Запуск копии приложения: свой каталог и база, поддельные провайдеры, пользователи alice (free) и bob (free).
async function boot(t, { env = {}, fake, resp }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'premier-gw-'));
  let child, store, logs = '';
  const handle = { dir, logs: () => logs };
  const stop = async () => {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([new Promise((r) => child.once('exit', r)), delay(6000)]); if (child.exitCode === null) child.kill('SIGKILL'); }
    if (store) { try { store.db.close(); } catch {} store = null; }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  t.after(stop);
  fs.cpSync(root, dir, { recursive: true, filter: (src) => {
    const rel = path.relative(root, src), top = rel.split(path.sep)[0];
    return !rel || ['public', 'locales', 'desktop', 'api', 'admin'].includes(top) || (!rel.includes(path.sep) && !top.startsWith('.') && /\.(js|json)$/.test(top));
  } });
  store = require(path.join(dir, 'db.js'));
  const sessions = new Map();
  for (const id of ['alice', 'bob']) {
    store.users.put({ id, login: id, email: id + '@example.invalid', plan: 'free', until: Date.now() + 864e5, created: new Date().toISOString() });
    const token = crypto.randomBytes(32).toString('hex'); store.sessions.put(sha(token), id, Date.now() + 3600e3); sessions.set(id, token);
  }
  const fakeUrl = await fake.listen(), respUrl = await resp.listen();
  const prov = { baseUrl: fakeUrl + '/v1', apiKey: 'sk-fake-upstream-key' };
  store.kv.set('models', [
    { id: 'm1', name: 'Test Model', modelId: 'fake-1', ...prov, vision: false, plans: ['free'], weight: 1 },
    { id: 'm3', name: 'Native Claude', modelId: 'fake-claude', ...prov, nativeUrl: fakeUrl, native: 'anthropic', plans: ['free'], weight: 1 },
    { id: 'm4', name: 'Native Responses', modelId: 'fake-resp', baseUrl: respUrl, apiKey: 'sk-resp-upstream-key', nativeUrl: respUrl, native: 'responses', plans: ['free'], weight: 1 },
  ]);
  store.kv.set('settings', { defaultModel: 'm1' });
  store.kv.set('usage:' + mskDay(), { quota: { m: 1000 } });

  const reservation = net.createServer(); await new Promise((r) => reservation.listen(0, '127.0.0.1', r));
  const port = reservation.address().port; await new Promise((r) => reservation.close(r));
  const base = 'http://127.0.0.1:' + port;
  const childEnv = { ...process.env, HOST: '127.0.0.1', PORT: String(port), ADMIN_PASSWORD: crypto.randomBytes(24).toString('base64url'), PUBLIC_URL: base, API_BASE_URL: base, TRUST_PROXY: '1', CODE_RUNNER: 'off', API_RPM: '1000', ...env };
  for (const k of Object.keys(childEnv)) if (childEnv[k] === undefined) delete childEnv[k];
  child = spawn(process.execPath, ['server.js'], { cwd: dir, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (b) => { logs += b; }); child.stderr.on('data', (b) => { logs += b; });
  for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error('server did not start: ' + logs); try { if ((await fetch(base + '/healthz')).ok) break; } catch {} await delay(100); }

  const origin = childEnv.PUBLIC_URL;
  const dev = async (p, { uid = 'alice', body, method } = {}) => {
    const r = await fetch(base + p, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { Cookie: 'premier_session=' + sessions.get(uid), 'Content-Type': 'application/json', Origin: origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, data: await r.json() };
  };
  const mkKey = async (uid, b = {}) => (await dev('/api/dev/keys', { uid, body: { name: 'k', ...b } })).data.key;
  const v1 = (p, key, body, headers = {}) => fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  // «сырое» соединение: заголовки и начало тела; тело можно не дописывать
  const raw = (key, contentLength, sendBytes) => new Promise((ok, fail) => {
    const s = net.connect(port, '127.0.0.1'); let text = '';
    s.on('data', (c) => { text += c; });
    s.on('error', () => {});
    s.on('connect', () => {
      s.write(`POST /v1/chat/completions HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${key}\r\nContent-Type: application/json\r\nContent-Length: ${contentLength}\r\n\r\n`);
      s.write('{"model":"test-model","messages":[{"role":"user","content":"' + 'a'.repeat(Math.max(0, sendBytes - 60)));
      ok({ socket: s, text: () => text, status: async (ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = /^HTTP\/1\.1 (\d+)/.exec(text); if (m) return +m[1]; await delay(20); } return null; } });
    });
    setTimeout(() => fail(new Error('connect timeout')), 5000).unref();
  });
  Object.assign(handle, { base, port, store: () => store, dev, mkKey, v1, raw, child: () => child, sessions });
  return handle;
}

// серверные инструменты и mcp_servers теперь дают 400 (API-09; проверки и API_DROP_SERVER_TOOLS — tests/stage2-api.test.js), здесь — остальная очистка запроса
test('gateway request path: native allowlist, body limits, API_BASE_URL', { timeout: 120000 }, async (t) => {
  const fake = createFakeProvider(), resp = createResponsesProvider();
  t.after(async () => { await fake.close(); await resp.close(); });
  const s = await boot(t, { fake, resp, env: { API_CONCURRENCY: '2', API_BODY_MB: '2', API_BODY_INFLIGHT_MB: '2' } });
  const key = await s.mkKey('alice'), bobKey = await s.mkKey('bob');

  await t.test('native Anthropic: server tools, mcp, container and beta flags are not forwarded', async () => {
    const r = await s.v1('/v1/messages', key, {
      model: 'native-claude', max_tokens: 4000, stream: true, service_tier: 'priority', container: 'cont_1', context_management: { edits: [] },
      tools: [{ name: 'get_weather', description: 'w', input_schema: { type: 'object' } }, { type: 'bash_20250124', name: 'bash' }, { type: 'custom', name: 'mine', input_schema: { type: 'object' } }],
      tool_choice: { type: 'tool', name: 'web_search' }, thinking: { type: 'enabled', budget_tokens: 2000 }, temperature: 1, top_k: 5, stop_sequences: ['END'], metadata: { user_id: 'u' },
      messages: [{ role: 'user', content: 'hi' }],
    }, { 'anthropic-version': '2023-06-01', 'anthropic-beta': 'context-1m-2025-08-07, interleaved-thinking-2025-05-14,code-execution-2025-05-22,mcp-client-2025-04-04,files-api-2025-04-14,web-fetch-2025-09-10' });
    assert.equal(r.status, 200); await r.text();
    const call = fake.last(), b = call.body;
    assert.deepEqual(b.tools.map((x) => x.name), ['get_weather', 'bash', 'mine']);
    for (const k of ['mcp_servers', 'container', 'service_tier', 'context_management', 'tool_choice']) assert.equal(k in b, false, k + ' must not reach the provider');
    assert.equal(b.model, 'fake-claude'); assert.equal(b.thinking.budget_tokens, 2000); assert.deepEqual(b.stop_sequences, ['END']); assert.equal(b.top_k, 5);
    assert.equal(call.headers['anthropic-beta'], 'interleaved-thinking-2025-05-14');
  });

  await t.test('native Anthropic: only server tools -> clear 400, nothing charged; unknown betas dropped', async () => {
    const before = fake.calls ? fake.calls.length : null;
    const r = await s.v1('/v1/messages', key, { model: 'native-claude', max_tokens: 50, stream: true, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 99 }], tool_choice: { type: 'any' }, messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r.status, 400);
    const j = await r.json(); assert.match(j.error.message, /Server tools/);
    if (before != null) assert.equal(fake.calls.length, before, 'provider was not called');
    const r2 = await s.v1('/v1/messages', key, { model: 'native-claude', max_tokens: 50, stream: true, messages: [{ role: 'user', content: 'hi' }] }, { 'anthropic-beta': 'context-1m-2025-08-07,web-fetch-2025-09-10' });
    assert.equal(r2.status, 200); await r2.text();
    assert.equal('anthropic-beta' in fake.last().headers, false);
    const r3 = await s.v1('/v1/messages', key, { model: 'native-claude', max_tokens: 50, stream: true, messages: [{ role: 'user', content: 'hi' }] }, { 'anthropic-beta': 'claude-code-20250219,extended-cache-ttl-2025-04-11,mcp-client-2025-04-04' });
    assert.equal(r3.status, 200); await r3.text();
    assert.equal(fake.last().headers['anthropic-beta'], 'claude-code-20250219,extended-cache-ttl-2025-04-11');
  });

  await t.test('native Anthropic: thinking budget is kept below max_tokens', async () => {
    const r = await s.v1('/v1/messages', key, { model: 'native-claude', max_tokens: 3000, stream: true, thinking: { type: 'enabled', budget_tokens: 5000 }, messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r.status, 200); await r.text();
    const b = fake.last().body; assert.ok(b.thinking.budget_tokens < b.max_tokens, JSON.stringify(b.thinking));
  });

  await t.test('native Responses: background, store, previous_response_id and built-in tools are dropped', async () => {
    const r = await s.v1('/v1/responses', key, {
      model: 'native-responses', input: 'hi', background: true, store: true, service_tier: 'priority', max_output_tokens: 50, instructions: 'be brief',
      tools: [{ type: 'function', name: 'f', parameters: { type: 'object' } }, { type: 'custom', name: 'apply_patch' }, { type: 'local_shell' }],
      tool_choice: 'auto',
    });
    assert.equal(r.status, 200);
    const j = await r.json(); assert.equal(j.model, 'native-responses');
    const b = resp.last().body;
    assert.equal(b.store, false); assert.equal(b.model, 'fake-resp'); assert.equal(b.instructions, 'be brief');
    for (const k of ['background', 'previous_response_id', 'conversation', 'service_tier']) assert.equal(k in b, false, k + ' must not reach the provider');
    assert.deepEqual(b.tools.map((x) => x.type), ['function', 'custom', 'local_shell']);
    // продолжение по id невозможно (ответы не хранятся) — честная ошибка, как в обычном пути
    for (const extra of [{ previous_response_id: 'resp_old' }, { conversation: 'conv_1' }]) {
      const r2 = await s.v1('/v1/responses', key, { model: 'native-responses', input: 'hi', ...extra });
      assert.equal(r2.status, 400, JSON.stringify(extra)); await r2.text();
    }
  });

  await t.test('native: light validation without translation', async () => {
    const r = await s.v1('/v1/messages', key, { model: 'native-claude', max_tokens: 5, messages: [] });
    assert.equal(r.status, 400);
    const r2 = await s.v1('/v1/responses', key, { model: 'native-responses' });
    assert.equal(r2.status, 400);
  });

  await t.test('Content-Length over the limit -> 413 at once, body is not read', async () => {
    const c = await s.raw(key, 50 * 1048576, 2000);
    const t0 = Date.now();
    assert.equal(await c.status(), 413);
    assert.ok(Date.now() - t0 < 1500);
    assert.match(c.text(), /request_too_large/);
    for (let i = 0; i < 50 && !c.socket.destroyed; i++) await delay(100);
    assert.equal(c.socket.destroyed, true, 'connection is closed after the early rejection');
  });

  await t.test('slot is taken before the body is read: parallel big bodies beyond the limit get 429 quickly', async () => {
    const held = [await s.raw(key, 600000, 2000), await s.raw(key, 600000, 2000)];
    await delay(400); // оба соединения заняли слот и ждут остаток тела
    for (const h of held) assert.equal(h.text(), '');
    const third = await s.raw(key, 600000, 2000), t0 = Date.now();
    assert.equal(await third.status(), 429);
    assert.ok(Date.now() - t0 < 1500, 'rejected without reading the whole body');
    assert.match(third.text(), /Too many parallel requests/);
    // общий потолок байт тел: другой пользователь тоже не может начать читать ещё один большой запрос
    const other = await s.raw(bobKey, 1000000, 2000);
    assert.equal(await other.status(), 503);
    assert.match(other.text(), /[Rr]etry-After: 5/);
    // обрыв клиента освобождает слоты
    for (const h of [...held, third, other]) h.socket.destroy();
    let ok = false;
    for (let i = 0; i < 30 && !ok; i++) { await delay(100); const r = await s.v1('/v1/chat/completions', key, { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] }); ok = r.status === 200; await r.text(); }
    assert.ok(ok, 'slot is released after the client aborts the upload');
  });

  await t.test('API_BASE_URL: unset -> production direct address, empty -> PUBLIC_URL', async () => {
    const f2 = createFakeProvider(), r2 = createResponsesProvider();
    t.after(async () => { await f2.close(); await r2.close(); });
    const pub = 'http://premier.example.test';
    const s2 = await boot(t, { fake: f2, resp: r2, env: { API_BASE_URL: '', PUBLIC_URL: pub } });
    const st = await s2.dev('/api/dev/state');
    assert.equal(st.status, 200);
    assert.equal(st.data.base_url, pub);
    assert.equal(st.data.connect.sh, `curl -fsSL ${pub}/connect.sh | sh`);
    assert.doesNotMatch(JSON.stringify(st.data), /kgpix/);
    const f3 = createFakeProvider(), r3 = createResponsesProvider();
    t.after(async () => { await f3.close(); await r3.close(); });
    const s3 = await boot(t, { fake: f3, resp: r3, env: { API_BASE_URL: undefined, PUBLIC_URL: pub } });
    const st3 = await s3.dev('/api/dev/state');
    assert.equal(st3.data.base_url, 'https://ide.kgpix.bond');
  });
});

test('gateway: one user cannot hold the body budget; slow uploads time out', { timeout: 60000 }, async (t) => {
  const fake = createFakeProvider(), resp = createResponsesProvider();
  t.after(async () => { await fake.close(); await resp.close(); });
  const s = await boot(t, { fake, resp, env: { API_BODY_MB: '2', API_BODY_INFLIGHT_MB: '8', API_BODY_INFLIGHT_USER_MB: '1', API_BODY_TIMEOUT_MS: '1500' } });
  const key = await s.mkKey('alice'), bobKey = await s.mkKey('bob');
  const held = await s.raw(key, 600000, 2000);
  await delay(300);
  const second = await s.raw(key, 600000, 2000);
  assert.equal(await second.status(), 429, 'the same user is over the per-user share');
  assert.match(second.text(), /uploaded at once from your account/);
  const bob = await s.raw(bobKey, 600000, 2000);
  assert.equal(await bob.status(800), null, 'another user is still admitted and waits for the body');
  // тело не дошло за API_BODY_TIMEOUT_MS — соединение закрыто, место освобождено
  for (let i = 0; i < 60 && !held.socket.destroyed; i++) await delay(100);
  assert.equal(held.socket.destroyed, true, 'slow upload is cut after the deadline');
  for (const h of [second, bob]) h.socket.destroy();
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) { await delay(100); const r = await s.v1('/v1/chat/completions', key, { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] }); ok = r.status === 200; await r.text(); }
  assert.ok(ok, 'the budget is released after the timeout');
});

test('gateway: count_tokens and /v1/models are rate limited', { timeout: 60000 }, async (t) => {
  const fake = createFakeProvider(), resp = createResponsesProvider();
  t.after(async () => { await fake.close(); await resp.close(); });
  const s = await boot(t, { fake, resp, env: { API_RPM: '3' } }); // 6 запросов в минуту на каждый вид
  const key = await s.mkKey('alice');
  // слишком большой count_tokens: больше общего лимита (API_BODY_MB = 32)
  const big = await new Promise((ok) => {
    const sock = net.connect(s.port, '127.0.0.1'); let text = '';
    sock.on('data', (c) => { text += c; }); sock.on('error', () => {});
    sock.on('connect', () => sock.write(`POST /v1/messages/count_tokens HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${key}\r\nContent-Type: application/json\r\nContent-Length: ${33 * 1048576}\r\n\r\n{`));
    setTimeout(() => { sock.destroy(); ok(text); }, 700);
  });
  assert.match(big, /^HTTP\/1\.1 413 /);
  const body = { model: 'test-model', messages: [{ role: 'user', content: 'hello' }] };
  const statuses = []; for (let i = 0; i < 8; i++) { const r = await s.v1('/v1/messages/count_tokens', key, body); statuses.push(r.status); await r.text(); }
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 429, 429]);
  const limited = await s.v1('/v1/messages/count_tokens', key, body);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1); await limited.text();
  // генерация считает свой лимит отдельно
  const g = await s.v1('/v1/chat/completions', key, body);
  assert.equal(g.status, 200); await g.text();
  const models = []; for (let i = 0; i < 8; i++) { const m = await s.v1('/v1/models', key); models.push(m.status); await m.text(); }
  assert.deepEqual(models, [200, 200, 200, 200, 200, 200, 429, 429]);
});

test('SIGTERM: the server waits for in-flight /v1 requests, then exits', { timeout: 60000 }, async (t) => {
  const fake = createFakeProvider(), resp = createResponsesProvider();
  t.after(async () => { await fake.close(); await resp.close(); });
  const s = await boot(t, { fake, resp });
  const key = await s.mkKey('alice'), child = s.child();
  const exited = new Promise((r) => child.once('exit', (code) => r({ code, at: Date.now() })));
  const r = await s.v1('/v1/chat/completions', key, { model: 'test-model', stream: true, messages: [{ role: 'user', content: 'SLOW' }] });
  const reader = r.body.getReader(), dec = new TextDecoder(); let text = (dec.decode((await reader.read()).value));
  const sentAt = Date.now(); child.kill('SIGTERM');
  await delay(500);
  assert.equal(child.exitCode, null, 'still running while a request is in flight');
  // новые соединения больше не принимаются
  await assert.rejects(fetch(s.base + '/healthz', { signal: AbortSignal.timeout(2000) }));
  for (;;) { const x = await reader.read(); if (x.done) break; text += dec.decode(x.value); }
  assert.ok((text.match(/tick/g) || []).length >= 35, 'the whole answer was delivered');
  assert.match(text, /\[DONE\]/);
  const e = await exited;
  assert.equal(e.code, 0);
  assert.ok(e.at - sentAt >= 2500, 'exit came after the request finished');
  // ответ доставлен — списание остаётся
  const rows = s.store().db.prepare('SELECT status, cost FROM api_log WHERE uid = ?').all('alice');
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 200); assert.equal(rows[0].cost, 1);
});

test('SIGTERM: after the grace period unfinished requests are cut and refunded', { timeout: 60000 }, async (t) => {
  const fake = createFakeProvider(), resp = createResponsesProvider();
  t.after(async () => { await fake.close(); await resp.close(); });
  const s = await boot(t, { fake, resp, env: { SHUTDOWN_GRACE_MS: '700' } });
  const key = await s.mkKey('alice'), child = s.child();
  const exited = new Promise((r) => child.once('exit', (code) => r(code)));
  // провайдер, который принимает запрос и молчит: к моменту SIGTERM пользователю ещё нечего показывать
  const hang = http.createServer(() => {}); await new Promise((ok) => hang.listen(0, '127.0.0.1', ok));
  t.after(() => { hang.closeAllConnections(); hang.close(); });
  const models = s.store().kv.get('models', []);
  models.push({ id: 'm9', name: 'Hanging', modelId: 'hang-1', baseUrl: 'http://127.0.0.1:' + hang.address().port + '/v1', apiKey: 'k', plans: ['free'], weight: 1 });
  // сервер читает список моделей при каждом запросе
  s.store().kv.set('models', models);
  const before = (await s.dev('/api/dev/state')).data.usage.used;
  const pending = s.v1('/v1/chat/completions', key, { model: 'm9', messages: [{ role: 'user', content: 'hi' }] }).then((r) => r.status, () => 'aborted');
  await delay(600);
  assert.equal((await s.dev('/api/dev/state')).data.usage.used, before + 1, 'charged while in flight');
  child.kill('SIGTERM');
  assert.equal(await exited, 0);
  assert.notEqual(await pending, 200);
  const rows = s.store().db.prepare('SELECT status, cost FROM api_log WHERE uid = ?').all('alice');
  assert.equal(rows.length, 1); assert.equal(rows[0].cost, 0, 'refunded: the user was not charged for the undelivered answer'); assert.equal(rows[0].status, 503);
});
