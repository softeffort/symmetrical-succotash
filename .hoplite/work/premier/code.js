// Premier — выполнение Python. Безопасный режим: Docker-контейнер без сети (образ premier-python, см. sandbox/).
// CODE_RUNNER=docker (по умолчанию) | local (без изоляции, только для своего компьютера!) | off
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODE = process.env.CODE_RUNNER || 'docker';
const IMAGE = process.env.CODE_IMAGE || 'premier-python';
const PY = process.env.PYTHON || 'python3';
const TIMEOUT = 60;
const ROOT = path.join(__dirname, 'data');
const fsp = fs.promises;
const tar = require('./tar-read'); // CLD-06: строгий разбор архива результатов, в отдельном потоке
// CLD-18: результаты Python не копятся без конца — у аккаунта есть предел места и срок хранения
const envN = (k, d) => { const v = Number(process.env[k]); return process.env[k] !== undefined && process.env[k] !== '' && Number.isFinite(v) && v >= 0 ? v : d; };
const FILES_MAX_MB = envN('CODE_FILES_MAX_MB', 200); // на аккаунт; 0 — без предела
const FILES_DAYS = envN('CODE_FILES_DAYS', 30);      // 0 — не удалять по сроку
const MARK = '.premier-run';                         // пометка «папка с результатами Python»; её время — начало срока хранения
const NOT_RUN = /^(image\.[a-z0-9]+|animation\.mp4(\.part)?)$/i; // в data/files/<uid> лежат ещё картинки и ролики — их не трогаем
let avail = null, availAt = 0, running = 0;
const busyUsers = new Set();

function check() {
  if (MODE === 'off') return Promise.resolve({ ok: false, mode: MODE, error: 'Выполнение кода выключено (CODE_RUNNER=off)' });
  if (Date.now() - availAt < 60000 && avail) return Promise.resolve(avail);
  return new Promise((ok) => {
    const done = (r) => { avail = { mode: MODE, ...r }; availAt = Date.now(); ok(avail); };
    if (MODE === 'local') return execFile(PY, ['--version'], { timeout: 5000 }, (e, so, se) => done(e ? { ok: false, error: 'Не найден ' + PY } : { ok: true, version: (so || se).trim() }));
    execFile('docker', ['image', 'inspect', IMAGE, '--format', '{{.Id}}'], { timeout: 8000 }, (e, so, se) => {
      if (!e) return done({ ok: true });
      done({ ok: false, error: /not found|No such image/i.test(se) ? `Нет образа ${IMAGE}. Соберите: docker build -t ${IMAGE} sandbox` : /ENOENT/.test(e.message) ? 'Docker не установлен' : 'Docker недоступен: ' + String(se || e.message).split('\n')[0] });
    });
  });
}

const cap = (s, n) => s.length > n ? s.slice(0, n) + `\n…[обрезано, всего ${s.length} символов]` : s;
const IMG = /\.(png|jpe?g|gif|webp)$/i;

const notStarted = (msg) => Object.assign(new Error(msg), { notStarted: true });
async function run(code, uid) {
  // BIZ-19: отказ до запуска программы помечается notStarted — запуск из дневного лимита не расходуется
  const st = await check(); if (!st.ok) throw notStarted(st.error);
  if (busyUsers.has(uid)) throw notStarted('уже выполняется другой код — дождитесь окончания');
  if (running >= 2) throw notStarted('сервер занят выполнением кода, попробуйте через минуту');
  busyUsers.add(uid); running++;
  const id = crypto.randomBytes(8).toString('hex'), dir = path.join(ROOT, 'run', id), out = path.join(dir, 'out');
  const t0 = Date.now(); let launched = false, started = true;
  try {
    fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'main.py'), String(code), { mode: 0o644 }); fs.chmodSync(dir, 0o755);
    let res, found;
    if (MODE === 'local') { // без изоляции: папка на диске сервера
      fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(path.join(dir, 'home'), { recursive: true }); launched = true;
      res = await spawnRun(PY, [path.join(dir, 'main.py')], { cwd: out, env: { PATH: process.env.PATH, MPLBACKEND: 'Agg', HOME: path.join(dir, 'home'), MPLCONFIGDIR: path.join(dir, 'home'), PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' } }, id);
      found = localFiles(out); if (res.spawnFailed) started = false; // интерпретатор не запустился
    } else { // Docker: код только для чтения, результаты — в памяти контейнера (не больше 50 МБ), обратно — архивом через stdout
      launched = true;
      const r = await spawnRun('docker', dockerArgs(id, dir), {}, id, true);
      const t = await tar.read(r.raw); res = { code: Number(t.meta.rc) || (r.code ? r.code : 0), so: t.meta.stdout || '', se: (t.meta.stderr || '') + (r.code && !t.ok ? r.se : ''), killed: r.killed || (Number(t.meta.rc) === 137 && Date.now() - t0 > TIMEOUT * 1000 - 2000) }; // 137 раньше срока — нехватка памяти
      if (!t.ok && !r.killed) res.se += (res.se ? '\n' : '') + 'Не удалось получить результаты выполнения' + (t.error ? ' (' + t.error + ')' : '');
      found = t.files;
      // Docker не запустил контейнер (нет docker, демон недоступен, образ не стартует: коды 125–127 без архива результатов) — программа не стартовала
      if (r.spawnFailed || (!t.ok && !r.killed && [125, 126, 127].includes(r.code))) started = false;
    }
    const saved = [], fid = crypto.randomBytes(8).toString('hex'), dest = path.join(ROOT, 'files', uid, fid); let total = 0;
    for (const f of found.slice(0, 20)) {
      if (total + f.size > 25e6) break; total += f.size;
      const name = f.rel.replace(/[\/\\]/g, '_').replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120);
      fs.mkdirSync(dest, { recursive: true }); const to = path.join(dest, name);
      if (f.data) fs.writeFileSync(to, f.data); else fs.copyFileSync(f.src, to);
      saved.push({ name, size: f.size, url: `/api/files/${fid}/${encodeURIComponent(name)}`, image: IMG.test(name) });
    }
    let keep = null;
    if (saved.length) {
      try { fs.writeFileSync(path.join(dest, MARK), ''); } catch {}
      const k = await prune(uid, fid).catch(() => null);
      keep = { days: FILES_DAYS, maxMB: FILES_MAX_MB, usedMB: k ? Math.round(k.bytes / 1048576 * 10) / 10 : 0, purged: k ? k.quota : 0 };
    }
    return { keep, started, exit: res.code, timeout: res.killed, ms: Date.now() - t0, stdout: cap(res.so, 12000), stderr: cap(res.se.replace(/\/work\/(src\/)?main\.py/g, 'main.py'), 6000), files: saved };
  } catch (e) { if (!launched && e && typeof e === 'object') e.notStarted = true; throw e; // сбой до запуска (нет места на диске и т. п.)
  } finally {
    busyUsers.delete(uid); running--;
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
}
// внутри контейнера: запуск с лимитом времени, затем папка out и вывод программы — одним tar-архивом в stdout
const INNER = `mkdir -p /tmp/meta && cd /work/out && timeout -s KILL ${TIMEOUT} python /work/src/main.py >/tmp/meta/so 2>/tmp/meta/se; echo $? >/tmp/meta/rc; ` +
  `head -c 200000 /tmp/meta/so >/tmp/meta/stdout; head -c 200000 /tmp/meta/se >/tmp/meta/stderr; rm -f /tmp/meta/so /tmp/meta/se; cd /work && exec tar -cf - --exclude=__pycache__ out -C /tmp/meta stdout stderr rc`;
const dockerArgs = (id, dir) => ['run', '--rm', '--name', 'premier-run-' + id, '--network', 'none', '--memory', '512m', '--memory-swap', '512m', '--cpus', '1', '--pids-limit', '128',
  '--read-only', '--tmpfs', '/tmp:rw,size=64m', '--mount', 'type=tmpfs,destination=/work/out,tmpfs-size=52428800,tmpfs-mode=1777',
  '--security-opt', 'no-new-privileges', '--cap-drop', 'ALL', '--user', '65534:65534', '--ulimit', 'nofile=256:256', '--ulimit', 'fsize=52428800',
  '-e', 'MPLBACKEND=Agg', '-e', 'HOME=/tmp', '-e', 'MPLCONFIGDIR=/tmp', '-e', 'PYTHONIOENCODING=utf-8', '-e', 'PYTHONDONTWRITEBYTECODE=1',
  '-v', dir + ':/work/src:ro', '-w', '/work/out', IMAGE, 'sh', '-c', INNER];
const RAW_MAX = 60e6;
function spawnRun(cmd, args, opts, id, raw) {
  return new Promise((ok) => {
    const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] }); const bufs = []; let n = 0, so = '', se = '', killed = false;
    const kill = () => { if (MODE !== 'local') execFile('docker', ['kill', 'premier-run-' + id], () => {}); p.kill('SIGKILL'); };
    p.stdout.on('data', (d) => { if (raw) { n += d.length; if (n > RAW_MAX) { killed = true; return kill(); } bufs.push(d); } else if (so.length < 200000) so += d; });
    p.stderr.on('data', (d) => { if (se.length < 200000) se += d; });
    const timer = setTimeout(() => { killed = true; kill(); }, (TIMEOUT + (raw ? 30 : 0)) * 1000); // запас на запуск контейнера и упаковку
    p.on('error', (e) => { clearTimeout(timer); ok({ code: -1, so, se: se + e.message, killed, raw: Buffer.concat(bufs), spawnFailed: !p.pid }); });
    p.on('close', (c) => { clearTimeout(timer); ok({ code: c, so, se, killed: killed || (!raw && c === null), raw: Buffer.concat(bufs) }); });
  });
}
function localFiles(out) {
  const files = [];
  const walk = (d, rel = '') => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { if (files.length >= 200) return; if (n.name.startsWith('.') || n.name === '__pycache__') continue; const r = rel + n.name; if (n.isDirectory()) walk(path.join(d, n.name), r + '/'); else if (n.isFile()) { const src = path.join(d, n.name); files.push({ rel: r, src, size: fs.statSync(src).size }); } } };
  try { walk(out); } catch {}
  return files;
}
// разбор tar — в tar-read.js (CLD-06); здесь оставлено имя для прежнего кода и тестов
const untar = (buf) => tar.parse(buf);

/* ---------- хранение результатов (CLD-18) ---------- */
// папки с результатами Python одного пользователя, от старых к новым
async function runsOf(uid) {
  const base = path.join(ROOT, 'files', uid); let names = [];
  try { names = await fsp.readdir(base); } catch { return []; }
  const list = [];
  for (const fid of names) {
    if (!/^[a-f0-9]{16}$/.test(fid)) continue;
    const dir = path.join(base, fid); let ents;
    try { ents = (await fsp.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()); } catch { continue; }
    const marked = ents.some((e) => e.name === MARK);
    if (!marked && (!ents.length || ents.every((e) => NOT_RUN.test(e.name)))) continue; // картинка, ролик или пустая папка
    let size = 0, born = Infinity, at = 0;
    for (const e of ents) {
      let st; try { st = await fsp.stat(path.join(dir, e.name)); } catch { continue; }
      if (e.name === MARK) at = st.mtimeMs; else { size += st.size; born = Math.min(born, st.mtimeMs); }
    }
    // результаты, сохранённые до появления срока хранения: срок для них начинается сейчас, а не задним числом
    if (!marked) { try { await fsp.writeFile(path.join(dir, MARK), ''); at = Date.now(); } catch { continue; } }
    list.push({ fid, dir, size, at, born: Number.isFinite(born) ? born : at });
  }
  return list.sort((a, b) => a.born - b.born);
}
// удалить просроченное и самое старое сверх предела; keepFid — только что созданная папка, её не трогаем
async function prune(uid, keepFid) {
  const now = Date.now(), list = await runsOf(uid); let expired = 0, quota = 0;
  const drop = async (x) => { await fsp.rm(x.dir, { recursive: true, force: true }).catch(() => {}); x.gone = true; };
  if (FILES_DAYS > 0) for (const x of list) if (x.fid !== keepFid && now - x.at > FILES_DAYS * 864e5) { await drop(x); expired++; }
  let bytes = list.reduce((n, x) => n + (x.gone ? 0 : x.size), 0);
  if (FILES_MAX_MB > 0) for (const x of list) {
    if (bytes <= FILES_MAX_MB * 1048576) break;
    if (x.gone || x.fid === keepFid) continue;
    await drop(x); bytes -= x.size; quota++;
  }
  return { expired, quota, bytes, runs: list.filter((x) => !x.gone).length };
}
// обход всех аккаунтов: сервер запускает его раз в несколько часов
let sweeping = false;
async function sweep() {
  if (sweeping) return null; sweeping = true;
  const sum = { users: 0, expired: 0, quota: 0 };
  try {
    let uids = []; try { uids = await fsp.readdir(path.join(ROOT, 'files')); } catch {}
    for (const uid of uids) { const r = await prune(uid).catch(() => null); if (r) { sum.users++; sum.expired += r.expired; sum.quota += r.quota; } }
  } finally { sweeping = false; }
  return sum;
}
// путь к файлу пользователя (или null)
function filePath(uid, fid, name) {
  if (!/^[a-f0-9]{16}$/.test(fid)) return null;
  if (path.basename(name).startsWith('.')) return null; // служебные пометки не отдаём
  const p = path.join(ROOT, 'files', uid, fid, path.basename(name));
  return fs.existsSync(p) ? p : null;
}
const removeUser = (uid) => fs.rm(path.join(ROOT, 'files', uid), { recursive: true, force: true }, () => {});

const TOOL = { type: 'function', function: { name: 'run_python', description: 'Выполнить код на Python 3 (numpy, pandas, matplotlib, seaborn, scipy, openpyxl, xlsxwriter, python-docx, python-pptx, reportlab, pillow). Нет интернета. Файлы, сохранённые в текущую папку, пользователь увидит и сможет скачать; картинки (png/jpg) показываются в чате. Печатай результаты через print().', parameters: { type: 'object', properties: { code: { type: 'string', description: 'Полный код программы' } }, required: ['code'] } } };
const NOTE = `\n\nУ тебя есть инструмент run_python — настоящий Python 3 на сервере (без интернета, лимит 60 секунд).
- Используй его для точных вычислений, анализа данных (CSV/Excel из сообщения — вставь данные в код), графиков и создания файлов: Excel (.xlsx), Word (.docx), PowerPoint (.pptx), PDF, CSV, картинок, ZIP.
- Сохраняй файлы в текущую папку с понятными именами (plt.savefig('grafik.png'), doc.save('otchet.docx')). Пользователь сразу видит их и может скачать — не вставляй ссылки на них сам.
- Для кириллицы в PDF (reportlab) регистрируй шрифт /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf. В matplotlib кириллица работает по умолчанию.
- Если код упал — исправь и запусти снова. После выполнения кратко объясни результат.
- Для простых вопросов код не нужен.`;

module.exports = { check, run, filePath, removeUser, TOOL, NOTE, MODE, untar, INNER, dockerArgs, prune, sweep, runsOf, FILES_MAX_MB, FILES_DAYS, MARK };
