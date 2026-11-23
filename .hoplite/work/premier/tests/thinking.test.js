'use strict';
// Размышления модели в чате: форматы потока, поле запроса из настройки модели, повтор без поля, строка «Модель думает».
// node --test tests/thinking.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const reasoning = require('../reasoning');

const root = path.resolve(__dirname, '..');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

test('extract: размышления во всех распространённых форматах', () => {
  assert.equal(reasoning.extract({ reasoning_content: 'a' }), 'a');
  assert.equal(reasoning.extract({ reasoning: 'b' }), 'b');
  assert.equal(reasoning.extract({ reasoning_details: [{ type: 'reasoning.text', text: 'c' }, { type: 'reasoning.summary', summary: 'd' }, { type: 'reasoning.encrypted', data: 'x' }] }), 'cd');
  assert.equal(reasoning.extract({ thinking: 'e' }), 'e');
  assert.equal(reasoning.extract({ thinking: { content: 'f' } }), 'f');
  assert.equal(reasoning.extract({ content: [{ type: 'thinking', thinking: 'g' }, { type: 'text', text: 'нет' }] }), 'g');
  assert.equal(reasoning.extract({ content: 'обычный текст' }), '');
  assert.equal(reasoning.extract(null), '');
});

test('params: поле по настройке модели, бюджет меньше потолка ответа, отказ провайдера запоминается', () => {
  assert.deepEqual(reasoning.params({ id: 'a' }, 128000), {});
  assert.deepEqual(reasoning.params({ id: 'a', think: 'bogus' }, 128000), {});
  assert.deepEqual(reasoning.params({ id: 'a', think: 'effort' }, 128000), { reasoning_effort: 'medium' });
  assert.deepEqual(reasoning.params({ id: 'a', think: 'reasoning' }, 128000), { reasoning: { max_tokens: 8000 } });
  assert.deepEqual(reasoning.params({ id: 'a', think: 'thinking' }, 128000), { thinking: { type: 'enabled', budget_tokens: 8000 } });
  assert.deepEqual(reasoning.params({ id: 'a', think: 'thinking' }, 4000), { thinking: { type: 'enabled', budget_tokens: 2976 } });
  assert.deepEqual(reasoning.params({ id: 'a', think: 'thinking' }, 1500), {}); // на ответ ничего бы не осталось
  const m = { id: 'b', baseUrl: 'http://x/v1', modelId: 'claude', think: 'thinking' };
  reasoning.mark(m, Date.now());
  assert.deepEqual(reasoning.params(m, 128000), {});
  assert.equal(reasoning.unsupported(m, Date.now() + 3600001), false);
  assert.equal(reasoning.rejects(400, '{"error":{"message":"thinking: Extra inputs are not permitted"}}'), true);
  assert.equal(reasoning.rejects(400, 'context length exceeded'), false);
  assert.equal(reasoning.rejects(500, 'thinking unsupported'), false);
  assert.deepEqual(reasoning.strip({ a: 1, thinking: {}, reasoning: {}, reasoning_effort: 'x' }), { a: 1 });
});

test('клиент: одна живая строка «Модель думает», ответ на «think…» не прячется', () => {
  for (const [dir, word] of [['public/js/', 'Модель думала '], ['public/en/js/', 'The model thought for ']]) {
    const render = fs.readFileSync(path.join(root, dir, '04-render.js'), 'utf8');
    const chat = fs.readFileSync(path.join(root, dir, '05-chat.js'), 'utf8');
    assert.match(render, /waitLabel\(st, on\)/);
    assert.ok(render.includes(word));
    assert.match(render, /data-wfrom/);
    assert.match(chat, /o\.s === 'waiting' && o\.ms != null/);
    assert.ok(chat.includes("raw.match(/^\\s*<think>"), dir);
    assert.ok(chat.includes("'<think>'.startsWith"), dir);
  }
  const re = /^\s*<think>([\s\S]*?)(<\/think>\s*|$)/;
  assert.equal('think of it as a map'.match(re), null);
  assert.equal('<think>план</think>Ответ'.match(re)[1], 'план');
});

function provider() {
  const st = { bodies: [] };
  const srv = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch {}
      st.bodies.push(body);
      const last = (body.messages || []).slice(-1)[0] || {};
      const text = typeof last.content === 'string' ? last.content : (last.content || []).map((p) => p.text || '').join(' ');
      if (/REJECT/.test(text) && body.thinking) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'thinking: Extra inputs are not permitted' } })); }
      const go = () => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const send = (delta) => res.write('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\n');
        if (body.thinking) { send({ reasoning_details: [{ type: 'reasoning.text', text: 'Думаю ' }] }); send({ thinking: 'про ответ' }); }
        send({ content: 'Готово' });
        res.write('data: [DONE]\n\n'); res.end();
      };
      if (/SLOW/.test(text)) setTimeout(go, 3600); else go(); // SLOW — модель долго молчит перед ответом
    });
  });
  return { st, listen: () => new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok('http://127.0.0.1:' + srv.address().port))), close: () => new Promise((ok) => { srv.closeAllConnections?.(); srv.close(() => ok()); }) };
}

test('чат: поле thinking уходит провайдеру, размышления приходят клиенту, отказ провайдера — повтор без поля', { timeout: 60000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'premier-think-'));
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
  store.kv.set('models', [
    { id: 'm1', name: 'Thinker', modelId: 'claude-think', baseUrl: fakeUrl + '/v1', apiKey: 'sk-fake', plans: ['free', 'pro', 'max'], weight: 1, think: 'thinking' },
    { id: 'm2', name: 'Plain', modelId: 'plain', baseUrl: fakeUrl + '/v1', apiKey: 'sk-fake', plans: ['free', 'pro', 'max'], weight: 1 },
  ]);
  const port = await freePort(), base = 'http://127.0.0.1:' + port;
  let logs = '';
  child = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PUBLIC_URL: base, CODE_RUNNER: 'off', PROBE_MODELS: 'off', ADMIN_PASSWORD: crypto.randomBytes(24).toString('base64url') } });
  child.stdout.on('data', (d) => (logs += d)); child.stderr.on('data', (d) => (logs += d));
  for (let i = 0; i < 150; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch {} await delay(100); if (child.exitCode != null) throw new Error('сервер не запустился:\n' + logs); }
  const headers = { Cookie: 'premier_session=' + token, 'Content-Type': 'application/json', Origin: base };
  const chat = async (model, text) => {
    const r = await fetch(base + '/api/chat', { method: 'POST', headers, body: JSON.stringify({ model, messages: [{ role: 'user', content: text }] }) });
    assert.equal(r.status, 200);
    const lines = (await r.text()).split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
    return { text: lines.filter((x) => typeof x.t === 'string').map((x) => x.t).join(''), think: lines.filter((x) => x.r).map((x) => x.r).join(''), errors: lines.filter((x) => x.e), waits: lines.filter((x) => x.s === 'waiting') };
  };

  const a = await chat('m1', 'привет');
  assert.equal(a.text, 'Готово'); assert.equal(a.think, 'Думаю про ответ'); assert.deepEqual(a.errors, []);
  assert.equal(fake.st.bodies.at(-1).thinking.type, 'enabled');
  assert.ok(fake.st.bodies.at(-1).thinking.budget_tokens < fake.st.bodies.at(-1).max_tokens);

  const b = await chat('m2', 'привет');
  assert.equal(b.text, 'Готово'); assert.equal(b.think, '');
  assert.equal('thinking' in fake.st.bodies.at(-1), false);

  const n = fake.st.bodies.length;
  const c = await chat('m1', 'REJECT это');
  assert.equal(c.text, 'Готово'); assert.deepEqual(c.errors, []);
  assert.equal(fake.st.bodies.length, n + 2); // отказ + повтор без поля
  assert.equal('thinking' in fake.st.bodies.at(-1), false);
  await chat('m1', 'ещё');
  assert.equal('thinking' in fake.st.bodies.at(-1), false); // отказ запомнен — лишнего запроса нет

  // модель молчит дольше 3 с — клиент получает «Модель думает» сразу, а не через 15 с
  const d = await chat('m2', 'SLOW');
  assert.equal(d.text, 'Готово');
  assert.equal(d.waits.length, 1);
  assert.equal(d.waits[0].q, 'Модель думает');
  assert.ok(d.waits[0].ms >= 2900 && d.waits[0].ms < 3600, String(d.waits[0].ms));
});
