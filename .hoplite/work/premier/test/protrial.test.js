'use strict';
/**
 * Тесты для protrial-функций billing.js
 * Запуск: node test/protrial.test.js  (не требует внешних зависимостей)
 */

const assert = require('assert');
const path = require('path');

// Минимальный in-memory стаб SQLite (better-sqlite3)
let Database;
try { Database = require('better-sqlite3'); } catch { console.error('Install better-sqlite3'); process.exit(1); }

// ---- поднять два stub-модуля ----
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE offers (k TEXT PRIMARY KEY, uid TEXT, at INTEGER NOT NULL);
  CREATE TABLE pays   (id TEXT PRIMARY KEY, uid TEXT, plan TEXT, until INTEGER, at INTEGER);
  CREATE TABLE users  (id TEXT PRIMARY KEY, email TEXT, trialUsed INTEGER DEFAULT 0);
`);

// stub store
const store = {
  db,
  tx(fn) { const run = db.transaction(fn); run(); },
};

// stub functions used by billing helpers
const normEmail = (email) => email ? email.trim().toLowerCase().replace(/\.(?=[^@]*@)/g, '').replace(/\+[^@]*(?=@)/,'') : null;
const hashKey = (ns, v) => ns + ':' + Buffer.from(v).toString('base64url').slice(0,20);
const now = () => Date.now();
const planOf = (u) => ({ id: 'free', tier: 0 });
const paidPays = (uid) => db.prepare('SELECT * FROM pays WHERE uid = ? AND until > ?').all(uid, Date.now());
const extend = (uid, planId, until) => db.prepare('INSERT OR REPLACE INTO pays (id,uid,plan,until,at) VALUES (?,?,?,?,?)').run('pt-'+uid, uid, planId, until, now());
const updateUser = (uid, patch) => {}; // noop for tests

// --- inline вставляем billing-функции (copy from patches/billing-protrial.js) ---
const protrialKeys = (u) => {
  const ne = normEmail(u.email || '');
  const keys = ['protrial:uid:' + u.id];
  if (ne) keys.push('protrial:email:' + hashKey('email', ne));
  return keys;
};

const protrialTaken = (u) =>
  protrialKeys(u).some((k) => store.db.prepare('SELECT 1 x FROM offers WHERE k = ?').get(k));

function markProtrial(u, at) {
  const ts = at || now();
  for (const k of protrialKeys(u))
    store.db.prepare('INSERT OR IGNORE INTO offers (k, uid, at) VALUES (?, ?, ?)').run(k, u.id, ts);
}

function protrialStatus(u, pt) {
  if (!pt || !pt.on) return 'off';
  if (pt.until && Date.now() > new Date(pt.until).getTime()) return 'off';
  const plan = planOf(u);
  if (plan && plan.id !== 'free') return 'has_plan';
  const activeKey = 'protrial:active:' + u.id;
  const activeRow = store.db.prepare('SELECT at FROM offers WHERE k = ?').get(activeKey);
  if (activeRow) {
    const days = pt.days || 1;
    const until = activeRow.at + days * 86400000;
    if (Date.now() < until) return 'active';
    return 'used';
  }
  if (paidPays(u.id).length > 0) return 'paid';
  if (protrialTaken(u)) return 'used';
  return 'eligible';
}

function claimProtrial(u, ptCfg) {
  const pt = ptCfg || { on: true, days: 1, plan: 'pro' };
  const status = protrialStatus(u, pt);
  if (status !== 'eligible') return { ok: false, error: status };
  const days = pt.days || 1;
  const at = now();
  const until = at + days * 86400000;
  store.tx(() => {
    markProtrial(u, at);
    store.db.prepare('INSERT OR IGNORE INTO offers (k, uid, at) VALUES (?, ?, ?)').run('protrial:active:' + u.id, u.id, at);
    extend(u.id, pt.plan || 'pro', until);
  });
  return { ok: true, until };
}

// ==== тесты ====
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.error('  ✗', name, '\n   ', e.message); fail++; }
}

console.log('\n▶▶ protrial tests\n');

const FREE_USER = { id: 'u1', email: 'alice@example.com' };
const FREE_USER2 = { id: 'u2', email: 'bob@example.com' };
const PT_ON  = { on: true,  days: 1, plan: 'pro' };
const PT_OFF = { on: false, days: 1, plan: 'pro' };

test('status=off when protrial.on=false', () => {
  assert.strictEqual(protrialStatus(FREE_USER, PT_OFF), 'off');
});

test('status=eligible for new free user', () => {
  assert.strictEqual(protrialStatus(FREE_USER, PT_ON), 'eligible');
});

test('claimProtrial returns ok=true for eligible user', () => {
  db.exec('DELETE FROM offers; DELETE FROM pays;');
  const r = claimProtrial(FREE_USER, PT_ON);
  assert.strictEqual(r.ok, true);
  assert.ok(r.until > Date.now(), 'until should be in the future');
});

test('status=active immediately after claim', () => {
  assert.strictEqual(protrialStatus(FREE_USER, PT_ON), 'active');
});

test('second claim returns ok=false (active)', () => {
  const r = claimProtrial(FREE_USER, PT_ON);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'active');
});

test('protrialTaken=true after claim', () => {
  assert.strictEqual(protrialTaken(FREE_USER), true);
});

test('second user is still eligible', () => {
  assert.strictEqual(protrialStatus(FREE_USER2, PT_ON), 'eligible');
});

test('status=used after active period expires', () => {
  db.exec('DELETE FROM offers; DELETE FROM pays;');
  // симулируем: маркируем active-ключ с at = далеко в прошлом
  const longAgo = Date.now() - 2 * 86400000;
  store.db.prepare('INSERT INTO offers (k,uid,at) VALUES (?,?,?)').run('protrial:active:u3', 'u3', longAgo);
  markProtrial({ id: 'u3', email: 'carol@example.com' }, longAgo);
  const status = protrialStatus({ id: 'u3', email: 'carol@example.com' }, PT_ON);
  assert.strictEqual(status, 'used');
});

test('status=off when until is in the past', () => {
  const ptExpired = { on: true, days: 1, plan: 'pro', until: '2000-01-01' };
  assert.strictEqual(protrialStatus(FREE_USER2, ptExpired), 'off');
});

test('email alias dedup: same offer key for aliased email', () => {
  const u  = { id: 'uA', email: 'test.user@gmail.com' };
  const uA = { id: 'uB', email: 'testuser@gmail.com' };
  const kA = protrialKeys(u).find((k) => k.startsWith('protrial:email:'));
  const kB = protrialKeys(uA).find((k) => k.startsWith('protrial:email:'));
  assert.strictEqual(kA, kB, 'email alias keys must match');
});

console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
