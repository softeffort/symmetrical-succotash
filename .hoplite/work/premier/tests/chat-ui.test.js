'use strict';
// Оформление чата: подключение файлов на RU и EN, синтаксис скрипта, наружу не уходят ключи моделей. node --test tests/chat-ui.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('chat.html и en/chat.html подключают chat-ui.css и 20-chat-ui.js после 19-limits.js', () => {
  for (const p of ['public/chat.html', 'public/en/chat.html']) {
    const html = read(p);
    assert.match(html, /href="\/chat-ui\.css\?v=\d+"/, p);
    const a = html.indexOf('/js/19-limits.js'), b = html.indexOf('/js/20-chat-ui.js');
    assert.ok(a > 0 && b > a, p + ': 20-chat-ui.js подключается после 19-limits.js');
  }
});

test('20-chat-ui.js и 19-limits.js без синтаксических ошибок, стили — только переменные темы', () => {
  for (const p of ['public/js/20-chat-ui.js', 'public/js/19-limits.js']) assert.doesNotThrow(() => new vm.Script(read(p), { filename: p }));
  const css = read('public/chat-ui.css');
  assert.doesNotMatch(css.replace(/color:#fff/g, ''), /#[0-9a-f]{3,6}\b/i, 'цвета — через --p-*, чтобы работала тёмная тема');
});

test('список моделей для браузера не отдаёт ключи и адреса провайдеров, но отдаёт вес и «видит фото»', () => {
  const line = read('server.js').split('\n').find((l) => /const publicModel = /.test(l));
  assert.ok(line, 'publicModel найден');
  assert.doesNotMatch(line, /apiKey|baseUrl|nativeUrl/);
  assert.match(line, /weight/); assert.match(line, /vision/);
});
