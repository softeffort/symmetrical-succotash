'use strict';
// Поток и обращения к провайдеру (api/upstream.js, util.js, output.js, convert.js): node --test tests/api-stream.test.js
// Часть проверок — прямо над модулями (поддельный провайдер в этом же процессе), часть — через настоящий сервер (/v1 → поддельный провайдер).
// Таймауты занижены переменными окружения ДО загрузки api/upstream.js.
process.env.MODEL_TIMEOUT = '1';
process.env.MODEL_IDLE_TIMEOUT = '1';
process.env.API_GLOBAL_CONCURRENCY = '3';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const bytes = (parts) => Readable.from((function* () { for (const x of parts) yield Buffer.from(x); })());
const { spawn } = require('node:child_process');
const { createFakeProvider } = require('./fixtures/fake-provider');
const up = require('../api/upstream');
const util = require('../api/util');
const conv = require('../api/convert');
const { MessagesOut, ResponsesOut, ChatOut } = require('../api/output');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const mskDay = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const TMP = '/var/tmp';

// Свой провайдер: handler(req, res) вызывается на каждый запрос
async function rawProvider(handler) {
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => handler(req, res)); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { url: 'http://127.0.0.1:' + srv.address().port, close: () => new Promise((r) => { srv.closeAllConnections(); srv.close(r); }) };
}
const sseHead = (res) => res.writeHead(200, { 'Content-Type': 'text/event-stream' });
const chunk = (res, delta, finish = null) => res.write('data: ' + JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n');
const mdl = (url, id = 'fake-1') => ({ id: 'm', modelId: id, baseUrl: url + '/v1', apiKey: 'sk-fake-upstream-key' });
const USER = { messages: [{ role: 'user', content: 'hi' }], stream: true };
const rej = async (p) => { try { await p; } catch (e) { return e; } assert.fail('expected a rejection'); };

/* ---------- 1. 429/5xx с «token limit» — не переполнение контекста ---------- */
test('upstreamError: «token limit» и «exceeds the maximum» у 429/5xx — не context_length_exceeded', () => {
  for (const text of ['{"error":{"message":"Rate limit: token limit per minute exceeded"}}', 'exceeds the maximum number of requests', 'context window busy']) {
    assert.equal(up.upstreamError(429, text).kind, 'rate_limit');
    assert.equal(up.upstreamError(500, text).kind, 'overloaded');
    assert.equal(up.upstreamError(503, text).kind, 'overloaded');
    assert.equal(up.upstreamError(502, text).kind, 'overloaded');
  }
  // а у 400/413/422 — по-прежнему контекст
  assert.equal(up.upstreamError(400, '{"error":{"message":"token limit exceeded"}}').kind, 'context');
  assert.equal(up.upstreamError(413, 'prompt is too long').kind, 'context');
  assert.equal(up.upstreamError(422, 'maximum context length is 8192 tokens').kind, 'context');
  // код context_length_exceeded — при любом статусе
  assert.equal(up.upstreamError(429, '{"error":{"code":"context_length_exceeded","message":"x"}}').kind, 'context');
});

test('поток: ошибка 429 с «token limit» посреди ответа — rate_limit, а не context', async (t) => {
  const p = await rawProvider((req, res) => { sseHead(res); chunk(res, { role: 'assistant', content: 'a' }); res.write('data: ' + JSON.stringify({ error: { code: 429, message: 'token limit per minute' } }) + '\n\n'); res.end(); });
  t.after(p.close);
  const u = await up.open(mdl(p.url), USER, {});
  const e = await rej(up.pump(u, {}));
  assert.equal(e.kind, 'rate_limit');
  const p2 = await rawProvider((req, res) => { sseHead(res); res.write('data: ' + JSON.stringify({ error: { code: 400, message: 'maximum context length exceeded' } }) + '\n\n'); res.end(); });
  t.after(p2.close);
  assert.equal((await rej(up.pump(await up.open(mdl(p2.url), USER, {}), {}))).kind, 'context');
});

test('шлюз: 429/503 провайдера с «token limit» отдаются как rate_limit/overloaded', { timeout: 60000 }, async (t) => {
  const g = await gateway(t);
  let r = await g.v1('/v1/chat/completions', { model: 'test-model', messages: [{ role: 'user', content: 'E429TOK' }] });
  assert.equal(r.status, 429); assert.notEqual((await r.json()).error.code, 'context_length_exceeded');
  r = await g.v1('/v1/chat/completions', { model: 'test-model', messages: [{ role: 'user', content: 'E503TOK' }] });
  assert.equal(r.status, 503); assert.notEqual((await r.json()).error.code, 'context_length_exceeded');
});

/* ---------- 2. learnedCap ---------- */
test('learnedCap: цифры из id модели не учитываются, ключ — провайдер+модель, TTL и минимум 1024', () => {
  const body = { messages: [], max_tokens: 100000 };
  const m = mdl('http://prov-a.example', 'gpt-4o-2024-08-06'), key = up.capKey(m);
  up.learnedCap.clear();
  // 2024 из id модели — не лимит; числа нет совсем → вдвое, ограничение не снимается
  let nb = up.adapt(body, '{"error":{"message":"max_tokens is too large for gpt-4o-2024-08-06"}}', key, m.modelId);
  assert.equal(nb.max_tokens, 50000); assert.equal(up.capGet(key), 0, 'ничего не выучено');
  // понятная фраза с лимитом — выучиваем
  nb = up.adapt(body, 'max_tokens: 100000 > 16384, which is the maximum allowed number of output tokens for gpt-4o-2024-08-06', key, m.modelId);
  assert.equal(nb.max_tokens, 16384); assert.equal(up.capGet(key), 16384);
  // другой провайдер с той же моделью и другая модель — не затронуты
  assert.equal(up.capGet(up.capKey(mdl('http://prov-b.example', 'gpt-4o-2024-08-06'))), 0);
  assert.equal(up.capGet(up.capKey(mdl('http://prov-a.example', 'other'))), 0);
  // TTL: через час забывается
  assert.equal(up.capGet(key, Date.now() + 3600e3 - 1000), 16384);
  assert.equal(up.capGet(key, Date.now() + 3600e3 + 1000), 0); assert.equal(up.learnedCap.has(key), false);
  // меньше 1024 не учим и не применяем
  const k2 = up.capKey(mdl('http://prov-c.example', 'm'));
  nb = up.adapt({ messages: [], max_tokens: 5000 }, 'max_tokens must be at most 512', k2, 'm');
  assert.ok(nb.max_tokens >= 1024, 'не ниже 1024'); assert.equal(up.capGet(k2), 0);
  up.capSet(k2, 900); assert.equal(up.capGet(k2), 0);
  // без числа и с малым запросом — не удаляем max_tokens, а сдаёмся (null)
  assert.equal(up.adapt({ messages: [], max_tokens: 1500 }, 'max_tokens is invalid', k2, 'm'), null);
});

test('learnedCap: цифры вокруг id модели в тексте ошибки и число «до N» разбираются отдельно', () => {
  assert.deepEqual(up.capNumbers('model gpt-4o-2024-08-06 supports up to 8192 output tokens', 'gpt-4o-2024-08-06'), [8192]);
  assert.deepEqual(up.capNumbers('claude-3-5-sonnet-20241022: max_tokens must be <= 8,192', 'claude-3-5-sonnet-20241022'), [8192]);
  assert.deepEqual(up.capNumbers('request 2024 failed at 12:30', ''), []);
});

test('adapt: имя необязательного поля — только как поле, а не любое слово в тексте', () => {
  const b = { messages: [], user: 'u1', temperature: 0.5, seed: 1, stop: ['x'], parallel_tool_calls: true };
  assert.equal(up.adapt(b, 'Invalid value for \'messages[0].role\': expected user or assistant', 'k', 'm'), null, '«user» в тексте — не поле user');
  assert.equal(up.adapt(b, 'The stop_sequences value is invalid, see the reasoning docs and the seeded data', 'k', 'm'), null, 'stop_sequences ≠ stop');
  assert.ok(!('user' in up.adapt(b, "Unknown parameter: 'user'", 'k', 'm')));
  assert.ok(!('temperature' in up.adapt(b, 'Unsupported parameter: temperature is not supported with this model', 'k', 'm')));
  assert.ok(!('parallel_tool_calls' in up.adapt(b, 'Unrecognized request argument supplied: parallel_tool_calls', 'k', 'm')));
});

/* ---------- 4. keepalive-комментарии продлевают таймер тишины ---------- */
test('поток: комментарии «: keepalive» сбрасывают таймер тишины (тишина 1 с, ответ идёт 2.5 с)', { timeout: 20000 }, async (t) => {
  const p = await rawProvider(async (req, res) => {
    sseHead(res);
    const end = Date.now() + 2500;
    while (Date.now() < end && !res.destroyed) { res.write(': keepalive\n\n'); await delay(300); }
    chunk(res, { role: 'assistant', content: 'alive' }); chunk(res, {}, 'stop'); res.write('data: [DONE]\n\n'); res.end();
  });
  t.after(p.close);
  const r = await up.pump(await up.open(mdl(p.url), USER, {}), {});
  assert.equal(r.finish, 'stop'); assert.equal(r.incomplete, false);
});

test('поток: настоящая тишина дольше MODEL_IDLE_TIMEOUT обрывается по таймауту', { timeout: 20000 }, async (t) => {
  const p = await rawProvider((req, res) => { sseHead(res); chunk(res, { role: 'assistant', content: 'start' }); });
  t.after(p.close);
  const e = await rej(up.pump(await up.open(mdl(p.url), USER, {}), {}));
  assert.equal(e.kind, 'timeout'); assert.equal(e.status, 504);
});

test('readSse: onChunk вызывается на каждый кусок, в том числе на комментарии', async () => {
  let n = 0; const got = [];
  const src = bytes([': a\n\n', ': b\n\n', 'data: {"x":1}\n\n', ': c\n\n']);
  for await (const ev of util.readSse(src, null, () => n++)) got.push(ev.data);
  assert.equal(n, 4); assert.deepEqual(got, ['{"x":1}']);
});

/* ---------- 12. разбор SSE ---------- */
test('readSse: длинная строка без переводов — быстро, CRLF между кусками, потолок буфера', { timeout: 30000 }, async () => {
  const t0 = Date.now(), parts = ['data: '];
  for (let i = 0; i < 1500; i++) parts.push('x'.repeat(8192));
  parts.push('\n\n');
  const out = []; for await (const ev of util.readSse(bytes(parts))) out.push(ev);
  assert.equal(out.length, 1); assert.equal(out[0].data.length, 1500 * 8192);
  assert.ok(Date.now() - t0 < 5000, 'не квадратично: ' + (Date.now() - t0) + ' мс');
  // «\r» и «\n» в разных кусках — одна граница, а не две
  const evs = []; for await (const ev of util.readSse(bytes(['data: a\r', '\n\r', '\ndata: b\r\n\r\n']))) evs.push(ev.data);
  assert.deepEqual(evs, ['a', 'b']);
  // больше потолка 16 МБ — ошибка провайдера, а не рост памяти
  const big = (function* () { for (let i = 0; i < 20; i++) yield 'data: ' + 'y'.repeat(1048576); })();
  const e = await rej((async () => { for await (const ev of util.readSse(bytes(big))) void ev; })());
  assert.equal(e.kind, 'upstream');
});

/* ---------- 8. оборванный поток ---------- */
test('поток без finish_reason и [DONE]: текст / инструмент / размышления — incomplete (length), пусто — ошибка с повтором', async (t) => {
  const mode = { v: 'text' };
  const p = await rawProvider((req, res) => {
    sseHead(res);
    if (mode.v === 'text') chunk(res, { role: 'assistant', content: 'partial' });
    else if (mode.v === 'tool') chunk(res, { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'f', arguments: '{"a":' } }] });
    else if (mode.v === 'think') chunk(res, { reasoning_content: 'hmm' });
    res.end();
  });
  t.after(p.close);
  for (const v of ['text', 'tool', 'think']) {
    mode.v = v;
    const r = await up.pump(await up.open(mdl(p.url), USER, {}), {});
    assert.equal(r.finish, 'length', v); assert.equal(r.incomplete, true, v);
  }
  mode.v = 'none';
  const e = await rej(up.pump(await up.open(mdl(p.url), USER, {}), {}));
  assert.equal(e.kind, 'upstream'); assert.equal(e.shouldRetry, true);
});

test('Messages/Responses/Chat: оборванный ответ → max_tokens / incomplete / length', async () => {
  const m = new MessagesOut({ sse: null, model: 'x', thinking: true, inputEst: 1 });
  await m.on({ t: 'text', d: 'hi' });
  assert.equal((await m.finish({ finish: 'length', incomplete: true, usage: null })).body.stop_reason, 'max_tokens');
  const r = new ResponsesOut({ sse: null, model: 'x', req: {}, inputEst: 1 });
  await r.on({ t: 'text', d: 'hi' });
  const rb = (await r.finish({ finish: 'length', incomplete: true, usage: null })).body;
  assert.equal(rb.status, 'incomplete'); assert.equal(rb.incomplete_details.reason, 'max_output_tokens');
  const frames = [];
  const c = new ChatOut({ sse: { data: async (d) => frames.push(d) }, model: 'x', includeUsage: false, inputEst: 1 });
  await c.on({ t: 'text', d: 'hi' });
  await c.finish({ finish: 'length', incomplete: true, usage: null });
  assert.equal(frames[0].choices[0].finish_reason, 'length'); assert.equal(frames[1], '[DONE]');
});

/* ---------- 9. Chat stream: finish_reason tool_calls ---------- */
test('ChatOut.chunk: finish_reason «stop» при вызове инструмента становится «tool_calls»', async () => {
  const frames = [];
  const c = new ChatOut({ sse: { data: async (d) => frames.push(d) }, model: 'x', includeUsage: false, inputEst: 1 });
  await c.chunk({ choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }] });
  await c.chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  assert.equal(frames[1].choices[0].finish_reason, 'stop', 'без инструментов — как есть');
  await c.on({ t: 'tool', i: 0, id: 'c1', name: 'f' });
  await c.chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  assert.equal(frames[2].choices[0].finish_reason, 'tool_calls');
});

/* ---------- 14. stop_sequence ---------- */
test('Messages: стоп-последовательность — stop_reason «stop_sequence» и сама последовательность', async () => {
  const run = async (stops, extra) => { const m = new MessagesOut({ sse: null, model: 'x', thinking: false, inputEst: 1, stops }); await m.on({ t: 'text', d: 'a' }); return (await m.finish({ finish: 'stop', usage: null, ...extra })).body; };
  let b = await run(['END']); assert.equal(b.stop_reason, 'end_turn', 'провайдер не назвал совпадение — не угадываем'); assert.equal(b.stop_sequence, null);
  b = await run(['END'], { stop: 'END' }); assert.equal(b.stop_reason, 'stop_sequence'); assert.equal(b.stop_sequence, 'END');
  b = await run(['A', 'B'], { stop: 'B' }); assert.equal(b.stop_reason, 'stop_sequence'); assert.equal(b.stop_sequence, 'B');
  b = await run(['A', 'B']); assert.equal(b.stop_reason, 'end_turn'); assert.equal(b.stop_sequence, null);
  b = await run(undefined); assert.equal(b.stop_reason, 'end_turn');
  const m = new MessagesOut({ sse: null, model: 'x', thinking: false, inputEst: 1, stops: ['END'] });
  await m.on({ t: 'tool', i: 0, id: 't', name: 'f' });
  assert.equal((await m.finish({ finish: 'stop', usage: null })).body.stop_reason, 'tool_use', 'инструмент важнее');
});

/* ---------- 17. Responses: output_index монотонен ---------- */
test('Responses: output_item.added для custom/shell приходит при старте элемента, output_index не скачет', async () => {
  const ev = [];
  const r = new ResponsesOut({ sse: { event: async (name, data) => ev.push(data) }, model: 'x', req: {}, custom: new Set(['apply_patch']), shell: true, inputEst: 1 });
  await r.on({ t: 'text', d: 'hi' });
  await r.on({ t: 'tool', i: 0, id: 'c1', name: 'apply_patch' });
  await r.on({ t: 'tool', i: 1, id: 'c2', name: 'get_weather' }); // параллельный вызов, пока первый ещё открыт
  await r.on({ t: 'tool', i: 2, id: 'c3', name: 'local_shell' });
  await r.on({ t: 'args', i: 0, d: '{"input":"patch"}' });
  await r.on({ t: 'args', i: 2, d: '{"command":["ls"]}' });
  await r.finish({ finish: 'stop', usage: null });
  const added = ev.filter((e) => e.type === 'response.output_item.added').map((e) => e.output_index);
  assert.deepEqual(added, [0, 1, 2, 3], 'каждый элемент добавлен ровно один раз и по порядку');
  const done = ev.filter((e) => e.type === 'response.output_item.done');
  assert.equal(done.length, 4);
  const custom = done.find((e) => e.item.type === 'custom_tool_call'); assert.equal(custom.item.input, 'patch');
  assert.deepEqual(done.find((e) => e.item.type === 'local_shell_call').item.action.command, ['ls']);
});

/* ---------- P7. глубокая вложенность → 400 ---------- */
test('checkDepth и convert: слишком глубокий JSON — 400 invalid, без рекурсии и падений', () => {
  let s = 1; for (let i = 0; i < 100000; i++) s = [s];
  const e = (() => { try { util.checkDepth(s); } catch (x) { return x; } })();
  assert.equal(e.kind, 'invalid'); assert.equal(e.status, 400);
  util.checkDepth({ a: { b: [1, { c: 2 }] } }); // обычное — проходит
  let sch = { type: 'string' }; for (let i = 0; i < 20000; i++) sch = { type: 'object', properties: { a: sch } };
  for (const f of [() => conv.fromMessages({ model: 'x', max_tokens: 1, messages: [{ role: 'user', content: 'x' }], tools: [{ name: 'f', input_schema: sch }] }),
    () => conv.fromChat({ model: 'x', messages: [{ role: 'user', content: 'x', extra: s }] }),
    () => conv.fromResponses({ model: 'x', input: 'x', tools: [{ type: 'function', name: 'f', parameters: sch }] })]) {
    const x = (() => { try { f(); } catch (y) { return y; } })();
    assert.equal(x && x.kind, 'invalid');
  }
  // граница: 100 уровней можно, 101 — нельзя
  const nest = (n) => { let v = 1; for (let i = 0; i < n; i++) v = [v]; return v; };
  util.checkDepth(nest(99)); assert.throws(() => util.checkDepth(nest(101)));
});

test('open: JSON, который не сериализуется, — 400 без обращения к провайдеру и без повторов', async (t) => {
  let hits = 0;
  const p = await rawProvider((req, res) => { hits++; res.writeHead(200); res.end(); });
  t.after(p.close);
  const cyc = { messages: [], stream: true }; cyc.self = cyc;
  const t0 = Date.now();
  const e = await rej(up.open(mdl(p.url), cyc, {}));
  assert.equal(e.kind, 'invalid'); assert.equal(hits, 0); assert.ok(Date.now() - t0 < 1000, 'без паузы на повтор');
});

/* ---------- 6. провайдер: кончились деньги ---------- */
test('провайдер «out of credit»: оповещение админа, наружу — безопасное сообщение (чат и нативный путь)', async (t) => {
  const fake = createFakeProvider(), url = await fake.listen();
  t.after(() => fake.close());
  for (const native of [false, true]) {
    const alerts = [];
    const body = native ? { messages: [{ role: 'user', content: 'CREDIT' }], max_tokens: 5 } : { messages: [{ role: 'user', content: 'CREDIT' }], stream: true };
    const e = await rej(up.open(mdl(url), body, { native, url: native ? url + '/v1/messages' : undefined, onAlert: (m) => alerts.push(m) }));
    assert.equal(e.kind, 'upstream'); assert.equal(e.outOfCredit, true);
    assert.equal(alerts.length, 1, 'админ оповещён'); assert.match(alerts[0], /credit/i);
    assert.ok(!/billing\.provider|sk-ant|abcdefgh/.test(e.message), 'в сообщении клиенту нет адресов и ключей: ' + e.message);
  }
  // 429 insufficient_quota — тоже деньги; обычный 429 — нет
  const a = []; assert.equal(up.upstreamError(429, '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}', null, (m) => a.push(m)).kind, 'upstream'); assert.equal(a.length, 1);
  assert.equal(up.upstreamError(429, 'Too many requests', null, (m) => a.push(m)).kind, 'rate_limit'); assert.equal(a.length, 1);
  // тело ошибки нативного провайдера: только тип и сообщение, без адресов и ключей
  const raw = '{"type":"error","error":{"type":"invalid_request_error","message":"bad at https://x.example/a?k=1 with Bearer abcdefgh12345678 sk-ant-secret1234567"},"request_id":"req_1","internal":{"host":"10.0.0.5"}}';
  const sb = up.scrubBody(raw, 'messages');
  assert.deepEqual(Object.keys(sb), ['type', 'error']); assert.ok(!/x\.example|abcdefgh|sk-ant|10\.0\.0\.5|req_1/.test(JSON.stringify(sb)));
  const ob = up.scrubBody(raw, 'responses'); assert.ok(ob.error.message && !/x\.example|sk-ant/.test(JSON.stringify(ob)));
});

/* ---------- 10. клиент не читает ---------- */
test('sseStream: клиент не читает — через writeTimeoutMs соединение рвётся, пинги не копят слушателей', { timeout: 30000 }, async (t) => {
  const sseStream = util.sseStream;
  let resolveClosed; const closed = new Promise((r) => { resolveClosed = r; });
  const state = { drains: -1 };
  const srv = http.createServer((req, res) => {
    const s = sseStream(res, { writeTimeoutMs: 400, keepaliveMs: 50 });
    res.on('close', resolveClosed);
    (async () => {
      const big = 'x'.repeat(65536);
      for (let i = 0; i < 4000 && !res.destroyed; i++) { await s.raw(big); }
    })();
    setTimeout(() => { state.drains = res.listenerCount('drain'); }, 250);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => { srv.closeAllConnections(); srv.close(); });
  const sock = net.connect(srv.address().port, '127.0.0.1');
  sock.write('GET / HTTP/1.1\r\nHost: x\r\n\r\n');
  sock.pause(); // не читаем
  t.after(() => sock.destroy());
  const t0 = Date.now();
  await Promise.race([closed, delay(15000).then(() => assert.fail('соединение не оборвано'))]);
  assert.ok(Date.now() - t0 < 10000);
  assert.ok(state.drains <= 1, 'один слушатель drain, а не по одному на пинг: ' + state.drains);
});

/* ---------- 18. общий потолок параллельных обращений к провайдеру ---------- */
test('общий потолок API_GLOBAL_CONCURRENCY: сверх него — 503 overloaded с Retry-After, после освобождения снова можно', async (t) => {
  const p = await rawProvider((req, res) => { sseHead(res); chunk(res, { content: 'x' }); }); // держим соединение
  t.after(p.close);
  const held = [];
  for (let i = 0; i < 3; i++) held.push(await up.open(mdl(p.url), USER, {}));
  const e = await rej(up.open(mdl(p.url), USER, {}));
  assert.equal(e.kind, 'overloaded'); assert.equal(e.status, 503); assert.ok(e.retryAfter >= 1);
  held[0].done(); held[0].done(); // повторный done не освобождает лишнее
  const again = await up.open(mdl(p.url), USER, {});
  const e2 = await rej(up.open(mdl(p.url), USER, {}));
  assert.equal(e2.kind, 'overloaded');
  for (const h of [...held.slice(1), again]) { h.ac.abort(); h.done(); }
});

/* ---------- через настоящий сервер ---------- */
test.after(async () => { if (gateway.cache) await gateway.cache.stop(); }); // сервер общий для проверок ниже
async function gateway(t) {
  if (gateway.cache) return gateway.cache;
  const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(TMP, 'premier-apistream-'));
  const fake = createFakeProvider(), fakeUrl = await fake.listen();
  let child, store, logs = '';
  fs.cpSync(root, dir, { recursive: true, filter: (src) => {
    const rel = path.relative(root, src), top = rel.split(path.sep)[0];
    return !rel || ['public', 'locales', 'desktop', 'api', 'admin'].includes(top) || (!rel.includes(path.sep) && !top.startsWith('.') && /\.(js|json)$/.test(top));
  } });
  store = require(path.join(dir, 'db.js'));
  store.users.put({ id: 'dev', login: 'dev', email: 'dev@example.invalid', plan: 'pro', until: Date.now() + 864e5, created: new Date().toISOString() });
  const token = crypto.randomBytes(32).toString('hex'); store.sessions.put(sha(token), 'dev', Date.now() + 3600e3);
  const prov = { baseUrl: fakeUrl + '/v1', apiKey: 'sk-fake-upstream-key' };
  store.kv.set('models', [
    { id: 'm1', name: 'Test Model', modelId: 'fake-1', ...prov, vision: false, plans: ['free', 'pro', 'max'], weight: 1 },
    { id: 'm3', name: 'Native Claude', modelId: 'fake-claude', ...prov, nativeUrl: fakeUrl, native: 'anthropic', plans: ['free', 'pro', 'max'], weight: 1 },
  ]);
  store.kv.set('settings', { defaultModel: 'm1' });
  const reservation = net.createServer(); await new Promise((r) => reservation.listen(0, '127.0.0.1', r));
  const port = reservation.address().port; await new Promise((r) => reservation.close(r));
  const base = 'http://127.0.0.1:' + port;
  child = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ADMIN_PASSWORD: crypto.randomBytes(24).toString('base64url'), PUBLIC_URL: base, API_BASE_URL: base, TRUST_PROXY: '1', CODE_RUNNER: 'off', API_RPM: '1000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (b) => { logs += b; }); child.stderr.on('data', (b) => { logs += b; });
  for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error('server did not start: ' + logs); try { if ((await fetch(base + '/healthz')).ok) break; } catch {} await delay(100); }
  const k = await fetch(base + '/api/dev/keys', { method: 'POST', headers: { Cookie: 'premier_session=' + token, 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ name: 'stream' }) });
  const key = (await k.json()).key;
  const g = {
    base, fake, logs: () => logs, alive: () => child.exitCode === null,
    v1: (p, body, headers = {}) => fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }),
    logsApi: async () => (await (await fetch(base + '/api/dev/logs', { headers: { Cookie: 'premier_session=' + token, Origin: base } })).json()).items,
  };
  g.stop = async () => {
    if (child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([new Promise((r) => child.once('exit', r)), delay(6000)]); if (child.exitCode === null) child.kill('SIGKILL'); }
    store.db.close(); await fake.close(); fs.rmSync(dir, { recursive: true, force: true });
  };
  gateway.cache = g;
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

test('шлюз: chat stream с инструментом — финальный finish_reason «tool_calls», даже если провайдер написал «stop»', { timeout: 60000 }, async (t) => {
  const g = await gateway(t);
  const ev = await sse(await g.v1('/v1/chat/completions', { model: 'test-model', stream: true, messages: [{ role: 'user', content: 'TOOL weather' }], tools: [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object' } } }] }));
  const fins = ev.filter((e) => e.data !== '[DONE]' && e.data.choices && e.data.choices[0] && e.data.choices[0].finish_reason).map((e) => e.data.choices[0].finish_reason);
  assert.deepEqual(fins, ['tool_calls']);
  // без инструментов остаётся «stop»
  const ev2 = await sse(await g.v1('/v1/chat/completions', { model: 'test-model', stream: true, messages: [{ role: 'user', content: 'HELLO' }] }));
  assert.deepEqual(ev2.filter((e) => e.data !== '[DONE]' && e.data.choices && e.data.choices[0] && e.data.choices[0].finish_reason).map((e) => e.data.choices[0].finish_reason), ['stop']);
});

test('шлюз: оборванный провайдером поток — length / max_tokens / incomplete и пометка в журнале', { timeout: 60000 }, async (t) => {
  const g = await gateway(t);
  // chat: stream
  let ev = await sse(await g.v1('/v1/chat/completions', { model: 'test-model', stream: true, messages: [{ role: 'user', content: 'TRUNC please' }] }));
  const fins = ev.filter((e) => e.data !== '[DONE]' && e.data.choices && e.data.choices[0] && e.data.choices[0].finish_reason).map((e) => e.data.choices[0].finish_reason);
  assert.deepEqual(fins, ['length']); assert.equal(ev[ev.length - 1].data, '[DONE]');
  // chat: без потока
  let j = await (await g.v1('/v1/chat/completions', { model: 'test-model', messages: [{ role: 'user', content: 'TRUNC please' }] })).json();
  assert.equal(j.choices[0].finish_reason, 'length'); assert.equal(j.choices[0].message.content, 'cut short');
  // Anthropic: только вызов инструмента и только размышления
  ev = await sse(await g.v1('/v1/messages', { model: 'test-model', max_tokens: 50, stream: true, messages: [{ role: 'user', content: 'TRUNCT go' }], tools: [{ name: 'get_weather', input_schema: { type: 'object' } }] }));
  assert.equal(ev.find((e) => e.event === 'message_delta').data.delta.stop_reason, 'max_tokens'); assert.ok(!ev.some((e) => e.event === 'error'));
  ev = await sse(await g.v1('/v1/messages', { model: 'test-model', max_tokens: 50, stream: true, thinking: { type: 'enabled', budget_tokens: 1024 }, messages: [{ role: 'user', content: 'TRUNCK go' }] }));
  assert.equal(ev.find((e) => e.event === 'message_delta').data.delta.stop_reason, 'max_tokens'); assert.ok(!ev.some((e) => e.event === 'error'));
  // Responses
  ev = await sse(await g.v1('/v1/responses', { model: 'test-model', stream: true, input: 'TRUNC please' }));
  assert.ok(ev.some((e) => e.event === 'response.incomplete'), 'response.incomplete'); assert.ok(!ev.some((e) => e.event === 'response.failed'));
  // журнал помечает как неполные
  await delay(200);
  assert.ok((await g.logsApi()).some((x) => /incomplete/.test(x.err || '')), 'запись об обрыве в журнале');
});

test('шлюз: stop_sequences — stop_reason «stop_sequence»', { timeout: 60000 }, async (t) => {
  const g = await gateway(t);
  let j = await (await g.v1('/v1/messages', { model: 'test-model', max_tokens: 50, stop_sequences: ['END'], messages: [{ role: 'user', content: 'HELLO' }] })).json();
  assert.equal(j.stop_reason, 'end_turn', 'провайдер совпадения не подтвердил'); assert.equal(j.stop_sequence, null);
  j = await (await g.v1('/v1/messages', { model: 'test-model', max_tokens: 50, stop_sequences: ['A', 'B'], messages: [{ role: 'user', content: 'MATCHED' }] })).json();
  assert.equal(j.stop_reason, 'stop_sequence'); assert.equal(j.stop_sequence, 'B');
  j = await (await g.v1('/v1/messages', { model: 'test-model', max_tokens: 50, messages: [{ role: 'user', content: 'HELLO' }] })).json();
  assert.equal(j.stop_reason, 'end_turn'); assert.equal(j.stop_sequence, null);
  const ev = await sse(await g.v1('/v1/messages', { model: 'test-model', max_tokens: 50, stream: true, stop_sequences: ['END'], messages: [{ role: 'user', content: 'HELLO' }] }));
  const d = ev.find((e) => e.event === 'message_delta').data.delta; assert.equal(d.stop_reason, 'end_turn'); assert.equal(d.stop_sequence, null);
});

test('шлюз: слишком глубокий JSON — 400 (а не повторы и 503/500), сервер жив, провайдер не тронут', { timeout: 60000 }, async (t) => {
  const g = await gateway(t);
  const before = g.fake.calls.length;
  let s = '1'; for (let i = 0; i < 5000; i++) s = '[' + s + ']';
  let sch = '{"type":"string"}'; for (let i = 0; i < 5000; i++) sch = '{"type":"object","properties":{"a":' + sch + '}}';
  const t0 = Date.now();
  let r = await g.v1('/v1/chat/completions', `{"model":"test-model","messages":[{"role":"user","content":"HELLO","x":${s}}]}`);
  assert.equal(r.status, 400); assert.match((await r.json()).error.message, /nested too deeply/);
  r = await g.v1('/v1/messages', `{"model":"test-model","max_tokens":10,"tools":[{"name":"f","input_schema":${sch}}],"messages":[{"role":"user","content":"HELLO"}]}`);
  assert.equal(r.status, 400); assert.equal((await r.json()).type, 'error');
  r = await g.v1('/v1/chat/completions', `{"model":"test-model","tools":[{"type":"function","function":{"name":"f","parameters":${sch}}}],"messages":[{"role":"user","content":"HELLO"}]}`);
  assert.equal(r.status, 400);
  assert.ok(Date.now() - t0 < 5000, 'быстро, без повторов');
  assert.equal(g.fake.calls.length, before, 'провайдер не вызывался');
  assert.ok(g.alive()); assert.ok(!/RangeError|Maximum call stack/.test(g.logs()), 'нет падений рекурсии в логе');
  r = await g.v1('/v1/chat/completions', { model: 'test-model', messages: [{ role: 'user', content: 'HELLO' }] });
  assert.equal(r.status, 200);
});

test('шлюз: у провайдера кончились деньги — клиент получает 502 без сырого текста провайдера (чат и нативный Anthropic)', { timeout: 60000 }, async (t) => {
  const g = await gateway(t);
  for (const [model, p, body] of [['test-model', '/v1/chat/completions', { messages: [{ role: 'user', content: 'CREDIT' }] }], ['native-claude', '/v1/messages', { max_tokens: 10, messages: [{ role: 'user', content: 'CREDIT' }] }]]) {
    const r = await g.v1(p, { model, ...body });
    const text = await r.text();
    assert.equal(r.status, 502, model); assert.match(text, /out of credit/);
    assert.ok(!/billing\.provider|sk-ant|abcdefgh|credit balance is too low/.test(text), 'без сырого текста: ' + text);
  }
});
