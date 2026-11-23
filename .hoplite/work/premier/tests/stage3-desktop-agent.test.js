// Этап 3, CLD-07/08/09: клиентская часть Premier Agent — только HTTPS, подписанные обновления, рабочая папка,
// подтверждение опасного на самом компьютере, номер устройства, отмена заданий. Запуск: node --test tests/stage3-desktop-agent.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const AGENT = path.join(ROOT, 'desktop', 'premier-agent.js');
const SIGN = path.join(ROOT, 'scripts', 'agent-sign.js');
const agent = require(AGENT);
const sign = require(SIGN);
const WIN = process.platform === 'win32';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const limit = (p, ms, v = 'таймаут') => { let t; return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(v), ms); })]).finally(() => clearTimeout(t)); };
const tmp = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'premier-s3-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
async function waitFor(fn, ms = 5000, what = 'условие') { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await delay(30); } throw new Error('не дождались: ' + what); }
// жив ли процесс (зомби после kill, который никто не забрал, считаем мёртвым)
function alive(pid) {
  try { process.kill(pid, 0); } catch { return false; }
  try { return !/^\d+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return true; }
}
const readPid = (f) => { try { return Number(fs.readFileSync(f, 'utf8').trim()) || 0; } catch { return 0; } };
const SKIP_WIN = WIN ? 'на Windows убийство дерева идёт через taskkill — этот тест проверяет POSIX-группы' : false;
const SKIP_LINK = WIN ? 'создание symlink на Windows требует прав администратора' : false;

/* ---------- checkServer / parseArgs / pickServer ---------- */
test('checkServer: https принимается, адрес нормализуется до origin', () => {
  assert.equal(agent.checkServer('https://example.com'), 'https://example.com');
  assert.equal(agent.checkServer('https://example.com/'), 'https://example.com');
  assert.equal(agent.checkServer(' HTTPS://Example.COM:8443 '), 'https://example.com:8443');
});
test('checkServer: http разрешён только для localhost, 127.0.0.1 и [::1]', () => {
  assert.equal(agent.checkServer('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(agent.checkServer('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080');
  assert.equal(agent.checkServer('http://[::1]:8080'), 'http://[::1]:8080');
});
test('checkServer: http на чужой хост, чужие схемы, логин в адресе и мусор отклоняются по-русски', () => {
  for (const bad of ['http://example.com', 'http://localhost.evil.com', 'http://127.0.0.1.evil.com', 'ftp://example.com', 'javascript:alert(1)', 'file:///etc/passwd',
    'https://user:pass@example.com', 'https://user@example.com', 'http://user:p@localhost', '', 'не ссылка', 'example.com', 'https://example.com/path', 'https://example.com/?a=1', undefined, null])
    assert.throws(() => agent.checkServer(bad), (e) => /[а-я]/i.test(e.message), String(bad));
});
test('parseArgs: ключи, значения через пробел и «=», код привязки — первый не-ключ', () => {
  assert.deepEqual(agent.parseArgs([]), { server: '', workdir: '', noUpdate: false, yesCommands: false, code: '' });
  assert.deepEqual(agent.parseArgs(['--server', 'https://a.b', '--workdir', '/w', '--no-update', '--yes-commands', 'ABC123']), { server: 'https://a.b', workdir: '/w', noUpdate: true, yesCommands: true, code: 'ABC123' });
  assert.deepEqual(agent.parseArgs(['XYZ', '--server=https://c.d', '--workdir=/x y']), { server: 'https://c.d', workdir: '/x y', noUpdate: false, yesCommands: false, code: 'XYZ' });
  assert.equal(agent.parseArgs(['--server', 'https://a.b', 'C1', 'C2']).code, 'C1');
  assert.throws(() => agent.parseArgs(['--server']), /значени/);
  assert.throws(() => agent.parseArgs(['--bogus']), /неизвестный ключ/);
});
test('pickServer: --server, затем PREMIER_SERVER, затем сохранённый', () => {
  const conf = { servers: { 'https://old.example': { token: 't' }, 'https://last.example': { token: 't' } } };
  assert.equal(agent.pickServer({ server: 'https://a' }, { PREMIER_SERVER: 'https://b' }, conf), 'https://a');
  assert.equal(agent.pickServer({ server: '' }, { PREMIER_SERVER: 'https://b' }, conf), 'https://b');
  assert.equal(agent.pickServer({ server: '' }, {}, conf), 'https://last.example');
  assert.equal(agent.pickServer({ server: '' }, {}, { servers: {} }), '');
});

/* ---------- настройки ---------- */
test('migrateConf: старый формат переносится вместе с токенами, номер устройства создаётся', () => {
  const m = agent.migrateConf({ 'https://site.example/': 'tok-1', 'http://plain.example': 'tok-2', 'http://localhost:3000': 'tok-3' });
  assert.equal(m.v, 2); assert.match(m.dev, /^[0-9a-f]{32}$/);
  assert.deepEqual(m.servers, { 'https://site.example': { token: 'tok-1' }, 'http://localhost:3000': { token: 'tok-3' } }, 'http на чужой хост отброшен');
  assert.equal(m.workdir, undefined);
});
test('migrateConf: новый формат не меняется, повторная миграция идемпотентна, мусор даёт пустые настройки', () => {
  const cur = { v: 2, dev: 'a'.repeat(32), workdir: '/w', servers: { 'https://s.example': { token: 'T' } } };
  assert.deepEqual(agent.migrateConf(cur), cur);
  assert.deepEqual(agent.migrateConf(agent.migrateConf({ 'https://s.example': 'T' })).servers, { 'https://s.example': { token: 'T' } });
  for (const junk of [null, 5, 'x', [], undefined]) { const m = agent.migrateConf(junk); assert.equal(m.v, 2); assert.deepEqual(m.servers, {}); assert.match(m.dev, /^[0-9a-f]{32}$/); }
  assert.notEqual(agent.migrateConf({}).dev, agent.migrateConf({}).dev);
});
test('loadConf/saveConf: права 0600, номер устройства сохраняется, старый файл читается', (t) => {
  const d = tmp(t), f = path.join(d, 'conf.json');
  fs.writeFileSync(f, JSON.stringify({ 'https://s.example': 'OLD' }));
  const c = agent.loadConf(f); assert.equal(c.servers['https://s.example'].token, 'OLD');
  assert.ok(agent.saveConf(c, f));
  if (!WIN) assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  const again = agent.loadConf(f); assert.equal(again.dev, c.dev, 'номер устройства живёт вечно'); assert.deepEqual(again.servers, c.servers);
  assert.deepEqual(fs.readdirSync(d), ['conf.json'], 'временных файлов не остаётся');
  assert.equal(agent.loadConf(path.join(d, 'нет.json')).v, 2);
});

/* ---------- рабочая папка ---------- */
function work(t) {
  const d = fs.realpathSync(tmp(t)), wd = path.join(d, 'work'), out = path.join(d, 'outside');
  fs.mkdirSync(wd); fs.mkdirSync(out); return { d, wd, out };
}
test('insideWork: внутри, снаружи, соседняя папка с тем же префиксом и ссылка наружу', { skip: SKIP_LINK }, (t) => {
  const { d, wd, out } = work(t);
  fs.mkdirSync(path.join(wd, 'sub')); fs.symlinkSync(out, path.join(wd, 'link'), 'dir'); fs.writeFileSync(path.join(out, 'secret.txt'), 's');
  assert.equal(agent.insideWork(wd, wd), true);
  assert.equal(agent.insideWork(path.join(wd, 'sub', 'новый', 'f.txt'), wd), true, 'ещё не существует — берём ближайшую существующую папку');
  assert.equal(agent.insideWork(path.join(d, 'work-evil', 'x'), wd), false, 'префикс — не вложенность');
  assert.equal(agent.insideWork(path.join(wd, '..', 'outside', 'x'), wd), false);
  assert.equal(agent.insideWork(path.join(wd, 'link'), wd), false, 'ссылка наружу — это снаружи');
  assert.equal(agent.insideWork(path.join(wd, 'link', 'secret.txt'), wd), false);
  assert.equal(agent.insideWork(path.join(wd, 'link', 'ещё', 'нет'), wd), false);
  fs.symlinkSync(path.join(out, 'будет-позже'), path.join(wd, 'dangling')); // битая ссылка наружу: запись по ней создаст файл снаружи
  assert.equal(agent.insideWork(path.join(wd, 'dangling'), wd), false);
});
test('needConfirm: внутри рабочей папки не спрашиваем, снаружи — спрашиваем, команды — всегда', { skip: SKIP_LINK }, (t) => {
  const { wd, out } = work(t), o = { workdir: wd }, nc = (n, a) => agent.needConfirm(n, a, o);
  fs.symlinkSync(out, path.join(wd, 'link'), 'dir');
  for (const [n, a] of [['computer_list', {}], ['computer_list', { path: wd }], ['computer_read', { path: 'a.txt' }], ['computer_write', { path: path.join(wd, 'a.txt'), content: 'x' }], ['computer_edit', { path: 'a.txt' }],
    ['computer_mkdir', { path: 'new/dir' }], ['computer_delete', { path: 'a.txt' }], ['computer_move', { from: 'a', to: 'b/c' }], ['computer_open', { target: 'https://example.com/x' }], ['computer_open', { target: 'http://example.com' }], ['computer_open', { target: 'picture.png' }]])
    assert.equal(nc(n, a), null, n + ' ' + JSON.stringify(a));
  assert.equal(nc('computer_run', { command: 'ls' }).kind, 'run');
  assert.equal(nc('computer_run', { command: 'ls', cwd: 'sub' }).kind, 'run');
  assert.match(nc('computer_run', { command: 'make all', cwd: 'sub' }).text, new RegExp('make all[^]*' + path.join(wd, 'sub').replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')), 'в тексте полная команда и папка, относительный cwd — от рабочей папки');
  assert.equal(nc('computer_run', { command: 'ls' }).text.includes(wd), true, 'папка по умолчанию — рабочая');
  for (const n of ['computer_list', 'computer_read']) assert.equal(nc(n, { path: path.join(out, 'x') }).kind, 'read-outside', n);
  for (const n of ['computer_write', 'computer_edit', 'computer_mkdir', 'computer_delete']) assert.equal(nc(n, { path: path.join(out, 'x') }).kind, 'write-outside', n);
  assert.equal(nc('computer_move', { from: 'a', to: path.join(out, 'b') }).kind, 'write-outside', 'конец «куда» снаружи');
  assert.equal(nc('computer_move', { from: path.join(out, 'a'), to: 'b' }).kind, 'write-outside', 'конец «откуда» снаружи');
  assert.equal(nc('computer_write', { path: 'link/x.txt' }).kind, 'write-outside', 'ссылка наружу');
  assert.equal(nc('computer_open', { target: path.join(out, 'doc.pdf') }).kind, 'read-outside');
  assert.equal(nc('computer_open', { target: 'tool.sh' }).kind, 'run', 'открыть программу из рабочей папки = запуск');
  assert.equal(nc('computer_open', { target: 'setup.exe' }).kind, 'run');
  assert.equal(nc('computer_read', { path: '~/что-то-в-домашней' }).kind, 'read-outside');
  assert.equal(nc('computer_нет такого', {}), null);
  assert.throws(() => nc('computer_open', { target: 'file:///etc/passwd' }), /http/);
});
test('хранилища секретов закрыты даже для подтверждения; собственные файлы помощника тоже', () => {
  const h = os.homedir();
  for (const p of ['.ssh/id_rsa', '.aws/credentials', '.gnupg/private-keys-v1.d', '.config/gcloud/credentials.db', '.docker/config.json', '.npmrc', '.netrc', '.config/google-chrome/Default/Cookies', '.config/chromium/Default/Login Data', '.mozilla/firefox/x.default/logins.json',
    'Library/Application Support/Google/Chrome/Default/Cookies', 'AppData/Local/Google/Chrome/User Data/Default/Login Data', 'AppData/Local/Microsoft/Edge/User Data/Default', 'AppData/Roaming/Microsoft/Credentials/x'])
    assert.throws(() => agent.guardSecret(path.join(h, ...p.split('/'))), /хранилище/, p);
  assert.throws(() => agent.guardSecret(AGENT), /самого помощника/);
  assert.throws(() => agent.guardSecret(AGENT + '.bak'), /самого помощника/);
  assert.doesNotThrow(() => agent.guardSecret(path.join(h, 'Documents', 'заметки.txt')));
  assert.doesNotThrow(() => agent.guardSecret(path.join(h, '.sshfoo', 'x')), 'префикс имени — не то же самое');
});
test('guardSecret: ссылка внутрь хранилища тоже закрыта', { skip: SKIP_LINK }, (t) => {
  const d = fs.realpathSync(tmp(t)), store = path.join(d, '.ssh'); fs.mkdirSync(store); fs.writeFileSync(path.join(store, 'k'), 'k');
  fs.symlinkSync(store, path.join(d, 'lnk'), 'dir');
  assert.throws(() => agent.guardSecret(path.join(d, 'lnk', 'k'), { stores: [store], own: [] }), /хранилище/);
});

/* ---------- confirmLocal ---------- */
test('confirmLocal: без TTY всегда отказ и вопрос не задаётся', async () => {
  let asked = 0; const answer = async () => { asked++; return 'y'; };
  assert.equal(await agent.confirmLocal({ kind: 'run', text: 'x' }, { tty: false, answer, allow: new Set() }), false);
  assert.equal(asked, 0);
});
test('confirmLocal: y/д — один раз, a/в — до закрытия окна по виду действия, остальное и Enter — отказ', async () => {
  const mk = (...ans) => { const q = [...ans]; return async () => q.shift(); }, allow = new Set(), cl = (kind, answer) => agent.confirmLocal({ kind, text: 't' }, { tty: true, answer, allow });
  assert.equal(await cl('run', mk('y')), true); assert.equal(await cl('run', mk('Д')), true);
  assert.equal(allow.size, 0, 'разовое разрешение ничего не запоминает');
  for (const no of ['', 'n', 'н', 'yes!', 'да', ' ', undefined]) assert.equal(await cl('run', mk(no)), false, JSON.stringify(no));
  assert.equal(await cl('write-outside', mk('a')), true); assert.ok(allow.has('write-outside'));
  assert.equal(await cl('write-outside', async () => { throw new Error('не должен спрашивать'); }), true);
  assert.equal(await cl('read-outside', mk('')), false, 'другой вид действия спрашивается заново');
  assert.equal(await cl('run', mk('в')), true); assert.ok(allow.has('run'));
});
test('confirmLocal: заранее разрешённый вид (--yes-commands) касается только команд', async () => {
  const allow = new Set(['run']); let asked = 0; const answer = async () => { asked++; return ''; };
  assert.equal(await agent.confirmLocal({ kind: 'run', text: 't' }, { tty: false, answer, allow }), true);
  assert.equal(await agent.confirmLocal({ kind: 'write-outside', text: 't' }, { tty: false, answer, allow }), false);
  assert.equal(await agent.confirmLocal({ kind: 'read-outside', text: 't' }, { tty: true, answer, allow }), false);
  assert.equal(asked, 1);
});
test('confirmLocal: нет ответа за отведённое время — отказ; отмена из чата снимает вопрос', async () => {
  const t0 = Date.now();
  assert.equal(await agent.confirmLocal({ kind: 'run', text: 't' }, { tty: true, answer: () => new Promise(() => {}), allow: new Set(), timeout: 80 }), false);
  assert.ok(Date.now() - t0 < 1500);
  const ac = new AbortController(); setTimeout(() => ac.abort(), 50);
  assert.equal(await agent.confirmLocal({ kind: 'run', text: 't' }, { tty: true, answer: () => new Promise(() => {}), allow: new Set(), signal: ac.signal }), false);
});
test('confirmLocal: вопросы идут по одному', async () => {
  let open = 0, maxOpen = 0; const allow = new Set();
  const answer = async () => { maxOpen = Math.max(maxOpen, ++open); await delay(30); open--; return 'y'; };
  const r = await Promise.all([1, 2, 3, 4].map(() => agent.confirmLocal({ kind: 'run', text: 't' }, { tty: true, answer, allow })));
  assert.deepEqual(r, [true, true, true, true]); assert.equal(maxOpen, 1);
});
test('текст вопроса очищен от управляющих символов и ANSI-кодов — подделать вопрос нельзя', (t) => {
  const { wd } = work(t);
  const evil = 'echo hi\x1b[2J\x1b[1;1H\x1b]0;заголовок\x07\r\n\x1b[32m✓ Premier: безопасно, разрешите\x1b[0m\u202e\u0000\x9b31m';
  const req = agent.needConfirm('computer_run', { command: evil, cwd: 'a\nб\x1b[31m' }, { workdir: wd });
  assert.equal(req.text.split('\n').length, 2, 'ровно две строки: команда и папка — перевод строки из текста сервера не работает');
  assert.doesNotMatch(req.text, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202e]/);
  assert.match(req.text, /echo hi/); assert.match(req.text, /✓ Premier: безопасно/, 'видимый текст остаётся — пользователь увидит, что там написано');
  const shown = agent.promptText({ kind: 'run', text: req.text + '\n\x1b[2Jподдельная строка' }).replace(/\x1b\[(?:0|2|31|32|33|36)m/g, '');
  assert.doesNotMatch(shown, /[\u0000-\u0009\u000b-\u001a\u001c-\u001f\u007f-\u009f]/, 'ни одного ESC и управляющего символа, кроме собственных цветов и переводов строки');
  assert.equal(agent.clean('a'.repeat(7000)).length < 6100, true, 'очень длинное обрезается с пометкой');
  assert.match(agent.clean('a'.repeat(7000)), /скрыто/);
});

/* ---------- exec: жёсткие запреты и вопрос ---------- */
test('exec: запись и чтение в рабочей папке без вопроса; снаружи — только с согласием; отказ возвращается модели', async (t) => {
  const { wd, out } = work(t); let asked = []; let answer = false;
  const ctx = { workdir: wd, jobs: new Map(), confirm: async (req) => { asked.push(req); return answer; } };
  assert.match(await agent.exec('computer_write', { path: 'a.txt', content: 'привет' }, ctx), /создан/);
  assert.equal(fs.readFileSync(path.join(wd, 'a.txt'), 'utf8'), 'привет');
  assert.match(await agent.exec('computer_read', { path: 'a.txt' }, ctx), /привет/);
  assert.match(await agent.exec('computer_list', {}, ctx), /a\.txt/);
  assert.equal(asked.length, 0);
  const target = path.join(out, 'b.txt');
  assert.equal(await agent.exec('computer_write', { path: target, content: 'x' }, ctx), agent.DENIED);
  assert.match(agent.DENIED, /^Ошибка: пользователь отклонил действие на своём компьютере \(в окне Premier Agent\)\.$/);
  assert.equal(fs.existsSync(target), false); assert.equal(asked.length, 1); assert.equal(asked[0].kind, 'write-outside');
  answer = true; assert.match(await agent.exec('computer_write', { path: target, content: 'x' }, ctx), /создан/);
  assert.equal(fs.existsSync(target), true);
});
test('exec: секреты и системные папки отказываются без вопроса, даже если пользователь согласился бы', async (t) => {
  const { wd } = work(t); let asked = 0; const ctx = { workdir: wd, jobs: new Map(), confirm: async () => { asked++; return true; } };
  await assert.rejects(agent.exec('computer_read', { path: '~/.ssh/id_rsa' }, ctx), /хранилище/);
  await assert.rejects(agent.exec('computer_list', { path: '~/.aws' }, ctx), /хранилище/);
  await assert.rejects(agent.exec('computer_write', { path: AGENT, content: 'x' }, ctx), /самого помощника/);
  await assert.rejects(agent.exec('computer_delete', { path: wd }, ctx), /рабочую папку целиком/);
  await assert.rejects(agent.exec('computer_run', { command: 'rm -rf /' }, ctx), /заблокирована/);
  if (!WIN) await assert.rejects(agent.exec('computer_write', { path: '/etc/premier-test', content: 'x' }, ctx), /заблокировано/);
  assert.equal(asked, 0);
});
test('exec: computer_run по умолчанию работает в рабочей папке и всегда спрашивает', { skip: SKIP_WIN }, async (t) => {
  const { wd } = work(t); const asked = []; const ctx = { workdir: wd, jobs: new Map(), confirm: async (r) => { asked.push(r); return true; } };
  const r = await agent.exec('computer_run', { command: 'pwd' }, ctx);
  assert.match(r, /Код завершения 0/); assert.ok(r.includes(wd)); assert.equal(asked.length, 1); assert.equal(asked[0].kind, 'run');
  fs.mkdirSync(path.join(wd, 'sub')); assert.ok((await agent.exec('computer_run', { command: 'pwd', cwd: 'sub' }, ctx)).includes(path.join(wd, 'sub')));
  const no = { ...ctx, confirm: async () => false }; assert.equal(await agent.exec('computer_run', { command: 'echo hi > made-by-run.txt' }, no), agent.DENIED);
  assert.equal(fs.existsSync(path.join(wd, 'made-by-run.txt')), false);
});

/* ---------- CLD-09: отмена заданий ---------- */
const mkCtx = (wd, extra = {}) => ({ workdir: wd, jobs: new Map(), confirm: async () => true, ...extra });
async function pids(wd, files) { return Promise.all(files.map((f) => waitFor(() => readPid(path.join(wd, f)), 5000, f))); }
test('отмена убивает всю группу процессов команды быстро и без осиротевших sleep', { skip: SKIP_WIN }, async (t) => {
  const { wd } = work(t), ctx = mkCtx(wd);
  const p = agent.runJob({ jid: 'j1', name: 'computer_run', args: { command: 'sleep 31 & echo $! > pidA; sleep 32 & echo $! > pidB; wait' } }, ctx);
  const [a, b] = await pids(wd, ['pidA', 'pidB']);
  assert.ok(ctx.jobs.has('j1'), 'задание в реестре'); assert.ok(alive(a) && alive(b));
  const t0 = Date.now(); assert.equal(agent.cancelJob('j1', ctx), true);
  const out = await p, dt = Date.now() - t0;
  assert.ok(dt < 2000, 'вернулось за ' + dt + ' мс'); assert.ok(out.startsWith('Остановлено: пользователь остановил ответ.'), out);
  await waitFor(() => !alive(a) && !alive(b), 2000, 'sleep убиты');
  assert.equal(ctx.jobs.size, 0, 'реестр очищен'); assert.equal(agent.cancelJob('j1', ctx), false, 'повторная отмена — ничего');
});
test('отмена фонового запуска в первые 4 секунды убивает его; после 4 секунд фон живёт, но отмена его задания его завершает', { skip: SKIP_WIN, timeout: 60000 }, async (t) => {
  const { wd } = work(t), ctx = mkCtx(wd, { bg: new Map() });
  const p = agent.runJob({ jid: 'bg1', name: 'computer_run', args: { command: 'sleep 33 & echo $! > pidA; sleep 34', background: true } }, ctx);
  const [a] = await pids(wd, ['pidA']); const t0 = Date.now(); agent.cancelJob('bg1', ctx);
  const out = await p; assert.ok(Date.now() - t0 < 2000); assert.ok(out.startsWith(agent.STOPPED), out);
  await waitFor(() => !alive(a), 2000, 'фон убит');
  // фон пережил свои 4 секунды: задание закрыто, но процесс числится за его номером
  const keep = await agent.runJob({ jid: 'bg2', name: 'computer_run', args: { command: 'sleep 36 & echo $! > pidC; echo $$ > pidK; sleep 35', background: true } }, ctx);
  assert.match(keep, /Запущено в фоне/); assert.equal(ctx.jobs.size, 0); assert.deepEqual([...ctx.bg.keys()], ['bg2']);
  const k = readPid(path.join(wd, 'pidK')), c = readPid(path.join(wd, 'pidC')); assert.ok(alive(k) && alive(c), 'фоновый процесс продолжает работать');
  agent.killAll(ctx); await delay(300); assert.ok(alive(k), 'обычная остановка помощника фон не трогает');
  // «Стоп» в чате после ответа «Запущено в фоне»: раньше отмена сюда уже не доходила (CLD-09)
  assert.equal(agent.cancelJob('bg2', ctx), true); await waitFor(() => !alive(k) && !alive(c), 3000, 'фон и его потомок завершены');
  assert.equal(ctx.bg.size, 0); assert.equal(agent.cancelJob('bg2', ctx), false, 'повторная отмена — ничего');
  // доступ отозван (401): завершается всё, и фон тоже
  await agent.runJob({ jid: 'bg3', name: 'computer_run', args: { command: 'echo $$ > pidR; sleep 37', background: true } }, ctx);
  const r = readPid(path.join(wd, 'pidR')); assert.ok(alive(r)); agent.killAll(ctx, true);
  await waitFor(() => !alive(r), 3000, 'фон завершён при отзыве доступа'); assert.equal(ctx.bg.size, 0);
  // оболочка вышла уже после ответа «Запущено в фоне», а оставленный ею процесс работает: запись остаётся, «Стоп» его находит
  await agent.runJob({ jid: 'bg5', name: 'computer_run', args: { command: 'sleep 4.5; sleep 38 & echo $! > pidE', background: true } }, ctx);
  const [e] = await pids(wd, ['pidE']); await delay(600); assert.ok(alive(e)); assert.ok(ctx.bg.has('bg5'), 'оболочка вышла, группа жива — запись на месте');
  assert.equal(agent.cancelJob('bg5', ctx), true); await waitFor(() => !alive(e), 3000, 'оставленный процесс завершён');
  // оболочка вышла раньше 4 секунд («Процесс завершился сразу»), но оставила процесс — он тоже числится за заданием
  const quick = await agent.runJob({ jid: 'bg6', name: 'computer_run', args: { command: 'sleep 39 >/dev/null 2>&1 & echo $! > pidF', background: true } }, ctx);
  assert.match(quick, /Процесс завершился сразу \(код 0\)/); const f = readPid(path.join(wd, 'pidF')); assert.ok(alive(f) && ctx.bg.has('bg6'));
  agent.killAll(ctx, true); await waitFor(() => !alive(f), 3000, 'и он завершён при отзыве доступа');
  // группа опустела сама — запись убирается
  await agent.runJob({ jid: 'bg7', name: 'computer_run', args: { command: 'sleep 2 >/dev/null 2>&1 &', background: true } }, ctx);
  assert.ok(ctx.bg.has('bg7')); await waitFor(() => !ctx.bg.has('bg7'), 8000, 'запись об опустевшей группе убрана');
  // фон, который завершился сам, из реестра уходит
  await agent.runJob({ jid: 'bg4', name: 'computer_run', args: { command: 'sleep 5', background: true } }, ctx);
  assert.equal(ctx.bg.size, 1); await waitFor(() => ctx.bg.size === 0, 6000, 'запись о завершившемся фоне убрана');
});
test('CLD-07: ссылка и файл открываются без оболочки — «&», «|», «%ИМЯ%» не становятся командами', (t) => {
  // ссылка: принимается только разобранный адрес http(s), дальше идёт его нормальная запись
  assert.equal(agent.openUrl('https://example.invalid/a b?q="x"'), 'https://example.invalid/a%20b?q=%22x%22');
  assert.equal(agent.openUrl('HTTPS://Example.invalid'), 'https://example.invalid/');
  for (const bad of ['https://user:pw@example.invalid/', 'https://', 'https://exa mple.invalid/', 'https://example.invalid/' + 'a'.repeat(2100)])
    assert.throws(() => agent.openUrl(bad), /ссылк/, bad);
  const evil = 'https://example.invalid/&calc.exe', evil2 = 'https://example.invalid/?a=%PATH%|calc';
  for (const u of [evil, evil2]) {
    const [cmd, args, opt] = agent.opener(agent.openUrl(u), true, 'win32');
    assert.equal(cmd, 'rundll32.exe'); assert.deepEqual(args, ['url.dll,FileProtocolHandler', agent.openUrl(u)]); assert.ok(!opt.shell, 'без оболочки');
    assert.ok(!/["\s]/.test(args[1]), 'в адресе нет кавычек и пробелов — на аргументы он не делится');
  }
  // файл: путь всегда одним аргументом в кавычках, программа — не cmd
  const [cmd, args, opt] = agent.opener('C:\\work\\a&calc.exe, b.txt', false, 'win32');
  assert.equal(cmd, 'explorer.exe'); assert.deepEqual(args, ['"C:\\work\\a&calc.exe, b.txt"']); assert.equal(opt.windowsVerbatimArguments, true); assert.ok(!opt.shell);
  assert.throws(() => agent.opener('C:\\work\\a" & calc & ".txt', false, 'win32'), /недопустимые символы/);
  for (const pf of ['win32', 'darwin', 'linux']) for (const isUrl of [true, false]) { const [c] = agent.opener(isUrl ? 'https://example.invalid/' : '/w/a.txt', isUrl, pf); assert.ok(!/^(cmd|sh|bash|powershell)/i.test(c), pf + ': ' + c); }
  assert.deepEqual(agent.opener('/w/a&b.txt', false, 'linux').slice(0, 2), ['xdg-open', ['/w/a&b.txt']]); assert.deepEqual(agent.opener('/w/a.txt', false, 'darwin').slice(0, 2), ['open', ['/w/a.txt']]);
  // в исходнике не осталось открытия через cmd /c start
  assert.ok(!/['"]\/c['"],\s*['"]start['"]/.test(fs.readFileSync(AGENT, 'utf8')), 'cmd /c start убран');
});
test('CLD-07: computer_open с логином в ссылке или с чужой схемой отклоняется до запуска чего-либо', async (t) => {
  const { wd } = work(t), ctx = mkCtx(wd);
  for (const target of ['https://user:pw@example.invalid/', 'file:///etc/passwd', 'javascript://x', 'https://exa mple.invalid/'])
    assert.match(await agent.exec('computer_open', { target }, ctx).catch((e) => 'Ошибка: ' + e.message), /^Ошибка: .*(ссылк|http)/, target);
});
test('тайм-аут тоже убивает всю группу, а не только оболочку', { skip: SKIP_WIN }, async (t) => {
  const { wd } = work(t), ctx = mkCtx(wd, { runTimeout: 600 });
  const out = await agent.runJob({ jid: 'to', name: 'computer_run', args: { command: 'sleep 36 & echo $! > pidA; sleep 37; wait' } }, ctx);
  assert.match(out, /^Остановлено: команда шла дольше 10 минут/);
  await waitFor(() => !alive(readPid(path.join(wd, 'pidA'))), 2000, 'sleep убит');
});
test('отмена задания, которое ждёт локального подтверждения, отвечает «нет»', async (t) => {
  const { wd } = work(t); let shown = 0;
  const ctx = mkCtx(wd, { confirm: (req, o) => agent.confirmLocal(req, { tty: true, allow: new Set(), signal: o.signal, answer: () => { shown++; return new Promise(() => {}); } }) });
  const p = agent.runJob({ jid: 'c1', name: 'computer_run', args: { command: 'echo не-должно-выполниться > ran.txt' } }, ctx);
  await waitFor(() => shown, 2000, 'вопрос показан'); const t0 = Date.now(); assert.equal(agent.cancelJob('c1', ctx), true);
  assert.ok((await p).startsWith(agent.STOPPED)); assert.ok(Date.now() - t0 < 1000); assert.equal(fs.existsSync(path.join(wd, 'ran.txt')), false);
});
test('runJob: ошибка действия становится строкой «Ошибка: …», реестр очищается', async (t) => {
  const { wd } = work(t), ctx = mkCtx(wd);
  assert.match(await agent.runJob({ jid: 'e1', name: 'computer_read', args: { path: 'нет-такого.txt' } }, ctx), /^Ошибка: /);
  assert.match(await agent.runJob({ jid: 'e2', name: 'computer_летать', args: {} }, ctx), /неизвестное действие/);
  assert.equal(ctx.jobs.size, 0);
});

/* ---------- CLD-07: подписанные обновления ---------- */
const V = (n) => (s) => s.replace('const AGENT_VERSION = 2;', `const AGENT_VERSION = ${n};`);
// временная копия помощника, подписанная новым ключом: { dir, js, key, pub }
function release(t, { version = 2, comment = '' } = {}) {
  const dir = tmp(t), js = path.join(dir, 'premier-agent.js'), key = path.join(dir, 'k.key');
  fs.writeFileSync(js, V(version)(fs.readFileSync(AGENT, 'utf8')) + comment);
  const k = sign.keygen(); fs.writeFileSync(key, k.privatePem, { mode: 0o600 });
  sign.embedKey(js, k.publicKey); sign.signFile(js, key);
  return { dir, js, key, pub: k.publicKey };
}
test('репозиторный premier-agent.js: UPDATE_KEYS пуст, подписи и закрытого ключа в репозитории нет', () => {
  const src = fs.readFileSync(AGENT, 'utf8');
  assert.equal(src.split('\n').filter((l) => l === 'const UPDATE_KEYS = [/*UPDATE_KEYS*/];').length, 1);
  assert.equal(src.split('\n').filter((l) => /^const UPDATE_KEYS\b/.test(l)).length, 1);
  assert.deepEqual(agent.UPDATE_KEYS, []); assert.deepEqual(sign.embeddedKeys(src), []);
  assert.match(src, /^const AGENT_VERSION = 2;$/m); assert.equal(agent.AGENT_VERSION, 2);
  assert.equal(fs.existsSync(AGENT + '.sig'), false); assert.equal(sign.verifyRelease().ok, false);
  assert.equal(fs.existsSync(path.join(ROOT, 'premier-agent-signing.key')), false);
  assert.doesNotMatch(src, /__PREMIER_SERVER__/, 'адрес сервера в файл больше не вшивается');
});
test('agent-sign: keygen → embedKey → signFile → verifyRelease на временной копии', (t) => {
  const r = release(t);
  assert.deepEqual(sign.embeddedKeys(fs.readFileSync(r.js)), [r.pub]);
  const v = sign.verifyRelease(r.dir); assert.deepEqual(v, { ok: true, keys: 1 });
  assert.equal(sign.verify(fs.readFileSync(r.js), fs.readFileSync(r.js + '.sig', 'utf8'), [r.pub]), true);
  assert.equal(sign.embedKey(r.js, r.pub), false, 'тот же ключ второй раз не добавляется');
  assert.equal(sign.verifyRelease(r.dir).ok, true, 'повторное вписывание ничего не сломало');
  if (!WIN) assert.equal(fs.statSync(r.key).mode & 0o777, 0o600);
  assert.match(fs.readFileSync(r.key, 'utf8'), /BEGIN PRIVATE KEY/);
  const m = require(r.js); assert.deepEqual(m.UPDATE_KEYS, [r.pub], 'вписанная строка остаётся корректным JS');
});
test('agent-sign: изменённый файл, пустой UPDATE_KEYS, чужой ключ и отсутствие подписи — не проходят', (t) => {
  const r = release(t);
  fs.appendFileSync(r.js, '\n// правка после подписи\n');
  const bad = sign.verifyRelease(r.dir); assert.equal(bad.ok, false); assert.match(bad.error, /подпись/i);
  const dir = tmp(t); fs.copyFileSync(AGENT, path.join(dir, 'premier-agent.js'));
  assert.deepEqual(sign.verifyRelease(dir), { ok: false, error: sign.verifyRelease(dir).error, keys: 0 }); assert.match(sign.verifyRelease(dir).error, /UPDATE_KEYS/);
  const r2 = release(t); fs.copyFileSync(r.js + '.sig', r2.js + '.sig'); assert.equal(sign.verifyRelease(r2.dir).ok, false, 'подпись от другого ключа/файла');
  fs.rmSync(r2.js + '.sig'); assert.match(sign.verifyRelease(r2.dir).error, /\.sig/);
  assert.equal(sign.verify(Buffer.from('x'), 'не-base64!!', [r.pub]), false);
  assert.equal(sign.verify(Buffer.from('x'), '', [r.pub]), false);
  assert.throws(() => sign.signFile(r.js, r2.key) && sign.signFile(path.join(dir, 'premier-agent.js'), r.key), /UPDATE_KEYS/, 'ключ, которого нет в UPDATE_KEYS, не подписывает');
});
test('agent-sign CLI: init → verify → правка → verify=1 → sign → verify=0; init не перезаписывает ключ', (t) => {
  const dir = tmp(t), js = path.join(dir, 'premier-agent.js'), key = path.join(dir, 'my.key');
  fs.copyFileSync(AGENT, js); const run = (...a) => spawnSync(process.execPath, [SIGN, ...a], { cwd: dir, encoding: 'utf8' });
  const init = run('init', '--key', key, '--file', js);
  assert.equal(init.status, 0, init.stderr); assert.match(init.stdout, /ВНЕ сервера/); assert.match(init.stdout, /Потеряете ключ/);
  if (!WIN) assert.equal(fs.statSync(key).mode & 0o777, 0o600);
  assert.equal(run('verify', '--file', js).status, 0); assert.match(run('verify', '--file', js).stdout, /верна/);
  const again = run('init', '--key', key, '--file', js); assert.equal(again.status, 1); assert.match(again.stderr, /уже есть/);
  fs.appendFileSync(js, '\n// x\n'); const v = run('verify', '--file', js); assert.equal(v.status, 1); assert.match(v.stdout, /НЕ проверена/);
  assert.equal(run('sign', '--key', key, '--file', js).status, 0); assert.equal(run('verify', '--file', js).status, 0);
  assert.equal(run('sign', '--key', path.join(dir, 'нет.key'), '--file', js).status, 1);
  assert.equal(fs.existsSync(path.join(ROOT, 'desktop', 'premier-agent.js.sig')), false, 'репозиторий не тронут');
});
test('checkUpdate: тот же файл — не ставим; верная подпись — ставим', (t) => {
  const r = release(t), cur = fs.readFileSync(r.js), sigOf = (f) => fs.readFileSync(f + '.sig', 'utf8');
  const same = agent.checkUpdate({ current: cur, next: Buffer.from(cur), sig: sigOf(r.js) }); assert.equal(same.install, false); assert.ok(same.reason);
  const nx = path.join(r.dir, 'next.js'); fs.writeFileSync(nx, V(3)(cur.toString()) ); sign.signFile(nx, r.key);
  const ok = agent.checkUpdate({ current: cur, next: fs.readFileSync(nx), sig: sigOf(nx) }); assert.deepEqual(ok, { install: true, reason: ok.reason });
  const same2 = path.join(r.dir, 'same-version.js'); fs.writeFileSync(same2, cur.toString() + '\n// новая сборка той же версии\n'); sign.signFile(same2, r.key);
  assert.equal(agent.checkUpdate({ current: cur, next: fs.readFileSync(same2), sig: sigOf(same2) }).install, true, 'та же версия протокола допустима');
});
test('checkUpdate: неверная или отсутствующая подпись, ключ только в новом файле, понижение версии — отказ', (t) => {
  const r = release(t), cur = fs.readFileSync(r.js), sigOf = (f) => fs.readFileSync(f + '.sig', 'utf8');
  const nx = path.join(r.dir, 'next.js'); fs.writeFileSync(nx, V(3)(cur.toString())); sign.signFile(nx, r.key);
  const next = fs.readFileSync(nx);
  assert.equal(agent.checkUpdate({ current: cur, next, sig: sigOf(r.js) }).install, false, 'подпись от другого содержимого');
  assert.equal(agent.checkUpdate({ current: cur, next, sig: '' }).install, false);
  assert.equal(agent.checkUpdate({ current: cur, next, sig: 'AAAA' }).install, false);
  assert.equal(agent.checkUpdate({ current: cur, next: Buffer.concat([next, Buffer.from('//')]), sig: sigOf(nx) }).install, false, 'файл подменён после подписи');
  // атакующий выкладывает файл со СВОИМ ключом и своей подписью
  const evil = release(t, { version: 3 }), evilJs = fs.readFileSync(evil.js);
  const a = agent.checkUpdate({ current: cur, next: evilJs, sig: sigOf(evil.js) }); assert.equal(a.install, false); assert.match(a.reason, /подпись/);
  const curSrc = fs.readFileSync(AGENT, 'utf8');
  const empty = Buffer.from(curSrc.replace(/const UPDATE_KEYS = \[[^\]\r\n]*\];/, 'const UPDATE_KEYS = [/*UPDATE_KEYS*/];')); // файл без ключей: в проде агент может быть уже подписан
  const b = agent.checkUpdate({ current: empty, next: evilJs, sig: sigOf(evil.js) }); assert.equal(b.install, false); assert.match(b.reason, /нет ключа/);
  // понижение версии даже с верной подписью
  const old = path.join(r.dir, 'old.js'); fs.writeFileSync(old, V(1)(cur.toString())); sign.signFile(old, r.key);
  const d = agent.checkUpdate({ current: cur, next: fs.readFileSync(old), sig: sigOf(old) }); assert.equal(d.install, false); assert.match(d.reason, /ниже/);
});

// маленький сервер, отдающий файлы обновления
function fileServer(t, handler) {
  return new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => { t.after(() => new Promise((r) => { s.closeAllConnections?.(); s.close(r); })); resolve({ s, origin: 'http://127.0.0.1:' + s.address().port }); }); });
}
test('selfUpdate: ставит подписанное обновление (.bak, перезапуск), не ставит неподписанное, не идёт по редиректу', async (t) => {
  const r = release(t), cur = fs.readFileSync(r.js, 'utf8'); const next = path.join(r.dir, 'next.js');
  fs.writeFileSync(next, V(3)(cur)); sign.signFile(next, r.key);
  const serve = { js: fs.readFileSync(next), sig: fs.readFileSync(next + '.sig') }; let mode = 'ok', other = 0;
  const side = await fileServer(t, (q, s) => { other++; s.end('чужой'); });
  const { origin } = await fileServer(t, (q, s) => {
    if (mode === 'redirect') { s.writeHead(302, { Location: side.origin + q.url }); return s.end(); }
    if (q.url === '/premier-agent.js') return s.end(mode === 'same' ? cur : serve.js);
    if (q.url === '/premier-agent.js.sig') { if (mode === 'nosig') { s.writeHead(404); return s.end(); } return s.end(mode === 'badsig' ? fs.readFileSync(r.js + '.sig') : serve.sig); }
    s.writeHead(404); s.end();
  });
  const calls = []; const o = { file: r.js, argv: ['--x', 'КОД'], reexec: (f, a) => calls.push([f, a]) };
  mode = 'same'; assert.equal(await agent.selfUpdate(origin, o), 'same');
  mode = 'nosig'; assert.equal(await agent.selfUpdate(origin, o), 'unsigned'); assert.equal(fs.readFileSync(r.js, 'utf8'), cur);
  mode = 'badsig'; assert.equal(await agent.selfUpdate(origin, o), 'unsigned'); assert.equal(fs.readFileSync(r.js, 'utf8'), cur);
  mode = 'redirect'; await assert.rejects(agent.selfUpdate(origin, o)); assert.equal(other, 0, 'на другой origin запросов нет'); assert.equal(fs.readFileSync(r.js, 'utf8'), cur);
  mode = 'ok'; assert.equal(await agent.selfUpdate(origin, { ...o, canInstall: () => false }), 'busy'); assert.equal(fs.readFileSync(r.js, 'utf8'), cur, 'пока идут задания — не обновляемся');
  assert.equal(await agent.selfUpdate(origin, o), 'installed');
  assert.equal(fs.readFileSync(r.js, 'utf8'), V(3)(cur)); assert.equal(fs.readFileSync(r.js + '.bak', 'utf8'), cur); assert.equal(fs.existsSync(r.js + '.new'), false);
  assert.deepEqual(calls, [[r.js, ['--x', 'КОД']]]);
  await assert.rejects(agent.selfUpdate('http://example.com', o), /https/);
});

/* ---------- CLD-07/08/09: помощник целиком против поддельного сервера ---------- */
function runAgent(t, args, env = {}) {
  const home = fs.realpathSync(tmp(t)), conf = path.join(home, 'conf.json');
  const child = spawn(process.execPath, [AGENT, ...args], { env: { ...process.env, PREMIER_SERVER: '', HOME: home, USERPROFILE: home, PREMIER_AGENT_CONF: conf, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
  const exit = new Promise((r) => child.on('exit', (code) => r(code)));
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });
  return { home, conf, child, exit, log: () => log, wd: path.join(home, 'Premier') };
}
test('помощник: https обязателен — http на чужой хост и мусор в --server завершаются с понятной ошибкой', async (t) => {
  for (const srv of ['http://example.com', 'ftp://x', 'https://u:p@example.com']) {
    const a = runAgent(t, ['--server', srv, '--no-update', 'CODE']); const code = await a.exit;
    assert.equal(code, 1, srv); assert.match(a.log(), /Адрес сервера/);
  }
  const none = runAgent(t, ['--no-update']); assert.equal(await none.exit, 1); assert.match(none.log(), /не задан адрес сервера/);
});
test('помощник по сети: код → токен, номер устройства, протокол v2, параллельные задания, отмена, 426', { skip: SKIP_WIN, timeout: 60000 }, async (t) => {
  const TOKEN = 'TOK-' + crypto.randomBytes(4).toString('hex');
  const st = { connects: [], polls: [], results: {}, step: 0, sent: false, cancelSent: false, auth: new Set() };
  let a; // запущенный помощник (нужен путь к рабочей папке до старта)
  const outsideDir = fs.realpathSync(tmp(t)); fs.writeFileSync(path.join(outsideDir, 'вне.txt'), 'секретик');
  const jobs = [
    { jid: 'J1', name: 'computer_write', args: { path: 'hello.txt', content: 'привет' } },
    { jid: 'J2', name: 'computer_read', args: { path: path.join(outsideDir, 'вне.txt') } },
    { jid: 'J3', name: 'computer_read', args: { path: '~/.ssh/id_rsa' } },
    { jid: 'J4', name: 'computer_run', args: { command: 'echo run-ok; pwd' } },
    { jid: 'J5', name: 'computer_write', args: { path: path.join(outsideDir, 'new.txt'), content: 'x' } },
    { jid: 'J6', name: 'computer_run', args: { command: 'sleep 38 & echo $! > pidA; sleep 39; wait' }, cancel: true },
  ];
  const { origin } = await fileServer(t, async (req, res) => {
    let b = ''; for await (const c of req) b += c; const body = b ? JSON.parse(b) : {};
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? undefined : JSON.stringify(obj)); };
    if (req.url === '/api/agent/connect') { st.connects.push(body); return body.code === 'CODE1' ? send(200, { token: TOKEN }) : send(400, { error: 'неверный код' }); }
    if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(401, { error: 'нет доступа' });
    if (req.url === '/api/agent/result') { st.results[body.jid] = body.out; return send(200, { ok: true }); }
    if (req.url !== '/api/agent/poll') return send(404, {});
    st.polls.push(body); await delay(60);
    for (;;) {
      const job = jobs[st.step]; if (!job) return send(426, { error: 'обновите помощника' });
      if (!st.sent) { st.sent = true; return send(200, { jid: job.jid, name: job.name, args: job.args }); }
      if (st.results[job.jid] !== undefined) { st.step++; st.sent = false; continue; }
      if (job.cancel && !st.cancelSent && body.busy.includes(job.jid) && readPid(path.join(a.wd, 'pidA'))) { st.cancelSent = Date.now(); return send(200, { cancel: [job.jid] }); }
      return send(204);
    }
  });
  a = runAgent(t, ['--server', origin, '--no-update', '--yes-commands', 'CODE1']);
  assert.equal(await limit(a.exit, 40000), 1, a.log());
  const log = a.log();
  assert.match(log, /устарел/, 'ответ 426 — понятное сообщение'); assert.match(log, /Рабочая папка: /); assert.match(log, /--yes-commands/);
  // подключение
  assert.equal(st.connects.length, 1); const c = st.connects[0];
  assert.equal(c.code, 'CODE1'); assert.equal(c.v, 2); assert.match(c.dev, /^[0-9a-f]{32}$/); assert.equal(c.info.workdir, a.wd);
  // опрос
  assert.ok(st.polls.length > 3); for (const p of st.polls) { assert.equal(p.v, 2); assert.equal(p.dev, c.dev); assert.ok(Array.isArray(p.busy)); assert.equal(p.info.workdir, a.wd); }
  assert.ok(st.polls.some((p) => p.busy.includes('J6')), 'во время работы помощник продолжает опрос и сообщает busy');
  // настройки
  const conf = JSON.parse(fs.readFileSync(a.conf, 'utf8')); assert.equal(conf.v, 2); assert.equal(conf.dev, c.dev); assert.equal(conf.servers[origin].token, TOKEN); assert.equal(conf.workdir, a.wd);
  assert.equal(fs.statSync(a.conf).mode & 0o777, 0o600); assert.ok(fs.statSync(a.wd).isDirectory());
  // результаты
  assert.match(st.results.J1, /Готово.*создан/); assert.equal(fs.readFileSync(path.join(a.wd, 'hello.txt'), 'utf8'), 'привет');
  assert.equal(st.results.J2, agent.DENIED, 'чтение вне рабочей папки без TTY — отказ'); assert.doesNotMatch(st.results.J2, /секретик/);
  assert.match(st.results.J3, /^Ошибка: .*хранилище/);
  assert.match(st.results.J4, /run-ok/); assert.ok(st.results.J4.includes(a.wd), 'cwd — рабочая папка');
  assert.equal(st.results.J5, agent.DENIED); assert.equal(fs.existsSync(path.join(outsideDir, 'new.txt')), false);
  assert.ok(st.results.J6.startsWith('Остановлено: пользователь остановил ответ.'), st.results.J6);
  await waitFor(() => !alive(readPid(path.join(a.wd, 'pidA'))), 3000, 'sleep убит после отмены');
});
test('помощник: старый формат настроек подхватывается, 401 без TTY → выход; редирект на чужой адрес не выполняется', { skip: SKIP_WIN, timeout: 30000 }, async (t) => {
  const side = []; const other = await fileServer(t, (q, s) => { side.push(q.url); s.end('{}'); });
  const hits = [];
  const { origin } = await fileServer(t, async (req, res) => {
    let b = ''; for await (const c of req) b += c; hits.push([req.url, req.headers.authorization || '', b ? JSON.parse(b) : {}]);
    if (req.url === '/api/agent/poll') { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":"отключено"}'); }
    res.writeHead(302, { Location: other.origin + '/steal' }); res.end();
  });
  const home = fs.realpathSync(tmp(t)), conf = path.join(home, 'old.json');
  fs.writeFileSync(conf, JSON.stringify({ [origin + '/']: 'OLD-TOKEN' }));
  const a = runAgent(t, ['--server', origin, '--no-update'], { HOME: home, USERPROFILE: home, PREMIER_AGENT_CONF: conf });
  await waitFor(() => hits.length, 8000, 'запрос на сервер');
  assert.equal(hits[0][0], '/api/agent/poll'); assert.equal(hits[0][1], 'Bearer OLD-TOKEN', 'старый токен работает'); assert.equal(hits[0][2].v, 2);
  assert.equal(await limit(a.exit, 15000), 1, 'после 401 без ввода кода помощник выходит'); assert.match(a.log(), /отключён/);
  assert.equal(JSON.parse(fs.readFileSync(conf, 'utf8')).servers[origin], undefined, 'отозванный токен удалён');
  // редирект
  const b = runAgent(t, ['--server', origin, '--no-update', 'XXXX']); assert.equal(await b.exit, 1);
  assert.deepEqual(side, [], 'за редиректом на другой адрес помощник не пошёл'); assert.ok(hits.some((h) => h[0] === '/api/agent/connect'));
});
