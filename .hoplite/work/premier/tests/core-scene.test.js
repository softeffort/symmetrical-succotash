'use strict';
// Редизайн, шаг 2 — Ядро: 3D-сцена за интерфейсом (public/core/core-scene.js, core-scene.css).
// Проверяет то, на что опираются следующие шаги: команды, формы и их вывод из имени модели, места, запасной вид без 3D,
// свет кромок, возврат состояний. Две последние проверки рисуют настоящие кадры и меряют контраст текста на стекле —
// им нужен пакет gl (WebGL для Node): npm i --no-save gl. Без него они пропускаются.
// node --test tests/core-scene.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { makeScene, lowestContrast, root } = require('./core-scene-util');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let gl = null; try { gl = require('gl'); } catch { gl = null; }
const needGl = gl ? false : 'нужен пакет gl: npm i --no-save gl';
const FORMS = ['sphere', 'torus', 'spiral', 'lattice', 'helix', 'knot', 'bloom', 'orbits', 'ribbon', 'vortex', 'crystal'];

test('Ядро: файлы на месте, заглушка шага 1 убрана, страницы продукта не тронуты', () => {
  for (const f of ['core-scene.js', 'core-scene.css']) assert.ok(fs.existsSync(path.join(root, 'public/core', f)), 'нет public/core/' + f);
  assert.ok(!fs.existsSync(path.join(root, 'public/core/core-standin.css')), 'core-standin.css заменён на core-scene.css');
  const html = read('public/core/showcase.html');
  assert.match(html, /<div class="core-scene" aria-hidden="true"><\/div>/, 'слой Ядра — пустой контейнер, сцену строит скрипт');
  assert.ok(html.indexOf('/core/core-ui.js') < html.indexOf('/core/core-scene.js') && html.indexOf('/core/core-scene.js') < html.indexOf('/core/showcase.js'), 'порядок: core-ui.js, core-scene.js, скрипт страницы');
  assert.match(html, /<script defer src="\/core\/core-scene\.js"><\/script>/, 'сцена подключается с defer');
  assert.doesNotMatch(html, /core-standin|data-core-heat/);
  // страницы продукта подключают сцену только вместе с её стилями (на шаге 2 — ни одна)
  const pages = fs.readdirSync(path.join(root, 'public')).filter((n) => n.endsWith('.html')).map((n) => 'public/' + n).concat(fs.readdirSync(path.join(root, 'public/en')).filter((n) => n.endsWith('.html')).map((n) => 'public/en/' + n));
  for (const p of pages.filter((p) => /\/core\/core-scene\.js/.test(read(p)))) { assert.match(read(p), /\/core\/core-scene\.css/, p + ': нет core-scene.css'); assert.match(read(p), /defer src="\/core\/core-scene\.js/, p + ': сцена без defer'); }
});

test('Ядро: без библиотек и внешних адресов; свой префикс; вес', () => {
  const js = read('public/core/core-scene.js'), css = read('public/core/core-scene.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotThrow(() => new vm.Script(js));
  for (const src of [js, css]) assert.doesNotMatch(src, /https?:\/\/|\/\/cdn|@import|importScripts|\beval\(/);
  assert.doesNotMatch(js, /THREE\b|require\(|\bimport\s/, 'сцена не тянет библиотек');
  assert.ok(Buffer.byteLength(js) < 90 * 1024, 'core-scene.js грузится на каждой странице — не больше 90 КБ до сжатия: ' + Buffer.byteLength(js));
  assert.doesNotMatch(js, /#[0-9a-fA-F]{6}\b/, 'цвета сцены берутся из токенов, а не пишутся в скрипте');
  for (const m of css.matchAll(/(?:^|[;{\s])(--[a-zA-Z_][\w-]*)\s*:/g)) assert.match(m[1], /^--(core-|_)/, 'токен без префикса: ' + m[1]);
  for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) assert.match(m[1], /^core(-|$)/, 'класс без префикса core-: .' + m[1]);
  assert.doesNotMatch(css, /var\(--p-/);
  // запасной вид и «уменьшить движение» описаны в стилях
  for (const need of [':root[data-core-scene=glow] .core-scene::before', ':root:not([data-core-scene]) .core-scene', ':root[data-core-motion=reduce]', '@media (prefers-reduced-motion:reduce)', '.core-mini', '.core-ring[data-core-live]::after']) assert.ok(css.includes(need), 'в core-scene.css нет: ' + need);
  assert.doesNotMatch(read('public/core/core-ui.js'), /mousemove|pointermove/, 'за указателем следит сцена, а не core-ui.js');
});

test('Ядро: команды — состояния, формы, места, качество', () => {
  const s = makeScene(), C = s.Core;
  assert.deepEqual(Array.from(C.states), ['rest', 'listening', 'thinking', 'answering', 'receded', 'still']);
  assert.deepEqual(Array.from(C.pulses), ['flash', 'error', 'key']);
  assert.deepEqual(Array.from(C.forms), FORMS, 'порядок и состав форм заморожены: от них зависит форма каждой модели');
  assert.deepEqual(Array.from(C.places), ['center', 'horizon', 'full', 'far']);
  assert.deepEqual(Array.from(C.qualities), ['auto', 'high', 'mid', 'low', 'min']);
  for (const f of ['set', 'state', 'pulse', 'form', 'model', 'place', 'target', 'quality', 'info', 'formOf']) assert.equal(typeof C[f], 'function', 'нет команды Core.' + f);
  assert.equal(C.state('thinking').place('horizon').form('torus'), C, 'команды можно писать цепочкой');
  assert.deepEqual([C.state(), C.place(), C.form()], ['thinking', 'horizon', 'torus']);
  C.state('нет такого'); C.place('nowhere'); C.form('cube');
  assert.deepEqual([C.state(), C.place(), C.form()], ['thinking', 'horizon', 'torus'], 'неизвестные имена ничего не меняют');
  C.set({ state: 'rest', place: { x: 80, y: 30, size: 0.2 }, model: 'Claude Opus 4.5' });
  const i = C.info();
  assert.deepEqual([i.state, i.place, i.form, i.model], ['rest', 'custom', 'knot', 'Claude Opus 4.5']);
  assert.deepEqual([s.html.attrs['data-core-is'], s.html.attrs['data-core-place']], ['rest', 'custom']);
  // начальный вид можно задать разметкой, без скрипта
  const d = makeScene({ attrs: { 'data-core-is': 'still', 'data-core-place': 'horizon', 'data-core-model': 'GPT-5', 'data-core-quality': 'low' } }).Core.info();
  assert.deepEqual([d.state, d.place, d.form, d.quality, d.auto], ['still', 'horizon', 'orbits', 'low', false]);
});

test('Ядро: форма выводится из имени модели — одна и та же всегда, без правки кода', () => {
  const C = makeScene().Core, of = (n) => C.formOf(n);
  // закреплено: если эти пары изменились, у всех пользователей модели сменили форму
  const fixed = { 'GPT-5': 'orbits', 'Claude Opus 4.5': 'knot', 'Gemini 3 Pro': 'ribbon', 'DeepSeek V3': 'spiral', 'Grok 4': 'bloom', 'Qwen 3 Max': 'sphere', 'YandexGPT 5': 'helix', 'GigaChat 2 Max': 'vortex', 'Mistral Large': 'torus', 'o3': 'crystal', 'Kimi K2': 'lattice' };
  for (const [name, form] of Object.entries(fixed)) assert.equal(of(name).form, form, name);
  assert.equal(new Set(Object.values(fixed)).size, 11, 'известные роды моделей занимают все одиннадцать форм');
  assert.deepEqual(of('GPT-5'), of('  gpt 5 '), 'регистр, пробелы и знаки не влияют');
  assert.deepEqual(of('Claude Opus 4.5'), of('claude-opus-4.5'));
  // один род — одно семейство, но свои пропорции
  assert.equal(of('Claude Sonnet 4.5').form, of('Claude Opus 4.5').form);
  assert.notDeepEqual(of('Claude Sonnet 4.5').variant, of('Claude Opus 4.5').variant);
  // любое новое имя, в том числе кириллицей, получает форму и четыре числа 0…1
  for (const name of ['Новая модель 7', 'Сбер Про', '模型-9', 'x', '2026-preview', 'A'.repeat(300)]) {
    const f = of(name); assert.ok(FORMS.includes(f.form), name); assert.equal(f.variant.length, 4); assert.ok(f.variant.every((v) => v >= 0 && v < 1));
  }
  assert.equal(of('').form, 'sphere'); assert.equal(of(null).form, 'sphere'); assert.equal(of('···').form, 'sphere');
  const used = new Set(); for (let i = 0; i < 80; i++) used.add(of(String.fromCharCode(97 + i % 26, 97 + Math.floor(i / 26)) + 'q ' + i).form);
  assert.equal(used.size, 11, 'имена расходятся по всем формам');
});

test('Ядро: каждая форма — плотное облако в единичном шаре, одинаковое при каждом построении', () => {
  const C = makeScene().Core, _ = C._;
  for (const id of FORMS) {
    const a = _.cloud(_.shape(id), 3000, false), b = _.cloud(_.shape(id), 3000, false);
    assert.equal(a.length, 9000, id); assert.deepEqual(Array.from(a.slice(0, 300)), Array.from(b.slice(0, 300)), id + ': построение детерминировано');
    let far = 0, sum = 0;
    for (let i = 0; i < 3000; i++) { const r = Math.hypot(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]); assert.ok(Number.isFinite(r), id); far = Math.max(far, r); sum += r; }
    assert.ok(far <= 1.35, id + ': точки не выходят за шар, дальняя — ' + far.toFixed(2)); assert.ok(sum / 3000 > 0.3 && sum / 3000 < 1, id + ': средний радиус ' + (sum / 3000).toFixed(2));
    assert.ok(_.cloud(_.shape(id), 100, true).length === 300, id + ': малое ядро строится тем же генератором');
  }
  // две модели одного семейства — разные облака
  assert.notDeepEqual(Array.from(_.cloud(_.formOf('Claude Opus 4.5'), 500, false).slice(0, 60)), Array.from(_.cloud(_.formOf('Claude Sonnet 4.5'), 500, false).slice(0, 60)));
});

test('Ядро: места — центр, горизонт, весь экран, вдали — на широком и на узком экране', () => {
  const P = makeScene().Core._.PLACES;
  for (const [w, h] of [[1440, 900], [390, 844], [1920, 1080], [360, 640]]) {
    const c = P.center(w, h), z = P.horizon(w, h), f = P.full(w, h), d = P.far(w, h), at = ' при ' + w + '×' + h;
    assert.ok(c.y - c.r > 0 && c.y + c.r < h && c.x - c.r > 0 && c.x + c.r < w, 'в центре Ядро целиком на экране' + at);
    assert.ok(z.y > h, 'у горизонта центр Ядра ниже края экрана' + at);
    const rise = h - (z.y - z.r); assert.ok(rise >= 110 && rise <= 230 && rise < h * 0.3, 'над краем видна только шапка: ' + rise + at);
    assert.ok(f.r >= Math.hypot(w, h) / 2, 'на весь экран: Ядро закрывает углы' + at);
    assert.ok(d.r < c.r * 0.7, 'вдали Ядро заметно меньше' + at);
    for (const g of [c, z, f, d]) assert.ok(g.gain > 0 && g.gain <= 1, 'яркость места не выше единицы');
  }
});

test('Ядро: без 3D остаётся тихое свечение, команды работают, свет кромок идёт за Ядром', () => {
  const s = makeScene(), C = s.Core;   // WebGL в этой среде нет
  s.advance(1);
  assert.deepEqual([C.info().mode, C.info().reason, s.html.attrs['data-core-scene']], ['glow', 'no-webgl', 'glow']);
  assert.ok(s.state.events.includes('mode'), 'страница узнаёт о режиме из события core:scene');
  assert.deepEqual([s.state.light[0].x, s.state.light[0].y, s.state.light[0].light], [50, 46, 1], 'свет стоит там же, где Ядро');
  C.place('horizon'); s.advance(1);
  const l = s.state.light[s.state.light.length - 1];
  assert.ok(l.x === 50 && l.y > 100 && l.y <= 112 && l.glide, 'у горизонта свет идёт снизу, из-за края экрана, и переезжает плавно: ' + JSON.stringify(l));
  C.state('thinking'); s.advance(0.5);
  assert.equal(s.state.light[s.state.light.length - 1].light, 1.2, 'когда модель думает, кромки ярче');
  assert.equal(s.html.attrs['data-core-is'], 'thinking');
  const n = s.state.light.length; s.advance(3);
  assert.equal(s.state.light.length, n, 'свет меняется только при смене места и состояния, не каждый кадр');
  assert.equal(s.pending(), 0, 'без 3D сцена ничего не рисует и не держит таймеров');
  // без core-ui.js свет пишется прямо в --core-x / --core-y
  const bare = makeScene({ coreUI: false }); bare.Core.place('horizon');  bare.advance(1);
  assert.ok(parseFloat(bare.html.style['--core-y']) > 100);
});

test('Ядро: «печатает» — слушает и само возвращается; окно поверх — отступает и возвращается; разовые не меняют состояние', () => {
  const s = makeScene(), C = s.Core; s.advance(0.5);
  C.pulse('key'); assert.equal(C.state(), 'listening');
  s.advance(1); C.pulse('key'); s.advance(1); assert.equal(C.state(), 'listening', 'пока печатают — слушает');
  s.advance(1.6); assert.equal(C.state(), 'rest', 'замолчали — вернулось в покой');
  C.state('thinking'); C.pulse('key'); assert.equal(C.state(), 'thinking', 'набор текста не перебивает «думает»');
  C.pulse('error'); C.pulse('flash'); C.state('error'); C.state('flash'); assert.equal(C.state(), 'thinking', 'ошибка и вспышка — разовые');
  // окно шага 1: core:focus
  C.place('horizon'); const before = s.state.light.length;
  s.focus(true); assert.deepEqual([C.info().shown, s.html.attrs['data-core-is'], s.html.attrs['data-core-place']], ['receded', 'receded', 'far']);
  assert.deepEqual([C.state(), C.place()], ['thinking', 'horizon'], 'заданное страницей состояние не теряется');
  s.advance(1); assert.equal(s.state.light.length, before, 'пока окно открыто, свет страницы не двигается');
  s.focus(false); assert.deepEqual([C.info().shown, s.html.attrs['data-core-place']], ['thinking', 'horizon']);
  s.advance(1); assert.ok(s.state.light[s.state.light.length - 1].y > 100, 'окно закрыли — свет встал туда, где Ядро');
  // удержание: состояние на время
  C.state('rest'); C.state('answering', { hold: 500 }); s.advance(0.3); assert.equal(C.state(), 'answering'); s.advance(0.4); assert.equal(C.state(), 'rest');
});

test('Ядро: качество — четыре ступени, слабому устройству меньше, выбор запоминается', () => {
  const T = makeScene().Core._.TIERS, ids = ['high', 'mid', 'low', 'min'];
  for (let i = 1; i < ids.length; i++) { assert.ok(T[ids[i]].n < T[ids[i - 1]].n, 'точек меньше на каждой ступени'); assert.ok(T[ids[i]].dpr <= T[ids[i - 1]].dpr && T[ids[i]].px < T[ids[i - 1]].px, 'и пикселей'); }
  assert.ok(T.high.n <= 16000 && T.min.n >= 2000, 'несколько тысяч точек на любой ступени');
  for (const id of ids) assert.ok(T[id].act <= 60 && T[id].rest <= 30, 'в покое не чаще 30 кадров в секунду');
  assert.equal(makeScene().Core.info().quality, 'high');
  assert.equal(makeScene({ coarse: true, w: 390, h: 844 }).Core.info().quality, 'mid', 'телефон');
  assert.equal(makeScene({ coarse: true, w: 390, h: 844, cpu: 4, mem: 4 }).Core.info().quality, 'low', 'слабый телефон');
  assert.equal(makeScene({ mem: 2 }).Core.info().quality, 'low');
  assert.equal(makeScene({ storage: { 'core-q': 'low:' + (1700000000000 - 3600e3) } }).Core.info().quality, 'low', 'час назад устройство не справилось — начинаем с той же ступени');
  assert.equal(makeScene({ storage: { 'core-q': 'low:' + (1700000000000 - 2 * 864e5) } }).Core.info().quality, 'mid', 'через сутки пробуем ступень выше');
  const s = makeScene(); s.Core.quality('min'); assert.deepEqual([s.Core.quality(), s.Core.info().auto], ['min', false]); s.Core.quality('auto'); assert.equal(s.Core.quality(), 'auto');
});

test('Ядро в WebGL: рисует, спит при скрытой вкладке и когда замерло, «уменьшить движение» — один кадр', { skip: needGl }, () => {
  const s = makeScene({ gl, w: 960, h: 600 }), C = s.Core; s.advance(1.5);
  const i = C.info();
  assert.deepEqual([i.mode, i.points, i.width, i.height], ['live', 14000, 960, 600]);
  assert.equal(s.state.options.failIfMajorPerformanceCaveat, true, 'программный (медленный) WebGL не берём');
  assert.equal(s.state.gl.getError(), 0);
  let lit = 0; const px = s.pixels(); for (let k = 0; k < px.data.length; k += 4) if (px.data[k] > 60) lit++;
  assert.ok(lit > 500, 'на кадре есть точки: ' + lit);
  assert.ok(C.info().fps >= 28 && C.info().fps <= 31, 'в покое — около 30 кадров в секунду: ' + C.info().fps);
  C.state('thinking'); s.advance(2); assert.ok(C.info().fps >= 58, 'в движении — 60: ' + C.info().fps);
  s.setHidden(true); s.advance(2); assert.equal(C.info().fps, 0, 'вкладка скрыта — ни одного кадра'); s.setHidden(false); s.advance(1.5); assert.ok(C.info().fps >= 58);
  C.state('still'); s.advance(6); assert.equal(C.info().fps, 0, 'замерло — цикл спит'); assert.equal(s.pending(), 0);
  C.state('rest'); s.advance(1.5); assert.ok(C.info().fps > 0, 'и просыпается по команде');
  s.setReduced(true); s.advance(2); assert.equal(C.info().fps, 0, '«уменьшить движение» — неподвижный кадр'); assert.equal(C.info().still, true);
  C.state('thinking'); s.advance(0.1); assert.ok(C.info().fps <= 2, 'смена состояния — один новый кадр');
  // потеря графического контекста: свечение, затем сцена собирается заново и возвращается
  s.setReduced(false); C.state('rest'); s.advance(1);
  let stopped = false; s.state.canvas.dispatchEvent({ type: 'webglcontextlost', preventDefault() { stopped = true; } });
  assert.ok(stopped, 'браузеру сказано, что контекст нужно вернуть'); assert.deepEqual([C.info().mode, C.info().reason, s.html.attrs['data-core-scene']], ['glow', 'context-lost', 'glow']);
  s.advance(1); assert.equal(C.info().fps, 0, 'без контекста сцена не рисует');
  s.state.canvas.dispatchEvent({ type: 'webglcontextrestored' }); s.advance(1.5);
  assert.deepEqual([C.info().mode, s.html.attrs['data-core-scene']], ['live', 'live']); assert.ok(C.info().fps >= 28, 'и рисует снова'); assert.equal(s.state.gl.getError(), 0);
});

test('Ядро в WebGL: текст на любом стекле не ниже 4.5:1 в самый яркий момент, обе темы', { skip: needGl, timeout: 300000 }, () => {
  for (const theme of ['dark', 'light']) for (const place of ['center', 'horizon']) for (const form of ['sphere', 'lattice', 'vortex']) for (const what of ['rest', 'thinking', 'answering', 'flash']) {
    const s = makeScene({ gl, w: 960, h: 600, dpr: 0.5, theme }), C = s.Core; C.set({ form, place }); s.advance(0.8);
    let low = { low: 99 }, drawn = 0; const base = parseInt(s.token('--core-scene').slice(1, 3), 16);
    const take = () => { const px = s.pixels(), m = lowestContrast(px, theme, 0.5); if (m.low < low.low) low = m; for (let k = 0; k < px.data.length; k += 4) if (Math.abs(px.data[k] - base) > 12) drawn++; };
    if (what === 'flash') { C.state('thinking'); s.advance(2.5); C.pulse('flash'); for (let k = 0; k < 3; k++) { s.advance(0.08); take(); } }
    else { C.state(what); s.advance(2.6); take(); s.advance(0.4); take(); }
    assert.ok(drawn > 150, [theme, place, form, what].join(' / ') + ': Ядро нарисовано (' + drawn + ')');
    assert.ok(low.low >= 4.5, [theme, place, form, what].join(' / ') + ': ' + low.low.toFixed(2) + ' (' + low.where + ')');
  }
});
