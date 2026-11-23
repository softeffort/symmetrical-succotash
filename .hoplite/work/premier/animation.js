'use strict';
// Premier — «видео кодом»: запись HTML/CSS/SVG/Canvas-анимации в MP4.
// Модель пишет анимацию как обычный артефакт (<meta name="premier-animation" content="duration=8; fps=30; width=1920; height=1080">),
// пользователь смотрит её вживую, а кнопка «Скачать MP4» вызывает этот модуль: страница открывается в Chromium (browser.js)
// с виртуальными часами, кадры снимаются по одному (время шагает ровно на 1000/fps мс) и уходят в ffmpeg. Результат
// детерминирован и не зависит от скорости сервера: тот же HTML даёт то же число кадров и тот же MP4.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, 'data');
const num = (v, def, min, max) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
// Пределы: длительность, кадров в секунду, размер, общее число кадров, время рендера, размер HTML, число хранимых роликов на человека.
const LIM = {
  maxSeconds: 60, maxFps: 60, maxSide: 1920, minSide: 128,
  get maxFrames() { return Math.floor(num(process.env.ANIM_MAX_FRAMES, 1800, 30, 7200)); },
  get timeoutMs() { return Math.floor(num(process.env.ANIM_RENDER_TIMEOUT, 480, 20, 3600)) * 1000; },
  get concurrency() { return Math.floor(num(process.env.ANIM_RENDER_CONCURRENCY, 1, 1, 4)); },
  get queueMax() { return Math.floor(num(process.env.ANIM_QUEUE_MAX, 20, 1, 200)); },
  get keep() { return Math.floor(num(process.env.ANIM_KEEP, 10, 1, 100)); },
  maxHtml: 2 * 1024 * 1024, maxFileBytes: 200e6,
};
const DEFAULTS = { duration: 8, fps: 30, width: 1920, height: 1080 };
const VERSION = 'r1'; // меняется при смене способа записи: старый кэш перестаёт подходить

const META = /<meta\b[^>]*\bname\s*=\s*["']?premier-animation["']?[^>]*>/i;
const hasAnimation = (html) => META.test(String(html || ''));

// Параметры из <meta name="premier-animation" content="duration=8; fps=30; width=1920; height=1080">.
// Нет мета-тега — значения по умолчанию. Всё, что выходит за пределы, приводится к допустимому, а не отвергается.
function parseMeta(html) {
  const tag = META.exec(String(html || ''))?.[0] || '';
  const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
  const raw = content ? (content[1] ?? content[2] ?? content[3] ?? '') : '';
  const kv = {};
  for (const part of raw.split(/[;,]/)) {
    const m = /^\s*([a-z]+)\s*[=:]\s*([^\s]+)\s*$/i.exec(part); if (m) kv[m[1].toLowerCase()] = m[2];
  }
  const size = /^(\d{2,5})x(\d{2,5})$/i.exec(kv.size || '');
  let duration = parseFloat(kv.duration ?? kv.seconds), fps = parseFloat(kv.fps);
  let width = parseInt(kv.width ?? (size && size[1]), 10), height = parseInt(kv.height ?? (size && size[2]), 10);
  const clamped = [];
  if (!(duration > 0)) duration = DEFAULTS.duration;
  if (!(fps > 0)) fps = DEFAULTS.fps;
  if (!(width > 0) || !(height > 0)) { width = DEFAULTS.width; height = DEFAULTS.height; }
  const side = (v) => Math.floor(Math.min(LIM.maxSide, Math.max(LIM.minSide, v)) / 2) * 2; // чётные стороны нужны yuv420p
  const w = side(width), h = side(height); if (w !== width || h !== height) clamped.push('size');
  if (duration > LIM.maxSeconds) { duration = LIM.maxSeconds; clamped.push('duration'); }
  duration = Math.max(0.5, duration);
  fps = Math.round(Math.min(LIM.maxFps, Math.max(10, fps)));
  let frames = Math.max(1, Math.round(duration * fps));
  if (frames > LIM.maxFrames) { // сначала снижаем частоту кадров (не ниже 10), потом режем длительность
    fps = Math.max(10, Math.floor(LIM.maxFrames / duration));
    frames = Math.round(duration * fps);
    if (frames > LIM.maxFrames) { frames = LIM.maxFrames; duration = frames / fps; }
    clamped.push('frames');
  }
  return { duration, fps, width: w, height: h, frames, declared: META.test(String(html || '')), clamped };
}

/* ---------- виртуальные часы (выполняются внутри страницы до её скриптов) ---------- */
function clockInit(seed) {
  if (window.__premierTick) return;
  const BASE = Date.UTC(2026, 0, 1, 12, 0, 0);
  let now = 0, rid = 0, tid = 0;
  const rafs = new Map(), timers = new Map(), tracked = new WeakMap();
  const RealDate = Date, realSetTimeout = window.setTimeout.bind(window); // настоящий таймер нужен только для ожидания загрузки ресурсов
  // Proxy, а не class: Date() без new обязан вернуть строку, new Date() — виртуальное время, остальное — как у настоящего Date
  window.Date = new Proxy(RealDate, {
    construct: (t, a, nt) => Reflect.construct(t, a.length ? a : [BASE + now], nt),
    apply: () => new RealDate(BASE + now).toString(),
    get: (t, k) => (k === 'now' ? () => Math.floor(BASE + now) : Reflect.get(t, k)),
  });
  // сеть для страницы закрыта: WebSocket и EventSource не нужны ролику (запросы в сеть режет браузерный фильтр)
  for (const name of ['WebSocket', 'EventSource']) { try { window[name] = function () { throw new DOMException('Сеть недоступна при записи видео', 'SecurityError'); }; } catch (e) { /* ignore */ } }
  try { performance.now = () => now; } catch (e) { /* ignore */ }
  try { Object.defineProperty(document.timeline, 'currentTime', { get: () => now, configurable: true }); } catch (e) { /* ignore */ }
  let s = seed >>> 0; // mulberry32: Math.random повторяется от записи к записи
  Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  window.requestAnimationFrame = (cb) => { const id = ++rid; rafs.set(id, cb); return id; };
  window.cancelAnimationFrame = (id) => { rafs.delete(id); };
  const add = (fn, ms, args, every) => {
    if (typeof fn !== 'function') { const code = String(fn); fn = () => (0, eval)(code); }
    const d = Math.max(0, Number(ms) || 0), id = ++tid;
    timers.set(id, { fn, args, at: now + d, every: every ? Math.max(1, d) : null });
    return id;
  };
  window.setTimeout = (fn, ms, ...args) => add(fn, ms, args, false);
  window.setInterval = (fn, ms, ...args) => add(fn, ms, args, true);
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };
  const fail = (e) => { queueMicrotask(() => { throw e; }); };
  // CSS-анимации, transitions и Web Animations ставим на паузу и каждый кадр задаём им время сами
  const sync = () => {
    for (const a of document.getAnimations()) {
      let st = tracked.get(a);
      if (!st) { st = { start: now, skip: a.playState === 'paused' }; tracked.set(a, st); }
      if (st.skip) {
        if (a.playState === 'paused') continue; // запущена позже: ведём её с того места, где она была
        st.skip = false; st.start = now - (Number(a.currentTime) || 0) / (a.playbackRate || 1);
      }
      try { if (a.playState !== 'paused') a.pause(); a.currentTime = (now - st.start) * (a.playbackRate || 1); } catch (e) { /* ignore */ }
    }
  };
  window.__premierTick = (dt) => {
    const T = now + Math.max(0, dt);
    for (let round = 0; round < 60; round++) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= T).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
      if (!due.length) break;
      for (const [id, t] of due) {
        if (!timers.has(id)) continue;
        now = Math.max(now, t.at);
        if (t.every != null) t.at = now + t.every; else timers.delete(id);
        try { t.fn(...t.args); } catch (e) { fail(e); }
      }
    }
    now = T;
    const cbs = [...rafs.values()]; rafs.clear();
    for (const cb of cbs) { try { cb(now); } catch (e) { fail(e); } }
    sync();
    return now;
  };
  // Ждём шрифты и картинки не дольше нескольких секунд настоящего времени (виртуальный setTimeout здесь не идёт);
  // ленивые <img loading=lazy> делаем обычными, иначе за экраном они не загрузятся никогда.
  window.__premierReady = async (capMs) => {
    const cap = new Promise((r) => realSetTimeout(r, capMs || 4000));
    const loaded = (async () => {
      try { await document.fonts.ready; } catch (e) { /* ignore */ }
      for (const i of document.images) { try { i.loading = 'eager'; } catch (e) { /* ignore */ } }
      await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.addEventListener('load', r); i.addEventListener('error', r); }))));
    })();
    await Promise.race([loaded, cap]);
    return true;
  };
}

/* ---------- ffmpeg ---------- */
const FFMPEG = () => process.env.FFMPEG_PATH || 'ffmpeg';
let ffState = { at: 0, ok: false };
function ffmpegAvailable() {
  if (ffState.ok || Date.now() - ffState.at < 30000) return ffState.ok;
  let ok = false;
  try { ok = spawnSync(FFMPEG(), ['-version'], { timeout: 5000, stdio: 'ignore' }).status === 0; } catch { ok = false; }
  ffState = { at: Date.now(), ok };
  return ok;
}
function ffmpegArgs({ fps, width, height }, out) {
  return ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-an',
    // JPEG из Chromium — полный диапазон и матрица BT.601; для видео переводим в BT.709, ограниченный диапазон
    '-vf', `scale=${width}:${height}:in_range=full:in_color_matrix=bt601:out_range=tv:out_color_matrix=bt709,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-movflags', '+faststart', '-fs', String(LIM.maxFileBytes), '-f', 'mp4', out];
}

// Во время записи страница ходит в сеть только за своими ресурсами (assetResolver) и на эти CDN; всё остальное режется.
const HOSTS = ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'esm.sh', 'ajax.googleapis.com'];
function netAllowed(url) {
  if (/^(data|blob|about):/i.test(url)) return true;
  let u; try { u = new URL(url); } catch { return false; }
  return u.protocol === 'https:' && !u.username && !u.password && !u.port && HOSTS.includes(u.hostname.toLowerCase());
}
// живые процессы ffmpeg и недописанные файлы: при остановке сервера убираем
const LIVE = new Set();
function shutdown() {
  for (const x of LIVE) { try { x.ff.kill('SIGKILL'); } catch {} try { fs.rmSync(x.part, { force: true }); } catch {} }
  LIVE.clear();
}
process.on('exit', shutdown);
const ORIGIN = 'https://premier-assets.invalid';
const PAGE_URL = ORIGIN + '/__animation.html';
const errText = (e) => String(e?.message || e).split('\n')[0];

// Снимает кадры страницы и кладёт их в ffmpeg. Возвращает { file, size, frames }.
// html — уже обработанный (rewrite моделей); assetResolver — как у предпросмотра.
async function render(browser, html, params, { assetResolver = null, outFile, signal, onProgress = () => {}, seed = 1 } = {}) {
  if (!browser.available()) throw Object.assign(new Error('Браузер не установлен на сервере'), { code: 'no_browser' });
  if (!ffmpegAvailable()) throw Object.assign(new Error('ffmpeg не установлен на сервере'), { code: 'no_ffmpeg' });
  const { fps, width, height, frames } = params;
  const deadline = Date.now() + LIM.timeoutMs;
  const part = outFile + '.part';
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  let ff = null, ffErr = '', ffDone = null, ffClosed = null, live = null;
  const ffLast = () => ffErr.trim().split('\n').filter(Boolean).pop() || '';
  // ffmpeg завершился раньше времени: «файл слишком большой» (-fs) или его собственная ошибка
  const ffFailure = () => {
    let big = false; try { big = fs.statSync(part).size >= LIM.maxFileBytes * 0.98; } catch {}
    return Object.assign(new Error(big ? 'видео получилось слишком большим (больше ' + Math.round(LIM.maxFileBytes / 1e6) + ' МБ): сделайте ролик короче или проще' : 'ffmpeg: ' + (ffLast() || (ffClosed != null ? 'код ' + ffClosed : 'остановился'))), { code: big ? 'too_big' : 'ffmpeg' });
  };
  try {
    ff = spawn(FFMPEG(), ffmpegArgs(params, part), { stdio: ['pipe', 'ignore', 'pipe'] });
    live = { ff, part }; LIVE.add(live);
    ff.stderr.on('data', (d) => { if (ffErr.length < 2000) ffErr += d; });
    let stdinErr = null; ff.stdin.on('error', (e) => { stdinErr = e; });
    ffDone = new Promise((res, rej) => { ff.on('error', rej); ff.on('close', (code) => { ffClosed = code; if (code === 0) res(); else rej(ffFailure()); }); });
    ffDone.catch(() => {});
    const onAbort = () => { try { ff.kill('SIGKILL'); } catch {} };
    signal?.addEventListener('abort', onAbort, { once: true });
    // запись ждёт сброса буфера, но не вечно: если ffmpeg закрылся (ошибка, -fs), ожидание завершается ошибкой
    const write = (buf) => new Promise((res, rej) => {
      if (signal?.aborted) return rej(new Error('остановлено'));
      if (stdinErr || ffClosed != null) return rej(ffFailure());
      if (ff.stdin.write(buf)) return res();
      const off = () => { ff.stdin.off('drain', ok); ff.stdin.off('error', no); ff.off('close', no); };
      const ok = () => { off(); res(); }, no = () => { off(); rej(signal?.aborted ? new Error('остановлено') : ffFailure()); };
      ff.stdin.once('drain', ok); ff.stdin.once('error', no); ff.once('close', no);
    });
    const proxied = (url) => {
      if (url === PAGE_URL) return { contentType: 'text/html; charset=utf-8', body: Buffer.from(html), headers: { 'cache-control': 'no-store' } };
      return assetResolver ? assetResolver(url) : null;
    };
    await browser.withPage(async (page) => {
      const isPuppeteer = typeof page.evaluateOnNewDocument === 'function';
      if (isPuppeteer) await page.evaluateOnNewDocument(clockInit, seed); else await page.addInitScript(clockInit, seed);
      await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 25000 });
      await page.evaluate(() => window.__premierReady(4000));
      // «прогрев» без хода времени: скрипты и отложенные setTimeout(0) успевают инициализироваться
      for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__premierTick(0)); await new Promise((r) => setTimeout(r, 40)); }
      let t = 0;
      for (let i = 0; i < frames; i++) {
        if (signal?.aborted) throw new Error('остановлено');
        if (Date.now() > deadline) throw Object.assign(new Error('рендер не уложился в отведённое время'), { code: 'timeout' });
        const target = (i * 1000) / fps;
        await page.evaluate((dt) => window.__premierTick(dt), target - t); t = target;
        const buf = await page.screenshot(isPuppeteer
          ? { type: 'jpeg', quality: 92, optimizeForSpeed: true, captureBeyondViewport: false }
          : { type: 'jpeg', quality: 92 });
        await write(Buffer.from(buf));
        if (i % 5 === 0 || i === frames - 1) onProgress(Math.min(98, Math.floor(((i + 1) / frames) * 98)));
      }
    }, { width, height, assetResolver: proxied, timeout: LIM.timeoutMs + 15000, filter: netAllowed });
    if (signal?.aborted) throw new Error('остановлено');
    ff.stdin.end();
    await ffDone;
    const size = fs.statSync(part).size;
    if (size < 1000) throw new Error('ffmpeg вернул пустой файл');
    fs.renameSync(part, outFile);
    onProgress(100);
    return { file: outFile, size, frames };
  } catch (e) {
    try { ff?.kill('SIGKILL'); } catch {}
    fs.rmSync(part, { force: true });
    if (signal?.aborted) throw Object.assign(new Error('остановлено'), { code: 'cancelled' });
    // обрыв записи в ffmpeg (EPIPE и т. п.) — показываем причину от самого ffmpeg
    if (e.code === 'EPIPE' || e.code === 'ERR_STREAM_DESTROYED' || e.code === 'ERR_STREAM_WRITE_AFTER_END') throw ffFailure();
    throw e;
  } finally {
    if (live) LIVE.delete(live);
  }
}

/* ---------- файлы пользователя: data/files/<uid>/<fid>/animation.mp4 (отдаётся /api/files/<fid>/animation.mp4) ---------- */
const NAME = 'animation.mp4';
const dirOf = (uid, fid) => path.join(ROOT, 'files', uid, fid);
// Один и тот же HTML с теми же параметрами всегда попадает в одну папку — повторный клик берёт готовый файл.
const fidOf = (uid, html, p) => crypto.createHash('sha256')
  .update([VERSION, uid, html, p.fps, p.width, p.height, p.frames].join('\0')).digest('hex').slice(0, 16);
function cached(uid, fid) {
  const f = path.join(dirOf(uid, fid), NAME);
  try { const st = fs.statSync(f); if (st.size > 1000) { fs.utimesSync(f, new Date(), new Date()); return { file: f, size: st.size }; } } catch {}
  return null;
}
const urlOf = (fid) => `/api/files/${fid}/${NAME}`;
// хранить не больше LIM.keep роликов на человека: самые давние удаляются (папки, где только наш файл)
function prune(uid) {
  const base = path.join(ROOT, 'files', uid);
  let list = [];
  try {
    list = fs.readdirSync(base).map((fid) => ({ fid, f: path.join(base, fid, NAME) }))
      .filter((x) => /^[a-f0-9]{16}$/.test(x.fid) && fs.existsSync(x.f))
      .map((x) => ({ ...x, at: fs.statSync(x.f).mtimeMs })).sort((a, b) => b.at - a.at);
  } catch { return; }
  // папки неудавшихся записей: пустые или только с .part (старше лимита времени записи, чтобы не тронуть идущую)
  try {
    for (const fid of fs.readdirSync(base)) {
      if (!/^[a-f0-9]{16}$/.test(fid)) continue;
      const d = path.join(base, fid), names = fs.readdirSync(d);
      if (names.every((n) => n === NAME + '.part') && Date.now() - fs.statSync(d).mtimeMs > LIM.timeoutMs + 60e3) fs.rmSync(d, { recursive: true, force: true });
    }
  } catch {}
  for (const x of list.slice(LIM.keep)) {
    try {
      const d = path.dirname(x.f);
      if (fs.readdirSync(d).every((n) => n === NAME || n === NAME + '.part')) fs.rmSync(d, { recursive: true, force: true }); else fs.rmSync(x.f, { force: true });
    } catch {}
  }
}

/* ---------- очередь и API ---------- */
// deps: browser, json, readBody, currentUser, limited, hit, resolver(uid, html), rewrite(html)
function createAnimationApi({ browser, json, readBody, currentUser, limited, hit, resolver, rewrite = (h) => h }) {
  const jobs = new Map(), byUser = new Map(), queue = [];
  let running = 0;
  // Одна-две вкладки браузера всегда остаются чату (самопроверка кода, веб-инструменты): записей одновременно не больше MAX_PAGES-1
  const slots = () => Math.max(1, Math.min(LIM.concurrency, (browser.maxPages || 2) - 1));
  const view = (j) => j.cancelled ? { id: j.id, status: 'error', progress: j.progress, error: 'Запись отменена', code: 'cancelled', params: { duration: j.params.duration, fps: j.params.fps, width: j.params.width, height: j.params.height } } : ({
    id: j.id, status: j.status, progress: j.progress, ...(j.status === 'queued' ? { position: queue.indexOf(j) + 1 } : {}),
    ...(j.status === 'done' ? { url: j.url, size: j.size, name: NAME, cached: !!j.cached } : {}),
    ...(j.status === 'error' ? { error: j.error, code: j.code } : {}),
    params: { duration: j.params.duration, fps: j.params.fps, width: j.params.width, height: j.params.height },
  });
  function finish(j, patch) {
    Object.assign(j, patch); j.ended = Date.now();
    if (byUser.get(j.uid) === j) byUser.delete(j.uid);
    for (const [id, x] of jobs) if (x.ended && Date.now() - x.ended > 10 * 60e3) jobs.delete(id);
  }
  function pump() {
    while (running < slots() && queue.length) {
      const j = queue.shift(); running++; j.status = 'running'; j.started = Date.now();
      const out = path.join(dirOf(j.uid, j.fid), NAME);
      render(browser, j.html, j.params, { assetResolver: j.assetResolver, outFile: out, signal: j.ctl.signal, onProgress: (p) => { j.progress = p; }, seed: parseInt(j.fid.slice(0, 6), 16) || 1 })
        .then((r) => { prune(j.uid); if (j.cancelled) return finish(j, { status: 'error', error: 'Запись отменена', code: 'cancelled' }); finish(j, { status: 'done', progress: 100, url: urlOf(j.fid), size: r.size }); })
        .catch((e) => finish(j, j.cancelled ? { status: 'error', error: 'Запись отменена', code: 'cancelled' } : { status: 'error', error: errText(e) || 'не удалось записать видео', code: e.code || 'render' }))
        .finally(() => { running--; j.html = null; j.assetResolver = null; pump(); });
    }
  }
  const fail = (res, status, code, error) => json(res, status, { error, code });

  async function handle(req, res, url) {
    const p = url.pathname, m = req.method;
    const u = currentUser(req); if (!u) return json(res, 401, { error: 'Войдите в аккаунт' });
    const poll = /^\/api\/animation\/render\/([a-f0-9]{16})$/.exec(p);
    if (poll && m === 'GET') {
      const j = jobs.get(poll[1]);
      if (!j || j.uid !== u.id) return fail(res, 404, 'not_found', 'Рендер не найден');
      return json(res, 200, view(j));
    }
    // отмена: только владелец; очередь — просто выходим, идущая запись — останавливается вместе с ffmpeg
    if (poll && m === 'DELETE') {
      const j = jobs.get(poll[1]);
      if (!j || j.uid !== u.id) return fail(res, 404, 'not_found', 'Рендер не найден');
      if (j.status === 'queued' || j.status === 'running') {
        j.cancelled = true; j.ctl.abort();
        const qi = queue.indexOf(j);
        if (qi >= 0) { queue.splice(qi, 1); finish(j, { status: 'error', error: 'Запись отменена', code: 'cancelled' }); j.html = null; j.assetResolver = null; }
      }
      return json(res, 200, view(j));
    }
    if (p === '/api/animation/render' && m === 'POST') {
      let b; try { b = await readBody(req, LIM.maxHtml + 4096); } catch (e) { return fail(res, e.status || 400, 'bad_request', e.message); }
      const html = typeof b?.html === 'string' ? b.html : '';
      if (!html.trim() || html.length > LIM.maxHtml) return fail(res, 400, 'bad_html', 'Нужен HTML анимации размером до 2 МБ');
      if (!/<\/html\s*>/i.test(html)) return fail(res, 400, 'bad_html', 'Код анимации ещё не готов: нет закрывающего </html>');
      if (!ffmpegAvailable()) return fail(res, 501, 'no_ffmpeg', 'Запись MP4 недоступна: на сервере не установлен ffmpeg');
      if (!browser.available()) return fail(res, 503, 'no_browser', 'Запись MP4 недоступна: на сервере не установлен встроенный браузер');
      const params = parseMeta(html), fid = fidOf(u.id, html, params);
      const old = byUser.get(u.id);
      if (old && old.fid === fid && !old.cancelled) return json(res, 202, view(old));
      if (old) return fail(res, 429, 'busy', 'Предыдущий ролик ещё записывается — дождитесь окончания');
      const base = { id: fid, uid: u.id, fid, params, progress: 0, created: Date.now() };
      const hitFile = cached(u.id, fid);
      if (hitFile) {
        const j = { ...base, status: 'done', progress: 100, url: urlOf(fid), size: hitFile.size, cached: true, ended: Date.now() };
        jobs.set(fid, j); return json(res, 200, view(j));
      }
      if (limited('anim:' + u.id, 40, 3600e3)) return fail(res, 429, 'rate', 'Слишком много записей за час, попробуйте позже');
      if (queue.length >= LIM.queueMax) return fail(res, 503, 'queue_full', 'Очередь записи заполнена, попробуйте через пару минут');
      hit('anim:' + u.id);
      const j = { ...base, ctl: new AbortController(), status: 'queued', html: rewrite(html), assetResolver: resolver ? resolver(u.id, html) : null };
      jobs.set(fid, j); byUser.set(u.id, j); queue.push(j); pump();
      return json(res, 202, view(j));
    }
    return json(res, 404, { error: 'Not found' });
  }
  return { handle, shutdown, state: () => ({ running, queued: queue.length, jobs: jobs.size, slots: slots() }) };
}

module.exports = { netAllowed, HOSTS, shutdown, parseMeta, hasAnimation, render, createAnimationApi, ffmpegAvailable, ffmpegArgs, clockInit, fidOf, cached, prune, LIM, DEFAULTS, NAME };
