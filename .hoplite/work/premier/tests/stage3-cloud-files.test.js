// Этап 3 плана: файлы облачного компьютера на диске сервера.
//   CLD-01 — публикация, корзина и восстановление не идут по ссылкам (symlink), в том числе при подмене на лету
//   CLD-11 — после окончания тарифа список, скачивание и удаление работают без запуска контейнера
//   CLD-16 — загрузка потоком с резервом места до чтения тела запроса
//   CLD-17 — обход папки при публикации асинхронный и с пределами
// Запуск: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), http = require('http'), net = require('net'), { Readable } = require('stream');
const { copyApp, seed, startServer, rm, ROOT } = require('../test/helpers');
const { fakeDocker, flipper, readTree, sleep } = require('./stage3-util');

const SECRET = 'СЕКРЕТ-СЕРВЕРА-7f3a91';
const PAID = { id: 'u1', login: 'anna', email: 'anna@example.com', plan: 'pro', until: Date.now() + 1e10 };
const FREE = { id: 'u2', login: 'free', email: 'free@example.com' };
const leak = (dir) => readTree(dir).filter((f) => f.data.includes(SECRET)).map((f) => f.file);
const enc = encodeURIComponent;

// модуль cloud.js из копии приложения, в режиме без Docker: файловые операции те же, что и на сервере
function loadCloud(dir) {
  process.env.CLOUD_RUNNER = 'local';
  for (const k of Object.keys(require.cache)) if (k.startsWith(dir)) delete require.cache[k];
  return require(path.join(dir, 'cloud.js'));
}

/* ---------- CLD-01: cloud-fs.js — основа ---------- */
test('CLD-01: путь проходится от открытой папки — ссылка в любом месте пути даёт отказ', (t) => {
  const cfs = require(path.join(ROOT, 'cloud-fs.js'));
  assert.equal(cfs.SAFE, true, 'на Linux работа идёт через /proc/self/fd — без этого защита от подмены неполная');
  const base = fs.mkdtempSync(path.join(require('os').tmpdir(), 'premier-cfs-')); t.after(() => rm(base));
  const home = path.join(base, 'home'), out = path.join(base, 'out');
  fs.mkdirSync(path.join(home, 'a/b'), { recursive: true }); fs.mkdirSync(out);
  fs.writeFileSync(path.join(home, 'a/b/f.txt'), 'свой файл'); fs.writeFileSync(path.join(out, 'secret.txt'), SECRET);
  fs.symlinkSync(out, path.join(home, 'dirlink')); fs.symlinkSync(path.join(out, 'secret.txt'), path.join(home, 'a/filelink'));
  fs.symlinkSync(path.join(home, 'a'), path.join(home, 'inner')); // ссылка внутрь домашней папки — тоже не идём
  // обычный путь
  const f = cfs.withDir(home, ['a', 'b'], (h) => cfs.openFile(h, 'f.txt'));
  assert.equal(fs.readFileSync(f.fd, 'utf8'), 'свой файл'); fs.closeSync(f.fd);
  // ссылки
  assert.throws(() => cfs.openDir(home, ['dirlink']), { code: 'ELINK' });
  assert.throws(() => cfs.openDir(home, ['inner', 'b']), { code: 'ELINK' });
  assert.throws(() => cfs.withDir(home, ['a'], (h) => cfs.openFile(h, 'filelink')), { code: 'ELINK' });
  // не файл и недопустимые имена
  assert.throws(() => cfs.withDir(home, ['a'], (h) => cfs.openFile(h, 'b')), { code: 'ENOTFILE' });
  for (const bad of ['..', '.', '', 'a/b', 'x\0y']) assert.throws(() => cfs.openDir(home, [bad]), { code: 'EBADNAME' }, JSON.stringify(bad));
  // создание папок по одной: существующая ссылка не «проходится», а даёт отказ
  assert.throws(() => cfs.openDir(home, ['dirlink', 'new'], { create: true }), { code: 'ELINK' });
  assert.ok(!fs.existsSync(path.join(out, 'new')), 'в чужой папке ничего не создано');
  cfs.close(cfs.openDir(home, ['x', 'y', 'z'], { create: true })); assert.ok(fs.statSync(path.join(home, 'x/y/z')).isDirectory());
  // подмена после открытия: дескриптор держит прежнюю папку
  const h = cfs.openDir(home, ['a', 'b']);
  fs.renameSync(path.join(home, 'a'), path.join(home, 'a-old')); fs.symlinkSync(out, path.join(home, 'a'));
  const g = cfs.openFile(h, 'f.txt'); assert.equal(fs.readFileSync(g.fd, 'utf8'), 'свой файл'); fs.closeSync(g.fd); cfs.close(h);
  assert.throws(() => cfs.openDir(home, ['a']), { code: 'ELINK' });
});

/* ---------- CLD-01, CLD-17: публикация ---------- */
test('CLD-01: публикация не берёт ссылки и не идёт в папки-ссылки; подмена на лету не даёт утечки', async (t) => {
  const dir = copyApp(); t.after(() => rm(dir));
  const cloud = loadCloud(dir), store = require(path.join(dir, 'db.js'));
  const sitesDir = path.join(dir, 'data', 'sites'); fs.mkdirSync(sitesDir, { recursive: true });
  const sites = require(path.join(dir, 'cloud-sites.js')).createCloudSites({ dir: sitesDir, cloud, store });
  const home = path.join(dir, 'data', 'cloud', 'u1'), site = path.join(home, 'site');
  const srv = path.join(dir, 'server-private'); fs.mkdirSync(path.join(srv, 'keys'), { recursive: true });
  fs.writeFileSync(path.join(srv, 'premier.env'), 'ADMIN_PASSWORD=' + SECRET); fs.writeFileSync(path.join(srv, 'keys', 'id.txt'), SECRET);
  fs.mkdirSync(path.join(site, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(site, 'index.html'), '<title>Мой сайт</title><link href="/style.css" rel="stylesheet"><script src="app.js"></script>');
  fs.writeFileSync(path.join(site, 'app.js'), 'console.log(1)'); fs.writeFileSync(path.join(site, 'assets', 'a.txt'), 'A');
  // неподвижные ссылки: файл-ссылка, папка-ссылка
  fs.symlinkSync(path.join(srv, 'premier.env'), path.join(site, 'env.txt')); fs.symlinkSync(path.join(srv, 'keys'), path.join(site, 'keys'));
  const r = await sites.publish('u1', '~/site');
  assert.equal(r.title, 'Мой сайт'); assert.equal(r.files, 3, 'ссылки в счёт файлов не входят');
  const live = path.join(sitesDir, r.id);
  assert.deepEqual(fs.readdirSync(live).sort(), ['app.js', 'assets', 'index.html']);
  assert.match(fs.readFileSync(path.join(live, 'index.html'), 'utf8'), new RegExp(`href="/s/${r.id}/style.css"`), 'ссылки от корня по-прежнему переписываются');
  assert.deepEqual(leak(sitesDir), []);
  // сама папка сайта — ссылка; папка в пути — ссылка
  fs.symlinkSync(srv, path.join(home, 'srvlink')); fs.writeFileSync(path.join(srv, 'index.html'), '<title>x</title>' + SECRET);
  await assert.rejects(sites.publish('u1', '~/srvlink'), /папка не найдена/);
  await assert.rejects(sites.publish('u1', '~/srvlink/keys'), /папка не найдена/);
  await assert.rejects(sites.publish('u1', '~/../../server-private'), /вне облачного компьютера/);
  await assert.rejects(sites.publish('u1', '/etc'), /только папку внутри/);
  assert.deepEqual(leak(sitesDir), []);

  // гонка: пока идёт публикация, файл и папку сайта непрерывно подменяют ссылками на файлы сервера
  const f1 = flipper(path.join(site, 'app.js'), path.join(home, '.app.real'), path.join(srv, 'premier.env'));
  const f2 = flipper(path.join(site, 'assets'), path.join(home, '.assets.real'), path.join(srv, 'keys'));
  const f3 = flipper(site, path.join(home, '.site.real'), srv);
  let done = 0, refused = 0;
  try {
    for (let i = 0; i < 150; i++) {
      try { await sites.publish('u1', '~/site'); done++; } catch { refused++; }
      assert.deepEqual(leak(sitesDir), [], `утечка на попытке ${i}`);
    }
  } finally { await Promise.all([f1.stop(), f2.stop(), f3.stop()]); }
  assert.ok(done + refused === 150);
  t.diagnostic(`гонка публикации: опубликовано ${done}, отклонено ${refused}, утечек 0`);
});

test('CLD-17: обход при публикации — асинхронный, с пределом записей, глубины и времени', async (t) => {
  const dir = copyApp(); t.after(() => rm(dir));
  const cloud = loadCloud(dir), store = require(path.join(dir, 'db.js')), cfs = require(path.join(dir, 'cloud-fs.js'));
  const mod = require(path.join(dir, 'cloud-sites.js'));
  const sitesDir = path.join(dir, 'data', 'sites'); fs.mkdirSync(sitesDir, { recursive: true });
  const sites = mod.createCloudSites({ dir: sitesDir, cloud, store });
  const home = path.join(dir, 'data', 'cloud', 'u1');
  // пределы самого обхода
  const wide = path.join(home, 'wide'); fs.mkdirSync(wide, { recursive: true });
  for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(wide, `f${i}.txt`), 'x');
  await assert.rejects(cfs.walk(home, ['wide'], { maxEntries: 50 }), { code: 'ETOOMANY', status: 413 });
  await assert.rejects(cfs.walk(home, ['wide'], { maxMs: -1 }), { code: 'ETIMEDOUT', status: 413 });
  let deep = path.join(home, 'deep'); for (let i = 0; i < 6; i++) deep = path.join(deep, 'd'); fs.mkdirSync(deep, { recursive: true }); fs.writeFileSync(path.join(deep, 'low.txt'), 'x');
  const seen = [], tooDeep = [];
  await cfs.walk(home, ['deep'], { maxDepth: 3, onFile: (f) => { seen.push(f.rel); }, onDeep: (d) => { tooDeep.push(d.rel); } });
  assert.deepEqual(seen, []); assert.deepEqual(tooDeep, ['d/d/d/d']);
  // публикация: слишком глубокая папка и слишком много файлов — понятная ошибка, временная папка убрана
  let nest = path.join(home, 'nest'); fs.mkdirSync(nest, { recursive: true }); fs.writeFileSync(path.join(nest, 'index.html'), '<title>n</title>');
  for (let i = 0; i <= mod.DEPTH_MAX; i++) nest = path.join(nest, 'k'); fs.mkdirSync(nest, { recursive: true });
  await assert.rejects(sites.publish('u1', '~/nest'), /вложенность папок больше/);
  const many = path.join(home, 'many'); fs.mkdirSync(many); fs.writeFileSync(path.join(many, 'index.html'), '<title>m</title>');
  for (let i = 0; i <= mod.MAX_FILES; i++) fs.writeFileSync(path.join(many, `p${i}.txt`), '');
  // пока идёт публикация, сервер продолжает работать: таймер успевает сработать много раз
  let ticks = 0; const tick = setInterval(() => ticks++, 1);
  await assert.rejects(sites.publish('u1', '~/many'), /больше 2000 файлов/); clearInterval(tick);
  assert.ok(ticks >= 3, `цикл событий не блокировался (срабатываний таймера: ${ticks})`);
  assert.deepEqual(fs.readdirSync(sitesDir), [], 'после отказа не осталось ни сайта, ни временной папки');
  // вторая публикация того же пользователя одновременно — отказ, а не двойной обход
  fs.mkdirSync(path.join(home, 'ok')); fs.writeFileSync(path.join(home, 'ok', 'index.html'), '<title>ok</title>');
  const [a, b] = await Promise.allSettled([sites.publish('u1', '~/ok'), sites.publish('u1', '~/ok')]);
  assert.equal(a.status, 'fulfilled'); assert.equal(b.status, 'rejected'); assert.match(b.reason.message, /уже идёт/);
});

/* ---------- CLD-01: корзина и восстановление ---------- */
test('CLD-01: корзина и восстановление — папка, подменённая ссылкой, не уводит на файлы сервера', async (t) => {
  const dir = copyApp(); t.after(() => rm(dir));
  const cloud = loadCloud(dir), cfs = require(path.join(dir, 'cloud-fs.js'));
  const home = path.join(dir, 'data', 'cloud', 'u1'), trash = path.join(dir, 'data', 'cloud-trash');
  const srv = path.join(dir, 'server-private'); fs.mkdirSync(srv, { recursive: true });
  const srvFile = path.join(srv, 'f.txt'); fs.writeFileSync(srvFile, SECRET);
  fs.mkdirSync(path.join(home, 'box'), { recursive: true }); fs.writeFileSync(path.join(home, 'box', 'f.txt'), 'моё');
  // обычное удаление и восстановление работают как раньше
  assert.match(await cloud.remove('u1', 1024, '~/box/f.txt'), /в корзине/);
  assert.ok(!fs.existsSync(path.join(home, 'box', 'f.txt')));
  const [it] = cloud.trashList('u1'); assert.equal(it.from, '~/box/f.txt'); assert.equal(it.name, 'f.txt');
  assert.equal(await cloud.restore('u1', 1024, it.id), '~/box/f.txt'); assert.equal(fs.readFileSync(path.join(home, 'box', 'f.txt'), 'utf8'), 'моё');
  // удаление самой ссылки: в корзину уходит ссылка, а не то, на что она указывает
  fs.symlinkSync(srvFile, path.join(home, 'lnk')); await cloud.remove('u1', 1024, '~/lnk');
  assert.equal(fs.readFileSync(srvFile, 'utf8'), SECRET, 'файл сервера на месте'); assert.deepEqual(leak(trash), []);
  for (const x of cloud.trashList('u1')) cloud.trashDrop('u1', x.id);
  // папка в пути — ссылка на каталог сервера: файл сервера не переносится
  fs.symlinkSync(srv, path.join(home, 'evil'));
  await assert.rejects(cloud.remove('u1', 1024, '~/evil/f.txt'), /не найден/);
  assert.equal(fs.readFileSync(srvFile, 'utf8'), SECRET); assert.deepEqual(cloud.trashList('u1'), []);
  // восстановление: папку, откуда удалили, заменили ссылкой — отказ, в каталоге сервера ничего не появилось
  fs.mkdirSync(path.join(home, 'docs')); fs.writeFileSync(path.join(home, 'docs', 'r.txt'), 'отчёт');
  await cloud.remove('u1', 1024, '~/docs/r.txt'); fs.rmdirSync(path.join(home, 'docs')); fs.symlinkSync(srv, path.join(home, 'docs'));
  await assert.rejects(cloud.restore('u1', 1024, cloud.trashList('u1')[0].id), /заменила ссылка/);
  assert.deepEqual(fs.readdirSync(srv), ['f.txt']); assert.equal(cloud.trashList('u1').length, 1, 'запись осталась в корзине');
  for (const x of cloud.trashList('u1')) cloud.trashDrop('u1', x.id);

  // гонка: ~/box то настоящая папка с файлом пользователя, то ссылка на каталог сервера с файлом того же имени
  fs.writeFileSync(path.join(home, 'box', 'f.txt'), 'моё');
  const fl = flipper(path.join(home, 'box'), path.join(home, '.box.real'), srv);
  let moved = 0;
  try {
    for (let i = 0; i < 400; i++) {
      try { await cloud.remove('u1', 1024, '~/box/f.txt'); moved++; } catch {}
      assert.equal(fs.existsSync(srvFile) && fs.readFileSync(srvFile, 'utf8'), SECRET, `файл сервера тронут на попытке ${i}`);
      assert.deepEqual(leak(trash), [], `файл сервера попал в корзину на попытке ${i}`);
      // вернуть файл пользователя туда, где сейчас лежит настоящая папка
      // (тоже от открытой папки: обычная запись по пути сама попала бы по ссылке в каталог сервера)
      for (const d of ['box', '.box.real']) { try { cfs.withDir(home, [d], (h) => { const fd = cfs.createFile(h, 'f.txt'); fs.writeSync(fd, 'моё'); fs.closeSync(fd); }); } catch {} }
      // и сразу восстановление из корзины — оно не должно создать что-либо в каталоге сервера
      const last = cloud.trashList('u1')[0];
      if (last) { try { await cloud.restore('u1', 1024, last.id); } catch {} }
      assert.deepEqual(fs.readdirSync(srv), ['f.txt'], `в каталоге сервера появилось лишнее на попытке ${i}`);
      assert.equal(fs.readFileSync(srvFile, 'utf8'), SECRET);
    }
  } finally { await fl.stop(); }
  t.diagnostic(`гонка корзины: перенесено ${moved} из 400, файл сервера не тронут`);
});

/* ---------- CLD-11, CLD-16: через API сервера, с поддельным docker ---------- */
test('CLD-11, CLD-16: список, скачивание, удаление и загрузка идут с диска сервера — контейнер не запускается', async (t) => {
  const dir = copyApp(); t.after(() => rm(dir));
  seed(dir, { users: [PAID, FREE], sessions: { tok1: 'u1', tok2: 'u2' } });
  const fake = fakeDocker(dir);
  for (const u of ['u1', 'u2']) {
    const h = path.join(dir, 'data', 'cloud', u); fs.mkdirSync(path.join(h, 'proj'), { recursive: true });
    fs.writeFileSync(path.join(h, 'proj', 'main.py'), 'print(1)\n'); fs.writeFileSync(path.join(h, 'заметка.txt'), 'привет');
    fs.symlinkSync('/etc', path.join(h, 'etc-link'));
  }
  const s = await startServer(dir, { PATH: fake.PATH, CLOUD_RUNNER: 'docker', CLOUD_NETWORK: 'none', CLOUD_UPLOAD_BUDGET_MB: '30' }); t.after(() => s.stop());
  const started = () => fake.calls().filter((c) => c[0] === 'run' || c[0] === 'exec');

  // u2 — тариф закончился (места на тарифе нет): смотреть, скачивать и удалять можно
  const ls = await s.req('GET', '/api/cloud/files?path=' + enc('~'), { token: 'tok2' });
  assert.equal(ls.status, 200, ls.text); assert.equal(ls.json.path, '~');
  assert.deepEqual(ls.json.entries.map((e) => [e.name, e.dir]), [['proj', true], ['etc-link', false], ['заметка.txt', false]]);
  assert.equal(ls.json.entries.find((e) => e.name === 'etc-link').link, true, 'ссылка показана как ссылка и не раскрыта');
  assert.equal(ls.json.entries.find((e) => e.name === 'заметка.txt').size, Buffer.byteLength('привет'));
  const sub = await s.req('GET', '/api/cloud/files?path=' + enc('~/proj'), { token: 'tok2' });
  assert.deepEqual(sub.json.entries.map((e) => e.name), ['main.py']); assert.equal(sub.json.path, '~/proj');
  const dl = await s.req('GET', '/api/cloud/file?path=' + enc('~/proj/main.py'), { token: 'tok2' }); assert.equal(dl.status, 200); assert.equal(dl.text, 'print(1)\n');
  const del = await s.req('POST', '/api/cloud/delete', { token: 'tok2', body: { path: '~/заметка.txt' } }); assert.equal(del.status, 200, del.text);
  assert.ok(!fs.existsSync(path.join(dir, 'data', 'cloud', 'u2', 'заметка.txt')));
  assert.equal((await s.req('GET', '/api/cloud/trash', { token: 'tok2' })).json.items.length, 1);
  // то, что умеет только контейнер, без тарифа недоступно — и контейнер ради этого не поднимается
  for (const p of ['/etc', '~/etc-link']) { const r = await s.req('GET', '/api/cloud/files?path=' + enc(p), { token: 'tok2' }); assert.equal(r.status, 403, p + ' ' + r.text); assert.equal(r.json.code, 'plan'); }
  assert.equal((await s.req('GET', '/api/cloud/file?path=' + enc('~/etc-link/hostname'), { token: 'tok2' })).status, 403);
  assert.equal((await s.req('POST', '/api/cloud/delete', { token: 'tok2', body: { path: '/tmp/x' } })).status, 403);
  assert.equal((await s.req('GET', '/api/cloud/files?path=' + enc('~/nope'), { token: 'tok2' })).status, 404);
  assert.equal((await s.req('POST', '/api/cloud/upload?name=a.txt', { token: 'tok2', body: { a: 1 } })).status, 403, 'загрузка без тарифа закрыта');
  assert.deepEqual(started(), [], 'для пользователя без тарифа не было ни docker run, ни docker exec');

  // u1 — платный: загрузка потоком, без контейнера
  const upload = (q, body, headers = {}) => fetch(s.base + '/api/cloud/upload?' + q, { method: 'POST', body, headers: { Cookie: 'premier_session=tok1', ...headers } });
  const data = Buffer.alloc(3 * 1048576 + 17, 7);
  let r = await upload('dir=' + enc('~/new/deep') + '&name=' + enc('данные.bin'), data); let j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j)); assert.deepEqual([j.path, j.name], ['~/new/deep/данные.bin', 'данные.bin']); assert.match(j.out, /^Готово: ~\/new\/deep\/данные\.bin \(3 МБ\)$/);
  const home = path.join(dir, 'data', 'cloud', 'u1');
  assert.ok(fs.readFileSync(path.join(home, 'new/deep/данные.bin')).equals(data)); assert.deepEqual(fs.readdirSync(path.join(home, 'new/deep')), ['данные.bin'], 'временного файла не осталось');
  // uniq=1: прежний файл не затирается
  r = await upload('uniq=1&dir=' + enc('~/uploads') + '&name=image.png', Buffer.from('1')); assert.equal((await r.json()).name, 'image.png');
  r = await upload('uniq=1&dir=' + enc('~/uploads') + '&name=image.png', Buffer.from('22')); j = await r.json(); assert.equal(j.name, 'image-2.png'); assert.equal(j.path, '~/uploads/image-2.png');
  assert.equal(fs.readFileSync(path.join(home, 'uploads/image.png'), 'utf8'), '1');
  // без uniq файл заменяется; имя-ссылка заменяется самой записью — файл, на который она указывала, не тронут
  const srvFile = path.join(dir, 'server-secret.txt'); fs.writeFileSync(srvFile, SECRET); fs.symlinkSync(srvFile, path.join(home, 'uploads/trap.txt'));
  r = await upload('dir=' + enc('~/uploads') + '&name=trap.txt', Buffer.from('новое')); assert.equal(r.status, 200);
  assert.equal(fs.readFileSync(srvFile, 'utf8'), SECRET); assert.ok(fs.lstatSync(path.join(home, 'uploads/trap.txt')).isFile());
  // папка назначения — ссылка; путь вне домашней папки; имя занято папкой
  fs.symlinkSync(dir, path.join(home, 'out'));
  r = await upload('dir=' + enc('~/out') + '&name=x.txt', Buffer.from('x')); assert.equal(r.status, 400); assert.match((await r.json()).error, /ссылка/); assert.ok(!fs.existsSync(path.join(dir, 'x.txt')));
  r = await upload('dir=' + enc('/tmp') + '&name=x.txt', Buffer.from('x')); assert.equal(r.status, 400);
  r = await upload('dir=' + enc('~') + '&name=proj', Buffer.from('x')); assert.equal(r.status, 400); assert.match((await r.json()).error, /уже есть папка/);
  assert.deepEqual(fs.readdirSync(home).filter((n) => n.includes('premier-upload')), []);
  assert.deepEqual(started(), [], 'загрузка и просмотр не запускали контейнер');

  // больше предела: отказ по Content-Length до чтения тела
  const raw = (headers, parts, hold) => new Promise((ok, fail) => {
    const q = http.request(s.base + '/api/cloud/upload?dir=' + enc('~/big') + '&name=' + headers.name, { method: 'POST', headers: { Cookie: 'premier_session=tok1', 'Content-Length': headers.len } }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => ok({ status: res.statusCode, body: b, retry: res.headers['retry-after'] })); });
    q.on('error', (e) => (hold?.done ? ok({ status: 0, error: e.message }) : fail(e)));
    for (const p of parts) q.write(p);
    if (hold) hold.finish = (rest) => { hold.done = true; q.end(rest); }; else if (parts.length) q.end(); else q.flushHeaders();
  });
  const big = await raw({ name: 'huge.bin', len: 21 * 1048576 }, []);
  assert.equal(big.status, 413); assert.ok(!fs.existsSync(path.join(home, 'big')), 'ни папка, ни файл не созданы');
  // общий бюджет сервера (30 МБ): первая загрузка на 18 МБ ещё идёт — вторая на 18 МБ получает отказ, а не копится в памяти
  const hold = {}, first = raw({ name: 'one.bin', len: 18 * 1048576 }, [Buffer.alloc(1048576, 1)], hold);
  await sleep(300);
  const second = await raw({ name: 'two.bin', len: 18 * 1048576 }, []);
  assert.equal(second.status, 503, second.body); assert.equal(second.retry, '30');
  hold.finish(Buffer.alloc(17 * 1048576, 1));
  assert.equal((await first).status, 200); assert.equal(fs.statSync(path.join(home, 'big/one.bin')).size, 18 * 1048576);
  // резерв освобождён — следующая загрузка проходит
  r = await upload('dir=' + enc('~/big') + '&name=three.bin', Buffer.alloc(1048576)); assert.equal(r.status, 200);
  // оборванная загрузка: соединение рвётся посреди тела — временный файл убран, резерв возвращён
  const u = new URL(s.base), sock = net.connect(Number(u.port), u.hostname);
  await new Promise((ok) => sock.once('connect', ok));
  sock.write(`POST /api/cloud/upload?dir=${enc('~/big')}&name=cut.bin HTTP/1.1\r\nHost: ${u.host}\r\nCookie: premier_session=tok1\r\nContent-Length: ${18 * 1048576}\r\n\r\n`);
  sock.write(Buffer.alloc(1048576, 1)); await sleep(300);
  assert.equal(fs.readdirSync(path.join(home, 'big')).filter((n) => n.includes('premier-upload')).length, 1, 'идёт запись во временный файл');
  sock.destroy(); await sleep(300);
  assert.deepEqual(fs.readdirSync(path.join(home, 'big')).sort(), ['one.bin', 'three.bin']);
  r = await upload('dir=' + enc('~/big') + '&name=four.bin', Buffer.alloc(18 * 1048576)); assert.equal(r.status, 200, 'резерв оборванной загрузки возвращён');
  assert.deepEqual(started(), []);
});

test('CLD-16: квота учитывает резерв параллельных загрузок; оборванная загрузка не оставляет временный файл', async (t) => {
  const dir = copyApp(); t.after(() => rm(dir));
  const cloud = loadCloud(dir), home = path.join(dir, 'data', 'cloud', 'u1');
  const slow = (size, gate) => new Readable({ read() { if (this.sent) return; this.sent = true; gate.then(() => { this.push(Buffer.alloc(size, 1)); this.push(null); }); } });
  let open; const gate = new Promise((ok) => (open = ok));
  // квота 2 МБ, две загрузки по 1,2 МБ одновременно: вторая видит резерв первой и получает отказ
  const a = cloud.upload('u1', 2, { dir: '~/q', name: 'a.bin', length: 1.2 * 1048576 }, slow(1.2 * 1048576, gate));
  const b = cloud.upload('u1', 2, { dir: '~/q', name: 'b.bin', length: 1.2 * 1048576 }, slow(1.2 * 1048576, gate));
  await assert.rejects(b, (e) => e.status === 507 && /место в облачном компьютере закончилось/.test(e.message));
  open(); assert.equal((await a).name, 'a.bin');
  // тело длиннее объявленного предела — 413, файла нет
  await assert.rejects(cloud.upload('u1', 1024, { dir: '~/q', name: 'over.bin' }, Readable.from([Buffer.alloc(cloud.UP_MAX), Buffer.alloc(10)])), { status: 413 });
  // поток оборвался с ошибкой
  const boom = new Readable({ read() { this.push(Buffer.alloc(1000)); process.nextTick(() => this.destroy(new Error('обрыв'))); } });
  await assert.rejects(cloud.upload('u1', 1024, { dir: '~/q', name: 'cut.bin' }, boom));
  assert.deepEqual(fs.readdirSync(path.join(home, 'q')), ['a.bin']);
  // без места на тарифе загрузка закрыта
  await assert.rejects(cloud.upload('u1', 0, { dir: '~', name: 'x' }, Readable.from([Buffer.from('x')])), { status: 403, code: 'plan' });
  // клиент ушёл ещё до начала приёма (пока сервер считал место): загрузка завершается отказом, а не висит вечно.
  // Двенадцать таких подряд заняли бы весь общий резерв (200 МБ по 20 МБ) — после них обычная загрузка должна пройти.
  for (let i = 0; i < 12; i++) {
    const gone = new Readable({ read() {} }); gone.destroy();
    const r = await Promise.race([cloud.upload('u1', 1024, { dir: '~/q', name: 'gone' + i + '.bin' }, gone).then(() => 'ok', (e) => e), sleep(3000).then(() => 'висит')]);
    assert.ok(r instanceof Error && /прервана/.test(r.message), 'загрузка ' + i + ': ' + (r.message || r));
  }
  assert.equal((await cloud.upload('u1', 1024, { dir: '~/q', name: 'after.bin' }, Readable.from([Buffer.from('x')]))).name, 'after.bin');
  assert.deepEqual(fs.readdirSync(path.join(home, 'q')).sort(), ['a.bin', 'after.bin'], 'временных файлов не осталось');
});

test('CLD-17: сайт сняли с публикации, пока шло обновление, — обновление не возвращает его в сеть', async (t) => {
  const dir = copyApp(); t.after(() => rm(dir));
  const cloud = loadCloud(dir), store = require(path.join(dir, 'db.js'));
  const sitesDir = path.join(dir, 'data', 'sites'); fs.mkdirSync(sitesDir, { recursive: true });
  const sites = require(path.join(dir, 'cloud-sites.js')).createCloudSites({ dir: sitesDir, cloud, store });
  const site = path.join(dir, 'data', 'cloud', 'u1', 'site'); fs.mkdirSync(site, { recursive: true });
  fs.writeFileSync(path.join(site, 'index.html'), '<title>Сайт</title>');
  const first = await sites.publish('u1', '~/site'); assert.deepEqual(sites.list('u1').map((x) => x.id), [first.id]);
  const again = sites.publish('u1', '~/site'); // обновление началось и ждёт диска
  assert.equal(sites.unpublish('u1', first.id), true);
  await assert.rejects(again, /сняли с публикации, пока шло обновление/);
  assert.deepEqual(sites.list('u1'), []); assert.deepEqual(fs.readdirSync(sitesDir), [], 'ни файлов сайта, ни описания, ни временной папки');
  // новая публикация после этого проходит обычным порядком
  const fresh = await sites.publish('u1', '~/site'); assert.equal(fresh.updated, false); assert.equal(sites.list('u1').length, 1);
  // CLD-09: «Стоп» или срок ответа пришли, пока шло копирование, — обновление в сеть не выходит
  const live = path.join(sitesDir, fresh.id, 'index.html'), was = fs.readFileSync(live, 'utf8');
  fs.writeFileSync(path.join(site, 'index.html'), '<title>Новая версия</title>');
  const ac = new AbortController(), upd = sites.publish('u1', '~/site', { signal: ac.signal }); ac.abort();
  await assert.rejects(upd, /публикация остановлена — сайт не изменён/);
  assert.equal(fs.readFileSync(live, 'utf8'), was, 'в сети осталась прежняя версия'); assert.deepEqual(fs.readdirSync(sitesDir).sort(), [fresh.id, fresh.id + '.json'], 'временной папки нет');
  await assert.rejects(sites.publish('u1', '~/site', { signal: ac.signal }), /публикация остановлена/); // остановлено до начала
  assert.equal((await sites.publish('u1', '~/site')).updated, true); assert.match(fs.readFileSync(live, 'utf8'), /Новая версия/);
});
