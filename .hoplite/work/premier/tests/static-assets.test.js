'use strict';
// Скорость и доступность: стили вынесены из HTML, кеш статики (ETag/304, год для ?v=), неиспользуемые файлы убраны,
// контраст мелкого текста ≥ 4.5:1. node --test tests/static-assets.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { copyApp, startServer, rm } = require('../test/helpers');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('index и chat (RU/EN): большие стили вынесены в файлы, файлы существуют', () => {
  for (const p of ['public/index.html', 'public/en/index.html', 'public/chat.html', 'public/en/chat.html']) {
    const html = read(p);
    for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) assert.ok(m[1].length <= 2000, p + ': встроенный <style> больше 2000 символов');
    for (const m of html.matchAll(/href="(\/css\/[^"?]+)\?v=\d+"/g)) assert.ok(fs.existsSync(path.join(root, 'public', m[1])), p + ': нет файла ' + m[1]);
  }
});

test('неиспользуемые файлы удалены и нигде не подключаются', () => {
  for (const p of ['routes', 'public/js/16-resets.js', 'public/js/17-pay.js', 'public/resets.css', 'public/pay.css', 'chrome-test.js', 'chrome-test2.js']) assert.ok(!fs.existsSync(path.join(root, p)), p + ' ещё на месте');
  for (const p of ['public/chat.html', 'public/en/chat.html', 'server.js']) assert.doesNotMatch(read(p), /16-resets|17-pay|resets\.css|pay\.css|require\(['"]\.\/routes/);
});

test('контраст: --p-dim и --p-muted на фоне и карточках — не меньше 4.5:1', () => {
  const css = read('public/tokens.css'), light = css.slice(css.indexOf(':root{'), css.indexOf('@media'));
  const v = (k) => (light.match(new RegExp('--' + k + ':(#[0-9A-Fa-f]{6})')) || [])[1];
  const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const fg of ['p-dim', 'p-muted']) for (const bg of ['p-bg', 'p-surface', 'p-surface-2']) {
    const r = ratio(v(fg), v(bg)); assert.ok(r >= 4.5, fg + ' на ' + bg + ': ' + r.toFixed(2) + ':1');
  }
  assert.match(css, /:focus-visible\{outline:2px solid var\(--p-accent\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test('HTTP: файлы с ?v= кешируются на год, остальные — ETag и 304', { timeout: 60000 }, async (t) => {
  const dir = copyApp(); const srv = await startServer(dir);
  t.after(async () => { await srv.stop(); rm(dir); });
  const v = await fetch(srv.base + '/tokens.css?v=3');
  assert.equal(v.status, 200); assert.match(v.headers.get('cache-control'), /max-age=31536000/);
  const a = await fetch(srv.base + '/tokens.css'), etag = a.headers.get('etag');
  assert.equal(a.status, 200); assert.ok(etag); assert.equal(a.headers.get('cache-control'), 'no-cache');
  const b = await fetch(srv.base + '/tokens.css', { headers: { 'If-None-Match': etag } });
  assert.equal(b.status, 304);
  const css = await fetch(srv.base + '/css/chat-main.css?v=1'); assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type') || '', /css/);
});
