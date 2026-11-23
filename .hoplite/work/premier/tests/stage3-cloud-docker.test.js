// Этап 3 плана — проверки приёмки на НАСТОЯЩЕМ Docker и настоящих правилах iptables.
// Не входит в обычный прогон: нужен Docker, образ premier-cloud и sudo без пароля (скрипт правил работает от root).
// Запуск: bash scripts/cloud-check.sh   (или CLOUD_DOCKER_TEST=1 node --test tests/stage3-cloud-docker.test.js)
// Тест создаёт свою сеть Docker и свои правила и убирает их за собой; сеть premier-cloud и её правила не трогает.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), net = require('net'), os = require('os'), crypto = require('crypto');
const { spawnSync } = require('child_process');
const { EventEmitter } = require('events');
const { copyApp, rm, ROOT } = require('../test/helpers');
const { readTree, dockerReady, sleep } = require('./stage3-util');

const sudoOk = () => { try { return spawnSync('sudo', ['-n', 'true'], { timeout: 10000 }).status === 0; } catch { return false; } };
const skip = process.env.CLOUD_DOCKER_TEST !== '1' ? 'нужен настоящий Docker: bash scripts/cloud-check.sh'
  : !dockerReady() ? 'нет Docker или образа premier-cloud (docker build -t premier-cloud -f sandbox/cloud.Dockerfile sandbox)'
  : !sudoOk() ? 'нужен sudo без пароля: правила iptables ставит root' : false;
const SECRET = 'СЕКРЕТ-СЕРВЕРА-d41c07';

test('этап 3: облачный компьютер на настоящем Docker', { skip, timeout: 600000 }, async (t) => {
  const dir = copyApp(), NET = 'premier-t3-' + crypto.randomBytes(4).toString('hex');
  const state = path.join(dir, 'fw', 'firewall.json'); fs.mkdirSync(path.dirname(state));
  const fw = (action) => spawnSync('sudo', ['-n', 'env', 'CLOUD_NETWORK=' + NET, 'CLOUD_FIREWALL_STATE=' + state, 'PREMIER_ENV=/nonexistent', 'bash', path.join(ROOT, 'scripts', 'cloud-firewall.sh'), action], { encoding: 'utf8', timeout: 60000 });
  const sh = (cmd, ...a) => spawnSync(cmd, a, { encoding: 'utf8', timeout: 60000 });
  Object.assign(process.env, { CLOUD_RUNNER: 'docker', CLOUD_NETWORK: NET, CLOUD_FIREWALL_STATE: state, CLOUD_MIN_FREE_MB: '1' });
  const cloud = require(path.join(dir, 'cloud.js')), cloudNet = require(path.join(dir, 'cloud-net.js'));
  const alerts = []; cloud.hooks.alert = (x) => alerts.push(x);
  const names = ['u1', 'uq'].map((u) => 'premier-pc-' + u);
  t.after(() => {
    sh('docker', 'rm', '-f', ...names); fw('remove'); sh('docker', 'network', 'rm', NET);
    // файлы в домашних папках создавал контейнер от имени того же пользователя — удаляются обычным rm
    rm(dir);
  });
  const up = (name) => sh('docker', 'inspect', '-f', '{{.State.Running}}', name).stdout.trim() === 'true';
  const inPc = async (uid, cmd) => (await cloud.run(uid, cmd, { sec: 60 })).out;
  const Q = 1024;

  await t.test('CLD-02: без правил запуск отклоняется, причина видна', async () => {
    await assert.rejects(cloud.ensure('u1', Q), { code: 'net', status: 503 });
    assert.equal(up('premier-pc-u1'), false); assert.match(cloud.netStatus().reason, /правила сетевой защиты не применены/);
    const c = fw('check'); assert.equal(c.status, 1, c.stdout + c.stderr); assert.match(c.stderr, /Не хватает правил/);
    assert.equal(JSON.parse(fs.readFileSync(state, 'utf8')).ok, false);
    await assert.rejects(cloud.ensure('u1', Q), { code: 'net' }, 'отметка «правил нет» тоже не даёт запустить');
  });

  let bridge, gw;
  await t.test('CLD-02: с правилами контейнер запускается и не видит сервер, внутренние сети и метаданные', async () => {
    const a = fw('apply'); assert.equal(a.status, 0, a.stdout + a.stderr);
    assert.equal(fw('apply').status, 0, 'повторный запуск безопасен'); assert.equal(fw('check').status, 0);
    const st = JSON.parse(fs.readFileSync(state, 'utf8')); bridge = st.bridge; assert.equal(st.ok, true); assert.equal(st.mode, 'rootful');
    assert.equal(sh('sudo', '-n', 'iptables', '-S', 'INPUT').stdout.split('\n').filter((l) => l.includes(bridge)).length, 1, 'правило не дублируется');
    await sleep(5200); await cloud.ensure('u1', Q); assert.equal(up('premier-pc-u1'), true);
    gw = sh('docker', 'network', 'inspect', '-f', '{{(index .IPAM.Config 0).Gateway}}', NET).stdout.trim();
    // сервер слушает на всех адресах; из контейнера пробуем адрес моста и все адреса сервера
    let hits = 0; const srv = net.createServer((s) => { hits++; s.destroy(); }); await new Promise((ok) => srv.listen(0, '0.0.0.0', ok));
    const port = srv.address().port, addrs = [gw, ...cloudNet.hostAddrs()];
    const probe = (h, p) => `if timeout 3 bash -c '</dev/tcp/${h}/${p}' 2>/dev/null; then echo OPEN ${h}:${p}; else echo closed; fi`;
    const out = await inPc('u1', [...addrs.map((h) => probe(h, port)), probe('169.254.169.254', 80), probe('10.255.255.1', 80), probe('192.168.255.1', 80), probe('100.100.100.200', 80)].join('; '));
    srv.close();
    assert.doesNotMatch(out, /OPEN/, out); assert.equal(hits, 0, 'до сервера не дошло ни одно соединение');
    // правила действительно сработали на этих пакетах (счётчики), а не «адреса просто не существует»
    const cnt = sh('sudo', '-n', 'iptables', '-L', 'DOCKER-USER', '-v', '-n', '-x').stdout.split('\n').filter((l) => l.includes(bridge));
    const pk = (dst) => Number(cnt.find((l) => l.includes(dst))?.trim().split(/\s+/)[0] || 0);
    assert.ok(pk('169.254.0.0/16') > 0, 'пакеты к адресу метаданных отброшены правилом'); assert.ok(pk('10.0.0.0/8') > 0); assert.ok(pk('192.168.0.0/16') > 0); assert.ok(pk('100.64.0.0/10') > 0);
    const inp = sh('sudo', '-n', 'iptables', '-L', 'INPUT', '-v', '-n', '-x').stdout.split('\n').find((l) => l.includes(bridge));
    assert.ok(Number(inp.trim().split(/\s+/)[0]) > 0, 'пакеты к самому серверу отброшены правилом INPUT');
    // интернет остаётся (если он есть у самого сервера) — только для сведения
    const web = await inPc('u1', 'curl -sS -m 8 -o /dev/null -w "%{http_code}" https://example.com 2>&1 || true');
    t.diagnostic(`интернет из контейнера (https://example.com): ${web.trim().slice(0, 80)}`);
  });

  await t.test('CLD-02: чужое правило выше правил защиты — проверка это видит, apply возвращает порядок', async () => {
    const S = () => sh('sudo', '-n', 'iptables', '-S', 'DOCKER-USER').stdout.split('\n').filter((l) => l.startsWith('-A '));
    const before = S().filter((l) => l.includes(bridge)).length;
    // так поступил бы другой менеджер правил: RETURN в начале цепочки — и до запретов внутренних сетей пакеты не доходят
    assert.equal(sh('sudo', '-n', 'iptables', '-I', 'DOCKER-USER', '1', '-s', '172.16.0.0/12', '-j', 'RETURN').status, 0);
    t.after(() => { sh('sudo', '-n', 'iptables', '-D', 'DOCKER-USER', '-s', '172.16.0.0/12', '-j', 'RETURN'); });
    // а это запрет самого администратора на том же мосту, ниже чужого правила: перестановка не должна его удалить
    const ADMIN = ['DOCKER-USER', '-i', bridge, '-d', '198.51.100.7', '-j', 'DROP'];
    assert.equal(sh('sudo', '-n', 'iptables', '-A', ...ADMIN).status, 0);
    t.after(() => { sh('sudo', '-n', 'iptables', '-D', ...ADMIN); });
    const c = fw('check'); assert.equal(c.status, 1, 'правила на месте, но обойдены — проверка не проходит');
    let st = JSON.parse(fs.readFileSync(state, 'utf8')); assert.equal(st.ok, false); assert.match(st.reason, /выше правил защиты стоит чужое правило/);
    const a = fw('apply'); assert.equal(a.status, 0, a.stdout + a.stderr); assert.match(a.stdout, /Порядок правил восстановлен/);
    st = JSON.parse(fs.readFileSync(state, 'utf8')); assert.equal(st.ok, true);
    const now = S(), foreign = now.findIndex((l) => l.includes('-j RETURN') && l.includes('172.16.0.0/12'));
    assert.equal(sh('sudo', '-n', 'iptables', '-C', ...ADMIN).status, 0, 'запрет администратора на этом мосту остался на месте');
    assert.equal(sh('sudo', '-n', 'iptables', '-D', ...ADMIN).status, 0);
    assert.equal(S().filter((l) => l.includes(bridge)).length, before, 'правила не задвоились');
    assert.ok(foreign >= before, 'чужое правило теперь ниже всех правил защиты'); assert.ok(now.slice(0, before).every((l) => l.includes(bridge) && l.endsWith('-j DROP')));
    assert.equal(sh('sudo', '-n', 'iptables', '-D', 'DOCKER-USER', '-s', '172.16.0.0/12', '-j', 'RETURN').status, 0);
    assert.equal(fw('check').status, 0);
  });

  await t.test('CLD-04: подложенные node, python3, bash, timeout и pty.py служебным вызовам не достаются', async () => {
    await inPc('u1', `mkdir -p ~/.local/bin && for n in node python3 bash timeout; do printf '#!/bin/sh\\ntouch /home/premier/HACKED-%s\\nexit 0\\n' $n > ~/.local/bin/$n; chmod +x ~/.local/bin/$n; done; printf 'open("/home/premier/HACKED-pty","w").close()\\n' > ~/pty.py; cp ~/pty.py ~/select.py; echo ok`);
    assert.match(await cloud.call('u1', Q, 'computer_list', { path: '~' }), /pty\.py/);
    assert.equal((await cloud.run('u1', 'echo привет')).out, 'привет');
    assert.ok(Array.isArray(await cloud.ports('u1')));
    const ws = Object.assign(new EventEmitter(), { got: '', send(d) { this.got += d; return true; }, close() { this.emit('close'); } });
    await cloud.tty('u1', Q, ws, 80, 24); await sleep(1500);
    ws.emit('message', JSON.stringify({ d: 'echo tty-$((40+2))\n' })); await sleep(1500); ws.close();
    assert.match(ws.got, /tty-42/, 'терминал работает');
    const st = cloud.connect('u1', 9); st.on('error', () => {}); await sleep(800); st.destroy();
    const home = path.join(dir, 'data', 'cloud', 'u1');
    assert.deepEqual(fs.readdirSync(home).filter((n) => n.startsWith('HACKED')), [], 'ни одна подложенная программа не запускалась');
    await inPc('u1', 'rm -rf ~/.local/bin ~/pty.py ~/select.py');
  });

  await t.test('CLD-09: «Стоп» завершает команду и её процессы в контейнере за несколько секунд', async () => {
    const ac = new AbortController(), t0 = Date.now();
    const p = cloud.call('u1', Q, 'computer_run', { command: 'sleep 300 & setsid sleep 301 & (sleep 302 | cat) & env -u PC_RUN sleep 304 & env -i /bin/sleep 305 & env -u PC_RUN sh -c \'sleep 306 >/dev/null 2>&1 &\'; sleep 303' }, ac.signal);
    await sleep(1500);
    // по одной строке на процесс; считаются только сами sleep, а не оболочка, в чьей строке запуска они упомянуты
    const count = 'for f in /proc/[0-9]*/cmdline; do tr "\\0" " " < $f 2>/dev/null; echo; done | grep -cE "^(/bin/)?sleep 30[0-6] $" || true';
    // проверка идёт отдельным docker exec, пока первая команда ещё работает
    const before = sh('docker', 'exec', 'premier-pc-u1', '/bin/bash', '-c', count).stdout.trim(); assert.equal(before, '7'); // три из них сбросили метку PC_RUN (env -u, env -i): двух находят как потомков, третий уже ушёл к init — его находят по сеансу команды
    ac.abort(); const out = await p, took = Date.now() - t0 - 1500;
    assert.match(out, /^Остановлено: пользователь остановил ответ\./); assert.ok(took < 5000, `остановка заняла ${took} мс`);
    assert.equal(sh('docker', 'exec', 'premier-pc-u1', '/bin/bash', '-c', count).stdout.trim(), '0', 'в контейнере не осталось процессов команды');
    assert.equal(up('premier-pc-u1'), true, 'сам компьютер продолжает работать');
    t.diagnostic(`«Стоп»: команда и 7 процессов завершены за ${took} мс`);
  });

  await t.test('CLD-01: подмена файлов ссылками ИЗ контейнера во время публикации и удаления — содержимое сервера не утекает', async () => {
    const store = require(path.join(dir, 'db.js'));
    const sitesDir = path.join(dir, 'data', 'sites'); fs.mkdirSync(sitesDir, { recursive: true });
    const sites = require(path.join(dir, 'cloud-sites.js')).createCloudSites({ dir: sitesDir, cloud, store });
    const srv = path.join(dir, 'server-private'); fs.mkdirSync(path.join(srv, 'keys'), { recursive: true });
    for (const f of ['premier.env', 'f.txt', 'keys/id.txt']) fs.writeFileSync(path.join(srv, f), SECRET);
    // в контейнере этих путей нет (ссылки «битые»), а на сервере они ведут на настоящие файлы — как при атаке
    await inPc('u1', `mkdir -p ~/site/assets ~/box && echo '<title>Сайт</title><script src=app.js></script>' > ~/site/index.html && echo 'console.log(1)' > ~/site/app.js && echo A > ~/site/assets/a.txt && echo моё > ~/box/f.txt
cat > ~/flip.sh <<'EOS'
while :; do
  mv ~/site/app.js ~/.app.real 2>/dev/null; ln -s '${srv}/premier.env' ~/site/app.js 2>/dev/null; rm -f ~/site/app.js; mv ~/.app.real ~/site/app.js 2>/dev/null
  mv ~/site/assets ~/.assets.real 2>/dev/null; ln -s '${srv}/keys' ~/site/assets 2>/dev/null; rm -f ~/site/assets; mv ~/.assets.real ~/site/assets 2>/dev/null
  mv ~/box ~/.box.real 2>/dev/null; ln -s '${srv}' ~/box 2>/dev/null; rm -f ~/box; mv ~/.box.real ~/box 2>/dev/null
done
EOS
echo ok`);
    const bg = await cloud.run('u1', 'bash ~/flip.sh', { background: true }); assert.ok(bg.bg, 'подмена запущена в контейнере');
    const leak = (d) => readTree(d).filter((f) => f.data.includes(SECRET)).map((f) => f.file);
    const trash = path.join(dir, 'data', 'cloud-trash'); let pub = 0, del = 0;
    for (let i = 0; i < 60; i++) {
      try { await sites.publish('u1', '~/site'); pub++; } catch {}
      try { await cloud.remove('u1', Q, '~/box/f.txt'); del++; } catch {}
      assert.deepEqual(leak(sitesDir), [], `утечка в публикацию на попытке ${i}`);
      assert.deepEqual(leak(trash), [], `файл сервера попал в корзину на попытке ${i}`);
      assert.deepEqual(fs.readdirSync(srv).sort(), ['f.txt', 'keys', 'premier.env'], 'каталог сервера не изменился');
      const last = cloud.trashList('u1')[0]; if (last) { try { await cloud.restore('u1', Q, last.id); } catch {} }
      assert.deepEqual(fs.readdirSync(srv).sort(), ['f.txt', 'keys', 'premier.env']);
    }
    assert.equal(fs.readFileSync(path.join(srv, 'f.txt'), 'utf8'), SECRET);
    await inPc('u1', 'pkill -f flip.sh; true');
    t.diagnostic(`подмена из контейнера: публикаций ${pub}/60, удалений ${del}/60, утечек 0`);
  });

  await t.test('CLD-03: запись сверх квоты останавливает контейнер; после удаления лишнего он снова запускается', async () => {
    await cloud.ensure('uq', 40);
    const one = await inPc('uq', 'dd if=/dev/zero of=~/big.bin bs=1M count=60 2>&1 | tail -n 1; ls -l ~/big.bin | awk "{print \\$5}"');
    assert.equal(Number(one.trim().split('\n').pop()), 40 * 1048576, 'один файл не больше квоты (ulimit fsize)');
    await inPc('uq', 'for i in 1 2 3; do dd if=/dev/zero of=~/part$i.bin bs=1M count=38 2>/dev/null; done; echo ok'); // всего 154 МБ при квоте 40
    assert.equal(up('premier-pc-uq'), true);
    await cloud.watch();
    assert.equal(up('premier-pc-uq'), false, 'сторож остановил контейнер');
    assert.equal(up('premier-pc-u1'), true, 'другие компьютеры не затронуты');
    await assert.rejects(cloud.ensure('uq', 40), (e) => e.code === 'quota' && e.status === 507 && /удалите лишние файлы/.test(e.message));
    // лишнее удаляется без контейнера — с диска сервера
    const ls = await cloud.listDir('uq', 40, '~'); assert.deepEqual(ls.entries.map((e) => e.name), ['big.bin', 'part1.bin', 'part2.bin', 'part3.bin']);
    for (const f of ['big.bin', 'part1.bin', 'part2.bin']) await cloud.remove('uq', 40, '~/' + f);
    assert.equal(up('premier-pc-uq'), false);
    await cloud.ensure('uq', 40); assert.equal(up('premier-pc-uq'), true);
    await cloud.stop('uq');
  });

  await t.test('CLD-02: правило пропало — живая проба и сторож это замечают, контейнеры останавливаются', async () => {
    // отметка ещё свежая и говорит «всё на месте», а правила INPUT уже нет: ловит только проба
    assert.equal(sh('sudo', '-n', 'iptables', '-D', 'INPUT', '-i', bridge, '-j', 'DROP').status, 0);
    const docker = (a, timeout = 60000) => new Promise((ok) => require('child_process').execFile('docker', a, { timeout }, (e, so, se) => ok({ ok: !e, out: String(so || '').trim(), err: String(se || e?.message || '').trim() })));
    const v = await cloudNet.createCloudNet({ docker, NET, IMAGE: 'premier-cloud', stateFile: state }).verify();
    assert.equal(v.ok, false); assert.match(v.reason, /достучался до сервера|доступны порты сервера/);
    // таймер (здесь — вручную) перепроверяет правила и пишет отметку «не на месте»
    assert.equal(fw('check').status, 1);
    await sleep(10200); await cloud.watch();
    assert.equal(up('premier-pc-u1'), false, 'контейнер остановлен'); assert.match(alerts.at(-1), /Облачный компьютер остановлен: правила сетевой защиты не на месте/);
    await assert.rejects(cloud.ensure('u1', Q), { code: 'net' });
    // правила возвращены — работа продолжается
    assert.equal(fw('apply').status, 0); await sleep(5200);
    await cloud.ensure('u1', Q); assert.equal(up('premier-pc-u1'), true); assert.match(alerts.at(-1), /снова на месте/);
    void gw; void os;
  });
});
