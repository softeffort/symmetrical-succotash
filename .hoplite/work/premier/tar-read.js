'use strict';
// Разбор tar-архива с результатами Python (этап 3, CLD-06).
// Архив собирает программа tar внутри контейнера, но в него попадают файлы пользователя, а сам поток идёт из
// контейнера, где работает чужой код. Поэтому архиву не верим:
//   - поле размера — только восьмеричные цифры (никаких «-1», двоичной записи и мусора);
//   - у каждого заголовка сверяется контрольная сумма;
//   - смещение обязано расти, число записей ограничено;
//   - разбор идёт в отдельном потоке с пределом времени: что бы ни было в архиве, главный поток сервера не замирает.
// parse(buf) — сам разбор (без побочных действий); read(buf) — то же в отдельном потоке.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const ENTRIES_MAX = 5000;   // записей в архиве (файлов показываем не больше FILES_MAX)
const FILES_MAX = 200;
const NAME_MAX = 4096;      // длина длинного имени (запись GNU 'L')
const META_MAX = 400000;    // stdout/stderr/rc — служебные записи
const READ_MS = Math.max(1000, Number(process.env.CODE_UNTAR_MS) || 15000);

const bad = (error) => ({ files: [], meta: {}, ok: false, error });

// восьмеричное число из поля заголовка; null — в поле что-то другое
function octal(buf, a, b) {
  let i = a, v = 0, n = 0;
  while (i < b && (buf[i] === 0x20 || buf[i] === 0x30)) { if (buf[i] === 0x30) n++; i++; } // ведущие пробелы и нули
  for (; i < b && buf[i] >= 0x30 && buf[i] <= 0x37; i++) { v = v * 8 + (buf[i] - 0x30); n++; if (v > Number.MAX_SAFE_INTEGER) return null; }
  for (; i < b; i++) if (buf[i] !== 0 && buf[i] !== 0x20) return null; // после числа — только пробелы и нули
  return n ? v : null;
}
function sumOk(buf, off) {
  const want = octal(buf, off + 148, off + 156); if (want == null) return false;
  let u = 0, s = 0;
  for (let i = 0; i < 512; i++) { const c = i >= 148 && i < 156 ? 0x20 : buf[off + i]; u += c; s += c > 127 ? c - 256 : c; }
  return want === u || want === s; // старые tar считают байты знаковыми
}

function parse(buf, { entries = ENTRIES_MAX, files: filesMax = FILES_MAX } = {}) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
  const files = [], meta = {}; let off = 0, longName = null, ok = false, count = 0;
  const str = (a, b) => { let e = a; while (e < b && buf[e] !== 0) e++; return buf.toString('utf8', a, e); };
  while (off + 512 <= buf.length) {
    if (buf[off] === 0 && buf.subarray(off, off + 512).every((x) => x === 0)) { ok = true; break; }
    if (++count > entries) return bad('в архиве слишком много записей');
    if (!sumOk(buf, off)) return bad('повреждён заголовок архива');
    const size = octal(buf, off + 124, off + 136);
    if (size == null) return bad('неверный размер записи в архиве');
    const type = String.fromCharCode(buf[off + 156] || 48);
    const start = off + 512, end = start + size;
    if (end > buf.length) break; // архив оборван — берём то, что успели разобрать, но целым его не считаем
    let name = longName || ((str(off + 345, off + 500) ? str(off + 345, off + 500) + '/' : '') + str(off, off + 100)); longName = null;
    if (type === 'L') {
      if (size > NAME_MAX) return bad('слишком длинное имя в архиве');
      longName = buf.toString('utf8', start, end).replace(/\0+$/, '');
    } else if (type === '0' || type === '\0' || type === '7') {
      name = name.replace(/^\.\//, '');
      if (/^(stdout|stderr|rc)$/.test(name)) { if (size > META_MAX) return bad('служебная запись архива слишком велика'); meta[name] = buf.toString('utf8', start, end); }
      else if (name.startsWith('out/') && !name.split('/').some((x) => x === '..' || x.startsWith('.')) && files.length < filesMax) files.push({ rel: name.slice(4), size, data: Buffer.from(buf.subarray(start, end)) });
    }
    const next = start + Math.ceil(size / 512) * 512;
    if (!(next > off)) return bad('архив не продвигается'); // на случай ошибки в расчётах: разбор не зацикливается
    off = next;
  }
  if (!ok && off >= buf.length && buf.length) ok = true; // архив без завершающих нулей
  return { files, meta, ok: ok && 'rc' in meta };
}

// тот же разбор в отдельном потоке; при зависании или ошибке — { ok: false }
function read(buf, { timeout = READ_MS, file = __filename } = {}) {
  return new Promise((done) => {
    let w, t, fin = false;
    const end = (r) => { if (fin) return; fin = true; clearTimeout(t); if (w) w.terminate().catch(() => {}); done(r); };
    try { w = new Worker(file, { workerData: { tarRead: true }, resourceLimits: { maxOldGenerationSizeMb: 256 } }); } catch (e) { return done(bad('не удалось запустить разбор архива: ' + e.message)); }
    t = setTimeout(() => end(bad('разбор архива занял слишком много времени')), timeout);
    w.once('message', (r) => end({ ...r, files: (r.files || []).map((f) => ({ ...f, data: Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength) })) }));
    w.once('error', (e) => end(bad('сбой разбора архива: ' + e.message)));
    w.once('exit', () => end(bad('разбор архива прерван')));
    // копия, а не передача владения: исходный буфер может лежать в общем пуле Node
    w.postMessage(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  });
}

if (!isMainThread && workerData && workerData.tarRead) {
  parentPort.once('message', (u8) => {
    let r; try { r = parse(Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength)); } catch (e) { r = bad('сбой разбора архива: ' + e.message); }
    const list = r.files.map((f) => ({ rel: f.rel, size: f.size, data: new Uint8Array(f.data) })); // у каждого файла свой буфер — его и отдаём
    parentPort.postMessage({ ...r, files: list }, list.map((f) => f.data.buffer));
  });
}

module.exports = { parse, read, octal, ENTRIES_MAX, FILES_MAX, READ_MS };
