'use strict';
// Жалобы пользователей (ноябрь 2026): ответ не теряется, когда человек ушёл со страницы; файлы облачного компьютера
// скачиваются прямо из ответа; голосовой ввод. node --test tests/chat-resume.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const net = require('node:net');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const freePort = () => new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const parse = (text) => text.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
const textOf = (lines) => lines.filter((x) => typeof x.t === 'string').map((x) => x.t).join('');

// Поддельный провайдер: SLOW — ответ идёт несколько секунд; FILE — модель пишет файл в облачный компьютер и называет его в ответе
function provider() {
  const st = { calls: 0 };
  const srv = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      st.calls++;
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch {}
      const msgs = body.messages || [], users = msgs.filter((m) => m.role === 'user'), last = users.at(-1) || {};
      const text = typeof last.content === 'string' ? last.content : (last.content || []).map((p) => p.text || '').join(' ');
      const send = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
      const done = () => { res.write('data: [DONE]\n\n'); res.end(); };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (/FILE/.test(text) && (body.tools || []).some((x) => x.function?.name === 'computer_write') && !msgs.some((m) => m.role === 'tool')) {
        send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'computer_write', arguments: JSON.stringify({ path: '~/work/отчёт.pdf', content: '%PDF-1.4 test' }) } }] } }] });
        send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
        return done();
      }
      if (/FILE/.test(text)) { send({ choices: [{ delta: { content: 'Готово: файл отчёт.pdf лежит в папке work.' } }] }); return done(); }
      if (/SLOW/.test(text)) { for (const c of ['раз ', 'два ', 'три ', 'четыре ', 'пять']) { send({ choices: [{ delta: { content: c } }] }); await delay(500); } return done(); }
      send({ choices: [{ delta: { content: 'Привет, мир' } }] }); done();
    });
  });
  return { st, listen: () => new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok('http://127.0.0.1:' + srv.address().port))), close: () => new Promise((ok) => { srv.closeAllConnections?.(); srv.close(() => ok()); }) };
}

async function boot(t, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'premier-resume-'));
  const fake = provider(), fakeUrl = await fake.listen();
  let child = null, store, logs = '';
  const stop = async () => { if (child && child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([new Promise((r) => child.once('exit', r)), delay(6000)]); if (child.exitCode === null) child.kill('SIGKILL'); } child = null; };
  t.after(async () => { await stop(); if (store) store.db.close(); await fake.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  fs.cpSync(root, dir, { recursive: true, filter: (src) => {
    const rel = path.relative(root, src), top = rel.split(path.sep)[0];
    return !rel || ['public', 'locales', 'desktop', 'api', 'admin', 'sandbox'].includes(top) || (!rel.includes(path.sep) && !top.startsWith('.') && /\.(js|json)$/.test(top));
  } });
  store = require(path.join(dir, 'db.js'));
  const tokens = {};
  for (const id of ['u1', 'u2']) {
    store.users.put({ id, login: id, email: id + '@example.invalid', plan: 'max', until: Date.now() + 864e5, created: new Date().toISOString() });
    tokens[id] = crypto.randomBytes(32).toString('hex'); store.sessions.put(sha(tokens[id]), id, Date.now() + 3600e3);
  }
  store.kv.set('models', [{ id: 'm1', name: 'Fake', modelId: 'fake-1', baseUrl: fakeUrl + '/v1', apiKey: 'sk-fake-upstream-key', plans: ['free', 'pro', 'max'], weight: 1 }]);
  const port = await freePort(), base = 'http://127.0.0.1:' + port;
  const start = async () => {
    child = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PUBLIC_URL: base, CODE_RUNNER: 'off', CLOUD_RUNNER: 'off', PROBE_MODELS: 'off', ADMIN_PASSWORD: crypto.randomBytes(24).toString('base64url'), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => (logs += d)); child.stderr.on('data', (d) => (logs += d));
    for (let i = 0; i < 150; i++) { try { if ((await fetch(base + '/healthz')).ok) return; } catch {} await delay(100); if (child.exitCode != null) throw new Error('сервер не запустился:\n' + logs); }
    throw new Error('сервер не ответил:\n' + logs);
  };
  await start();
  const headers = (uid = 'u1') => ({ Cookie: 'premier_session=' + tokens[uid], 'Content-Type': 'application/json', Origin: base });
  const post = (text, extra = {}, signal) => fetch(base + '/api/chat', { method: 'POST', headers: headers(), signal, body: JSON.stringify({ model: 'm1', messages: [{ role: 'user', content: text }], ...extra }) });
  const resume = (g, from = 0, uid = 'u1') => fetch(base + '/api/chat/resume?g=' + g + '&from=' + from, { headers: headers(uid) });
  return { dir, base, headers, post, resume, fake, restart: async () => { await stop(); await start(); }, logs: () => logs };
}

test('чат: отметка конца, уход со страницы посреди ответа, дочитывание — в том числе после перезапуска сервера', { timeout: 90000 }, async (t) => {
  const s = await boot(t);
  // обычный ответ заканчивается отметкой {fin:1}
  const ok = parse(await (await s.post('HELLO', { mid: 'gen-ok' })).text());
  assert.equal(textOf(ok), 'Привет, мир'); assert.deepEqual(ok.at(-1), { fin: 1 });
  assert.ok(s.fake.st.calls >= 1);

  // человек ушёл посреди ответа: соединение закрыто, ответ на сервере готовится дальше
  const ac = new AbortController(), r = await s.post('SLOW', { mid: 'gen-slow' }, ac.signal), rd = r.body.getReader();
  let got = ''; while (!/раз/.test(got)) { const { done, value } = await rd.read(); if (done) break; got += Buffer.from(value).toString(); }
  ac.abort(); await delay(200);
  const seen = parse(got).length;
  // вернулся: дочитывает с того места, где остановился, — до отметки конца
  const rest = parse(await (await s.resume('gen-slow', seen)).text());
  assert.deepEqual(rest.at(-1), { fin: 1 });
  assert.equal(textOf(parse(got)) + textOf(rest), 'раз два три четыре пять');
  const all = parse(await (await s.resume('gen-slow')).text());
  assert.equal(textOf(all), 'раз два три четыре пять'); assert.deepEqual(all.at(-1), { fin: 1 });
  assert.equal(all.length, seen + rest.length, 'нумерация строк не сбивается');
  // чужой ответ и неизвестный номер — 404
  assert.equal((await s.resume('gen-slow', 0, 'u2')).status, 404);
  assert.equal((await s.resume('gen-none')).status, 404);

  // готовый ответ лежит на диске и переживает перезапуск сервера
  for (let i = 0; i < 50 && !fs.existsSync(path.join(s.dir, 'data', 'gens', 'u1', 'gen-slow.ndjson')); i++) await delay(100);
  await s.restart();
  const kept = parse(await (await s.resume('gen-slow')).text());
  assert.deepEqual(kept, all);
  assert.deepEqual(parse(await (await s.resume('gen-slow', seen)).text()), rest);
  assert.equal((await s.resume('gen-slow', 0, 'u2')).status, 404);
  // новый ответ с тем же номером стирает старый с диска
  const again = parse(await (await s.post('HELLO', { mid: 'gen-slow' })).text());
  assert.equal(textOf(again), 'Привет, мир');
  for (let i = 0; i < 30; i++) { if (textOf(parse(await (await s.resume('gen-slow')).text())) === 'Привет, мир') break; await delay(100); }
  assert.equal(textOf(parse(await (await s.resume('gen-slow')).text())), 'Привет, мир');
});

test('чат: без слушателей ответ готовится CHAT_ORPHAN_MIN минут, а не обрывается сразу', { timeout: 60000 }, async (t) => {
  const s = await boot(t, { CHAT_ORPHAN_MIN: '1' });
  const ac = new AbortController(), r = await s.post('SLOW', { mid: 'gen-away' }, ac.signal), rd = r.body.getReader();
  await rd.read(); ac.abort();
  await delay(3500); // ответ дописан без единого слушателя
  const all = parse(await (await s.resume('gen-away')).text());
  assert.equal(textOf(all), 'раз два три четыре пять'); assert.equal(all.filter((x) => x.e).length, 0); assert.deepEqual(all.at(-1), { fin: 1 });
});

test('хранилище ответов: запись, чтение, чужой пользователь, срок хранения, удаление', { timeout: 30000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'premier-gens-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(path.join(root, 'chat-gens.js'), path.join(dir, 'chat-gens.js'));
  const g = require(path.join(dir, 'chat-gens.js')), lines = ['{"t":"а"}\n', '{"t":"б"}\n', '{"fin":1}\n'];
  assert.equal(await g.save('u1', 'g1', lines), true);
  assert.deepEqual(g.load('u1', 'g1'), lines);
  assert.equal(g.load('u2', 'g1'), null);
  assert.equal(g.load('u1', '../g1'), null); assert.equal(g.load('u1', 'g2'), null);
  const file = path.join(dir, 'data', 'gens', 'u1', 'g1.ndjson');
  assert.equal(fs.statSync(file).mode & 0o077, 0, 'файл ответа читает только сервер');
  // чужой файл, подложенный в папку пользователя, не отдаётся
  fs.mkdirSync(path.join(dir, 'data', 'gens', 'u2'), { recursive: true }); fs.copyFileSync(file, path.join(dir, 'data', 'gens', 'u2', 'g1.ndjson'));
  assert.equal(g.load('u2', 'g1'), null);
  const old = new Date(Date.now() - g.KEEP_MS - 60000); fs.utimesSync(file, old, old);
  assert.equal(g.load('u1', 'g1'), null, 'устаревший ответ не отдаётся');
  fs.copyFileSync(path.join(dir, 'data', 'gens', 'u2', 'g1.ndjson'), path.join(dir, 'data', 'gens', 'u1', 'g9.ndjson')); fs.utimesSync(path.join(dir, 'data', 'gens', 'u1', 'g9.ndjson'), old, old);
  assert.ok(g.sweep() >= 1); assert.equal(fs.existsSync(path.join(dir, 'data', 'gens', 'u1', 'g9.ndjson')), false, 'устаревший ответ удаляется');
  await g.save('u1', 'g3', lines); g.drop('u1', 'g3'); await delay(100); assert.equal(g.load('u1', 'g3'), null);
  await g.save('u1', 'g4', lines); g.removeUser('u1');
  for (let i = 0; i < 30 && fs.existsSync(path.join(dir, 'data', 'gens', 'u1')); i++) await delay(50);
  assert.equal(fs.existsSync(path.join(dir, 'data', 'gens', 'u1')), false);
});

test('облачный компьютер: файл из ответа — карточка «Скачать», отдача с диска с перемоткой, ссылки наружу закрыты', { timeout: 90000 }, async (t) => {
  const s = await boot(t, { CLOUD_RUNNER: 'local' });
  const lines = parse(await (await s.post('FILE', { cloud: true, mid: 'gen-file' })).text());
  assert.equal(lines.filter((x) => x.e).length, 0, JSON.stringify(lines.filter((x) => x.e)) + s.logs());
  const cf = lines.find((x) => x.cfiles)?.cfiles;
  assert.ok(cf, 'сервер сообщает о новых файлах: ' + JSON.stringify(lines).slice(0, 600));
  assert.deepEqual(cf.files.map((f) => [f.path, f.name, f.kind]), [['~/work/отчёт.pdf', 'отчёт.pdf', 'doc']]);
  assert.equal(cf.files[0].size, 13); assert.equal(cf.more, 0);
  assert.ok(lines.findIndex((x) => x.cfiles) < lines.findIndex((x) => x.fin));

  const home = path.join(s.dir, 'data', 'cloud', 'u1'), url = (p, more = '') => s.base + '/api/cloud/file?path=' + encodeURIComponent(p) + more;
  const big = crypto.randomBytes(300000); fs.writeFileSync(path.join(home, 'clip.mp4'), big);
  const h = { headers: s.headers() };
  // целиком: как вложение
  const full = await fetch(url('~/clip.mp4'), h);
  assert.equal(full.status, 200); assert.equal(full.headers.get('accept-ranges'), 'bytes'); assert.match(full.headers.get('content-disposition'), /^attachment/);
  assert.equal(full.headers.get('content-type'), 'application/octet-stream'); assert.ok(Buffer.from(await full.arrayBuffer()).equals(big));
  // часть файла: перемотка видео и проверка перед скачиванием
  const part = await fetch(url('~/clip.mp4'), { headers: { ...s.headers(), Range: 'bytes=100-199' } });
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), 'bytes 100-199/300000'); assert.ok(Buffer.from(await part.arrayBuffer()).equals(big.subarray(100, 200)));
  const tail = await fetch(url('~/clip.mp4'), { headers: { ...s.headers(), Range: 'bytes=-50' } });
  assert.equal(tail.status, 206); assert.ok(Buffer.from(await tail.arrayBuffer()).equals(big.subarray(299950)));
  const first = await fetch(url('~/clip.mp4'), { headers: { ...s.headers(), Range: 'bytes=0-0' } });
  assert.equal(first.status, 206); assert.equal((await first.arrayBuffer()).byteLength, 1);
  assert.equal((await fetch(url('~/clip.mp4'), { headers: { ...s.headers(), Range: 'bytes=300000-' } })).status, 416);
  // показ в странице: только видео, звук и картинки; страница в песочнице
  const inl = await fetch(url('~/clip.mp4', '&inline=1'), h);
  assert.equal(inl.headers.get('content-type'), 'video/mp4'); assert.match(inl.headers.get('content-disposition'), /^inline/); assert.match(inl.headers.get('content-security-policy'), /sandbox/); assert.equal(inl.headers.get('x-content-type-options'), 'nosniff'); await inl.arrayBuffer();
  fs.writeFileSync(path.join(home, 'page.html'), '<script>alert(1)</script>');
  const page = await fetch(url('~/page.html', '&inline=1'), h);
  assert.equal(page.headers.get('content-type'), 'application/octet-stream'); assert.match(page.headers.get('content-disposition'), /^attachment/); await page.arrayBuffer();
  // без входа и чужой файл
  assert.equal((await fetch(url('~/clip.mp4'))).status, 401);
  assert.notEqual((await fetch(url('~/clip.mp4'), { headers: s.headers('u2') })).status, 200);

  // ссылка (symlink) из домашней папки наружу напрямую не открывается
  const cloud = require(path.join(s.dir, 'cloud.js'));
  const secret = path.join(s.dir, 'secret.txt'); fs.writeFileSync(secret, 'top secret');
  fs.symlinkSync(secret, path.join(home, 'leak.txt')); fs.symlinkSync(s.dir, path.join(home, 'up'));
  assert.equal(cloud.openFile('u1', '~/leak.txt'), null); assert.equal(cloud.openFile('u1', '~/up/secret.txt'), null);
  assert.equal(cloud.openFile('u1', '~/../secret.txt'), null); assert.equal(cloud.openFile('u1', '/etc/passwd'), null);
  assert.equal(cloud.openFile('u1', '~/work'), null); assert.equal(cloud.openFile('u1', '~/нет.txt'), null);
  const f = cloud.openFile('u1', '~/work/отчёт.pdf'); assert.equal(f.size, 13); assert.equal(f.name, 'отчёт.pdf'); fs.closeSync(f.fd);

  // какие файлы попадают в карточки
  const since = Date.now() - 1000;
  fs.mkdirSync(path.join(home, 'node_modules', 'x'), { recursive: true }); fs.writeFileSync(path.join(home, 'node_modules', 'x', 'big.zip'), 'zip');
  fs.mkdirSync(path.join(home, '.cache'), { recursive: true }); fs.writeFileSync(path.join(home, '.cache', 'tmp.mp4'), 'x');
  fs.writeFileSync(path.join(home, 'script.py'), 'print(1)'); fs.writeFileSync(path.join(home, 'notes.txt'), 'текст'); fs.writeFileSync(path.join(home, 'empty.pdf'), '');
  const fr = await cloud.fresh('u1', since, 'Сделал ролик, код — в script.py.');
  const names = fr.files.map((x) => x.name);
  assert.deepEqual(names.slice(0, 2), ['script.py', 'clip.mp4'], 'сначала названный в ответе файл, потом видео');
  assert.ok(names.includes('отчёт.pdf')); assert.ok(!names.includes('notes.txt'), 'служебные файлы без упоминания не показываем');
  assert.ok(!names.includes('big.zip') && !names.includes('tmp.mp4') && !names.includes('empty.pdf') && !names.includes('leak.txt'));
  assert.equal(fr.files.find((x) => x.name === 'clip.mp4').view, 1); assert.equal(fr.files.find((x) => x.name === 'отчёт.pdf').view, undefined);
  assert.deepEqual((await cloud.fresh('u1', Date.now() + 60000, '')).files, []);
  for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(home, 'doc' + i + '.pdf'), 'x');
  const many = await cloud.fresh('u1', since, ''); assert.equal(many.files.length, 12); assert.ok(many.more >= 10);
});

test('дочитывание: переполненный буфер заканчивается ошибкой и отметкой конца, а не «готовым» обрезанным ответом', { timeout: 30000 }, async (t) => {
  const src = read('server.js').match(/^function genTail\(lines, cut, from\) \{[\s\S]*?^\}/m);
  assert.ok(src, 'genTail есть в server.js');
  const genTail = vm.runInNewContext('(' + src[0] + ')');
  const a = '{"t":"а"}\n', b = '{"t":"б"}\n', err = '{"e":"слишком большой"}\n', fin = '{"fin":1}\n';
  const plain = (x) => Array.from(x);
  assert.deepEqual(plain(genTail([a, b, fin], null, 1)), [b, fin], 'обычный ответ — как раньше');
  assert.deepEqual(plain(genTail([a, b, fin], undefined, 5)), []);
  const full = [a, b, err, fin]; // после б буфер переполнился: дальше события шли только подключённым клиентам
  assert.deepEqual(plain(genTail(full, 2, 0)), [a, b, err, fin]);
  assert.deepEqual(plain(genTail(full, 2, 3)), [err, fin], 'клиент успел получить несохранённое событие — одной отметки конца мало');
  assert.deepEqual(plain(genTail(full, 2, 500)), [err, fin], 'позиция за концом буфера — ответ конечный, без бесконечных повторов');
  assert.deepEqual(plain(genTail([a, b, err], 2, 7)), [err, fin], 'генерация ещё идёт — дочитывание всё равно заканчивается');
  // отметка переполнения переживает запись на диск
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'premier-gens-cut-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(path.join(root, 'chat-gens.js'), path.join(dir, 'chat-gens.js'));
  const g = require(path.join(dir, 'chat-gens.js'));
  assert.equal(await g.save('u1', 'big', full, 2), true); assert.equal(await g.save('u1', 'ok', [a, fin]), true);
  assert.equal(g.load('u1', 'big').cut, 2); assert.equal(g.load('u1', 'ok').cut, undefined);
  assert.deepEqual(plain(genTail(g.load('u1', 'big'), g.load('u1', 'big').cut, 3)), [err, fin]);
});

test('клиент: чат, где пишется ответ, не затирает правки с другого устройства и не уходит на сервер недописанным (RU и EN)', () => {
  for (const file of ['public/js/01-core.js', 'public/en/js/01-core.js']) {
    const code = read(file), pick = (re) => { const m = code.match(re); assert.ok(m, file + ': ' + re); return m[0]; };
    const src = [/^const TRANSIENT = .*$/m, /^const clean = .*$/m, /^const hash = .*$/m, /^const weight = .*$/m, /^function applyRemote\(j\) \{[\s\S]*?^\}/m, /^const pushFirst = .*$/m, /^function settleRemote\(id\) \{[\s\S]*?^\}/m].map(pick).join('\n');
    const ctx = vm.createContext({ S: { chats: [], del: [], projects: [], cur: 'c1', proj: null }, SYNC: { rev: 1, sent: {}, metaSent: '' }, busyMap: new Map(), JSON, Set, Map, Object, Math, Array });
    vm.runInContext(src + '\nthis.api = { applyRemote, settleRemote, heldRemote, pushFirst, hash, clean };', ctx);
    const { S, SYNC, busyMap, api } = ctx;
    const q1 = { id: 'm1', r: 'u', t: 'вопрос' }, live = { id: 'm2', r: 'a', t: 'половина отв' };
    S.chats.push({ id: 'c1', title: 'чат', msgs: [q1, live] }); busyMap.set('c1', {});
    // с другого устройства пришла версия с продолжением разговора — пока идёт ответ, свой чат не трогаем и её не «подтверждаем»
    const remote = { id: 'c1', title: 'чат', msgs: [q1, { id: 'm2', r: 'a', t: 'полный ответ' }, { id: 'm3', r: 'u', t: 'ещё вопрос' }, { id: 'm4', r: 'a', t: 'ещё ответ' }] };
    assert.equal(api.applyRemote({ chats: [{ id: 'c1', v: 5, data: remote }] }), false);
    assert.equal(S.chats[0].msgs[1], live, file + ': сообщение, в которое пишется ответ, остаётся тем же объектом');
    assert.equal(SYNC.sent.c1, undefined, file + ': чужая версия не отмечена как известная — иначе её затрёт следующая отправка');
    assert.equal(api.applyRemote({ chats: [{ id: 'c1', v: 6, data: null }] }), false); assert.equal(S.chats.length, 1, 'удаление на другом устройстве не рвёт идущий ответ');
    busyMap.delete('c1'); live.t = 'полный ответ';
    assert.equal(api.settleRemote('c1'), true); assert.equal(S.chats[0].msgs.length, 4, file + ': остаётся более полная версия — с продолжением');
    assert.equal(SYNC.sent.c1, api.hash(api.clean(remote)));
    // своя версия полнее — остаётся она
    busyMap.set('c1', {}); const mine = S.chats[0];
    api.applyRemote({ chats: [{ id: 'c1', v: 7, data: { id: 'c1', title: 'чат', msgs: [q1] } }] }); busyMap.delete('c1');
    assert.equal(api.settleRemote('c1'), false); assert.equal(S.chats[0], mine); assert.equal(api.settleRemote('c1'), false);
    // отправка: чат с идущим ответом уходит один раз, в начале (pushNow), а не каждым принудительным push
    assert.match(code, /if \(busy && !pushFirst\.has\(c\.id\)\) continue;/, file);
  }
  for (const file of ['public/js/05-chat.js', 'public/en/js/05-chat.js']) {
    const code = read(file);
    assert.match(code, /if \(!resumed\) pushNow\(c\.id\);/, file); assert.match(code, /if \(settleRemote\(c\.id\)\)/, file);
    assert.doesNotMatch(code, /\bpush\(true\)/, file + ': принудительная отправка — только через pushNow');
  }
});

test('клиент: вопрос уходит на сервер снимком с пустым ответом даже после задержки; отложенная чужая версия переживает перезагрузку (RU и EN)', async () => {
  const tick = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  for (const file of ['public/js/01-core.js', 'public/en/js/01-core.js']) {
    const code = read(file), pick = (re) => { const m = code.match(re); assert.ok(m, file + ': ' + re); return m[0]; };
    const src = [/^const TRANSIENT = .*$/m, /^const clean = .*$/m, /^const hash = .*$/m, /^const weight = .*$/m, /^function applyRemote\(j\) \{[\s\S]*?^\}/m, /^async function push\(now\) \{[\s\S]*?^\}/m,
      /^const pushFirst = .*$/m, /^function pushNow\(id\) .*$/m, /^function settleRemote\(id\) \{[\s\S]*?^\}/m, /^async function pull\(\) \{[\s\S]*?^\}/m].map(pick).join('\n');
    const calls = [], replies = [];
    const fetch = async (url, opt) => { calls.push({ url, body: opt && opt.body ? JSON.parse(opt.body) : null }); const r = replies.shift(); if (!r) throw new Error('нет сети'); return { status: 200, ok: true, json: async () => r }; };
    const ctx = vm.createContext({ S: { chats: [], del: [], projects: [], cur: 'c1', proj: null }, SYNC: { rev: 1, sent: {}, metaSent: '{}' }, busyMap: new Map(), fetch, setTimeout: () => 0, clearTimeout: () => {} });
    vm.runInContext('let pushing = false, pushT = 0; const anyBusy = () => busyMap.size > 0, metaOf = () => ({}), persistLocal = () => {}, afterRemote = () => {}, toLogin = () => {};\n' + src
      + '\nthis.api = { applyRemote, settleRemote, heldRemote, pushFirst, hash, clean, push, pull, pushNow };', ctx);
    const { S, SYNC, busyMap, api } = ctx;
    const q1 = { id: 'm1', r: 'u', t: 'вопрос' }, live = { id: 'm2', r: 'a', t: '', live: true, pendingGen: 1 };
    S.chats.push({ id: 'c1', title: 'чат', msgs: [q1, live] }); busyMap.set('c1', {});
    // 1. первая отправка не прошла (нет сети), ответ тем временем пишется — повтор отправляет тот же снимок с пустым ответом
    api.pushNow('c1'); await tick(); assert.equal(calls.length, 1); assert.equal(api.pushFirst.has('c1'), true, file + ': снимок ждёт повтора');
    live.t = 'половина отв';
    const snap = { id: 'c1', title: 'чат', msgs: [q1, { id: 'm2', r: 'a', t: '' }] };
    replies.push({ rev: 2, chats: [{ id: 'c1', v: 2, data: snap }], conflicts: [] });
    await api.push(true); await tick();
    assert.equal(calls.length, 2); assert.equal(calls[1].body.put.length, 1);
    assert.equal(calls[1].body.put[0].msgs[1].t, '', file + ': на сервер ушёл пустой ответ, а не недописанный текст — другое устройство его дочитает');
    assert.equal(api.pushFirst.has('c1'), false); assert.equal(SYNC.rev, 2);
    assert.equal(SYNC.held, undefined, file + ': своя же отправка, вернувшаяся от сервера, не откладывается');
    await api.push(true); await tick(); assert.equal(calls.length, 2, file + ': пока пишется ответ, чат больше не отправляется');
    // 2. пока шёл ответ, с другого устройства пришла более полная версия; отметка о ней сохраняется вместе с ревизией
    const remote = { id: 'c1', title: 'чат', msgs: [q1, { id: 'm2', r: 'a', t: 'полный ответ' }, { id: 'm3', r: 'u', t: 'ещё вопрос' }, { id: 'm4', r: 'a', t: 'ещё ответ' }] };
    api.applyRemote({ chats: [{ id: 'c1', v: 3, data: remote }] }); SYNC.rev = 3;
    assert.equal(SYNC.held.c1, 2, file + ': запомнена ревизия, с которой чат нужно запросить заново');
    assert.equal(JSON.parse(JSON.stringify(SYNC)).held.c1, 2, 'отметка лежит в SYNC — он сохраняется в localStorage');
    // страницу перезагрузили: версия из памяти пропала, ответ дочитан
    api.heldRemote.clear(); busyMap.delete('c1'); live.t = 'полный ответ'; delete live.live; delete live.pendingGen;
    assert.equal(api.settleRemote('c1'), false);
    replies.push({ rev: 3, chats: [{ id: 'c1', v: 3, data: remote }] });
    await api.push(); await tick();
    assert.equal(calls.length, 3); assert.equal(calls[2].body, null, file + ': чат с неразобранной чужой версией не отправляется');
    assert.equal(calls[2].url, '/api/sync?since=2', file + ': изменения запрошены с ревизии до отложенной версии');
    assert.equal(S.chats[0].msgs.length, 4, file + ': продолжение разговора с другого устройства не потеряно');
    assert.equal(SYNC.held, undefined); assert.equal(SYNC.sent.c1, api.hash(api.clean(remote)));
  }
});

test('клиент: голосовой ввод — язык страницы, а не системы; на телефоне один сеанс на фразу (RU и EN)', () => {
  const ru = read('public/js/11-voice.js'), en = read('public/en/js/11-voice.js');
  assert.match(ru, /const MIC_LANG = 'ru-RU';/); assert.doesNotMatch(ru, /navigator\.language/, 'русская страница не смотрит на язык системы');
  assert.match(en, /const MIC_LANG = [^;]*'en-US'/);
  for (const [name, code] of [['ru', ru], ['en', en]]) {
    assert.match(code, /r\.continuous = !MIC_PHONE/, name); assert.match(code, /r\.lang = MIC_LANG/, name);
    assert.match(code, /function micStop\(drop\)/, name); assert.doesNotMatch(code, /fin \+= /, name + ': текст собирается заново из результатов, а не дописывается');
  }
  for (const f of ['public/js/05-chat.js', 'public/en/js/05-chat.js']) assert.match(read(f), /micStop\(true\)/, f + ': после отправки поздние результаты в поле не попадают');
});
