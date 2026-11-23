'use strict';
// Этап 2 «Квоты, списания и публичный API» — веб-чат целиком: настоящий server.js и поддельный поставщик моделей.
// Запуск: npm test (или node --test tests/stage2-chat.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const DAY = 864e5;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const mskDay = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await delay(40); } return false; };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SITE = 'Вот сайт:\n```html\n<!doctype html><html><head><title>Тест</title></head><body><h1>Привет</h1></body></html>\n```\n';
const LONG = 'Это длинный ответ модели. '.repeat(14); // больше 200 знаков — «заметная часть ответа» по политике списаний

// Поддельный поставщик: сценарий — по тексту последнего сообщения пользователя
function provider() {
  const st = { calls: 0, imgCalls: 0, open: 0, closed: 0, bodies: [], onCall: null, imgDelay: 400, gate: null };
  const srv = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch {}
      if (/\/images\/generations/.test(req.url)) {
        st.imgCalls++; await delay(st.imgDelay);
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ b64_json: PNG }] }));
      }
      const msgs = body.messages || [], lastUser = [...msgs].reverse().find((m) => m.role === 'user') || {};
      const text = typeof lastUser.content === 'string' ? lastUser.content : (lastUser.content || []).map((p) => p.text || '').join(' ');
      if (!body.stream) { // уточнение запроса на картинку (media.refine): текст ответа — массивом частей (BIZ-24)
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: [{ type: 'text', text: '{"prompt":"a red cat","aspect":"square","reply":"Кот готов."}' }] } }] }));
      }
      st.calls++; st.bodies.push(body); st.open++; res.on('close', () => { st.open--; st.closed++; });
      if (st.onCall) await st.onCall(body, text);
      const afterTool = msgs.some((m) => m.role === 'tool');
      if (/HANG/.test(text)) return; // ни заголовков, ни текста — пользователь нажимает «Стоп»
      if (/BUSY429/.test(text)) { res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' }); return res.end('{"error":{"message":"busy"}}'); } // поставщик просит подождать минуту
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
      const say = (c, finish = null) => send({ choices: [{ index: 0, delta: { content: c }, finish_reason: finish }] });
      const done = () => { res.write('data: [DONE]\n\n'); res.end(); };
      const call = (name, args) => { send({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] }); send({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }); done(); };
      if (afterTool) { say('Итог готов.'); return done(); }
      if (/CUTLONG/.test(text)) { say(LONG); return res.end(); }           // обрыв после заметной части ответа
      if (/CUT/.test(text)) { say('Начало'); return res.end(); }            // обрыв в самом начале: нет ни [DONE], ни finish_reason
      if (/FINISH/.test(text)) { say('Ответ'); say(' без DONE', 'stop'); return res.end(); } // finish_reason есть — ответ завершён
      if (/PARTS/.test(text)) { say([{ type: 'text', text: 'Части' }, { type: 'text', text: ' ответа' }]); return done(); }
      if (/SHBREAK/.test(text)) { for (const c of 'Команда:\n```\nls -la') say(c); return res.end(); } // обрыв внутри блока кода
      if (/SHELL/.test(text)) { for (const c of 'Команда:\n```\nls -la\n```\nГотово') say(c); return done(); } // блок кода без языка — не сайт
      // начало блока ```html без тегов страницы (сайт ли это — ещё не ясно), пауза до сигнала теста, потом теги сайта
      if (/SITEGATE/.test(text)) { say('Вот сайт:\n```html\n<style>h1{color:red}</style><h1>Раз</h1>'); await st.gate; say('<body><p>два</p></body>\n```\n'); return done(); }
      if (/SITEF/.test(text)) { for (const c of 'Проект:\n```css:style.css\nbody{color:red}\n```\n```html:index.html\n<div>x</div>\n```') say(c); return done(); } // проект из файлов
      if (/SITE1/.test(text)) { say(SITE); return done(); }                 // весь сайт одним событием потока
      if (/SITE3/.test(text)) { for (const c of SITE) say(c); return done(); } // по одному знаку
      if (/SITE/.test(text)) { for (let i = 0; i < SITE.length; i += 40) say(SITE.slice(i, i + 40)); return done(); }
      if (/FOLDER/.test(text)) return call('folder_write', { path: 'a.txt', content: 'привет' });
      if (/PYSLOW/.test(text)) return call('run_python', { code: 'import time\ntime.sleep(12)' }); // программа работает дольше, чем живёт сервер
      if (/PYTHON/.test(text)) return call('run_python', { code: 'print(2 + 2)' });
      if (/USAGE/.test(text)) { say('Ответ'); send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }); send({ choices: [], usage: { prompt_tokens: 45000, completion_tokens: 3 } }); return done(); }
      say('Привет'); say(', мир'); done();
    });
  });
  return { st, listen: () => new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok('http://127.0.0.1:' + srv.address().port))), close: () => new Promise((ok) => { srv.closeAllConnections?.(); srv.close(() => ok()); }) };
}

// o: env, user (поля пользователя u1), model (поля модели m1), settings(fakeUrl), used (счётчики суток до запуска), cfg (настройки тарифов)
async function boot(t, o = {}) {
  const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'premier-s2chat-'));
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
  if (o.cfg) { const bill = require(path.join(dir, 'billing.js')); bill.init({ loadSettings: () => ({}), saveSettings() {} }); bill.saveCfg(o.cfg); }
  store.users.put({ id: 'u1', login: 'u1', email: 'u1@example.invalid', plan: 'max', until: Date.now() + DAY, created: new Date().toISOString(), ...(o.user || {}) });
  const token = crypto.randomBytes(32).toString('hex'); store.sessions.put(sha(token), 'u1', Date.now() + 3600e3);
  store.kv.set('models', [{ id: 'm1', name: 'Fake', modelId: 'fake-1', baseUrl: fakeUrl + '/v1', apiKey: 'sk-fake-upstream-key', plans: ['free', 'pro', 'max', 'ultra'], weight: 1, ...(o.model || {}) }]);
  if (o.settings) store.kv.set('settings', o.settings(fakeUrl));
  if (o.used) store.kv.set('usage:' + mskDay(), { u1: { m: 0, c: 0, s: 0, i: 0, ...o.used } });
  const port = await freePort(), base = 'http://127.0.0.1:' + port;
  let logs = '';
  child = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PUBLIC_URL: base, CODE_RUNNER: 'off', PROBE_MODELS: 'off', ADMIN_PASSWORD: crypto.randomBytes(24).toString('base64url'), ...(o.env || {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => (logs += d)); child.stderr.on('data', (d) => (logs += d));
  for (let i = 0; i < 150; i++) { try { if ((await fetch(base + '/healthz')).ok) break; } catch {} await delay(100); if (child.exitCode != null) throw new Error('сервер не запустился:\n' + logs); }
  const headers = { Cookie: 'premier_session=' + token, 'Content-Type': 'application/json', Origin: base };
  const api = async (p, body) => { const r = await fetch(base + p, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, json: await r.json().catch(() => null) }; };
  // onLine(строка) вызывается по мере прихода ответа — так тест отвечает на запрос действия в папке, как вкладка пользователя
  const chat = async (text, extra = {}, onLine) => {
    const r = await fetch(base + '/api/chat', { method: 'POST', headers, body: JSON.stringify({ model: 'm1', messages: [{ role: 'user', content: text }], ...extra }) });
    if (!r.ok) return { status: r.status, json: await r.json().catch(() => null) };
    const lines = []; let buf = ''; const dec = new TextDecoder();
    const take = async (l) => { if (!l.startsWith('{')) return; const j = JSON.parse(l); lines.push(j); if (onLine) await onLine(j); };
    for await (const chunk of r.body) { buf += dec.decode(chunk, { stream: true }); let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); await take(l); } }
    if (buf.trim()) await take(buf.trim());
    // {reset:true} — сервер просит вкладку выбросить показанный текст и принять новый
    let shown = ''; for (const x of lines) { if (x.reset) shown = ''; if (typeof x.t === 'string') shown += x.t; }
    return { status: r.status, text: shown, errors: lines.filter((x) => x.e).map((x) => x.e), imgs: lines.filter((x) => x.img), lines };
  };
  const used = async () => (await api('/api/billing')).json.used;
  // штатная остановка сервера (как systemctl restart): SIGTERM и ожидание выхода
  const stop = async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([new Promise((r) => child.once('exit', r)), delay(15000)]); } return child.exitCode; };
  return { base, dir, api, chat, used, fake, store, stop, logs: () => logs };
}

test('BIZ-08: два одновременных запроса на последнюю картинку — картинку получает один', { timeout: 90000 }, async (t) => {
  const { chat, used, fake } = await boot(t, { user: { plan: 'free', until: 0 }, used: { i: 2 }, // тариф free: 3 картинки в сутки, две уже использованы
    settings: (url) => ({ image: { on: true, mode: 'images', baseUrl: url + '/v1', modelId: 'img-1', apiKey: 'sk-img' } }) });
  const before = await used();
  const [a, b] = await Promise.all([chat('нарисуй рыжего кота'), chat('нарисуй рыжего кота')]);
  assert.equal(a.imgs.length + b.imgs.length, 1, 'картинка выдана ровно одна');
  assert.equal(fake.st.imgCalls, 1, 'модель картинок вызвана один раз');
  const after = await used();
  assert.equal(after.i, 3, 'лимит картинок не превышен');
  const win = a.imgs.length ? a : b;
  assert.equal(win.text, 'Кот готов.', 'подпись — из ответа модели, пришедшего массивом частей (BIZ-24)');
  assert.ok(after.m - before.m <= 2 && after.m - before.m >= 1);
  // лимит исчерпан: следующая просьба картинку не создаёт и лимит не трогает
  const c = await chat('нарисуй рыжего кота');
  assert.equal(c.imgs.length, 0); assert.equal(fake.st.imgCalls, 1); assert.equal((await used()).i, 3);
});

test('BIZ-14, BIZ-23: поток оборвался без [DONE] и finish_reason — ошибка в чате и расчёт по политике', { timeout: 90000 }, async (t) => {
  const { chat, used } = await boot(t);
  const m0 = (await used()).m;
  const cut = await chat('CUT');
  assert.equal(cut.errors.length, 1); assert.match(cut.errors[0], /оборвал поток/);
  assert.equal(cut.text, 'Начало', 'то, что успело прийти, остаётся на экране');
  assert.equal((await used()).m, m0, 'обрыв в начале ответа — сообщение возвращено');
  const long = await chat('CUTLONG');
  assert.equal(long.errors.length, 1); assert.match(long.errors[0], /оборвал поток/);
  assert.equal((await used()).m, m0 + 1, 'обрыв после заметной части ответа — сообщение остаётся списанным');
  const fin = await chat('FINISH');
  assert.deepEqual(fin.errors, [], 'finish_reason без [DONE] — нормальное завершение'); assert.equal(fin.text, 'Ответ без DONE');
  assert.equal((await used()).m, m0 + 2);
});

test('BIZ-14: STREAM_END_CHECK=off возвращает прежнее поведение для поставщика без признака завершения', { timeout: 90000 }, async (t) => {
  const { chat, used } = await boot(t, { env: { STREAM_END_CHECK: 'off' } });
  const r = await chat('CUT');
  assert.deepEqual(r.errors, []); assert.equal(r.text, 'Начало'); assert.equal((await used()).m, 1);
});

test('BIZ-24: текст ответа массивом частей доходит до пользователя', { timeout: 90000 }, async (t) => {
  const { chat, used } = await boot(t);
  const r = await chat('PARTS');
  assert.deepEqual(r.errors, []); assert.equal(r.text, 'Части ответа');
  assert.equal((await used()).m, 1);
});

test('BIZ-15: лимит сайтов проверяется до выдачи HTML — сверх лимита сайт не отдаётся', { timeout: 90000 }, async (t) => {
  const { chat, used } = await boot(t, { user: { plan: 'free', until: 0 }, used: { s: 2 } }); // тариф free: 3 сайта в сутки, два уже сделаны
  const ok = await chat('SITE');
  assert.deepEqual(ok.errors, []); assert.match(ok.text, /<h1>Привет<\/h1>/);
  let u = await used();
  assert.equal(u.s, 3, 'последний сайт занят'); assert.equal(u.m, 1);
  const over = await chat('SITE');
  assert.equal(over.errors.length, 1); assert.match(over.errors[0], /Лимит сайтов на сегодня исчерпан/);
  assert.doesNotMatch(over.text, /<html|<h1>|```/, 'HTML пользователю не выдан');
  assert.equal(over.text, 'Вот сайт:', 'текст до сайта остаётся');
  // проверяется всё, что сервер отправил, а не только итог на экране: HTML не должен уйти пользователю даже на миг
  const wire = (r) => r.lines.filter((x) => typeof x.t === 'string').map((x) => x.t).join('');
  assert.doesNotMatch(wire(over), /<!doctype|<html|<h1>|<body/i, 'HTML не отправлен ни в одном событии');
  for (const kind of ['SITE1', 'SITE3']) { // сайт целиком одним событием и по одному знаку
    const x = await chat(kind);
    assert.equal(x.errors.length, 1, kind); assert.match(x.errors[0], /Лимит сайтов на сегодня исчерпан/);
    assert.doesNotMatch(wire(x), /<!doctype|<html|<h1>|<body/i, kind + ': HTML не отправлен ни в одном событии');
    assert.equal(x.text, 'Вот сайт:', kind);
  }
  const files = await chat('SITEF'); // проект из файлов: сайт начинается с первого файла — он тоже не уходит пользователю
  assert.equal(files.errors.length, 1); assert.equal(files.text, 'Проект:');
  assert.doesNotMatch(wire(files), /color:red|<div>/, 'файлы проекта не отправлены ни в одном событии');
  u = await used();
  assert.equal(u.s, 3, 'лимит не превышен'); assert.equal(u.m, 1, 'сайт не выдан — сообщение возвращено');
  const plain = await chat('HELLO');
  assert.deepEqual(plain.errors, [], 'обычные ответы при исчерпанном лимите сайтов работают'); assert.equal(plain.text, 'Привет, мир');
  // блок кода без языка при исчерпанном лимите придерживается до решения «сайт или нет» — обычный код доходит целиком
  const sh = await chat('SHELL');
  assert.deepEqual(sh.errors, []); assert.equal(sh.text, 'Команда:\n```\nls -la\n```\nГотово', 'блок кода не потерян');
  const shCut = await chat('SHBREAK'); // поток оборвался, пока блок придерживался — полученный текст всё равно показан
  assert.equal(shCut.errors.length, 1); assert.equal(shCut.text, 'Команда:\n```\nls -la', 'придержанный текст выдан при обрыве');
  assert.equal((await used()).s, 3);
});

test('BIZ-35: раунд списывается по полям результата действия — отклонённое действие не оплачивается', { timeout: 90000 }, async (t) => {
  const { chat, used, api } = await boot(t);
  const folder = { name: 'proj', tree: 'a.txt' };
  const run = async (state, result) => {
    const before = (await used()).m; let asked = 0;
    const r = await chat('FOLDER', { folder }, async (j) => { if (j.fs) { asked++; assert.equal(j.fs.name, 'folder_write'); assert.equal((await api('/api/chat/tool', { cid: j.fs.cid, result, ...(state ? { state } : {}) })).status, 200); } });
    assert.equal(asked, 1, 'вкладка получила один запрос действия'); assert.deepEqual(r.errors, []); assert.equal(r.text, 'Итог готов.');
    return (await used()).m - before;
  };
  // текст результата у отклонённого действия нарочно «успешный», у выполненного — похож на отказ: списание от текста не зависит
  assert.equal(await run('no', 'Готово: a.txt создан.'), 1, 'пользователь отклонил действие — раунд не списан');
  assert.equal(await run('ok', 'Пользователь ОТКЛОНИЛ — так называется файл; он записан.'), 2, 'действие выполнено — раунд списан');
  assert.equal(await run('err', 'Ошибка: нет доступа к файлу'), 2, 'действие началось и завершилось ошибкой — раунд списан');
  assert.equal(await run(null, 'Готово: a.txt создан.'), 2, 'вкладка со старым кодом (без state) — как раньше, выполнено');
});

test('BIZ-10: возврат за «Стоп» до начала ответа в веб-чате ограничен тем же пределом, что и в API', { timeout: 120000 }, async (t) => {
  const { chat, used, api, fake } = await boot(t, { cfg: { burst: 0 }, user: { plan: 'pro', until: Date.now() + DAY } });
  const stop = async (i) => {
    const calls = fake.st.calls, closed = fake.st.closed, mid = 'stop' + i;
    const p = chat('HANG', { mid });
    assert.equal(await waitFor(() => fake.st.calls > calls), true, 'запрос дошёл до модели');
    assert.equal((await api('/api/chat/stop', { mid })).status, 200);
    await p; assert.equal(await waitFor(() => fake.st.closed > closed), true);
  };
  for (let i = 0; i < 20; i++) await stop(i);
  assert.equal((await used()).m, 0, 'первые 20 отмен без результата возвращены');
  await stop(20);
  assert.equal((await used()).m, 1, '21-я отмена за сутки остаётся списанной');
  await stop(21);
  assert.equal((await used()).m, 2);
});

test('BIZ-21: доплата Ultra за контекст в веб-чате пересчитывается по usage потока', { timeout: 90000 }, async (t) => {
  const { chat, api, fake } = await boot(t, { cfg: { plans: [{ id: 'ultra', credits: 0 }], ultra: { on: true, ctxFree: 20000, ctxStep: 10000, ctxCredits: 2, maxBuy: 10000 } },
    user: { plan: 'ultra', until: Date.now() + DAY, ultra: { bal: 100 } }, model: { ultra: true, credits: 3, plans: ['ultra'] } });
  const bal = async () => (await api('/api/billing')).json.ultra.bal;
  assert.equal(await bal(), 100);
  const r = await chat('USAGE');
  assert.deepEqual(r.errors, []); assert.equal(r.text, 'Ответ');
  assert.deepEqual(fake.st.bodies[0].stream_options, { include_usage: true }, 'у поставщика запрошен настоящий размер контекста');
  assert.equal(await bal(), 91, 'короткий вопрос, но по факту 45K входных токенов: 3 + 6 кредитов (раньше списывалось только 3)');
  const plain = await chat('HELLO'); // usage не пришёл — остаётся оценка
  assert.equal(plain.text, 'Привет, мир'); assert.equal(await bal(), 88);
});

const PY = spawnSync('python3', ['--version']).status === 0;
test('BIZ-19: программа не запустилась — запуск кода из лимита не расходуется', { timeout: 90000, skip: PY ? false : 'нет python3' }, async (t) => {
  // «интерпретатор» — обёртка над python3; поддельный поставщик удаляет её перед вызовом run_python: проверка доступности уже пройдена, запуск невозможен
  const wrap = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'premier-py-')), 'py');
  fs.writeFileSync(wrap, '#!/bin/sh\nexec python3 "$@"\n', { mode: 0o755 });
  t.after(() => fs.rmSync(path.dirname(wrap), { recursive: true, force: true }));
  const { chat, used, fake } = await boot(t, { env: { CODE_RUNNER: 'local', PYTHON: wrap }, settings: () => ({ code: true }) });
  const ok = await chat('PYTHON');
  assert.deepEqual(ok.errors, []); assert.equal(ok.text, 'Итог готов.');
  const tool = (n) => fake.st.bodies[n].messages.find((m) => m.role === 'tool').content;
  assert.match(tool(1), /4/, 'программа выполнилась, модель получила вывод');
  let u = await used();
  assert.equal(u.c, 1, 'выполненный запуск списан'); assert.equal(u.m, 2, 'сообщение и раунд');
  fake.st.onCall = (body) => { if (!body.messages.some((m) => m.role === 'tool')) fs.rmSync(wrap, { force: true }); };
  const bad = await chat('PYTHON');
  assert.equal(bad.text, 'Итог готов.');
  assert.match(tool(3), /не запустилась/, 'модель узнала, что программа не стартовала');
  u = await used();
  assert.equal(u.c, 1, 'несостоявшийся запуск не списан');
  assert.equal(u.m, 3, 'раунд за несостоявшееся действие не списан — только само сообщение');
});

test('BIZ-08, BIZ-10: перезапуск сервера во время ответа — занятая картинка и сообщение возвращаются', { timeout: 90000 }, async (t) => {
  const { chat, used, fake, store, stop } = await boot(t, { user: { plan: 'free', until: 0 }, used: { i: 1 }, env: { SHUTDOWN_GRACE_MS: '300' },
    settings: (url) => ({ image: { on: true, mode: 'images', baseUrl: url + '/v1', modelId: 'img-1', apiKey: 'sk-img' } }) });
  fake.st.imgDelay = 60000; // модель картинок «думает» дольше, чем живёт сервер
  const pending = chat('нарисуй рыжего кота').catch((e) => ({ err: e }));
  assert.ok(await waitFor(() => fake.st.imgCalls === 1), 'запрос дошёл до модели картинок');
  const mid = await used();
  assert.equal(mid.i, 2, 'картинка занята до ответа модели'); assert.equal(mid.m, 1);
  assert.equal(await stop(), 0, 'сервер завершился сам');
  const r = await pending;
  if (r.lines) assert.ok(r.errors.some((e) => /перезапускается/.test(e)), 'пользователь видит причину остановки');
  const day = store.kv.get('usage:' + mskDay(), {}).u1 || {};
  assert.equal(day.i, 1, 'картинка не получена — единица лимита возвращена (раньше оставалась занятой)');
  assert.equal(day.m || 0, 0, 'сообщение возвращено');
  assert.equal((store.kv.get('abortrefund:' + mskDay(), {}) || {}).u1 || 0, 0, 'остановка сервером не идёт в счёт возвратов за «Стоп»');
});

test('BIZ-15: два одновременных ответа и последний сайт — начало HTML не уходит тому, кому сайт не достался', { timeout: 90000 }, async (t) => {
  const { chat, used, fake } = await boot(t, { user: { plan: 'free', until: 0 }, used: { s: 2 } }); // тариф free: 3 сайта в сутки, остался один
  const wire = (r) => r.lines.filter((x) => typeof x.t === 'string').map((x) => x.t).join('');
  let open; fake.st.gate = new Promise((ok) => { open = ok; });
  const a = chat('SITEGATE'), b = chat('SITEGATE');
  assert.ok(await waitFor(() => fake.st.calls === 2), 'оба запроса дошли до модели');
  assert.ok(await waitFor(async () => (await used()).s === 3), 'единица лимита занята, пока блок кода не определился');
  await delay(400); // оба ответа получили начало блока; сайт ли это — ещё не ясно
  open();
  const [ra, rb] = await Promise.all([a, b]);
  const won = [ra, rb].filter((r) => !r.errors.length), lost = [ra, rb].filter((r) => r.errors.length);
  assert.equal(won.length, 1, 'сайт получил один ответ'); assert.equal(lost.length, 1);
  assert.match(won[0].text, /<h1>Раз<\/h1><body><p>два<\/p><\/body>/, 'сайт выдан целиком');
  assert.match(lost[0].errors[0], /Лимит сайтов на сегодня исчерпан/);
  assert.doesNotMatch(wire(lost[0]), /<style>|<h1>|<body|```/, 'начало сайта не отправлено ни в одном событии (раньше уходило до отказа)');
  assert.equal(lost[0].text, 'Вот сайт:');
  let u = await used();
  assert.equal(u.s, 3, 'лимит не превышен'); assert.equal(u.m, 1, 'ответ без сайта возвращён');
});

test('BIZ-15: блок кода, который не стал сайтом, единицу лимита сайтов не держит', { timeout: 90000 }, async (t) => {
  const { chat, used } = await boot(t, { user: { plan: 'free', until: 0 }, used: { s: 2 } });
  const sh = await chat('SHELL');
  assert.deepEqual(sh.errors, []); assert.equal(sh.text, 'Команда:\n```\nls -la\n```\nГотово');
  assert.equal((await used()).s, 2, 'единица возвращена сразу после решения «не сайт»');
  const cut = await chat('SHBREAK'); // обрыв внутри нерешённого блока — единица тоже возвращается
  assert.equal(cut.text, 'Команда:\n```\nls -la');
  assert.equal((await used()).s, 2);
  const site = await chat('SITE');
  assert.deepEqual(site.errors, []); assert.match(site.text, /<h1>Привет<\/h1>/);
  assert.equal((await used()).s, 3, 'последний сайт по-прежнему доступен');
});

test('BIZ-10: перезапуск сервера во время ожидания Retry-After — сообщение возвращается, остановка не ждёт минуту', { timeout: 90000 }, async (t) => {
  const { chat, used, fake, store, stop } = await boot(t, { user: { plan: 'free', until: 0 }, env: { SHUTDOWN_GRACE_MS: '300' } });
  const pending = chat('BUSY429').catch((e) => ({ err: e }));
  assert.ok(await waitFor(() => fake.st.calls === 1), 'запрос дошёл до модели');
  await delay(300); // сервер получил 429 и ждёт 60 с перед повтором
  assert.equal((await used()).m, 1, 'сообщение списано заранее');
  const t0 = Date.now();
  assert.equal(await stop(), 0, 'сервер завершился сам');
  assert.ok(Date.now() - t0 < 2500, 'остановка не ждёт ответ веб-чата: ' + (Date.now() - t0) + ' мс');
  const r = await pending;
  if (r.lines) assert.ok(r.errors.some((e) => /перезапускается/.test(e)), 'пользователь видит причину остановки');
  assert.equal(fake.st.calls, 1, 'повторного запроса к модели нет');
  const day = store.kv.get('usage:' + mskDay(), {}).u1 || {};
  assert.equal(day.m || 0, 0, 'сообщение возвращено (раньше оставалось списанным)');
  assert.equal((store.kv.get('abortrefund:' + mskDay(), {}) || {}).u1 || 0, 0, 'остановка сервером не идёт в счёт возвратов за «Стоп»');
});

test('BIZ-08, BIZ-10: перезапуск сервера во время программы Python — расчёт выполняется принудительно до выхода', { timeout: 90000, skip: PY ? false : 'нет python3' }, async (t) => {
  const { chat, used, fake, store, stop } = await boot(t, { env: { CODE_RUNNER: 'local', SHUTDOWN_GRACE_MS: '300' }, settings: () => ({ code: true }) });
  const pending = chat('PYSLOW').catch((e) => ({ err: e }));
  assert.ok(await waitFor(async () => (await used()).c === 1), 'запуск Python занят, программа работает');
  assert.equal(await stop(), 0, 'сервер завершился сам');
  await pending;
  const day = store.kv.get('usage:' + mskDay(), {}).u1 || {};
  assert.equal(day.c || 0, 0, 'программа не закончилась — запуск возвращён (раньше оставался занятым)');
  assert.equal(day.m || 0, 0, 'сообщение возвращено');
  assert.equal(fake.st.calls, 1);
});
