// Браузерная проверка окна «Командный тариф»: приглашение по ссылке, владелец, покупка (RU и EN).
// Запуск: CHROMIUM_PATH=$(which chromium) node test/team-ui-smoke.js
'use strict';
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const { copyApp, seed, startServer, rm } = require('./helpers');

(async () => {
  const { chromium } = require('playwright');
  const U = (id, login) => ({ id, login, email: login + '@example.com', created: new Date().toISOString() });
  const dir = copyApp();
  seed(dir, { users: [U('o1o1o1o1o1o1', 'olga'), U('m1m1m1m1m1m1', 'max'), U('m2m2m2m2m2m2', 'mia')], sessions: { tok1: 'o1o1o1o1o1o1', tok2: 'm1m1m1m1m1m1', tok3: 'm2m2m2m2m2m2' } });
  const r = spawnSync(process.execPath, ['-e', "const t = require('./teams'); require('./db').tx(() => t.onPaid({ uid: 'o1o1o1o1o1o1', team: { seats: 3, days: 30, name: 'Маркетинг' } })); process.stdout.write(t.info({ id: 'o1o1o1o1o1o1' }).code);"], { cwd: dir, encoding: 'utf8' });
  const code = r.stdout.trim().split('\n').pop();
  const s = await startServer(dir, { PUSH_OFF: '1' });
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, chromiumSandbox: false });
  const errors = [];
  const open = async (tok, team, url) => {
    const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
    const cs = [{ name: 'premier_session', value: tok, url: s.base }];
    if (team) cs.push({ name: 'premier_team', value: team, url: s.base });
    await ctx.addCookies(cs);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(url + ': ' + e.message));
    await page.goto(s.base + url);
    return page;
  };
  try {
    // приглашённый пришёл по /t/<код> — окно открывается само, кнопка «Вступить»
    let p = await open('tok2', code, '/chat');
    await p.waitForSelector('#tmJoin', { timeout: 15000 });
    assert.match(await p.textContent('#dtitle'), /Командный тариф/);
    assert.match(await p.textContent('#dbody'), /Маркетинг/);
    await p.click('#tmJoin');
    await p.waitForSelector('#tmLeave', { timeout: 10000 });
    await p.screenshot({ path: '/data/team-member.png' });
    console.log('✔ вступление по ссылке');

    // владелец: ?team=open — состав, ссылка, докупка мест
    p = await open('tok1', '', '/chat?team=open');
    await p.waitForSelector('.tm-list .tm-who', { timeout: 15000 });
    assert.equal(await p.locator('.tm-list .tm-who').count(), 2);
    assert.match(await p.textContent('.rc-link code, .tm-linkrow code'), new RegExp('/t/' + code));
    assert.ok(!/team=open/.test(p.url()), 'параметр убран из адреса');
    await p.waitForSelector('#tmSum', { timeout: 10000 });
    await p.screenshot({ path: '/data/team-owner.png', fullPage: true });
    console.log('✔ окно владельца');

    // новый покупатель, английский интерфейс: /team → число мест и итог
    p = await open('tok3', 'new', '/chat?lang=en');
    await p.waitForSelector('#tmSeats', { timeout: 15000 });
    assert.match(await p.textContent('#dtitle'), /Team plan/);
    await p.waitForFunction(() => /1[,\s.]?050/.test((document.getElementById('tmSum') || {}).textContent || ''), null, { timeout: 10000 });
    await p.click('[data-tmstep="1"]');
    await p.waitForFunction(() => /1[,\s.]?400/.test((document.getElementById('tmSum') || {}).textContent || ''), null, { timeout: 10000 });
    await p.screenshot({ path: '/data/team-buy-en.png', fullPage: true });
    console.log('✔ покупка (EN)');
    assert.deepEqual(errors, []);
    console.log('OK');
  } finally { await b.close(); await s.stop(); rm(dir); }
})().catch((e) => { console.error(e); process.exit(1); });
