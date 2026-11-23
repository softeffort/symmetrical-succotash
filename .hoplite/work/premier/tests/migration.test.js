// Разовый перенос старых JSON в SQLite (BIZ-13) и сверка архивов deploy/check-legacy.js.
// db.js переносит данные при подключении, поэтому каждый запуск — в отдельном процессе на копии приложения.
// Запуск: node --test tests/migration.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { copyApp, seed, rm, startServer } = require('../test/helpers');

const data = (dir, ...p) => path.join(dir, 'data', ...p);
const put = (dir, f, v) => { fs.mkdirSync(path.dirname(data(dir, f)), { recursive: true }); fs.writeFileSync(data(dir, f), typeof v === 'string' ? v : JSON.stringify(v)); };
const sandbox = (t) => { const dir = copyApp(); t.after(() => rm(dir)); return dir; };
// подключить db.js отдельным процессом и вернуть вывод и состояние базы
function run(dir) {
  const r = spawnSync(process.execPath, ['-e', `const s = require('./db'); process.stdout.write('\\n@@' + JSON.stringify({ migrated: s.kv.get('meta:migrated', null), split: s.kv.get('meta:chats-split', null), users: s.users.all().map((u) => u.login), pays: s.payments.all().map((p) => p.id), chatKeys: s.kv.keys('chat:') }));`], { cwd: dir, encoding: 'utf8' });
  const m = /@@(.*)$/s.exec(r.stdout || ''); const st = m ? JSON.parse(m[1]) : null;
  return { code: r.status, out: (r.stdout || '').split('\n@@')[0], err: r.stderr || '', st };
}
const legacy = (dir) => fs.readdirSync(data(dir)).filter((n) => n.startsWith('legacy-json-'));
// база без запуска db.js: есть ли отметка
const flag = (dir, k) => { const f = data(dir, 'premier.db'); if (!fs.existsSync(f)) return null; const d = new DatabaseSync(f, { readOnly: true }); try { return d.prepare('SELECT v FROM kv WHERE k = ?').get(k)?.v ?? null; } finally { d.close(); } };

test('перенос: битый users.json прерывает запуск, ничего не помечено и не перемещено; после починки перенос идёт заново', (t) => {
  const dir = sandbox(t);
  seed(dir, { chats: { u1: { state: { chats: [{ id: 'a' }] } } } });
  put(dir, 'users.json', '[{"id":"u1","login":"anna"');
  put(dir, 'payments.json', [{ id: 'p1', uid: 'u1' }]);
  const bad = run(dir);
  assert.notEqual(bad.code, 0);
  assert.match(bad.err, /users\.json/); assert.match(bad.err, /повреждён/);
  assert.equal(flag(dir, 'meta:migrated'), null, 'отметки нет');
  assert.deepEqual(legacy(dir), [], 'архива нет');
  for (const f of ['users.json', 'sessions.json', 'payments.json', 'chats/u1.json']) assert.ok(fs.existsSync(data(dir, f)), f + ' на месте');
  put(dir, 'users.json', [{ id: 'u1', login: 'anna' }]);
  const ok = run(dir);
  assert.equal(ok.code, 0, ok.err);
  assert.deepEqual(ok.st.users, ['anna']); assert.deepEqual(ok.st.pays, ['p1']);
  assert.ok(ok.st.migrated.counts['users.json'].imported === 1);
  assert.equal(legacy(dir).length, 1);
  assert.ok(!fs.existsSync(data(dir, 'users.json')));
});

test('перенос: сервер при битом users.json не запускается и пишет понятную причину с именем файла', async (t) => {
  const dir = sandbox(t);
  put(dir, 'users.json', '[{"id":');
  await assert.rejects(() => startServer(dir), (e) => /сервер не запустился/.test(e.message) && /data\/users\.json повреждён/.test(e.message));
  assert.equal(flag(dir, 'meta:migrated'), null);
});

test('перенос: неверный вид файла (users.json не массив, sessions.json массив, payments.json строка) — отказ с именем файла', (t) => {
  for (const [f, v] of [['users.json', { id: 'u1' }], ['sessions.json', []], ['payments.json', '"текст"']]) {
    const dir = sandbox(t);
    put(dir, f, v);
    const r = run(dir);
    assert.notEqual(r.code, 0, f);
    assert.match(r.err, new RegExp(f.replace('.', '\\.')), f); assert.match(r.err, /неверный вид/, f);
    assert.equal(flag(dir, 'meta:migrated'), null, f); assert.deepEqual(legacy(dir), [], f);
    assert.ok(fs.existsSync(data(dir, f)), f);
  }
});

test('перенос: нечитаемый файл в chats/ откатывает всю транзакцию — ранее обработанные users.json не попадают в базу', (t) => {
  const dir = sandbox(t);
  seed(dir, { chats: { u1: { state: { chats: [] } } } });
  put(dir, 'chats/u2.json', '{oops');
  put(dir, 'memory/m1.json', { a: 1 });
  const r = run(dir);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /chats\/u2\.json/);
  assert.equal(flag(dir, 'meta:migrated'), null);
  const d = new DatabaseSync(data(dir, 'premier.db'), { readOnly: true });
  assert.equal(d.prepare('SELECT count(*) n FROM users').get().n, 0, 'откат');
  d.close();
  assert.deepEqual(legacy(dir), []);
  assert.ok(fs.existsSync(data(dir, 'chats', 'u1.json')) && fs.existsSync(data(dir, 'memory', 'm1.json')));
  // файл, который нельзя прочитать как файл (каталог с именем .json), — тоже ошибка, а не «пропустить»
  fs.rmSync(data(dir, 'chats', 'u2.json')); fs.mkdirSync(data(dir, 'usage', 'x.json'), { recursive: true });
  const r2 = run(dir);
  assert.notEqual(r2.code, 0); assert.match(r2.err, /usage\/x\.json/); assert.match(r2.err, /не читается/);
});

test('перенос: нет файлов вообще — это нормально; счётчики по источникам и пропущенные записи попадают в meta:migrated и в журнал', (t) => {
  const empty = sandbox(t);
  const e = run(empty); assert.equal(e.code, 0, e.err); assert.ok(e.st.migrated);
  const dir = sandbox(t);
  put(dir, 'users.json', [{ id: 'u1', login: 'anna' }, { id: 'u2' }, { login: 'без-id' }, null, { id: 'u3', login: 'ANNA' }]);
  put(dir, 'payments.json', [{ id: 'p1', uid: 'u1' }, { uid: 'u1' }]);
  put(dir, 'sessions.json', { h1: { uid: 'u1', exp: Date.now() + 1e9 }, h2: { uid: 'u1', exp: 1 } });
  put(dir, 'chats/u1.json', { state: { chats: [] } });
  const r = run(dir);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.st.migrated.counts, { 'users.json': { imported: 2, skipped: 3 }, 'sessions.json': { imported: 1, skipped: 1 }, 'payments.json': { imported: 1, skipped: 1 }, chats: { imported: 1, skipped: 0 } });
  assert.match(r.out, /users\.json: 2, пропущено 3/); assert.match(r.out, /payments\.json: 1, пропущено 1/);
  assert.deepEqual(r.st.users.sort(), ['ANNA2', 'anna']);
});

test('перенос: в архив уходит только перенесённое — посторонние файлы в chats/ остаются на месте', (t) => {
  const dir = sandbox(t);
  put(dir, 'chats/u1.json', { state: { chats: [] } }); put(dir, 'chats/readme.txt', 'не JSON');
  const r = run(dir); assert.equal(r.code, 0, r.err);
  const [l] = legacy(dir);
  assert.ok(fs.existsSync(data(dir, l, 'chats', 'u1.json')));
  assert.ok(fs.existsSync(data(dir, 'chats', 'readme.txt')) && !fs.existsSync(data(dir, 'chats', 'u1.json')));
});

test('разбиение чатов: запись неподдерживаемого вида и запись, не прошедшая разбор, остаются; отметки нет, пока такие есть', (t) => {
  const dir = sandbox(t);
  put(dir, 'chats/good.json', { state: { chats: [{ id: 'a', msgs: [] }] } });
  put(dir, 'chats/odd.json', { foo: 1 });
  put(dir, 'chats/arr.json', [1, 2]);
  put(dir, 'chats/big.json', { state: { chats: [{ id: 'z', t: 'x'.repeat(8e6 + 10) }] } });
  const r = run(dir); assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.st.chatKeys.sort(), ['chat:arr', 'chat:big', 'chat:odd'], 'разобрана только good');
  assert.equal(r.st.split, null);
  assert.match(r.err, /chat:odd/); assert.match(r.err, /chat:big/);
  const d = new DatabaseSync(data(dir, 'premier.db'), { readOnly: true });
  assert.equal(d.prepare("SELECT count(*) n FROM chats WHERE uid = 'big'").get().n, 0, 'частичная запись откатилась');
  assert.equal(d.prepare("SELECT count(*) n FROM chats WHERE uid = 'good'").get().n, 1);
  d.close();
  // починили записи — следующий запуск довёл дело и поставил отметку
  const w = new DatabaseSync(data(dir, 'premier.db'));
  for (const k of ['chat:odd', 'chat:arr', 'chat:big']) w.prepare('UPDATE kv SET v = ? WHERE k = ?').run(JSON.stringify({ state: { chats: [{ id: 'q' }] } }), k);
  w.close();
  const r2 = run(dir); assert.equal(r2.code, 0, r2.err);
  assert.deepEqual(r2.st.chatKeys, []); assert.ok(r2.st.split);
});

test('разбиение чатов: у пользователя уже есть строки по чатам — запись chat:<uid> удаляется, как раньше', (t) => {
  const dir = sandbox(t);
  const r0 = run(dir); assert.equal(r0.code, 0, r0.err);
  const w = new DatabaseSync(data(dir, 'premier.db'));
  w.prepare("DELETE FROM kv WHERE k = 'meta:chats-split'").run();
  w.prepare("INSERT INTO chatmeta (uid, rev, mv, meta) VALUES ('u9', 3, 1, NULL)").run();
  w.prepare("INSERT INTO kv (k, v, at) VALUES ('chat:u9', '{\"мусор\":1}', 0)").run();
  w.close();
  const r = run(dir); assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.st.chatKeys, []); assert.ok(r.st.split);
});

/* ---------- deploy/check-legacy.js ---------- */
const check = (dir) => { const r = spawnSync(process.execPath, ['deploy/check-legacy.js', 'data'], { cwd: dir, encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };
const snap = (dir) => { const o = {}; (function walk(p) { for (const n of fs.readdirSync(p)) { const f = path.join(p, n), s = fs.statSync(f); if (s.isDirectory()) walk(f); else if (!/premier\.db-(wal|shm)$/.test(n)) o[path.relative(dir, f)] = s.size + ':' + s.mtimeMs; } })(data(dir)); return o; };

test('check-legacy: всё перенесено — код 0; ничего не меняет', (t) => {
  const dir = sandbox(t);
  seed(dir); put(dir, 'payments.json', [{ id: 'p1', uid: 'u1' }]); put(dir, 'memory/u1.json', { a: 1 });
  assert.equal(run(dir).code, 0);
  const before = snap(dir), r = check(dir);
  assert.equal(r.code, 0, r.out); assert.match(r.out, /legacy-json-/); assert.match(r.out, /Итог: всё/);
  assert.deepEqual(snap(dir), before, 'файлы не тронуты');
});

test('check-legacy: пользователя и платежа нет в базе и файл в архиве не читается — код 1, id в отчёте', (t) => {
  const dir = sandbox(t);
  seed(dir, { users: [{ id: 'u1', login: 'anna' }, { id: 'u2', login: 'boris' }] }); put(dir, 'payments.json', [{ id: 'p1', uid: 'u1' }, { id: 'p2', uid: 'u2' }]);
  put(dir, 'usage/u1.json', { a: 1 });
  assert.equal(run(dir).code, 0);
  const [l] = legacy(dir);
  const d = new DatabaseSync(data(dir, 'premier.db'));
  d.prepare("DELETE FROM users WHERE id = 'u2'").run(); d.prepare("DELETE FROM payments WHERE id = 'p2'").run(); d.close();
  fs.writeFileSync(data(dir, l, 'usage', 'u1.json'), '{битый');
  const before = snap(dir), r = check(dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /u2/); assert.match(r.out, /p2/); assert.match(r.out, /usage\/ — не читаются: u1\.json/);
  assert.doesNotMatch(r.out, /нет в базе — u1/);
  assert.deepEqual(snap(dir), before, 'файлы не тронуты');
});

test('check-legacy: архивов нет — код 0', (t) => {
  const dir = sandbox(t);
  const r = check(dir); assert.equal(r.code, 0, r.out); assert.match(r.out, /нет/);
});
