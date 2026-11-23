'use strict';
// Двухфакторная защита пользователей: модуль twofa.js, второй шаг входа после GitHub, Аккаунт → Безопасность,
// сброс из Панели и через admin/cli.js, статика (скрипт аккаунта и шаг «Код подтверждения» на /login).
const test = require('node:test'), assert = require('node:assert/strict'), http = require('http'), path = require('path');
const { spawnSync } = require('child_process');
const { copyApp, seed, startServer, rm } = require('./helpers');
const { hotp, b32dec } = require('../admin/auth');
const at = (secret, t = Date.now()) => hotp(b32dec(secret), Math.floor(t / 30000));

function unit() {
  const assert = require('assert');
  const T = require(process.cwd() + '/twofa'); const { hotp, b32dec } = require(process.cwd() + '/admin/auth');
  const at = (s, t) => hotp(b32dec(s), Math.floor(t / 30000));
  const u = { id: 'u1', login: 'anna', email: 'anna@example.com' };
  const now = Date.now();
  assert.deepStrictEqual(T.status('u1'), { on: false, codesLeft: 0, since: null });
  const s = T.setup(u); assert.match(s.uri, /^otpauth:\/\/totp\/Premier%3Aanna%40example.com\?secret=/);
  assert.throws(() => T.enable(u, '000000', now), /Код не подошёл/);
  assert.ok(!T.isOn('u1'));
  const r = T.enable(u, at(s.secret, now), now); assert.strictEqual(r.codes.length, 10); assert.match(r.codes[0], /^[a-z2-9]{4}-[a-z2-9]{4}$/);
  assert.ok(T.isOn('u1'));
  assert.throws(() => T.setup(u), (e) => e.status === 409);
  assert.strictEqual(T.verify('u1', at(s.secret, now), now), null, 'повтор того же кода');
  assert.strictEqual(T.verify('u1', at(s.secret, now + 30000), now + 30000), 'totp');
  assert.strictEqual(T.verify('u1', r.codes[0].toUpperCase().replace('-', ' '), now), 'backup');
  assert.strictEqual(T.verify('u1', r.codes[0], now), null, 'резервный код — один раз');
  assert.strictEqual(T.status('u1').codesLeft, 9);
  const tk = T.ticket('u1', now); assert.ok(T.pending(tk, now));
  for (let i = 0; i < 4; i++) assert.throws(() => T.redeem(tk, '111111', now), (e) => e.status === 401);
  assert.throws(() => T.redeem(tk, '111111', now), (e) => e.status === 410);
  assert.throws(() => T.redeem(tk, r.codes[1], now), (e) => e.status === 410);
  const tk2 = T.ticket('u1', now); assert.throws(() => T.redeem(tk2, r.codes[1], now + 11 * 60000), (e) => e.status === 410);
  const tk3 = T.ticket('u1', now); assert.deepStrictEqual(T.redeem(tk3, r.codes[1], now), { uid: 'u1', via: 'backup', codesLeft: 8 });
  assert.throws(() => T.redeem(tk3, r.codes[2], now), (e) => e.status === 410, 'билет одноразовый');
  const g = T.regen(u, r.codes[2], now); assert.strictEqual(T.status('u1').codesLeft, 10); assert.strictEqual(T.verify('u1', r.codes[3], now), null);
  assert.throws(() => T.disable(u, '123456', now), /Неверный код/);
  T.disable(u, g.codes[0], now); assert.ok(!T.isOn('u1'));
  T.setup(u); assert.ok(!T.isOn('u1')); assert.strictEqual(T.reset('u1'), 1); assert.strictEqual(T.stats().on, 0);
  // для проверки CLI — снова включаем
  const s2 = T.setup(u); T.enable(u, at(s2.secret, now), now); assert.ok(T.isOn('u1'));
  console.log('UNIT_OK');
}

test('twofa.js: подключение, коды, билеты входа, сброс и CLI', (t) => {
  const dir = copyApp(); seed(dir); t.after(() => rm(dir));
  const r = spawnSync(process.execPath, ['-e', `(${unit})()`], { cwd: dir, encoding: 'utf8' });
  assert.match(r.stdout, /UNIT_OK/, r.stderr);
  const cli = (...a) => spawnSync(process.execPath, ['admin/cli.js', ...a], { cwd: dir, encoding: 'utf8' });
  const c1 = cli('reset-user-2fa', 'anna@example.com'); assert.equal(c1.status, 0, c1.stderr); assert.match(c1.stdout, /2FA у anna выключена/);
  const c2 = cli('reset-user-2fa', 'anna'); assert.equal(c2.status, 0, c2.stderr); assert.match(c2.stdout, /не была включена/);
  const c3 = cli('reset-user-2fa', 'nobody'); assert.equal(c3.status, 1); assert.match(c3.stderr, /Нет такого пользователя/);
});

// поддельный GitHub (как в github.test.js): вход всегда под anna@example.com
function mockGithub() {
  const who = { user: { id: 102, login: 'anna-gh', name: 'Anna' }, emails: [{ email: 'anna@example.com', verified: true, primary: true }] };
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
      const send = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.url === '/login/oauth/access_token' && req.method === 'POST') return send(200, { access_token: 'tok-anna', token_type: 'bearer' });
      if ((req.headers.authorization || '') !== 'Bearer tok-anna') return send(401, {});
      if (req.url === '/user') return send(200, who.user);
      if (req.url === '/user/emails') return send(200, who.emails);
      send(404, {});
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() })));
}

test('2FA на сайте: аккаунт, вход с кодом, сброс в Панели', async (t) => {
  const UID = 'a1a1a1a1a1a1';
  const gh = await mockGithub();
  const dir = copyApp();
  seed(dir, { users: [{ id: UID, login: 'anna', email: 'anna@example.com', created: '2026-01-01T00:00:00Z' }], sessions: { tok1: UID, tok2: UID } });
  const s = await startServer(dir, { GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: 'gh-secret', GITHUB_OAUTH_URL: gh.url, GITHUB_API_URL: gh.url });
  t.after(async () => { await s.stop(); gh.close(); rm(dir); });
  const acc = (method, p, body) => s.req(method, '/api/account/2fa' + p, { token: 'tok1', body });
  const ghLogin = async () => {
    const a = await s.req('GET', '/api/auth/github'); assert.equal(a.status, 302);
    const st = new URL(a.headers.get('location')).searchParams.get('state'), ck = a.headers.get('set-cookie').match(/gh_state=([^;]+)/)[1];
    const cb = await s.req('GET', `/api/auth/github/callback?code=anna&state=${st}`, { headers: { Cookie: 'gh_state=' + ck } });
    assert.equal(cb.status, 302);
    const sc = cb.headers.get('set-cookie') || '';
    const sess = sc.match(/premier_session=([a-f0-9]+)/), tf = sc.match(/premier_2fa=([^;]+)/);
    return { to: cb.headers.get('location'), token: sess && sess[1], tfa: tf && tf[1], raw: sc };
  };
  const step2 = async (tfa, code) => {
    const r = await s.req('POST', '/api/auth/2fa', { body: { code }, headers: { Cookie: 'premier_2fa=' + tfa } });
    const m = (r.headers.get('set-cookie') || '').match(/premier_session=([a-f0-9]+)/); r.token = m && m[1]; return r;
  };
  const meId = async (token) => { const j = (await s.req('GET', '/api/auth/me', { token })).json; return j && j.user ? j.user.id : null; };

  let secret, codes;
  await t.test('без 2FA вход сразу в чат', async () => {
    const r = await ghLogin(); assert.equal(r.to, '/chat'); assert.ok(r.token); assert.equal(r.tfa, null);
  });
  await t.test('Аккаунт → Безопасность: включение', async () => {
    assert.equal((await s.req('GET', '/api/account/2fa')).status, 401);
    assert.deepEqual((await acc('GET', '')).json, { on: false, codesLeft: 0, since: null });
    assert.equal((await s.req('GET', '/api/account', { token: 'tok1' })).json.twofa, false);
    assert.equal((await acc('POST', '/disable', { code: '123456' })).status, 400);
    assert.equal((await acc('POST', '/enable', { code: '123456' })).status, 400, 'без setup');
    const st = await acc('POST', '/setup', {}); assert.equal(st.status, 200);
    assert.match(st.json.uri, /^otpauth:\/\/totp\/Premier%3Aanna%40example\.com\?secret=/); secret = st.json.secret;
    const bad = await acc('POST', '/enable', { code: '000000' }); assert.equal(bad.status, 400); assert.match(bad.json.error, /Код не подошёл/);
    const t0 = Date.now();
    const en = await acc('POST', '/enable', { code: at(secret, t0) }); assert.equal(en.status, 200, en.text);
    assert.equal(en.json.on, true); assert.equal(en.json.codes.length, 10); assert.equal(en.json.codesLeft, 10); assert.equal(en.json.loggedOut, 2);
    assert.equal((await s.req('GET', '/api/account', { token: 'tok2' })).status, 401, 'другие устройства выходят');
    assert.equal((await s.req('GET', '/api/account', { token: 'tok1' })).json.twofa, true);
    assert.equal((await acc('POST', '/setup', {})).status, 409);
    secret = { s: secret, t0 };
    // новые резервные коды — по резервному коду; старые перестают работать
    assert.equal((await acc('POST', '/codes', { code: '999999' })).status, 400);
    const g = await acc('POST', '/codes', { code: en.json.codes[0] }); assert.equal(g.status, 200); assert.equal(g.json.codes.length, 10);
    assert.equal((await acc('POST', '/disable', { code: en.json.codes[1] })).status, 400, 'старый код не подходит');
    codes = g.json.codes;
  });
  await t.test('вход через GitHub с 2FA: сначала код', async () => {
    const r = await ghLogin();
    assert.equal(r.to, '/login?step=2fa'); assert.equal(r.token, null, 'сессии до кода нет'); assert.ok(r.tfa);
    assert.match(r.raw, /premier_2fa=[^;]+; Path=\/api\/auth\/2fa; HttpOnly; SameSite=Lax; Max-Age=600/);
    assert.equal((await s.req('GET', '/api/auth/2fa', { headers: { Cookie: 'premier_2fa=' + r.tfa } })).json.pending, true);
    assert.equal((await s.req('GET', '/api/auth/2fa')).json.pending, false);
    assert.equal((await s.req('POST', '/api/auth/2fa', { body: { code: '123456' } })).status, 410, 'без билета');
    const w = await step2(r.tfa, '111111'); assert.equal(w.status, 401); assert.equal(w.token, null); assert.equal(w.json.again, false);
    const ok = await step2(r.tfa, at(secret.s, secret.t0 + 30000)); assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.via, 'totp'); assert.ok(ok.token); assert.equal(await meId(ok.token), UID);
    assert.match(ok.headers.get('set-cookie'), /premier_2fa=; Path=\/api\/auth\/2fa;[^,]*Max-Age=0/);
    const again = await step2(r.tfa, codes[0]); assert.equal(again.status, 410, 'билет одноразовый'); assert.equal(again.json.again, true);
  });
  await t.test('резервный код и перебор', async () => {
    const r = await ghLogin();
    const ok = await step2(r.tfa, codes[0].toUpperCase()); assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.via, 'backup'); assert.equal(ok.json.codesLeft, 9); assert.equal(await meId(ok.token), UID);
    const r2 = await ghLogin();
    assert.equal((await step2(r2.tfa, codes[0])).status, 401, 'тот же резервный код второй раз');
    for (let i = 0; i < 3; i++) assert.equal((await step2(r2.tfa, '00000' + i)).status, 401);
    const last = await step2(r2.tfa, '000009'); assert.equal(last.status, 410); assert.equal(last.json.again, true);
    assert.match(last.json.error, /Слишком много неверных кодов/);
    assert.equal((await step2(r2.tfa, codes[1])).status, 410, 'после перебора билет сгорел');
  });
  await t.test('Панель: статус в карточке и сброс', async () => {
    const login = await s.req('POST', '/api/admin/login', { body: { password: 'Test-Admin-Pass-2026' } }); assert.equal(login.status, 200);
    const owner = (method, url, body) => s.req(method, url, { body, headers: { Authorization: 'Bearer ' + login.json.token } });
    const det = (await owner('GET', '/api/admin/users/' + UID)).json;
    const tf = (det.user || det).twofa; assert.equal(tf.on, true); assert.equal(tf.codesLeft, 9);
    assert.equal((await s.req('POST', `/api/admin/users/${UID}/2fa-reset`)).status, 401);
    assert.equal((await owner('POST', '/api/admin/users/ffffffffffff/2fa-reset')).status, 404);
    const rs = await owner('POST', `/api/admin/users/${UID}/2fa-reset`); assert.equal(rs.status, 200); assert.equal(rs.json.was, true);
    assert.equal((await owner('POST', `/api/admin/users/${UID}/2fa-reset`)).json.was, false);
    const det2 = (await owner('GET', '/api/admin/users/' + UID)).json; assert.equal((det2.user || det2).twofa.on, false);
    const r = await ghLogin(); assert.equal(r.to, '/chat', 'после сброса — без кода'); assert.ok(r.token);
    assert.deepEqual((await acc('GET', '')).json, { on: false, codesLeft: 0, since: null });
  });
  await t.test('статика: скрипт аккаунта, QR и шаг кода на /login', async () => {
    const js = await s.req('GET', '/js/18-2fa.js'); assert.equal(js.status, 200); assert.match(js.text, /window\.premierTfa/);
    assert.equal((await s.req('GET', '/vendor/qrcode.js')).status, 200);
    assert.match((await s.req('GET', '/login')).text, /Код подтверждения/);
    assert.match((await s.req('GET', '/login?lang=en')).text, /Verification code/);
    for (const p of ['/chat', '/chat?lang=en']) {
      const c = await s.req('GET', p, { token: 'tok1' }); assert.equal(c.status, 200, p); assert.match(c.text, /\/js\/18-2fa\.js\?v=1/, p);
    }
  });
});
