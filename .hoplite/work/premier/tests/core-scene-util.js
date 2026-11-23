'use strict';
// Общее для проверок Ядра: запускает настоящий public/core/core-scene.js в Node — с маленькой заменой страницы
// (окно, документ, часы, которые двигает сама проверка) и, если передан пакет gl, с настоящим контекстом WebGL.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const tokensCss = fs.readFileSync(path.join(root, 'public/core/core-tokens.css'), 'utf8');
const darkBlock = tokensCss.slice(tokensCss.indexOf(':root{'), tokensCss.indexOf('@supports (cursor:'));
const lightBlock = tokensCss.slice(tokensCss.indexOf(':root[data-theme=light]{'), tokensCss.indexOf('/* ── «Уменьшить движение»'));
function token(theme, name) {
  const pick = (block) => { const m = block.match(new RegExp(name + ':([^;]+);')); return m ? m[1].trim() : null; };
  const v = (theme === 'light' ? pick(lightBlock) : null) || pick(darkBlock) || '', ref = /^var\((--[\w-]+)\)$/.exec(v);
  return ref ? token(theme, ref[1]) : v;
}

function makeScene(opt) {
  opt = Object.assign({ w: 1440, h: 900, dpr: 1, theme: 'dark', reduced: false, attrs: {}, gl: null, cpu: 8, mem: 8, coarse: false, storage: {}, hidden: false, coreUI: true }, opt || {});
  let clock = 0, seq = 1;
  const timers = new Map(), rafs = new Map(), state = { gl: null, canvas: null, theme: opt.theme, reduced: opt.reduced, light: [], events: [] };
  function emitter(t) {
    const ls = {};
    t.addEventListener = (n, f) => { (ls[n] = ls[n] || []).push(f); };
    t.removeEventListener = (n, f) => { ls[n] = (ls[n] || []).filter((x) => x !== f); };
    t.dispatchEvent = (e) => { (ls[e.type] || []).slice().forEach((f) => f(e)); return true; };
    t._ls = ls; return t;
  }
  function element(tag) {
    const attrs = {};
    const el = emitter({ nodeType: 1, tagName: String(tag).toUpperCase(), children: [], className: '', isConnected: true, clientWidth: 0, clientHeight: 0, attrs,
      style: { setProperty(k, v) { el.style[k] = v; } }, classList: { contains: (c) => (' ' + el.className + ' ').includes(' ' + c + ' ') },
      getAttribute: (n) => (n in attrs ? attrs[n] : null), setAttribute: (n, v) => { attrs[n] = String(v); }, hasAttribute: (n) => n in attrs, removeAttribute: (n) => { delete attrs[n]; },
      appendChild: (c) => { el.children.push(c); return c; }, insertBefore: (c) => { el.children.unshift(c); return c; }, querySelector: () => null, querySelectorAll: () => [],
      getBoundingClientRect: () => el.rect || { left: 0, top: 0, width: 0, height: 0 } });
    return el;
  }
  function canvas() {
    const cv = element('canvas'); let w = 300, h = 150, gl = null, ext = null;
    cv.clientWidth = opt.w; cv.clientHeight = opt.h;
    cv.getContext = (kind, o) => {
      if (kind === '2d' || !opt.gl) return null;
      if (!gl) { gl = opt.gl(w, h, { preserveDrawingBuffer: true, alpha: false, antialias: false, depth: false, stencil: false }); ext = gl.getExtension('STACKGL_resize_drawingbuffer'); state.gl = gl; state.canvas = cv; state.options = o; }
      return gl;
    };
    Object.defineProperty(cv, 'width', { get: () => w, set: (v) => { w = v; if (gl) ext.resize(w, h); } });
    Object.defineProperty(cv, 'height', { get: () => h, set: (v) => { h = v; if (gl) ext.resize(w, h); } });
    return cv;
  }
  const html = element('html'), body = element('body'), host = element('div'), mqs = {};
  host.className = 'core-scene'; host.clientWidth = opt.w; host.clientHeight = opt.h;
  Object.keys(opt.attrs).forEach((k) => html.setAttribute(k, opt.attrs[k]));
  html.addEventListener('core:scene', (e) => state.events.push(e.detail.type));
  const doc = emitter({ documentElement: html, body, readyState: 'complete', hidden: opt.hidden, createElement: (t) => (t === 'canvas' ? canvas() : element(t)), querySelector: (s) => (s === '.core-scene' ? host : null), querySelectorAll: () => [] });
  const mq = (q) => emitter({ get matches() { return /reduced-motion/.test(q) ? state.reduced : /prefers-color-scheme: dark/.test(q) ? state.theme === 'dark' : /pointer:coarse/.test(q) ? opt.coarse : false; } });
  const win = emitter({
    document: doc, innerWidth: opt.w, innerHeight: opt.h, devicePixelRatio: opt.dpr, navigator: { hardwareConcurrency: opt.cpu, deviceMemory: opt.mem },
    localStorage: { getItem: (k) => (k in opt.storage ? opt.storage[k] : null), setItem: (k, v) => { opt.storage[k] = String(v); } },
    matchMedia: (q) => (mqs[q] = mqs[q] || mq(q)), getComputedStyle: () => ({ getPropertyValue: (n) => token(state.theme, n) }),
    requestAnimationFrame: (f) => { const id = seq++; rafs.set(id, f); return id; }, cancelAnimationFrame: (id) => { rafs.delete(id); },
    setTimeout: (f, ms) => { const id = seq++; timers.set(id, { at: clock + (ms || 0), f }); return id; }, clearTimeout: (id) => { timers.delete(id); },
    performance: { now: () => clock }, CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; }
  });
  if (opt.coreUI) win.CoreUI = { light: { set: (o, glide) => { state.light.push(Object.assign({ glide: !!glide }, o)); } } };
  win.window = win;
  // типизированные массивы — из этого же окружения: иначе пакет gl не узнаёт их и буферы остаются пустыми
  const ctx = vm.createContext(Object.assign(win, { Date: { now: () => 1700000000000 + clock }, Float32Array, Float64Array, Uint32Array, Uint8Array }));
  const file = path.join(root, 'public/core/core-scene.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  function frame() {   // один кадр экрана 60 Гц: сначала таймеры, затем кадры анимации
    clock += 1000 / 60;
    for (const [id, t] of Array.from(timers)) if (t.at <= clock) { timers.delete(id); t.f(); }
    const list = Array.from(rafs); rafs.clear(); for (const [, f] of list) f(clock);
  }
  return {
    Core: win.Core, win, doc, html, host, state, token: (n) => token(state.theme, n),
    advance(seconds) { for (let i = Math.round(seconds * 60); i > 0; i--) frame(); },
    pending: () => rafs.size + timers.size,
    focus(on) { html.dispatchEvent({ type: 'core:focus', detail: { on } }); },
    setReduced(v) { state.reduced = v; ((mqs['(prefers-reduced-motion: reduce)'] || {})._ls || {}).change && mqs['(prefers-reduced-motion: reduce)']._ls.change.forEach((f) => f({})); },
    setHidden(v) { doc.hidden = v; doc.dispatchEvent({ type: 'visibilitychange' }); },
    pixels() {
      const gl = state.gl; if (!gl) return null;
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, buf = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return { data: buf, w, h };
    }
  };
}

/* ── контраст текста на стекле, за которым нарисовано Ядро: размытие → фильтры backdrop-filter → заливка стекла → отсвет ── */
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const color = (s) => { let m = /^#([0-9a-f]{6})$/i.exec(s); if (m) return { rgb: [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)), a: 1 }; m = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(s); return { rgb: [+m[1], +m[2], +m[3]], a: m[4] == null ? 1 : +m[4] }; };
const cut = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
function blur(src, w, h, sigma) {   // три прохода усреднения ≈ размытие по Гауссу
  const r = Math.max(1, Math.round(sigma * 0.88)); let a = Float32Array.from(src), b = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) { let s = 0; for (let x = -r; x <= r; x++) s += a[y * w + Math.min(w - 1, Math.max(0, x))]; for (let x = 0; x < w; x++) { b[y * w + x] = s / (2 * r + 1); s += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)]; } }
    for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += b[Math.min(h - 1, Math.max(0, y)) * w + x]; for (let y = 0; y < h; y++) { a[y * w + x] = s / (2 * r + 1); s += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x]; } }
  }
  return a;
}
// наименьший контраст трёх уровней текста на четырёх стёклах по всему кадру; scale — пикселей холста на пиксель CSS
function lowestContrast(px, theme, scale) {
  const t = (n) => token(theme, '--core-' + n), N = px.w * px.h, ch = [0, 1, 2].map((c) => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = px.data[i * 4 + c]; return a; });
  const texts = ['text', 'text-2', 'text-3'].map((n) => lum(...color(t(n)).rgb)), sheen = { c: color(t('edge')).rgb, a: +t('sheen') }; let low = 99, where = '';
  for (const depth of ['near', 'mid', 'far', 'dense']) {
    const f = t('backdrop-' + depth), fill = color(t('glass-' + depth)), B = ch.map((c) => blur(c, px.w, px.h, parseFloat(t('blur-' + depth)) * scale));
    const con = +((/contrast\(([\d.]+)\)/.exec(f) || [0, 1])[1]), sat = +((/saturate\(([\d.]+)\)/.exec(f) || [0, 1])[1]), bm = /brightness\(([^)]+)\)/.exec(f), bright = bm ? (/var\(/.test(bm[1]) ? +t('bright-' + depth) : +bm[1]) : 1;
    for (let i = 0; i < N; i++) {
      let r = B[0][i], g = B[1][i], b = B[2][i];
      if (sat !== 1) { const R = r, G = g, V = b; r = cut((0.213 + 0.787 * sat) * R + (0.715 - 0.715 * sat) * G + (0.072 - 0.072 * sat) * V); g = cut((0.213 - 0.213 * sat) * R + (0.715 + 0.285 * sat) * G + (0.072 - 0.072 * sat) * V); b = cut((0.213 - 0.213 * sat) * R + (0.715 - 0.715 * sat) * G + (0.072 + 0.928 * sat) * V); }
      const px1 = [r, g, b].map((v, k) => { v = cut(cut(((v / 255 - 0.5) * con + 0.5) * 255) * bright); v = fill.rgb[k] * fill.a + v * (1 - fill.a); return sheen.c[k] * sheen.a + v * (1 - sheen.a); });
      const L = lum(px1[0], px1[1], px1[2]);
      texts.forEach((T, k) => { const c = T > L ? (T + 0.05) / (L + 0.05) : (L + 0.05) / (T + 0.05); if (c < low) { low = c; where = depth + ' / ' + ['text', 'text-2', 'text-3'][k]; } });
    }
  }
  return { low, where };
}
module.exports = { makeScene, lowestContrast, token, root };
