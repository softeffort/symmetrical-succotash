'use strict';
// Этап 2, строки публичного API (API-02 … API-11): node --test tests/stage2-api.test.js
// Сервер запускается настоящим процессом (копия приложения), провайдер — свой, программируемый в каждом тесте.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const up = require('../api/upstream');
const conv = require('../api/convert');
const { createUsage } = require('../api/usage');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const root = path.resolve(__dirname, '..');
const UPSTREAM_KEY = 'sk-fake-upstream-key';

/* ---------- программируемый провайдер ---------- */
async function mkProvider() {
  const p = { calls: [], handler: null, sockets: new Set() };
  const srv = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch {}
      const call = { url: req.url, headers: req.headers, body, size: raw.length };
      p.calls.push(call);
      (p.handler || defaults)(req, res, call);
    });
  });
  srv.on('connection', (s) => { p.sockets.add(s); s.on('close', () => p.sockets.delete(s)); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  p.port = srv.address().port; p.url = 'http://127.0.0.1:' + p.port;
  p.close = () => new Promise((r) => { for (const s of p.sockets) s.destroy(); srv.close(r); });
  p.reset = () => { p.handler = null; p.calls.length = 0; };
  return p;
}
const jsonBody = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
const chatHead = (res) => res.writeHead(200, { 'Content-Type': 'text/event-stream' });
const chatChunk = (res, delta, finish = null) => res.write('data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n');
const chatUsage = (res) => res.write('data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 7, completion_tokens: 2 } }) + '\n\n');
const aHead = (res) => res.writeHead(200, { 'Content-Type': 'text/event-stream' });
const aev = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
const aStart = (res) => aev(res, 'message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'fake-claude', content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 1 } } });
const aText = (res, text, i = 0) => { aev(res, 'content_block_start', { index: i, content_block: { type: 'text', text: '' } }); aev(res, 'content_block_delta', { index: i, delta: { type: 'text_delta', text } }); aev(res, 'content_block_stop', { index: i }); };
const aEnd = (res) => { aev(res, 'message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }); aev(res, 'message_stop', {}); };
const rev = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
const rDone = (res, extra = {}) => rev(res, 'response.completed', { response: { id: 'resp_1', object: 'response', status: 'completed', model: 'fake-resp', output: [], usage: { input_tokens: 5, output_tokens: 3 }, error: null, ...extra } });
const msgItem = (text) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
function defaults(req, res, call) {
  if (/\/chat\/completions$/.test(req.url)) { chatHead(res); chatChunk(res, { role: 'assistant', content: 'ok' }); chatChunk(res, {}, 'stop'); chatUsage(res); return res.end('data: [DONE]\n\n'); }
  if (/\/messages$/.test(req.url)) { aHead(res); aStart(res); aText(res, 'ok'); aEnd(res); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  rev(res, 'response.created', { response: { id: 'resp_1', status: 'in_progress' } }); rev(res, 'response.output_item.done', { item: msgItem('ok') }); rDone(res); res.end();
}

/* ---------- сервер ---------- */
async function boot(t, { env = {}, prov } = {}) {
  const dir = fs.mkdtempSync(path.join('/var/tmp', 'premier-s2api-'));
  let child, logs = '';
  fs.cpSync(root, dir, { recursive: true, filter: (src) => {
    const rel = path.relative(root, src), top = rel.split(path.sep)[0];
    return !rel || ['public', 'locales', 'desktop', 'api', 'admin'].includes(top) || (!rel.includes(path.sep) && !top.startsWith('.') && /\.(js|json)$/.test(top));
  } });
  const store = require(path.join(dir, 'db.js'));
  store.users.put({ id: 'dev', login: 'dev', email: 'dev@example.invalid', plan: 'pro', until: Date.now() + 864e5, created: new Date().toISOString() });
  store.users.put({ id: 'bob', login: 'bob', email: 'bob@example.invalid', plan: 'pro', until: Date.now() + 864e5, created: new Date().toISOString() });
  const tokens = {};
  for (const id of ['dev', 'bob']) { tokens[id] = crypto.randomBytes(32).toString('hex'); store.sessions.put(sha(tokens[id]), id, Date.now() + 3600e3); }
  const baseP = { baseUrl: prov.url + '/v1', apiKey: UPSTREAM_KEY };
  store.kv.set('models', [
    { id: 'm1', name: 'Test Model', modelId: 'fake-1', ...baseP, vision: false, plans: ['free', 'pro', 'max'], weight: 1 },
    { id: 'm3', name: 'Native Claude', modelId: 'fake-claude', ...baseP, nativeUrl: prov.url, native: 'anthropic', plans: ['free', 'pro', 'max'], weight: 1 },
    { id: 'm4', name: 'Native Responses', modelId: 'fake-resp', baseUrl: prov.url, apiKey: UPSTREAM_KEY, nativeUrl: prov.url, native: 'responses', plans: ['free', 'pro', 'max'], weight: 1 },
  ]);
  store.kv.set('settings', { defaultModel: 'm1' });
  const reservation = net.createServer(); await new Promise((r) => reservation.listen(0, '127.0.0.1', r));
  const port = reservation.address().port; await new Promise((r) => reservation.close(r));
  const base = 'http://127.0.0.1:' + port;
  const stop = async () => {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([new Promise((r) => child.once('exit', r)), delay(6000)]); if (child.exitCode === null) child.kill('SIGKILL'); }
    try { store.db.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  };
  if (t) t.after(stop);
  child = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ADMIN_PASSWORD: crypto.randomBytes(24).toString('base64url'), PUBLIC_URL: base, API_BASE_URL: base, TRUST_PROXY: '1', CODE_RUNNER: 'off', API_RPM: '1000', API_CONCURRENCY: '20', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (b) => { logs += b; }); child.stderr.on('data', (b) => { logs += b; });
  for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error('server did not start: ' + logs); try { if ((await fetch(base + '/healthz')).ok) break; } catch {} await delay(100); }
  const dev = async (p, { uid = 'dev', body } = {}) => { const r = await fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: 'premier_session=' + tokens[uid], 'Content-Type': 'application/json', Origin: base }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, data: await r.json() }; };
  const mkKeyFull = async (uid = 'dev', b = {}) => (await dev('/api/dev/keys', { uid, body: { name: 'k', ...b } })).data;
  const mkKey = async (uid = 'dev', b = {}) => (await mkKeyFull(uid, b)).key;
  const key = await mkKey();
  const g = {
    base, store, dev, mkKey, mkKeyFull, key, prov, stop, logs: () => logs, pid: child.pid, alive: () => child.exitCode === null,
    v1: (p, body, headers = {}, k = key) => fetch(base + p, { method: 'POST', headers: { Authorization: 'Bearer ' + k, 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }),
    items: async () => (await dev('/api/dev/logs?limit=200')).data.items,
    // дождаться новой записи журнала после n и вернуть её
    async nextLog(n) { for (let i = 0; i < 100; i++) { const it = await g.items(); if (it.length > n) return it[0]; await delay(50); } assert.fail('журнал не пополнился'); },
    async run(fn) { const n = (await g.items()).length; const out = await fn(); const log = await g.nextLog(n); return { out, log }; },
  };
  return g;
}
async function sse(r) {
  const out = [];
  for (const block of (await r.text()).split(/\n\n/)) {
    let event = 'message'; const data = [];
    for (const line of block.split('\n')) { if (line.startsWith('event:')) event = line.slice(6).trim(); else if (line.startsWith('data:')) data.push(line.slice(5).trim()); }
    if (data.length) out.push({ event, data: data.join('\n') === '[DONE]' ? '[DONE]' : JSON.parse(data.join('\n')) });
  }
  return out;
}
const U = [{ role: 'user', content: 'hi' }];
const bodies = {
  chat: (extra = {}) => ({ model: 'test-model', stream: true, messages: U, ...extra }),
  messages: (extra = {}) => ({ model: 'test-model', max_tokens: 100, stream: true, messages: U, ...extra }),
  responses: (extra = {}) => ({ model: 'test-model', stream: true, input: 'hi', ...extra }),
  nmessages: (extra = {}) => ({ model: 'native-claude', max_tokens: 100, stream: true, messages: U, ...extra }),
  nresponses: (extra = {}) => ({ model: 'native-responses', stream: true, input: 'hi', ...extra }),
};
const PATHS = { chat: '/v1/chat/completions', messages: '/v1/messages', responses: '/v1/responses', nmessages: '/v1/messages', nresponses: '/v1/responses' };
const send = (g, kind, extra, headers) => g.v1(PATHS[kind], bodies[kind](extra), headers);

// один общий сервер на файл: все проверки, которым не нужны особые переменные окружения
let shared;
async function common(t) {
  if (!shared) { const prov = await mkProvider(); shared = await boot(null, { prov }); }
  shared.prov.reset();
  return shared;
}
test.after(async () => { if (shared) { await shared.stop(); await shared.prov.close(); } });

/* ---------- API-02: ошибки провайдера не уходят клиенту сырыми ---------- */
test('API-02: native Anthropic — error-событие и мусор в потоке очищаются от ключей и адресов провайдера', { timeout: 60000 }, async (t) => {
  const g = await common(t), prov = g.prov;
  const leak = `auth failed for key ${UPSTREAM_KEY} at http://127.0.0.1:${prov.port}/v1/messages host 127.0.0.1:${prov.port}; also AKIAIOSFODNN7EXAMPLE12345 and api.vendor-secret.com`;
  prov.handler = (req, res) => { aHead(res); aStart(res); res.write('data: not-json ' + UPSTREAM_KEY + '\n\n'); aev(res, 'error', { error: { type: 'authentication_error', message: leak } }); res.end(); };
  const { out, log } = await g.run(async () => { const r = await send(g, 'nmessages'); return { status: r.status, text: await r.text() }; });
  assert.equal(out.status, 200);
  for (const bad of [UPSTREAM_KEY, '127.0.0.1', 'AKIAIOSFODNN7', 'vendor-secret', 'not-json']) assert.equal(out.text.includes(bad), false, 'утечка: ' + bad + '\n' + out.text);
  const errEv = out.text.split('\n\n').find((b) => /^event: error/m.test(b)); assert.ok(errEv, 'клиент получает error-событие');
  const j = JSON.parse(errEv.split('data: ')[1]); assert.equal(j.error.type, 'api_error', 'ошибки ключа/оплаты владельца не показываем как есть');
  assert.equal(log.status, 502); assert.equal(log.cost, 0, 'ничего не доставлено — списание возвращено');
});

test('API-02: native Responses — response.failed и error очищаются; ошибка в теле «200» не успех', { timeout: 60000 }, async (t) => {
  const g = await common(t), prov = g.prov;
  const leak = `bad key ${UPSTREAM_KEY} for http://127.0.0.1:${prov.port}/responses (127.0.0.1:${prov.port}) token AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY`;
  prov.handler = (req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); rev(res, 'response.created', { response: { id: 'r', status: 'in_progress' } }); rev(res, 'response.failed', { response: { id: 'r', object: 'response', status: 'failed', error: { code: 'invalid_api_key', message: leak, extra: 'x' } } }); res.end(); };
  let { out, log } = await g.run(async () => { const r = await send(g, 'nresponses'); return r.text(); });
  for (const bad of [UPSTREAM_KEY, '127.0.0.1', 'AIzaSy', 'invalid_api_key']) assert.equal(out.includes(bad), false, 'утечка: ' + bad);
  assert.match(out, /response\.failed/); assert.equal(log.status, 502);
  prov.handler = (req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); rev(res, 'error', { code: 'invalid_api_key', message: leak }); res.end(); };
  ({ out } = await g.run(async () => { const r = await send(g, 'nresponses'); return r.text(); }));
  for (const bad of [UPSTREAM_KEY, '127.0.0.1', 'AIzaSy']) assert.equal(out.includes(bad), false, 'утечка в error: ' + bad);
  // без потока: JSON {type:'error'} с кодом 200 — клиент получает ошибку, а не «успешный» ответ с чужим текстом
  prov.handler = (req, res) => jsonBody(res, 200, { type: 'error', error: { type: 'authentication_error', message: leak } });
  let r = await g.v1('/v1/messages', bodies.nmessages({ stream: false })); let txt = await r.text();
  assert.equal(r.status, 502); for (const bad of [UPSTREAM_KEY, '127.0.0.1']) assert.equal(txt.includes(bad), false);
  prov.handler = (req, res) => jsonBody(res, 200, { id: 'r', object: 'response', status: 'failed', error: { code: 'server_error', message: leak }, output: [] });
  r = await g.v1('/v1/responses', bodies.nresponses({ stream: false })); txt = await r.text();
  assert.equal(r.status, 502); for (const bad of [UPSTREAM_KEY, '127.0.0.1']) assert.equal(txt.includes(bad), false);
});

test('API-02: переводной путь — чужой формат ключа и адрес без схемы тоже вырезаются', { timeout: 60000 }, async (t) => {
  const g = await common(t), prov = g.prov;
  prov.handler = (req, res) => jsonBody(res, 401, { error: { message: `Invalid key ${UPSTREAM_KEY}; AKIAIOSFODNN7EXAMPLE12345 at api.vendor-secret.com:8443 / 10.1.2.3:9000` } });
  const r = await g.v1('/v1/chat/completions', bodies.chat({ stream: false })); const txt = await r.text();
  for (const bad of [UPSTREAM_KEY, 'AKIAIOSFODNN7', 'vendor-secret', '10.1.2.3']) assert.equal(txt.includes(bad), false, 'утечка: ' + bad + ' — ' + txt);
  // функция очистки: ключ из настроек модели вырезается, даже если не похож ни на один известный формат
  up.registerSecrets([{ apiKey: 'zzTopSecretToken', baseUrl: 'https://llm.internal.corp/v1' }]);
  assert.equal(up.scrub('oops zzTopSecretToken @ llm.internal.corp, ZZTOPSECRETTOKEN'), 'oops [redacted] @ [redacted], [redacted]');
});

/* ---------- API-03 / API-04: конец потока, «доставлено» ---------- */
// сценарии нативных потоков: кладём в таблицу и гоняем для обоих протоколов
const MSG = {
  'без финального события и без содержимого': { run: (res) => { aStart(res); }, delivered: false, final: false },
  // BIZ-10, BIZ-23: расчёт — по общей политике с веб-чатом: обрыв после пары слов — возврат, после заметной части ответа (от 200 знаков) — списание остаётся
  'без финального события после пары слов': { run: (res) => { aStart(res); aText(res, 'частичный ответ'); }, delivered: false, final: false },
  'без финального события после заметной части ответа': { run: (res) => { aStart(res); aText(res, 'частичный ответ '.repeat(20)); }, delivered: true, final: false },
  'пустой content_block_start и конец — не результат (API-04)': { run: (res) => { aStart(res); aev(res, 'content_block_start', { index: 0, content_block: { type: 'text', text: '' } }); aEnd(res); }, delivered: false, final: true },
  'блок только из пробелов — не результат (API-04)': { run: (res) => { aStart(res); aText(res, '  \n'); aEnd(res); }, delivered: false, final: true },
  'текст — результат': { run: (res) => { aStart(res); aText(res, 'привет'); aEnd(res); }, delivered: true, final: true },
  'вызов инструмента с разборчивыми аргументами — результат': { run: (res) => { aStart(res); aev(res, 'content_block_start', { index: 0, content_block: { type: 'tool_use', id: 't1', name: 'get_weather', input: {} } }); aev(res, 'content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"city":' } }); aev(res, 'content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '"Moscow"}' } }); aev(res, 'content_block_stop', { index: 0 }); aEnd(res); }, delivered: true, final: true },
  'вызов инструмента с битыми аргументами — не результат (API-04)': { run: (res) => { aStart(res); aev(res, 'content_block_start', { index: 0, content_block: { type: 'tool_use', id: 't1', name: 'get_weather', input: {} } }); aev(res, 'content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"city":' } }); aev(res, 'content_block_stop', { index: 0 }); aEnd(res); }, delivered: false, final: true },
  'вызов инструмента начат, но не закончен — не результат (API-04)': { run: (res) => { aStart(res); aev(res, 'content_block_start', { index: 0, content_block: { type: 'tool_use', id: 't1', name: 'get_weather', input: {} } }); aEnd(res); }, delivered: false, final: true },
};
const RSP = {
  'без финального события и без содержимого': { run: (res) => { rev(res, 'response.created', { response: { id: 'r', status: 'in_progress' } }); }, delivered: false, final: false },
  'без финального события после пары слов': { run: (res) => { rev(res, 'response.output_item.done', { item: msgItem('частичный') }); }, delivered: false, final: false },
  'без финального события после заметной части ответа': { run: (res) => { rev(res, 'response.output_item.done', { item: msgItem('частичный ответ '.repeat(20)) }); }, delivered: true, final: false },
  'без финального события: текст дельтами и тот же текст готовым элементом — дважды не считается': { run: (res) => { rev(res, 'response.output_text.delta', { delta: 'а'.repeat(120) }); rev(res, 'response.output_item.done', { item: msgItem('а'.repeat(120)) }); }, delivered: false, final: false },
  'только output_item.added и конец — не результат (API-04)': { run: (res) => { rev(res, 'response.output_item.added', { item: { type: 'message', role: 'assistant', content: [] } }); rDone(res); }, delivered: false, final: true },
  'пустое сообщение в output_item.done — не результат (API-04)': { run: (res) => { rev(res, 'response.output_item.done', { item: msgItem('') }); rDone(res); }, delivered: false, final: true },
  'текст — результат': { run: (res) => { rev(res, 'response.output_item.done', { item: msgItem('привет') }); rDone(res); }, delivered: true, final: true },
  'function_call с разборчивыми аргументами — результат': { run: (res) => { rev(res, 'response.output_item.done', { item: { type: 'function_call', call_id: 'c1', name: 'f', arguments: '{"a":1}' } }); rDone(res); }, delivered: true, final: true },
  'function_call с битыми аргументами — не результат (API-04)': { run: (res) => { rev(res, 'response.output_item.done', { item: { type: 'function_call', call_id: 'c1', name: 'f', arguments: '{"a":' } }); rDone(res); }, delivered: false, final: true },
};
function tableTest(title, kind, table) {
  test(title, { timeout: 120000 }, async (t) => {
    const g = await common(t), prov = g.prov;
    for (const [name, c] of Object.entries(table)) {
      prov.handler = (req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); c.run(res); res.end(); };
      const { out, log } = await g.run(async () => { const r = await send(g, kind); return r.text(); });
      const finalSeen = kind === 'nmessages' ? /event: message_stop/.test(out) : /response\.(completed|incomplete|failed)/.test(out);
      const cutSeen = kind === 'nmessages' ? /event: error/.test(out) : /response\.failed/.test(out);
      if (c.final) assert.equal(finalSeen, true, name + ': финальное событие передано');
      else { assert.equal(cutSeen, true, name + ': клиент получил ошибку протокола, а не «успех'); assert.equal(log.status, 502, name + ': журнал — 502'); assert.match(log.err || '', /incomplete|interrupted/, name); }
      assert.equal(log.cost > 0, c.delivered, `${name}: ${c.delivered ? 'списание остаётся' : 'списание возвращено'} (cost=${log.cost})`);
    }
  });
}
test('API-02: response.failed — ключ или адрес провайдера в разрешённых полях (id, incomplete_details.reason) клиенту не уходит', { timeout: 60000 }, async (t) => {
  const g = await common(t), prov = g.prov;
  prov.handler = (req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); rev(res, 'response.created', { response: { id: 'r', status: 'in_progress' } });
    rev(res, 'response.failed', { response: { id: UPSTREAM_KEY, object: 'response', status: 'failed', error: { code: 'server_error', message: 'boom' }, incomplete_details: { reason: 'see ' + prov.url + '/internal?key=' + UPSTREAM_KEY } } }); res.end(); };
  let { out } = await g.run(async () => (await send(g, 'nresponses')).text());
  assert.match(out, /response\.failed/);
  for (const bad of [UPSTREAM_KEY, '127.0.0.1', '/internal']) assert.equal(out.includes(bad), false, 'утечка: ' + bad);
  // обычные значения этих полей сохраняются
  prov.handler = (req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); rev(res, 'response.failed', { response: { id: 'resp_abc123', object: 'response', status: 'failed', error: { code: 'server_error', message: 'boom' }, incomplete_details: { reason: 'max_output_tokens' } } }); res.end(); };
  ({ out } = await g.run(async () => (await send(g, 'nresponses')).text()));
  assert.match(out, /"id":"resp_abc123"/); assert.match(out, /"reason":"max_output_tokens"/);
});

tableTest('API-03/04: native Anthropic Messages — обрыв потока и что считается доставленным', 'nmessages', MSG);
tableTest('API-03/04: native Responses — обрыв потока и что считается доставленным', 'nresponses', RSP);

test('API-03/04, BIZ-23: переводной путь — обрыв без finish_reason: 502 в журнале, расчёт по общей политике с веб-чатом', { timeout: 120000 }, async (t) => {
  const g = await common(t), prov = g.prov;
  for (const kind of ['chat', 'messages', 'responses']) {
    prov.handler = (req, res) => { chatHead(res); chatChunk(res, { role: 'assistant', content: 'частичный' }); res.end(); };
    let { log } = await g.run(async () => (await send(g, kind)).text());
    assert.equal(log.status, 502, kind + ': обрыв после текста — 502'); assert.match(log.err, /incomplete/);
    assert.equal(log.cost, 0, kind + ': обрыв после пары слов — списание возвращено, как в веб-чате (раньше оставалось)');
    prov.handler = (req, res) => { chatHead(res); chatChunk(res, { role: 'assistant', content: 'частичный ответ '.repeat(20) }); res.end(); };
    ({ log } = await g.run(async () => (await send(g, kind)).text()));
    assert.equal(log.status, 502); assert.ok(log.cost > 0, kind + ': получена заметная часть ответа (от 200 знаков) — списание остаётся');
    prov.handler = (req, res) => { chatHead(res); res.end(); };
    ({ log } = await g.run(async () => (await send(g, kind)).text()));
    assert.equal(log.cost, 0, kind + ': пустой обрыв — списание возвращено');
  }
  // размышления, которые клиент не получил (Messages без thinking), — не доставленный текст: обрыв после них возвращает списание
  prov.handler = (req, res) => { chatHead(res); chatChunk(res, { role: 'assistant', reasoning_content: 'скрытое размышление '.repeat(20) }); res.end(); };
  let hid = await g.run(async () => (await send(g, 'messages')).text());
  assert.doesNotMatch(hid.out, /скрытое размышление/, 'размышления клиенту не отправлены');
  assert.equal(hid.log.cost, 0, 'обрыв после скрытых размышлений без текста — списание возвращено');
  hid = await g.run(async () => (await send(g, 'chat')).text()); // в Chat Completions размышления идут клиенту (reasoning_content) — это полученный текст
  assert.match(hid.out, /скрытое размышление/); assert.ok(hid.log.cost > 0, 'размышления получены клиентом — заметная часть ответа');
  // без потока тоже
  prov.handler = (req, res) => { chatHead(res); chatChunk(res, { role: 'assistant', content: 'частичный' }); res.end(); };
  const { log } = await g.run(async () => (await g.v1('/v1/chat/completions', bodies.chat({ stream: false }))).text());
  assert.equal(log.status, 502);
});

test('API-04: native без потока — пустой ответ не считается доставленным', { timeout: 60000 }, async (t) => {
  const g = await common(t), prov = g.prov;
  prov.handler = (req, res) => jsonBody(res, 200, { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: '' }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 0 } });
  let { log } = await g.run(async () => (await g.v1('/v1/messages', bodies.nmessages({ stream: false }))).text());
  assert.equal(log.cost, 0, 'пустой текст — возврат');
  prov.handler = (req, res) => jsonBody(res, 200, { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'есть' }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 2 } });
  ({ log } = await g.run(async () => (await g.v1('/v1/messages', bodies.nmessages({ stream: false }))).text()));
  assert.ok(log.cost > 0);
  prov.handler = (req, res) => jsonBody(res, 200, { id: 'r', object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [] }], usage: { input_tokens: 3, output_tokens: 0 } });
  ({ log } = await g.run(async () => (await g.v1('/v1/responses', bodies.nresponses({ stream: false }))).text()));
  assert.equal(log.cost, 0, 'пустое сообщение Responses — возврат');
});

/* ---------- API-05: память держится до конца ответа ---------- */
test('API-05: резерв памяти живёт, пока идёт запрос: второе тело того же пользователя — 429, чужое — 503; после ответа снова можно', { timeout: 90000 }, async (t) => {
  const prov = await mkProvider(); t.after(prov.close);
  const g = await boot(t, { prov, env: { API_BODY_MB: '1', API_BODY_INFLIGHT_MB: '1', API_BODY_INFLIGHT_USER_MB: '1', API_RESPONSE_MAX_MB: '1' } });
  const bobKey = await g.mkKey('bob');
  let releaseHeld; const held = new Promise((r) => { releaseHeld = r; });
  prov.handler = async (req, res, call) => {
    if (call.size > 500000) { await held; return defaults(req, res, call); } // большой запрос «зависает» у провайдера
    return defaults(req, res, call);
  };
  const big = (extra = {}) => bodies.chat({ stream: false, messages: [{ role: 'user', content: 'a'.repeat(700000) }], ...extra });
  const first = g.v1('/v1/chat/completions', big());
  for (let i = 0; i < 100 && !prov.calls.length; i++) await delay(50);
  assert.equal(prov.calls.length, 1, 'первый запрос дошёл до провайдера и ждёт ответа (тело уже прочитано)');
  let r = await g.v1('/v1/chat/completions', big()); let j = await r.json();
  assert.equal(r.status, 429, 'тот же пользователь: резерв первого ещё держится'); assert.match(j.error.message, /at once from your account/);
  r = await g.v1('/v1/chat/completions', big(), {}, bobKey); j = await r.json();
  assert.equal(r.status, 503, 'другой пользователь: общий потолок байт'); assert.equal(j.error.code, 'overloaded');
  r = await g.v1('/v1/chat/completions', bodies.chat({ stream: false })); assert.equal(r.status, 200, 'маленький запрос проходит рядом: await r.text()'); await r.text();
  releaseHeld();
  r = await first; assert.equal(r.status, 200); await r.text();
  r = await g.v1('/v1/chat/completions', big()); assert.equal(r.status, 200, 'после завершения первого место свободно'); await r.text();
  // ответ провайдера без потока ограничен API_RESPONSE_MAX_MB (1 МБ)
  prov.handler = (req, res) => jsonBody(res, 200, { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'x'.repeat(1500000) }], usage: { input_tokens: 1, output_tokens: 1 } });
  const { out, log } = await g.run(async () => { const x = await g.v1('/v1/messages', bodies.nmessages({ stream: false })); return { status: x.status, text: await x.text() }; });
  assert.equal(out.status, 502); assert.match(out.text, /larger than the allowed size/); assert.equal(log.cost, 0, 'ответ не доставлен — списание возвращено');
  // бесконечный поток тоже упирается в потолок
  prov.handler = (req, res) => { aHead(res); aStart(res); const t0 = setInterval(() => { if (res.destroyed) return clearInterval(t0); aev(res, 'content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'x'.repeat(200000) } }); }, 5); res.on('close', () => clearInterval(t0)); };
  const e = await g.run(async () => (await g.v1('/v1/messages', bodies.nmessages())).text());
  assert.match(e.out, /event: error/); assert.equal(e.log.status, 502);
});

// Проверка этапа: «память процесса под пачкой больших запросов остаётся в заданном бюджете». Настройки по умолчанию:
// тело до 32 МБ, на пользователя 64 МБ, на весь процесс 128 МБ. Пик памяти берётся у ядра (VmHWM) — только Linux.
test('API-05: пачка больших запросов — принятые тела укладываются в бюджет, пик памяти процесса ограничен', { timeout: 180000, skip: process.platform !== 'linux' && 'пик памяти читается из /proc' }, async (t) => {
  const prov = await mkProvider(); t.after(prov.close);
  const g = await boot(t, { prov });
  const bobKey = await g.mkKey('bob');
  const MB = 1048576, SIZE = 24 * MB, N = 6; // 2 пользователя × 6 запросов × 24 МБ = 288 МБ тел одновременно
  const mem = (k) => Number((new RegExp(k + ':\\s+(\\d+)').exec(fs.readFileSync(`/proc/${g.pid}/status`, 'utf8')) || [0, 0])[1]) / 1024;
  let releaseHeld; const held = new Promise((r) => { releaseHeld = r; });
  prov.handler = async (req, res, call) => { if (call.size > MB) await held; return defaults(req, res, call); };
  await (await g.v1('/v1/chat/completions', bodies.chat({ stream: false }))).text(); // прогрев
  const base = mem('VmRSS');
  const big = JSON.stringify(bodies.chat({ stream: false, messages: [{ role: 'user', content: 'a'.repeat(SIZE) }] }));
  const done = []; const all = [];
  for (const k of [g.key, bobKey]) for (let i = 0; i < N; i++) all.push(g.v1('/v1/chat/completions', big, {}, k).then(async (r) => { const x = { status: r.status, key: k }; if (r.status !== 200) { await r.text(); done.push(x); } else x.res = r; return x; }, (e) => { const x = { status: 0, key: k, err: e }; done.push(x); return x; }));
  const heldCalls = () => prov.calls.filter((c) => c.size > MB).length;
  for (let i = 0; i < 600 && heldCalls() + done.length < 2 * N; i++) await delay(100);
  const accepted = heldCalls(), peakHeld = mem('VmHWM');
  releaseHeld();
  const out = await Promise.all(all); for (const x of out) if (x.res) await x.res.text();
  const peak = mem('VmHWM'), by = (st) => out.filter((x) => x.status === st).length;
  t.diagnostic(`тел принято ${accepted} из ${2 * N} (${accepted * 24} МБ), отказов 429: ${by(429)}, 503: ${by(503)}, сброс соединения: ${by(0)}; память: до пачки ${Math.round(base)} МБ, пик ${Math.round(peak)} МБ`);
  assert.equal(accepted + done.length, 2 * N, 'каждый запрос либо принят, либо получил отказ');
  assert.ok(accepted >= 2, 'бюджет не мешает обычной работе');
  assert.ok(accepted * SIZE <= 128 * MB, 'одновременно принятые тела не превышают бюджет процесса (128 МБ)');
  for (const k of [g.key, bobKey]) assert.ok(out.filter((x) => x.key === k && x.status === 200).length * SIZE <= 64 * MB, 'и бюджет одного пользователя (64 МБ)');
  // отказ уходит раньше, чем клиент дослал тело: часть клиентов видит его как сброс соединения (status 0) — так было и раньше
  assert.equal(by(200), accepted); assert.equal(by(429) + by(503) + by(0), 2 * N - accepted, 'остальные получили отказ: 429 (свой бюджет) или 503 (общий)');
  assert.ok(by(429) + by(503) > 0, 'отказ приходит ответом с кодом');
  // Бюджет считает байты тел. Сам процесс на каждое принятое тело держит несколько копий (буфер, строка, разобранный JSON,
  // запрос к провайдеру): замер — около 5 размеров тела. Граница с запасом: 8 размеров принятых тел сверх памяти до пачки.
  assert.ok(peakHeld <= peak);
  assert.ok(peak - base <= 8 * accepted * 24, `пик памяти ограничен принятыми телами: +${Math.round(peak - base)} МБ при ${accepted * 24} МБ тел`);
  // после пачки место свободно
  const r = await g.v1('/v1/chat/completions', big); assert.equal(r.status, 200, 'после пачки большой запрос снова проходит'); await r.text();
  assert.equal(g.alive(), true);
});

/* ---------- API-06: имена инструментов ---------- */
test('API-06: имена из namespace не склеиваются: коллизии, спецсимволы, обрезка до 64; история и tool_choice используют то же имя', () => {
  const fnT = (name) => ({ type: 'function', name, parameters: { type: 'object' } });
  const req = {
    model: 'm', input: [{ type: 'message', role: 'user', content: 'hi' }, { type: 'function_call', call_id: 'c1', name: 'c', namespace: 'a__b', arguments: '{}' }, { type: 'function_call_output', call_id: 'c1', output: 'ok' }],
    tools: [fnT('plain'), { type: 'namespace', name: 'a__b', tools: [fnT('c')] }, { type: 'namespace', name: 'a', tools: [fnT('b__c'), fnT('b.c')] }, { type: 'namespace', name: 'n'.repeat(70), tools: [fnT('x'), fnT('y')] }, { type: 'namespace', name: 'ns', tools: [fnT('plain')] }, fnT('ns__plain')],
    tool_choice: { type: 'function', name: 'c', namespace: 'a__b' },
  };
  const p = conv.fromResponses(req), names = p.body.tools.map((x) => x.function.name);
  assert.equal(new Set(names).size, names.length, 'имена уникальны: ' + names.join(', '));
  for (const n of names) assert.match(n, /^[a-zA-Z0-9_-]{1,64}$/);
  assert.ok(names.includes('plain') && names.includes('ns__plain'), 'обычные имена не меняются');
  // каждое имя возвращается к паре (namespace, name)
  const back = (flat) => p.ns.get(flat);
  const flatOf = (ns, name) => [...p.ns].find(([, v]) => v.namespace === ns && v.name === name)[0];
  assert.equal(p.ns.size, 6, 'все пары (namespace, name) в таблице');
  assert.deepEqual(back(flatOf('a__b', 'c')), { name: 'c', namespace: 'a__b' });
  assert.deepEqual(back(flatOf('a', 'b__c')), { name: 'b__c', namespace: 'a' });
  assert.notEqual(flatOf('a__b', 'c'), flatOf('a', 'b__c'));
  assert.notEqual(flatOf('a', 'b__c'), flatOf('a', 'b.c'));
  assert.notEqual(flatOf('n'.repeat(70), 'x'), flatOf('n'.repeat(70), 'y'), 'обрезка до 64 не склеивает разные инструменты');
  assert.notEqual(flatOf('ns', 'plain'), 'plain');
  // история и tool_choice — то же имя, что в списке инструментов
  const call = p.body.messages.find((m) => m.tool_calls).tool_calls[0];
  assert.equal(call.function.name, flatOf('a__b', 'c'));
  assert.deepEqual(p.body.tool_choice, { type: 'function', function: { name: flatOf('a__b', 'c') } });
  // tool_choice на несуществующий инструмент — 400
  assert.throws(() => conv.fromResponses({ ...req, tool_choice: { type: 'function', name: 'ghost' } }), (e) => e.kind === 'invalid' && e.param === 'tool_choice');
  assert.throws(() => conv.fromResponses({ ...req, tool_choice: { type: 'function', name: 'c', namespace: 'zzz' } }), (e) => e.kind === 'invalid');
  // прежнее имя multi_agent_v1__spawn_agent сохраняется (его ждут уже сохранённые истории Codex)
  const q = conv.fromResponses({ model: 'm', input: 'x', tools: [{ type: 'namespace', name: 'multi_agent_v1', tools: [fnT('spawn_agent')] }] });
  assert.equal(q.body.tools[0].function.name, 'multi_agent_v1__spawn_agent');
});

/* ---------- API-07: reasoning.effort ---------- */
test('API-07: Responses reasoning.effort доходит до провайдера как reasoning_effort; недопустимое значение — 400 до списания', { timeout: 60000 }, async (t) => {
  const g = await common(t), prov = g.prov;
  for (const effort of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']) {
    prov.calls.length = 0;
    const r = await send(g, 'responses', { stream: false, reasoning: { effort } }); await r.text();
    assert.equal(r.status, 200, effort); assert.equal(prov.calls[0].body.reasoning_effort, effort);
  }
  prov.calls.length = 0;
  let r = await send(g, 'responses', { stream: false }); await r.text();
  assert.equal('reasoning_effort' in prov.calls[0].body, false, 'без reasoning поле не добавляется');
  for (const kind of ['responses', 'nresponses']) for (const bad of [{ effort: 'extreme' }, { effort: 5 }, 'high']) {
    prov.calls.length = 0;
    const n = (await g.items()).length;
    r = await send(g, kind, { stream: false, reasoning: bad }); const j = await r.json();
    assert.equal(r.status, 400, kind + JSON.stringify(bad)); assert.match(j.error.param || '', /^reasoning/); assert.equal(prov.calls.length, 0, 'провайдер не вызывался');
    const log = (await g.items()); const last = log.length > n ? log[0] : null; assert.ok(!last || !(last.cost > 0), 'ничего не списано');
  }
  // native Responses: допустимое значение уходит провайдеру как есть
  prov.calls.length = 0; r = await send(g, 'nresponses', { stream: false, reasoning: { effort: 'high', summary: 'auto' } }); await r.text();
  assert.deepEqual(prov.calls[0].body.reasoning, { effort: 'high', summary: 'auto' });
});

/* ---------- API-09: серверные инструменты ---------- */
const SERVER_TOOL_CASES = () => [
  ['chat web_search_options', 'chat', { web_search_options: {} }],
  ['chat не-function инструмент', 'chat', { tools: [{ type: 'web_search_preview' }] }],
  ['responses web_search (как у Codex)', 'responses', { tools: [{ type: 'web_search', external_web_access: false }] }],
  ['responses mcp', 'responses', { tools: [{ type: 'function', name: 'f', parameters: { type: 'object' } }, { type: 'mcp', server_label: 'x', server_url: 'https://x.invalid' }] }],
  ['messages web_search_*', 'messages', { tools: [{ name: 'f', input_schema: { type: 'object' } }, { type: 'web_search_20250305', name: 'web_search' }] }],
  ['messages mcp_servers', 'messages', { mcp_servers: [{ type: 'url', url: 'https://x.invalid/mcp', name: 'x' }] }],
  ['messages: инструмент без input_schema', 'messages', { tools: [{ name: 'f' }] }],
  ['native messages web_search + клиентский', 'nmessages', { tools: [{ name: 'f', input_schema: { type: 'object' } }, { type: 'web_search_20250305', name: 'web_search' }] }],
  ['native messages mcp_servers', 'nmessages', { mcp_servers: [{ type: 'url', url: 'https://x.invalid/mcp', name: 'x' }] }],
  ['native responses web_search_preview', 'nresponses', { tools: [{ type: 'function', name: 'f', parameters: { type: 'object' } }, { type: 'web_search_preview' }] }],
  ['native responses tool_choice на серверный', 'nresponses', { tool_choice: { type: 'web_search_preview' } }],
];
test('API-09: серверные инструменты и mcp_servers — 400 до списания, провайдер не вызывается', { timeout: 120000 }, async (t) => {
  const g = await common(t), prov = g.prov;
  for (const [name, kind, extra] of SERVER_TOOL_CASES()) {
    prov.calls.length = 0; const n = (await g.items()).length;
    const r = await send(g, kind, { stream: false, ...extra }); const j = await r.json();
    assert.equal(r.status, 400, name + ': ' + JSON.stringify(j));
    assert.equal(prov.calls.length, 0, name + ': провайдер не вызывался');
    await delay(100); const it = await g.items(); assert.ok(it.length === n || !(it[0].cost > 0), name + ': ничего не списано');
  }
  // сообщение и код понятны
  const r = await send(g, 'responses', { stream: false, tools: [{ type: 'web_search', external_web_access: false }] }); const j = await r.json();
  assert.equal(j.error.code, 'unsupported_tool'); assert.equal(j.error.param, 'tools'); assert.match(j.error.message, /web_search/);
  const r2 = await send(g, 'nmessages', { stream: false, tools: [{ type: 'web_search_20250305', name: 'web_search' }] });
  assert.match((await r2.json()).error.message, /Server tools/);
  // клиентские инструменты работают: function/custom, а у Anthropic ещё и bash_*/text_editor_*
  prov.calls.length = 0;
  let ok = await send(g, 'nmessages', { stream: false, tools: [{ name: 'f', input_schema: { type: 'object' } }, { type: 'bash_20250124', name: 'bash' }] }); await ok.text(); assert.equal(ok.status, 200);
  ok = await send(g, 'responses', { stream: false, tools: [{ type: 'function', name: 'f', parameters: { type: 'object' } }, { type: 'custom', name: 'apply_patch' }, { type: 'local_shell' }] }); await ok.text(); assert.equal(ok.status, 200);
  ok = await send(g, 'chat', { stream: false, tools: [{ type: 'function', function: { name: 'f', parameters: { type: 'object' } } }] }); await ok.text(); assert.equal(ok.status, 200);
});

test('API-09: API_DROP_SERVER_TOOLS=1 возвращает прежнее поведение (убрать молча); запрос только с серверными инструментами Anthropic остаётся ошибкой', { timeout: 120000 }, async (t) => {
  const prov = await mkProvider(); t.after(prov.close);
  const g = await boot(t, { prov, env: { API_DROP_SERVER_TOOLS: '1' } });
  prov.calls.length = 0;
  let r = await send(g, 'responses', { stream: false, tools: [{ type: 'function', name: 'f', parameters: { type: 'object' } }, { type: 'web_search', external_web_access: false }] }); await r.text();
  assert.equal(r.status, 200); assert.deepEqual(prov.calls[0].body.tools.map((x) => x.function.name), ['f']);
  r = await send(g, 'chat', { stream: false, web_search_options: {} }); await r.text(); assert.equal(r.status, 200);
  r = await send(g, 'nresponses', { stream: false, tools: [{ type: 'function', name: 'f', parameters: { type: 'object' } }, { type: 'web_search_preview' }] }); await r.text();
  assert.equal(r.status, 200); assert.deepEqual(prov.calls[prov.calls.length - 1].body.tools.map((x) => x.type), ['function']);
  r = await send(g, 'nmessages', { stream: false, mcp_servers: [{ type: 'url', url: 'https://x.invalid/mcp', name: 'x' }], tools: [{ name: 'f', input_schema: { type: 'object' } }, { type: 'web_search_20250305', name: 'web_search' }] }); await r.text();
  assert.equal(r.status, 200); const sent = prov.calls[prov.calls.length - 1].body; assert.deepEqual(sent.tools.map((x) => x.name), ['f']); assert.equal('mcp_servers' in sent, false);
  r = await send(g, 'nmessages', { stream: false, tools: [{ type: 'web_search_20250305', name: 'web_search' }] }); await r.text();
  assert.equal(r.status, 400, 'только серверные инструменты — ошибка и с опцией');
});

/* ---------- API-10: повторы без двойной оплаты ---------- */
const mdl = (url, extra = {}) => ({ id: 'm', slug: 'm', modelId: 'fake-1', baseUrl: url + '/v1', apiKey: UPSTREAM_KEY, ...extra });
const BODY = { messages: [{ role: 'user', content: 'hi' }], stream: true };
const rej = async (p) => { try { await p; } catch (e) { return e; } assert.fail('expected a rejection'); };
test('API-10: после сброса соединения запрос не повторяется, если провайдер не принимает ключ идемпотентности; с ключом — повтор с тем же ключом', { timeout: 60000 }, async (t) => {
  const p = await mkProvider(); t.after(p.close);
  p.handler = (req, res) => req.socket.destroy(); // принял запрос и оборвал соединение: неизвестно, начал ли он считать
  let e = await rej(up.open(mdl(p.url), BODY, {}));
  assert.equal(p.calls.length, 1, 'ровно одно обращение: повтор мог бы оплатиться дважды'); assert.equal(e.kind, 'upstream'); assert.equal(e.shouldRetry, true);
  assert.match(String(p.calls[0].headers['idempotency-key']), /^premier-[0-9a-f-]{36}$/, 'ключ идемпотентности отправлен');
  // провайдер подтверждённо поддерживает ключ — повторяем с тем же ключом
  p.calls.length = 0; let n = 0;
  p.handler = (req, res, call) => { if (n++ === 0) return req.socket.destroy(); defaults(req, res, call); };
  const u = await up.open(mdl(p.url, { idempotent: true }), BODY, {}); u.done();
  assert.equal(p.calls.length, 2); assert.equal(p.calls[0].headers['idempotency-key'], p.calls[1].headers['idempotency-key']);
  // полученный 5xx не доказывает, что провайдер не выполнил запрос: без подтверждённой идемпотентности — ни одного повтора, клиент получает shouldRetry
  for (const code of [500, 502, 503, 504]) {
    p.calls.length = 0; p.handler = (req, res) => jsonBody(res, code, { error: { message: 'boom' } });
    e = await rej(up.open(mdl(p.url), BODY, {})); assert.ok(e.status >= 500, String(code)); assert.equal(p.calls.length, 1, 'HTTP ' + code + ' не повторяется'); assert.equal(e.shouldRetry, true, 'HTTP ' + code + ': решение за клиентом');
  }
  // подтверждённо идемпотентный провайдер (model.idempotent) — один повтор с тем же ключом
  for (const code of [500, 502, 503, 504]) {
    p.calls.length = 0; n = 0; p.handler = (req, res, call) => { if (n++ === 0) return jsonBody(res, code, { error: { message: 'boom' } }); defaults(req, res, call); };
    const v = await up.open(mdl(p.url, { idempotent: true }), BODY, {}); v.done();
    assert.equal(p.calls.length, 2, 'HTTP ' + code + ' при идемпотентном провайдере — повтор'); assert.equal(p.calls[0].headers['idempotency-key'], p.calls[1].headers['idempotency-key']);
  }
});
test('API-10: отказ в соединении (запрос точно не ушёл) — повтор разрешён', { timeout: 60000 }, async () => {
  const srv = net.createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port; await new Promise((r) => srv.close(r)); // порт закрыт
  const t0 = Date.now();
  const e = await rej(up.open(mdl('http://127.0.0.1:' + port), BODY, {}));
  assert.equal(e.kind, 'overloaded'); assert.ok(Date.now() - t0 >= 1400, 'был один повтор через ~1.5 с: ' + (Date.now() - t0));
  const refused = await fetch('http://127.0.0.1:' + port).catch((x) => x); assert.equal(up.neverSent(refused), true);
  assert.equal(up.neverSent(Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('read'), { code: 'ECONNRESET' }) })), false);
  assert.equal(up.neverSent(Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('socket'), { code: 'UND_ERR_SOCKET' }) })), false);
});

/* ---------- API-11: лимиты ключа не зависят от журнала ---------- */
test('API-11: дневной лимит запросов ключа держится, даже если запись в api_log не удаётся; возвращённые запросы не расходуют лимит; потеря журнала — тревога', { timeout: 90000 }, async (t) => {
  const g = await common(t), prov = g.prov;
  const full = await g.mkKeyFull('dev', { req_cap: 2 }), key = full.key, kid = full.item;
  const spend = () => g.store.db.prepare('SELECT requests, credits FROM api_key_spend WHERE key_id = ?').get(kid.id) || { requests: 0, credits: 0 };
  // провалившийся запрос возвращается и счётчик ключа тоже
  prov.handler = (req, res) => jsonBody(res, 500, { error: { message: 'boom' } });
  let r = await g.v1('/v1/chat/completions', bodies.chat({ stream: false }), {}, key); await r.text(); assert.equal(r.status >= 500, true);
  for (let i = 0; i < 100 && spend().requests !== 0; i++) await delay(50);
  assert.equal(spend().requests, 0, 'ошибка провайдера не расходует лимит ключа');
  prov.reset();
  // ломаем журнал: вставка падает, чтения работают
  g.store.db.exec("CREATE TRIGGER s2_break_log BEFORE INSERT ON api_log BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
  t.after(() => { try { g.store.db.exec('DROP TRIGGER IF EXISTS s2_break_log'); } catch {} });
  for (let i = 0; i < 2; i++) { r = await g.v1('/v1/chat/completions', bodies.chat({ stream: false }), {}, key); assert.equal(r.status, 200, 'запрос ' + (i + 1)); await r.text(); }
  assert.equal(spend().requests, 2, 'счётчик ключа ведётся независимо от журнала');
  r = await g.v1('/v1/chat/completions', bodies.chat({ stream: false }), {}, key); const j = await r.json();
  assert.equal(r.status, 429, 'третий запрос сверх лимита 2'); assert.match(j.error.message, /daily limit of 2 requests/);
  for (let i = 0; i < 100 && !/запись потеряна/.test(g.logs()); i++) await delay(50);
  assert.match(g.logs(), /запись потеряна/, 'потеря записи журнала — ошибка в мониторе (тревога)');
});

test('API-11: в день обновления счётчика ещё нет, а в журнале уже есть 9 из 10 — параллельные запросы не обходят лимит', { timeout: 90000 }, async (t) => {
  const g = await common(t), prov = g.prov;
  const full = await g.mkKeyFull('dev', { req_cap: 10 }), key = full.key, kid = full.item.id;
  const at = createUsage({ db: g.store.db }).dayStart() + 1000;
  const ins = g.store.db.prepare('INSERT INTO api_log (uid, key_id, at, model, proto, status, cost, credits) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (let i = 0; i < 9; i++) ins.run('dev', kid, at + i, 'test-model', 'chat', 200, 1, 0);
  assert.equal(g.store.db.prepare('SELECT count(*) AS n FROM api_key_spend WHERE key_id = ?').get(kid).n, 0, 'счётчика ещё нет');
  prov.handler = (req, res, call) => setTimeout(() => defaults(req, res, call), 400); // ответы держатся, пока все пять запросов не пройдут проверку
  const rs = await Promise.all(Array.from({ length: 5 }, () => g.v1('/v1/chat/completions', bodies.chat({ stream: false }), {}, key)));
  const codes = rs.map((r) => r.status).sort(); for (const r of rs) await r.text();
  assert.deepEqual(codes, [200, 429, 429, 429, 429], 'ровно один запрос из десяти допустимых: ' + codes);
  assert.equal(prov.calls.length, 1);
  assert.equal(g.store.db.prepare('SELECT requests FROM api_key_spend WHERE key_id = ?').get(kid).requests, 10, 'счётчик стартовал с журнала (9) и принял новый запрос');
});

test('API-11: счётчик Ultra-кредитов ключа стартует с журнала за те же сутки; keyToday(keyId, at) читает сутки момента at', () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE users (id TEXT PRIMARY KEY)'); db.prepare('INSERT INTO users (id) VALUES (?)').run('u1');
  const usage = createUsage({ db }), D0 = usage.dayStart(), DAY = 86400000;
  const ins = db.prepare('INSERT INTO api_log (uid, key_id, at, status, cost, credits) VALUES (?, ?, ?, ?, ?, ?)');
  ins.run('u1', 'k1', D0 + 1000, 200, 0, 30); ins.run('u1', 'k1', D0 + 2000, 200, 0, 25); ins.run('u1', 'k1', D0 + 3000, 429, 0, 0); // последняя — отказ, не считается
  ins.run('u1', 'k1', D0 - 1000, 200, 0, 99); // вчерашние сутки
  ins.run('u1', 'k2', D0 + 1000, 200, 0, 7);
  assert.deepEqual(usage.keyToday('k1', D0 + 5000), { requests: 2, credits: 55 }, 'до первой записи значение берётся из журнала, без записи');
  assert.equal(db.prepare('SELECT count(*) AS n FROM api_key_spend').get().n, 0);
  usage.spend('k1', 1, 40, D0 + 6000);
  assert.deepEqual(usage.keyToday('k1', D0 + 6000), { requests: 3, credits: 95 }, 'журнал (55) + новое списание (40), а не max');
  usage.spend('k1', 0, -15, D0 + 7000); // Ultra-возврат разницы
  assert.deepEqual(usage.keyToday('k1', D0 + 7000), { requests: 3, credits: 80 });
  assert.deepEqual(usage.keyToday('k1', D0 - 500), { requests: 1, credits: 99 }, 'вчерашние сутки: по журналу за вчера');
  usage.spend('k1', 1, 10, D0 - 500); // списание «вчерашним» моментом не трогает сегодняшний счётчик
  assert.deepEqual(usage.keyToday('k1', D0 - 500), { requests: 2, credits: 109 });
  assert.deepEqual(usage.keyToday('k1', D0 + 7000), { requests: 3, credits: 80 });
  assert.deepEqual(usage.keyToday('k2', D0 + DAY - 1), { requests: 1, credits: 7 });
});

test('API-10: через шлюз — 500 и 503 провайдера без идемпотентности не повторяются: один вызов, клиент получает 5xx с shouldRetry', { timeout: 60000 }, async (t) => {
  const g = await common(t), prov = g.prov;
  for (const code of [500, 503]) {
    prov.calls.length = 0; prov.handler = (req, res) => jsonBody(res, code, { error: { message: 'boom' } });
    const { out } = await g.run(async () => { const r = await g.v1('/v1/chat/completions', bodies.chat({ stream: false })); const j = await r.json(); return { r, j }; });
    assert.equal(prov.calls.length, 1, 'HTTP ' + code + ': ровно один вызов провайдера');
    assert.ok(out.r.status >= 500, 'клиент видит 5xx: ' + out.r.status); assert.equal(out.r.headers.get('x-should-retry'), 'true', 'решение о повторе — за клиентом');
  }
});

test('API-01: доплата Ultra считается по суткам списания: запрос через полночь по Москве не получает свежий лимит ключа', { timeout: 60000 }, async (t) => {
  const { DatabaseSync } = require('node:sqlite');
  const { createGateway } = require('../api/gateway');
  const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE users (id TEXT PRIMARY KEY)'); db.prepare('INSERT INTO users (id) VALUES (?)').run('dev');
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const usage = createUsage({ db }), errors = [], topUps = [];
  const T0 = usage.dayStart(Date.UTC(2026, 5, 10, 12)) + 86400000 - 10000, MIDNIGHT = T0 + 10000; // 23:59:50 по Москве
  const realNow = Date.now; let fake = T0; Date.now = () => fake; t.after(() => { Date.now = realNow; });
  const prov = await mkProvider(); t.after(() => prov.close());
  prov.handler = (req, res) => { fake = MIDNIGHT + 10000; chatHead(res); chatChunk(res, { role: 'assistant', content: 'ok' }); chatChunk(res, {}, 'stop'); res.write('data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 45000, completion_tokens: 2 } }) + '\n\n'); res.end('data: [DONE]\n\n'); }; // ответ приходит уже после полуночи
  const bill = {
    planOf: () => ({ id: 'pro', name: 'Pro' }), modelPlans: () => ['pro'], estimateTokens: () => 10, ultraCost: () => ({ total: 40 }), limitOf: () => 100, cfg: () => ({ plans: [] }), resetsAt: () => fake + 1000,
    charge: () => ({ ultra: true, credits: 40, weight: 0, ok: true }), refMsgTick() {}, ultraCfg: () => ({ maxOut: 1000 }), settle: () => ({ keep: 'all' }), MIN_TEXT: 1,
    ultraTopUp(u, ch, inTok, opts) { topUps.push(opts); return 0; },
  };
  const gw = createGateway({ store: { db, tx, users: { get: () => null } }, usage, bill, keys: { touch() {} }, monitor: { error: (...a) => errors.push(a), alert() {} }, clientIp: () => '127.0.0.1', origin: () => 'http://x',
    loadModels: () => [{ id: 'm1', slug: 'test-model', name: 'T', modelId: 'fake-1', baseUrl: prov.url + '/v1', apiKey: UPSTREAM_KEY, ultra: true, plans: ['pro'], weight: 1 }], loadSettings: () => ({}) });
  const user = { id: 'dev' }, key = { id: 'k1', ultra_cap: 100, allow_ultra: true };
  const srv = http.createServer((req, res) => { gw.generate({ req, res, proto: 'chat', body: { model: 'test-model', stream: false, messages: U }, user, key, client: 't', ip: '127.0.0.1', origin: 'http://x' }); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r)); t.after(() => srv.close());
  const r = await fetch('http://127.0.0.1:' + srv.address().port, { method: 'POST', body: '{}' });
  assert.equal(r.status, 200); await r.text();
  assert.deepEqual(errors, []); assert.equal(topUps.length, 1, 'доплата за контекст была запрошена');
  assert.equal(topUps[0].cap, 60, 'остаток — по суткам списания: ultra_cap 100 − уже списанные 40, а не полный лимит нового дня');
  assert.equal(usage.keyToday('k1', T0).credits, 40, 'расход записан на день списания');
  assert.equal(usage.keyToday('k1', MIDNIGHT + 10000).credits, 0, 'новые сутки пусты');
});

test('API-02: native — события провайдера не пересылаются целиком: ошибки собираются из допустимых полей, остальное — с вырезанием ключа и адресов по точному значению', { timeout: 120000 }, async (t) => {
  const g = await common(t), prov = g.prov;
  const INT = `${prov.url}/internal/`, dbg = (n) => ({ api_key: UPSTREAM_KEY, upstream_url: INT + n, nested: { deep: [{ url: INT + n + '/x', k: UPSTREAM_KEY }] } });
  const parse = (raw) => sse({ text: async () => raw });
  const leaked = (txt, what) => { for (const bad of [UPSTREAM_KEY, '127.0.0.1']) assert.equal(txt.includes(bad), false, `утечка «${bad}» (${what}):\n${txt.slice(0, 1500)}`); };
  const stream = async (kind) => { const r = await send(g, kind); assert.equal(r.status, 200); return r.text(); };

  /* ---- Anthropic Messages, поток ---- */
  // событие с ошибкой (тип не error, но есть объект error) и событие error с лишними полями: остаются тип и очищенный текст, остальное отброшено
  prov.handler = (req, res) => { aHead(res); aStart(res); aev(res, 'message_delta', { delta: {}, error: { type: 'overloaded_error', message: 'busy', debug: dbg('a1') }, debug: dbg('a2') }); res.end(); };
  let raw = await stream('nmessages'); leaked(raw, 'messages: error-объект в событии');
  assert.equal(/debug|internal|upstream_url/.test(raw), false, 'лишние поля ошибки отброшены, а не очищены: ' + raw);
  let ev = (await parse(raw)).filter((x) => x.event === 'error'); assert.equal(ev.length, 1); assert.deepEqual(Object.keys(ev[0].data).sort(), ['error', 'type']); assert.deepEqual(Object.keys(ev[0].data.error).sort(), ['message', 'type']);
  prov.handler = (req, res) => { aHead(res); aStart(res); aev(res, 'error', { error: { type: 'api_error', message: 'oops', debug: dbg('a3') }, debug: dbg('a4') }); res.end(); };
  raw = await stream('nmessages'); leaked(raw, 'messages: error'); assert.equal(/debug|internal/.test(raw), false);
  // обычные и неизвестные события: поля клиента на месте, ключ и адреса вырезаны из строк на любой глубине; имя SSE-события — только [a-z_.]
  prov.handler = (req, res) => {
    aHead(res);
    aev(res, 'message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'fake-claude', content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 1 }, meta: dbg('b1') }, debug: dbg('b2'), keep: 'yes' });
    res.write(`event: bad name!\ndata: ${JSON.stringify({ type: 'vendor_ping', info: dbg('b3') })}\n\n`);
    res.write(`event: vendor_unknown\ndata: ${JSON.stringify({ type: 'vendor_unknown', blob: [{ a: { b: { c: 'see ' + INT + 'b4 key ' + UPSTREAM_KEY } } }] })}\n\n`);
    aText(res, 'hello'); aEnd(res); res.end();
  };
  raw = await stream('nmessages'); leaked(raw, 'messages: обычные события');
  let all = await parse(raw); assert.ok(all.some((x) => x.event === 'content_block_delta' && x.data.delta.text === 'hello'), 'текст клиента доходит');
  assert.ok(all.some((x) => x.event === 'message_start' && x.data.keep === 'yes' && x.data.message.model === 'native-claude'), 'поля обычного события не отбрасываются');
  assert.ok(raw.includes('[redacted]/internal/b1'), 'вырезано по точному значению (адрес провайдера), хвост пути остался');
  assert.ok(all.some((x) => x.event === 'vendor_ping') && !all.some((x) => /bad name/.test(x.event)), 'недопустимое имя события заменено на type');
  assert.ok(all.some((x) => x.event === 'vendor_unknown'), 'неизвестное событие проходит очищенным');

  /* ---- Anthropic Messages, без потока ---- */
  prov.handler = (req, res) => jsonBody(res, 200, { id: 'm', type: 'message', role: 'assistant', model: 'fake-claude', content: [{ type: 'text', text: 'hello ' + INT + 'n1' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 1 }, debug: dbg('n2') });
  let r = await g.v1('/v1/messages', bodies.nmessages({ stream: false })); raw = await r.text(); assert.equal(r.status, 200); leaked(raw, 'messages: без потока'); assert.ok(raw.includes('hello [redacted]/internal/n1'));
  prov.handler = (req, res) => jsonBody(res, 200, { type: 'error', error: { type: 'api_error', message: 'bad', debug: dbg('n3') }, debug: dbg('n4') });
  r = await g.v1('/v1/messages', bodies.nmessages({ stream: false })); raw = await r.text(); assert.equal(r.status, 502); leaked(raw, 'messages: ошибка без потока'); assert.equal(/debug|internal/.test(raw), false);

  /* ---- OpenAI Responses, поток ---- */
  const failed = (extra = {}) => ({ response: { id: 'resp_9', object: 'response', created_at: 1700000000, status: 'failed', model: 'fake-resp', error: { code: 'server_error', message: 'broke', debug: dbg('r1') }, output: [msgItem('secret ' + UPSTREAM_KEY)], debug: dbg('r2'), incomplete_details: null, usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7, input_tokens_details: { cached_tokens: 1, note: INT + 'r3' }, internal: dbg('r4') } }, debug: dbg('r5'), sequence_number: 4, ...extra });
  prov.handler = (req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); rev(res, 'response.failed', failed()); res.end(); };
  raw = await stream('nresponses'); leaked(raw, 'responses: response.failed'); assert.equal(/debug|internal|secret/.test(raw), false, 'response.failed собран заново: ' + raw);
  ev = (await parse(raw)).filter((x) => x.event === 'response.failed'); assert.equal(ev.length, 1); const f = ev[0].data;
  assert.deepEqual(Object.keys(f).sort(), ['response', 'sequence_number', 'type']); assert.equal(f.sequence_number, 4);
  assert.deepEqual(Object.keys(f.response).sort(), ['created_at', 'error', 'id', 'incomplete_details', 'model', 'object', 'status', 'usage']);
  assert.equal(f.response.model, 'native-responses'); assert.equal(f.response.status, 'failed'); assert.deepEqual(Object.keys(f.response.error).sort(), ['code', 'message']);
  assert.deepEqual(f.response.usage, { input_tokens: 5, output_tokens: 2, total_tokens: 7, input_tokens_details: { cached_tokens: 1 } }); assert.equal(f.response.output, undefined);
  // response.completed, но с response.error; и событие с error-объектом
  prov.handler = (req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); rev(res, 'response.completed', failed({ response: { ...failed().response, status: 'completed' } })); res.end(); };
  raw = await stream('nresponses'); leaked(raw, 'responses: response.error в completed'); assert.equal(/debug|internal|secret/.test(raw), false);
  prov.handler = (req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); rev(res, 'response.output_text.delta', { delta: 'x', error: { code: 'server_error', message: 'm', debug: dbg('r6') }, debug: dbg('r7') }); res.end(); };
  raw = await stream('nresponses'); leaked(raw, 'responses: событие с error'); assert.equal(/debug|internal/.test(raw), false);
  // обычные и неизвестные события
  prov.handler = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    rev(res, 'response.created', { response: { id: 'resp_1', status: 'in_progress', debug: dbg('s1'), meta: [dbg('s2')] }, debug: dbg('s3'), keep: 'yes' });
    res.write(`event: no way\ndata: ${JSON.stringify({ type: 'response.vendor.thing', info: dbg('s4') })}\n\n`);
    rev(res, 'response.vendor.other', { payload: { url: INT + 's5', k: UPSTREAM_KEY } });
    rev(res, 'response.output_text.delta', { delta: 'hello' }); rev(res, 'response.output_item.done', { item: msgItem('hello') });
    rDone(res, { debug: dbg('s6') }); res.end();
  };
  raw = await stream('nresponses'); leaked(raw, 'responses: обычные события'); all = await parse(raw);
  assert.ok(all.some((x) => x.event === 'response.output_text.delta' && x.data.delta === 'hello')); assert.ok(all.some((x) => x.event === 'response.created' && x.data.keep === 'yes'), 'поля обычного события не отбрасываются');
  assert.ok(raw.includes('[redacted]/internal/s1'), 'вырезано по точному значению'); assert.ok(all.some((x) => x.event === 'response.vendor.thing') && !all.some((x) => /no way/.test(x.event)), 'недопустимое имя события заменено на type');
  assert.ok(all.some((x) => x.event === 'response.vendor.other'));

  /* ---- Responses, без потока ---- */
  prov.handler = (req, res) => jsonBody(res, 200, { id: 'resp_1', object: 'response', status: 'completed', model: 'fake-resp', output: [msgItem('hi ' + INT + 'w1')], usage: { input_tokens: 5, output_tokens: 1 }, debug: dbg('w2') });
  r = await g.v1('/v1/responses', bodies.nresponses({ stream: false })); raw = await r.text(); assert.equal(r.status, 200); leaked(raw, 'responses: без потока'); assert.ok(raw.includes('hi [redacted]/internal/w1'));
  prov.handler = (req, res) => jsonBody(res, 200, { id: 'resp_1', object: 'response', status: 'failed', error: { code: 'server_error', message: 'bad', debug: dbg('w3') }, output: [], debug: dbg('w4') });
  r = await g.v1('/v1/responses', bodies.nresponses({ stream: false })); raw = await r.text(); assert.equal(r.status, 502); leaked(raw, 'responses: ошибка без потока'); assert.equal(/debug|internal/.test(raw), false);
});

test('API-05: ответ в SSE занимает место в бюджете памяти: потоки в пределах бюджета не обрываются, рост сверх бюджета получает ошибку, новые большие тела — отказ', { timeout: 120000 }, async (t) => {
  const prov = await mkProvider(); t.after(prov.close);
  // бюджет 2 МБ; вне бюджета каждому запросу — 64 КБ ответа (по умолчанию 1 МБ)
  const g = await boot(t, { prov, env: { API_BODY_MB: '1', API_BODY_INFLIGHT_MB: '2', API_BODY_INFLIGHT_USER_MB: '2', API_RESPONSE_FREE_KB: '64' } });
  const bobKey = await g.mkKey('bob'); prov.calls.length = 0; // при старте сервер сам делает один пробный вызов провайдера
  const CH = 200000, N = 3; let releaseHeld; const held = new Promise((r) => { releaseHeld = r; });
  prov.handler = async (req, res, call) => {
    if (!/^s\d$/.test(String(call.body.messages[0].content))) return defaults(req, res, call);
    chatHead(res); for (let i = 0; i < N; i++) chatChunk(res, i ? { content: 'x'.repeat(CH) } : { role: 'assistant', content: 'x'.repeat(CH) });
    await held; if (res.destroyed) return;
    chatChunk(res, {}, 'stop'); chatUsage(res); res.end('data: [DONE]\n\n');
  };
  // читатель потока: копит текст и считает байты; получив весь текст — значит, шлюз уже принял его в память (учёт идёт до отправки клиенту)
  const reader = (r) => { const rd = r.body.getReader(), dec = new TextDecoder(); const o = { text: '', bytes: 0, rd, async upTo(n) { while (o.bytes < n) { const x = await rd.read(); if (x.done) return; o.bytes += x.value.length; o.text += dec.decode(x.value, { stream: true }); } }, async rest() { await o.upTo(Infinity); } }; return o; };
  const open = async (i, key) => { const r = await g.v1('/v1/chat/completions', bodies.chat({ messages: [{ role: 'user', content: 's' + i }] }), {}, key); assert.equal(r.status, 200); return reader(r); };
  // три потока по 0,6 МБ текста: в учёте по 0,6 МБ минус 64 КБ, вместе около 1,6 МБ — меньше бюджета
  const streams = await Promise.all([0, 1, 2].map((i) => open(i)));
  await Promise.all(streams.map((s) => s.upTo(N * CH)));
  assert.equal(prov.calls.length, 3);
  const bigBody = () => bodies.chat({ stream: false, messages: [{ role: 'user', content: 'a'.repeat(900000) }] });
  let r = await g.v1('/v1/chat/completions', bigBody()); let j = await r.json();
  assert.equal(r.status, 429, 'тот же пользователь: три потока уже держат место (тела малы)'); assert.match(j.error.message, /at once from your account/);
  r = await g.v1('/v1/chat/completions', bigBody(), {}, bobKey); j = await r.json();
  assert.equal(r.status, 503, 'другой пользователь: общий потолок байт'); assert.equal(j.error.code, 'overloaded');
  assert.equal(prov.calls.length, 3, 'отказанные запросы до провайдера не дошли');
  // четвёртый поток (другой пользователь) растёт сверх бюджета — получает ошибку, а не занимает память сверх предела; маленький ответ рядом проходит
  const over = await open(3, bobKey); await over.rest();
  assert.match(over.text, /no memory left for this response/, 'рост сверх бюджета — ошибка в потоке'); assert.doesNotMatch(over.text, /\[DONE\]/);
  assert.ok(over.text.length < N * CH, 'поток сверх бюджета остановлен до конца ответа');
  r = await g.v1('/v1/chat/completions', bodies.chat({ stream: false }), {}, bobKey); assert.equal(r.status, 200, 'обычный ответ помещается в свою долю вне бюджета'); await r.text();
  // клиент бросил один поток — его место освобождается, остальные не обрываются
  await streams[0].rd.cancel().catch(() => {});
  releaseHeld();
  for (const s of streams.slice(1)) {
    await s.rest(); const chunks = s.text.split('\n\n').filter((b) => b.startsWith('data: {')).map((b) => JSON.parse(b.slice(6)));
    assert.equal(chunks.reduce((n, c) => n + (c.choices && c.choices[0] && c.choices[0].delta && c.choices[0].delta.content ? c.choices[0].delta.content.length : 0), 0), N * CH, 'поток в пределах бюджета не обрезан: весь текст дошёл');
    assert.match(s.text, /"finish_reason":"stop"/); assert.match(s.text, /\[DONE\]/);
  }
  // после завершения всех потоков (в том числе брошенного и остановленного) место свободно: большое тело проходит
  let code = 0; for (let i = 0; i < 60; i++) { r = await g.v1('/v1/chat/completions', bigBody()); code = r.status; await r.text(); if (code === 200) break; await delay(100); }
  assert.equal(code, 200, 'резерв завершённых, брошенного и остановленного потоков освобождён');
  assert.equal(g.alive(), true);
});
