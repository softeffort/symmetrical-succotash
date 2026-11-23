// Браузерная проверка двухфакторной защиты: включение в «Аккаунт → Безопасность» (QR, код, резервные коды)
// и второй шаг входа на /login после GitHub (неверный код, резервный код), EN-страница без билета.
// Запуск: CHROMIUM_PATH=$(which chromium) node test/twofa-ui-smoke.js
'use strict';
const assert = require('node:assert'), http = require('node:http');
const { copyApp, seed, startServer, rm } = require('./helpers');
const { hotp, b32dec } = require('../admin/auth');

let BASE = '';
function mockGithub() {
  const who = { user: { id: 102, login: 'anna-gh', name: 'Anna' }, emails: [{ email: 'anna@example.com', verified: true, primary: true }] };
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/login/oauth/authorize')) {
      const u = new URL(req.url, 'http://x'), back = u.searchParams.get('redirect_uri') || BASE + '/api/auth/github/callback';
      res.writeHead(302, { Location: `${back}${back.includes('?') ? '&' : '?'}code=anna&state=${encodeURIComponent(u.searchParams.get('state'))}` }); return res.end();
    }
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

(async () => {
  const { chromium } = require('playwright');
  const UID = 'a1a1a1a1a1a1';
  const gh = await mockGithub();
  const dir = copyApp();
  seed(dir, { users: [{ id: UID, login: 'anna', email: 'anna@example.com', created: new Date().toISOString() }], sessions: { tok1: UID } });
  const s = await startServer(dir, { PUSH_OFF: '1', GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: 'gh-secret', GITHUB_OAUTH_URL: gh.url, GITHUB_API_URL: gh.url });
  BASE = s.base;
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, chromiumSandbox: false });
  const errors = [];
  const page = async (tok) => {
    const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
    if (tok) await ctx.addCookies([{ name: 'premier_session', value: tok, url: s.base }]);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message)); return p;
  };
  const errText = (p) => p.waitForFunction(() => { const e = document.getElementById('tfaErr') || document.getElementById('err'); return e && e.textContent.length > 0; }, null, { timeout: 10000 });
  try {
    // Аккаунт → Безопасность: QR, неверный код, верный код, 10 резервных кодов
    let p = await page('tok1');
    await p.goto(s.base + '/chat');
    await p.waitForFunction(() => typeof openAccount === 'function', null, { timeout: 15000 });
    await p.evaluate(() => openAccount('security'));
    await p.waitForSelector('#tfaBtn:not([hidden])', { timeout: 10000 });
    assert.match(await p.textContent('#tfaInfo'), /Выключена/);
    await p.click('#tfaBtn');
    await p.waitForSelector('#tfaQr svg', { timeout: 10000 });
    const secret = (await p.textContent('#tfaKey')).replace(/\s/g, '');
    assert.match(secret, /^[A-Z2-7]{16,}$/);
    await p.screenshot({ path: '/data/tfa-setup.png' });
    await p.fill('#tfaCode', '000000'); await p.click('#tfaGo');
    await errText(p); assert.match(await p.textContent('#tfaErr'), /Код не подошёл/);
    await p.fill('#tfaCode', hotp(b32dec(secret), Math.floor(Date.now() / 30000))); await p.click('#tfaGo');
    await p.waitForSelector('#tfaCodes', { timeout: 10000 });
    const codes = await p.$$eval('#tfaCodes span', (a) => a.map((x) => x.textContent));
    assert.equal(codes.length, 10);
    await p.screenshot({ path: '/data/tfa-codes.png' });
    await p.click('#tfaDone');
    assert.match(await p.textContent('#tfaInfo'), /Включена с .+ осталось 10 резервных кодов/);
    assert.ok(await p.isVisible('#tfaNew')); assert.equal(await p.textContent('#tfaBtn'), 'Выключить');
    console.log('✔ включение в аккаунте');

    // вход через GitHub → «Код подтверждения» → неверный код → резервный код → чат
    p = await page(null);
    await p.goto(s.base + '/api/auth/github');
    await p.waitForSelector('#tfaCode', { timeout: 15000 });
    assert.equal(new URL(p.url()).pathname + new URL(p.url()).search, '/login', 'адрес очищен');
    assert.match(await p.textContent('h1'), /Код подтверждения/);
    await p.fill('#tfaCode', '111111'); // 6 цифр — отправка без кнопки
    await errText(p); assert.match(await p.textContent('#tfaErr'), /Неверный код/);
    await p.fill('#tfaCode', codes[0]); await p.click('#tfaBtn');
    await p.waitForSelector('#tfaNext', { timeout: 10000 });
    assert.match(await p.textContent('.card'), /Осталось кодов: 9/);
    await p.screenshot({ path: '/data/tfa-login.png' });
    await p.click('#tfaNext'); await p.waitForURL(/\/chat/, { timeout: 15000 });
    console.log('✔ вход с резервным кодом');

    // EN, без билета — сразу «время вышло» и ссылка «войти заново»
    p = await page(null);
    await p.goto(s.base + '/login?lang=en&step=2fa');
    await p.waitForSelector('#tfaCode', { timeout: 15000 });
    assert.match(await p.textContent('h1'), /Verification code/);
    await errText(p); assert.match(await p.textContent('#tfaErr'), /Time to enter the code is up/);
    assert.ok(await p.isDisabled('#tfaCode'));
    await p.screenshot({ path: '/data/tfa-en.png' });
    console.log('✔ EN: билет истёк');

    assert.deepEqual(errors, [], 'ошибки JS на страницах');
    console.log('TFA_UI_OK');
  } finally {
    await b.close(); await s.stop(); gh.close(); rm(dir);
  }
})().catch((e) => { console.error(e); process.exit(1); });
