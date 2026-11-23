// PWA и push-уведомления: шифрование, API подписки, рассылка из Панели, напоминание, файлы PWA и страницы RU/EN
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { copyApp, seed, startServer, rm, ROOT } = require('./helpers');
const { encrypt, b64u } = require('../push');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(50); } return false; };
const hk = (ikm, salt, info, n) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, n));

// расшифровка aes128gcm по RFC 8291 — так делает браузер
function decrypt(buf, ua, auth) {
  const salt = buf.subarray(0, 16), idlen = buf[20], asPub = buf.subarray(21, 21 + idlen), body = buf.subarray(21 + idlen);
  const ikm = hk(ua.computeSecret(asPub), auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32);
  const d = crypto.createDecipheriv('aes-128-gcm', hk(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hk(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  d.setAuthTag(body.subarray(-16));
  const pt = Buffer.concat([d.update(body.subarray(0, -16)), d.final()]);
  let i = pt.length - 1; while (i >= 0 && pt[i] === 0) i--;
  assert.equal(pt[i], 2, 'разделитель последней записи');
  return pt.subarray(0, i).toString('utf8');
}
function device(port, name) {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ua, auth, sub: { endpoint: `http://127.0.0.1:${port}/ep/${name}`, keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) } } };
}
// локальный «пуш-сервис»: /ep/gone отвечает 410, остальные 201
function receiver() {
  const got = [];
  const srv = http.createServer((req, res) => {
    const parts = []; req.on('data', (c) => parts.push(c));
    req.on('end', () => { got.push({ path: req.url, headers: req.headers, body: Buffer.concat(parts) }); res.writeHead(req.url.endsWith('/gone') ? 410 : 201); res.end(); });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ got, port: srv.address().port, close: () => srv.close() })));
}

test('push: шифрование по RFC 8291 расшифровывается как в браузере', () => {
  const d = device(1, 'x');
  const msg = JSON.stringify({ title: 'Привет', body: 'Уведомления работают 👍' });
  const enc = encrypt(d.sub.keys.p256dh, d.sub.keys.auth, msg);
  assert.equal(enc.readUInt32BE(16), 4096);
  assert.equal(decrypt(enc, d.ua, d.auth), msg);
  assert.notDeepEqual(encrypt(d.sub.keys.p256dh, d.sub.keys.auth, msg), enc, 'каждый раз новая соль и ключ');
});

test('push: подписка, проверка, рассылка из Панели, напоминание и удаление по 410', async () => {
  const rc = await receiver();
  const dir = copyApp();
  const now = Date.now();
  seed(dir, {
    users: [
      { id: 'u1u1u1u1u1u1', login: 'anna', email: 'anna@example.com', created: new Date().toISOString() },
      { id: 'u2u2u2u2u2u2', login: 'bob', email: 'bob@example.com', created: new Date().toISOString(), plan: 'pro', until: now + 3 * 3600e3 },
    ],
    sessions: { tok1: 'u1u1u1u1u1u1', tok2: 'u2u2u2u2u2u2' },
  });
  const s = await startServer(dir, { PUSH_HOSTS: '127.0.0.1', PUSH_ALLOW_HTTP: '1', PUSH_REMIND_MS: '300' });
  try {
    assert.equal((await s.req('GET', '/api/push/state')).status, 401);
    assert.equal((await s.req('POST', '/api/push/subscribe', { body: {} })).status, 401);
    const st = await s.req('GET', '/api/push/state', { token: 'tok1' });
    assert.equal(st.status, 200); assert.equal(st.json.on, true); assert.equal(st.json.devices, 0);
    assert.match(st.json.key, /^[A-Za-z0-9_-]{86,88}$/);
    assert.equal(Buffer.from(st.json.key, 'base64url').length, 65, 'VAPID — несжатый ключ P-256');

    const bad = await s.req('POST', '/api/push/subscribe', { token: 'tok1', body: { subscription: { endpoint: 'https://evil.example.com/x', keys: { p256dh: 'a', auth: 'b' } } } });
    assert.equal(bad.status, 400); assert.match(bad.json.error, /не поддерживается/);

    const a = device(rc.port, 'anna');
    const sub = await s.req('POST', '/api/push/subscribe', { token: 'tok1', body: { subscription: a.sub, lang: 'ru' } });
    assert.equal(sub.status, 200); assert.equal(sub.json.devices, 1);

    const t = await s.req('POST', '/api/push/test', { token: 'tok1', body: {} });
    assert.equal(t.status, 200); assert.equal(t.json.sent, 1);
    assert.ok(await waitFor(() => rc.got.some((g) => g.path === '/ep/anna')));
    const hit = rc.got.find((g) => g.path === '/ep/anna');
    assert.match(hit.headers.authorization, /^vapid t=.+, k=.+/);
    assert.equal(hit.headers['content-encoding'], 'aes128gcm');
    assert.ok(+hit.headers.ttl > 0);
    const m1 = JSON.parse(decrypt(hit.body, a.ua, a.auth));
    assert.equal(m1.body, 'Уведомления работают 👍'); assert.equal(m1.tag, 'test');
    const again = await s.req('POST', '/api/push/test', { token: 'tok1', body: {} });
    assert.equal(again.status, 429); assert.match(again.json.error, /полминуты/);

    // напоминание: у bob тариф Pro заканчивается через 3 часа, устройство на английском
    const b = device(rc.port, 'bob');
    assert.equal((await s.req('POST', '/api/push/subscribe', { token: 'tok2', body: { subscription: b.sub, lang: 'en' } })).status, 200);
    assert.ok(await waitFor(() => rc.got.some((g) => g.path === '/ep/bob')), 'напоминание не пришло\n' + s.log);
    const m2 = JSON.parse(decrypt(rc.got.find((g) => g.path === '/ep/bob').body, b.ua, b.auth));
    assert.equal(m2.title, 'Your plan ends tomorrow'); assert.equal(m2.tag, 'plan-end'); assert.match(m2.body, /Pro/);
    await sleep(1000);
    assert.equal(rc.got.filter((g) => g.path === '/ep/bob').length, 1, 'напоминание — один раз на срок');

    // Панель
    const tok = (await s.req('POST', '/api/admin/login', { body: { password: 'Test-Admin-Pass-2026' } })).json.token;
    const H = { Authorization: 'Bearer ' + tok };
    assert.equal((await s.req('GET', '/api/admin/push')).status, 401);
    const g = await s.req('GET', '/api/admin/push', { headers: H });
    assert.equal(g.status, 200); assert.deepEqual([g.json.subs, g.json.users, g.json.off, g.json.canSend], [2, 2, false, true]);
    for (const body of [{ title: '', to: 'all' }, { title: 'x'.repeat(121), to: 'all' }, { title: 'А', body: 'x'.repeat(501), to: 'all' }, { title: 'А', url: '//evil.com', to: 'all' }, { title: 'А', url: 'javascript:alert(1)', to: 'all' }, { title: 'А', to: 'vip' }]) {
      assert.equal((await s.req('POST', '/api/admin/push', { headers: H, body })).status, 400, JSON.stringify(body));
    }
    const free = await s.req('POST', '/api/admin/push', { headers: H, body: { title: 'Новая модель', body: 'Уже в чате', url: '/chat', to: 'free' } });
    assert.equal(free.status, 200); assert.equal(free.json.sent, 1, 'free — только anna');
    assert.ok(await waitFor(() => rc.got.filter((x) => x.path === '/ep/anna').length === 2));
    const m3 = JSON.parse(decrypt(rc.got.filter((x) => x.path === '/ep/anna')[1].body, a.ua, a.auth));
    assert.equal(m3.title, 'Новая модель'); assert.equal(m3.tag, 'news'); assert.equal(m3.url, '/chat');
    assert.equal((await s.req('POST', '/api/admin/push', { headers: H, body: { title: 'Для Pro', to: 'paid' } })).json.sent, 1, 'paid — только bob');

    // устаревшая подписка (410) удаляется при рассылке
    const gone = device(rc.port, 'gone');
    assert.equal((await s.req('POST', '/api/push/subscribe', { token: 'tok1', body: { subscription: gone.sub } })).json.devices, 2);
    const all = await s.req('POST', '/api/admin/push', { headers: H, body: { title: 'Всем', to: 'all' } });
    assert.equal(all.json.removed, 1); assert.equal(all.json.sent, 2);
    assert.equal((await s.req('GET', '/api/push/state', { token: 'tok1' })).json.devices, 1);
    const audit = s.log + JSON.stringify((await s.req('GET', '/api/admin/audit', { headers: H })).json || {});
    assert.match(audit, /Push-рассылка/);

    const un = await s.req('POST', '/api/push/unsubscribe', { token: 'tok1', body: { endpoint: a.sub.endpoint } });
    assert.equal(un.status, 200); assert.equal(un.json.devices, 0);
  } finally { await s.stop(); rc.close(); rm(dir); }
});

test('push: PUSH_OFF, файлы PWA и страницы RU/EN', async () => {
  const dir = copyApp();
  seed(dir, { users: [{ id: 'u1u1u1u1u1u1', login: 'anna', email: 'anna@example.com', created: new Date().toISOString() }], sessions: { tok1: 'u1u1u1u1u1u1' } });
  const s = await startServer(dir, { PUSH_OFF: '1' });
  try {
    const st = await s.req('GET', '/api/push/state', { token: 'tok1' });
    assert.equal(st.json.on, false); assert.equal(st.json.key, '');
    const d = device(1, 'x');
    assert.equal((await s.req('POST', '/api/push/subscribe', { token: 'tok1', body: { subscription: d.sub } })).status, 403);
    assert.equal((await s.req('POST', '/api/push/test', { token: 'tok1', body: {} })).status, 403);
    const tok = (await s.req('POST', '/api/admin/login', { body: { password: 'Test-Admin-Pass-2026' } })).json.token;
    const H = { Authorization: 'Bearer ' + tok };
    assert.equal((await s.req('GET', '/api/admin/push', { headers: H })).json.off, true);
    assert.equal((await s.req('POST', '/api/admin/push', { headers: H, body: { title: 'А', to: 'all' } })).status, 403);

    const man = await s.req('GET', '/manifest.webmanifest');
    assert.equal(man.status, 200); assert.match(man.headers.get('content-type'), /application\/manifest\+json/);
    const mj = JSON.parse(man.text);
    assert.equal(mj.start_url, '/chat'); assert.equal(mj.display, 'standalone');
    for (const ic of mj.icons) assert.equal((await s.req('GET', ic.src)).status, 200, ic.src);
    const men = JSON.parse((await s.req('GET', '/manifest-en.webmanifest')).text);
    assert.equal(men.lang, 'en'); assert.equal(men.id, mj.id);
    const sw = await s.req('GET', '/sw.js');
    assert.equal(sw.status, 200); assert.match(sw.headers.get('content-type'), /javascript/); assert.match(sw.headers.get('cache-control'), /no-cache/);
    assert.match(sw.text, /addEventListener\('push'/); assert.match(sw.text, /notificationclick/);
    assert.equal((await s.req('GET', '/offline.html')).status, 200);
    assert.equal((await s.req('GET', '/icons/apple-touch-icon.png')).status, 200);
    assert.equal((await s.req('GET', '/js/16-pwa.js')).status, 200);

    for (const [u, en] of [['/', false], ['/?lang=en', true], ['/chat', false], ['/chat?lang=en', true]]) {
      const r = await s.req('GET', u, { token: 'tok1' });
      assert.equal(r.status, 200, u);
      assert.ok(r.text.includes(`<link rel="manifest" href="/manifest${en ? '-en' : ''}.webmanifest">`), u + ' manifest');
      assert.ok(r.text.includes('apple-touch-icon'), u);
      if (u.startsWith('/chat')) assert.ok(r.text.includes('/js/16-pwa.js?v='), u + ' 16-pwa');
    }
    const panel = await s.req('GET', '/panelp');
    assert.ok(panel.text.includes('/admin/v-push.js?v='));
    assert.equal((await s.req('GET', '/admin/v-push.js')).status, 200);
  } finally { await s.stop(); rm(dir); }

  const js = fs.readFileSync(path.join(ROOT, 'public/js/16-pwa.js'), 'utf8');
  for (const k of ['Уведомления', 'Notifications', 'Установите Premier', 'Install Premier', 'beforeinstallprompt', 'PREMIER_PWA_DELAY', 'window.premierPush']) assert.ok(js.includes(k), k);
  for (const f of ['public/js/10-account.js', 'public/en/js/10-account.js']) {
    const a = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(a.includes('window.premierPush.row()') && a.includes('window.premierPush.bind()'), f);
  }
});
