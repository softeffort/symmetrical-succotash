'use strict';
// Большие проекты в чате через облачный компьютер: шаги с инструментами (AGENT_ROUNDS) и кнопка «Продолжить»,
// сжатие старых шагов в переписке с моделью (chat-context.js), список домашней папки в подсказке,
// скачивание папки одним архивом (cloud-zip.js, /api/cloud/zip), карточка проекта в ответе, вложения в ~/uploads.
// Облачный компьютер — в режиме CLOUD_RUNNER=local (без Docker).
const test = require('node:test'), assert = require('node:assert/strict'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib'), vm = require('node:vm');
const { copyApp, seed, startServer, rm, ROOT } = require('../test/helpers');
const chatContext = require('../chat-context'), cloudZip = require('../cloud-zip');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Разбор ZIP без внешних программ: оглавление в конце файла → имена, права, содержимое (с проверкой CRC).
function unzip(buf) {
  const e = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); assert.ok(e >= 0, 'нет конца архива');
  const n = buf.readUInt16LE(e + 10), size = buf.readUInt32LE(e + 12); let at = buf.readUInt32LE(e + 16);
  assert.equal(at + size, e, 'оглавление стоит вплотную к концу архива');
  const out = {};
  for (let i = 0; i < n; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    const flags = buf.readUInt16LE(at + 8), method = buf.readUInt16LE(at + 10), crc = buf.readUInt32LE(at + 16), csize = buf.readUInt32LE(at + 20), usize = buf.readUInt32LE(at + 24);
    const nl = buf.readUInt16LE(at + 28), xl = buf.readUInt16LE(at + 30), cl = buf.readUInt16LE(at + 32), mode = buf.readUInt32LE(at + 38) >>> 16, loc = buf.readUInt32LE(at + 42);
    const name = buf.slice(at + 46, at + 46 + nl).toString('utf8');
    assert.equal(buf.readUInt32LE(loc), 0x04034b50, name + ': заголовок файла на месте');
    assert.ok(flags & 0x800, name + ': имя помечено как UTF-8'); assert.equal(method, 8);
    const ds = loc + 30 + buf.readUInt16LE(loc + 26) + buf.readUInt16LE(loc + 28);
    assert.equal(buf.slice(loc + 30, loc + 30 + buf.readUInt16LE(loc + 26)).toString('utf8'), name);
    const data = zlib.inflateRawSync(buf.slice(ds, ds + csize));
    assert.equal(data.length, usize, name + ': размер'); assert.equal(zlib.crc32(data) >>> 0, crc, name + ': CRC');
    assert.equal(buf.readUInt32LE(ds + csize), 0x08074b50, name + ': описатель после данных'); assert.equal(buf.readUInt32LE(ds + csize + 4), crc);
    out[name] = { data, mode };
    at += 46 + nl + xl + cl;
  }
  return out;
}

test('сжатие переписки: старые шаги сокращаются, последние и системные сообщения — нет', () => {
  const big = (c, n) => c.repeat(n);
  const convo = [{ role: 'system', content: big('s', 30000) }, { role: 'user', content: 'собери проект' }];
  for (let i = 0; i < 10; i++) {
    convo.push({ role: 'assistant', content: '', tool_calls: [{ id: 'c' + i, type: 'function', function: { name: 'computer_write', arguments: JSON.stringify({ path: `~/app/f${i}.js`, content: big('x', 5000) }) } }] });
    convo.push({ role: 'tool', tool_call_id: 'c' + i, content: big('r', 8000) });
  }
  const from = 2, before = chatContext.total(convo, from);
  assert.equal(chatContext.shrink(convo, from, before + 1), 0, 'в пределах бюджета ничего не трогаем');
  const cutChars = chatContext.shrink(convo, from, 50000);
  assert.ok(cutChars > 0); assert.equal(before - cutChars, chatContext.total(convo, from)); assert.ok(chatContext.total(convo, from) <= 50000);
  assert.equal(convo[0].content.length, 30000, 'системное сообщение не трогаем'); assert.equal(convo[1].content, 'собери проект');
  const a0 = JSON.parse(convo[2].tool_calls[0].function.arguments); // аргументы остаются правильным JSON, путь сохранён
  assert.equal(a0.path, '~/app/f0.js'); assert.ok(a0.content.length < 500); assert.match(a0.content, /сокращено, было 5000 символов/);
  assert.ok(convo[3].content.length < 1500); assert.match(convo[3].content, /старый результат сокращён, было 8000 символов/);
  assert.equal(convo[3].tool_call_id, 'c0');
  for (let i = 10 - chatContext.KEEP_STEPS; i < 10; i++) { // последние шаги целы: модель работает с ними прямо сейчас
    assert.equal(JSON.parse(convo[2 + i * 2].tool_calls[0].function.arguments).content.length, 5000);
    assert.equal(convo[3 + i * 2].content.length, 8000);
  }
  assert.equal(chatContext.shrink(convo, from, 50000), 0, 'повторный вызов ничего не меняет');
});

test('сжатие переписки: старые скриншоты убираются, битые аргументы не ломают сжатие', () => {
  const convo = [{ role: 'user', content: 'посмотри сайт' }];
  for (let i = 0; i < 6; i++) {
    convo.push({ role: 'assistant', content: null, tool_calls: [{ id: 'p' + i, type: 'function', function: { name: 'computer_preview', arguments: i === 0 ? '{не json ' + 'z'.repeat(900) : '{"url":"http://localhost:3000"}' } }] });
    convo.push({ role: 'tool', tool_call_id: 'p' + i, content: 'Снимок готов' });
    convo.push({ role: 'user', content: [{ type: 'text', text: 'Снимок страницы' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'A'.repeat(100) } }] });
  }
  assert.ok(chatContext.shrink(convo, 1, 30000) > 0);
  assert.equal(typeof convo[3].content, 'string'); assert.match(convo[3].content, /старые скриншоты убраны/);
  assert.ok(Array.isArray(convo.at(-1).content), 'последний скриншот остаётся');
  for (const m of convo) for (const c of m.tool_calls || []) assert.equal(typeof c.function.arguments, 'string');
});

test('архив папки: имена на русском, права, без зависимостей и ссылок', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'premier-zip-'));
  t.after(() => rm(dir));
  const put = (rel, data, mode) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); if (mode) fs.chmodSync(f, mode); };
  const bin = Buffer.alloc(70000); for (let i = 0; i < bin.length; i++) bin[i] = (i * 31 + (i >> 8)) & 255;
  put('index.html', '<h1>Магазин</h1>'); put('src/приложение.js', 'console.log("привет")\n'); put('run.sh', '#!/bin/sh\necho ok\n', 0o755);
  put('data/blob.bin', bin); put('пусто.txt', ''); put('.env.example', 'KEY=1\n');
  put('node_modules/x/index.js', 'x'); put('venv/lib/a.py', 'x'); put('src/__pycache__/a.pyc', 'x');
  fs.writeFileSync(path.join(os.tmpdir(), 'premier-zip-secret.txt'), 'секрет'); t.after(() => rm(path.join(os.tmpdir(), 'premier-zip-secret.txt')));
  fs.symlinkSync(path.join(os.tmpdir(), 'premier-zip-secret.txt'), path.join(dir, 'link.txt')); fs.symlinkSync(os.tmpdir(), path.join(dir, 'linkdir'));

  const list = await cloudZip.collect(dir);
  assert.deepEqual(list.files.map((f) => f.rel).sort(), ['.env.example', 'data/blob.bin', 'index.html', 'run.sh', 'src/приложение.js', 'пусто.txt'].sort());
  assert.equal(list.skipped, 3);
  assert.ok(!(await cloudZip.collect(dir, { top: true })).files.some((f) => f.rel.startsWith('.')), 'в корне домашней папки скрытое не берём');

  const file = path.join(dir, '..', path.basename(dir) + '.zip'); t.after(() => rm(file));
  const out = fs.createWriteStream(file, { highWaterMark: 1024 }); // маленький буфер — проверяем и ожидание «drain»
  const open = (rel) => { const f = path.join(dir, rel), fd = fs.openSync(f, 'r'), st = fs.fstatSync(fd); return { fd, size: st.size, mtime: st.mtimeMs, mode: st.mode }; };
  const done = await cloudZip.write(out, list.files, open, 'магазин');
  await new Promise((ok) => out.end(ok));
  const buf = fs.readFileSync(file), z = unzip(buf);
  assert.equal(done.files, 6); assert.equal(done.bytes, buf.length); assert.equal(done.stopped, false);
  assert.deepEqual(Object.keys(z).sort(), list.files.map((f) => 'магазин/' + f.rel).sort());
  assert.equal(z['магазин/src/приложение.js'].data.toString(), 'console.log("привет")\n');
  assert.ok(z['магазин/data/blob.bin'].data.equals(bin)); assert.equal(z['магазин/пусто.txt'].data.length, 0);
  assert.equal(z['магазин/run.sh'].mode & 0o777, 0o755, 'права на запуск сохраняются');

  // файл пропал, пока шёл архив — пропускаем его, архив остаётся целым
  const out2 = fs.createWriteStream(file);
  const part = await cloudZip.write(out2, list.files, (rel) => (rel === 'index.html' ? null : open(rel)), '');
  await new Promise((ok) => out2.end(ok));
  assert.equal(part.files, 5); assert.ok(!('index.html' in unzip(fs.readFileSync(file))));

  // папка выросла после подсчёта (идёт сборка, пишется журнал) — архив обрывается, а не растёт без предела
  const out3 = fs.createWriteStream(file);
  await assert.rejects(cloudZip.write(out3, list.files, open, '', 50000), /папка выросла/);
  await new Promise((ok) => out3.end(ok)); // дожидаемся записи начатого: поток не должен работать после конца теста
});

test('архив папки: получатель оборвал скачивание — запись останавливается и не зависает', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'premier-zip-')); t.after(() => rm(dir));
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(dir, `f${i}.bin`), require('crypto').randomBytes(400000));
  const list = await cloudZip.collect(dir); let opened = 0;
  const { Writable } = require('stream');
  const out = new Writable({ highWaterMark: 1024, write(chunk, enc, cb) { if (opened >= 2) return this.destroy(); setTimeout(cb, 1); } });
  const r = await cloudZip.write(out, list.files, (rel) => { opened++; const fd = fs.openSync(path.join(dir, rel), 'r'); return { fd, size: 400000, mtime: Date.now() }; }, 'p');
  assert.equal(r.stopped, true); assert.ok(opened < 5, 'после обрыва остальные файлы не открываются');
});

test('проекты в чате: шаги, «Продолжить», подсказка, архив и карточка проекта', async (t) => {
  let handler, requests = [];
  const mock = http.createServer((req, res) => {
    let data = ''; req.on('data', (b) => { data += b; });
    req.on('end', () => {
      const body = JSON.parse(data || '{}');
      if (!body.stream || !handler) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })); }
      requests.push(body); res.writeHead(200, { 'Content-Type': 'text/event-stream' }); handler(body, res);
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const dir = copyApp();
  seed(dir, { users: [{ id: 'u1', login: 'anna', email: 'anna@example.com', plan: 'pro', until: Date.now() + 1e10 }, { id: 'u2', login: 'free', email: 'free@example.com' }], sessions: { tok1: 'u1', tok2: 'u2' } });
  fs.writeFileSync(dir + '/data/models.json', JSON.stringify([{ id: 'm1', name: 'Mock', modelId: 'mock', baseUrl: `http://127.0.0.1:${mock.address().port}`, apiKey: 'not-a-real-secret' }]));
  fs.writeFileSync(dir + '/data/settings.json', JSON.stringify({ browser: false, selfcheck: false, code: false }));
  const s = await startServer(dir, { CLOUD_RUNNER: 'local', MODEL_REQUEST_TIMEOUT_MS: '5000', AGENT_ROUNDS: '5', AGENT_CONTEXT_CHARS: '20000' });
  t.after(async () => { await s.stop(); await new Promise((r) => mock.close(r)); rm(dir); });
  const home = path.join(dir, 'data', 'cloud', 'u1'), enc = encodeURIComponent;
  const tc = (res, id, name, args) => res.end('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] }) + '\n\n');
  const say = (res, text) => res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n');
  const chat = async (text, extra = {}) => {
    requests = [];
    const r = await s.req('POST', '/api/chat', { token: 'tok1', body: { model: 'm1', messages: [{ role: 'user', content: text }], cloud: true, ...extra } });
    assert.equal(r.status, 200, r.text);
    return r.text.trim().split('\n').map((l) => JSON.parse(l));
  };
  const sys = () => requests[0].messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');

  await t.test('пустой компьютер: в подсказке — число шагов и «папка пуста»', async () => {
    handler = (body, res) => say(res, 'Привет!');
    const ev = await chat('привет');
    assert.match(sys(), /до 5 шагов с инструментами/); assert.match(sys(), /Домашняя папка ~ сейчас пуста/); assert.match(sys(), /БОЛЬШОЙ ПРОЕКТ/);
    assert.ok(!ev.some((e) => e.more), 'обычный ответ — без «Продолжить»');
  });

  await t.test('шаги закончились: последний запрос без инструментов, с пометкой; клиенту уходит more', async () => {
    const body = (i) => `// файл ${i}\n` + 'x'.repeat(9000);
    handler = (b, res) => (b.tools ? tc(res, 'call_' + requests.length, 'computer_write', { path: `~/shop/src/f${requests.length}.js`, content: body(requests.length) }) : say(res, 'Сделал четыре файла, осталось написать README.'));
    const ev = await chat('собери интернет-магазин');
    assert.equal(requests.length, 5, 'ровно AGENT_ROUNDS запросов к модели');
    assert.ok(requests.slice(0, 4).every((r) => Array.isArray(r.tools) && r.tools.length), 'до последнего шага инструменты есть');
    assert.equal(requests[4].tools, undefined, 'на последнем шаге инструментов нет');
    const last = requests[4].messages.at(-1);
    assert.equal(last.role, 'user'); assert.match(last.content, /последний шаг этого ответа/);
    assert.ok(!requests[3].messages.some((m) => typeof m.content === 'string' && /последний шаг этого ответа/.test(m.content)), 'пометка только в последнем запросе');
    for (let i = 1; i <= 4; i++) assert.equal(fs.readFileSync(path.join(home, `shop/src/f${i}.js`), 'utf8'), body(i), 'файл на диске целый — сжимается только переписка');
    assert.ok(ev.some((e) => e.more === 1), 'клиент получает more → кнопка «Продолжить»');
    assert.ok(ev.some((e) => e.s === 'limit' && e.q === '5'), 'в ходе ответа видна строка о пределе шагов');
    assert.match(ev.filter((e) => e.t).map((e) => e.t).join(''), /осталось написать README/);
    // сжатие: к пятому запросу первые шаги сокращены, аргументы — по-прежнему правильный JSON с путём
    const calls = requests[4].messages.filter((m) => m.tool_calls).map((m) => JSON.parse(m.tool_calls[0].function.arguments));
    assert.equal(calls.length, 4); assert.equal(calls[0].path, '~/shop/src/f1.js');
    assert.ok(calls[0].content.length < 600 && /сокращено/.test(calls[0].content), 'старый текст файла убран из переписки');
    assert.ok(calls[3].content.length > 9000, 'последний шаг не тронут');
    const tools = requests[4].messages.filter((m) => m.role === 'tool');
    assert.equal(tools.length, 4); assert.ok(tools.every((m, i) => m.tool_call_id === 'call_' + (i + 1)), 'пары вызов → результат не нарушены');
    // карточка проекта: папка, в которой изменилось несколько файлов
    const cf = ev.find((e) => e.cfiles)?.cfiles;
    assert.ok(cf, 'есть событие cfiles'); assert.deepEqual(cf.dirs.map((d) => [d.path, d.name, d.files]), [['~/shop', 'shop', 4]]); assert.ok(cf.dirs[0].size > 36000);
  });

  await t.test('следующее сообщение: модель видит, что уже лежит в папке', async () => {
    fs.mkdirSync(path.join(home, 'shop/node_modules/left-pad'), { recursive: true }); fs.writeFileSync(path.join(home, 'shop/node_modules/left-pad/index.js'), 'x');
    fs.writeFileSync(path.join(home, 'shop/package.json'), '{}'); fs.writeFileSync(path.join(home, '.secret'), 'x');
    handler = (b, res) => say(res, 'Продолжаю.');
    const ev = await chat('Продолжай');
    const p = sys(), at = p.indexOf('Сейчас в домашней папке ~');
    assert.ok(at > 0); const tree = p.slice(at);
    assert.match(tree, /^shop\/$/m); assert.match(tree, /^ {2}node_modules\/$/m); assert.match(tree, /^ {2}src\/$/m); assert.match(tree, /^ {2}package\.json$/m);
    assert.ok(!tree.includes('left-pad') && !tree.includes('.secret'), 'зависимости и скрытое в список не попадают');
    assert.ok(!ev.some((e) => e.more));
  });

  await t.test('один шаг до предела — «Продолжить» не нужен', async () => {
    handler = (b, res) => (requests.length < 4 ? tc(res, 'c' + requests.length, 'computer_list', { path: '~/shop' }) : say(res, 'Готово.'));
    const ev = await chat('что в папке?');
    assert.equal(requests.length, 4); assert.ok(!ev.some((e) => e.more)); assert.ok(requests[3].tools, 'инструменты не отбирались');
  });

  await t.test('архив папки через API: проверка, содержимое, ошибки и доступ', async () => {
    fs.writeFileSync(path.join(home, 'shop/описание.md'), '# Магазин\n'); fs.symlinkSync('/etc/hostname', path.join(home, 'shop/host.txt'));
    const url = '/api/cloud/zip?path=' + enc('~/shop');
    assert.equal((await s.req('GET', url)).status, 401);
    assert.equal((await s.req('GET', url, { token: 'tok2' })).status, 404, 'чужую папку по своему входу не получить: у каждого своя домашняя папка');
    const chk = await s.req('GET', url + '&check=1', { token: 'tok1' });
    assert.equal(chk.status, 200, chk.text); assert.equal(chk.json.name, 'shop.zip'); assert.equal(chk.json.files, 6);
    const r = await fetch(s.base + url, { headers: { Cookie: 'premier_session=tok1' } });
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'application/zip'); assert.match(r.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''shop\.zip$/);
    const z = unzip(Buffer.from(await r.arrayBuffer()));
    assert.deepEqual(Object.keys(z).sort(), ['shop/package.json', 'shop/src/f1.js', 'shop/src/f2.js', 'shop/src/f3.js', 'shop/src/f4.js', 'shop/описание.md'].sort());
    assert.equal(z['shop/описание.md'].data.toString(), '# Магазин\n'); assert.equal(z['shop/src/f2.js'].data.length, fs.statSync(path.join(home, 'shop/src/f2.js')).size);
    // вся домашняя папка: имя premier-computer, скрытое из корня не берём
    const all = await fetch(s.base + '/api/cloud/zip?path=' + enc('~'), { headers: { Cookie: 'premier_session=tok1' } });
    assert.match(all.headers.get('content-disposition'), /premier-computer\.zip/);
    const za = Object.keys(unzip(Buffer.from(await all.arrayBuffer())));
    assert.ok(za.includes('premier-computer/shop/package.json') && !za.some((n) => n.includes('.secret') || n.includes('.premier')));
    // ошибки
    fs.mkdirSync(path.join(home, 'empty'));
    const bad = async (p) => { const x = await s.req('GET', '/api/cloud/zip?path=' + enc(p), { token: 'tok1' }); return [x.status, x.json?.error]; };
    assert.deepEqual(await bad('~/empty'), [404, 'В папке нет файлов для архива']);
    assert.deepEqual(await bad('~/nope'), [404, 'Папка не найдена']);
    assert.deepEqual(await bad('~/shop/package.json'), [400, 'Это файл, а не папка']);
    assert.equal((await bad('~/../u2'))[0], 400); assert.equal((await bad('/etc'))[0], 400);
    fs.symlinkSync('/etc', path.join(home, 'etc-link')); assert.deepEqual(await bad('~/etc-link'), [400, 'Это ссылка: архивом скачиваются только настоящие папки']);
    fs.rmSync(path.join(home, 'etc-link'));
  });

  await t.test('вложение из чата попадает в ~/uploads, и модель узнаёт путь из подсказки', async () => {
    const put = async (name, text) => { const r = await fetch(`${s.base}/api/cloud/upload?uniq=1&dir=${enc('~/uploads')}&name=${enc(name)}`, { method: 'POST', headers: { Cookie: 'premier_session=tok1' }, body: Buffer.from(text) }); assert.equal(r.status, 200, await r.clone().text()); return (await r.json()).path; };
    assert.equal(await put('данные.csv', 'a;b\n1;2\n'), '~/uploads/данные.csv');
    assert.equal(fs.readFileSync(path.join(home, 'uploads/данные.csv'), 'utf8'), 'a;b\n1;2\n');
    // то же имя в следующем сообщении или в другом чате — прежний файл не затирается, модель получает настоящий путь
    assert.equal(await put('данные.csv', 'новое'), '~/uploads/данные-2.csv');
    assert.equal(fs.readFileSync(path.join(home, 'uploads/данные.csv'), 'utf8'), 'a;b\n1;2\n');
    const both = await Promise.all([put('image.png', 'первая'), put('image.png', 'вторая'), put('image.png', 'третья')]); // вставили несколько картинок сразу
    assert.deepEqual([...both].sort(), ['~/uploads/image-2.png', '~/uploads/image-3.png', '~/uploads/image.png']);
    assert.deepEqual(both.map((p) => fs.readFileSync(path.join(home, p.slice(2)), 'utf8')), ['первая', 'вторая', 'третья']);
    const long = await put('я'.repeat(230) + '.txt', 'x'); // длинное имя сервер укорачивает — путь берём из ответа, а не собираем в браузере
    assert.ok(fs.existsSync(path.join(home, long.slice(2))) && long.endsWith('.txt') && long.length < 230, 'путь из ответа существует');
    // без uniq (панель «Файлы») — как раньше: файл с тем же именем заменяется
    const plain = await fetch(`${s.base}/api/cloud/upload?dir=${enc('~/uploads')}&name=${enc('данные.csv')}`, { method: 'POST', headers: { Cookie: 'premier_session=tok1' }, body: Buffer.from('a;b\n1;2\n') });
    assert.equal(plain.status, 200);
    handler = (b, res) => say(res, 'Вижу файл.');
    await chat('[Premier положил приложенные файлы в облачный компьютер: ~/uploads/данные.csv]\n\nразбери таблицу');
    assert.match(sys(), /~\/uploads/); assert.match(sys().slice(sys().indexOf('Сейчас в домашней папке ~')), /^uploads\/\n(?: {2}.+\n)* {2}данные\.csv$/m);
  });
});

test('клиент: кнопка «Продолжить», карточка проекта и архив папки — в русской и английской версии', () => {
  for (const [pref, cont, word] of [['public/js/', 'Продолжай', 'Продолжить'], ['public/en/js/', 'Continue', 'Continue']]) {
    const chat = read(pref + '05-chat.js'), render = read(pref + '04-render.js'), events = read(pref + '09-events.js'), atts = read(pref + '07-attachments.js');
    assert.match(chat, /else if \(o\.more\) \{\s*msg\.more = 1;/, pref + ': событие more сохраняется в сообщении');
    assert.match(chat, /delete msg\.more/, pref + ': при новой попытке кнопка убирается');
    assert.ok(render.includes("st.s === 'limit'"), pref + ': строка о пределе шагов — не «Не удалось»');
    assert.ok(render.includes('data-more="1"') && render.includes(`>${word}</button>`), pref + ': кнопка в ответе');
    assert.ok(events.includes(`if (d.more) { send('${cont}'); return; }`), pref + ': нажатие отправляет продолжение');
    assert.ok(/api\/cloud\/upload\?uniq=1&dir=.*uploads/.test(atts) && atts.includes("return j.path || '~/uploads/' + name"), pref + ': вложения уходят в ~/uploads, путь — из ответа сервера');
    assert.match(atts, /m\.up\?\.length/, pref + ': пути вложений попадают в сообщение для модели');
  }
  for (const [p, title] of [['public/cloud.js', 'Скачать папку архивом (ZIP)'], ['public/en/cloud.js', 'Download the folder as an archive (ZIP)']]) {
    const src = read(p); assert.ok(src.includes('/api/cloud/zip?path=') && src.includes(title), p + ': значок архива у папок в «Файлах»');
  }
  for (const page of ['public/chat.html', 'public/en/chat.html']) assert.ok(read(page).includes('id="i-zip"') || read('public/chat.html').includes('i-zip'), page + ': значок архива есть на странице');
});

test('клиент: журнал прошлых действий в английской версии распознаёт свои же записи', () => {
  const src = read('public/en/js/04-render.js');
  assert.ok(!/\/компьютер\|папк\//.test(src), 'проверка по русским словам не подходит к английским записям «on computer: …»');
  assert.ok(src.includes('/^(on computer|in folder): /'));
  assert.ok(read('public/en/agent.js').includes("return 'on computer: '") && read('public/en/folder.js').includes("return 'in folder: '"));
});

test('клиент: карточка проекта — ссылка на архив, без подстановки разметки из имени папки', () => {
  for (const lang of ['ru', 'en']) {
    const ctx = { console: { log() {}, warn() {} }, Map, Set, Date, Math, String, RegExp, encodeURIComponent, requestAnimationFrame: () => 0 };
    ctx.document = { documentElement: { lang }, getElementById: () => null, querySelector: () => null, addEventListener() {}, head: { appendChild() {} }, createElement: () => ({}) };
    ctx.window = ctx; vm.createContext(ctx);
    vm.runInContext("const esc = (s) => String(s).replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c]));", ctx);
    vm.runInContext(read('public/js/02a-rich.js'), ctx);
    const html = vm.runInContext('cloudFilesHtml', ctx)({ cfiles: { files: [], more: 0, dirs: [{ path: '~/shop', name: 'shop', files: 12, size: 345678 }, { path: '~/a"><img src=x>', name: 'a"><img src=x>', files: 2, size: 10 }] } });
    assert.ok(html.includes('class="ofile clzip"') && html.includes('href="/api/cloud/zip?path=' + encodeURIComponent('~/shop') + '"') && html.includes('download="shop.zip"'), lang);
    assert.match(html, lang === 'en' ? /project · 12 files/ : /проект · файлов: 12/); assert.match(html, lang === 'en' ? /download ZIP/ : /скачать ZIP/);
    assert.ok(!html.includes('<img'), lang + ': имя папки экранируется');
    assert.equal(vm.runInContext('cloudFilesHtml', ctx)({ cfiles: { files: [], more: 0, dirs: [] } }), '');
  }
});

test('свой компьютер: остановленная задача не остаётся в очереди помощника', async (t) => {
  const dir = copyApp(); t.after(() => rm(dir));
  const code = `const a = require('./agent');
    (async () => {
      const c1 = new AbortController(); const p = a.poll('u1', { host: 'pc' }, c1.signal); c1.abort(); await p; // помощник на связи, но сейчас не ждёт задачу
      const stop = new AbortController();
      const run = a.call('u1', () => {}, 'computer_list', { path: '~' }, 'all', stop.signal).catch((e) => 'Ошибка: ' + e.message);
      await new Promise((r) => setTimeout(r, 20)); stop.abort(); const res = await run;
      const c2 = new AbortController(); const next = await Promise.race([a.poll('u1', { host: 'pc' }, c2.signal), new Promise((r) => setTimeout(() => r('пусто'), 100))]); c2.abort();
      console.log(JSON.stringify({ res: String(res), next })); process.exit(0);
    })();`;
  const out = require('child_process').execFileSync(process.execPath, ['-e', code], { cwd: dir, encoding: 'utf8', timeout: 20000 });
  const r = JSON.parse(out.trim().split('\n').at(-1));
  assert.match(r.res, /остановил/); assert.equal(r.next, 'пусто', 'помощник не получает задачу, которую уже никто не ждёт');
});
