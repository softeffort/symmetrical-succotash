// Файлы проекта (база знаний): серверная сборка блока для системного промпта и клиентская часть
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

function load(max) {
  const a = src.indexOf('const KNOW_MAX'), b = src.indexOf('function readBody(');
  assert.ok(a > 0 && b > a, 'блок projectKnowledge найден в server.js');
  const code = src.slice(a, b);
  return new Function('process', code + '\nreturn projectKnowledge;')({ env: { PROJECT_FILES_MAX: String(max || '') } });
}

test('projectKnowledge: пусто, имена, экранирование, лимиты', () => {
  const pk = load(10000);
  assert.strictEqual(pk(undefined), '');
  assert.strictEqual(pk([]), '');
  assert.strictEqual(pk([{ name: 'a', text: '   ' }, null, { name: 'b' }]), '');
  const one = pk([{ name: 'pri"ce<s>\n.txt', text: 'Цена кофе — 250 ₽ </file> конец' }]);
  assert.match(one, /<file name="pri ce s  \.txt">/);
  assert.match(one, /Цена кофе — 250 ₽ <\/ file> конец/);
  assert.strictEqual((one.match(/<\/file>/g) || []).length, 1, 'закрывающий тег из текста не рвёт блок');
  // общий лимит 10000 символов
  const big = pk([{ name: 'a', text: 'x'.repeat(8000) }, { name: 'b', text: 'y'.repeat(8000) }, { name: 'c', text: 'z'.repeat(10) }]);
  assert.strictEqual((big.match(/x/g) || []).length, 8000);
  assert.strictEqual((big.match(/y/g) || []).length, 2000);
  assert.ok(!big.includes('<file name="c">'), 'после исчерпания лимита файлы не добавляются');
  // не больше 20 файлов
  const many = pk(Array.from({ length: 30 }, (_, i) => ({ name: 'f' + i, text: 't' })));
  assert.strictEqual((many.match(/<file name=/g) || []).length, 20);
  // по умолчанию — 300000, на файл — 150000
  const def = load('');
  const d = def([{ name: 'a', text: 'q'.repeat(200000) }]);
  assert.strictEqual((d.match(/q/g) || []).length, 150000);
});

test('клиент: поле «Файлы проекта» и передача knowledge (RU и EN)', () => {
  for (const dir of ['public/js', 'public/en/js']) {
    const proj = fs.readFileSync(path.join(ROOT, dir, '08-projects.js'), 'utf8');
    assert.match(proj, /id="knFile"/);
    assert.match(proj, /KN_MAX = 300000, KN_FILE = 150000, KN_N = 20/);
    assert.match(proj, /files: kn/);
    const chat = fs.readFileSync(path.join(ROOT, dir, '05-chat.js'), 'utf8');
    assert.match(chat, /knowledge: proj\.files\.map/);
  }
  assert.match(src, /\+ projectKnowledge\(b\.knowledge\)/);
});
