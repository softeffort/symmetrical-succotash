// Браузерная проверка раздела «Гайды и блог»: список и редактор в Панели, публичные страницы (светлая/тёмная, мобильная).
// Запуск: CHROMIUM_PATH=$(which chromium) node test/blog-ui-smoke.js
'use strict';
const assert = require('node:assert');
const { copyApp, seed, startServer, rm } = require('./helpers');

(async () => {
  const { chromium } = require('playwright');
  const dir = copyApp(); seed(dir);
  const s = await startServer(dir, { PUSH_OFF: '1' });
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, chromiumSandbox: false });
  const errors = [];
  const watch = (p, tag) => { p.on('pageerror', (e) => errors.push(tag + ': ' + e.message)); p.on('dialog', (d) => d.accept()); };
  try {
    const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } });
    const p = await ctx.newPage(); watch(p, 'panel');
    await p.goto(s.base + '/panelp#blog');
    await p.fill('#pw', 'Test-Admin-Pass-2026'); await p.click('#loginF button');
    await p.waitForSelector('#blList tr.bl-row', { timeout: 15000 });
    assert.equal(await p.locator('#blList tr.bl-row').count(), 3);
    assert.match(await p.textContent('#blList'), /Двухфакторная защита/);
    await p.fill('#blQ', 'команд');
    await p.waitForFunction(() => document.querySelectorAll('#blList tr.bl-row').length === 1, null, { timeout: 5000 });
    await p.fill('#blQ', '');
    await p.waitForFunction(() => document.querySelectorAll('#blList tr.bl-row').length === 3, null, { timeout: 5000 });
    await p.screenshot({ path: '/data/blog-panel-list.png' });
    console.log('✔ список материалов и поиск');

    // новый материал: адрес из заголовка, живой предпросмотр, сохранение
    await p.click('#blNew');
    await p.waitForSelector('#blF', { timeout: 10000 });
    await p.fill('#blF [name=title]', 'Как запустить лендинг за вечер');
    assert.equal(await p.inputValue('#blF [name=slug]'), '', 'адрес пустой — заполнится из заголовка при сохранении');
    await p.fill('#blF [name=description]', 'Короткий план: текст, структура, публикация.');
    await p.fill('#blF [name=tags]', 'сайты, советы');
    await p.fill('#blF [name=body]', 'Вступление.\n\n## Шаг первый\n\n- [x] идея\n- [ ] текст\n\n## Шаг второй\n\n> Совет дня\n\n## Итог\n\n| Шаг | Время |\n|---|---|\n| Текст | 1 ч |\n\n```js\nconsole.log("<ok>")\n```\n\n<script>window.__x=1</script>');
    await p.waitForFunction(() => /<h2[^>]*>Шаг первый/.test(document.getElementById('blPrev').innerHTML), null, { timeout: 8000 });
    assert.equal(await p.evaluate(() => window.__x), undefined, 'скрипт из текста не выполняется');
    assert.match(await p.textContent('#blSnip'), /Как запустить лендинг/);
    await p.click('#blSave');
    await p.waitForFunction(() => /^#blog\/[a-f0-9]{16}$/.test(location.hash), null, { timeout: 10000 });
    await p.waitForSelector('#blPub', { timeout: 10000 });
    await p.waitForSelector('#blDel', { timeout: 10000 });
    assert.equal(await p.inputValue('#blF [name=slug]'), 'kak-zapustit-lending-za-vecher');
    console.log('✔ новый материал сохранён черновиком');

    // публикация
    await p.click('#blPub');
    await p.waitForFunction(() => /Снять с публикации/.test((document.getElementById('blPub') || {}).textContent || ''), null, { timeout: 10000 });
    await p.screenshot({ path: '/data/blog-panel-editor.png', fullPage: true });
    console.log('✔ опубликовано из редактора');

    // публичная страница: светлая, тёмная, телефон
    for (const [scheme, w, tag] of [['light', 1280, 'desktop-light'], ['dark', 1280, 'desktop-dark'], ['light', 390, 'mobile']]) {
      const c2 = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme });
      const q = await c2.newPage(); watch(q, 'post-' + tag);
      const r = await q.goto(s.base + '/blog/kak-zapustit-lending-za-vecher');
      assert.equal(r.status(), 200);
      await q.waitForSelector('.bl-prose h2');
      assert.equal(await q.evaluate(() => window.__x), undefined);
      assert.equal(await q.locator('.bl-toc li').count(), 3);
      assert.equal(await q.locator('.bl-prose li.task.done').count(), 1);
      assert.ok(await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'нет горизонтальной прокрутки: ' + tag);
      const bg = await q.evaluate(() => getComputedStyle(document.body).backgroundColor);
      if (scheme === 'dark') assert.ok(!/255, 255, 255/.test(bg), 'тёмная тема: ' + bg);
      await q.screenshot({ path: `/data/blog-post-${tag}.png`, fullPage: true });
      const l = await q.goto(s.base + '/blog');
      assert.equal(l.status(), 200);
      assert.equal(await q.locator('.bl-card').count(), 1);
      await q.screenshot({ path: `/data/blog-list-${tag}.png` });
      await c2.close();
    }
    console.log('✔ публичные страницы: светлая, тёмная, телефон');

    // удаление из редактора (с подтверждением)
    await p.click('#blDel');
    const ok = p.locator('[data-ok]').first();
    await ok.waitFor({ timeout: 5000 }); await ok.click();
    await p.waitForSelector('#blList tr.bl-row', { timeout: 10000 });
    assert.equal(await p.locator('#blList tr.bl-row').count(), 3);
    console.log('✔ удаление');
    assert.deepEqual(errors, []);
    console.log('OK');
  } finally { await b.close(); await s.stop(); rm(dir); }
})().catch((e) => { console.error(e); process.exit(1); });
