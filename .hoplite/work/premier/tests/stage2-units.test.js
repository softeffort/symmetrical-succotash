'use strict';
// Этап 2 — небольшие модули без сервера: признак конца потока (BIZ-14), начало сайта в потоке (BIZ-15),
// запуск кода (BIZ-19), текст ответа частями (BIZ-24), итог действия полями (BIZ-35).
// Запуск: npm test (или node --test tests/stage2-units.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const sse = (chunks) => new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); } }));
const ev = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
const piece = (t, finish = null) => ev({ choices: [{ delta: { content: t }, finish_reason: finish }] });

test('BIZ-14: поток без [DONE] и без finish_reason — ошибка stream_cut после всех полученных событий', async () => {
  const chatStream = require(path.join(ROOT, 'chat-stream.js'));
  const read = async (chunks) => { const got = []; try { for await (const j of chatStream.events(sse(chunks))) got.push(j.choices?.[0]?.delta?.content ?? null); return { got }; } catch (e) { return { got, code: e.code, message: e.message }; } };
  assert.deepEqual(await read([piece('а'), piece('б'), 'data: [DONE]\n\n']), { got: ['а', 'б'] });
  assert.deepEqual(await read([piece('а'), piece('б', 'stop')]), { got: ['а', 'б'] }, 'finish_reason без [DONE] — поток завершён');
  assert.deepEqual(await read([piece('а'), ev({ choices: [{ delta: {}, finish_reason: 'length' }] })]), { got: ['а', null] });
  const cut = await read([piece('а'), piece('б')]);
  assert.deepEqual(cut.got, ['а', 'б'], 'полученный текст вызывающий код уже увидел'); assert.equal(cut.code, 'stream_cut'); assert.match(cut.message, /^API модели оборвал поток/);
  assert.equal((await read([])).code, 'stream_cut', 'пустой поток — тоже обрыв');
  process.env.STREAM_END_CHECK = 'off';
  try { assert.deepEqual(await read([piece('а'), piece('б')]), { got: ['а', 'б'] }, 'проверка отключена настройкой'); } finally { delete process.env.STREAM_END_CHECK; }
});

test('BIZ-15: начало сайта в идущем потоке определяется по тем же правилам, что и готовый сайт', () => {
  const { siteStart, lastSite } = require(path.join(ROOT, 'site-detect.js'));
  assert.equal(siteStart(''), -1); assert.equal(siteStart('Просто текст про <html> и <body>'), -1);
  assert.equal(siteStart('привет\n```html\n<!doctype html><html>'), 7, 'блок ещё не закрыт — сайт уже начался');
  assert.equal(siteStart('привет\n```html\n<div>кусок вёрстки</div>'), -1, 'фрагмент без <html>/<body> — не сайт');
  assert.equal(siteStart('```js\nconsole.log("<body>")\n```\nготово'), -1, 'код на другом языке — не сайт');
  assert.equal(siteStart('```\n<body><p>без языка</p></body>'), 0);
  const pack = 'A\n```css:style.css\nbody{}\n```\n```html:index.html\n<html><body></body></html>\n```';
  assert.equal(siteStart(pack), 2, 'набор файлов: сайт начинается с первого файла');
  assert.equal(siteStart('A\n```css:style.css\nbody{}\n```\n'), -1, 'набор без HTML-файла — не сайт');
  // согласованность: всё, что lastSite считает сайтом, siteStart находит
  for (const txt of [pack, 'x\n```html\n<!DOCTYPE html><html><body>1</body></html>\n```', '```\n<html></html>\n```']) { assert.ok(lastSite(txt)); assert.ok(siteStart(txt) >= 0); }
});

test('BIZ-19: отказ до запуска программы помечен notStarted', () => {
  // code.js читает CODE_RUNNER при загрузке — проверяем в отдельном процессе
  const src = `const coder = require(${JSON.stringify(path.join(ROOT, 'code.js'))});
    coder.run('print(1)', 'u1').then(() => console.log('RAN'), (e) => console.log(JSON.stringify({ notStarted: e.notStarted === true, message: e.message })));`;
  const off = spawnSync(process.execPath, ['-e', src], { env: { ...process.env, CODE_RUNNER: 'off' }, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(off.stdout.trim()), { notStarted: true, message: 'Выполнение кода выключено (CODE_RUNNER=off)' });
  const none = spawnSync(process.execPath, ['-e', src], { env: { ...process.env, CODE_RUNNER: 'local', PYTHON: '/nonexistent/python-premier-test' }, encoding: 'utf8' });
  assert.equal(JSON.parse(none.stdout.trim()).notStarted, true, 'интерпретатор не найден — программа не запускалась');
});

test('BIZ-24: текст ответа — строкой или массивом частей', () => {
  const reasoning = require(path.join(ROOT, 'reasoning.js'));
  assert.equal(reasoning.text({ content: 'строка' }), 'строка');
  assert.equal(reasoning.text({ content: [{ type: 'text', text: 'две ' }, { type: 'text', text: 'части' }] }), 'две части');
  assert.equal(reasoning.text({ content: null }), ''); assert.equal(reasoning.text(undefined), '');
});

test('BIZ-35: действие в папке пользователя — итог полями, а не текстом', async () => {
  const folder = require(path.join(ROOT, 'folder.js'));
  const ask = (name, reply, signal) => { let cid; const p = folder.askEx('u1', (o) => { cid = o.fs.cid; }, name, { path: 'a.txt' }, signal); if (reply) assert.equal(folder.answer('u1', cid, ...reply), true); return { p, cid }; };
  assert.deepEqual(await ask('folder_write', ['Готово: a.txt', 'ok']).p, { text: 'Готово: a.txt', executed: true, delivered: true, errorKind: null, write: true });
  assert.deepEqual(await ask('folder_write', ['Готово: a.txt', 'no']).p, { text: 'Готово: a.txt', executed: false, delivered: false, errorKind: 'declined', write: true }, 'решает state, а не текст');
  assert.deepEqual(await ask('folder_delete', ['Ошибка: нет доступа', 'err']).p, { text: 'Ошибка: нет доступа', executed: true, delivered: false, errorKind: 'failed', write: true });
  assert.deepEqual(await ask('folder_read', ['Пользователь ОТКЛОНИЛ — это текст файла', 'ok']).p, { text: 'Пользователь ОТКЛОНИЛ — это текст файла', executed: true, delivered: true, errorKind: null, write: false });
  assert.equal((await ask('folder_list', ['список', undefined]).p).executed, true, 'вкладка со старым кодом не присылает state — считается выполненным');
  const ac = new AbortController(), stopped = ask('folder_write', null, ac.signal); ac.abort();
  assert.deepEqual(await stopped.p, { text: 'Ошибка: пользователь остановил ответ', executed: false, delivered: false, errorKind: 'stopped', write: true });
  assert.equal(folder.answer('u1', stopped.cid, 'поздно', 'ok'), false, 'ответ на закрытый запрос не принимается');
  const other = ask('folder_write', null); assert.equal(folder.answer('u2', other.cid, 'чужой', 'ok'), false, 'чужой пользователь ответить не может');
  folder.answer('u1', other.cid, 'x', 'ok'); await other.p;
  assert.equal(await folder.ask('u1', (o) => setImmediate(() => folder.answer('u1', o.fs.cid, 'текст', 'ok')), 'folder_read', { path: 'a' }), 'текст', 'прежний вызов ask возвращает строку');
});

test('BIZ-35: действие на компьютере пользователя — итог полями', async () => {
  const agent = require(path.join(ROOT, 'agent.js'));
  const none = () => {};
  const ac = new AbortController(); ac.abort();
  assert.deepEqual(await agent.callEx('nobody', none, 'computer_run', {}, false, ac.signal), { text: agent.STOPPED, executed: false, delivered: false, errorKind: 'stopped', write: true });
  const off = await agent.callEx('nobody', none, 'computer_run', {}, false, null);
  assert.deepEqual([off.executed, off.delivered, off.errorKind], [false, false, 'offline'], 'помощник не запущен — действие не начиналось');
  assert.equal(await agent.call('nobody', none, 'computer_run', {}, false, null), off.text, 'прежний вызов call возвращает строку');
  assert.equal((await agent.callEx('nobody', none, 'computer_read', {}, false, null)).write, false, 'чтение — не изменяющее действие');
  // отказ в окне Premier Agent на компьютере приходит как результат помощника — действие не выполнялось
  const DENIED = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'desktop', 'premier-agent.js'), 'utf8').match(/const DENIED = '([^']+)'/)[1];
  const seen = [];
  const den = await agent.callEx('nobody', (x) => seen.push(x), 'computer_run', {}, 'all', null, async () => DENIED);
  assert.deepEqual({ executed: den.executed, delivered: den.delivered, errorKind: den.errorKind }, { executed: false, delivered: false, errorKind: 'declined' }, 'отказ на компьютере — не выполненный шаг');
  assert.equal(seen.find((x) => x.agres && x.agres.state !== 'run').agres.state, 'no');
  const ran = await agent.callEx('nobody', none, 'computer_run', {}, 'all', null, async () => 'Ошибка: команда не найдена');
  assert.deepEqual({ executed: ran.executed, errorKind: ran.errorKind }, { executed: true, errorKind: 'failed' }, 'ошибка самой команды — шаг выполнялся');
});

test('BIZ-15: siteWatch находит начало сайта по мере прихода текста и совпадает с siteStart', () => {
  const { siteStart, siteWatch } = require(path.join(ROOT, 'site-detect.js'));
  const texts = [
    'Вот сайт:\n```html\n<!doctype html><html><body><h1>Привет</h1></body></html>\n```\nГотово',
    'Код:\n```\nls -la\n```\nи сайт\n```\n<html><body>x</body></html>\n```',
    'Файлы:\n```css:style.css\nbody{}\n```\n```html:index.html\n<div>x</div>\n```',
    'Кусок разметки:\n```html\n<div>не сайт</div>\n```\nвсё',
    '```js\nconsole.log("<html>")\n```\nбез сайта',
    'Просто текст без кода <html> в строке',
  ];
  for (const text of texts) for (const step of [1, 3, 7, 1000]) {
    const w = siteWatch(); let r = { site: -1, hold: -1 }, shown = 0;
    for (let i = step; ; i += step) {
      const part = text.slice(0, i); r = w.feed(part);
      // что можно показывать: всё до начала сайта или до ещё не решённого блока кода
      const safe = r.site >= 0 ? r.site : r.hold >= 0 ? r.hold : part.length;
      if (r.site < 0) shown = Math.max(shown, safe);
      if (i >= text.length) break;
    }
    const at = siteStart(text);
    assert.equal(r.site, at, JSON.stringify(text.slice(0, 30)) + ' шаг ' + step);
    if (at >= 0) assert.ok(shown <= at + 2, 'до решения показано не больше начала сайта (допуск — неполная строка ```): ' + shown + ' > ' + at);
  }
});
