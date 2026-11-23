'use strict';
// Общее для тестов этапа 3: поддельная команda docker (журнал вызовов вместо настоящих контейнеров), «переключатель»
// ссылок для проверки гонок (TOCTOU) и мелкие помощники. Файл не заканчивается на .test.js — сам тестом не считается.
const fs = require('fs'), path = require('path'), { spawn, spawnSync } = require('child_process');

// Папка с исполняемым файлом docker: каждый вызов дописывается строкой JSON в <dir>/calls.log.
// Поведение задаётся файлами в <dir>: network.json — ответ на «network inspect»; run-fail — «run» завершается ошибкой;
// ps-out — что печатает «ps» (uid работающих контейнеров, по строке); exec-out — что печатает «exec» (по умолчанию {"ok":true,"out":"ok"}); exec-sleep — сколько секунд «exec» ждёт.
function fakeDocker(base) {
  const dir = path.join(base, 'fake-docker'); fs.mkdirSync(dir, { recursive: true });
  const src = `#!${process.execPath}
const fs = require('fs'), path = require('path');
const dir = ${JSON.stringify(dir)}, a = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'calls.log'), JSON.stringify(a) + '\\n');
const has = (f) => fs.existsSync(path.join(dir, f)), read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const out = (s) => process.stdout.write(s);
if (a[0] === 'image') { out('sha256:test\\n'); process.exit(0); }
if (a[0] === 'info') { out(has('info') ? read('info') : '["name=seccomp"]\\n'); process.exit(0); }
if (a[0] === 'ps') { if (has('ps-out')) out(read('ps-out')); process.exit(0); }
if (a[0] === 'inspect') { if (has('running')) { out('true\\n'); process.exit(0); } console.error('No such object'); process.exit(1); }
if (a[0] === 'network') { if (a[1] === 'inspect' && has('network.json')) { out(read('network.json')); process.exit(0); } if (a[1] === 'create') { out('id\\n'); process.exit(0); } console.error('network not found'); process.exit(1); }
if (a[0] === 'run') { if (has('run-fail')) { console.error('docker: boom'); process.exit(125); } if (has('run-out')) out(read('run-out')); else out('cid\\n'); process.exit(has('run-code') ? Number(read('run-code')) : 0); }
if (a[0] === 'rm' || a[0] === 'kill' || a[0] === 'stop') process.exit(0);
if (a[0] === 'exec') {
  const fin = () => process.stdout.write(has('exec-out') ? read('exec-out') : '{"ok":true,"out":"ok"}', () => process.exit(0)); // выход — когда всё записано
  const wait = has('exec-sleep') ? Number(read('exec-sleep')) * 1000 : 0;
  process.stdin.resume(); process.stdin.on('error', () => {});
  setTimeout(fin, wait);
} else process.exit(0);
`;
  const bin = path.join(dir, 'docker'); fs.writeFileSync(bin, src, { mode: 0o755 });
  const calls = () => { try { return fs.readFileSync(path.join(dir, 'calls.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  return { dir, PATH: dir + path.delimiter + process.env.PATH, calls, set: (f, v = '') => fs.writeFileSync(path.join(dir, f), String(v)), unset: (f) => fs.rmSync(path.join(dir, f), { force: true }), clear: () => fs.rmSync(path.join(dir, 'calls.log'), { force: true }) };
}

// Отдельный процесс, который без остановки меняет запись <target> между настоящей (файл или папка <real>) и ссылкой
// на <secret>: так проверяется, что сервер не читает и не переносит чужое, даже если подмена попадает между его шагами.
function flipper(target, real, secret) {
  const code = `
const fs = require('fs'); const [target, real, secret] = process.argv.slice(1);
let n = 0;
for (;;) {
  try { fs.renameSync(target, real); } catch {}
  try { fs.symlinkSync(secret, target); } catch {}
  for (let i = 0; i < 200; i++);
  try { fs.unlinkSync(target); } catch {}
  try { fs.renameSync(real, target); } catch {}
  if (++n % 50 === 0) { const t = Date.now(); while (Date.now() - t < 1); }
}`;
  const p = spawn(process.execPath, ['-e', code, target, real, secret], { stdio: 'ignore' });
  return { stop: () => new Promise((ok) => { if (p.exitCode != null) return ok(); p.on('exit', ok); p.kill('SIGKILL'); }) };
}

// все файлы папки (без перехода по ссылкам): [{ file, data }]
function readTree(dir) {
  const out = [];
  const walk = (d) => { let l = []; try { l = fs.readdirSync(d, { withFileTypes: true }); } catch {} for (const e of l) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.isFile()) { try { out.push({ file: f, data: fs.readFileSync(f) }); } catch {} } } };
  walk(dir); return out;
}
const dockerReady = (image = 'premier-cloud') => { try { return spawnSync('docker', ['image', 'inspect', image, '--format', '{{.Id}}'], { timeout: 15000 }).status === 0; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { fakeDocker, flipper, readTree, dockerReady, sleep };
