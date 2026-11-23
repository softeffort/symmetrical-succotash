'use strict';
// Содержимое вложения — данные, а не просьба. Раньше текст загруженного файла (а в архиве
// исходников Premier попадаются и сами регулярилки «нарисуй картинку», generate_image,
// «создай изображение») уводил классификатор в ветку немедленной генерации: пользователь
// загружал архив —Premier начинал рисовать картинку.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const policy = require(path.resolve(__dirname, '..', 'chat-policy.js'));

const ru = (name, body) => '[Файл: ' + name + ']\n' + body + '\n[Конец файла]';
const en = (name, body) => '[File: ' + name + ']\n' + body + '\n[End of file]';
const decide = (content) => {
  const intent = policy.intentOf([{ role: 'user', content }]);
  return { intent, want: policy.mediaWant(content, { refs: 0, prevImage: false }, intent) };
};

test('код внутри вложения не заказывает картинку и видео', () => {
  const body = 'File: premier/image.js\n```\n' +
    'if (o.prosit) нарисуй картинку; // «создай изображение»\n' +
    'const tool = { name: "generate_image" }; // generate an image on request\n' +
    '```';
  for (const msg of [ru('source.zip', body), en('source.zip', body)]) {
    const r = decide(msg);
    assert.equal(r.intent, 'general'); assert.equal(r.want, null);
  }
});

test('длинный текст сообщения не уходит в генератор, даже если intent=image', () => {
  const long = 'нарисуй кота ' + 'x'.repeat(5000);
  assert.equal(policy.mediaWant(long, {}, 'image'), null);
  assert.equal(policy.mediaWant(long, {}, 'general'), null);
  // короткая просьба тем же путём — проходит
  assert.equal(policy.mediaWant('нарисуй кота', {}, 'image'), 'image');
});

test('просьба после вложения остаётся просьбой', () => {
  const msg = ru('prem.zip', 'File: a.js\n```\nнарисуй картинку, создай изображение\n```') + '\n\nсделай мне картинку с котом';
  const r = decide(msg);
  assert.equal(r.want, 'image', 'тело файла обрезано, просьба человека видна');
});

test('обычные просьбы не сломаны', () => {
  const yes = [['нарисуй кота', 'image'], ['нарисуй картинку для сайта', 'image'], ['изобрази закат', 'image'], ['сгенерируй логотип', 'image']];
  for (const [text, want] of yes) {
    const intent = policy.intentOf([{ role: 'user', content: text }]);
    assert.equal(policy.mediaWant(text, { refs: 0, prevImage: false }, intent), want, text);
  }
  for (const text of ['Что в архиве?', 'почему картинка тормозит?', 'объясни, как работает generate_image']) {
    const intent = policy.intentOf([{ role: 'user', content: text }]);
    assert.equal(policy.mediaWant(text, { refs: 0, prevImage: false }, intent), null, text);
  }
});

test('stripFiles оставляет имя файла и текст человека', () => {
  assert.equal(policy.stripFiles('привет'), 'привет');
  assert.equal(policy.stripFiles(ru('a.txt', 'секрет')), '[Файл: a.txt]');
  assert.equal(policy.stripFiles(ru('a.txt', 'секрет') + '\n\nобъясни'), '[Файл: a.txt]объясни'.replace(']об', ']\n\nоб'));
  // маркер, встретившийся внутри тела, не должен обрезать блок раньше времени
  const nested = '[Файл: a.txt]\nтут строка [Конец файла] внутри\nи ещё нарисуй кота\n[Конец файла]\n\nи видео';
  assert.equal(policy.stripFiles(nested).indexOf('нарисуй кота'), -1);
  assert.match(policy.stripFiles(nested), /видео/);
});
