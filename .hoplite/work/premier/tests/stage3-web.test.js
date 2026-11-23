// Этап 3 плана: архив результатов Python, опубликованные сайты, превью и WebSocket.
//   CLD-06 — разбор tar: неверный размер, контрольная сумма, рост смещения, предел записей; разбор вне главного потока
//   CLD-12 — файлы опубликованного сайта отдаются с CORS, allow-same-origin не добавлен
//   CLD-13 — превью только на случайных поддоменах; один общий адрес выключен
//   CLD-14 — превью закрывает соединение с контейнером, когда браузер ушёл; таймауты; предел запросов на пользователя
//   CLD-15 — WebSocket: предел числа фрагментов и времени сборки сообщения
//   CLD-18 — результаты Python: предел места на аккаунт и срок хранения
// Запуск: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), http = require('http'), net = require('net'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const { copyApp, startServer, rm, sha, ROOT } = require('../test/helpers');
const { sleep } = require('./stage3-util');

/* ---------- tar вручную: заголовок с верной (или испорченной) контрольной суммой ---------- */
function hdr(name, size, { type = '0', rawSize, badSum } = {}) {
  const b = Buffer.alloc(512); b.write(name, 0, 100, 'utf8'); b.write('0000644\0', 100); b.write('0000000\0', 108); b.write('0000000\0', 116);
  if (rawSize) Buffer.from(rawSize).copy(b, 124); else b.write(size.toString(8).padStart(11, '0') + '\0', 124);
  b.write('00000000000\0', 136); b.write(type, 156); b.write('ustar\0' + '00', 257);
  b.fill(0x20, 148, 156); let sum = 0; for (const c of b) sum += c;
  b.write((badSum ? sum + 1 : sum).toString(8).padStart(6, '0') + '\0 ', 148);
  return b;
}
const entry = (name, data, o) => { const d = Buffer.from(data); return Buffer.concat([hdr(name, d.length, o), d, Buffer.alloc((512 - d.length % 512) % 512)]); };
const END = Buffer.alloc(1024);
const good = (...more) => Buffer.concat([entry('out/a.txt', 'привет'), ...more, entry('stdout', 'вывод\n'), entry('stderr', ''), entry('rc', '0\n'), END]);

test('CLD-06: разбор tar — неверный размер, контрольная сумма и число записей отклоняются; цикла нет', async (t) => {
  const tar = require(path.join(ROOT, 'tar-read.js'));
  // настоящий архив от программы tar и собранный вручную разбираются одинаково
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(require('os').tmpdir()), 'premier-tar-')); t.after(() => rm(dir));
  fs.mkdirSync(path.join(dir, 'out', 'sub'), { recursive: true }); fs.mkdirSync(path.join(dir, 'm'));
  fs.writeFileSync(path.join(dir, 'out', 'a.txt'), 'привет'); fs.writeFileSync(path.join(dir, 'out', 'sub', 'b'.repeat(120) + '.bin'), crypto.randomBytes(5000));
  fs.writeFileSync(path.join(dir, 'm', 'rc'), '0\n'); fs.writeFileSync(path.join(dir, 'm', 'stdout'), 'вывод\n'); fs.writeFileSync(path.join(dir, 'm', 'stderr'), '');
  const real = execFileSync('tar', ['-cf', '-', 'out', '-C', 'm', 'stdout', 'stderr', 'rc'], { cwd: dir, maxBuffer: 1e8 });
  let r = tar.parse(real);
  assert.equal(r.ok, true); assert.deepEqual(r.files.map((f) => [f.rel, f.size]).sort(), [['a.txt', 12], ['sub/' + 'b'.repeat(120) + '.bin', 5000]]);
  assert.equal(r.meta.stdout, 'вывод\n'); assert.equal(r.meta.rc, '0\n');
  r = tar.parse(good()); assert.equal(r.ok, true); assert.equal(r.files[0].data.toString(), 'привет');

  // отрицательный размер: прежний разбор на таком заголовке не продвигался и зацикливался (размер −512 → смещение на месте)
  const neg = Buffer.concat([hdr('out/x', 0, { rawSize: '-0000001000\0' }), END]);
  const t0 = Date.now(); r = tar.parse(neg);
  assert.equal(r.ok, false); assert.match(r.error, /размер/); assert.deepEqual(r.files, []); assert.ok(Date.now() - t0 < 1000);
  for (const [raw, why] of [['-1\0', 'минус'], [Buffer.from([0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10, 0]), 'двоичная запись'], [Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), 'двоичная отрицательная'],
    ['0x10\0', 'не восьмеричное'], ['00000000009\0', 'цифра 9'], ['1e3\0', 'степень'], ['\0\0\0\0\0\0\0\0\0\0\0\0', 'пусто'], ['12 34\0', 'мусор после числа']]) {
    r = tar.parse(Buffer.concat([hdr('out/x', 0, { rawSize: raw }), END]));
    assert.equal(r.ok, false, why); assert.match(r.error, /размер/, why);
  }
  // испорченный заголовок: всё, что разобрано до него, тоже не принимается — архиву больше нет доверия
  r = tar.parse(Buffer.concat([entry('out/a.txt', 'до'), entry('out/b.txt', 'x', { badSum: true }), entry('rc', '0\n'), END]));
  assert.equal(r.ok, false); assert.match(r.error, /заголовок/); assert.deepEqual(r.files, []); assert.deepEqual(r.meta, {});
  assert.equal(tar.parse(Buffer.from('мусор'.repeat(300))).ok, false); assert.equal(tar.parse(Buffer.alloc(0)).ok, false);
  // слишком много записей
  const many = Buffer.concat([...Array.from({ length: tar.ENTRIES_MAX + 1 }, (_, i) => hdr('out/f' + i, 0)), entry('rc', '0\n'), END]);
  r = tar.parse(many); assert.equal(r.ok, false); assert.match(r.error, /слишком много записей/);
  // оборванный архив: целым не считается
  r = tar.parse(good().subarray(0, 512 + 100)); assert.equal(r.ok, false);
  // выход за пределы каталога и скрытые файлы не попадают в результаты
  r = tar.parse(good(entry('out/../etc/passwd', 'x'), entry('out/.env', 'x'), entry('/etc/shadow', 'x'), entry('out/link', '', { type: '2' })));
  assert.equal(r.ok, true); assert.deepEqual(r.files.map((f) => f.rel), ['a.txt']);
});

test('CLD-06: разбор идёт в отдельном потоке — зависший разбор обрывается по времени, главный поток не замирает', async (t) => {
  const tar = require(path.join(ROOT, 'tar-read.js'));
  const big = good(entry('out/big.bin', crypto.randomBytes(3 * 1048576)));
  const r = await tar.read(big);
  assert.equal(r.ok, true); assert.equal(Buffer.isBuffer(r.files[1].data), true);
  assert.ok(r.files[1].data.equals(tar.parse(big).files[1].data), 'данные из потока совпадают байт в байт');
  const bad = await tar.read(Buffer.concat([hdr('out/x', 0, { rawSize: '-0000001000\0' }), END]));
  assert.equal(bad.ok, false); assert.match(bad.error, /размер/);
  // поток, который не отвечает никогда (как прежний разбор на отрицательном размере)
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(require('os').tmpdir()), 'premier-tar-')); t.after(() => rm(dir));
  const hang = path.join(dir, 'hang.js'); fs.writeFileSync(hang, 'require("worker_threads").parentPort.once("message", () => { for (;;); });');
  let ticks = 0; const iv = setInterval(() => ticks++, 10);
  const t0 = Date.now(), h = await tar.read(good(), { timeout: 400, file: hang }); clearInterval(iv);
  assert.equal(h.ok, false); assert.match(h.error, /слишком много времени/);
  assert.ok(Date.now() - t0 < 3000); assert.ok(ticks >= 15, `главный поток работал, пока шёл разбор (тиков: ${ticks})`);
  const crash = path.join(dir, 'crash.js'); fs.writeFileSync(crash, 'require("worker_threads").parentPort.once("message", () => { throw new Error("сбой"); });');
  assert.equal((await tar.read(good(), { file: crash })).ok, false);
});

/* ---------- Python: поддельный docker отдаёт заранее собранный архив (двоичный, без искажений) ---------- */
function fakeRun(base) {
  const dir = path.join(base, 'fake-run'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'docker'), `#!${process.execPath}
const fs = require('fs'), a = process.argv.slice(2);
if (a[0] === 'image') { process.stdout.write('sha256:test\\n'); process.exit(0); }
if (a[0] === 'run') { process.stdout.write(fs.readFileSync(${JSON.stringify(path.join(dir, 'out.tar'))}), () => process.exit(0)); } else process.exit(0);
`, { mode: 0o755 });
  return { PATH: dir + path.delimiter + process.env.PATH, set: (buf) => fs.writeFileSync(path.join(dir, 'out.tar'), buf) };
}
function coder(t, env = {}) {
  const dir = copyApp(); t.after(() => rm(dir));
  const fake = fakeRun(dir), keys = ['PATH', 'CODE_RUNNER', 'CODE_FILES_MAX_MB', 'CODE_FILES_DAYS'], old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { PATH: fake.PATH, CODE_RUNNER: 'docker', ...env });
  t.after(() => { for (const k of keys) if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; });
  const code = require(path.join(dir, 'code.js'));
  const files = (uid) => path.join(dir, 'data', 'files', uid);
  const dirs = (uid) => { try { return fs.readdirSync(files(uid)).sort(); } catch { return []; } };
  const fidOf = (r) => r.files[0].url.split('/')[3];
  const age = (uid, fid, days, name = code.MARK) => { const d = new Date(Date.now() - days * 864e5); fs.utimesSync(path.join(files(uid), fid, name), d, d); };
  return { dir, code, fake, files, dirs, fidOf, age };
}

test('CLD-06: архив из контейнера с неверным размером — запуск завершается ошибкой, файлы не сохраняются, сервер не зависает', async (t) => {
  const { code, fake, dirs } = coder(t);
  fake.set(Buffer.concat([entry('out/a.txt', 'до'), hdr('out/x', 0, { rawSize: '-0000001000\0' }), END]));
  const t0 = Date.now(), r = await code.run('print(1)', 'u1');
  assert.ok(Date.now() - t0 < 5000); assert.deepEqual(r.files, []); assert.match(r.stderr, /Не удалось получить результаты выполнения \(неверный размер записи в архиве\)/);
  assert.deepEqual(dirs('u1'), []);
  fake.set(good()); const ok = await code.run('print(1)', 'u1');
  assert.equal(ok.exit, 0); assert.equal(ok.stdout, 'вывод\n'); assert.deepEqual(ok.files.map((f) => [f.name, f.size]), [['a.txt', 12]]);
});

test('CLD-18: результаты Python — предел места на аккаунт (старые удаляются) и срок хранения; картинки и ролики не трогаются', async (t) => {
  const { code, fake, files, dirs, fidOf, age } = coder(t, { CODE_FILES_MAX_MB: '1', CODE_FILES_DAYS: '30' });
  const mk = (uid, fid, name, bytes, days) => { const d = path.join(files(uid), fid); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, name), Buffer.alloc(bytes, 1)); if (days) age(uid, fid, days, name); return fid; };
  // у пользователя уже есть картинка, ролик и результат, сохранённый до появления срока хранения, — все давние
  const img = mk('u1', 'a'.repeat(16), 'image.png', 700000, 400), vid = mk('u1', 'b'.repeat(16), 'animation.mp4', 900000, 400), legacy = mk('u1', 'c'.repeat(16), 'otchet.xlsx', 300000, 400);
  const other = mk('u2', 'd'.repeat(16), 'chuzhoe.csv', 900000, 400);
  fake.set(good(entry('out/data.bin', Buffer.alloc(600000, 7))));
  const r1 = await code.run('print(1)', 'u1'), f1 = fidOf(r1);
  assert.deepEqual(r1.keep, { days: 30, maxMB: 1, usedMB: 0.9, purged: 0 }, 'пользователю сообщается срок хранения');
  assert.ok(fs.existsSync(path.join(files('u1'), f1, code.MARK))); assert.equal(code.filePath('u1', f1, code.MARK), null, 'пометка наружу не отдаётся');
  assert.ok(code.filePath('u1', f1, 'data.bin'));
  assert.ok(dirs('u1').includes(legacy), 'прежний результат не удалён задним числом: срок для него начался сейчас');
  assert.ok(fs.existsSync(path.join(files('u1'), legacy, code.MARK)));
  // второй запуск: места больше 1 МБ — уходит самый старый результат (прежний), потом первый запуск
  const r2 = await code.run('print(2)', 'u1'), f2 = fidOf(r2);
  assert.equal(r2.keep.purged, 2); assert.ok(r2.keep.usedMB <= 1);
  assert.deepEqual(dirs('u1'), [img, vid, f2].sort(), 'остались картинка, ролик и свежий результат');
  assert.equal(code.filePath('u1', f1, 'data.bin'), null);
  assert.deepEqual(dirs('u2'), [other], 'чужой аккаунт не затронут');
  // срок хранения: результат старше 30 дней удаляется, 29-дневный остаётся
  age('u1', f2, 29); assert.deepEqual(await code.prune('u1'), { expired: 0, quota: 0, bytes: 600012, runs: 1 });
  age('u1', f2, 31); const p = await code.prune('u1'); assert.equal(p.expired, 1); assert.deepEqual(dirs('u1'), [img, vid].sort());
  // общий обход: чужой прежний результат получил пометку (срок пошёл), после срока — удаляется
  let s = await code.sweep(); assert.deepEqual(s, { users: 2, expired: 0, quota: 0 }); assert.deepEqual(dirs('u2'), [other]);
  age('u2', other, 31); s = await code.sweep(); assert.equal(s.expired, 1); assert.deepEqual(dirs('u2'), []);
  assert.deepEqual(dirs('u1'), [img, vid].sort(), 'картинки и ролики обход не трогает');
  // сервер запускает обход сам и сообщает срок модели и в интерфейс
  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(srv, /coder\.sweep\(\)/); assert.match(srv, /Файлы результатов хранятся \$\{rr\.keep\.days\} дн\./); assert.match(srv, /keep: rr\.keep/);
  for (const f of ['public/js/04-render.js', 'public/en/js/04-render.js']) assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /function keepHtml\(m\)/, f);
});

/* ---------- сервер: опубликованные сайты и превью ---------- */
async function boot(t, env = {}) {
  const dir = copyApp();
  const store = require(path.join(dir, 'db.js'));
  store.users.put({ id: 'u1', login: 'u1', email: 'u1@example.invalid', plan: 'max', until: Date.now() + 864e5, created: new Date().toISOString() });
  const token = crypto.randomBytes(32).toString('hex'); store.sessions.put(sha(token), 'u1', Date.now() + 3600e3); store.db.close();
  const s = await startServer(dir, (port) => ({ PUBLIC_URL: 'http://127.0.0.1:' + port, PROBE_MODELS: 'off', CLOUD_RUNNER: 'local', ...(typeof env === 'function' ? env(port) : env) }));
  t.after(async () => { await s.stop(); rm(dir); });
  const port = Number(new URL(s.base).port);
  // запрос на адрес превью: тот же сервер, другое имя в заголовке Host
  const raw = (host, p, { cookie, method = 'GET', headers = {} } = {}) => {
    let req; const done = new Promise((ok, no) => {
      req = http.request({ host: '127.0.0.1', port, path: p, method, agent: false, headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}), ...headers } }, (res) => {
        const bufs = []; res.on('data', (c) => { bufs.push(c); done.got = Buffer.concat(bufs).toString(); });
        res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(bufs).toString() }));
        res.on('error', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(bufs).toString(), broken: true }));
        res.on('close', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(bufs).toString(), closed: true }));
        done.res = res; if (done.onHead) done.onHead(res);
      });
      req.on('error', (e) => no(e)); req.end();
    });
    done.catch(() => {}); done.abort = () => req.destroy();
    done.head = () => new Promise((ok) => { if (done.res) ok(done.res); else done.onHead = ok; });
    return done;
  };
  // «Открыть сайт»: одноразовая ссылка → адрес превью → cookie
  const open = async (upPort) => {
    const r = await s.req('GET', '/api/cloud/open?port=' + upPort, { token });
    if (r.status !== 302) return { status: r.status, text: r.text };
    const u = new URL(r.headers.get('location')), host = u.host;
    const o = await raw(host, u.pathname + u.search);
    return { status: o.status, host, cookie: String(o.headers['set-cookie'] || '').split(';')[0], headers: o.headers, url: u };
  };
  return { dir, s, token, port, raw, open };
}
// «сервер в контейнере»: /hang — отвечает и держит поток, /never — принимает запрос и молчит, остальное — обычный ответ
function upstream(t, name) {
  const st = { name, open: 0, closed: 0, hits: 0 };
  const srv = http.createServer((req, res) => {
    st.hits++;
    if (req.url.startsWith('/hang')) { st.open++; res.on('close', () => { st.open--; st.closed++; }); res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.write('начало\n'); }
    if (req.url.startsWith('/never')) { st.open++; res.on('close', () => { st.open--; st.closed++; }); return; }
    res.writeHead(200, { 'Content-Type': 'text/plain', 'X-From': name }); res.end('сайт ' + name + ' хост ' + req.headers.host);
  });
  t.after(() => new Promise((ok) => { srv.closeAllConnections?.(); srv.close(() => ok()); }));
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(Object.assign(st, { port: srv.address().port }))));
}
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(20); } return false; };

test('CLD-12: файлы опубликованного сайта отдаются с CORS (модули и данные загружаются), allow-same-origin не добавлен', async (t) => {
  const { dir, s } = await boot(t);
  const id = 'ab12cd34ef', root = path.join(dir, 'data', 'sites', id); fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'sites', id + '.json'), JSON.stringify({ dir: true, uid: 'u1', entry: 'index.html', title: 'Сайт' }));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>до</title><script type="module" src="./assets/app.js"></script>');
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'import { x } from "./dep.js"; const d = await (await fetch("../data.json")).json(); document.title = "модуль " + x + " " + d.ok;');
  fs.writeFileSync(path.join(root, 'assets', 'dep.js'), 'export const x = 42;'); fs.writeFileSync(path.join(root, 'data.json'), '{"ok":true}');
  // страница сайта открыта в sandbox без allow-same-origin: её origin — «null», и модули она запрашивает как чужие
  for (const f of ['/assets/app.js', '/assets/dep.js', '/data.json']) {
    const r = await s.req('GET', `/s/${id}${f}`, { headers: { Origin: 'null', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'script' } });
    assert.equal(r.status, 200, f); assert.equal(r.headers.get('access-control-allow-origin'), '*', f);
    assert.equal(r.headers.get('access-control-allow-credentials'), null, 'с cookie читать нельзя');
    assert.match(r.headers.get('content-security-policy'), /^sandbox /); assert.doesNotMatch(r.headers.get('content-security-policy'), /allow-same-origin/);
  }
  const page = await s.req('GET', `/s/${id}/`, { headers: { 'Sec-Fetch-Dest': 'iframe' } });
  assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /^sandbox allow-scripts/); assert.doesNotMatch(page.headers.get('content-security-policy'), /allow-same-origin/);
  const pre = await s.req('OPTIONS', `/s/${id}/data.json`, { headers: { Origin: 'null', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-test' } });
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), '*'); assert.equal(pre.headers.get('access-control-allow-methods'), 'GET, HEAD');
  assert.equal((await s.req('POST', `/s/${id}/data.json`, { body: {} })).status, 405);
  assert.equal((await s.req('GET', `/s/${id}/.env`)).status, 404);
  // само приложение Premier и его API чужим origin по-прежнему не открыты
  for (const p of ['/healthz', '/api/plans', '/', '/chat.html', `/s/${id}`]) assert.equal((await s.req('GET', p, { headers: { Origin: 'null' } })).headers.get('access-control-allow-origin'), null, p);
  const pub = require(path.join(ROOT, 'publication.js'));
  assert.doesNotMatch(pub.RAW_SANDBOX, /allow-same-origin/); assert.doesNotMatch(pub.wrapper(id, 'т', 'ru', `/s/${id}/`), /allow-same-origin/);
});

test('CLD-13: превью — только случайные поддомены; один общий адрес выключен, пока его не разрешили явно', async (t) => {
  // 1) адрес без «*.»: превью выключено, причина — в журнале; на этом адресе не показывается ни сайт, ни приложение Premier
  const one = await boot(t, (port) => ({ CLOUD_PREVIEW_URL: 'http://pv.test:' + port }));
  const up0 = await upstream(t, 'A');
  assert.equal((await one.s.req('GET', '/api/cloud/ports', { token: one.token })).json.preview, false);
  assert.equal((await one.open(up0.port)).status, 404);
  assert.match(one.s.log(), /CLOUD_PREVIEW_URL задан без «\*\.» — превью сайтов выключено/); assert.match(one.s.log(), /http:\/\/\*\.pv\.test/);
  const parked = await one.raw('pv.test:' + one.port, '/'); assert.equal(parked.status, 503); assert.match(parked.body, /Превью сайтов выключено/);
  assert.equal((await one.raw('pv.test:' + one.port, '/chat.html')).status, 503);
  assert.equal((await one.s.req('POST', '/api/logout', { headers: { Origin: 'http://pv.test:' + one.port }, body: {} })).status, 403, 'запросы к API с адреса превью отклоняются');

  // 2) поддомены: у каждого открытия — свой случайный адрес и своя cookie
  const w = await boot(t, (port) => ({ CLOUD_PREVIEW_URL: 'http://*.pv.test:' + port }));
  const A = await upstream(t, 'A'), B = await upstream(t, 'B');
  assert.equal((await w.s.req('GET', '/api/cloud/ports', { token: w.token })).json.preview, true);
  const a = await w.open(A.port), b = await w.open(B.port), a2 = await w.open(A.port);
  for (const x of [a, b, a2]) { assert.equal(x.status, 302); assert.match(x.host, new RegExp(`^[a-f0-9]{16}\\.pv\\.test:${w.port}$`)); assert.equal(x.headers['clear-site-data'], undefined); }
  assert.equal(new Set([a.host, b.host, a2.host]).size, 3, 'адреса не повторяются даже для одного и того же порта');
  assert.match((await w.raw(a.host, '/', { cookie: a.cookie })).body, /^сайт A хост localhost:/);
  assert.match((await w.raw(b.host, '/', { cookie: b.cookie })).body, /^сайт B /);
  assert.equal((await w.raw(b.host, '/', { cookie: a.cookie })).status, 401, 'cookie одного сайта не подходит к адресу другого');
  assert.equal((await w.raw('pv.test:' + w.port, '/', { cookie: a.cookie })).status, 404, 'общего адреса нет — и приложение Premier на нём не показывается');
  assert.equal((await w.raw('evil.pv.test:' + w.port, '/chat.html')).status === 200, false);
  assert.equal((await w.raw('admin.pv.test:' + w.port, '/chat.html', { cookie: a.cookie })).status, 404);
  assert.equal((await w.raw(a.url.host, a.url.pathname + a.url.search)).status, 403, 'ссылка одноразовая');
  // запросы чередуются между сайтами — соединение с одним сайтом не достаётся другому
  for (let i = 0; i < 6; i++) { const x = i % 2 ? a : b; assert.equal((await w.raw(x.host, '/?' + i, { cookie: x.cookie })).headers['x-from'], i % 2 ? 'A' : 'B'); }

  // 3) старый режим — только с явным CLOUD_PREVIEW_SINGLE=unsafe; при открытии браузеру велено стереть данные адреса
  const u = await boot(t, (port) => ({ CLOUD_PREVIEW_URL: 'http://pv.test:' + port, CLOUD_PREVIEW_SINGLE: 'unsafe' }));
  const o = await u.open(up0.port); assert.equal(o.status, 302); assert.equal(o.host, 'pv.test:' + u.port);
  assert.equal(o.headers['clear-site-data'], '"cache", "storage"'); assert.match(u.s.log(), /CLOUD_PREVIEW_SINGLE=unsafe/);
  assert.match((await u.raw(o.host, '/', { cookie: o.cookie })).body, /^сайт A /);
});

test('CLD-14: превью — соединение с контейнером закрывается, когда браузер ушёл; таймауты; предел запросов на пользователя', { timeout: 60000 }, async (t) => {
  const w = await boot(t, (port) => ({ CLOUD_PREVIEW_URL: 'http://*.pv.test:' + port, CLOUD_PREVIEW_MAX_REQ: '3', CLOUD_PREVIEW_HEAD_MS: '700', CLOUD_PREVIEW_IDLE_MS: '1500' }));
  const A = await upstream(t, 'A'), a = await w.open(A.port), get = (p) => w.raw(a.host, p, { cookie: a.cookie });
  // 1) браузер закрыл вкладку посреди ответа — сервер в контейнере видит закрытие
  let h = get('/hang'); await h.head(); assert.ok(await until(() => A.open === 1));
  h.abort(); assert.ok(await until(() => A.open === 0, 2000), 'соединение с контейнером закрыто сразу после ухода браузера');
  // 2) сервер в контейнере принял запрос и молчит — 504 через CLOUD_PREVIEW_HEAD_MS, соединение закрыто
  let t0 = Date.now(); const never = await get('/never');
  assert.equal(never.status, 504); assert.match(never.body, /не отвечает/); assert.ok(Date.now() - t0 < 4000); assert.ok(await until(() => A.open === 0));
  // 3) поток замолчал — через CLOUD_PREVIEW_IDLE_MS закрыты обе стороны
  t0 = Date.now(); const idle = await get('/hang');
  assert.equal(idle.status, 200); assert.ok(idle.closed || idle.broken); const took = Date.now() - t0; assert.ok(took >= 1300 && took < 6000, 'закрыто через ' + took + ' мс');
  assert.ok(await until(() => A.open === 0));
  // 4) не больше трёх запросов одного пользователя одновременно; место освобождается, когда запрос закрыт
  const hs = [get('/hang'), get('/hang'), get('/hang')]; await Promise.all(hs.map((x) => x.head())); assert.ok(await until(() => A.open === 3));
  const over = await get('/'); assert.equal(over.status, 429); assert.equal(over.headers['retry-after'], '2');
  hs[0].abort(); assert.ok(await until(() => A.open === 2));
  let ok = null; for (let i = 0; i < 20 && (!ok || ok.status !== 200); i++) { ok = await get('/'); if (ok.status !== 200) await sleep(50); }
  assert.equal(ok.status, 200, 'после ухода одного запроса следующий проходит');
  hs[1].abort(); hs[2].abort(); assert.ok(await until(() => A.open === 0));
  // 5) порт, на котором ничего нет: понятная страница, место не занято навсегда
  const free = await new Promise((ok) => { const x = net.createServer(); x.listen(0, '127.0.0.1', () => { const p = x.address().port; x.close(() => ok(p)); }); });
  const dead = await w.open(free); assert.equal(dead.status, 302); for (let i = 0; i < 5; i++) assert.equal((await w.raw(dead.host, '/', { cookie: dead.cookie })).status, 502);
  assert.equal((await get('/')).status, 200);
});

/* ---------- WebSocket ---------- */
const wsFrame = (op, data, fin = true) => {
  const d = Buffer.from(data), mask = crypto.randomBytes(4), n = d.length;
  const head = n < 126 ? Buffer.from([(fin ? 0x80 : 0) | op, 0x80 | n]) : Buffer.from([(fin ? 0x80 : 0) | op, 0x80 | 126, n >> 8, n & 255]);
  const body = Buffer.from(d); for (let i = 0; i < n; i++) body[i] ^= mask[i & 3];
  return Buffer.concat([head, mask, body]);
};
test('CLD-15: WebSocket — предел числа фрагментов и времени сборки сообщения', async (t) => {
  const WS = require(path.join(ROOT, 'ws.js'));
  const srv = http.createServer(); const conns = [], socks = [];
  srv.on('upgrade', (req, socket, head) => { socks.push(socket); const ws = WS.accept(req, socket, head, { maxPayload: 4096, maxFragments: 4, assembleMs: 400 }); const c = { ws, msgs: [], closed: false }; ws.on('message', (m) => c.msgs.push(m)); ws.on('close', () => { c.closed = true; }); conns.push(c); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok)); t.after(() => new Promise((ok) => { for (const x of socks) x.destroy(); srv.close(() => ok()); }));
  const dial = async () => {
    const sock = net.connect(srv.address().port, '127.0.0.1'); socks.push(sock); const st = { sock, data: Buffer.alloc(0), ended: false };
    sock.on('data', (d) => { st.data = Buffer.concat([st.data, d]); }); sock.on('close', () => { st.ended = true; }); sock.on('error', () => {});
    sock.write('GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
    await until(() => st.data.includes('\r\n\r\n')); st.data = Buffer.alloc(0); st.c = conns.at(-1);
    st.code = () => { const i = st.data.indexOf(Buffer.from([0x88, 2])); return i < 0 ? null : st.data.readUInt16BE(i + 2); }; // код закрытия от сервера
    return st;
  };
  // обычное сообщение из трёх фрагментов собирается
  let c = await dial(); c.sock.write(Buffer.concat([wsFrame(1, 'при', false), wsFrame(0, 'в', false), wsFrame(0, 'ет')]));
  assert.ok(await until(() => c.c.msgs.length === 1)); assert.equal(c.c.msgs[0], 'привет'); assert.equal(c.c.closed, false);
  // служебный кадр между фрагментами разрешён; ровно четыре фрагмента — предел, ещё можно
  c.sock.write(Buffer.concat([wsFrame(2, 'a', false), wsFrame(9, 'ping'), wsFrame(0, 'b', false), wsFrame(0, 'c', false), wsFrame(0, 'd')]));
  assert.ok(await until(() => c.c.msgs.length === 2)); assert.equal(c.c.msgs[1].toString(), 'abcd');
  // пустые фрагменты без конца: размер сообщения не растёт, а память — растёт; после четвёртого — закрытие
  c = await dial(); c.sock.write(Buffer.concat([wsFrame(1, '', false), ...Array.from({ length: 200 }, () => wsFrame(0, '', false))]));
  assert.ok(await until(() => c.c.closed)); assert.ok(await until(() => c.code() !== null), "клиент получил кадр закрытия"); assert.equal(c.code(), 1008); assert.deepEqual(c.c.msgs, []);
  // начатое сообщение без конца: закрывается по времени
  c = await dial(); let t0 = Date.now(); c.sock.write(wsFrame(1, 'начало', false));
  assert.ok(await until(() => c.c.closed, 3000)); assert.ok(Date.now() - t0 >= 350, 'не раньше срока'); assert.ok(await until(() => c.code() !== null), "клиент получил кадр закрытия"); assert.equal(c.code(), 1008); assert.ok(await until(() => c.ended), 'соединение разорвано');
  // …даже если клиент продолжает слать фрагменты и служебные кадры: срок считается от начала сообщения
  c = await dial(); t0 = Date.now(); c.sock.write(wsFrame(1, 'a', false));
  const iv = setInterval(() => { if (!c.ended) c.sock.write(wsFrame(9, 'p')); }, 50); t.after(() => clearInterval(iv));
  assert.ok(await until(() => c.c.closed, 3000)); clearInterval(iv); assert.ok(Date.now() - t0 < 2000); assert.ok(await until(() => c.code() !== null), "клиент получил кадр закрытия"); assert.equal(c.code(), 1008);
  // неполный кадр (заголовок обещает 100 байт, пришло 10) — тоже по времени
  c = await dial(); c.sock.write(wsFrame(1, 'x'.repeat(100)).subarray(0, 16));
  assert.ok(await until(() => c.c.closed, 3000)); assert.deepEqual(c.c.msgs, []);
  // обычная работа: редкие короткие сообщения дольше срока сборки соединение не рвут
  c = await dial(); for (let i = 0; i < 4; i++) { c.sock.write(wsFrame(1, 'm' + i)); await sleep(250); }
  assert.deepEqual(c.c.msgs, ['m0', 'm1', 'm2', 'm3']); assert.equal(c.c.closed, false);
  // служебные кадры: длинные и разбитые — нарушение протокола; слишком большое сообщение — 1009
  c = await dial(); c.sock.write(wsFrame(9, 'x'.repeat(126))); assert.ok(await until(() => c.c.closed)); assert.equal(c.code(), 1002);
  c = await dial(); c.sock.write(wsFrame(9, 'x', false)); assert.ok(await until(() => c.c.closed)); assert.equal(c.code(), 1002);
  c = await dial(); c.sock.write(Buffer.concat([wsFrame(1, 'x'.repeat(3000), false), wsFrame(0, 'x'.repeat(3000))])); assert.ok(await until(() => c.c.closed)); assert.equal(c.code(), 1009);
});
