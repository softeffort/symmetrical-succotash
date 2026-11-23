// Сверка старых JSON-архивов с базой (только чтение): node deploy/check-legacy.js [папка data]
// Ищет data/legacy-json-*, сравнивает users.json и payments.json с базой и проверяет, что файлы в chats/, memory/, usage/ читаются.
// Код выхода: 1 — чего-то не хватает или файл не читается, 0 — всё на месте. Данные не меняет (база открывается только на чтение;
// SQLite при этом может сама создать служебные файлы premier.db-wal и -shm — на содержимое они не влияют).
'use strict';
const fs = require('fs'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const DATA = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data')); // как в db.js: data рядом с кодом
const FILE = path.join(DATA, 'premier.db');
const LIMIT = 20;
const list = (a) => a.slice(0, LIMIT).join(', ') + (a.length > LIMIT ? ` … (ещё ${a.length - LIMIT})` : '');
let bad = 0;
const problem = (s) => { bad++; console.log('  ПРОБЛЕМА: ' + s); };

const dirs = fs.existsSync(DATA) ? fs.readdirSync(DATA).filter((n) => /^legacy-json-/.test(n) && fs.statSync(path.join(DATA, n)).isDirectory()).sort() : [];
console.log(`Папка данных: ${DATA}`);
if (!dirs.length) { console.log('Архивов legacy-json-* нет — сверять нечего.'); process.exit(0); }
if (!fs.existsSync(FILE)) { console.log(`Базы ${FILE} нет, а архивы есть — всё из них в базу не попало.`); process.exit(1); }
const db = new DatabaseSync(FILE, { readOnly: true });
const ids = (sql) => new Set(db.prepare(sql).all().map((r) => String(r.id)));
const haveUsers = ids('SELECT id FROM users'), havePays = ids('SELECT id FROM payments');

const read = (f) => { try { return { v: JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch (e) { return { err: e.code === 'ENOENT' ? null : e.message }; } };
for (const d of dirs) {
  console.log(`\n${d}:`);
  const base = path.join(DATA, d);
  for (const [name, have, what] of [['users.json', haveUsers, 'пользователей'], ['payments.json', havePays, 'платежей']]) {
    const r = read(path.join(base, name));
    if (r.err === null) { console.log(`  ${name}: файла нет в архиве`); continue; }
    if (r.err) { problem(`${name} не читается: ${r.err}`); continue; }
    if (!Array.isArray(r.v)) { problem(`${name}: ожидается массив`); continue; }
    const withId = r.v.filter((x) => x && x.id != null && x.id !== ''), noId = r.v.length - withId.length;
    const missing = withId.filter((x) => !have.has(String(x.id))).map((x) => String(x.id));
    console.log(`  ${name}: ${what} в архиве ${r.v.length}, в базе нет ${missing.length}${noId ? `, без id (не переносились) ${noId}` : ''}`);
    if (missing.length) problem(`нет в базе — ${list(missing)}${name === 'users.json' ? ' (если аккаунт удалил сам пользователь — это нормально)' : ''}`);
  }
  for (const sub of ['chats', 'memory', 'usage']) {
    let files; try { files = fs.readdirSync(path.join(base, sub)).filter((f) => f.endsWith('.json')); } catch { continue; }
    const broken = files.filter((f) => read(path.join(base, sub, f)).err);
    console.log(`  ${sub}/: файлов ${files.length}, нечитаемых ${broken.length}`);
    if (broken.length) problem(`${sub}/ — не читаются: ${list(broken)}`);
  }
}
db.close();
console.log(bad ? `\nИтог: найдено проблем — ${bad}. Данные из архивов перенесены не полностью.` : '\nИтог: всё из архивов есть в базе, файлы читаются.');
process.exit(bad ? 1 : 0);
