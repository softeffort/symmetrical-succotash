'use strict';
// Web Push без сторонних библиотек: подпись VAPID (ES256, RFC 8292) и шифрование aes128gcm (RFC 8291/8188).
// Ключи берутся из VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, иначе создаются один раз и хранятся в базе.
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => Buffer.from(String(s || ''), 'base64url');
// куда сервер готов отправлять запросы: только настоящие push-сервисы браузеров (защита от SSRF)
const HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', '.push.apple.com', '.notify.windows.com'];

function genKeys() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const j = privateKey.export({ format: 'jwk' });
  return { pub: b64u(Buffer.concat([Buffer.from([4]), unb64u(j.x), unb64u(j.y)])), priv: j.d };
}

// шифрование сообщения для подписки браузера (ua — ключ p256dh, auth — секрет подписки)
function encrypt(p256dh, auth, payload) {
  const ua = unb64u(p256dh), sec = unb64u(auth);
  const ecdh = crypto.createECDH('prime256v1'); const asPub = ecdh.generateKeys();
  const shared = ecdh.computeSecret(ua), salt = crypto.randomBytes(16);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, sec, Buffer.concat([Buffer.from('WebPush: info\0'), ua, asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = 65;
  return Buffer.concat([head, asPub, body]);
}

function post(endpoint, headers, body) {
  return new Promise((resolve) => {
    const u = new URL(endpoint), mod = u.protocol === 'http:' ? http : https;
    const r = mod.request(u, { method: 'POST', headers: { ...headers, 'Content-Length': body.length }, timeout: 10000 }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); res.on('error', () => resolve(0)); });
    r.on('timeout', () => r.destroy(new Error('timeout'))); r.on('error', () => resolve(0)); r.end(body);
  });
}

function createPush({ store, subject }) {
  store.db.exec('CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, uid TEXT NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS push_subs_uid ON push_subs (uid);');
  const q = (s) => store.db.prepare(s);
  const extraHosts = () => String(process.env.PUSH_HOSTS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  let V = null;
  function vapid() {
    if (V) return V;
    let pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
    if (!(pub && priv)) { let k = store.kv.get('vapid', null); if (!(k && k.pub && k.priv)) { k = genKeys(); store.kv.set('vapid', k); } ({ pub, priv } = k); }
    const P = unb64u(pub);
    const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: priv, x: b64u(P.subarray(1, 33)), y: b64u(P.subarray(33, 65)) }, format: 'jwk' });
    return (V = { pub, key });
  }
  function jwt(aud) {
    const h = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const p = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: (subject && subject()) || 'mailto:support@example.com' }));
    return h + '.' + p + '.' + b64u(crypto.sign('sha256', Buffer.from(h + '.' + p), { key: vapid().key, dsaEncoding: 'ieee-p1363' }));
  }
  function hostOk(u) {
    const h = u.hostname.toLowerCase(), extra = extraHosts();
    if (extra.includes(h)) return u.protocol === 'https:' || process.env.PUSH_ALLOW_HTTP === '1';
    return u.protocol === 'https:' && HOSTS.some((x) => (x.startsWith('.') ? h.endsWith(x) : h === x));
  }
  // проверка подписки из браузера: адрес push-сервиса и ключи правильной длины
  function clean(sub) {
    if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 1000 || !sub.keys) return null;
    let u; try { u = new URL(sub.endpoint); } catch { return null; }
    if (!hostOk(u)) return null;
    const k = unb64u(sub.keys.p256dh), a = unb64u(sub.keys.auth);
    if (k.length !== 65 || k[0] !== 4 || a.length !== 16) return null;
    return { endpoint: u.href, keys: { p256dh: b64u(k), auth: b64u(a) } };
  }
  function subscribe(uid, sub, ua, lang) {
    const s = clean(sub); if (!s) return false;
    q('INSERT OR REPLACE INTO push_subs (endpoint, uid, data, at) VALUES (?, ?, ?, ?)').run(s.endpoint, String(uid), JSON.stringify({ ...s, ua: String(ua || '').slice(0, 200), lang: lang === 'en' ? 'en' : 'ru' }), Date.now());
    const old = q('SELECT endpoint FROM push_subs WHERE uid = ? ORDER BY at DESC').all(String(uid)).slice(10); // не больше 10 устройств
    for (const o of old) q('DELETE FROM push_subs WHERE endpoint = ?').run(o.endpoint);
    return true;
  }
  const unsubscribe = (uid, endpoint) => q('DELETE FROM push_subs WHERE uid = ? AND endpoint = ?').run(String(uid), String(endpoint || '')).changes > 0;
  const removeUser = (uid) => q('DELETE FROM push_subs WHERE uid = ?').run(String(uid));
  const subsOf = (uid) => q('SELECT endpoint, data FROM push_subs WHERE uid = ?').all(String(uid)).map((r) => JSON.parse(r.data));
  const count = (uid) => q('SELECT count(*) n FROM push_subs WHERE uid = ?').get(String(uid)).n;
  const uids = () => q('SELECT DISTINCT uid FROM push_subs').all().map((r) => r.uid);
  const stats = () => ({ subs: q('SELECT count(*) n FROM push_subs').get().n, users: q('SELECT count(DISTINCT uid) n FROM push_subs').get().n });

  // одно сообщение на одну подписку; 404/410 — подписка больше не действует и удаляется
  // msg — { title, body, url } или по языкам: { ru: { title, body }, en: { title, body }, url }
  async function sendOne(s, m0) {
    const msg = m0.ru ? { ...m0, ...(m0[s.lang] || m0.ru) } : m0;
    const payload = JSON.stringify({ title: String(msg.title || 'Premier').slice(0, 120), body: String(msg.body || '').slice(0, 500), url: String(msg.url || '/chat').slice(0, 300), tag: msg.tag ? String(msg.tag).slice(0, 60) : undefined });
    const u = new URL(s.endpoint), body = encrypt(s.keys.p256dh, s.keys.auth, payload);
    const st = await post(s.endpoint, { TTL: String(msg.ttl || 86400), Urgency: msg.urgency || 'normal', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: `vapid t=${jwt(u.origin)}, k=${vapid().pub}` }, body);
    if (st === 404 || st === 410) { q('DELETE FROM push_subs WHERE endpoint = ?').run(s.endpoint); return 'gone'; }
    return st >= 200 && st < 300 ? 'ok' : 'fail';
  }
  async function sendTo(uid, msg) {
    const r = { sent: 0, failed: 0, removed: 0 };
    for (const s of subsOf(uid)) { const x = await sendOne(s, msg).catch(() => 'fail'); if (x === 'ok') r.sent++; else if (x === 'gone') r.removed++; else r.failed++; }
    return r;
  }
  // рассылка: filter(uid) решает, кому отправлять; по 10 пользователей параллельно
  async function broadcast(msg, filter = () => true) {
    const list = uids().filter((id) => { try { return filter(id); } catch { return false; } });
    const tot = { users: list.length, sent: 0, failed: 0, removed: 0 };
    for (let i = 0; i < list.length; i += 10) {
      const part = await Promise.all(list.slice(i, i + 10).map((id) => sendTo(id, msg)));
      for (const r of part) { tot.sent += r.sent; tot.failed += r.failed; tot.removed += r.removed; }
    }
    return tot;
  }
  return { publicKey: () => vapid().pub, subscribe, unsubscribe, removeUser, subsOf, count, uids, stats, sendTo, broadcast, clean };
}

module.exports = { createPush, encrypt, genKeys, b64u, unb64u };
