'use strict';
// Папка облачного компьютера одним ZIP-архивом: «скачать проект целиком». Архив пишется потоком с диска сервера —
// контейнер не запускается, большой проект не грузится в память. Зависимостей нет: zlib из Node.js.
// Зависимости проекта (node_modules, venv…) в архив не кладём: они ставятся заново по package.json / requirements.txt.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const cfs = require('./cloud-fs');

const envNum = (k, d, min, max) => { const v = Number(process.env[k]); return Number.isFinite(v) && v >= min ? Math.min(max, Math.floor(v)) : d; };
// без ZIP64: архив и каждый файл меньше 4 ГБ, файлов меньше 65 535
const MAX_BYTES = envNum('CLOUD_ZIP_MAX_MB', 1024, 1, 3500) * 1048576;
const MAX_FILES = 20000, SCAN_MAX = 100000, DEPTH_MAX = 40;
const SKIP = new Set(['node_modules', '__pycache__', 'venv', '.venv', 'site-packages', 'bower_components', '.cache', '.npm', '.premier']);
const mbs = (n) => (n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' КБ' : (n / 1048576).toFixed(1).replace(/\.0$/, '') + ' МБ');

// Список файлов папки. Ссылки (symlink), устройства и папки зависимостей пропускаем.
// В корне домашней папки пропускаем и скрытое (.bashrc, .config, .local) — это настройки компьютера, а не проект.
// Обход идёт от открытой папки (cloud-fs.js): подмена папки ссылкой во время обхода не уводит на файлы сервера.
// collect(home, parts, { top }) — папка home/parts…; collect(root, { top }) — папка root целиком.
async function collect(home, a, b) {
  const parts = Array.isArray(a) ? a : [], { top = false } = (Array.isArray(a) ? b : a) || {};
  const files = []; let bytes = 0;
  const fail = (text) => Object.assign(new Error(text), { status: 413 });
  let r;
  try {
    r = await cfs.walk(home, parts, {
      maxEntries: SCAN_MAX, maxDepth: DEPTH_MAX, tooMany: 'В папке слишком много файлов — скачайте её по частям',
      skip: (name, depth) => SKIP.has(name) || (top && depth === 0 && name.startsWith('.')),
      onFile: async ({ rel, name, dir }) => { // асинхронно: большая папка не останавливает остальные запросы сервера
        const st = await cfs.lstatA(dir, name);
        if (!st || !st.isFile()) return;
        if (st.size >= 0xffffffff) throw fail(`Файл ${rel} слишком большой для архива — скачайте его отдельно`);
        files.push({ rel, size: st.size }); bytes += st.size;
        if (files.length > MAX_FILES) throw fail(`В папке больше ${MAX_FILES} файлов — скачайте её по частям`);
        if (bytes > MAX_BYTES) throw fail(`Папка больше ${mbs(MAX_BYTES)} — скачайте её по частям`);
      },
    });
  } catch (e) { if (e.status) throw e; return { files: [], bytes: 0, skipped: 0 }; } // папки нет или она стала ссылкой
  return { files, bytes, skipped: r.skipped };
}

const dosTime = (ms) => {
  const d = new Date(ms || Date.now()), y = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
};

// Пишет архив в out (ответ сервера). open(rel) → { fd, size, mtime } или null: файл открывает вызывающий — он же
// проверяет, что файл по-прежнему внутри домашней папки (его могли подменить ссылкой, пока шёл архив).
// prefix — имя папки внутри архива. Возвращает { files, bytes } — сколько файлов и байтов архива записано.
// limit — предел исходного размера всех файлов: файл мог вырасти после подсчёта (идёт сборка, пишется журнал) —
// тогда архив обрывается с ошибкой, а не растёт без предела.
async function write(out, list, open, prefix = '', limit = MAX_BYTES + 16 * 1048576) {
  const central = []; let offset = 0, stopped = false, abort = null, total = 0;
  const grown = () => Object.assign(new Error('папка выросла, пока готовился архив'), { status: 413 });
  // получатель закрыл соединение — бросаем текущий файл и выходим, иначе ожидание «drain» не закончится никогда
  const onClose = () => { stopped = true; if (abort) abort(); };
  out.on('close', onClose);
  const drained = () => new Promise((ok) => { const done = () => { out.off('drain', done); out.off('close', done); ok(); }; out.once('drain', done); out.once('close', done); });
  const put = async (buf) => { offset += buf.length; if (stopped || out.destroyed) return; if (!out.write(buf)) await drained(); };
  for (const f of list) {
    if (stopped) break;
    const o = open(f.rel); if (!o) continue;
    if (stopped) { fs.close(o.fd, () => {}); break; }
    const name = Buffer.from((prefix ? prefix + '/' : '') + f.rel, 'utf8'), { time, date } = dosTime(o.mtime), at = offset;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0808, 6); // размеры и CRC — после данных; имена в UTF-8
    head.writeUInt16LE(8, 8); head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12); head.writeUInt16LE(name.length, 26);
    await put(head); await put(name);
    let crc = 0, usize = 0, csize = 0;
    await new Promise((ok, fail) => {
      const rs = fs.createReadStream(null, { fd: o.fd, autoClose: true }), df = zlib.createDeflateRaw({ level: 6 });
      const end = (e) => { abort = null; rs.destroy(); df.destroy(); e ? fail(e) : ok(); };
      abort = () => end();
      rs.on('data', (b) => { crc = zlib.crc32(b, crc); usize += b.length; total += b.length; if (total > limit || usize >= 0xffffffff) end(grown()); });
      rs.on('error', end); df.on('error', end);
      df.on('data', (b) => { csize += b.length; offset += b.length; if (stopped || out.destroyed) return end(); if (!out.write(b)) { df.pause(); drained().then(() => df.resume()); } });
      df.on('end', () => end());
      rs.pipe(df);
    });
    if (stopped) break;
    if (csize >= 0xffffffff || offset >= 0xffffffff) throw new Error('архив больше 4 ГБ');
    const dd = Buffer.alloc(16);
    dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc >>> 0, 4); dd.writeUInt32LE(csize, 8); dd.writeUInt32LE(usize, 12);
    await put(dd);
    central.push({ name, time, date, crc: crc >>> 0, csize, usize, at, mode: (o.mode || 0o100644) & 0xffff });
  }
  const start = offset;
  for (const c of central) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(0x0314, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0808, 8); h.writeUInt16LE(8, 10);
    h.writeUInt16LE(c.time, 12); h.writeUInt16LE(c.date, 14); h.writeUInt32LE(c.crc, 16); h.writeUInt32LE(c.csize, 20); h.writeUInt32LE(c.usize, 24);
    h.writeUInt16LE(c.name.length, 28); h.writeUInt32LE((c.mode << 16) >>> 0, 38); h.writeUInt32LE(c.at, 42);
    await put(h); await put(c.name);
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(central.length, 8); eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(offset - start, 12); eocd.writeUInt32LE(start, 16);
  await put(eocd);
  out.off('close', onClose);
  return { files: central.length, bytes: offset, stopped };
}

module.exports = { collect, write, MAX_BYTES, MAX_FILES, SKIP, mbs };
