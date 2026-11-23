// Этап 3 плана: запуск контейнеров облачного компьютера (с поддельной командой docker — настоящие контейнеры не нужны).
//   CLD-02, OPS-02 — без подтверждённой сетевой защиты контейнер не запускается; причина видна в /healthz
//   CLD-03 — перебор квоты и нехватка места на сервере: компьютер не запускается и останавливается; у корзины свой потолок
//   CLD-04 — служебные программы запускаются по полному пути; ответ контейнера ограничен по размеру
//   CLD-09 — «Стоп» завершает процессы в контейнере, а не только клиент docker exec
//   CLD-10 — ограничители занимаются до первого await
// Настоящий Docker и настоящие правила iptables проверяет tests/stage3-cloud-docker.test.js (bash scripts/cloud-check.sh).
// Запуск: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), { EventEmitter } = require('events');
const { copyApp, seed, startServer, rm } = require('../test/helpers');
const { fakeDocker, sleep } = require('./stage3-util');

const NETID = 'a'.repeat(64);
const network = (over = {}) => JSON.stringify([{ Id: NETID, Driver: 'bridge', EnableIPv6: false, Options: { 'com.docker.network.bridge.enable_icc': 'false' }, IPAM: { Config: [{ Subnet: '172.30.0.0/16', Gateway: '172.30.0.1' }] }, ...over }]);
const stateOf = (over = {}) => JSON.stringify({ v: 1, ok: true, at: Math.floor(Date.now() / 1000), network: 'premier-cloud', netId: NETID, bridge: 'br-aaaaaaaaaaaa', mode: 'rootful', reason: '', ...over });
const PROBE_OK = JSON.stringify({ done: true, tried: 8, open: [] });
const ENV = ['CLOUD_RUNNER', 'CLOUD_NETWORK', 'CLOUD_FIREWALL_STATE', 'CLOUD_MAX', 'PATH', 'CLOUD_MIN_FREE_MB', 'CLOUD_TRASH_MAX_MB'];

// cloud.js из копии приложения с поддельным docker; окружение возвращается на место после теста
function setup(t, env = {}, pre) {
  const dir = copyApp(), fake = fakeDocker(dir), keep = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  const state = path.join(dir, 'fw', 'firewall.json'); fs.mkdirSync(path.dirname(state));
  Object.assign(process.env, { CLOUD_RUNNER: 'docker', CLOUD_FIREWALL_STATE: state, PATH: fake.PATH, CLOUD_MIN_FREE_MB: '1', ...env });
  for (const k of ['CLOUD_NETWORK', 'CLOUD_MAX', 'CLOUD_TRASH_MAX_MB']) if (!(k in env)) delete process.env[k];
  fake.set('network.json', network()); fake.set('run-out', PROBE_OK);
  if (pre) pre({ fake, state, dir }); // состояние «до запуска сервера»
  const cloud = require(path.join(dir, 'cloud.js'));
  t.after(() => { for (const k of ENV) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } rm(dir); });
  const ok = () => fs.writeFileSync(state, stateOf());
  const started = () => fake.calls().filter((c) => c[0] === 'run' && c.includes('--name'));
  const net = require(path.join(dir, 'cloud-net.js'));
  return { dir, fake, cloud, state, ok, started, net };
}

/* ---------- CLD-02, OPS-02 ---------- */
test('CLD-02: нет отметки о правилах — контейнер не запускается; с отметкой и удачной пробой — запускается', async (t) => {
  const { fake, cloud, state, ok, started } = setup(t);
  const alerts = []; cloud.hooks.alert = (x) => alerts.push(x);
  await assert.rejects(cloud.ensure('u1', 1024), (e) => e.status === 503 && e.code === 'net' && /сетевую защиту/.test(e.message));
  assert.deepEqual(started(), [], 'docker run для контейнера пользователя не вызывался');
  assert.equal(cloud.netStatus().ok, false); assert.match(cloud.netStatus().reason, /нет отметки .*firewall\.json.*cloud-firewall\.sh apply/);
  assert.equal(alerts.length, 1, 'администратор оповещён один раз'); assert.match(alerts[0], /Облачный компьютер остановлен/);
  await assert.rejects(cloud.ensure('u1', 1024), { code: 'net' }); assert.equal(alerts.length, 1, 'повтор той же причины не шлёт оповещение снова');
  // пользователю причина не раскрывается — только администратору
  assert.doesNotMatch(await cloud.ensure('u1', 1024).catch((e) => e.message), /iptables|firewall|\/run\//);

  ok(); await sleep(5200); // отказ помнится 5 секунд
  await cloud.ensure('u1', 1024);
  assert.equal(started().length, 1); assert.equal(cloud.netStatus().ok, true);
  const probe = fake.calls().find((c) => c[0] === 'run' && c.includes('premier.probe=1'));
  assert.ok(probe, 'перед запуском была живая проба из одноразового контейнера');
  assert.equal(probe[probe.indexOf('--network') + 1], 'premier-cloud'); assert.ok(probe.includes('/usr/local/bin/node'));
  const [targets] = JSON.parse(probe.at(-1));
  assert.ok(targets.some(([h]) => h === '172.30.0.1'), 'проба проверяет адрес сервера в сети контейнеров');
  assert.ok([22, 80, 443].every((p) => targets.some(([, q]) => q === p)), 'и порты SSH и веб-сервера');
  assert.match(alerts.at(-1), /снова на месте/);
  void state;
});

test('CLD-02: каждая из причин отказа — сеть, отметка, проба', async (t) => {
  const { fake, cloud, state, net } = setup(t);
  const check = async (prep, re) => {
    fake.set('network.json', network()); fake.set('run-out', PROBE_OK); fs.writeFileSync(state, stateOf()); fake.unset('run-code');
    prep();
    const n = net.createCloudNet({ docker: (a) => new Promise((ok) => require('child_process').execFile('docker', a, (e, so, se) => ok({ ok: !e, out: String(so).trim(), err: String(se || e?.message || '') }))), NET: 'premier-cloud', IMAGE: 'premier-cloud', stateFile: state });
    const v = await n.verify(); assert.equal(v.ok, false, String(re)); assert.match(v.reason, re);
  };
  await check(() => fake.set('network.json', network({ Options: {} })), /связь между контейнерами/);
  await check(() => fake.set('network.json', network({ EnableIPv6: true })), /включён IPv6/);
  await check(() => fake.set('network.json', network({ Driver: 'macvlan' })), /типа bridge/);
  await check(() => fs.writeFileSync(state, stateOf({ netId: 'b'.repeat(64) })), /другой сети Docker/);
  await check(() => fs.writeFileSync(state, stateOf({ at: Math.floor(Date.now() / 1000) - 600 })), /давно не проверялись \(6\d\d с назад\)/);
  await check(() => fs.writeFileSync(state, stateOf({ ok: false, reason: 'нет правил: iptables INPUT -i br-x -j DROP' })), /нет правил: iptables INPUT/);
  await check(() => fs.writeFileSync(state, '{не json'), /повреждена/);
  await check(() => fs.chmodSync(state, 0o666), /нельзя доверять/); fs.chmodSync(state, 0o644);
  await check(() => fake.set('run-out', JSON.stringify({ done: true, tried: 8, open: ['172.30.0.1:22'] })), /доступны порты сервера: 172\.30\.0\.1:22/);
  await check(() => { fake.set('run-out', 'oops'); fake.set('run-code', 1); }, /не удалось проверить изоляцию/);
  void cloud;
});

test('CLD-02: CLOUD_NETWORK=none — правила не нужны; host и bridge — отказ', async (t) => {
  for (const [netName, good] of [['none', true], ['host', false], ['bridge', false]]) {
    const { cloud, started, fake } = setup(t, { CLOUD_NETWORK: netName });
    if (good) { await cloud.ensure('u1', 1024); assert.equal(started().length, 1); assert.ok(!fake.calls().some((c) => c[0] === 'network')); assert.equal(cloud.netStatus().ok, true); }
    else { await assert.rejects(cloud.ensure('u1', 1024), { code: 'net' }); assert.deepEqual(started(), []); assert.match(cloud.netStatus().reason, new RegExp('CLOUD_NETWORK=' + netName)); }
  }
});

test('CLD-02: защита пропала при работающих контейнерах — сторож их останавливает', async (t) => {
  const { fake, cloud, state, ok } = setup(t);
  const alerts = []; cloud.hooks.alert = (x) => alerts.push(x);
  ok(); await cloud.ensure('u1', 1024); await cloud.ensure('u2', 1024);
  assert.equal((await cloud.status('u1', { pc: 1024 })).running, true);
  fs.rmSync(state); await sleep(10200); fake.clear(); // удачная проверка помнится 10 секунд
  await cloud.watch();
  assert.deepEqual(fake.calls().filter((c) => c[0] === 'rm').map((c) => c.at(-1)).sort(), ['premier-pc-u1', 'premier-pc-u2']);
  assert.equal((await cloud.status('u1', { pc: 1024 })).running, false);
  assert.match(alerts.at(-1), /Облачный компьютер остановлен: правила сетевой защиты не применены/);
});

test('CLD-02: /healthz отвечает 200 и показывает причину; команда в облачном компьютере получает понятный отказ', async (t) => {
  const dir = copyApp(); t.after(() => rm(dir));
  seed(dir, { users: [{ id: 'u1', login: 'anna', email: 'anna@example.com', plan: 'pro', until: Date.now() + 1e10 }], sessions: { tok1: 'u1' } });
  const fake = fakeDocker(dir); fake.set('network.json', network()); fake.set('run-out', PROBE_OK);
  const state = path.join(dir, 'firewall.json');
  const s = await startServer(dir, { PATH: fake.PATH, CLOUD_RUNNER: 'docker', CLOUD_FIREWALL_STATE: state, CLOUD_MIN_FREE_MB: '1' }); t.after(() => s.stop());
  const run = await s.req('POST', '/api/cloud/run', { token: 'tok1', body: { command: 'echo 1' } });
  assert.equal(run.status, 503, run.text); assert.equal(run.json.code, 'net');
  const h = await s.req('GET', '/healthz');
  assert.equal(h.status, 200, 'сервер жив — перезапускать его незачем'); assert.equal(h.json.ok, true);
  assert.equal(h.json.cloudNet.ok, false); assert.match(h.json.cloudNet.reason, /правила сетевой защиты не применены/);
  // формат, который разбирает deploy/healthcheck.sh
  assert.match(h.text, /"cloudNet":\{"ok":false,"reason":"[^"]+"\}/);
  fs.writeFileSync(state, stateOf()); await sleep(5200);
  const run2 = await s.req('POST', '/api/cloud/run', { token: 'tok1', body: { command: 'echo 1' } }); assert.equal(run2.status, 200, run2.text);
  assert.deepEqual((await s.req('GET', '/healthz')).json.cloudNet, { ok: true });
});

/* ---------- CLD-03 ---------- */
test('CLD-03: заметный перебор квоты — компьютер не запускается, работающий останавливается; после удаления лишнего запускается снова', async (t) => {
  const { dir, fake, cloud, ok, started } = setup(t); ok();
  assert.deepEqual([40, 1024, 10240].map(cloud.overMB), [104, 1088, 10752], 'допуск: 5 %, но не меньше 64 МБ');
  const home = path.join(dir, 'data', 'cloud', 'u1'), big = path.join(home, 'big.bin');
  await cloud.ensure('u1', 1); assert.equal(started().length, 1);
  assert.ok(started()[0].join(' ').includes('--ulimit core=0:0'), 'дампы памяти выключены: они тоже занимают место');
  fs.writeFileSync(big, Buffer.alloc(70 * 1048576, 1)); // 70 МБ при квоте 1 МБ (порог остановки — 65 МБ)
  fake.clear(); await cloud.watch();
  assert.deepEqual(fake.calls().filter((c) => c[0] === 'rm').map((c) => c.at(-1)), ['premier-pc-u1'], 'сторож остановил контейнер');
  assert.equal((await cloud.status('u1', { pc: 1 })).running, false);
  fake.clear();
  await assert.rejects(cloud.ensure('u1', 1), (e) => e.status === 507 && e.code === 'quota' && /удалите лишние файлы в панели «Файлы»/.test(e.message));
  assert.equal(started().length, 0);
  // список и удаление работают без контейнера (CLD-11) — этим и освобождается место
  assert.deepEqual((await cloud.listDir('u1', 1, '~')).entries.map((e) => e.name), ['big.bin']);
  fs.rmSync(big); await cloud.ensure('u1', 1); assert.equal(started().length, 1);
});

test('CLD-03: на диске сервера мало места — компьютер не запускается и загрузка файлов закрыта', async (t) => {
  const { cloud, ok, started } = setup(t, { CLOUD_MIN_FREE_MB: String(1e12) }); ok(); // «нужно оставить свободным» больше любого диска
  await assert.rejects(cloud.ensure('u1', 1024), (e) => e.status === 507 && e.code === 'disk' && /заканчивается место/.test(e.message));
  assert.equal(started().length, 0);
  await assert.rejects(cloud.upload('u1', 1024, { dir: '~', name: 'a.txt', length: 3 }, require('stream').Readable.from([Buffer.from('abc')])), (e) => e.status === 507 && e.code === 'disk');
});

test('CLD-03: у корзины свой потолок — самое старое удаляется', async (t) => {
  const { dir, cloud } = setup(t, { CLOUD_TRASH_MAX_MB: '1' });
  const home = path.join(dir, 'data', 'cloud', 'u1'); fs.mkdirSync(home, { recursive: true });
  for (const n of ['a.bin', 'b.bin', 'c.bin']) fs.writeFileSync(path.join(home, n), Buffer.alloc(600 * 1024, 1));
  for (const n of ['a.bin', 'b.bin', 'c.bin']) { await cloud.remove('u1', 1024, '~/' + n); await sleep(15); }
  const left = cloud.trashList('u1');
  assert.deepEqual(left.map((x) => x.name), ['c.bin'], 'в корзине на 1 МБ остался только последний файл 0,6 МБ');
});

/* ---------- CLD-04 ---------- */
test('CLD-04: служебные программы — по полному пути и с постоянным PATH; ответ контейнера ограничен', async (t) => {
  const { fake, cloud, ok } = setup(t);
  ok(); await cloud.ensure('u1', 1024); fake.clear();
  await cloud.call('u1', 1024, 'computer_list', { path: '~' });
  await cloud.run('u1', 'echo 1');
  const ex = fake.calls().filter((c) => c[0] === 'exec');
  const tool = ex.find((c) => c.includes('PC_HOME=/home/premier'));
  assert.equal(tool[tool.indexOf('premier-pc-u1') + 1], '/usr/local/bin/node'); assert.ok(tool.includes('PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'));
  const sh = ex.find((c) => c.some((a) => a.startsWith('PC_CMD=')));
  const i = sh.indexOf('premier-pc-u1'); assert.deepEqual([sh[i + 1], sh[i + 2], sh[i + 3], sh[i + 5]], ['/usr/bin/timeout', '-s', 'KILL', '/bin/bash']);
  assert.ok(!sh.some((a) => a.startsWith('PATH=')), 'команда пользователя идёт с его собственным PATH');
  assert.ok(sh.some((a) => /^PC_RUN=[0-9a-f]{16}$/.test(a)), 'у команды есть метка для остановки (CLD-09)');
  // терминал: python3 по полному пути и с -I (не берёт модули из домашней папки)
  const ws = Object.assign(new EventEmitter(), { sent: [], send(d) { this.sent.push(d); return true; }, close() { this.emit('close'); } });
  fake.set('exec-sleep', 1); await cloud.tty('u1', 1024, ws, 80, 24);
  await sleep(300);
  const pty = fake.calls().find((c) => c[0] === 'exec' && c.includes('/usr/bin/python3'));
  assert.equal(pty[pty.indexOf('/usr/bin/python3') + 1], '-I'); ws.close(); fake.unset('exec-sleep');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'sandbox', 'pc-pty.py'), 'utf8'), /os\.execv\('\/bin\/bash'/);
  // нигде в cloud.js служебная программа не запускается по короткому имени
  const src = fs.readFileSync(path.join(__dirname, '..', 'cloud.js'), 'utf8');
  for (const m of src.matchAll(/spawn\('docker', \[([^\]]*)\]/g)) assert.doesNotMatch(m[1], /'(node|python3|bash|timeout)'/, m[0]);

  // ответ больше предела — отказ, а не рост памяти сервера
  fake.set('exec-out', JSON.stringify({ ok: true, out: 'x'.repeat(5 * 1048576) }));
  assert.match(await cloud.call('u1', 1024, 'computer_read', { path: '~/a' }).catch((e) => e.message), /слишком большой ответ/);
  // одновременных служебных операций — не больше TOOL_PAR
  fake.set('exec-out', '{"ok":true,"out":"ok"}'); fake.set('exec-sleep', 1);
  const all = await Promise.allSettled(Array.from({ length: cloud.TOOL_PAR + 3 }, () => cloud.call('u1', 1024, 'computer_list', { path: '~' })));
  assert.equal(all.filter((r) => r.status === 'fulfilled').length, cloud.TOOL_PAR);
  assert.ok(all.filter((r) => r.status === 'rejected').every((r) => r.reason.status === 429));
  assert.equal(await cloud.call('u1', 1024, 'computer_list', { path: '~' }), 'ok', 'места освобождаются');
});

test('CLD-04: ретранслятор сайтов — кадр больше предела рвёт все соединения; соединений не больше STREAMS_MAX', async (t) => {
  const { fake, cloud, ok } = setup(t);
  ok(); await cloud.ensure('u1', 1024);
  // «ретранслятор» отвечает кадром данных на 2 МиБ для соединения №1
  const head = Buffer.alloc(9); head[0] = 2; head.writeUInt32BE(1, 1); head.writeUInt32BE(2 * 1048576, 5);
  fake.set('exec-out', head.toString('latin1')); fake.set('exec-sleep', 0.3);
  const st = cloud.connect('u1', 8000);
  const err = await new Promise((done) => { st.on('error', done); st.resume(); });
  assert.equal(err.code, 'ECONNRESET');
  fake.set('exec-sleep', 5); fake.set('exec-out', '');
  const many = Array.from({ length: cloud.STREAMS_MAX + 1 }, () => cloud.connect('u1', 8000));
  const last = await new Promise((done) => { many.at(-1).on('error', done); });
  assert.equal(last.code, 'EMFILE'); for (const x of many) { x.on('error', () => {}); x.destroy(); }
  await cloud.stop('u1');
});

/* ---------- CLD-09 ---------- */
test('CLD-09: «Стоп» во время команды — второй docker exec завершает процессы с меткой команды', async (t) => {
  const { fake, cloud, ok } = setup(t);
  ok(); await cloud.ensure('u1', 1024); fake.clear(); fake.set('exec-sleep', 20);
  const ac = new AbortController(), t0 = Date.now();
  const p = cloud.call('u1', 1024, 'computer_run', { command: 'sleep 600' }, ac.signal);
  await sleep(400); ac.abort();
  // сам «убийца» в поддельном docker тоже ждёт exec-sleep — снимаем задержку, чтобы он отработал сразу
  fake.unset('exec-sleep');
  const out = await p;
  assert.ok(Date.now() - t0 < 15000); assert.match(out, /^Остановлено: пользователь остановил ответ\./);
  const ex = fake.calls().filter((c) => c[0] === 'exec');
  const id = ex[0].find((a) => a.startsWith('PC_RUN=')).slice(7);
  const kill = ex.find((c) => c.at(-1) === id);
  assert.ok(kill, 'был отдельный docker exec с меткой остановленной команды');
  assert.equal(kill[kill.indexOf('premier-pc-u1') + 1], '/bin/bash'); assert.match(kill.join(' '), /\/proc\/\[0-9\]\*\/environ.*kill -KILL/);
  // «Стоп» нажат заранее — действие не начинается вовсе
  fake.clear(); const done = new AbortController(); done.abort();
  assert.equal(await cloud.call('u1', 1024, 'computer_run', { command: 'touch x' }, done.signal), cloud.STOPPED);
  assert.equal(await cloud.call('u1', 1024, 'computer_write', { path: 'a', content: 'b' }, done.signal), cloud.STOPPED);
  assert.deepEqual(fake.calls().filter((c) => c[0] === 'exec'), []);
});

/* ---------- CLD-10 ---------- */
test('CLD-10: CLOUD_MAX — одновременные запуски не превышают предел; терминалов не больше трёх', async (t) => {
  const { cloud, ok, started, fake } = setup(t, { CLOUD_MAX: '2' });
  ok();
  const res = await Promise.allSettled(['a', 'b', 'c', 'd', 'e'].map((u) => cloud.ensure(u, 1024)));
  assert.equal(res.filter((r) => r.status === 'fulfilled').length, 2, 'запущено ровно CLOUD_MAX');
  assert.ok(res.filter((r) => r.status === 'rejected').every((r) => /заняты все облачные компьютеры/.test(r.reason.message)));
  assert.equal(started().length, 2);
  // неудачный запуск место не держит
  await cloud.stop('a'); fake.set('run-fail');
  await assert.rejects(cloud.ensure('c', 1024), /не удалось запустить/); fake.unset('run-fail');
  await cloud.ensure('c', 1024);
  // терминалы: пять одновременных открытий — три проходят
  fake.set('exec-sleep', 2);
  const mk = () => Object.assign(new EventEmitter(), { sent: [], closed: false, send(d) { this.sent.push(String(d)); return true; }, close() { if (!this.closed) { this.closed = true; this.emit('close'); } } });
  const wss = Array.from({ length: 5 }, mk);
  await Promise.all(wss.map((w) => cloud.tty('c', 1024, w, 80, 24)));
  assert.equal(wss.filter((w) => w.sent.some((x) => /слишком много терминалов/.test(x))).length, 2);
  for (const w of wss) w.close();
});

test('CLD-10: две команды терминала в чате одновременно — вторая получает отказ сразу', async (t) => {
  const dir = copyApp(); t.after(() => rm(dir));
  seed(dir, { users: [{ id: 'u1', login: 'anna', email: 'anna@example.com', plan: 'pro', until: Date.now() + 1e10 }], sessions: { tok1: 'u1' } });
  const fake = fakeDocker(dir); fake.set('exec-sleep', 1); fake.set('exec-out', 'готово');
  const s = await startServer(dir, { PATH: fake.PATH, CLOUD_RUNNER: 'docker', CLOUD_NETWORK: 'none', CLOUD_MIN_FREE_MB: '1' }); t.after(() => s.stop());
  const run = () => s.req('POST', '/api/cloud/run', { token: 'tok1', body: { command: 'sleep 1' } });
  const got = (await Promise.all([run(), run(), run()])).map((r) => r.status).sort();
  assert.deepEqual(got, [200, 429, 429]);
  assert.equal((await run()).status, 200, 'после окончания команда снова доступна');
});

/* ---------- замечания разбора кода ---------- */
test('CLD-10: сорвавшийся запуск не прячет вытесняемый контейнер от предела CLOUD_MAX и сторожа', async (t) => {
  const { cloud, ok, started, fake, state } = setup(t, { CLOUD_MAX: '1' }); ok();
  await cloud.ensure('a', 1024); assert.equal(started().length, 1);
  // прошло три минуты: «a» простаивает и может быть вытеснен; отметка о правилах за это время устарела — запуск «b» сорвётся
  const now = Date.now; let shift = 3 * 60e3; Date.now = () => now() + shift; t.after(() => { Date.now = now; });
  fake.clear();
  await assert.rejects(cloud.ensure('b', 1024), /сетев|защит|отметк/i);
  assert.equal(fake.calls().filter((c) => c[0] === 'rm' && c.at(-1) === 'premier-pc-a').length, 0, '«a» не останавливали');
  assert.equal((await cloud.status('a', { pc: 1024 })).running, true, '«a» по-прежнему числится работающим');
  // и по-прежнему занимает единственное место: третий пользователь его вытеснит только настоящей остановкой
  shift += 60e3; fs.writeFileSync(state, stateOf()); // ещё минута: прошлый отказ проверки сети уже не помнится, отметка свежая
  fake.clear(); await cloud.ensure('b', 1024);
  assert.equal(fake.calls().filter((c) => c[0] === 'rm' && c.at(-1) === 'premier-pc-a').length, 1, 'теперь «a» остановлен');
  assert.equal((await cloud.status('a', { pc: 1024 })).running, false); assert.equal((await cloud.status('b', { pc: 1024 })).running, true);
});

test('CLD-03: контейнер, переживший перезапуск сервера, получает квоту по тарифу — сторож его не пропускает', async (t) => {
  const { dir, fake, cloud } = setup(t, {}, ({ fake, state, dir }) => {
    fake.set('ps-out', 'u1\nu2\nu3\n'); fs.writeFileSync(state, stateOf());
    for (const u of ['u1', 'u2', 'u3']) fs.mkdirSync(path.join(dir, 'data', 'cloud', u), { recursive: true });
  });
  for (let i = 0; i < 100 && !(await cloud.status('u3', { pc: 1 })).running; i++) await sleep(50);
  assert.equal((await cloud.status('u1', { pc: 1 })).running, true, 'контейнеры подхвачены после перезапуска');
  fs.writeFileSync(path.join(dir, 'data', 'cloud', 'u1', 'big.bin'), Buffer.alloc(70 * 1048576, 1)); // 70 МБ при квоте 1 МБ
  const stopped = () => fake.calls().filter((c) => c[0] === 'rm').map((c) => c.at(-1)).sort();
  // без сведений о тарифе (cloud.js отдельно от сервера) поведение прежнее: останавливать нечем
  fake.clear(); await cloud.watch(); assert.deepEqual(stopped(), []);
  // сервер подставляет квоту по тарифу: u1 — 1 МБ (перебор), u2 — тарифа с компьютером нет, u3 — 1 ГБ (в норме)
  cloud.hooks.quota = (uid) => ({ u1: 1, u2: 0, u3: 1024 })[uid];
  fake.clear(); await cloud.watch();
  assert.deepEqual(stopped(), ['premier-pc-u1', 'premier-pc-u2']);
  assert.equal((await cloud.status('u3', { pc: 1024 })).running, true);
});
