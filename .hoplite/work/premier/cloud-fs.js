'use strict';
// Файлы пользователя на диске сервера — только «от открытой папки» (CLD-01).
//
// Домашняя папка облачного компьютера (data/cloud/<uid>) смонтирована в контейнер: всё внутри неё пишет пользователь,
// в том числе ссылки (symlink) на любые пути сервера. Путь-строка «data/cloud/u1/site/index.html» ненадёжен: между
// проверкой и чтением папку site можно заменить ссылкой на /etc — и сервер прочитает или перенесёт чужой файл.
// Поэтому здесь нет ни одной операции по строковому пути пользователя. Путь проходится по одному имени за раз:
// каждая папка открывается от дескриптора родителя с O_NOFOLLOW (ссылка — отказ), а файл читается и переносится
// через дескриптор уже открытой папки. Подмена пути после открытия ничего не меняет: дескриптор указывает на ту же папку.
//
// В Node.js нет openat(), поэтому «от дескриптора» — это путь /proc/self/fd/<fd>/<имя>: ядро берёт папку из
// дескриптора, а не по имени. Нужен Linux. В других системах (разработка с CLOUD_RUNNER=local) работает упрощённый
// вариант по строковым путям с теми же проверками на ссылки, но без защиты от подмены на лету — SAFE = false.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const C = fs.constants;
const SAFE = process.platform === 'linux' && (() => { try { return fs.statSync('/proc/self/fd').isDirectory(); } catch { return false; } })();
const NOF = C.O_NOFOLLOW || 0;
const O_DIR = C.O_RDONLY | (C.O_DIRECTORY || 0) | NOF;
const O_FILE = C.O_RDONLY | (C.O_NONBLOCK || 0) | NOF;
const O_NEW = C.O_WRONLY | C.O_CREAT | C.O_EXCL | NOF;

const err = (code, text, status) => Object.assign(new Error(text), { code, ...(status ? { status } : {}) });
// имя одной записи папки: не пустое, не «.», не «..», без разделителей и нулевого байта, не длиннее 255 байт
function okName(name) {
  return typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && !/[\0/]/.test(name) && (path.sep === '/' || !name.includes(path.sep)) && Buffer.byteLength(name) <= 255;
}
const check = (name) => { if (!okName(name)) throw err('EBADNAME', 'недопустимое имя: ' + String(name).slice(0, 80)); return name; };
// папка-дескриптор: { fd, p } — p нужен только для сообщений и для упрощённого режима (не Linux)
const at = (h, name) => (SAFE ? `/proc/self/fd/${h.fd}/${name}` : path.join(h.p, name));
const self = (h) => (SAFE ? `/proc/self/fd/${h.fd}` : h.p);
const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
// почему папка не открылась: нет / ссылка / не папка
function why(e, p, name) {
  if (e.code === 'ENOENT') return err('ENOENT', 'не найдено: ' + name);
  if (e.code === 'ELOOP' || e.code === 'EMLINK' || isLink(p)) return err('ELINK', 'это ссылка, а не папка: ' + name);
  if (e.code === 'ENOTDIR') return err('ENOTDIR', 'это не папка: ' + name);
  return e;
}

/* ---------- синхронные операции (короткие: одна папка, один файл) ---------- */
function openRoot(home) {
  try {
    if (!SAFE && isLink(home)) throw err('ELOOP', 'ссылка');
    return { fd: fs.openSync(home, O_DIR), p: home };
  } catch (e) { throw why(e, home, path.basename(home)); }
}
const close = (h) => { if (h && h.fd != null) { try { fs.closeSync(h.fd); } catch {} h.fd = null; } };
// вложенная папка name в открытой папке h. create — создать, если её нет; own = { uid, gid } — кому отдать созданную
function child(h, name, { create = false, own = null } = {}) {
  check(name);
  const p = at(h, name);
  const open = () => { if (!SAFE && isLink(p)) throw err('ELOOP', 'ссылка'); return { fd: fs.openSync(p, O_DIR), p: path.join(h.p, name) }; };
  try { return open(); } catch (e) {
    if (!(create && e.code === 'ENOENT')) throw why(e, p, name);
  }
  try { fs.mkdirSync(p, 0o755); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  let n; try { n = open(); } catch (e) { throw why(e, p, name); } // между mkdir и open папку могли заменить ссылкой — O_NOFOLLOW откажет
  if (own) try { fs.fchownSync(n.fd, own.uid, own.gid); } catch {}
  return n;
}
// папка home/parts[0]/parts[1]/… — вызывающий закрывает через close()
function openDir(home, parts = [], opts = {}) {
  let h = openRoot(home);
  try {
    for (const name of parts) { const n = child(h, name, opts); close(h); h = n; }
    return h;
  } catch (e) { close(h); throw e; }
}
function withDir(home, parts, fn, opts) { const h = openDir(home, parts, opts); try { return fn(h); } finally { close(h); } }
const lstat = (h, name) => fs.lstatSync(at(h, check(name)), { throwIfNoEntry: false }) || null;
const fstat = (h) => fs.fstatSync(h.fd);
// обычный файл name в папке h: { fd, st }. Ссылка, папка, устройство, FIFO — отказ.
function openFile(h, name) {
  check(name);
  const p = at(h, name); let fd = null;
  try {
    if (!SAFE && isLink(p)) throw err('ELINK', 'это ссылка: ' + name);
    fd = fs.openSync(p, O_FILE);
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw err('ENOTFILE', 'это не файл: ' + name);
    return { fd, st };
  } catch (e) {
    if (fd != null) try { fs.closeSync(fd); } catch {}
    if (e.code === 'ELOOP' || e.code === 'EMLINK') throw err('ELINK', 'это ссылка: ' + name);
    throw e;
  }
}
// записи папки h (без «.» и «..»), не больше max
function readdir(h, max = 100000) {
  const d = fs.opendirSync(self(h)), out = [];
  try { for (let e; (e = d.readSync());) { out.push(e); if (out.length > max) throw err('ETOOMANY', 'в папке слишком много файлов', 413); } }
  finally { try { d.closeSync(); } catch {} }
  return out;
}
// перенос записи между открытыми папками; ссылка переносится как запись и не разыменовывается
const rename = (h1, n1, h2, n2) => fs.renameSync(at(h1, check(n1)), at(h2, check(n2)));
const unlink = (h, name) => fs.unlinkSync(at(h, check(name)));
const createFile = (h, name, mode = 0o644) => fs.openSync(at(h, check(name)), O_NEW, mode);

/* ---------- асинхронные операции: обход больших папок не останавливает сервер (CLD-17) ---------- */
async function openRootA(home) {
  try {
    if (!SAFE && isLink(home)) throw err('ELOOP', 'ссылка');
    const fh = await fsp.open(home, O_DIR); return { fd: fh.fd, fh, p: home };
  } catch (e) { throw why(e, home, path.basename(home)); }
}
const closeA = async (h) => { if (h && h.fh) { const fh = h.fh; h.fh = null; h.fd = null; try { await fh.close(); } catch {} } };
async function childA(h, name) {
  check(name);
  const p = at(h, name);
  try {
    if (!SAFE && isLink(p)) throw err('ELOOP', 'ссылка');
    const fh = await fsp.open(p, O_DIR); return { fd: fh.fd, fh, p: path.join(h.p, name) };
  } catch (e) { throw why(e, p, name); }
}
async function openDirA(home, parts = []) {
  let h = await openRootA(home);
  try {
    for (const name of parts) { const n = await childA(h, name); await closeA(h); h = n; }
    return h;
  } catch (e) { await closeA(h); throw e; }
}
const lstatA = (h, name) => fsp.lstat(at(h, check(name))).catch(() => null);
// обычный файл: { fh, st } — читать только через fh
async function openFileA(h, name) {
  check(name);
  const p = at(h, name); let fh = null;
  try {
    if (!SAFE && isLink(p)) throw err('ELINK', 'это ссылка: ' + name);
    fh = await fsp.open(p, O_FILE);
    const st = await fh.stat();
    if (!st.isFile()) throw err('ENOTFILE', 'это не файл: ' + name);
    return { fh, st };
  } catch (e) {
    if (fh) await fh.close().catch(() => {});
    if (e.code === 'ELOOP' || e.code === 'EMLINK') throw err('ELINK', 'это ссылка: ' + name);
    throw e;
  }
}
// содержимое открытого файла, не больше max байт: файл мог вырасти после fstat — лишнее не читаем, а отказываем
async function readAll(fh, max) {
  const chunks = []; let total = 0;
  for (;;) {
    const buf = Buffer.allocUnsafe(Math.min(1 << 20, max - total + 1));
    const { bytesRead } = await fh.read(buf, 0, buf.length, null);
    if (!bytesRead) break;
    total += bytesRead; if (total > max) throw err('ETOOBIG', 'файл больше допустимого', 413);
    chunks.push(bytesRead === buf.length ? buf : buf.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, total);
}

const LIMITS = { maxEntries: 100000, maxDepth: 40, maxMs: 20000 };
// Обход папки home/parts в глубину. Ссылки, устройства, FIFO пропускаются, в папки-ссылки обход не заходит.
//   skip(name, depth, isDir) → true: не смотреть эту запись (depth 0 — сама папка)
//   onFile({ rel, name, depth, dir }) — dir: открытая папка файла; читать через openFileA(dir, name) / lstatA(dir, name)
//   onDeep({ rel, depth }) — папка глубже maxDepth (по умолчанию молча пропускается)
// Пределы: записей всего (maxEntries), глубина (maxDepth), время (maxMs) — при превышении исключение со status 413.
// Имена в каждой папке идут по алфавиту (байтовый порядок): результат не зависит от порядка на диске.
async function walk(home, parts, { skip, onFile, onDeep, maxEntries = LIMITS.maxEntries, maxDepth = LIMITS.maxDepth, maxMs = LIMITS.maxMs, tooMany = 'В папке слишком много файлов', tooLong = 'Папка обходится слишком долго — в ней слишком много файлов' } = {}) {
  const until = Date.now() + maxMs; let seen = 0, skipped = 0;
  const visit = async (h, rel, depth) => {
    const d = await fsp.opendir(self(h)), list = [];
    try {
      for await (const e of d) {
        if (++seen > maxEntries) throw err('ETOOMANY', tooMany, 413);
        if ((seen & 255) === 0 && Date.now() > until) throw err('ETIMEDOUT', tooLong, 413);
        list.push(e);
      }
    } finally { await d.close().catch(() => {}); }
    list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of list) {
      if (Date.now() > until) throw err('ETIMEDOUT', tooLong, 413);
      if (!okName(e.name)) continue;
      const isDir = e.isDirectory(), r = rel ? rel + '/' + e.name : e.name;
      if (!isDir && !e.isFile()) continue; // ссылка, устройство, сокет, FIFO
      if (skip && skip(e.name, depth, isDir)) { skipped++; continue; }
      if (isDir) {
        if (depth >= maxDepth) { if (onDeep) await onDeep({ rel: r, depth }); continue; }
        let n; try { n = await childA(h, e.name); } catch { continue; } // исчезла или стала ссылкой, пока шёл обход
        try { await visit(n, r, depth + 1); } finally { await closeA(n); }
      } else if (onFile) await onFile({ rel: r, name: e.name, depth, dir: h });
    }
  };
  const root = await openDirA(home, parts);
  try { await visit(root, '', 0); } finally { await closeA(root); }
  return { seen, skipped };
}

/* ---------- приём файла потоком (CLD-16): сразу на диск, во временный файл той же папки ---------- */
// Поток src пишется в новый файл папки h под временным именем; после успеха файл получает имя name (rename в той же папке).
// limit — предел байтов (превышение — 413, временный файл удаляется). own — владелец готового файла (сервер под root).
// Возвращает размер. Если name занят папкой — ошибка; файл или ссылку с этим именем заменяет (ссылка не разыменовывается).
function receive(h, name, src, { limit, own = null, mode = 0o644 } = {}) {
  check(name);
  const tmp = `.premier-upload-${crypto.randomBytes(8).toString('hex')}.part`;
  return new Promise((resolve, reject) => {
    let fd, out, size = 0, done = false;
    const fail = (e) => {
      if (done) return; done = true;
      src.unpipe?.(out); out?.destroy();
      try { unlink(h, tmp); } catch {}
      reject(e);
    };
    // клиент ушёл раньше, чем начался приём (пока сервер считал место): события 'aborted' и 'close' уже прошли и не
    // повторятся — без этой проверки обещание не завершилось бы никогда и держало бы резерв памяти и открытые файлы
    if (src.destroyed || src.aborted || src.errored) return reject(err('EABORTED', 'загрузка прервана', 400));
    try { fd = createFile(h, tmp, mode); } catch (e) { return reject(e); }
    // владельца меняем у открытого файла (fchown), а не по имени: имя за это время могли заменить ссылкой на файл сервера
    if (own) try { fs.fchownSync(fd, own.uid, own.gid); } catch {}
    out = fs.createWriteStream(null, { fd, autoClose: true });
    out.on('error', fail);
    src.on('error', fail);
    src.on('aborted', () => fail(err('EABORTED', 'загрузка прервана', 400)));
    src.on('close', () => { if (src.complete === false) fail(err('EABORTED', 'загрузка прервана', 400)); });
    src.on('data', (d) => { size += d.length; if (size > limit) fail(err('ETOOBIG', 'файл больше допустимого размера', 413)); });
    out.on('finish', () => {
      if (done) return; done = true;
      try {
        if (src.complete === false) throw err('EABORTED', 'загрузка прервана', 400);
        const st = lstat(h, name);
        if (st && st.isDirectory()) throw err('EISDIR', 'с таким именем уже есть папка: ' + name);
        rename(h, tmp, h, name);
        resolve(size);
      } catch (e) { try { unlink(h, tmp); } catch {} reject(e); }
    });
    src.pipe(out);
  });
}

module.exports = { SAFE, okName, openRoot, openDir, withDir, child, close, lstat, fstat, openFile, readdir, rename, unlink, createFile,
  openDirA, childA, closeA, lstatA, openFileA, readAll, walk, receive, LIMITS };
