// «Видео кодом»: просьбы про видео/анимацию идут в режим HTML-анимации, мета-тег и пределы, запись MP4 (нужны Chromium и ffmpeg — без них
// сквозные проверки пропускаются), API с очередью и кэшем, клиентская кнопка. Запуск: node --test tests/animation.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { copyApp, seed, startServer, rm, ROOT } = require('../test/helpers');

for (const p of ['/opt/premier/.chrome/bin/chrome-headless-shell', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) // production-путь первым: на VPS хром в .chrome/bin
  if (!process.env.CHROMIUM_PATH && fs.existsSync(p)) process.env.CHROMIUM_PATH = p;
if (!process.env.BROWSER_NO_SANDBOX && process.getuid?.() === 0) process.env.BROWSER_NO_SANDBOX = '1';
const policy = require('../chat-policy');
const anim = require('../animation');
const browser = require('../browser');
const has = (cmd) => { try { return spawnSync(cmd, ['-version'], { stdio: 'ignore', timeout: 5000 }).status === 0; } catch { return false; } };
const CAN = browser.available() && anim.ffmpegAvailable() && has('ffprobe');
const SKIP = CAN ? false : 'нужны puppeteer/playwright с Chromium, ffmpeg и ffprobe';
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const msgs = (...t) => t.map((content) => ({ role: 'user', content }));

test('намерение: просьбы про видео и анимацию идут в режим анимации (artifact + anim)', () => {
  for (const t of ['сделай видео про кота', 'Создай ролик о запуске продукта', 'сделай анимацию загрузки', 'сгенерируй видео: закат над морем',
    'сделай видео из этой картинки', 'сделай анимированный логотип', 'нужен ролик про наш продукт', 'сделай гифку с котом', 'создай клип для презентации',
    'make a video of a bouncing ball', 'create an animation of the solar system', 'generate a short clip about space', 'build an animated logo']) {
    const task = policy.taskOf(msgs(t), null);
    assert.equal(task.intent, 'artifact', t); assert.equal(task.mode, 'create', t); assert.equal(task.anim, true, t);
    assert.equal(policy.mediaWant(t, {}, policy.intentOf(msgs(t))), null, t); // отдельного генератора видео нет
  }
});
test('намерение: сайты, игры, картинки, вопросы и не-HTML остаются как были', () => {
  for (const t of ['сделай сайт с анимацией', 'создай игру', 'сделай лендинг с анимированным фоном', 'make a website with animations']) {
    const task = policy.taskOf(msgs(t), null); assert.equal(task.intent, 'artifact', t); assert.ok(!task.anim, t);
  }
  assert.equal(policy.intentOf(msgs('нарисуй картинку для видео')), 'image');
  assert.equal(policy.intentOf(msgs('нарисуй картинку кота')), 'image');
  for (const t of ['как сделать видео?', 'объясни, как работает анимация', 'сделай кнопку с анимацией', 'сделай видео на python', 'не видео, а картинку']) assert.ok(!policy.taskOf(msgs(t), null).anim, t);
});
test('намерение: правки и продолжения анимации наследуют режим, новая просьба про сайт — нет', () => {
  const base = { source: '```html\n<meta name="premier-animation" content="duration=8">\n```', title: 'Ролик' };
  assert.deepEqual(policy.taskOf(msgs('сделай видео про кота', 'измени цвет на синий'), base), { intent: 'artifact', mode: 'edit', needsBase: false, anim: true });
  assert.equal(policy.taskOf(msgs('сделай видео про кота', 'ну че там'), null).anim, true);
  assert.equal(policy.taskOf(msgs('сделай видео про кота', 'сделай красный фон'), null).anim, true);
  assert.ok(!policy.taskOf(msgs('сделай видео про кота', 'создай игру'), null).anim);
  assert.equal(policy.taskOf(msgs('сделай видео про собаку'), base).mode, 'create'); // свежая просьба — новая анимация
  assert.ok(!policy.taskOf(msgs('измени цвет на синий'), { source: '<h1>site</h1></html>' }).anim);
  assert.ok(policy.isAnimHtml(base.source)); assert.ok(!policy.isAnimHtml('<html></html>'));
});
test('ANIMATION_NOTE описывает контракт: мета-тег, время, MP4', () => {
  const n = policy.ANIMATION_NOTE;
  for (const re of [/premier-animation/, /duration=8; fps=30; width=1920; height=1080/, /1080x1920/, /MP4/, /requestAnimationFrame/, /GSAP/, /без звука|звук/i]) assert.match(n, re);
});

test('мета-тег: значения по умолчанию, разбор и пределы', () => {
  assert.deepEqual({ ...anim.parseMeta('<html></html>'), clamped: 0 }, { duration: 8, fps: 30, width: 1920, height: 1080, frames: 240, declared: false, clamped: 0 });
  const m = anim.parseMeta('<meta name="premier-animation" content="duration=5; fps=24; width=1080; height=1920">');
  assert.deepEqual([m.duration, m.fps, m.width, m.height, m.frames, m.declared], [5, 24, 1080, 1920, 120, true]);
  assert.equal(anim.parseMeta('<meta content="duration=3,fps=60,width=1080,height=1080" name="premier-animation">').frames, 180); // порядок атрибутов не важен
  const big = anim.parseMeta("<meta name='premier-animation' content='duration=500; fps=240; width=9999; height=7'>");
  assert.equal(big.duration, 60); assert.ok(big.fps >= 10 && big.fps <= 60); assert.ok(big.frames <= anim.LIM.maxFrames);
  assert.equal(big.width, 1920); assert.equal(big.height, anim.LIM.minSide); assert.ok(big.clamped.includes('size') && big.clamped.includes('duration') === true || big.clamped.includes('frames'));
  const odd = anim.parseMeta('<meta name="premier-animation" content="width=1001; height=777">');
  assert.deepEqual([odd.width % 2, odd.height % 2], [0, 0]);
  const junk = anim.parseMeta('<meta name="premier-animation" content="duration=abc; fps=-5">');
  assert.deepEqual([junk.duration, junk.fps], [8, 30]);
  assert.ok(anim.parseMeta('<meta name="premier-animation" content="duration=60; fps=60">').frames <= anim.LIM.maxFrames);
  assert.equal(anim.hasAnimation('<meta name="premier-animation" content="">'), true);
  assert.equal(anim.hasAnimation('<meta name="viewport" content="">'), false);
});
test('ffmpeg: аргументы дают H.264 yuv420p с +faststart и чётными сторонами', () => {
  const a = anim.ffmpegArgs({ fps: 30, width: 640, height: 360 }, '/tmp/x.mp4').join(' ');
  for (const re of [/image2pipe/, /libx264/, /-pix_fmt yuv420p/, /\+faststart/, /scale=640:360/, /-fs \d+/]) assert.match(a, re);
});

test('клиент: 22-anim.js и anim.css подключены на RU и EN, без синтаксических ошибок, стили — только токены темы', () => {
  assert.doesNotThrow(() => new vm.Script(read('public/js/22-anim.js'), { filename: '22-anim.js' }));
  const ver = (html, re) => (re.exec(html) || [])[1];
  const ru = read('public/chat.html'), en = read('public/en/chat.html');
  for (const html of [ru, en]) {
    assert.ok(html.indexOf('/js/22-anim.js') > html.indexOf('/js/21-ultra.js'), 'после 21-ultra.js');
    assert.match(html, /id="animbar"/); assert.match(html, /\/anim\.css\?v=\d+/);
  }
  for (const re of [/\/js\/22-anim\.js\?v=(\d+)/, /\/anim\.css\?v=(\d+)/]) assert.equal(ver(ru, re), ver(en, re));
  const css = read('public/anim.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(css) && !/rgba?\(/i.test(css), 'в стилях нет литеральных цветов');
  assert.match(read('public/js/22-anim.js'), /Скачать MP4/); assert.match(read('public/js/22-anim.js'), /Download MP4/);
});
test('клиент: мета-тег в коде виден кнопке, подписи RU/EN, состояния', () => {
  for (const lang of ['ru', 'en']) {
    const els = {}, mk = () => ({ hidden: true, innerHTML: '', querySelector: () => null, setAttribute() {} });
    els.animbar = mk();
    let art = { closed: true, code: '<meta name="premier-animation" content="duration=4; fps=30; width=1080; height=1920">', title: 'T' };
    const doc = { documentElement: { lang }, getElementById: (id) => els[id], addEventListener() {}, createElement: () => ({}) };
    const ctx = { document: doc, curArt: () => art, esc: (s) => String(s), toLogin() {}, paneUI() {}, fetch: async () => ({ ok: true, json: async () => ({}) }), setTimeout, console, addEventListener() {} };
    ctx.window = ctx; vm.createContext(ctx); vm.runInContext(read('public/js/22-anim.js'), ctx); ctx.paneUI();
    assert.equal(els.animbar.hidden, false);
    assert.match(els.animbar.innerHTML, lang === 'en' ? /Download MP4/ : /Скачать MP4/);
    assert.match(els.animbar.innerHTML, /1080×1920/); assert.match(els.animbar.innerHTML, /4 /);
    art = { closed: true, code: '<h1>site</h1>', title: 'T' }; ctx.paneUI(); assert.equal(els.animbar.hidden, true);
    art = { closed: false, code: '<meta name="premier-animation" content="">', title: 'T' }; ctx.paneUI(); assert.equal(els.animbar.hidden, true, 'пока код пишется — кнопки нет');
  }
});

// ---- запись ----
const TINY = `<!doctype html><html><head><meta charset="utf-8"><meta name="premier-animation" content="duration=1; fps=20; width=320; height=180">
<style>html,body{margin:0;background:#000}#s{position:relative;width:320px;height:180px;overflow:hidden;background:#123}
#box{position:absolute;top:10px;left:0;width:50px;height:50px;background:#e33;animation:mv 1s linear forwards}@keyframes mv{from{left:0}to{left:270px}}
canvas{position:absolute;top:80px;left:0}</style></head><body><div id="s"><div id="box"></div><canvas id="c" width="320" height="100"></canvas></div>
<script>const c=document.getElementById('c').getContext('2d');let dots=[];for(let i=0;i<12;i++)dots.push([Math.random()*320,Math.random()*100]);
function f(t){c.clearRect(0,0,320,100);c.fillStyle='#3e3';c.fillRect(20+t*0.2,40,30,30);c.fillStyle='#ff0';for(const d of dots)c.fillRect(d[0],d[1],3,3);
c.fillStyle='#fff';c.fillRect(0,95,Math.min(320,(Date.now()-window.__t0)*0.32),5);requestAnimationFrame(f)}window.__t0=Date.now();requestAnimationFrame(f);
let n=0;setInterval(()=>{n++;document.title='tick'+n},100)</script></body></html>`;
const probe = (file) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
  'stream=codec_name,width,height,pix_fmt,nb_read_frames,r_frame_rate:format=duration', '-of', 'json', file], { encoding: 'utf8' }).stdout);
const frameHashes = (file) => spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'framemd5', '-'], { encoding: 'utf8' }).stdout
  .split('\n').filter((l) => /^\d/.test(l)).map((l) => l.split(',').pop().trim());

test('запись: короткая анимация CSS + rAF + таймер даёт MP4 нужного размера и длины, кадры различаются, повтор детерминирован', { skip: SKIP, timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'premier-anim-')); t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); browser.close().catch(() => {}); });
  const params = anim.parseMeta(TINY), pr = [];
  const a = await anim.render(browser, TINY, params, { outFile: path.join(dir, 'a.mp4'), onProgress: (p) => pr.push(p) });
  const b = await anim.render(browser, TINY, params, { outFile: path.join(dir, 'b.mp4') });
  assert.equal(a.frames, 20); assert.equal(pr.at(-1), 100); assert.ok(pr.every((x, i) => i === 0 || x >= pr[i - 1]));
  const info = probe(a.file), s = info.streams[0];
  assert.equal(s.codec_name, 'h264'); assert.equal(s.pix_fmt, 'yuv420p'); assert.deepEqual([s.width, s.height], [320, 180]);
  assert.equal(+s.nb_read_frames, 20); assert.equal(s.r_frame_rate, '20/1'); assert.ok(Math.abs(+info.format.duration - 1) < 0.06, 'длительность ≈ 1 с: ' + info.format.duration);
  assert.equal(+probe(b.file).streams[0].nb_read_frames, 20, 'повторная запись — то же число кадров');
  assert.equal(fs.readFileSync(a.file).subarray(4, 8).toString(), 'ftyp');
  const ha = frameHashes(a.file), hb = frameHashes(b.file);
  assert.equal(new Set(ha).size, 20, 'каждый кадр отличается от соседних (движение есть)');
  assert.deepEqual(ha, hb, 'кадры повторной записи совпадают');
  // moov в начале файла (+faststart)
  const head = fs.readFileSync(a.file).subarray(0, 4096).toString('latin1'); assert.ok(head.indexOf('moov') > 0 && head.indexOf('moov') < (head.indexOf('mdat') < 0 ? 1e9 : head.indexOf('mdat')));
  assert.ok(!fs.existsSync(a.file + '.part'));
});
test('виртуальные часы: таймеры, интервалы, rAF, Date и performance.now идут по шагам кадров, Math.random повторяется', () => {
  const mk = () => {
    const win = { performance: { now: () => 99999 }, document: { timeline: {}, getAnimations: () => [] }, queueMicrotask, Date, eval, setTimeout };
    win.window = win; vm.runInContext('(' + anim.clockInit.toString() + ')(7)', vm.createContext(win)); return win;
  };
  const w = mk(), log = [];
  w.requestAnimationFrame((ts) => log.push(['raf', ts]));
  w.setTimeout(() => log.push(['t50', w.performance.now()]), 50);
  w.setTimeout(() => log.push(['t0', w.performance.now()]), 0);
  const iv = w.setInterval(() => log.push(['i', w.performance.now()]), 20);
  const dead = w.setTimeout(() => log.push(['dead']), 10); w.clearTimeout(dead);
  w.__premierTick(0);
  assert.deepEqual(log, [['t0', 0], ['raf', 0]], 'при нулевом шаге время стоит, setTimeout(0) и rAF отработали');
  w.__premierTick(1000 / 30); w.__premierTick(1000 / 30);
  assert.equal(w.performance.now(), 2000 / 30); assert.equal(w.Date.now() - w.Date.now(), 0);
  assert.deepEqual(log.filter((x) => x[0] === 'i').map((x) => x[1]), [20, 40, 60].filter((x) => x <= 2000 / 30), 'интервал 20 мс сработал на 20, 40, 60');
  assert.equal(log.filter((x) => x[0] === 't50').length, 1); assert.equal(log.find((x) => x[0] === 't50')[1], 50, 'таймер на 50 мс сработал ровно в 50 мс виртуального времени');
  w.clearInterval(iv); const n = log.length; w.__premierTick(500); assert.equal(log.length, n);
  assert.equal(+new w.Date().getTime() - w.Date.now(), 0);
  const rnd = (win) => vm.runInContext('JSON.stringify([Math.random(), Math.random()])', win), a = mk(), b = mk(); assert.deepEqual(rnd(a), rnd(b));
});

test('API: вход обязателен, проверка HTML, понятная ошибка без ffmpeg/браузера; с ними — очередь, ход, MP4, кэш и один ролик на человека', { timeout: 180000 }, async (t) => {
  const dir = copyApp(); seed(dir, { users: [{ id: 'u1', login: 'anna', email: 'a@example.com', created: '2026-01-01T00:00:00Z' }, { id: 'u2', login: 'bob', email: 'b@example.com', created: '2026-01-01T00:00:00Z' }], sessions: { tok1: 'u1', tok2: 'u2' } });
  if (CAN && fs.existsSync(path.join(ROOT, 'node_modules'))) fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  const srv = await startServer(dir, { CHROMIUM_PATH: process.env.CHROMIUM_PATH || '', BROWSER_NO_SANDBOX: process.env.BROWSER_NO_SANDBOX || '', ANIM_RENDER_CONCURRENCY: '1' });
  t.after(async () => { await srv.stop(); rm(dir); });
  const post = (html, token = 'tok1') => srv.req('POST', '/api/animation/render', { body: { html }, token });
  assert.equal((await srv.req('POST', '/api/animation/render', { body: { html: TINY } })).status, 401);
  assert.equal((await srv.req('GET', '/api/animation/render/0123456789abcdef')).status, 401);
  assert.equal((await post('')).status, 400);
  assert.equal((await post('<html><body>нет закрытия')).status, 400);
  assert.equal((await post('x'.repeat(2.2 * 1024 * 1024))).status, 413);
  assert.equal((await srv.req('GET', '/api/animation/render/0123456789abcdef', { token: 'tok1' })).status, 404);
  if (!CAN) { const r = await post(TINY); assert.ok([501, 503].includes(r.status), 'без ffmpeg/браузера — 501/503'); assert.match(r.json.code, /^no_/); assert.ok(r.json.error); return; }
  const r1 = await post(TINY); assert.equal(r1.status, 202, r1.text); assert.match(r1.json.id, /^[a-f0-9]{16}$/);
  const other = TINY.replace('duration=1', 'duration=2');
  const busy = await post(other); assert.equal(busy.status, 429); assert.equal(busy.json.code, 'busy');
  assert.equal((await post(TINY)).status, 202, 'тот же ролик — тот же рендер');
  assert.equal((await srv.req('GET', '/api/animation/render/' + r1.json.id, { token: 'tok2' })).status, 404, 'чужой рендер не виден');
  let j; for (let i = 0; i < 120; i++) { j = (await srv.req('GET', '/api/animation/render/' + r1.json.id, { token: 'tok1' })).json; if (j.status === 'done' || j.status === 'error') break; await new Promise((r) => setTimeout(r, 500)); }
  assert.equal(j.status, 'done', JSON.stringify(j)); assert.equal(j.progress, 100); assert.match(j.url, new RegExp('^/api/files/' + r1.json.id + '/animation\\.mp4$'));
  const file = await fetch(srv.base + j.url + '?dl=1', { headers: { Cookie: 'premier_session=tok1' } });
  assert.equal(file.status, 200); assert.equal(file.headers.get('content-type'), 'video/mp4'); assert.match(file.headers.get('content-disposition'), /attachment/);
  const buf = Buffer.from(await file.arrayBuffer()); assert.equal(buf.subarray(4, 8).toString(), 'ftyp');
  assert.equal((await fetch(srv.base + j.url, { headers: { Cookie: 'premier_session=tok2' } })).status, 404, 'файл другого человека недоступен');
  const again = await post(TINY); assert.equal(again.status, 200); assert.equal(again.json.status, 'done'); assert.equal(again.json.cached, true); assert.equal(again.json.url, j.url);
  const tmp = path.join(dir, 'probe.mp4'); fs.writeFileSync(tmp, buf); const s = probe(tmp).streams[0]; assert.deepEqual([s.width, s.height, +s.nb_read_frames], [320, 180, 20]);
});

// ---- ревью: маршрутизация, часы, сеть, отмена, ffmpeg ----
const task = (t, base = null) => policy.taskOf(msgs(t), base);
test('намерение: при открытом обычном сайте «анимация загрузки/появления/на кнопку» — это правка сайта, не новая анимация', () => {
  const site = { source: '<!doctype html><html><body>site</body></html>', title: 'Сайт' };
  for (const t of ['сделай анимацию появления блоков', 'добавь анимацию на кнопку', 'сделай анимацию загрузки', 'сделай заставку при загрузке сайта', 'make an animation for the button']) {
    const r = task(t, site); assert.ok(!r.anim, t);
    if (/^(сделай анимацию|добавь)/.test(t)) assert.equal(r.mode, 'edit', t); // как на master
  }
  // явная просьба про видео/ролик или «с нуля» при открытом сайте — новая анимация
  assert.deepEqual(task('сделай видео про кота', site), { intent: 'artifact', mode: 'create', needsBase: false, anim: true });
  assert.equal(task('сделай анимацию с нуля', site).anim, true);
  // без открытого сайта «сделай анимацию загрузки» — анимация
  assert.equal(task('сделай анимацию загрузки').anim, true);
  assert.ok(!task('сделай анимацию появления блоков').anim, 'веб-часть сайта: не ролик');
});
test('намерение: просьбы нарисовать картинку/героя/заставку остаются картинками', () => {
  for (const t of ['нарисуй кота из мультфильма', 'нарисуй героя мультика', 'нарисуй заставку для канала', 'сделай аватарку в стиле мультфильма', 'нарисуй мультяшного кота']) {
    const r = task(t); assert.ok(!r.anim, t); assert.notEqual(r.intent, 'artifact', t);
    assert.equal(policy.mediaWant(t, {}, policy.intentOf(msgs(t))), 'image', t);
  }
  for (const t of ['сделай мультик', 'сделай мне короткий мультик про кота', 'создай мультфильм про космос', 'сделай заставку для канала с логотипом']) assert.equal(task(t).anim, true, t);
});
test('намерение: код про видео и просмотр видео — не анимация', () => {
  for (const t of ['напиши скрипт для скачивания видео с youtube', 'напиши функцию, которая конвертирует видео в gif', 'напиши код ffmpeg для обрезки видео', 'хочу посмотреть видео про космос',
    'покажи видео', 'напиши сценарий для видео', 'создай видеоплеер на сайте', 'write a script that converts a video to a gif', 'как сделать видео из картинок в ffmpeg?']) {
    const r = task(t); assert.ok(!r.anim, t);
    if (!/видеоплеер/.test(t)) assert.equal(policy.intentOf(msgs(t)), 'general', t);
  }
  for (const t of ['сделай видео про кота', 'make a video of a ball', 'сделай гифку', 'анимируй логотип', 'хочу видео про кота', 'нужен ролик про наш продукт', 'generate a short clip about space']) assert.equal(task(t).anim, true, t);
});
test('ANIMATION_NOTE: список CDN совпадает с рекордером; при правке — только правила анимации без «верни целый HTML»', () => {
  for (const h of anim.HOSTS) { assert.ok(policy.ANIMATION_NOTE.includes(h), h); assert.ok(policy.ANIMATION_EDIT_NOTE.includes(h), h); }
  assert.match(policy.ANIMATION_NOTE, /data: URL/); assert.match(policy.ANIMATION_NOTE, /Верни ОДИН полный HTML-документ/);
  assert.doesNotMatch(policy.ANIMATION_EDIT_NOTE, /ОДИН полный HTML/); assert.match(policy.ANIMATION_EDIT_NOTE, /premier-animation/); assert.match(policy.ANIMATION_EDIT_NOTE, /точечные правки/);
  const srv = read('server.js'); assert.match(srv, /editMode \? chatPolicy\.ANIMATION_EDIT_NOTE : chatPolicy\.ANIMATION_NOTE/);
});
test('сеть при записи: только CDN из списка и data:/blob:; остальное закрыто', () => {
  for (const u of ['https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js', 'https://unpkg.com/x', 'https://cdnjs.cloudflare.com/a.js', 'https://fonts.googleapis.com/css2?family=Inter', 'https://fonts.gstatic.com/s/a.woff2', 'https://esm.sh/x', 'https://ajax.googleapis.com/a.js', 'data:image/png;base64,AAAA', 'blob:https://x/1'])
    assert.equal(anim.netAllowed(u), true, u);
  for (const u of ['https://example.com/a.png', 'http://cdn.jsdelivr.net/x', 'https://evil.cdn.jsdelivr.net.example.com/x', 'https://user:pw@cdn.jsdelivr.net/x', 'https://cdn.jsdelivr.net:8443/x', 'wss://cdn.jsdelivr.net/s', 'http://127.0.0.1/x', 'https://premier-assets.invalid/x', 'not a url'])
    assert.equal(anim.netAllowed(u), false, u);
  assert.match(fs.readFileSync(path.join(ROOT, 'animation.js'), 'utf8'), /filter: netAllowed/);
});
test('виртуальные часы: Date() без new — строка, WebSocket закрыт, анимация, стоявшая на паузе, потом едет', () => {
  const anims = [];
  const win = { performance: { now: () => 1 }, document: { timeline: {}, getAnimations: () => anims }, queueMicrotask, Date, eval, setTimeout, DOMException };
  const ctx = vm.createContext(win); win.window = win; vm.runInContext('(' + anim.clockInit.toString() + ')(3)', ctx);
  assert.equal(vm.runInContext('typeof Date()', ctx), 'string'); assert.equal(vm.runInContext('new Date() instanceof Date', ctx), true);
  assert.equal(vm.runInContext('new Date(2020, 0, 1).getFullYear()', ctx), 2020); assert.equal(vm.runInContext('Date.UTC(2020, 0, 1)', ctx), Date.UTC(2020, 0, 1));
  assert.throws(() => vm.runInContext('new WebSocket("wss://x")', ctx), /Сеть недоступна/);
  const a = { playState: 'paused', currentTime: 0, playbackRate: 1, pause() { this.playState = 'paused'; } };
  anims.push(a); win.__premierTick(100); assert.equal(a.currentTime, 0, 'на паузе — не трогаем');
  a.playState = 'running'; win.__premierTick(100); assert.equal(a.playState, 'paused'); assert.equal(a.currentTime, 0, 'запущена позже — ведём с того места');
  win.__premierTick(100); win.__premierTick(50); assert.equal(a.currentTime, 150);
});
test('браузер: фильтр сети режет лишнее, а ожидание загрузки ограничено настоящим таймером', { skip: SKIP, timeout: 60000 }, async (t) => {
  t.after(() => browser.close().catch(() => {}));
  await browser.withPage(async (page) => {
    const isP = typeof page.evaluateOnNewDocument === 'function';
    if (isP) await page.evaluateOnNewDocument(anim.clockInit, 1); else await page.addInitScript(anim.clockInit, 1);
    const failed = [], seen = [];
    page.on('request', (r) => seen.push(r.url ? r.url() : ''));
    page.on('requestfailed', (r) => failed.push(r.url() + ' ' + (r.failure()?.errorText || '')));
    await page.goto('https://premier-assets.invalid/x.html', { waitUntil: 'load' });
    // зависшая картинка: complete=false и событий нет — ожидание всё равно заканчивается
    await page.evaluate(() => { Object.defineProperty(document, 'images', { get: () => [{ complete: false, addEventListener() {} }], configurable: true }); });
    const t0 = Date.now(); await page.evaluate(() => window.__premierReady(300)); assert.ok(Date.now() - t0 < 5000, 'ожидание ограничено: ' + (Date.now() - t0));
    const res = await page.evaluate(() => Promise.all(['https://example.com/a.png', 'https://premier-assets.invalid/blocked-not-asset'].map((u) => fetch(u, { mode: 'no-cors' }).then(() => 'ok', () => 'blocked'))));
    assert.deepEqual(res, ['blocked', 'blocked'], 'чужой сайт закрыт фильтром');
  }, { assetResolver: (u) => (u === 'https://premier-assets.invalid/x.html' ? { contentType: 'text/html', body: Buffer.from('<!doctype html><html><body>x</body></html>') } : null), filter: anim.netAllowed });
});
const FAKE = (body) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'premier-fakeff-')), 'ffmpeg'); fs.writeFileSync(f, '#!/bin/sh\nif [ "$1" = "-version" ]; then echo fake; exit 0; fi\n' + body + '\n', { mode: 0o755 }); return f; };
const BIG = `<!doctype html><html><head><meta name="premier-animation" content="duration=2; fps=20; width=1280; height=720"><style>html,body{margin:0;height:100%;background:linear-gradient(90deg,#f0f,#0ff,#ff0)}</style></head><body><script>const c=document.createElement('canvas');c.width=1280;c.height=720;document.body.appendChild(c);const x=c.getContext('2d');function f(t){for(let i=0;i<4000;i++){x.fillStyle='hsl('+((i*7+t/10)%360)+',90%,50%)';x.fillRect((i*37)%1280,(i*91)%720,30,30)}requestAnimationFrame(f)}requestAnimationFrame(f)</script></body></html>`;
test('ffmpeg завершился посреди записи (в том числе пока запись ждёт drain): ошибка с текстом ffmpeg, без зависания и без .part', { skip: SKIP, timeout: 90000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'premier-anim-')), prev = process.env.FFMPEG_PATH;
  t.after(() => { if (prev === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = prev; fs.rmSync(dir, { recursive: true, force: true }); browser.close().catch(() => {}); });
  const params = anim.parseMeta(BIG);
  for (const body of ['sleep 1\necho "fake-ffmpeg: boom" >&2\nexit 1', 'head -c 2000 >/dev/null\necho "fake-ffmpeg: early exit" >&2\nexit 1']) {
    process.env.FFMPEG_PATH = FAKE(body);
    const t0 = Date.now(), out = path.join(dir, 'x.mp4');
    await assert.rejects(anim.render(browser, BIG, params, { outFile: out }), (e) => /fake-ffmpeg: (boom|early exit)/.test(e.message) && e.code === 'ffmpeg');
    assert.ok(Date.now() - t0 < 30000, 'не завис: ' + (Date.now() - t0)); assert.ok(!fs.existsSync(out + '.part'));
  }
});
test('отмена записи: render останавливается по сигналу, ffmpeg убит, .part удалён', { skip: SKIP, timeout: 90000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'premier-anim-')); t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); browser.close().catch(() => {}); });
  const long = TINY.replace('duration=1; fps=20', 'duration=30; fps=30'), ctl = new AbortController(), out = path.join(dir, 'long.mp4');
  const p = anim.render(browser, long, anim.parseMeta(long), { outFile: out, signal: ctl.signal, onProgress: (x) => { if (x > 2) ctl.abort(); } });
  const t0 = Date.now(); await assert.rejects(p, (e) => e.code === 'cancelled');
  assert.ok(Date.now() - t0 < 20000); assert.ok(!fs.existsSync(out + '.part')); assert.ok(!fs.existsSync(out));
  assert.equal(spawnSync('pgrep', ['-f', dir]).status, 1, 'процессов ffmpeg с этим файлом нет');
});
test('остановка сервера: shutdown() убивает живой ffmpeg и удаляет .part', { skip: SKIP, timeout: 90000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'premier-anim-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const long = TINY.replace('duration=1; fps=20', 'duration=30; fps=30'), out = path.join(dir, 'long.mp4');
  const child = `const a=require(${JSON.stringify(path.join(ROOT, 'animation.js'))}),b=require(${JSON.stringify(path.join(ROOT, 'browser.js'))});
    let done=false;a.render(b,${JSON.stringify(long)},a.parseMeta(${JSON.stringify(long)}),{outFile:${JSON.stringify(out)},onProgress:(p)=>{if(p>2&&!done){done=true;console.log('RUNNING');process.exit(0)}}}).catch(e=>{console.log('ERR '+e.message);process.exit(1)})`;
  const r = spawnSync(process.execPath, ['-e', child], { encoding: 'utf8', timeout: 60000, env: process.env });
  assert.match(r.stdout, /RUNNING/, r.stdout + r.stderr);
  await new Promise((x) => setTimeout(x, 300));
  assert.equal(spawnSync('pgrep', ['-f', dir]).status, 1, 'ffmpeg не остался после выхода'); assert.ok(!fs.existsSync(out + '.part'));
});
test('prune: убирает папки без готового файла (пустые и только с .part), оставляет свежие и готовые', () => {
  const uid = 'prune-test-' + process.pid, base = path.join(ROOT, 'data', 'files', uid); t_cleanup(base);
  const mk = (fid, files, age) => { const d = path.join(base, fid); fs.mkdirSync(d, { recursive: true }); for (const f of files) fs.writeFileSync(path.join(d, f), 'x'.repeat(2000)); if (age) { const old = new Date(Date.now() - age); fs.utimesSync(d, old, old); } };
  mk('a'.repeat(16), [], 3600e3); mk('b'.repeat(16), ['animation.mp4.part'], 3600e3); mk('c'.repeat(16), ['animation.mp4.part'], 0); mk('d'.repeat(16), ['animation.mp4'], 3600e3);
  anim.prune(uid);
  assert.ok(!fs.existsSync(path.join(base, 'a'.repeat(16))), 'пустая'); assert.ok(!fs.existsSync(path.join(base, 'b'.repeat(16))), 'старая с .part');
  assert.ok(fs.existsSync(path.join(base, 'c'.repeat(16))), 'свежая запись не трогается'); assert.ok(fs.existsSync(path.join(base, 'd'.repeat(16), 'animation.mp4')));
});
function t_cleanup(dir) { process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true })); }
test('параллельные записи: не больше вкладок браузера минус одна (чату остаётся вкладка)', async () => {
  const prev = process.env.ANIM_RENDER_CONCURRENCY; process.env.ANIM_RENDER_CONCURRENCY = '4';
  try {
    const mk = (maxPages) => anim.createAnimationApi({ browser: { maxPages, available: () => true }, json() {}, readBody() {}, currentUser: () => null, limited: () => false, hit() {}, resolver: null }).state().slots;
    assert.equal(mk(2), 1); assert.equal(mk(1), 1); assert.equal(mk(3), 2); assert.equal(mk(8), 4);
    process.env.ANIM_RENDER_CONCURRENCY = '2'; assert.equal(mk(8), 2);
  } finally { if (prev === undefined) delete process.env.ANIM_RENDER_CONCURRENCY; else process.env.ANIM_RENDER_CONCURRENCY = prev; }
  assert.equal(require('../browser').maxPages >= 1, true);
});
test('API: DELETE /api/animation/render/:id — только владелец, останавливает запись и очередь', { skip: SKIP, timeout: 120000 }, async (t) => {
  const dir = copyApp(); seed(dir, { users: [{ id: 'u1', login: 'anna', email: 'a@example.com', created: '2026-01-01T00:00:00Z' }, { id: 'u2', login: 'bob', email: 'b@example.com', created: '2026-01-01T00:00:00Z' }], sessions: { tok1: 'u1', tok2: 'u2' } });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  const srv = await startServer(dir, { CHROMIUM_PATH: process.env.CHROMIUM_PATH || '', BROWSER_NO_SANDBOX: process.env.BROWSER_NO_SANDBOX || '', ANIM_RENDER_CONCURRENCY: '1' });
  t.after(async () => { await srv.stop(); rm(dir); });
  const long = (n) => TINY.replace('duration=1; fps=20', 'duration=' + n + '; fps=30');
  const post = (html, token) => srv.req('POST', '/api/animation/render', { body: { html }, token }), del = (id, token) => srv.req('DELETE', '/api/animation/render/' + id, { token });
  const a = await post(long(30), 'tok1'), b = await post(long(31), 'tok2'); assert.equal(a.status, 202); assert.equal(b.status, 202);
  assert.equal((await del(a.json.id)).status, 401); assert.equal((await del(a.json.id, 'tok2')).status, 404, 'чужую запись остановить нельзя');
  assert.equal((await del('0123456789abcdef', 'tok1')).status, 404);
  const q = await srv.req('GET', '/api/animation/render/' + b.json.id, { token: 'tok2' }); assert.equal(q.json.status, 'queued');
  const dq = await del(b.json.id, 'tok2'); assert.equal(dq.status, 200); assert.equal(dq.json.code, 'cancelled');
  assert.equal((await srv.req('GET', '/api/animation/render/' + b.json.id, { token: 'tok2' })).json.code, 'cancelled');
  const da = await del(a.json.id, 'tok1'); assert.equal(da.status, 200); assert.equal(da.json.status, 'error'); assert.equal(da.json.code, 'cancelled');
  // слот освобождается: новая запись того же человека принимается (после остановки идущей)
  let again; for (let i = 0; i < 60; i++) { again = await post(TINY, 'tok1'); if (again.status !== 429) break; await new Promise((r) => setTimeout(r, 500)); }
  assert.ok([200, 202].includes(again.status), again.text);
  let j; for (let i = 0; i < 120; i++) { j = (await srv.req('GET', '/api/animation/render/' + again.json.id, { token: 'tok1' })).json; if (j.status === 'done') break; await new Promise((r) => setTimeout(r, 500)); }
  assert.equal(j.status, 'done', JSON.stringify(j));
  assert.equal(spawnSync('pgrep', ['-f', path.join(dir, 'data', 'files', 'u1', a.json.id)]).status, 1, 'ffmpeg отменённой записи не остался');
});
test('настройки: старый ключ settings.video удаляется при запуске (один раз)', async () => {
  const dir = copyApp(); seed(dir);
  const run = (code) => spawnSync(process.execPath, ['-e', code], { cwd: dir, encoding: 'utf8' }).stdout.trim();
  run("const s=require('./db');s.kv.set('settings',{provider:'duckduckgo',video:{apiKey:'sk-old-secret',baseUrl:'https://x'},defaultModel:'m1'})");
  const srv = await startServer(dir); await srv.stop();
  assert.equal(run("const s=require('./db');console.log(JSON.stringify(s.kv.get('settings',{})))"), JSON.stringify({ provider: 'duckduckgo', defaultModel: 'm1' }));
  rm(dir);
});
