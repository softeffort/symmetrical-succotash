#!/usr/bin/env node
// Premier Agent — помощник, который даёт модели из чата Premier доступ к этому компьютеру.
// Запуск: node premier-agent.js --server https://ваш-сайт [КОД]   (нужен Node.js 18+, https://nodejs.org)
// Ключи: --server <адрес> · --workdir <папка> · --no-update (не обновляться) · --yes-commands (команды без вопроса, только на этот запуск)
// Модель работает в рабочей папке (по умолчанию ~/Premier). Всё, что выходит за её пределы, и любой запуск команды
// вы подтверждаете ЗДЕСЬ, в этом окне: подтверждение в чате делает сервер, а ему помощник на слово не верит.
// Остановить доступ: закройте это окно (Ctrl+C) или нажмите «Отключить» в чате.
'use strict';
const os = require('os'), fs = require('fs'), path = require('path'), cp = require('child_process'), readline = require('readline'), crypto = require('crypto');

// версия протокола: уходит серверу как v; сервер отвечает 426 на слишком старого помощника
const AGENT_VERSION = 2;
// Ed25519-ключи (SPKI DER, base64), которыми подписаны обновления. Пусто, пока владелец сайта не выполнил `node scripts/agent-sign.js init`.
// Эту строку правит только scripts/agent-sign.js, формат менять нельзя.
const UPDATE_KEYS = ['MCowBQYDK2VwAyEA7Od6T+GyY4w1fkKynL45Od28vXF4ENql3RFEsmIakKw='/*UPDATE_KEYS*/];
const CONF = process.env.PREMIER_AGENT_CONF || path.join(os.homedir(), '.premier-agent.json');
const WIN = process.platform === 'win32', MAC = process.platform === 'darwin';
const OUT_MAX = 100000, RUN_TIMEOUT = 10 * 60e3, CONFIRM_TIMEOUT = 4 * 60e3, UPDATE_EVERY = 6 * 3600e3;
const STOPPED = 'Остановлено: пользователь остановил ответ.';
const DENIED = 'Ошибка: пользователь отклонил действие на своём компьютере (в окне Premier Agent).';

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', b: '\x1b[36m', d: '\x1b[2m', x: '\x1b[0m' };
const log = (c, ...a) => console.log(C[c] + a.join(' ') + C.x);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function desktopDir() {
  try {
    if (WIN) { // рабочий стол может быть перенесён (OneDrive) — берём путь из реестра
      const o = cp.execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders" /v Desktop', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const m = o.match(/Desktop\s+REG_\w+\s+(.+)/);
      if (m) { const d = m[1].trim().replace(/%([^%]+)%/g, (_, v) => process.env[v] || ''); if (fs.existsSync(d)) return d; }
    } else if (!MAC) {
      const d = cp.execSync('xdg-user-dir DESKTOP', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (d && fs.existsSync(d)) return d;
    }
  } catch {}
  for (const d of [path.join(os.homedir(), 'Desktop'), path.join(os.homedir(), 'OneDrive', 'Desktop'), path.join(os.homedir(), 'Рабочий стол')]) if (fs.existsSync(d)) return d;
  return path.join(os.homedir(), 'Desktop');
}
const DESKTOP = desktopDir();
const DEF_WORK = path.join(os.homedir(), 'Premier');
const INFO = { os: `${WIN ? 'Windows' : MAC ? 'macOS' : 'Linux'} ${os.release()} ${os.arch()}`, host: os.hostname(), home: os.homedir(), desktop: DESKTOP, node: process.version, workdir: DEF_WORK };

// ---- адрес сервера, аргументы, настройки ----
// Только HTTPS; http разрешён лишь для локальной разработки. Возвращает origin без слэша в конце.
function checkServer(url) {
  let u; try { u = new URL(String(url ?? '').trim()); } catch { throw new Error('адрес сервера не похож на ссылку: ' + String(url ?? '').slice(0, 100)); }
  if (u.username || u.password) throw new Error('в адресе сервера нельзя указывать логин и пароль');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname))) throw new Error('сервер должен быть доступен по https:// (http разрешён только для localhost)');
  if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) throw new Error('укажите только адрес сайта, например https://example.com');
  return u.origin;
}
// аргументы командной строки (argv — уже без node и файла); первый «не ключ» — код привязки
function parseArgs(argv) {
  const r = { server: '', workdir: '', noUpdate: false, yesCommands: false, code: '' };
  const a = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < a.length; i++) {
    const x = String(a[i]); const eq = x.match(/^(--(?:server|workdir))=(.*)$/s);
    const key = eq ? eq[1] : x, val = () => { if (eq) return eq[2]; if (i + 1 >= a.length) throw new Error('после ' + x + ' нужно указать значение'); return String(a[++i]); };
    if (key === '--server') r.server = val();
    else if (key === '--workdir') r.workdir = val();
    else if (x === '--no-update') r.noUpdate = true;
    else if (x === '--yes-commands') r.yesCommands = true;
    else if (x.startsWith('-') && x.length > 1) throw new Error('неизвестный ключ ' + x);
    else if (!r.code) r.code = x;
  }
  return r;
}
// откуда брать адрес: ключ --server, затем PREMIER_SERVER, затем последний сохранённый
function pickServer(args, env, conf) {
  const own = (args && args.server) || (env && env.PREMIER_SERVER);
  if (own) return own;
  const keys = Object.keys((conf && conf.servers) || {}); return keys.length ? keys[keys.length - 1] : '';
}

// Формат: { v: 2, dev: "<32 hex>", workdir, servers: { "<origin>": { token } } }. Старый формат { "<сервер>": "<токен>" } переносим как есть.
const newDev = () => crypto.randomBytes(16).toString('hex');
function migrateConf(raw) {
  const c = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = { v: 2, dev: typeof c.dev === 'string' && /^[0-9a-f]{32}$/.test(c.dev) ? c.dev : newDev(), servers: {} };
  const add = (srv, tok) => { if (typeof tok !== 'string' || !tok) return; try { out.servers[checkServer(srv)] = { token: tok }; } catch {} }; // небезопасные адреса из старого файла отбрасываем
  if (c.v === 2) { if (typeof c.workdir === 'string' && c.workdir) out.workdir = c.workdir; for (const [s, e] of Object.entries(c.servers || {})) add(s, e && e.token); }
  else for (const [s, t] of Object.entries(c)) if (!['v', 'dev', 'workdir', 'servers'].includes(s)) add(s, t);
  return out;
}
function loadConf(file = CONF) { try { return migrateConf(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return migrateConf({}); } }
function saveConf(c, file = CONF) { // через временный файл, чтобы обрыв записи не испортил токены; права 0600
  try { const t = file + '.tmp' + process.pid; fs.writeFileSync(t, JSON.stringify(c, null, 1), { mode: 0o600 }); try { fs.chmodSync(t, 0o600); } catch {} fs.renameSync(t, file); return true; } catch { return false; }
}

// ---- пути и защита ----
// путь: ~, %VAR%, $VAR; относительный — от base (рабочая папка)
function P(p, base) {
  let s = String(p || '').trim(); if (!s) throw new Error('не указан путь');
  s = s.replace(/^~(?=$|[\\/])/, os.homedir()).replace(/%([A-Za-z_][\w]*)%/g, (_, v) => process.env[v] ?? '').replace(/\$\{?([A-Za-z_]\w*)\}?/g, (m, v) => process.env[v] ?? m);
  return path.resolve(base || WORK.dir, s);
}
// настоящий путь: ссылки (symlink) раскрываем у ближайшей существующей папки, остаток дописываем; битая ссылка тоже ведёт по цели
function real(p, depth = 0) {
  let cur = path.resolve(p); const rest = [];
  for (;;) {
    try { const r = fs.realpathSync.native(cur); return rest.length ? path.join(r, ...rest.reverse()) : r; } catch {}
    try { if (depth < 20) return real(path.join(path.resolve(path.dirname(cur), fs.readlinkSync(cur)), ...rest.reverse()), depth + 1); } catch {}
    const up = path.dirname(cur); if (up === cur) return path.resolve(p);
    rest.push(path.basename(cur)); cur = up;
  }
}
const lc = (s) => (WIN || MAC ? s.toLowerCase() : s);
function insideWork(absPath, workdir) {
  const rel = path.relative(lc(real(workdir)), lc(real(absPath)));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}
// защита от разрушительных действий — их не выполняем даже после подтверждения
const ROOTS = new Set([path.parse(os.homedir()).root, os.homedir(), DESKTOP, path.join(os.homedir(), 'Documents'), path.join(os.homedir(), 'Downloads')].map((x) => path.resolve(x).toLowerCase()));
const SYS = WIN ? [process.env.SystemRoot || 'C:\\Windows', process.env.ProgramFiles || 'C:\\Program Files', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'] : ['/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/proc', '/sbin', '/sys', '/usr', '/var', '/System', '/Library', '/Applications'];
function guardPath(p, what) {
  const r = path.resolve(p).toLowerCase();
  if (ROOTS.has(r)) throw new Error(`${what} «${p}» заблокировано: это корневая или важная папка`);
  if (SYS.some((s) => r === s.toLowerCase() || r.startsWith(s.toLowerCase() + path.sep))) throw new Error(`${what} в системной папке «${p}» заблокировано`);
  if (r === CONF.toLowerCase()) throw new Error('файл настроек помощника трогать нельзя');
}
// хранилища секретов: читать и менять их нельзя даже с подтверждением (сервер или модель могут быть скомпрометированы)
function secretStores(home = os.homedir(), env = process.env) {
  const h = (...a) => path.join(home, ...a), app = env.APPDATA || h('AppData', 'Roaming'), loc = env.LOCALAPPDATA || h('AppData', 'Local');
  return [h('.ssh'), h('.aws'), h('.gnupg'), h('.config', 'gcloud'), h('.docker', 'config.json'), h('.npmrc'), h('.netrc'), h('.kube'),
    h('.config', 'google-chrome'), h('.config', 'chromium'), h('.config', 'microsoft-edge'), h('.mozilla'), h('snap', 'firefox'), h('snap', 'chromium'),
    h('Library', 'Application Support', 'Google', 'Chrome'), h('Library', 'Application Support', 'Microsoft Edge'), h('Library', 'Application Support', 'Firefox'), h('Library', 'Keychains'),
    path.join(loc, 'Google', 'Chrome', 'User Data'), path.join(loc, 'Microsoft', 'Edge', 'User Data'), path.join(app, 'Mozilla', 'Firefox'), path.join(loc, 'Mozilla', 'Firefox'),
    path.join(app, 'Microsoft', 'Credentials'), path.join(loc, 'Microsoft', 'Credentials'), path.join(app, 'Microsoft', 'Protect'), path.join(app, 'Microsoft', 'Vault')];
}
// собственные файлы помощника: подменив их, можно сделать из помощника что угодно
const ownFiles = () => [__filename, __filename + '.new', __filename + '.bak', __filename + '.sig', CONF, CONF + '.tmp'];
function guardSecret(p, opts = {}) {
  const forms = [path.resolve(p), real(p)].map(lc);
  const hit = (base) => forms.some((f) => { const b = lc(path.resolve(base)), rb = lc(real(base)); return f === b || f.startsWith(b + path.sep) || f === rb || f.startsWith(rb + path.sep); });
  if ((opts.own || ownFiles()).some((f) => forms.includes(lc(path.resolve(f))) || forms.includes(lc(real(f))))) throw new Error('файлы самого помощника и его настройки трогать нельзя');
  if ((opts.stores || secretStores()).some(hit)) throw new Error(`«${p}» — хранилище паролей, ключей или браузерных данных: доступ к нему закрыт, даже если вы подтвердите`);
}
const BAD = [
  /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*\s+(-[a-z]*\s+)*(\/|~|\$HOME|\/\*|~\/\*)(\s|$)/i, /\bmkfs(\.\w+)?\b/i, /\bdd\b[^|]*\bof=\/dev\//i, /:\(\)\s*\{\s*:\|:&\s*\};:/,
  /\bformat\s+[a-z]:/i, /\bdiskpart\b/i, /\b(rd|rmdir)\s+\/s\b[^&|]*\b[a-z]:\\?(\s|$|")/i, /\bdel\s+(\/[a-z]\s+)*[a-z]:\\\*?(\s|$)/i,
  /Remove-Item\b[^|;]*-Recurse[^|;]*\b[a-z]:\\?(\s|$|'|")/i, /\bbcdedit\b/i, /\bcipher\s+\/w/i, /\bvssadmin\s+delete\b/i, /\bchmod\s+-R\s+[0-7]+\s+\/(\s|$)/,
];
const guardCmd = (c) => { for (const re of BAD) if (re.test(c)) throw new Error('команда заблокирована помощником как опасная (может стереть диск или систему)'); };

// ---- подтверждение на самом компьютере ----
// текст от сервера нельзя показывать как есть: управляющие символы и ANSI-коды позволили бы нарисовать «поддельный» вопрос
const ANSI = /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-Z\\-_]|\x9b[0-?]*[ -\/]*[@-~]/g;
function clean(s, max = 6000) {
  const t = String(s ?? '').replace(ANSI, '').replace(/\r\n|\r|\n/g, ' ↵ ').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ');
  return t.length > max ? t.slice(0, max) + ` …[ещё ${t.length - max} симв. скрыто]` : t;
}
const LBL = { computer_run: 'Команда', computer_list: 'Просмотр', computer_read: 'Чтение', computer_write: 'Запись', computer_edit: 'Правка', computer_mkdir: 'Новая папка', computer_move: 'Перемещение', computer_delete: 'Удаление', computer_open: 'Открыть' };
const WHAT = { computer_write: 'Запись', computer_edit: 'Правка', computer_move: 'Перемещение', computer_delete: 'Удаление', computer_mkdir: 'Создание папки' };
const EXEC_EXT = /\.(exe|bat|cmd|com|msi|msp|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|lnk|scr|jar|sh|bash|zsh|command|app|desktop|appimage|py|pl|rb|hta|reg|cpl|pif|dll|url|scpt|workflow|run|bin|pkg|dmg|apk)$/i;
const isExecutable = (p) => { if (EXEC_EXT.test(p)) return true; try { return !WIN && fs.statSync(p).isFile() && !!(fs.statSync(p).mode & 0o111); } catch { return false; } };

// что именно затрагивает действие: { mode: 'run'|'read'|'write'|'open', paths: [абсолютные пути], url? }
function targets(name, a, wd) {
  a = a || {};
  switch (name) {
    case 'computer_run': return { mode: 'run', paths: [] };
    case 'computer_list': return { mode: 'read', paths: [P(a.path || wd, wd)] };
    case 'computer_read': return { mode: 'read', paths: [P(a.path, wd)] };
    case 'computer_write': case 'computer_edit': case 'computer_mkdir': case 'computer_delete': return { mode: 'write', paths: [P(a.path, wd)] };
    case 'computer_move': return { mode: 'write', paths: [P(a.from, wd), P(a.to, wd)] };
    case 'computer_open': {
      const t = String(a.target || '').trim(); if (!t) throw new Error('не указано, что открыть');
      if (/^https?:\/\//i.test(t)) return { mode: 'open', paths: [], url: openUrl(t) };
      if (/^[a-z][\w+.-]*:\/\//i.test(t)) throw new Error('можно открыть только ссылку http(s) или путь к файлу');
      return { mode: 'open', paths: [P(t, wd)] };
    }
  }
  return null;
}
// CLD-07: ссылка открывается без подтверждения, поэтому принимается только целиком разобранный адрес http(s);
// дальше идёт его нормальная запись (new URL().href), а не строка от модели
function openUrl(t) {
  let u; try { u = new URL(String(t)); } catch { throw new Error('неверная ссылка'); }
  if (!/^https?:$/.test(u.protocol) || !u.hostname || u.username || u.password) throw new Error('можно открыть только ссылку http(s) без логина и пароля');
  const href = u.href;
  if (href.length > 2000 || /[\s"\x00-\x1f\x7f]/.test(href)) throw new Error('в ссылке недопустимые символы');
  return href;
}
// чем открыть ссылку или файл: [программа, аргументы, параметры spawn]. Оболочки нет ни на одной системе:
// раньше Windows открывала через «cmd /c start», и «&», «|», «%ИМЯ%» в ссылке или имени файла выполнялись как команды —
// без вопроса на компьютере, потому что открытие ссылок и файлов рабочей папки не подтверждается
function opener(target, isUrl, platform = process.platform) {
  const o = { detached: true, stdio: 'ignore' };
  if (platform !== 'win32') return [platform === 'darwin' ? 'open' : 'xdg-open', [target], o];
  if (isUrl) return ['rundll32.exe', ['url.dll,FileProtocolHandler', target], { ...o, windowsHide: true }];
  if (/"/.test(target)) throw new Error('в пути недопустимые символы');
  return ['explorer.exe', ['"' + target + '"'], { ...o, windowsVerbatimArguments: true }]; // путь всегда в кавычках: пробелы и запятые не делят его на части
}
// нужно ли спрашивать пользователя: null — нет, иначе { kind: 'run'|'read-outside'|'write-outside', text }
function needConfirm(name, args, { workdir } = {}) {
  const a = args || {};
  if (name === 'computer_run') return { kind: 'run', text: `${LBL[name]}${a.background ? ' (в фоне)' : ''}: ${clean(a.command)}\nПапка: ${clean(P(a.cwd || workdir, workdir))}` };
  const t = targets(name, a, workdir); if (!t || t.url) return null;
  if (t.mode === 'open') { // программа, открытая из рабочей папки, — это тот же запуск команды
    const p = t.paths[0];
    if (isExecutable(p)) return { kind: 'run', text: `Открыть (запустит программу): ${clean(p)}` };
    return insideWork(p, workdir) ? null : { kind: 'read-outside', text: `${LBL[name]}: ${clean(p)}\nЭто вне рабочей папки ${clean(workdir)}` };
  }
  if (t.paths.every((p) => insideWork(p, workdir))) return null;
  return { kind: t.mode === 'write' ? 'write-outside' : 'read-outside', text: `${LBL[name]}: ${t.paths.map((p) => clean(p)).join(' → ')}\nЭто вне рабочей папки ${clean(workdir)}` };
}
const promptText = (req) => `\n${C.y}┌─ Premier просит разрешения на ЭТОМ компьютере${C.x}\n${String(req.text).split('\n').map((l) => '│ ' + clean(l)).join('\n')}\n${C.y}└─${C.x} ${C.b}y/д${C.x} — разрешить один раз · ${C.b}a/в${C.x} — разрешать такие действия, пока открыто окно · Enter — отклонить\n> `;

// очередь вопросов: окно одно, спрашиваем по одному (в том числе код привязки)
let ttyQueue = Promise.resolve();
const serial = (fn) => { const p = ttyQueue.then(fn, fn); ttyQueue = p.catch(() => {}); return p; };
const askLine = (q, o = {}) => new Promise((res) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); let done = false, t;
  const end = (v) => { if (done) return; done = true; clearTimeout(t); o.signal?.removeEventListener('abort', onAbort); rl.close(); res(v); };
  const onAbort = () => { console.log(); end(''); };
  if (o.timeout) t = setTimeout(() => { console.log(`\n${C.y}Ответа нет — действие отклонено.${C.x}`); end(''); }, o.timeout);
  if (o.signal) { if (o.signal.aborted) return end(''); o.signal.addEventListener('abort', onAbort, { once: true }); }
  rl.on('close', () => end('')); rl.question(q, (a) => end(a.trim()));
});
const ask = (q) => serial(() => askLine(q));
const SESSION = new Set(); // что разрешено до закрытия окна; на диск не сохраняется
// true — разрешено. Не TTY, ответ «нет», тайм-аут и отмена из чата — отказ. opts: { tty, answer(prompt, {timeout, signal}), allow, timeout, signal }
async function confirmLocal(req, opts = {}) {
  const allow = opts.allow || SESSION, tty = opts.tty ?? !!process.stdin.isTTY, answer = opts.answer || askLine, sig = opts.signal, ms = opts.timeout ?? CONFIRM_TIMEOUT;
  if (allow.has(req.kind)) return true;
  if (!tty || sig?.aborted) return false;
  return serial(async () => {
    if (allow.has(req.kind)) return true; if (sig?.aborted) return false;
    let timer, onAbort; const stop = new Promise((res) => { timer = setTimeout(() => res(''), ms); if (sig) { onAbort = () => res(''); sig.addEventListener('abort', onAbort, { once: true }); } });
    let a; try { a = await Promise.race([Promise.resolve(answer(promptText(req), { timeout: ms, signal: sig })), stop]); } catch { a = ''; }
    clearTimeout(timer); if (sig) sig.removeEventListener('abort', onAbort);
    a = String(a ?? '').trim().toLowerCase();
    if (sig?.aborted) return false;
    if (a === 'y' || a === 'д') return true;
    if (a === 'a' || a === 'в') { allow.add(req.kind); return true; }
    return false;
  });
}

// ---- действия ----
const kb = (n) => n < 1024 ? n + ' Б' : n < 1048576 ? (n / 1024).toFixed(1) + ' КБ' : (n / 1048576).toFixed(1) + ' МБ';
const SKIP = /^(node_modules|\.git|__pycache__|\.venv|venv|\.cache|\.next|dist|build)$/;
const clip = (s) => s.length > OUT_MAX ? s.slice(0, OUT_MAX / 2) + `\n…[пропущено ${s.length - OUT_MAX} символов]…\n` + s.slice(-OUT_MAX / 2) : s;

function list(p, depth) {
  const st = fs.statSync(p); if (!st.isDirectory()) return `${p} — файл (${kb(st.size)})`;
  const lines = []; const D = Math.min(3, Math.max(1, depth | 0 || 1));
  (function walk(d, lvl) {
    let items; try { items = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { lines.push('  '.repeat(lvl) + '(нет доступа)'); return; }
    items.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
    for (const it of items) {
      if (lines.length >= 400) return;
      let size = ''; if (!it.isDirectory()) { try { size = ' (' + kb(fs.statSync(path.join(d, it.name)).size) + ')'; } catch {} }
      lines.push('  '.repeat(lvl) + it.name + (it.isDirectory() ? '/' : size));
      if (it.isDirectory() && lvl + 1 < D && !SKIP.test(it.name)) walk(path.join(d, it.name), lvl + 1);
    }
  })(p, 0);
  return `Содержимое ${p}:\n` + (lines.join('\n') || '(папка пуста)') + (lines.length >= 400 ? '\n… (показаны первые 400)' : '');
}
function readText(p) {
  const st = fs.statSync(p); if (st.isDirectory()) throw new Error(p + ' — это папка (используй computer_list)');
  if (st.size > 3e6) throw new Error(`файл больше 3 МБ (${kb(st.size)})`);
  const t = fs.readFileSync(p, 'utf8'); if (t.slice(0, 8000).includes('\u0000')) throw new Error(`это не текстовый файл (${kb(st.size)})`); return t;
}
// убить процесс вместе со всеми потомками: на Windows taskkill /T, на POSIX — вся группа (команда запущена как лидер группы)
function killTree(pid) {
  if (!pid) return;
  try { if (WIN) cp.spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); else process.kill(-pid, 'SIGKILL'); }
  catch { try { process.kill(pid, 'SIGKILL'); } catch {} }
}
// есть ли ещё процессы в группе команды (POSIX): оболочка могла выйти, оставив «cmd &» работать
const groupAlive = (pid) => { if (WIN || !pid) return false; try { process.kill(-pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function run(cmd, cwd, bg, ctx = CTX) {
  guardCmd(cmd);
  const dir = P(cwd || ctx.workdir, ctx.workdir); if (dir === path.resolve(ctx.workdir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(dir)) throw new Error('папка не найдена: ' + dir);
  // на Windows переключаем консоль в UTF-8, чтобы русский текст в выводе не превращался в кракозябры
  const full = WIN ? 'chcp 65001>nul & ' + cmd : cmd;
  return new Promise((resolve) => {
    const t0 = Date.now(); let out = '', killed = false, done = false, t, tk;
    // detached на POSIX: команда становится лидером своей группы процессов, и «Стоп» убивает всё дерево, а не только оболочку
    const ch = cp.spawn(full, { cwd: dir, shell: true, windowsHide: !bg, detached: !WIN, env: { ...process.env, PYTHONIOENCODING: 'utf-8', FORCE_COLOR: '0' } });
    const finish = (s) => { if (done) return; done = true; clearTimeout(t); clearTimeout(tk); resolve(s); };
    const stopped = () => `${STOPPED}${out.trim() ? '\nВывод до остановки:\n' + clip(out.trim()) : ''}`;
    if (ctx.entry) ctx.entry.onKill = () => { killTree(ch.pid); tk = setTimeout(() => finish(stopped()), 1500); }; // если кто-то из потомков держит вывод, не ждём его вечно
    const add = (d) => { out += d.toString('utf8'); if (out.length > OUT_MAX * 2) out = clip(out); };
    ch.stdout.on('data', add); ch.stderr.on('data', add);
    ch.on('error', (e) => finish('Ошибка запуска: ' + e.message));
    if (bg) { // фоновый запуск: ждём 4 секунды, отдаём первый вывод и оставляем процесс работать
      // CLD-09: фоновый процесс остаётся в отдельном реестре под номером своего задания — «Стоп» в чате завершит и его.
      // Запись живёт, пока в группе процессов команды кто-то есть: оболочка «sleep 5; server &» выходит, а сервер работает
      const reg = ctx.bg || BG, jid = ctx.entry?.jid, rec = { kill: () => killTree(ch.pid) };
      const track = () => { if (jid && !ctx.entry?.cancelled) reg.set(jid, rec); };
      const settle = () => { // оболочка вышла
        if (!jid || reg.get(jid) !== rec) return;
        if (!groupAlive(ch.pid)) return void reg.delete(jid);
        const iv = setInterval(() => { if (reg.get(jid) !== rec) return clearInterval(iv); if (!groupAlive(ch.pid)) { clearInterval(iv); reg.delete(jid); } }, 2000); iv.unref?.();
      };
      t = setTimeout(() => {
        track(); ch.on('exit', settle);
        ch.stdout.removeAllListeners('data'); ch.stderr.removeAllListeners('data'); ch.stdout.resume(); ch.stderr.resume(); ch.unref(); finish(`Запущено в фоне (pid ${ch.pid}) в ${dir}.\nВывод за первые секунды:\n${clip(out.trim()) || '(пусто)'}`);
      }, 4000);
      ch.on('exit', (code) => {
        if (done) return;
        if (groupAlive(ch.pid)) { track(); settle(); } // оболочка вышла раньше 4 секунд, но оставила процессы
        finish(ctx.entry?.cancelled ? stopped() : `Процесс завершился сразу (код ${code}) в ${dir}.\n${clip(out.trim()) || '(вывода нет)'}`);
      });
      return;
    }
    t = setTimeout(() => { killed = true; killTree(ch.pid); }, ctx.runTimeout || RUN_TIMEOUT);
    ch.on('close', (code) => finish(ctx.entry?.cancelled ? stopped() : `${killed ? 'Остановлено: команда шла дольше 10 минут (долгие процессы запускай с background: true).' : `Код завершения ${code}`} · ${((Date.now() - t0) / 1000).toFixed(1)} с · папка ${dir}\n${clip(out.trim()) || '(вывода нет)'}`));
  });
}

// жёсткие запреты: действуют и после подтверждения
function guardAccess(name, a, wd) {
  const t = targets(name, a, wd); if (!t) return;
  if (name === 'computer_run') return guardCmd(String(a.command || ''));
  t.paths.forEach((p, i) => {
    guardSecret(p);
    if (t.mode !== 'write') return;
    guardPath(p, WHAT[name]); guardPath(real(p), WHAT[name]);
    if ((name === 'computer_delete' || (name === 'computer_move' && i === 0)) && lc(real(p)) === lc(real(wd))) throw new Error('рабочую папку целиком удалять или переносить нельзя');
  });
}
// ctx: { workdir, confirm(req, {signal}) → Promise<boolean>, entry?, runTimeout? }
async function exec(name, a, ctx = CTX) {
  a = a || {}; const wd = ctx.workdir;
  guardAccess(name, a, wd);
  const need = needConfirm(name, a, { workdir: wd });
  if (need && !(await ctx.confirm(need, { signal: ctx.entry?.ac.signal }))) return DENIED;
  if (ctx.entry?.cancelled) return STOPPED;
  switch (name) {
    case 'computer_run': return run(String(a.command || ''), a.cwd, !!a.background, ctx);
    case 'computer_list': return list(P(a.path || wd, wd), a.depth);
    case 'computer_read': {
      const p = P(a.path, wd), t = readText(p), L = t.split('\n'), s = Math.max(1, a.start_line | 0 || 1), e = Math.min(L.length, a.end_line | 0 || L.length);
      let body = L.slice(s - 1, e).join('\n'); if (body.length > 120000) body = body.slice(0, 120000) + '\n…[обрезано — читай частями через start_line/end_line]';
      return `Файл ${p} (${L.length} строк)${s > 1 || e < L.length ? `, строки ${s}–${e}` : ''}:\n${body}`;
    }
    case 'computer_write': {
      const p = P(a.path, wd); const had = fs.existsSync(p);
      if (had && fs.statSync(p).isDirectory()) throw new Error(p + ' — это папка');
      fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, String(a.content ?? ''));
      return `Готово: ${p} ${had ? 'перезаписан' : 'создан'} (${kb(Buffer.byteLength(String(a.content ?? '')))}).`;
    }
    case 'computer_edit': {
      const p = P(a.path, wd); let t = readText(p), old = String(a.old ?? ''), nw = String(a.new ?? '');
      if (!old) throw new Error('пустой фрагмент old');
      if (t.includes('\r\n') && !old.includes('\r')) { old = old.replace(/\n/g, '\r\n'); nw = nw.replace(/\n/g, '\r\n'); }
      const n = t.split(old).length - 1;
      if (!n) throw new Error('фрагмент old не найден — перечитай файл и скопируй фрагмент точно');
      if (n > 1) throw new Error(`фрагмент old встречается ${n} раз(а) — добавь соседние строки`);
      fs.writeFileSync(p, t.replace(old, () => nw)); return `Готово: ${p} изменён.`;
    }
    case 'computer_mkdir': { const p = P(a.path, wd); if (fs.existsSync(p)) return `Папка уже есть: ${p}`; fs.mkdirSync(p, { recursive: true }); return `Готово: создана папка ${p}`; }
    case 'computer_move': {
      const f = P(a.from, wd), t = P(a.to, wd);
      if (!fs.existsSync(f)) throw new Error('не найдено: ' + f); if (fs.existsSync(t)) throw new Error('уже существует: ' + t);
      fs.mkdirSync(path.dirname(t), { recursive: true });
      try { fs.renameSync(f, t); } catch (e) { if (e.code !== 'EXDEV') throw e; fs.cpSync(f, t, { recursive: true }); fs.rmSync(f, { recursive: true, force: true }); }
      return `Готово: ${f} → ${t}`;
    }
    case 'computer_delete': {
      const p = P(a.path, wd); if (!fs.existsSync(p)) throw new Error('не найдено: ' + p);
      const dir = fs.statSync(p).isDirectory(); fs.rmSync(p, { recursive: true, force: true }); return `Готово: ${dir ? 'удалена папка' : 'удалён файл'} ${p}`;
    }
    case 'computer_open': {
      const t = targets(name, a, wd), target = t.url || t.paths[0];
      if (!t.url && !fs.existsSync(target)) throw new Error('не найдено: ' + target);
      const c = cp.spawn(...opener(target, !!t.url));
      c.on('error', () => {}); c.unref(); return `Открыто: ${target}`;
    }
  }
  throw new Error('неизвестное действие ' + name);
}

// ---- задания: реестр запущенных и отмена ----
const WORK = { dir: DEF_WORK };
const JOBS = new Map(); // jid → { kill() } — всё, что сейчас выполняется
const BG = new Map(); // jid → { kill() } — фоновые процессы, которые уже ответили «Запущено в фоне» и работают дальше
const CTX = { get workdir() { return WORK.dir; }, jobs: JOBS, bg: BG, confirm: (req, o) => confirmLocal(req, o) };
// выполняет задание { jid, name, args } и возвращает текст результата; пока идёт, задание лежит в ctx.jobs и его можно отменить
async function runJob(job, ctx = CTX) {
  const entry = { jid: String(job.jid), cancelled: false, ac: new AbortController(), onKill: null, kill() { this.cancelled = true; this.ac.abort(); if (this.onKill) this.onKill(); } };
  const jobs = ctx.jobs || JOBS; jobs.set(job.jid, entry);
  let out;
  try { out = await exec(job.name, job.args || {}, Object.create(ctx, { entry: { value: entry } })); }
  catch (e) { out = 'Ошибка: ' + e.message; }
  finally { jobs.delete(job.jid); }
  if (entry.cancelled && !out.startsWith(STOPPED)) out = STOPPED;
  return out;
}
function cancelJob(jid, ctx = CTX) {
  const e = (ctx.jobs || JOBS).get(String(jid)); if (e) { e.kill(); return true; }
  const bg = ctx.bg || BG, b = bg.get(String(jid)); if (!b) return false; // задание давно ответило, но его фоновый процесс ещё работает
  bg.delete(String(jid)); try { b.kill(); } catch {} return true;
}
// bg = true — вместе с фоновыми процессами (доступ отозван); при обычном выходе из помощника фон, как и раньше, остаётся работать
const killAll = (ctx = CTX, bg = false) => {
  for (const e of (ctx.jobs || JOBS).values()) try { e.kill(); } catch {}
  if (bg) { const m = ctx.bg || BG; for (const b of m.values()) try { b.kill(); } catch {} m.clear(); }
};

// ---- подписанные обновления ----
const KEYS_LINE = /^const UPDATE_KEYS = \[([^\]\r\n]*?)\/\*UPDATE_KEYS\*\/\];?[ \t]*\r?$/m;
function embeddedKeys(src) { const m = KEYS_LINE.exec(Buffer.isBuffer(src) ? src.toString('utf8') : String(src)); return m ? [...m[1].matchAll(/'([A-Za-z0-9+\/=]+)'/g)].map((x) => x[1]) : []; }
const versionOf = (src) => { const m = /^const AGENT_VERSION = (\d+);/m.exec(Buffer.isBuffer(src) ? src.toString('utf8') : String(src)); return m ? Number(m[1]) : null; };
function verifySig(data, sigB64, keys) {
  let sig; try { sig = Buffer.from(String(sigB64 || '').trim(), 'base64'); } catch { return false; }
  if (sig.length !== 64) return false;
  return keys.some((k) => { try { return crypto.verify(null, data, crypto.createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' }), sig); } catch { return false; } });
}
// Решение об обновлении. Ключи берём ТОЛЬКО из работающего файла: ключ из скачанного файла доверия не заслуживает.
function checkUpdate({ current, next, sig }) {
  if (Buffer.compare(current, next) === 0) return { install: false, reason: 'уже последняя версия' };
  const keys = embeddedKeys(current);
  if (!keys.length) return { install: false, reason: 'в помощнике нет ключа для проверки обновлений' };
  if (!sig || !String(sig).trim()) return { install: false, reason: 'у обновления нет подписи' };
  if (!verifySig(next, sig, keys)) return { install: false, reason: 'подпись обновления не подходит' };
  const cv = versionOf(current), nv = versionOf(next);
  if (nv === null || (cv !== null && nv < cv)) return { install: false, reason: 'версия обновления ниже текущей' };
  return { install: true, reason: 'подпись верна' };
}
async function download(url, max, ms = 20000) { // без переходов на другие адреса, с лимитом размера
  const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
  const chunks = []; let n = 0;
  for await (const c of r.body) { n += c.length; if (n > max) throw new Error('файл слишком большой'); chunks.push(Buffer.from(c)); }
  return Buffer.concat(chunks);
}
let warnedUnsigned = false;
// opts: { file, argv, canInstall() → bool, beforeInstall(), reexec(file, argv) }. Возвращает 'same' | 'unsigned' | 'installed' | 'busy'
async function selfUpdate(server, opts = {}) {
  const file = opts.file || __filename, origin = checkServer(server);
  const next = await download(origin + '/premier-agent.js', 2 * 1048576);
  const sig = (await download(origin + '/premier-agent.js.sig', 4096).catch(() => Buffer.alloc(0))).toString('utf8');
  const current = fs.readFileSync(file), d = checkUpdate({ current, next, sig });
  if (!d.install) {
    if (d.reason === 'уже последняя версия') return 'same';
    if (!warnedUnsigned) { warnedUnsigned = true; log('y', `! обновление не подписано — остаюсь на текущей версии (${d.reason})`); }
    return 'unsigned';
  }
  if (opts.canInstall && !opts.canInstall()) return 'busy'; // пока идут задания, не перезапускаемся
  fs.writeFileSync(file + '.new', next);
  try { fs.copyFileSync(file, file + '.bak'); } catch {}
  fs.renameSync(file + '.new', file);
  log('g', `✓ Помощник обновлён (подпись проверена), перезапускаю. Прежняя версия: ${path.basename(file)}.bak`);
  if (opts.beforeInstall) opts.beforeInstall();
  (opts.reexec || reexec)(file, opts.argv || process.argv.slice(2));
  return 'installed';
}
function reexec(file, argv) {
  const c = cp.spawn(process.execPath, [file, ...argv], { stdio: 'inherit' });
  c.on('error', (e) => { log('r', 'Не удалось перезапуститься: ' + e.message + '. Запустите помощника заново.'); process.exit(1); });
  c.on('exit', (code) => process.exit(code ?? 1));
}

// ---- связь с сервером ----
let SERVER = '', POLL_AC = null, STOPPING = false;
const outdated = () => { log('r', '✗ Помощник устарел и не подходит этому серверу. Скачайте его заново в чате Premier (кнопка «Компьютер») и запустите снова.'); process.exit(1); };
// все запросы — только на проверенный origin, без переходов по редиректам (иначе токен можно отправить на чужой адрес)
async function api(p, body, token, ac) {
  const ctl = ac || new AbortController(), t = setTimeout(() => ctl.abort(), 60000);
  try {
    const r = await fetch(SERVER + p, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body || {}), signal: ctl.signal });
    if (r.status === 426) outdated();
    if (r.status === 204) return null; const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || 'HTTP ' + r.status), { status: r.status }); return j;
  } finally { clearTimeout(t); }
}

async function pair(code, st) {
  for (;;) {
    code = code || await ask(`${C.b}Введите код из чата Premier (кнопка «Компьютер»): ${C.x}`);
    try { const r = await api('/api/agent/connect', { code, info: INFO, dev: st.conf.dev, v: AGENT_VERSION }); delete st.conf.servers[SERVER]; st.conf.servers[SERVER] = { token: r.token }; saveConf(st.conf); return r.token; }
    catch (e) { log('r', '✗ ' + e.message); code = ''; if (!process.stdin.isTTY) process.exit(1); }
  }
}
async function sendResult(jid, out, token, posting) {
  posting.add(jid);
  try { for (let i = 0; i < 3; i++) { try { await api('/api/agent/result', { jid, out }, token); break; } catch (e) { if (e.status === 401) break; await sleep(1500); } } } finally { posting.delete(jid); }
}
async function main() {
  let args, conf;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { log('r', e.message); process.exit(1); }
  conf = loadConf();
  try { const s = pickServer(args, process.env, conf); if (!s) throw new Error('не задан адрес сервера. Скачайте помощника из чата Premier или запустите: node premier-agent.js --server https://ваш-сайт'); SERVER = checkServer(s); }
  catch (e) { log('r', 'Адрес сервера: ' + e.message); process.exit(1); }
  if (Number(process.versions.node.split('.')[0]) < 18) { log('r', 'Нужен Node.js 18 или новее: https://nodejs.org'); process.exit(1); }
  // рабочая папка: ключ --workdir (запоминается) → сохранённая → ~/Premier; не домашняя папка и не системная
  try {
    const wd = args.workdir ? P(args.workdir, process.cwd()) : conf.workdir || DEF_WORK;
    guardPath(wd, 'Рабочая папка'); const rel = path.relative(wd, os.homedir()); if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new Error('рабочая папка не может содержать всю домашнюю папку');
    fs.mkdirSync(wd, { recursive: true }); WORK.dir = INFO.workdir = path.resolve(wd); conf.workdir = WORK.dir;
  } catch (e) { log('r', 'Рабочая папка: ' + e.message); process.exit(1); }
  saveConf(conf);
  if (args.yesCommands) { SESSION.add('run'); log('y', '! --yes-commands: команды выполняются БЕЗ вопроса в этом окне, пока оно открыто. Действия вне рабочей папки по-прежнему требуют подтверждения.'); }
  console.log(`\n${C.b}Premier Agent${C.x} — доступ модели к этому компьютеру\n${C.d}Сервер: ${SERVER}\nСистема: ${INFO.os}\nРабочая папка: ${WORK.dir}${C.x}\n`);
  const st = { conf };
  const canStop = () => !JOBS.size;
  const update = async () => {
    try { await selfUpdate(SERVER, { argv: process.argv.slice(2), canInstall: canStop, beforeInstall: () => { STOPPING = true; POLL_AC?.abort(); } }); }
    catch (e) { log('d', '  (обновление не проверено: ' + e.message + ')'); }
  };
  if (!args.noUpdate) { await update(); setInterval(update, UPDATE_EVERY).unref(); }
  // код из аргумента нужен только для первой привязки; если помощник уже привязан — используем сохранённый ключ
  let arg = args.code, token = conf.servers[SERVER]?.token;
  if (!token) { token = await pair(arg, st); arg = ''; }
  log('g', '✓ Подключено. Окно не закрывайте — пока оно открыто, модель может работать с компьютером. Команды и всё вне рабочей папки вы подтверждаете здесь.');
  log('d', '  Остановить: Ctrl+C или «Отключить» в чате.\n');
  const stopAll = () => { killAll(); };
  process.on('exit', stopAll); process.on('SIGINT', () => process.exit(130)); process.on('SIGTERM', () => process.exit(143));
  const posting = new Set(); let fails = 0;
  for (;;) {
    if (STOPPING) await new Promise(() => {}); // идёт перезапуск на новую версию
    let msg; POLL_AC = new AbortController();
    try { msg = await api('/api/agent/poll', { info: INFO, dev: conf.dev, v: AGENT_VERSION, busy: [...new Set([...JOBS.keys(), ...posting])] }, token, POLL_AC); fails = 0; }
    catch (e) {
      if (STOPPING) continue;
      if (e.status === 401) {
        // CLD-08: доступ отозван — всё, что запущено по заданиям этого аккаунта (и фон тоже), завершается сразу, а не «когда доработает»
        killAll(CTX, true);
        log('y', '! Помощник отключён в чате или привязан к другому компьютеру. Запущенные им команды остановлены. Чтобы подключить снова, введите новый код.'); delete conf.servers[SERVER]; saveConf(conf); token = await pair(arg, st); arg = ''; log('g', '✓ Подключено снова.'); continue;
      }
      if (++fails === 1) log('y', '! Нет связи с сервером, повторяю… (' + e.message + ')'); await sleep(Math.min(30000, 2000 * fails)); continue;
    }
    if (!msg) continue;
    if (Array.isArray(msg.cancel)) { for (const jid of msg.cancel) if (cancelJob(jid)) log('y', '  ■ остановлено по запросу из чата'); continue; }
    if (!msg.jid || STOPPING) continue;
    const job = msg, a = job.args || {}, what = a.command || a.path || a.target || (a.from ? a.from + ' → ' + a.to : '');
    log('b', `→ ${LBL[job.name] || clean(job.name, 60)}: ${clean(what, 200)}`);
    posting.add(job.jid); // задания идут параллельно, а опрос продолжается — иначе «Стоп» не дойдёт
    runJob(job).then((out) => { log(out.startsWith('Ошибка') || out.startsWith('Остановлено') ? 'r' : 'g', out.startsWith('Ошибка') || out.startsWith('Остановлено') ? '  ✗ ' + out.split('\n')[0].slice(0, 200) : '  ✓ готово'); return sendResult(job.jid, out, token, posting); }).finally(() => posting.delete(job.jid));
  }
}
if (require.main === module) main().catch((e) => { log('r', e.message); process.exit(1); });
module.exports = { exec, guardCmd, P, openUrl, opener, BG, AGENT_VERSION, UPDATE_KEYS, checkServer, parseArgs, pickServer, migrateConf, loadConf, saveConf, insideWork, real, guardPath, guardSecret, secretStores, needConfirm, confirmLocal, promptText, clean, runJob, cancelJob, killAll, killTree, run, JOBS, SESSION, WORK, embeddedKeys, versionOf, verifySig, checkUpdate, selfUpdate, STOPPED, DENIED };
