'use strict';
// Premier — проверка сетевой изоляции облачного компьютера (CLD-02, OPS-02).
// Контейнер пользователя не должен видеть сам сервер (его порты, SSH, базы), внутренние сети и адрес метаданных
// облака. Правила ставит root-скрипт scripts/cloud-firewall.sh (юнит premier-cloud-firewall.service + таймер), а сервер
// перед КАЖДЫМ запуском контейнера убеждается, что защита на месте. Нет подтверждения — контейнер не запускается.
// Три проверки, все обязательны:
//   1) сеть Docker: отдельный мост, связь между контейнерами выключена (enable_icc=false), IPv6 выключен;
//   2) отметка скрипта (файл состояния): правила проверены недавно и относятся к этой же сети;
//   3) живая проба: одноразовый контейнер в той же сети пробует соединиться с адресами сервера — не должно получиться.
// Сети нет (CLOUD_NETWORK=none) — защищать нечего, проверка проходит сразу.
const fs = require('fs');
const net = require('net');
const os = require('os');
const crypto = require('crypto');

const STATE = process.env.CLOUD_FIREWALL_STATE || '/run/premier-cloud/firewall.json';
const STATE_MAX = Math.max(30, Number(process.env.CLOUD_FIREWALL_MAX_AGE) || 180) * 1000; // таймер обновляет отметку раз в минуту
const PROBE_TTL = Math.max(10, Number(process.env.CLOUD_FIREWALL_PROBE_SEC) || 300) * 1000;
const OK_TTL = 10e3, FAIL_TTL = 5e3;
const HOW = 'Примените правила: sudo bash scripts/cloud-firewall.sh apply (и включите premier-cloud-firewall.timer)';
// порты сервера, которые проба проверяет кроме своего: SSH и веб-сервер открыты в ufw, поэтому без правил были бы доступны
const PORTS = [22, 80, 443];

// выполняется внутри одноразового контейнера: [[адрес, порт], …] и метка; печатает, с чем удалось соединиться
const PROBE = `const net=require('net');const [list,mark]=JSON.parse(process.argv[1]);let left=list.length;const open=[];
const fin=()=>{if(--left<=0){process.stdout.write(JSON.stringify({done:true,tried:list.length,open}));process.exit(0);}};
if(!left){left=1;fin();}
for(const [h,p] of list){let over=false;const end=(ok)=>{if(over)return;over=true;if(ok)open.push(h+':'+p);s.destroy();fin();};
const s=net.connect({host:h,port:p,timeout:2500});s.on('connect',()=>{s.write(mark);setTimeout(()=>end(true),150);});
s.on('timeout',()=>end(false));s.on('error',()=>end(false));}`;

const fail = (reason, extra) => ({ ok: false, reason, ...extra });

// адреса самого сервера (IPv4, не loopback): к ним контейнер не должен достучаться
function hostAddrs() {
  const out = new Set();
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.add(a.address);
  return [...out].slice(0, 12);
}

// отметка root-скрипта: { v, ok, at (с), network, netId, bridge, mode, reason }
function readState(file, netw) {
  let st, raw;
  try { st = fs.statSync(file); raw = fs.readFileSync(file, 'utf8'); }
  catch { return fail(`правила сетевой защиты не применены (нет отметки ${file}). ${HOW}`); }
  // отметку пишет root (или тот же пользователь, что и сервер, — в тестах); чужой файл и файл «для всех на запись» не принимаются
  const me = process.getuid?.();
  if ((st.uid !== 0 && st.uid !== me) || (st.mode & 0o002)) return fail(`отметке ${file} нельзя доверять: её может изменить посторонний пользователь`);
  let j; try { j = JSON.parse(raw); } catch { return fail(`отметка ${file} повреждена. ${HOW}`); }
  if (!j || j.ok !== true) return fail('правила сетевой защиты не на месте: ' + (String(j?.reason || 'скрипт сообщил об ошибке').slice(0, 300)) + '. ' + HOW);
  if (j.netId !== netw.id) return fail(`правила относятся к другой сети Docker (сеть ${netw.name} пересоздана). ${HOW}`);
  const age = Date.now() - Number(j.at) * 1000;
  if (!(age < STATE_MAX && age > -120e3)) return fail(`правила сетевой защиты давно не проверялись (${Math.round(age / 1000)} с назад) — работает ли premier-cloud-firewall.timer? ${HOW}`);
  return { ok: true, at: Number(j.at), mode: String(j.mode || '') };
}

function createCloudNet({ docker, NET, IMAGE, stateFile = STATE }) {
  let last = null, lastAt = 0, running = null, probed = { key: '', at: 0 };

  async function inspect() {
    let r = await docker(['network', 'inspect', NET], 15000);
    if (!r.ok) {
      // отдельная сеть без связи между контейнерами (enable_icc=false): пользователи не видят серверы друг друга
      const c = await docker(['network', 'create', '--driver', 'bridge', '-o', 'com.docker.network.bridge.enable_icc=false', '--label', 'premier.pc=1', NET]);
      if (!c.ok && !/already exists/i.test(c.err)) return fail('не удалось создать сеть ' + NET + ': ' + c.err.split('\n')[0]);
      r = await docker(['network', 'inspect', NET], 15000);
      if (!r.ok) return fail('сеть ' + NET + ' недоступна: ' + r.err.split('\n')[0]);
    }
    let n; try { n = JSON.parse(r.out); n = Array.isArray(n) ? n[0] : n; } catch { n = null; }
    if (!n || !n.Id) return fail('Docker вернул непонятное описание сети ' + NET);
    if (n.Driver !== 'bridge') return fail(`сеть ${NET} должна быть типа bridge, а не ${n.Driver}`);
    if (String(n.Options?.['com.docker.network.bridge.enable_icc']) !== 'false') return fail(`в сети ${NET} включена связь между контейнерами (enable_icc). Удалите сеть (docker network rm ${NET}) — сервер создаст её заново`);
    if (n.EnableIPv6) return fail(`в сети ${NET} включён IPv6 — правила рассчитаны на сеть без IPv6. Пересоздайте сеть без --ipv6`);
    const gws = (n.IPAM?.Config || []).map((c) => c.Gateway).filter((g) => net.isIPv4(g));
    return { ok: true, id: String(n.Id), name: NET, gateways: gws };
  }

  // одноразовый контейнер в сети пользователей пробует открыть соединение с сервером; любое удавшееся — защита не работает
  async function probe(netw) {
    const mark = 'premier-probe-' + crypto.randomBytes(12).toString('hex');
    let hit = false;
    const srv = net.createServer((s) => { let got = ''; s.on('data', (d) => { got += d; if (got.includes(mark)) hit = true; if (got.length > 200) s.destroy(); }); s.on('error', () => {}); setTimeout(() => s.destroy(), 3000).unref(); });
    try { await new Promise((ok, no) => { srv.once('error', no); srv.listen(0, '0.0.0.0', ok); }); }
    catch (e) { return fail('не удалось открыть порт для проверки изоляции: ' + e.message); }
    const port = srv.address().port;
    try {
      const addrs = [...new Set([...netw.gateways, ...hostAddrs()])];
      const list = addrs.flatMap((a) => [port, ...PORTS].map((p) => [a, p]));
      const r = await docker(['run', '--rm', '--network', NET, '--label', 'premier.probe=1', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only',
        '--memory', '128m', '--pids-limit', '64', '--user', '65534:65534', '--entrypoint', '/usr/local/bin/node', IMAGE, '-e', PROBE, JSON.stringify([list, mark])], 45000);
      let j = null; try { j = JSON.parse(r.out.slice(r.out.lastIndexOf('{"done"'))); } catch {}
      if (!r.ok || !j?.done) return fail('не удалось проверить изоляцию контейнеров: ' + ((r.err || 'проба не ответила').split('\n')[0]).slice(0, 200));
      await new Promise((ok) => setTimeout(ok, 100));
      if (hit || j.open.some((x) => x.endsWith(':' + port))) return fail(`контейнер достучался до сервера (порт проверки ${port}) — правила не действуют. ${HOW}`);
      if (j.open.length) return fail(`контейнеру доступны порты сервера: ${j.open.slice(0, 6).join(', ')}. ${HOW}`);
      return { ok: true };
    } finally { srv.close(); }
  }

  async function checkNow() {
    if (NET === 'none') return { ok: true, net: 'none' };
    if (NET === 'host') return fail('CLOUD_NETWORK=host запрещён: контейнеры получили бы доступ к сети сервера');
    if (NET === 'bridge') return fail('CLOUD_NETWORK=bridge не подходит: в общей сети Docker контейнеры видят друг друга. Уберите настройку (сеть premier-cloud создастся сама) или укажите none');
    const netw = await inspect(); if (!netw.ok) return netw;
    const st = readState(stateFile, netw); if (!st.ok) return st;
    const key = netw.id + '|' + st.mode;
    if (probed.key !== key || Date.now() - probed.at > PROBE_TTL) {
      const p = await probe(netw); if (!p.ok) { probed = { key: '', at: 0 }; return p; }
      probed = { key, at: Date.now() };
    }
    return { ok: true, net: NET, mode: st.mode, checked: st.at };
  }

  // { ok: true } или { ok: false, reason }; ответ живёт несколько секунд, параллельные вызовы ждут одну проверку
  function verify({ fresh = false } = {}) {
    if (!fresh && last && Date.now() - lastAt < (last.ok ? OK_TTL : FAIL_TTL)) return Promise.resolve(last);
    return (running ||= checkNow().catch((e) => fail('проверка изоляции не удалась: ' + e.message)).then((r) => { last = r; lastAt = Date.now(); return r; }).finally(() => { running = null; }));
  }
  return { verify, last: () => (last ? { ...last, at: lastAt } : null), reset: () => { last = null; probed = { key: '', at: 0 }; } };
}

module.exports = { createCloudNet, readState, hostAddrs, STATE, STATE_MAX };
