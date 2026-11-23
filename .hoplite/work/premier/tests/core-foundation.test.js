'use strict';
// Редизайн, шаг 1 — основа «Core»: токены, стекло, базовые компоненты, курсор, витрина.
// Проверяет то, что должно оставаться верным на следующих шагах: префикс, обе темы, контраст текста на стекле
// в самый яркий момент фона, движение не дольше трети секунды, курсор, отсутствие внешних адресов.
// node --test tests/core-foundation.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { copyApp, startServer, rm } = require('../test/helpers');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const CORE = ['core-tokens.css', 'core-base.css', 'core-components.css', 'core-scene.css', 'core-ui.js', 'core-scene.js', 'showcase.html', 'showcase.css', 'showcase.js'];   // шаг 2: заглушку Ядра заменила сцена
const CURSORS = ['spark-glow', 'spark-turn-glow', 'bar-glow', 'spark-ink', 'spark-turn-ink', 'bar-ink'];

const tokens = read('public/core/core-tokens.css');
const darkBlock = tokens.slice(tokens.indexOf(':root{'), tokens.indexOf('@supports (cursor:'));
const lightBlock = tokens.slice(tokens.indexOf(':root[data-theme=light]{'), tokens.indexOf('/* ── «Уменьшить движение»'));
const val = (block, name) => { const m = block.match(new RegExp('--core-' + name + ':([^;]+);')); return m ? m[1].trim() : null; };
const themed = (name) => ({ dark: val(darkBlock, name), light: val(lightBlock, name) || val(darkBlock, name) });

// цвет: #RRGGBB или rgb(r g b / a)
const color = (s) => {
  let m = /^#([0-9a-f]{6})$/i.exec(s); if (m) return { rgb: [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)), a: 1 };
  m = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(s); assert.ok(m, 'не цвет: ' + s);
  return { rgb: [+m[1], +m[2], +m[3]], a: m[4] == null ? 1 : +m[4] };
};
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (top, a, bottom) => top.map((c, i) => c * a + bottom[i] * (1 - a));
const clamp = (v) => Math.max(0, Math.min(255, v));
// то, что видно сквозь стекло: фон проходит через contrast() и brightness() из backdrop-filter, сверху ложится заливка
function glass(theme, depth, behind) {
  const pick = (n) => val(theme === 'dark' ? darkBlock : lightBlock, n) || val(darkBlock, n);
  const filter = pick('backdrop-' + depth), fill = color(pick('glass-' + depth));
  const c = /contrast\(([\d.]+)\)/.exec(filter), b = /brightness\(([^)]+)\)/.exec(filter);
  const bright = b ? (/var\(/.test(b[1]) ? +pick('bright-' + depth) : +b[1]) : 1, contrast = c ? +c[1] : 1;
  const seen = behind.map((v) => clamp(clamp(((v / 255 - 0.5) * contrast + 0.5) * 255) * bright));
  return over(fill.rgb, fill.a, seen);
}

test('Core: файлы основы на месте, старые токены и страницы не тронуты', () => {
  for (const f of CORE) assert.ok(fs.existsSync(path.join(root, 'public/core', f)), 'нет public/core/' + f);
  for (const c of CURSORS) assert.ok(fs.existsSync(path.join(root, 'public/core/cursor', c + '.svg')), 'нет курсора ' + c);
  assert.ok(fs.existsSync(path.join(root, 'CORE-DESIGN-SYSTEM.md')), 'нет описания системы');
  assert.doesNotMatch(read('public/tokens.css'), /--core-/, 'в старом tokens.css не должно быть новых токенов');
  // шаг 1 ничего не подключает к существующим страницам: экраны переводятся по одному на следующих шагах
  const pages = fs.readdirSync(path.join(root, 'public')).filter((n) => n.endsWith('.html')).map((n) => 'public/' + n)
    .concat(fs.readdirSync(path.join(root, 'public/en')).filter((n) => n.endsWith('.html')).map((n) => 'public/en/' + n));
  const migrated = pages.filter((p) => /\/core\/core-/.test(read(p)));
  for (const p of migrated) for (const f of ['core-tokens.css', 'core-base.css', 'core-components.css']) assert.match(read(p), new RegExp('/core/' + f.replace('.', '\\.')), p + ': подключайте три файла основы вместе, нет ' + f);
});

test('Core: свой префикс — новые токены не пересекаются со старыми', () => {
  for (const f of ['core-tokens.css', 'core-base.css', 'core-components.css', 'core-scene.css', 'showcase.css']) {
    const css = read('public/core/' + f).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/(?:^|[;{\s])(--[a-zA-Z_][\w-]*)\s*:/g)) assert.match(m[1], /^--(core-|_|[a-z]$)/, f + ': токен без префикса --core-: ' + m[1]);
    assert.doesNotMatch(css, /var\(--p-/, f + ': новые стили не должны читать старые токены --p-*');
    for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) if (!/^\d/.test(m[1]) && !/^(core|sc|hljs)(-|$)/.test(m[1]) && !/^(woff2|svg|css|js|html|w3|org)$/.test(m[1]) && isNaN(+m[1][0])) assert.fail(f + ': класс без префикса core-: .' + m[1]);
  }
});

test('Core: темы — системная настройка по умолчанию и data-theme на <html>; блоки-повторы совпадают', () => {
  assert.match(tokens, /:root\{\s*color-scheme:dark;/, 'основная тема — тёмная');
  assert.match(tokens, /@media \(prefers-color-scheme:light\)\{:root:not\(\[data-theme=dark\]\)\{/);
  assert.match(tokens, /:root\[data-theme=light\]\{/);
  const body = (from) => { const i = tokens.indexOf(from) + from.length; return tokens.slice(i, tokens.indexOf('}', i)).trim(); };
  assert.equal(body('@media (prefers-color-scheme:light){:root:not([data-theme=dark]){'), body(':root[data-theme=light]{'), 'светлая тема по системной настройке и по data-theme должна быть одной и той же');
  const solid = [body('@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){:root{'), body('@media (prefers-reduced-transparency:reduce){:root{'), body(':root[data-core-transparency=reduce]{')];
  assert.equal(solid[0], solid[1]); assert.equal(solid[1], solid[2]); assert.match(solid[0], /--core-backdrop-mid:none/);
  // у каждой цветовой роли есть значение в обеих темах
  for (const n of ['scene', 'glass-far', 'glass-mid', 'glass-near', 'glass-dense', 'edge', 'text', 'text-2', 'text-3', 'text-on-heat', 'heat-1', 'heat-2', 'heat-3', 'heat-4', 'heat-5', 'ok', 'warn', 'bad', 'focus', 'select', 'fill-1', 'line', 'cursor', 'cursor-action', 'cursor-text']) {
    assert.ok(val(darkBlock, n), 'тёмная тема: нет --core-' + n); assert.ok(val(lightBlock, n), 'светлая тема: нет --core-' + n);
  }
});

test('Core: шкалы — шесть размеров на голос, три радиуса, сетка 4 px, три глубины', () => {
  for (const v of ['fs', 'fsm', 'lh']) for (let i = 1; i <= 6; i++) assert.match(val(darkBlock, v + '-' + i) || '', /^[\d.]+rem$/, '--core-' + v + '-' + i);
  for (const v of ['human', 'machine']) for (let i = 1; i <= 6; i++) assert.ok(val(darkBlock, v + '-' + i), '--core-' + v + '-' + i);
  assert.equal(val(darkBlock, 'fs-7'), null, 'размеров ровно шесть');
  assert.match(val(darkBlock, 'font-human'), /^Onest,/); assert.match(val(darkBlock, 'font-machine'), /^"JetBrains Mono",/);
  assert.deepEqual(['sm', 'md', 'lg'].map((r) => val(darkBlock, 'r-' + r)), ['8px', '14px', '22px']);
  for (const [n, px] of Object.entries({ 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 })) assert.equal(val(darkBlock, 's-' + n), px + 'px', 'шаг ' + n + ' сетки = ' + px + ' px');
  for (const d of ['far', 'mid', 'near']) for (const p of ['glass', 'blur', 'bright', 'backdrop', 'shadow', 'edge', 'solid']) assert.ok(val(darkBlock, p + '-' + d), 'нет --core-' + p + '-' + d);
  const blur = ['far', 'mid', 'near'].map((d) => parseFloat(val(darkBlock, 'blur-' + d)));
  assert.ok(blur[0] > blur[1] && blur[1] > blur[2], 'дальнее стекло размывает сильнее ближнего');
});

test('Core: контраст — текст на стекле не ниже 4.5:1 даже когда за стеклом самый яркий фон', () => {
  for (const theme of ['dark', 'light']) {
    const t = (n) => color(themed(n)[theme]).rgb;
    const scene = t('scene'), worst = theme === 'dark' ? [255, 255, 255] : [0, 0, 0];   // строже, чем белое каление и тушь
    const sheen = { c: t('edge'), a: +themed('sheen')[theme] }, hover = color(themed('fill-1')[theme]);
    for (const depth of ['far', 'mid', 'near', 'dense']) {
      const rest = glass(theme, depth, scene), bright = over(sheen.c, sheen.a, glass(theme, depth, worst)), row = over(hover.rgb, hover.a, bright);
      const where = theme + ' / ' + depth + ': ';
      for (const n of ['text', 'text-2']) {
        assert.ok(ratio(t(n), rest) >= 7, where + n + ' в покое ' + ratio(t(n), rest).toFixed(2));
        assert.ok(ratio(t(n), bright) >= 4.5, where + n + ' на самом ярком фоне ' + ratio(t(n), bright).toFixed(2));
      }
      assert.ok(ratio(t('text'), row) >= 4.5, where + 'основной текст на строке под курсором ' + ratio(t('text'), row).toFixed(2));
      assert.ok(ratio(t('text-3'), rest) >= 4.5, where + 'text-3 в покое ' + ratio(t('text-3'), rest).toFixed(2));
      assert.ok(ratio(t('text-3'), bright) >= 2.5, where + 'text-3 на самом ярком фоне ' + ratio(t('text-3'), bright).toFixed(2));
      for (const n of ['ok', 'warn', 'bad']) assert.ok(ratio(t(n), rest) >= 4.5, where + 'статус ' + n + ' ' + ratio(t(n), rest).toFixed(2));
    }
    // запасной вид без размытия и чернила на раскалённой кнопке
    for (const depth of ['far', 'mid', 'near', 'dense']) for (const n of ['text', 'text-2', 'text-3']) assert.ok(ratio(t(n), t('solid-' + depth)) >= 4.5, theme + ': ' + n + ' на solid-' + depth);
    for (const h of ['heat-2', 'heat-3', 'heat-4']) assert.ok(ratio(t('text-on-heat'), t(h)) >= 4.5, theme + ': чернила на ' + h + ' ' + ratio(t('text-on-heat'), t(h)).toFixed(2));
    // подсветка кода на плотном стекле
    const code = glass(theme, 'dense', scene);
    for (const n of ['comment', 'keyword', 'string', 'number', 'func', 'type', 'punct']) assert.ok(ratio(t('syn-' + n), code) >= 4.5, theme + ': подсветка ' + n + ' ' + ratio(t('syn-' + n), code).toFixed(2));
  }
});

test('Core: движение — не дольше трети секунды, без отскоков, «уменьшить движение» выключает всё', () => {
  const dur = [1, 2, 3, 4].map((i) => parseFloat(val(darkBlock, 'dur-' + i)));
  assert.ok(dur.every((d, i) => d > 0 && d <= 320 && (!i || d > dur[i - 1])), 'длительности растут и не превышают 320 мс: ' + dur);
  for (const e of ['out', 'in', 'move']) { const m = /cubic-bezier\(([^)]+)\)/.exec(val(darkBlock, 'ease-' + e)); const p = m[1].split(',').map(Number); assert.ok(p[1] >= 0 && p[1] <= 1 && p[3] >= 0 && p[3] <= 1, 'кривая ' + e + ' без отскока'); }
  assert.match(tokens, /@media \(prefers-reduced-motion:reduce\)\{:root\{--core-dur-1:\.01ms;--core-dur-2:\.01ms;--core-dur-3:\.01ms;--core-dur-4:\.01ms/);
  assert.match(tokens, /:root\[data-core-motion=reduce\]\{--core-dur-1:\.01ms/);
  const comp = read('public/core/core-components.css');
  assert.match(comp, /@media \(prefers-reduced-motion:reduce\)\{[^}]*animation:none/);
  // длительности в компонентах берутся из токенов; исключение — фоновые циклы «ИИ работает»
  for (const m of comp.matchAll(/transition:[^;}]*/g)) assert.doesNotMatch(m[0], /\d(ms|s)\b/, 'переход с длительностью мимо токена: ' + m[0].slice(0, 80));
  assert.match(read('public/core/core-ui.js'), /ms\('--core-dur-4'\)/, 'полёты в скрипте берут длительность из токенов');
});

test('Core: курсор — три формы штатным cursor, точка 16·16, системные курсоры в запасе', () => {
  const path16 = 'M16 8Q17.1 14.9 24 16 17.1 17.1 16 24 14.9 17.1 8 16 14.9 14.9 16 8Z';
  for (const c of CURSORS) {
    const svg = read('public/core/cursor/' + c + '.svg'), ink = c.endsWith('glow') ? '#FFF4E3' : '#1B1714';
    assert.match(svg, /width="32" height="32" viewBox="0 0 32 32"/, c + ': поле 32×32');
    assert.ok(svg.includes('fill="' + ink + '"') && (svg.match(/fill=/g) || []).length === 1, c + ': один сплошной цвет');
    assert.ok(c.startsWith('bar') ? /<rect [^>]*x="15" y="7" width="2" height="18"/.test(svg) : svg.includes(path16), c + ': фигура');
    assert.equal(c.startsWith('spark-turn'), svg.includes('rotate(45 16 16)'), c + ': поворот на 45° вокруг центра');
    const fallback = c.startsWith('bar') ? 'text' : c.startsWith('spark-turn') ? 'pointer' : 'default', tok = val(darkBlock, 'cursor-' + c);
    assert.ok(tok.endsWith(' 16 16,' + fallback), c + ': активная точка 16 16 и системный курсор ' + fallback + ' в запасе');
    // токен несёт тот же рисунок, что и файл
    assert.equal(decodeURIComponent(/url\("data:image\/svg\+xml,([^"]+)"\)/.exec(tok)[1]).replace(/'/g, '"'), svg.trim(), c + ': токен и файл расходятся');
  }
  const base = read('public/core/core-base.css');
  assert.match(base, /@media \(any-pointer:fine\)\{\s*\.core\{cursor:var\(--core-cursor\)\}/, 'курсор только там, где есть мышь');
  assert.doesNotMatch(base + read('public/core/core-components.css'), /cursor:\s*pointer/, 'вместо cursor:pointer — var(--core-cursor-action)');
  assert.doesNotMatch(read('public/core/core-ui.js'), /mousemove|pointermove/, 'курсор не рисуется скриптом');
  for (const sys of ['not-allowed', 'progress']) assert.match(base, new RegExp('cursor:' + sys));
});

test('Core: всё своё — без внешних адресов, без Unbounded, скрипт разбирается', () => {
  for (const f of CORE) {
    const src = read('public/core/' + f).replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
    assert.doesNotMatch(src, /https?:\/\/|\/\/cdn|@import/, f + ': внешний адрес');
    assert.doesNotMatch(src, /Unbounded/i, f + ': Unbounded в интерфейсе больше не используется');
  }
  for (const f of ['core-ui.js', 'core-scene.js', 'showcase.js']) assert.doesNotThrow(() => new vm.Script(read('public/core/' + f)), f);
  for (const m of tokens.matchAll(/url\((\/fonts\/[^)]+)\)/g)) assert.ok(fs.existsSync(path.join(root, 'public', m[1])), 'нет шрифта ' + m[1]);
  const html = read('public/core/showcase.html');
  assert.match(html, /<html lang="ru" class="core">/); assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  for (const m of html.matchAll(/(?:href|src)="(\/[^"#?]+)/g)) assert.ok(fs.existsSync(path.join(root, 'public', m[1])), 'витрина ссылается на отсутствующий файл ' + m[1]);
});

test('Core: компоненты и их состояния описаны в стилях', () => {
  const css = read('public/core/core-base.css') + read('public/core/core-components.css');
  for (const c of ['glass', 'glass--far', 'glass--mid', 'glass--near', 'glass--dense', 'btn', 'btn--main', 'btn--quiet', 'btn--danger', 'btn--icon', 'input', 'inputbox', 'field', 'check', 'radio', 'switch', 'seg', 'tabs', 'tab', 'chip', 'tag', 'badge', 'card', 'row', 'menu', 'menu__item', 'tip', 'toast', 'dialog', 'dialog__pane', 'capsule', 'ring', 'gather', 'table', 'divider', 'avatar', 'code', 'link', 'prose', 'kbd', 'scene', 'sr'])
    assert.ok(css.includes('.core-' + c), 'нет компонента .core-' + c);
  for (const [c, states] of Object.entries({ btn: [':hover', ':active', ':disabled', '[aria-busy=true]'], input: [':hover', ':focus', ':disabled', '[aria-invalid=true]'], 'check input': [':checked', ':indeterminate', ':disabled', '[aria-invalid=true]'], 'switch input': [':checked', ':disabled'], chip: [':hover', ':active', '[aria-pressed=true]', ':disabled'], 'menu__item': [':hover', ':focus-visible', ':disabled', '[aria-checked=true]'], tab: [':hover', '[aria-selected=true]', ':disabled'], 'row--action': [':hover', ':active'], 'card--action': [':hover', ':active'] }))
    for (const s of states) assert.ok(css.includes('.core-' + c + s), 'нет состояния .core-' + c + s);
  assert.match(css, /\.core :focus-visible\{outline:2px solid var\(--core-focus\)/, 'рамка фокуса с клавиатуры');
  assert.match(css, /@media \(pointer:coarse\),\(max-width:600px\)\{[\s\S]*--core-hit/, 'цели касания 44 px');
  assert.equal(val(darkBlock, 'hit'), '44px');
  // размытие не вкладывается: внутри стекла backdrop-filter выключен
  assert.match(css, /\) \*\{-webkit-backdrop-filter:none!important;backdrop-filter:none!important\}/);
});

test('Core: HTTP — витрина и файлы основы отдаются сервером как есть', { timeout: 60000 }, async (t) => {
  const dir = copyApp(); const srv = await startServer(dir);
  t.after(async () => { await srv.stop(); rm(dir); });
  const page = await fetch(srv.base + '/core/showcase.html');
  assert.equal(page.status, 200); assert.match(page.headers.get('content-type') || '', /text\/html/);
  assert.match(await page.text(), /Premier · Core — витрина дизайн-системы/);
  for (const [f, type] of [['core-tokens.css', /css/], ['core-base.css', /css/], ['core-components.css', /css/], ['core-ui.js', /javascript/], ['cursor/spark-glow.svg', /svg/]]) {
    const r = await fetch(srv.base + '/core/' + f + '?v=1');
    assert.equal(r.status, 200, f); assert.match(r.headers.get('content-type') || '', type, f); assert.match(r.headers.get('cache-control') || '', /max-age=31536000/, f);
  }
  // существующие страницы работают как раньше
  for (const p of ['/', '/login', '/tokens.css']) assert.equal((await fetch(srv.base + p)).status, 200, p);
});
