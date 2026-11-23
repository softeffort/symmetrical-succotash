'use strict';
// Оформление ответов в чате: подсветка кода, номера строк, формулы, цитаты, таблицы без | по краям,
// время ответа, плавный вывод текста, кнопка «Вниз». Клиентские функции проверяем в изолированном vm.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function load(lang, libs) {
  const ctx = { console: { log() {}, warn() {} }, Map, Set, Date, Math, String, RegExp, requestAnimationFrame: () => 0, loads: [] };
  ctx.document = { documentElement: { lang }, getElementById: () => null, querySelector: () => null, head: { appendChild: (el) => ctx.loads.push(el.src || el.href) }, createElement: () => ({}) };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext("const esc = (s) => String(s).replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c]));", ctx);
  vm.runInContext(read('public/js/02a-rich.js'), ctx);
  const arch = read(lang === 'en' ? 'public/en/js/03-archives.js' : 'public/js/03-archives.js');
  const a = arch.indexOf('const inline'), b = arch.indexOf('\n}\n', arch.indexOf('function block(t)')) + 3;
  vm.runInContext(arch.slice(a, b), ctx);
  if (libs) {
    vm.runInContext(read('public/vendor/hljs/highlight.min.js'), ctx);
    const warn = console.warn; console.warn = () => {}; // KaTeX предупреждает про quirks mode — в vm нет doctype
    try { vm.runInContext(read('public/vendor/katex/katex.min.js'), ctx); } finally { console.warn = warn; }
  }
  return { ctx, run: (code) => vm.runInContext(code, ctx) };
}

for (const lang of ['ru', 'en']) {
  test(`markdown (${lang}): формулы, курсив, зачёркнутый, ссылки, доллары остаются текстом`, () => {
    const { run } = load(lang, true);
    const h = run("inline('Цена $5 и $10, $x^2$, \\\\(a+b\\\\), `$PATH`, *курсив*, snake_case_name, ~~нет~~, **жирно**, \\\\$7, [ссылка](https://a.b/c_d_e)')");
    assert.match(h, /^Цена \$5 и \$10, <span class="katex">/);
    assert.equal((h.match(/class="katex"/g) || []).length, 2);
    assert.match(h, /<code>\$PATH<\/code>/);
    assert.match(h, /<em>курсив<\/em>/);
    assert.match(h, /snake_case_name/);
    assert.match(h, /<del>нет<\/del>/);
    assert.match(h, /<strong>жирно<\/strong>/);
    assert.match(h, /, \$7,/);
    assert.match(h, /<a href="https:\/\/a\.b\/c_d_e" target="_blank" rel="noopener">ссылка<\/a>/);
    assert.equal(run("inline('<img src=x onerror=alert(1)>')"), '&lt;img src=x onerror=alert(1)&gt;');
    assert.doesNotMatch(run("inline('$\\\\href{javascript:alert(1)}{x}$')"), /href="javascript/);
  });

  test(`markdown (${lang}): блоки — таблица без | по краям, цитата, линия, формула`, () => {
    const { run } = load(lang, true);
    const h = run("block('a | b\\n---|---\\n1 | 2\\n> цитата\\n> - пункт\\n---\\n$$\\nE=mc^2\\n$$\\nтекст')");
    assert.match(h, /^<div class="tbl"><table><thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody><\/table><\/div>/);
    assert.match(h, /<blockquote><p>цитата<\/p><ul><li>пункт<\/li><\/ul><\/blockquote><hr>/);
    assert.match(h, /<div class="cv-mathb"><span class="katex-display">/);
    assert.match(h, /<p>текст<\/p>$/);
    // формула ещё печатается — показываем исходник, без ошибок KaTeX
    assert.match(run("block('$$\\nE=mc')"), /cv-math-src block/);
    // обычный текст с | не становится таблицей; одна колонка с --- — это линия, а не таблица
    assert.equal(run("block('да | нет')"), '<p>да | нет</p>');
    assert.equal(run("block('текст\\n---')"), '<p>текст</p><hr>');
  });
}

test('код: подсветка, номера строк, без библиотеки — простой текст и загрузка по требованию', () => {
  const { run, ctx } = load('ru', false);
  const plain = run("codeTag('a\\nb\\nc', 'js')");
  assert.equal(plain, '<code class="cv-code cv-ln"><span class="cv-l">a\n</span><span class="cv-l">b\n</span><span class="cv-l">c</span></code>');
  assert.deepEqual(ctx.loads, ['/vendor/hljs/highlight.min.js']);
  assert.equal(run("codeTag('x', '')"), '<code class="cv-code">x</code>');
  assert.match(run("mathHtml('x', false)"), /cv-math-src/);
  assert.ok(ctx.loads.includes('/vendor/katex/katex.min.js') && ctx.loads.includes('/vendor/katex/katex.min.css'));

  const { run: run2 } = load('ru', true);
  const h = run2("codeTag('/* a\\nb */\\nconst x = \"<s>\";', 'js')");
  // многострочный комментарий: тег закрыт в конце строки и открыт заново на следующей
  assert.match(h, /^<code class="cv-code hljs cv-ln"><span class="cv-l"><span class="hljs-comment">\/\* a<\/span>\n<\/span><span class="cv-l"><span class="hljs-comment">b \*\/<\/span>/);
  assert.match(h, /&lt;s&gt;/);
  assert.doesNotMatch(h, /<s>/);
  assert.match(run2("codeTag('print(1)', '', 'app.py')"), /hljs-built_in|hljs-number/);
});

test('время ответа: сегодня — только время и длительность, старые сообщения — без строки', () => {
  const { run } = load('ru', false);
  assert.equal(run("metaHtml({ t: 'x' })"), '');
  assert.equal(run("metaHtml({ sentAt: Date.now(), live: true })"), '');
  const h = run("metaHtml({ sentAt: new Date().setHours(9, 5, 0, 0), dur: 65000, m: 'Claude' })");
  assert.match(h, /^<span class="cv-meta" title="[^"]*Claude · ответ за 1 мин 05 с">09:05 · 1 мин 05 с<\/span>$/);
  const en = load('en', false).run("metaHtml({ sentAt: new Date().setHours(9, 5, 0, 0), dur: 4000 })");
  assert.match(en, />09:05 · 4s</);
});

test('чат подключает оформление в правильном порядке, файлы библиотек на месте', () => {
  for (const [page, pref] of [['public/chat.html', '/js/'], ['public/en/chat.html', '/en/js/']]) {
    const h = read(page);
    const i = h.indexOf('/js/02a-rich.js'), j = h.indexOf(pref + '02-markdown.js');
    assert.ok(i > 0 && i < j, page + ': 02a-rich.js до 02-markdown.js');
    assert.match(h, /\/chat-visual\.css\?v=\d+/);
  }
  for (const f of ['public/vendor/hljs/highlight.min.js', 'public/vendor/katex/katex.min.js', 'public/vendor/katex/katex.min.css', 'public/vendor/katex/fonts/KaTeX_Main-Regular.woff2']) assert.ok(fs.existsSync(path.join(root, f)), f);
  const css = read('public/vendor/katex/katex.min.css');
  for (const m of css.matchAll(/url\((fonts\/[^)]+)\)/g)) assert.ok(fs.existsSync(path.join(root, 'public/vendor/katex', m[1])), m[1]);
  for (const f of ['public/js/05-chat.js', 'public/en/js/05-chat.js']) {
    const s = read(f);
    assert.match(s, /const SHOWN = new WeakMap\(\)/);
    assert.match(s, /msg\.dur = Date\.now\(\) - msg\.sentAt/);
  }
  for (const f of ['public/js/04-render.js', 'public/en/js/04-render.js']) assert.match(read(f), /\$\{metaHtml\(m\)\}/);
});
