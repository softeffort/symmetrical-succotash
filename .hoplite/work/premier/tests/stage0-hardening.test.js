// Срочные исправления (этап 0 плана): падение процесса, терминал, транзакции, журнал панели, бэкап, уведомление Robokassa.
// Запуск: npm test (или node --test tests/stage0-hardening.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { copyApp, startServer, rm, ROOT } = require('../test/helpers');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

/* ---------- ARCH-01: необработанная ошибка ---------- */
test('monitor.js не ставит свои обработчики падения процесса', () => {
  const before = [process.listenerCount('uncaughtException'), process.listenerCount('unhandledRejection')];
  const monitor = require(path.join(ROOT, 'monitor.js'));
  assert.equal(monitor.install, undefined, 'обработчики живут только в server.js');
  assert.deepEqual([process.listenerCount('uncaughtException'), process.listenerCount('unhandledRejection')], before);
});

// preload бросает ошибку вне обработчика запроса, когда в data/ появляется файл throw-<код>
const PRELOAD = `const fs = require('fs'), path = require('path');
setInterval(() => { for (const f of (() => { try { return fs.readdirSync(path.join(process.cwd(), 'data')); } catch { return []; } })()) {
  if (!f.startsWith('throw-')) continue; fs.unlinkSync(path.join(process.cwd(), 'data', f));
  const e = new Error('test ' + f); e.code = f.slice(6); throw e; } }, 50).unref();`;
async function crashApp(t) {
  const dir = copyApp(); fs.writeFileSync(path.join(dir, 'throw-preload.js'), PRELOAD);
  const srv = await startServer(dir, { NODE_OPTIONS: '--require ' + path.join(dir, 'throw-preload.js') });
  t.after(async () => { await srv.stop(); rm(dir); });
  const up = async () => { try { return (await fetch(srv.base + '/healthz')).ok; } catch { return false; } };
  return { dir, srv, up, raise: (code) => fs.writeFileSync(path.join(dir, 'data', 'throw-' + code), '') };
}
test('оборванное соединение (ECONNRESET) вне запроса не завершает сервер', async (t) => {
  const { srv, up, raise } = await crashApp(t);
  raise('ECONNRESET');
  for (let i = 0; i < 40 && !srv.log().includes('uncaughtException'); i++) await delay(50);
  assert.match(srv.log(), /uncaughtException/, 'ошибка дошла до обработчика');
  await delay(2000); // раньше второй обработчик завершал процесс через 1,5 с
  assert.equal(await up(), true, 'сервер продолжает отвечать');
});
test('настоящая необработанная ошибка по-прежнему перезапускает процесс', async (t) => {
  const { up, raise } = await crashApp(t);
  raise('E_REAL_BUG');
  let down = false;
  for (let i = 0; i < 60 && !down; i++) { await delay(100); down = !(await up()); }
  assert.equal(down, true, 'процесс завершился — systemd его перезапустит');
});

/* ---------- CLD-05: сообщение терминала ---------- */
test('терминал: null, число, массив и мусор не дают исключения', () => {
  const { ttyFrame } = require(path.join(ROOT, 'cloud.js'));
  for (const m of ['null', '1', '"x"', '[]', '[1,2]', 'true', '{', '', '{"d":5}', '{"r":"80x24"}', '{}']) assert.equal(ttyFrame(m), null, m);
  assert.deepEqual(ttyFrame('{"d":"ls\\n"}'), { kind: 0, body: Buffer.from('ls\n') });
  const size = (m) => { const f = ttyFrame(m); assert.equal(f.kind, 1); return [f.body.readUInt16BE(0), f.body.readUInt16BE(2)]; };
  assert.deepEqual(size('{"r":[120,40]}'), [120, 40]);
  assert.deepEqual(size('{"r":[null,"x"]}'), [100, 30], 'неверный размер — значения по умолчанию');
  assert.deepEqual(size('{"r":[99999,-5]}'), [500, 2], 'размер ограничен');
  assert.deepEqual(size('{"r":[]}'), [100, 30]);
});

/* ---------- BIZ-12: транзакции ---------- */
test('db.tx: после отказа BEGIN следующая транзакция открывается и откатывается', (t) => {
  const dir = copyApp(), store = require(path.join(dir, 'db.js'));
  t.after(() => { store.db.close(); rm(dir); });
  const exec = store.db.exec.bind(store.db);
  let failed = 0;
  store.db.exec = (sql) => { if (/^BEGIN/.test(sql) && !failed) { failed = 1; throw new Error('database is locked'); } return exec(sql); };
  assert.throws(() => store.tx(() => store.kv.set('a', 1)), /locked/);
  assert.equal(store.kv.get('a'), undefined, 'функция не выполнялась без транзакции');
  let inside = null;
  assert.throws(() => store.tx(() => { inside = store.db.isTransaction; store.kv.set('b', 1); throw new Error('boom'); }), /boom/);
  assert.equal(inside, true, 'транзакция действительно открыта');
  assert.equal(store.kv.get('b'), undefined, 'запись откатилась');
  assert.equal(store.tx(() => { store.kv.set('c', 1); return 7; }), 7);
  assert.equal(store.kv.get('c'), 1);
});

/* ---------- SEC-02: журнал панели ---------- */
test('журнал панели: текущий пароль и коды 2FA маскируются, лимиты тарифов и промокоды видны', () => {
  const { redact, body } = require(path.join(ROOT, 'admin', 'audit.js'));
  assert.deepEqual(redact({ old: 'Old-Pass-123456', password: 'New-Pass-123456', currentPassword: 'x', otp: '1', login: 'anna', note: 'threshold' }),
    { old: '•••', password: '•••', currentPassword: '•••', otp: '•••', login: 'anna', note: 'threshold' });
  assert.deepEqual(body('/api/admin/me/password', { old: 'a', password: 'b', extra: 1 }), { old: '•••', password: '•••', extra: '•••' });
  assert.deepEqual(body('/api/admin/me/totp/enable', { code: '123456' }), { code: '•••' });
  assert.deepEqual(body('/api/admin/me/totp/disable', { code: '123456' }), { code: '•••' });
  assert.equal(body('/api/admin/me/password', null), null);
  assert.deepEqual(body('/api/admin/plans', { plans: [{ id: 'pro', code: 50, price: 499 }] }), { plans: [{ id: 'pro', code: 50, price: 499 }] }, 'code в тарифах — лимит запусков Python');
  assert.deepEqual(body('/api/admin/promos', { code: 'SALE20', pct: 20 }), { code: 'SALE20', pct: 20 });
});
test('журнал панели: неверный старый пароль не попадает в журнал, старые записи вычищаются', async (t) => {
  const dir = copyApp();
  let srv = await startServer(dir);
  t.after(async () => { await srv.stop(); rm(dir); });
  const login = async () => (await srv.req('POST', '/api/admin/login', { body: { password: 'Test-Admin-Pass-2026' } })).json.token;
  const journal = async (token) => JSON.stringify((await srv.req('GET', '/api/admin/audit', { headers: { Authorization: 'Bearer ' + token } })).json);
  let token = await login(); assert.ok(token);
  const r = await srv.req('POST', '/api/admin/me/password', { body: { old: 'Leaked-Old-Secret-1', password: 'Next-Admin-Pass-2027' }, headers: { Authorization: 'Bearer ' + token } });
  assert.equal(r.status, 400);
  const j = await journal(token);
  assert.match(j, /me\/password/, 'запись о попытке есть');
  assert.doesNotMatch(j, /Leaked-Old-Secret-1|Next-Admin-Pass-2027/);
  // база от прежней версии: запись с паролем открытым текстом и нет отметки об очистке — закрывается при следующем запуске
  await srv.stop();
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(dir, 'data', 'premier.db'));
  db.prepare("DELETE FROM kv WHERE k = 'audit:scrub:me-password'").run();
  db.prepare('INSERT INTO admin_audit (at, action, method, path, status, data) VALUES (?, ?, ?, ?, ?, ?)')
    .run(Date.now(), 'Смена своего пароля', 'POST', '/api/admin/me/password', 400, JSON.stringify({ body: { old: 'Legacy-Leaked-Secret-2', password: '•••' } }));
  db.close();
  srv = await startServer(dir);
  token = await login();
  const after = await journal(token);
  assert.doesNotMatch(after, /Legacy-Leaked-Secret-2/);
  const raw = new DatabaseSync(path.join(dir, 'data', 'premier.db'), { readOnly: true });
  const left = raw.prepare("SELECT count(*) n FROM admin_audit WHERE data LIKE '%Legacy-Leaked-Secret-2%'").get().n; raw.close();
  assert.equal(left, 0, 'в базе значения тоже нет');
  const marks = new DatabaseSync(path.join(dir, 'data', 'premier.db'), { readOnly: true });
  const mark = marks.prepare("SELECT count(*) n FROM kv WHERE k = 'audit:scrub:me-password'").get().n; marks.close();
  assert.equal(mark, 1, 'очистка отмечена как выполненная и при следующих запусках не повторяется');
});

/* ---------- OPS-01: бэкап ---------- */
test('бэкап: файл с паролем владельца не попадает в архив', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'premier-backup-'));
  t.after(() => rm(root));
  const data = path.join(root, 'data'), dest = path.join(root, 'backups');
  fs.mkdirSync(path.join(data, 'files', 'u1'), { recursive: true });
  fs.writeFileSync(path.join(data, 'admin-password.txt'), 'Owner-Secret\n');
  fs.writeFileSync(path.join(data, 'files', 'u1', 'admin-password.txt'), 'файл пользователя с тем же именем');
  fs.writeFileSync(path.join(data, 'files', 'u1', 'note.txt'), 'x');
  execFileSync('bash', [path.join(ROOT, 'deploy', 'backup.sh')], { env: { PATH: process.env.PATH, PREMIER_DATA_DIR: data, BACKUP_DIR: dest }, stdio: 'pipe' });
  const arc = fs.readdirSync(dest).filter((f) => f.endsWith('.tar.gz')); assert.equal(arc.length, 1);
  const list = execFileSync('tar', ['-tzf', path.join(dest, arc[0])], { encoding: 'utf8' }).split('\n');
  assert.ok(!list.includes('data/admin-password.txt'), 'пароля владельца в архиве нет');
  assert.ok(list.includes('data/files/u1/note.txt'));
  assert.ok(list.includes('data/files/u1/admin-password.txt'), 'одноимённый файл пользователя сохранён');
});

/* ---------- SEC-01: уведомление Robokassa ---------- */
function rb(t) {
  const dir = copyApp();
  const bill = require(path.join(dir, 'billing.js')), store = require(path.join(dir, 'db.js'));
  const keys = { login: 'shop', pass1: 'p1', pass2: 'p2-secret' };
  bill.init({ loadSettings: () => ({ robokassa: keys }), saveSettings() {} });
  t.after(() => { try { bill.flush(); } catch {} store.db.close(); rm(dir); });
  store.users.put({ id: 'u1', login: 'anna', email: 'anna@example.com', created: new Date().toISOString() });
  const order = (id, amount, o = {}) => store.payments.put({ id, tx: id, uid: 'u1', login: 'anna', plan: 'pro', days: 30, amount, status: 'PENDING', provider: 'robokassa', created: Date.now(), ...o });
  // уведомление, подписанное так, как его подписывает провайдер: MD5(MerchantLogin:OutSum:OperationId:Password2)
  const note = (InvId, OutSum, OperationId, Result = 'success', login = keys.login) =>
    ({ MerchantLogin: login, OutSum, InvId, OperationId, Result, SignatureProvider: md5([login, OutSum, OperationId, keys.pass2].join(':')) });
  return { bill, store, order, note, status: (id) => store.payments.get(id).status };
}
test('Robokassa: верное уведомление подтверждает заказ, повтор безвреден', (t) => {
  const { bill, store, order, note, status } = rb(t);
  order('ordA', 499);
  const r = bill.rbCallback(note('ordA', '499,00', 'op-1'));
  assert.deepEqual([r.code, r.body], [200, 'OK']);
  assert.equal(status('ordA'), 'CONFIRMED'); assert.equal(store.users.get('u1').plan, 'pro');
  const until = store.users.get('u1').until;
  assert.deepEqual([bill.rbCallback(note('ordA', '499,00', 'op-1')).body, store.users.get('u1').until], ['OK', until], 'дни не начислены второй раз');
  assert.equal(bill.rbCallback({ ...note('ordA', '499.00', 'op-1'), SignatureProvider: md5('shop:499.00:op-1:p2-secret').toUpperCase() }).code, 200, 'подпись в верхнем регистре и сумма через точку принимаются');
});
test('Robokassa: неверная или пустая подпись — 401', (t) => {
  const { bill, order, note, status } = rb(t);
  order('ordA', 499);
  for (const sig of ['', 'zz', '0'.repeat(32), undefined, 'a'.repeat(31)]) assert.equal(bill.rbCallback({ ...note('ordA', '499,00', 'op-1'), SignatureProvider: sig }).code, 401);
  assert.equal(bill.rbCallback(null).code, 401);
  assert.equal(status('ordA'), 'PENDING');
});
test('Robokassa: уведомление не применяется к заказу с другой суммой и к второму заказу после первого', (t) => {
  const { bill, order, note, status } = rb(t);
  order('cheap', 99); order('dear', 6666); order('same', 99);
  const n = note('cheap', '99,00', 'op-7');
  assert.equal(bill.rbCallback({ ...n, InvId: 'dear' }).code, 400, 'сумма не совпадает с заказом');
  assert.equal(status('dear'), 'PENDING');
  assert.equal(bill.rbCallback(n).body, 'OK'); assert.equal(status('cheap'), 'CONFIRMED');
  const again = bill.rbCallback({ ...n, InvId: 'same' });
  assert.deepEqual([again.code, again.rejected], [400, 'операция уже привязана к другому заказу']);
  assert.equal(status('same'), 'PENDING');
});
test('Robokassa: чужой магазин, чужой способ оплаты, нет операции — отклоняются', (t) => {
  const { bill, order, note, status } = rb(t);
  order('ordA', 499); order('ordP', 499, { provider: 'platega' });
  assert.equal(bill.rbCallback(note('ordA', '499,00', 'op-1', 'success', 'other-shop')).code, 400);
  assert.equal(bill.rbCallback(note('ordP', '499,00', 'op-2')).code, 400);
  assert.equal(bill.rbCallback(note('ordA', '499,00', '')).code, 400);
  assert.equal(bill.rbCallback(note('ordA', 'abc', 'op-3')).code, 400);
  assert.deepEqual([status('ordA'), status('ordP')], ['PENDING', 'PENDING']);
  assert.equal(bill.rbCallback(note('nope', '499,00', 'op-4')).ignored, 'no order');
});
test('Robokassa: оплаченный заказ не отменяется уведомлением; отказ привязывает операцию', (t) => {
  const { bill, store, order, note, status } = rb(t);
  order('ordA', 499); order('ordB', 499);
  assert.equal(bill.rbCallback(note('ordA', '499,00', 'op-1')).body, 'OK');
  assert.equal(bill.rbCallback(note('ordA', '499,00', 'op-1', 'fail')).body, 'FAIL');
  assert.equal(status('ordA'), 'CONFIRMED'); assert.equal(store.users.get('u1').plan, 'pro');
  assert.equal(bill.rbCallback(note('ordB', '499,00', 'op-2', 'fail')).body, 'FAIL'); assert.equal(status('ordB'), 'CANCELED');
  order('ordC', 499);
  assert.equal(bill.rbCallback({ ...note('ordB', '499,00', 'op-2', 'fail'), InvId: 'ordC', Result: 'success' }).code, 400, 'отказ по одному заказу не превращается в оплату другого');
  assert.equal(status('ordC'), 'PENDING');
  assert.equal(bill.rbCallback(note('ordB', '499,00', 'op-9')).body, 'OK', 'повторная попытка оплаты того же счёта проходит');
  assert.equal(status('ordB'), 'CONFIRMED');
  // после повторной оплаты другой операцией первая операция остаётся привязанной к своему заказу
  assert.equal(store.payments.get('ordB').tx, 'op-9');
  const replay = bill.rbCallback({ ...note('ordB', '499,00', 'op-2', 'fail'), InvId: 'ordC', Result: 'success' });
  assert.deepEqual([replay.code, replay.rejected], [400, 'операция уже привязана к другому заказу']);
  assert.equal(status('ordC'), 'PENDING');
});
test('Robokassa: ROBOKASSA=off выключает способ оплаты и приём уведомлений', (t) => {
  const { bill, order, note, status } = rb(t);
  order('ordA', 499);
  assert.equal(bill.rbReady(), true);
  process.env.ROBOKASSA = 'off'; t.after(() => { delete process.env.ROBOKASSA; });
  assert.equal(bill.rbReady(), false);
  assert.equal(bill.rbCallback(note('ordA', '499,00', 'op-1')).code, 503);
  assert.equal(status('ordA'), 'PENDING');
  delete process.env.ROBOKASSA;
  assert.equal(bill.rbCallback(note('ordA', '499,00', 'op-1')).body, 'OK');
});
test('Robokassa: возвращённый заказ уведомлением не оживает', (t) => {
  const { bill, order, note, status } = rb(t);
  order('ordA', 499);
  assert.equal(bill.rbCallback(note('ordA', '499,00', 'op-1')).body, 'OK');
  bill.apply({ id: 'ordA', status: 'CONFIRMED' }, 'CHARGEBACKED');
  assert.equal(bill.rbCallback(note('ordA', '499,00', 'op-1')).body, 'FAIL');
  assert.equal(status('ordA'), 'CHARGEBACKED');
});
test('ошибка при запуске попадает в журнал ошибок, процесс завершается с кодом 1', async (t) => {
  const dir = copyApp(); t.after(() => rm(dir));
  const f = path.join(dir, 'server.js'), src = fs.readFileSync(f, 'utf8'), at = "const web = require('./web');";
  assert.ok(src.includes(at));
  fs.writeFileSync(f, src.replace(at, "throw new Error('startup-boom');\n" + at));
  const { spawn } = require('node:child_process');
  const p = spawn(process.execPath, ['server.js'], { cwd: dir, env: { ...process.env, PORT: '0', HOST: '127.0.0.1', CODE_RUNNER: 'off' } });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  const code = await new Promise((res) => p.on('exit', res));
  assert.equal(code, 1);
  assert.match(out, /\[ошибка\] uncaughtException: startup-boom/, 'ошибка дошла до monitor.error');
});
