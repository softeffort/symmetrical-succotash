'use strict';
// Надёжность чата: понятные ошибки провайдера, возврат сообщений, таймаут тишины, повтор после сетевого сбоя,
// лимит параллельных ответов, лимит размера запроса, эндпоинты пакетов/сбросов. node --test tests/chat-reliability.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

// Поддельный провайдер: сценарий — по тексту последнего сообщения
function provider() {
  const st = { drops: 0, calls: 0 };
  const srv = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      st.calls++;
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch {}
      const last = (body.messages || []).slice(-1)[0] || {};
      const text = typeof last.content === 'string' ? last.content : (last.content || []).map((p) => p.text || '').join(' ');
      const sse = (chunks, end = true) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); for (const c of chunks) res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: c } }] }) + '\n\n'); if (end) { res.write('data: [DONE]\n\n'); res.end(); } };
      if (/AUTH/.test(text)) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-proj-abcdef123456. You can find your API key at …' } })); }
      if (/SILENT/.test(text)) return sse(['Начинаю…'], false); // заголовки и кусок ответа, потом тишина
      if (/DROP/.test(text) && st.drops++ === 0) return req.socket.destroy(); // сетевой сбой до ответа
      if (/HANG/.test(text)) { await delay(4000); return sse(['готово']); }
      return sse(['Привет', ', ', 'мир']);
    });
  });
  return { st, listen: () => new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok('http://127.0.0.1:' + srv.address().port))), close: () => new Promise((ok) => { srv.closeAllConnections?.(); srv.close(() => ok()); }) };
}

async function boot(t, env = {}) {
  const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'premier-chat-'));
  const fake = provider(), fakeUrl = await fake.listen();
  let child, store;
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
  store.users.put({ id: 'u1', login: 'u1', email: 'u1@example.invalid', plan: 'max', until: Date.now() + 864e5, created: new Date().toISOString() });
  const token = crypto.randomBytes(32).toString('hex'); store.sessions.put(sha(token), 'u1', Date.now() + 3600e3);
  store.kv.set('models', [{ id: 'm1', name: 'Fake', modelId: 'fake-1', baseUrl: fakeUrl + '/v1', apiKey: 'sk-fake-upstream-key', plans: ['free', 'pro', 'max'], weight: 1 }]);
  const port = await freePort(), base = 'http://127.0.0.1:' + port;
  let logs = '';
  child = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PUBLIC_URL: base, CODE_RUNNER: 'off', PROBE_MODELS: 'off', ADMIN_PASSWORD: crypto.randomBytes(24).toString('base64url'), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => (logs += d)); child.stderr.on('data', (d) => (logs += d));
  for (let i = 0; i < 150; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch {} await delay(100); if (child.exitCode != null) throw new Error('сервер не запустился:\n' + logs); }
  const headers = { Cookie: 'premier_session=' + token, 'Content-Type': 'application/json', Origin: base };
  const api = async (p, body) => { const r = await fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const chat = async (text, extra = {}) => {
    const r = await fetch(base + '/api/chat', { method: 'POST', headers, body: JSON.stringify({ model: 'm1', messages: [{ role: 'user', content: text }], ...extra }) });
    if (!r.ok) return { status: r.status, json: await r.json().catch(() => null) };
    const lines = (await r.text()).split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
    return { status: r.status, text: lines.filter((x) => typeof x.t === 'string').map((x) => x.t).join(''), errors: lines.filter((x) => x.e).map((x) => x.e), lines };
  };
  return { base, headers, api, chat, fake, logs: () => logs };
}

test('чат: ответ, понятная ошибка ключа без утечки, возврат сообщения, повтор после сетевого сбоя', { timeout: 60000 }, async (t) => {
  const { api, chat, fake } = await boot(t);
  const ok = await chat('HELLO');
  assert.equal(ok.status, 200); assert.equal(ok.text, 'Привет, мир'); assert.deepEqual(ok.errors, []);
  const used = (await api('/api/billing')).json.used.m;
  const bad = await chat('AUTH');
  assert.equal(bad.errors.length, 1);
  assert.match(bad.errors[0], /Администратор уже уведомлён/);
  assert.doesNotMatch(bad.errors[0], /sk-|Incorrect API key/);
  assert.equal((await api('/api/billing')).json.used.m, used, 'за ошибку провайдера сообщение не списано');
  const dropped = await chat('DROP');
  assert.equal(dropped.text, 'Привет, мир', 'после обрыва соединения — повтор и обычный ответ');
  assert.ok(fake.st.drops >= 1);
  const st = (await api('/api/models/status')).json;
  assert.ok(Array.isArray(st) && st[0].live && typeof st[0].live.errors5m === 'number');
});

test('чат: тишина в потоке обрывается по MODEL_IDLE_MS, короткий обрыв не списывается', { timeout: 60000 }, async (t) => {
  const { api, chat } = await boot(t, { MODEL_IDLE_MS: '5000' });
  const before = (await api('/api/billing')).json.used.m;
  const t0 = Date.now(), r = await chat('SILENT');
  assert.ok(Date.now() - t0 < 30000, 'ответ прерван по тишине, а не по общему таймауту');
  assert.equal(r.errors.length, 1); assert.match(r.errors[0], /замолчала/);
  assert.equal((await api('/api/billing')).json.used.m, before);
});

test('чат: не больше CHAT_MAX_PARALLEL ответов одновременно; запрос больше CHAT_BODY_MB — 413', { timeout: 60000 }, async (t) => {
  const { base, headers, chat, fake } = await boot(t, { CHAT_MAX_PARALLEL: '1', CHAT_BODY_MB: '1' });
  // Заголовки ответа Node отдаёт вместе с первым байтом от модели, поэтому «дождаться 200» у HANG-запроса
  // нельзя: к этому моменту первый ответ уже закончится и слот освободится (гонка, а не проверка лимита).
  // Первый запрос отправляем не дожидаясь ответа и ждём обращения к провайдеру: сервер занимает слот
  // (chatSlot) до запроса к модели, значит занятый слот гарантирован.
  const first = fetch(base + '/api/chat', { method: 'POST', headers, body: JSON.stringify({ model: 'm1', messages: [{ role: 'user', content: 'HANG' }] }) });
  for (let i = 0; i < 150 && !fake.st.calls; i++) await delay(100);
  assert.ok(fake.st.calls >= 1, 'первый ответ дошёл до модели — слот должен быть занят');
  const second = await chat('HELLO');
  assert.equal(second.status, 429); assert.equal(second.json.code, 'busy');
  const firstRes = await first;
  assert.equal(firstRes.status, 200);
  await firstRes.text();
  assert.equal((await chat('HELLO')).text, 'Привет, мир', 'после окончания первого ответа место освободилось');
  const big = await chat('x'.repeat(1.5 * 1048576));
  assert.equal(big.status, 413); assert.match(big.json.error, /Слишком большой/);
});

test('биллинг: «Мои платежи», автосброс, трата сброса — живые эндпоинты в server.js', { timeout: 60000 }, async (t) => {
  const { api } = await boot(t);
  const pays = await api('/api/billing/payments');
  assert.equal(pays.status, 200); assert.deepEqual(pays.json.payments, []);
  const off = await api('/api/billing/auto-reset', { on: false });
  assert.equal(off.status, 200); assert.equal(off.json.billing.autoReset, false);
  assert.equal((await api('/api/billing/auto-reset', { on: true })).json.billing.autoReset, true);
  const use = await api('/api/billing/resets/use', {});
  assert.equal(use.status, 400); assert.equal(use.json.code, 'no_balance');
  const b = (await api('/api/billing')).json;
  assert.ok(b.packs && Array.isArray(b.packs.offers) && b.packs.offers.length > 0);
});
