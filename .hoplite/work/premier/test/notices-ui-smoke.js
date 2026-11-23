// Уведомления в Chromium: панель → «Оповестить «Платные»» → карточка слева внизу на сайте → закрыта навсегда; ответ из карточки.
// Запуск: CHROMIUM_PATH=/usr/bin/chromium node --test test/notices-ui-smoke.js (нужен playwright)
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { copyApp, seed, startServer, rm } = require('./helpers');
const DAY = 864e5;
test('уведомления в браузере: панель → сайт → закрыто навсегда, ответ из карточки', { timeout: 90000 }, async (t) => {
  const { chromium } = require('playwright');
  const dir = copyApp();
  seed(dir, { users: [
    { id: 'a1a1a1a1a1a1', login: 'anna', name: 'Анна', email: 'anna@example.com', created: '2026-01-01T00:00:00Z', plan: 'pro', until: Date.now() + 3 * DAY },
    { id: 'b2b2b2b2b2b2', login: 'boris', email: 'boris@example.com', created: '2026-01-02T00:00:00Z' },
  ], sessions: { tokA: 'a1a1a1a1a1a1', tokB: 'b2b2b2b2b2b2' } });
  const s = await startServer(dir);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); await s.stop(); rm(dir); });
  const token = (await s.req('POST', '/api/admin/login', { body: { password: 'Test-Admin-Pass-2026' } })).json.token;
  const errors = [];
  const open = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, reducedMotion: 'reduce', ...opts });
    await ctx.route('**/*', (r) => (new URL(r.request().url()).origin === s.base ? r.continue() : r.abort()));
    const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(e.message));
    return { ctx, page };
  };

  // панель: вкладка «Платные» → кнопка «Оповестить «Платные» · 1» → срочное с ответом
  const adm = await open();
  await adm.ctx.addInitScript((tk) => localStorage.setItem('premier-admin', tk), token);
  await adm.page.goto(s.base + '/panelp#users');
  await adm.page.click('[data-st="paid"]');
  const btn = adm.page.locator('#uNotifyB');
  await adm.page.waitForFunction(() => /Платные/.test((document.querySelector('#uNotifyB') || {}).textContent || '')); // вкладка перезагрузилась
  assert.match(await btn.innerText(), /Оповестить «Платные»\s*1/);
  await btn.click();
  await adm.page.waitForSelector('.nc-modal');
  await adm.page.waitForFunction(() => /1 получател/.test(document.querySelector('#ncSum').textContent));
  await adm.page.click('#ncLv [data-l="urgent"]');
  await adm.page.fill('.nc-modal [name=title]', '{name}, нужна помощь');
  await adm.page.fill('.nc-modal [name=text]', 'Ответьте, пожалуйста, на пару вопросов.');
  await adm.page.check('.nc-modal [name=reply]');
  await adm.page.waitForFunction(() => /Анна, нужна помощь/.test(document.querySelector('#ncSlot').textContent)); // предпросмотр с подстановкой
  await adm.page.click('.nc-modal [data-ok]');
  await adm.page.waitForSelector('.nc-modal', { state: 'detached' });

  // сайт: карточка слева внизу у Анны, у Бориса (Free) — нет
  const site = await open();
  await site.ctx.addCookies([{ name: 'premier_session', value: 'tokA', url: s.base }]);
  await site.page.goto(s.base + '/chat');
  const card = site.page.locator('.pn-root .pn-card.pn-urgent');
  await card.waitFor({ timeout: 8000 });
  assert.match(await card.innerText(), /Анна, нужна помощь/);
  const box = await card.boundingBox();
  assert.ok(box.x < 40 && box.y + box.height > 900 - 60, 'карточка в левом нижнем углу');
  // ответ прямо из карточки
  await card.locator('[data-pn="reply"]').click();
  await card.locator('textarea').fill('Конечно, пишите');
  await card.locator('textarea').press('Control+Enter');
  await site.page.waitForSelector('.pn-thanks');
  await site.page.waitForSelector('.pn-root', { state: 'detached', timeout: 6000 });
  await site.page.reload(); await site.page.waitForTimeout(1500);
  assert.equal(await site.page.locator('.pn-card').count(), 0, 'после ответа карточка больше не появляется');

  const bob = await open();
  await bob.ctx.addCookies([{ name: 'premier_session', value: 'tokB', url: s.base }]);
  await bob.page.goto(s.base + '/chat'); await bob.page.waitForTimeout(1500);
  assert.equal(await bob.page.locator('.pn-card').count(), 0, 'не из сегмента — не видит');

  // второе уведомление: закрыть крестиком → не появляется ни после перезагрузки, ни в новом браузере
  const r = await s.req('POST', '/api/admin/notices', { body: { to: { ids: ['a1a1a1a1a1a1'] }, level: 'info', text: 'Просто новость' }, headers: { Authorization: 'Bearer ' + token } });
  assert.equal(r.status, 200);
  await site.page.reload();
  await site.page.locator('.pn-card.pn-info').waitFor({ timeout: 8000 });
  await site.page.click('.pn-card [data-pn="close"]');
  await site.page.waitForSelector('.pn-root', { state: 'detached' });
  await site.page.reload(); await site.page.waitForTimeout(1500);
  assert.equal(await site.page.locator('.pn-card').count(), 0);
  const other = await open({ viewport: { width: 390, height: 780 } });
  await other.ctx.addCookies([{ name: 'premier_session', value: 'tokA', url: s.base }]);
  await other.page.goto(s.base + '/chat'); await other.page.waitForTimeout(1500);
  assert.equal(await other.page.locator('.pn-card').count(), 0, 'закрытое не появляется и на другом устройстве');

  // ответ виден в панели
  const list = await s.req('GET', '/api/admin/notices/list', { headers: { Authorization: 'Bearer ' + token } });
  const urgent = list.json.items.find((x) => x.level === 'urgent');
  const det = await s.req('GET', '/api/admin/notices/' + urgent.id, { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(det.json.replies[0].reply, 'Конечно, пишите');
  assert.deepEqual(errors, []);
});
