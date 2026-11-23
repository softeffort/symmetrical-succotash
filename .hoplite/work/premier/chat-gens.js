'use strict';
// Готовые ответы чата на диске. Человек отправил запрос и ушёл (закрыл вкладку, свернул приложение, пропала связь) —
// ответ всё равно дописывается на сервере и ждёт его здесь: клиент дочитывает его через /api/chat/resume
// даже через несколько часов и после перезапуска сервера. Формат файла — заголовок и те же строки NDJSON, что шли в поток.
const fs = require('fs'), path = require('path');

const ROOT = path.join(__dirname, 'data', 'gens');
const hours = Number(process.env.CHAT_GEN_KEEP_HOURS);
const KEEP_MS = (Number.isFinite(hours) && hours >= 1 ? Math.min(720, hours) : 24) * 3600e3; // сколько ждём возвращения человека
const MAX_CHARS = 64e6; // больше не пишем: такой ответ дочитывается только пока он в памяти сервера

const safe = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
const dirOf = (uid) => path.join(ROOT, safe(uid));
const fileOf = (uid, gid) => path.join(dirOf(uid), safe(gid) + '.ndjson');

// lines — строки потока, каждая с '\n' на конце; cut — номер строки с ошибкой переполнения буфера (если была)
function save(uid, gid, lines, cut = null) {
  if (!uid || !gid || !Array.isArray(lines) || !lines.length) return Promise.resolve(false);
  let size = 0; for (const s of lines) size += s.length;
  if (size > MAX_CHARS) return Promise.resolve(false);
  const file = fileOf(uid, gid), tmp = file + '.' + process.pid + '.' + Date.now().toString(36) + '.tmp';
  const body = JSON.stringify({ gen: 1, uid: String(uid), at: Date.now(), lines: lines.length, ...(Number.isInteger(cut) ? { cut } : {}) }) + '\n' + lines.join('');
  return fs.promises.mkdir(path.dirname(file), { recursive: true })
    .then(() => fs.promises.writeFile(tmp, body, { mode: 0o600 }))
    .then(() => fs.promises.rename(tmp, file))
    .then(() => true, () => { fs.promises.unlink(tmp).catch(() => {}); return false; });
}

// строки ответа или null (нет файла, чужой, устарел, повреждён)
function load(uid, gid) {
  if (!uid || !gid) return null;
  let raw;
  try {
    const file = fileOf(uid, gid), st = fs.statSync(file);
    if (Date.now() - st.mtimeMs > KEEP_MS) { fs.unlink(file, () => {}); return null; }
    raw = fs.readFileSync(file, 'utf8');
  } catch { return null; }
  const nl = raw.indexOf('\n'); if (nl < 0) return null;
  let head; try { head = JSON.parse(raw.slice(0, nl)); } catch { return null; }
  if (!head || head.gen !== 1 || head.uid !== String(uid)) return null; // имя папки — упрощённый id; сверяем настоящий
  const out = raw.slice(nl + 1).split('\n'); if (out[out.length - 1] === '') out.pop();
  const lines = out.map((s) => s + '\n');
  if (Number.isInteger(head.cut)) Object.defineProperty(lines, 'cut', { value: head.cut }); // ответ не поместился в буфер: в этой строке — ошибка, дальше текста нет
  return lines;
}

function drop(uid, gid) { if (uid && gid) fs.unlink(fileOf(uid, gid), () => {}); }
function removeUser(uid) { if (uid) fs.rm(dirOf(uid), { recursive: true, force: true }, () => {}); }

// уборка: ответы старше срока хранения и пустые папки
function sweep(now = Date.now()) {
  let users = []; try { users = fs.readdirSync(ROOT); } catch { return 0; }
  let gone = 0;
  for (const u of users) {
    const dir = path.join(ROOT, u); let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    let left = names.length;
    for (const n of names) {
      const f = path.join(dir, n);
      try { if (now - fs.statSync(f).mtimeMs > KEEP_MS) { fs.unlinkSync(f); gone++; left--; } } catch {}
    }
    if (!left) { try { fs.rmdirSync(dir); } catch {} }
  }
  return gone;
}
setTimeout(() => { try { sweep(); } catch {} }, 30000).unref();
setInterval(() => { try { sweep(); } catch {} }, 3600e3).unref();

module.exports = { save, load, drop, removeUser, sweep, KEEP_MS, ROOT };
