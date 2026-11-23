/* Premier · Core — Ядро: 3D-сцена за интерфейсом (шаг 2 редизайна). Описание: /CORE-DESIGN-SYSTEM.md, раздел 12.
   Без зависимостей и сборки: чистый WebGL 1, один вызов отрисовки на кадр, вся анимация считается в вершинном шейдере.
   Один глобальный объект Core. Подключается после core-ui.js, с defer; сама сцена запускается после загрузки страницы.
     состояние   Core.state('thinking')            rest · listening · thinking · answering · receded · still
     разовое     Core.pulse('flash')               flash · error · key
     форма       Core.form('torus') · Core.model('Имя модели')   — форма выводится из имени, без правки кода
     место       Core.place('horizon')             center · horizon · full · far · { x, y, size }
     цель        Core.target(элемент | {x, y} | null, { ax, ay })   — куда тянутся и текут точки
     всё сразу   Core.set({ state, model, place, target })
     качество    Core.quality('auto' | 'high' | 'mid' | 'low' | 'min')
     сведения    Core.info() · событие core:scene на <html>
     малые ядра  <span class="core-mini" data-core-model="Имя" data-core-cond="steady|flicker|dark"></span>
   Где 3D нет или оно не справляется — остаётся тихое свечение из core-scene.css, страница работает как обычно. */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.Core) return;
  var win = window, doc = document, root = doc.documentElement;
  var PI = Math.PI, TAU = PI * 2;

  /* ═══ 1. Общее: хеш, случайные числа с зерном, пружина ═══ */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mix(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  // FNV-1a: один и тот же текст даёт одно и то же число в любом браузере
  function hash(s) {
    var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0;   // перемешивание: короткие имена расходятся по формам ровно
  }
  // mulberry32
  function rng(seed) {
    var a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // критически затухающая пружина: устойчива при любом шаге, из любого положения приходит к цели без отскока
  function spring(s, to, w, dt) { var d = s.x - to, e = Math.exp(-w * dt), q = (s.v + w * d) * dt; s.x = to + (d + q) * e; s.v = (s.v - w * q) * e; }
  function sp(x) { return { x: x, v: 0 }; }
  function near(s, to, eps) { return Math.abs(s.x - to) < eps && Math.abs(s.v) < eps * 4; }

  /* ═══ 2. Формы. Каждая — облако в единичном шаре: «остов» (поверхность или линия, по которой форму узнают)
         и немного дымки внутри. v — четыре числа 0…1 из имени модели: пропорции и число частей внутри семейства.
         Порядок списка менять нельзя: от него зависит, какая форма достанется модели. ═══ */
  var FORM_IDS = ['sphere', 'torus', 'spiral', 'lattice', 'helix', 'knot', 'bloom', 'orbits', 'ribbon', 'vortex', 'crystal'];
  var T = [0, 0, 0];   // точка, которую заполняет генератор
  function onSphere(r) { var y = 2 * r() - 1, a = TAU * r(), s = Math.sqrt(1 - y * y); T[0] = s * Math.cos(a); T[1] = y; T[2] = s * Math.sin(a); }
  function gauss(r) { var u = r() || 1e-9; return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * r()); }
  function jitter(r, s) { T[0] += gauss(r) * s; T[1] += gauss(r) * s; T[2] += gauss(r) * s; }

  // tilt: наклон самой формы (до вращения, [вокруг X, вокруг Z]); view: наклон взгляда (после вращения)
  var FORMS = {
    sphere: { tilt: [0.3, 0.1], view: 0.24, make: function (v) {
      var inner = 0.5 + 0.14 * v[1], two = v[0] > 0.4, flat = 0.9 + 0.1 * v[2];
      return function (r, crisp) {
        var u = r(); onSphere(r);
        var rad = u < (crisp ? 0.78 : 0.5) ? 1 + gauss(r) * 0.02 : two && u < (crisp ? 1 : 0.7) ? inner + gauss(r) * 0.018 : u < 0.84 ? Math.pow(r(), 0.62) * 0.94 : Math.pow(r(), 0.6) * 0.34;
        T[0] *= rad; T[1] *= rad * flat; T[2] *= rad;
      };
    } },
    torus: { tilt: [0.34, 0.06], view: 0.92, make: function (v) {
      var R = 0.7, r0 = 0.2 + 0.13 * v[0];
      return function (r, crisp) {
        var a = TAU * r(), b;
        do { b = TAU * r(); } while (r() > (R + r0 * Math.cos(b)) / (R + r0));   // равномерно по поверхности
        var rr = r() < (crisp ? 1 : 0.74) ? r0 * (1 + gauss(r) * 0.03) : r0 * Math.sqrt(r()), c = R + rr * Math.cos(b);
        T[0] = c * Math.cos(a); T[1] = rr * Math.sin(b); T[2] = c * Math.sin(a);
      };
    } },
    spiral: { tilt: [0.12, 0], view: 0.86, make: function (v) {
      var arms = 2 + Math.floor(v[0] * 2.999), wind = 2.3 + 1.5 * v[1];
      return function (r, crisp) {
        if (r() < (crisp ? 0.14 : 0.12)) { onSphere(r); var q = Math.pow(r(), 0.55) * 0.26; T[0] *= q; T[1] *= q * 0.7; T[2] *= q; return; }
        var t = Math.pow(r(), 0.8), rad = 0.12 + 0.88 * t;
        var ang = Math.floor(r() * arms) * TAU / arms + wind * 2 * t + gauss(r) * (0.08 + 0.2 * (1 - t)) * (crisp ? 0.5 : 1);
        T[0] = rad * Math.cos(ang); T[1] = gauss(r) * 0.034 * (1.25 - t); T[2] = rad * Math.sin(ang);
      };
    } },
    lattice: { tilt: [0.62, 0.48], view: 0.3, make: function (v, crisp) {
      var n = crisp || v[0] < 0.62 ? 3 : 4, half = 0.62, step = 2 * half / (n - 1), round = v[1] > 0.72 && !crisp;
      return function (r) {
        for (;;) {
          var i = Math.floor(r() * n), j = Math.floor(r() * n), k = Math.floor(r() * n), c = [i, j, k];
          if (r() < 0.16) { T[0] = i * step - half; T[1] = j * step - half; T[2] = k * step - half; jitter(r, 0.012); }
          else { var ax = Math.floor(r() * 3); c[ax] = Math.floor(r() * (n - 1)) + r(); T[0] = c[0] * step - half; T[1] = c[1] * step - half; T[2] = c[2] * step - half; jitter(r, 0.006); }
          if (!round || T[0] * T[0] + T[1] * T[1] + T[2] * T[2] < half * half * 1.75) return;
        }
      };
    } },
    helix: { tilt: [0, 0.26], view: 0.16, make: function (v) {
      var strands = v[0] > 0.7 ? 3 : 2, turns = 1.2 + 0.8 * v[1], rad0 = 0.42 + 0.1 * v[2], rungs = Math.round(turns * 6);
      function at(t, k, f) { var a = turns * PI * t + k * TAU / strands, q = rad0 * (1 - 0.22 * t * t) * f; T[0] = q * Math.cos(a); T[1] = t * 0.98; T[2] = q * Math.sin(a); }
      return function (r, crisp) {
        var u = r(), k = Math.floor(r() * strands);
        if (u < (crisp ? 0.74 : 0.66)) { at(2 * r() - 1, k, 1); jitter(r, 0.012); }
        else if (u < (crisp ? 1 : 0.92)) { var t = (Math.floor(r() * rungs) + 0.5) / rungs * 2 - 1; at(t, k, strands === 2 ? 2 * r() - 1 : r()); jitter(r, 0.006); }
        else { at(2 * r() - 1, k, Math.sqrt(r()) * 1.25); jitter(r, 0.03); }
      };
    } },
    knot: { tilt: [0.3, 0], view: 0.9, make: function (v) {
      var pq = [[2, 3], [3, 2], [2, 5], [3, 4]][Math.floor(v[0] * 3.999)], p = pq[0], q = pq[1], tube = 0.04 + 0.02 * v[1];
      return function (r, crisp) {
        var f = TAU * r(), rr = 0.62 + 0.25 * Math.cos(q * f), cx = rr * Math.cos(p * f), cy = 0.27 * Math.sin(q * f), cz = rr * Math.sin(p * f);
        onSphere(r); var w = tube * (r() < (crisp ? 1 : 0.72) ? 1 + gauss(r) * 0.04 : Math.sqrt(r()));
        T[0] = cx + T[0] * w; T[1] = cy + T[1] * w; T[2] = cz + T[2] * w;
      };
    } },
    bloom: { tilt: [0.36, 0.16], view: 0.66, make: function (v) {
      var petals = 3 + Math.floor(v[0] * 4.999), depth = 0.44 + 0.18 * v[1], twist = (v[2] - 0.5) * 1.4;
      return function (r, crisp) {
        onSphere(r);
        if (r() < (crisp ? 0.12 : 0.2)) { var q = Math.pow(r(), 0.6) * 0.3; T[0] *= q; T[1] *= q; T[2] *= q; return; }
        var e = Math.sqrt(1 - T[1] * T[1]), phi = Math.atan2(T[2], T[0]) + twist * T[1];
        var rad = (1 - depth) + depth * (0.5 + 0.5 * Math.cos(petals * phi)) * Math.pow(e, 1.4);
        rad *= 1 + gauss(r) * 0.016; T[0] *= rad; T[1] *= rad * 0.82; T[2] *= rad;
      };
    } },
    orbits: { tilt: [0.2, 0.1], view: 0.5, make: function (v) {
      var n = 2 + Math.floor(v[0] * 2.999), ring = [];
      for (var k = 0; k < n; k++) ring.push({ R: 0.96 - 0.14 * k, ax: k * PI / n + 0.35 + v[1], az: k * 1.1 + v[2] * PI });
      return function (r, crisp) {
        if (r() < (crisp ? 0.16 : 0.13)) { onSphere(r); var q = Math.pow(r(), 0.55) * 0.25; T[0] *= q; T[1] *= q; T[2] *= q; return; }
        var o = ring[Math.floor(r() * n)], a = TAU * r(), R = o.R * (1 + gauss(r) * 0.01);
        T[0] = R * Math.cos(a); T[1] = gauss(r) * 0.011; T[2] = R * Math.sin(a); rotX(T, o.ax); rotZ(T, o.az);
      };
    } },
    ribbon: { tilt: [0.25, 0], view: 0.84, make: function (v) {
      var h = 1 + Math.floor(v[0] * 2.999), w0 = 0.3 + 0.08 * v[1];
      return function (r, crisp) {
        var u = TAU * r(), w = r() < (crisp ? 0.5 : 0.3) ? (r() < 0.5 ? -1 : 1) : 2 * r() - 1, ww = w0 * w, c = 0.72 + ww * Math.cos(h * u / 2);
        T[0] = c * Math.cos(u); T[1] = ww * Math.sin(h * u / 2); T[2] = c * Math.sin(u); jitter(r, 0.007);
      };
    } },
    vortex: { tilt: [0, 0.34], view: 0.2, make: function (v, crisp) {
      var lines = crisp ? 14 : 26 + Math.floor(v[0] * 18), turn = 2.1 + 0.8 * v[1], R = 0.78, H = 0.92;
      return function (r) {
        var u = r();
        if (u < 0.72) { var a0 = TAU * Math.floor(r() * lines) / lines, s = r(), a1 = a0 + turn;
          T[0] = mix(R * Math.cos(a0), R * Math.cos(a1), s); T[1] = mix(-H, H, s); T[2] = mix(R * Math.sin(a0), R * Math.sin(a1), s); jitter(r, 0.005); }
        else if (u < 0.92) { var a = TAU * r(), q = R * (1 + gauss(r) * 0.008); T[0] = q * Math.cos(a); T[1] = r() < 0.5 ? -H : H; T[2] = q * Math.sin(a); }
        else { onSphere(r); var w = Math.pow(r(), 0.6) * 0.16; T[0] *= w; T[1] *= w; T[2] *= w; }
      };
    } },
    crystal: { tilt: [0, 0.3], view: 0.2, make: function (v) {
      var n = 3 + Math.floor(v[0] * 3.999), b = 0.7, H = 0.9 + 0.1 * v[1], V = [], E = [], F = [], i;
      for (i = 0; i < n; i++) V.push([b * Math.cos(TAU * i / n), 0, b * Math.sin(TAU * i / n)]);
      V.push([0, H, 0], [0, -H, 0]);
      for (i = 0; i < n; i++) { var j = (i + 1) % n; E.push([i, j], [i, n], [i, n + 1]); F.push([i, j, n], [i, j, n + 1]); }
      return function (r, crisp) {
        var u = r(), a, c, d, s, t;
        if (u < (crisp ? 0.7 : 0.5)) { a = E[Math.floor(r() * E.length)]; s = r(); c = V[a[0]]; d = V[a[1]]; T[0] = mix(c[0], d[0], s); T[1] = mix(c[1], d[1], s); T[2] = mix(c[2], d[2], s); jitter(r, 0.005); }
        else if (u < (crisp ? 1 : 0.9)) { a = F[Math.floor(r() * F.length)]; s = Math.sqrt(r()); t = r(); var w0 = 1 - s, w1 = s * (1 - t), w2 = s * t;
          for (var k = 0; k < 3; k++) T[k] = V[a[0]][k] * w0 + V[a[1]][k] * w1 + V[a[2]][k] * w2; }
        else { a = E[Math.floor(r() * E.length)]; s = r(); c = V[a[0]]; d = V[a[1]]; T[0] = mix(c[0], d[0], s) * 0.4; T[1] = mix(c[1], d[1], s) * 0.4; T[2] = mix(c[2], d[2], s) * 0.4; rotY(T, PI / n); }
      };
    } }
  };
  function rotX(p, a) { var c = Math.cos(a), s = Math.sin(a), y = p[1], z = p[2]; p[1] = c * y - s * z; p[2] = s * y + c * z; }
  function rotY(p, a) { var c = Math.cos(a), s = Math.sin(a), x = p[0], z = p[2]; p[0] = c * x + s * z; p[2] = -s * x + c * z; }
  function rotZ(p, a) { var c = Math.cos(a), s = Math.sin(a), x = p[0], y = p[1]; p[0] = c * x - s * y; p[1] = s * x + c * y; }

  // Имя модели → форма. Семейство берётся от «рода» (первое слово: gpt, claude, gemini…), детали — от полного имени:
  // модели одного рода похожи, но не одинаковы; одна и та же модель всегда получает одну и ту же форму.
  function letters(s) {
    s = String(s == null ? '' : s).toLowerCase(); if (s.normalize) s = s.normalize('NFKD');
    var out = '', i, c, ch;
    for (i = 0; i < s.length; i++) { ch = s.charAt(i); c = s.charCodeAt(i); if ((c >= 48 && c <= 57) || ch.toUpperCase() !== ch || c > 0x2E7F) out += ch; else if (c < 0x300 || c > 0x36F) out += ' '; }
    return out.replace(/\s+/g, ' ').replace(/^ | $/g, '');
  }
  function formOf(name) {
    var key = letters(name); if (!key) return { form: FORM_IDS[0], seed: 0, v: [0.5, 0.5, 0.5, 0.5], model: '' };
    var kin = /^(\d+|[^\d ]+)/.exec(key)[1], seed = hash('v:' + key.replace(/ /g, '')), r = rng(seed);
    return { form: FORM_IDS[hash('f62:' + kin) % FORM_IDS.length], seed: seed, v: [r(), r(), r(), r()], model: String(name) };   // «f62» подобрано так, чтобы известные роды моделей заняли все одиннадцать форм
  }
  function shape(id) { return { form: FORMS[id] ? id : FORM_IDS[0], seed: 0, v: [0.5, 0.5, 0.5, 0.5], model: '' }; }

  // Облако из n точек. Точки упорядочены по месту (сектор вокруг оси, затем высота) и затем перемешаны одной и той же
  // перестановкой для всех форм: точка i в любой форме стоит в «том же» месте, поэтому формы перетекают, а не рассыпаются;
  // любой отрезок с начала массива — равномерная выборка, поэтому качество меняется числом рисуемых точек без пересчёта.
  var perms = {};
  function perm(n) {
    if (perms[n]) return perms[n];
    var p = new Uint32Array(n), r = rng(0xC0FFEE), i, j, t;
    for (i = 0; i < n; i++) p[i] = i;
    for (i = n - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = p[i]; p[i] = p[j]; p[j] = t; }
    return (perms[n] = p);
  }
  function cloud(f, n, crisp) {
    var def = FORMS[f.form], gen = def.make(f.v, crisp), r = rng((f.seed ^ hash(f.form)) >>> 0), raw = new Float32Array(n * 3), i, k, y, z;
    var ax = def.tilt[0] + (f.v[3] - 0.5) * 0.2, cx = Math.cos(ax), sx = Math.sin(ax), cz = Math.cos(def.tilt[1]), sz = Math.sin(def.tilt[1]);
    var key = crisp ? null : new Uint16Array(n), count = crisp ? null : new Uint32Array(48 * 64 + 1);
    for (i = 0; i < n; i++) {
      gen(r, crisp);
      y = cx * T[1] - sx * T[2]; z = sx * T[1] + cx * T[2];                    // наклон формы: вокруг X, затем вокруг Z
      raw[i * 3] = cz * T[0] - sz * y; raw[i * 3 + 1] = y = sz * T[0] + cz * y; raw[i * 3 + 2] = z;
      if (!crisp) { k = Math.min(47, Math.floor((Math.atan2(z, raw[i * 3]) + PI) / TAU * 48)) * 64 + clamp(Math.floor((y + 1.4) / 2.8 * 64), 0, 63); key[i] = k; count[k + 1]++; }
    }
    if (crisp) return raw;
    for (i = 1; i < count.length; i++) count[i] += count[i - 1];              // сортировка подсчётом: без сравнений, за один проход
    var out = new Float32Array(n * 3), p = perm(n), d;
    for (i = 0; i < n; i++) { d = p[count[key[i]]++] * 3; out[d] = raw[i * 3]; out[d + 1] = raw[i * 3 + 1]; out[d + 2] = raw[i * 3 + 2]; }
    return out;
  }

  /* ═══ 3. Цвета — только из токенов. Тема «бумага» определяется по яркости сцены: там точки — тушь, свет не складывается. ═══ */
  var theme = { paper: false, scene: [0.043, 0.039, 0.031], heat: [], point: [1, 0.545, 0.173], ash: [0.61, 0.58, 0.53], ramp: [], n: 0 };
  var DEF_HEAT = [[166, 58, 18], [232, 89, 12], [255, 139, 44], [255, 182, 92], [255, 240, 214]];
  function parseColor(s) {
    s = String(s || '').trim(); var m;
    if ((m = /^#([0-9a-f]{3})$/i.exec(s))) return [0, 1, 2].map(function (i) { return parseInt(m[1].charAt(i) + m[1].charAt(i), 16) / 255; });
    if ((m = /^#([0-9a-f]{6})/i.exec(s))) return [0, 2, 4].map(function (i) { return parseInt(m[1].substr(i, 2), 16) / 255; });
    if ((m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s))) return [m[1] / 255, m[2] / 255, m[3] / 255];
    return null;
  }
  function lin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
  function mix3(a, b, t) { return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]; }
  function css(c, a) { return 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + (a == null ? 1 : a) + ')'; }
  function readTheme() {
    var cs = win.getComputedStyle ? win.getComputedStyle(root) : null, i;
    function tok(n, d) { return (cs && parseColor(cs.getPropertyValue(n))) || d; }
    theme.scene = tok('--core-scene', [11 / 255, 10 / 255, 8 / 255]);
    for (i = 0; i < 5; i++) theme.heat[i] = tok('--core-heat-' + (i + 1), DEF_HEAT[i].map(function (v) { return v / 255; }));
    theme.point = tok('--core-point', theme.heat[2]); theme.ash = tok('--core-text-3', [0.61, 0.58, 0.53]);
    theme.paper = lum(theme.scene) > 0.4;
    // шкала накала точки: тёмная тема — уголёк → белое каление; бумага — тушь → тлеющая тушь → киноварь
    theme.ramp = theme.paper ? [theme.point, theme.point, mix3(theme.point, theme.heat[0], 0.4), theme.heat[0], theme.heat[1]] : theme.heat.slice();
    theme.n++;
  }

  /* ═══ 4. Малые ядра: те же формы на обычном 2D-холсте. Графический контекст не нужен, поэтому их может быть сколько угодно.
         Состояния: steady — ровно горит и медленно вращается; flicker — мерцает и остывает; dark — погасло, пепел.
         Находятся сами (по событию начала анимации-метки из core-scene.css) — вызывать ничего не нужно. ═══ */
  var minis = [], miniOf = typeof WeakMap === 'function' ? new WeakMap() : null, miniClouds = {}, miniTimer = 0, miniIO = null, miniMO = null, miniT0 = 0;
  var reduced = false, hidden = false;
  function miniCloud(f, n) { var k = f.form + ':' + f.seed + ':' + n; return miniClouds[k] || (miniClouds[k] = cloud(f, n, true)); }
  function miniAdd(el) {
    if (!miniOf || !el || el.nodeType !== 1 || miniOf.has(el)) return;
    var ring = null, host = el;
    if (el.classList.contains('core-ring')) {   // кольцо лимита: малое ядро встаёт внутрь кольца
      ring = el; host = doc.createElement('span'); host.className = 'core-mini core-mini--ring'; host.setAttribute('aria-hidden', 'true');
      miniOf.set(ring, true); ring.appendChild(host); ring.setAttribute('data-core-live', '');
    } else if (!el.classList.contains('core-mini')) return;
    var cv = doc.createElement('canvas'), ctx = cv.getContext && cv.getContext('2d'); if (!ctx) return;
    var it = { el: host, ring: ring, cv: cv, ctx: ctx, size: 0, dpr: 0, pts: null, key: '', off: (hash(host.getAttribute('data-core-model') || '') % 628) / 100 + minis.length * 0.7, seen: !miniIO, theme: -1, anim: false };
    miniOf.set(host, it); host.appendChild(cv); host.setAttribute('data-core-live', ''); if (!host.hasAttribute('aria-hidden') && !host.getAttribute('aria-label')) host.setAttribute('aria-hidden', 'true');
    minis.push(it);
    if (miniIO) miniIO.observe(host);
    if (miniMO) miniMO.observe(ring || host, { attributes: true, attributeFilter: ['data-core-model', 'data-core-form', 'data-core-cond', 'aria-valuenow', 'style', 'class'] });
    miniDraw(it, 0, true); miniWake();
  }
  function miniRead(it) {
    var h = it.el, r = it.ring, src = r && (r.getAttribute('data-core-model') || r.getAttribute('data-core-form')) ? r : h;
    var model = src.getAttribute('data-core-model'), f = model ? formOf(model) : shape(src.getAttribute('data-core-form') || 'sphere');
    var size = h.clientWidth || 20, dpr = Math.min(win.devicePixelRatio || 1, 2), n = Math.round(clamp(36 + size * 3.2, 60, 170)), key = f.form + ':' + f.seed + ':' + n;
    if (size !== it.size || dpr !== it.dpr) { it.size = size; it.dpr = dpr; it.cv.width = it.cv.height = Math.max(1, Math.round(size * dpr)); }
    if (key !== it.key) { it.key = key; it.pts = miniCloud(f, n); it.n = n; it.view = FORMS[f.form].view; }
    it.cond = h.getAttribute('data-core-cond') || 'steady'; it.heat = -1;
    if (r) {   // остаток лимита: 1 — яркий накал, 0 — пепел
      var now = parseFloat(r.getAttribute('aria-valuenow')), max = parseFloat(r.getAttribute('aria-valuemax')), min = parseFloat(r.getAttribute('aria-valuemin')) || 0;
      it.heat = isNaN(now) || isNaN(max) || max <= min ? 1 : clamp((now - min) / (max - min), 0, 1); it.cond = it.heat <= 0 ? 'dark' : 'steady';
    }
    if (it.cond !== 'flicker' && it.cond !== 'dark') it.cond = 'steady';
    it.anim = it.cond !== 'dark';
  }
  function flick(t, o) { var n = 0.5 + 0.5 * (Math.sin(t * 13.7 + o * 7.1) * 0.45 + Math.sin(t * 31.3 + o * 3.3) * 0.2 + Math.sin(t * 5.1 + o) * 0.35); return n < 0.34 ? 0.14 : 0.42 + 0.58 * n; }
  function miniDraw(it, t, read) {
    if (read || !it.pts) miniRead(it);
    var c = it.ctx, s = it.size, d = it.dpr, p = it.pts, n = it.n, cond = it.cond, paper = theme.paper, H = theme.heat, i, b;
    var move = reduced ? 0 : t, R = s * 0.43, unit = 0.6 * Math.pow(s / 20, 0.35), inten = 1, cols;
    var spin = it.off + (cond === 'dark' ? 0 : move * (cond === 'flicker' ? 0.14 : 0.26)), breath = cond === 'steady' ? 1 + 0.035 * Math.sin(move * 1.1 + it.off) : 1;
    if (cond === 'dark') cols = [theme.ash, theme.ash, theme.ash];
    else if (it.heat >= 0) { b = mix3(H[0], H[3], it.heat); cols = [mix3(H[0], b, 0.6), b, mix3(b, paper ? b : H[4], 0.5 * it.heat)]; }   // кольцо: от уголька к яркому накалу
    else if (paper) cols = [theme.point, theme.point, theme.point];
    else cols = cond === 'flicker' ? [H[0], H[1], H[2]] : [mix3(H[1], H[2], 0.6), mix3(H[2], H[3], 0.6), mix3(H[3], H[4], 0.6)];
    if (cond === 'flicker') inten = reduced ? 0.55 : flick(move, it.off);
    if (cond === 'dark') inten = paper ? 0.42 : 0.5;
    var cs = Math.cos(spin), sn = Math.sin(spin), cv = Math.cos(it.view), sv = Math.sin(it.view), a0 = (paper || cond === 'dark' ? 0.8 : 0.64) * inten;
    c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, s, s);
    c.globalCompositeOperation = paper || cond === 'dark' ? 'source-over' : 'lighter';
    for (b = 0; b < 3; b++) {
      c.fillStyle = css(cols[b]);
      for (i = 0; i < n; i++) {
        var x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2], rn = x * x + y * y + z * z;
        if ((rn < 0.2 ? 2 : rn < 0.62 ? 1 : 0) !== b) continue;
        if (cond !== 'steady' && i % 3 === 0 && (reduced || cond === 'dark')) continue;   // погасшее и «сбоящее» ядро — реже
        var x1 = cs * x + sn * z, z1 = cs * z - sn * x, y2 = cv * y - sv * z1, z2 = sv * y + cv * z1, k = breath / (1 - z2 * 0.22), depth = z2 * 0.5 + 0.5;
        c.globalAlpha = clamp(a0 * (0.28 + 0.72 * depth), 0, 1);
        c.beginPath(); c.arc(s / 2 + R * x1 * k, s / 2 - R * y2 * k, unit * (0.55 + 0.45 * depth) * k, 0, TAU); c.fill();
      }
    }
    c.globalAlpha = 1; it.theme = theme.n;
  }
  function miniLoop() {
    miniTimer = 0; if (hidden) return;
    var t = (performance.now() - miniT0) / 1000, live = 0, i, it;
    for (i = minis.length - 1; i >= 0; i--) {
      it = minis[i];
      if (!it.el.isConnected) { if (miniIO) miniIO.unobserve(it.el); miniOf.delete(it.el); if (it.ring) miniOf.delete(it.ring); minis.splice(i, 1); continue; }
      if (!it.seen) continue;
      var fresh = it.dirty || it.theme !== theme.n; it.dirty = false;
      if (it.anim && !reduced) { miniDraw(it, t, fresh); live++; } else if (fresh) miniDraw(it, t, true);
    }
    if (live) miniWake();
  }
  function miniWake() { if (!miniTimer && !hidden) miniTimer = setTimeout(function () { (win.requestAnimationFrame || setTimeout)(miniLoop); }, 66); }
  function miniTouch(el) { var it = miniOf && miniOf.get(el); if (it && it !== true) { it.dirty = true; miniWake(); } else if (el && el.querySelector) { it = miniOf && miniOf.get(el.querySelector('.core-mini--ring')); if (it) { it.dirty = true; miniWake(); } } }
  function miniScan(scope) {
    miniInit();
    var list = (scope && scope.querySelectorAll ? scope : doc).querySelectorAll('.core-mini,.core-ring'), i;
    for (i = 0; i < list.length; i++) miniAdd(list[i]);
    return list.length;
  }
  function miniRefresh() { for (var i = 0; i < minis.length; i++) minis[i].dirty = true; miniWake(); }
  function miniInit() {
    if (miniT0) return;
    miniT0 = performance.now() || 1; if (!theme.n) readTheme();
    if (win.IntersectionObserver) miniIO = new IntersectionObserver(function (es) { es.forEach(function (e) { var it = miniOf.get(e.target); if (it && it !== true) { it.seen = e.isIntersecting; if (it.seen) { it.dirty = true; miniWake(); } } }); }, { rootMargin: '40px' });
    if (win.MutationObserver) miniMO = new MutationObserver(function (ms) { ms.forEach(function (m) { miniTouch(m.target); }); });
    doc.addEventListener('animationstart', function (e) { if (e.animationName === 'core-seen') miniAdd(e.target); }, true);
    miniScan(doc);
  }
  function miniList() { return (doc.readyState === 'loading' ? 0 : miniScan(doc), minis.length); }

  /* ═══ 5. Шейдеры. Точка получает два положения (форма «откуда» и «куда») и четыре случайных числа;
         всё движение — перетекание, сжатие в шар, течение, дыхание, импульсы, разлёт, наклон к цели, рябь, поток —
         считается здесь, на видеокарте. Скрипт на каждый кадр передаёт только два десятка чисел. ═══ */
  var VS = [
    'precision highp float;',
    'attribute vec3 aFrom;attribute vec3 aTo;attribute vec4 aSeed;',
    'uniform mat3 uRot;uniform vec4 uGeo;uniform vec4 uPt;uniform vec4 uPose;uniform vec4 uPh;uniform vec4 uHeat;uniform vec3 uPulse;',
    'uniform vec4 uFx;uniform vec3 uLean;uniform vec4 uPtr;uniform vec4 uRip;uniform vec4 uFlow;uniform vec3 uGoal;',
    'uniform vec3 uC0;uniform vec3 uC1;uniform vec3 uC2;uniform vec3 uC3;uniform vec3 uC4;',
    'varying vec4 vCol;varying float vSoft;',
    'void main(){',
    // перетекание формы: у каждой точки своя задержка, путь слегка закручен
    ' float m=clamp((uPose.x-aSeed.y*0.5)*2.0,0.0,1.0);m=m*m*(3.0-2.0*m);',
    ' vec3 p=mix(aFrom,aTo,m);',
    ' float mid=sin(3.14159265*m),sw=mid*uFx.y,cs=cos(sw),sn=sin(sw);',
    ' p=vec3(cs*p.x-sn*p.z,p.y,sn*p.x+cs*p.z)*(1.0+0.12*mid*(aSeed.x-0.35));',
    ' float rn=min(length(p),1.25);',
    // «думает»: форма сжимается в плотный шар
    ' p=mix(p,normalize(p+(aSeed.xyz-0.5)*0.04)*(0.16+0.84*sqrt(aSeed.z)),uPose.y);',
    // медленное течение и дыхание
    ' vec3 q=p*2.3+aSeed.xyz*6.2831853;',
    ' p+=vec3(sin(q.y+uPh.x)+sin(q.z*1.7-uPh.y),sin(q.z+uPh.y)+sin(q.x*1.7+uPh.x),sin(q.x-uPh.x)+sin(q.y*1.7+uPh.y))*(0.02*uPose.z);',
    ' p*=1.0+uPose.w*sin(uPh.z-rn*1.6);',
    // импульсы мысли: узкие полосы бегут через шар
    ' float band=smoothstep(0.84,1.0,sin(dot(p,uPulse)*5.0-uHeat.z))*uHeat.y;',
    ' p*=1.0+band*0.045;',
    // ошибка: разлёт
    ' p+=normalize(p+(aSeed.zxy-0.5)*0.9)*uFx.x*(0.16+0.6*aSeed.w);',
    ' vec3 v=uRot*p;',
    // наклон к цели (поле ввода)
    ' float ll=length(uLean);',
    ' if(ll>0.0005){float f=smoothstep(-0.1,1.0,dot(normalize(v+0.0001),uLean/ll));v+=uLean*(0.12+0.88*f*f*f)*(0.45+0.55*aSeed.w);}',
    // рябь от нажатия и лёгкий наклон к указателю
    ' vec2 rd=v.xy-uRip.xy;float rl=length(rd)+0.0001,rw=(rl-uRip.z)/uFlow.z;rw=exp(-rw*rw)*uRip.w;',
    ' v.xy+=rd/rl*rw*0.05;',
    ' vec2 pd=uPtr.xy-v.xy;v.xy+=pd*(uPtr.z*exp(-dot(pd,pd)*uPtr.w));',
    // «отвечает»: часть точек уходит по дуге к месту, где появляется текст, и гаснет на подлёте
    ' float fade=1.0;',
    ' if(uFlow.x>0.001&&aSeed.w<uFx.w){',
    '  float u=fract(aSeed.z+uFlow.y*(aSeed.x<0.35?2.0:1.0));',
    '  vec3 end=uGoal+(aSeed.xyz-0.5)*vec3(0.1,0.04,0.08);vec3 way=end-v;',
    '  vec3 neck=normalize(uGoal+vec3(0.0,0.0,0.0001))*min(length(uGoal)*0.8,1.05);',
    '  vec3 ctl=mix(neck,v+way*0.5,0.3)+vec3(-way.y,way.x,0.4)*(0.1+(aSeed.y-0.5)*0.24);',
    '  float e=u*u*(3.0-2.0*u),a1=1.0-e;',
    '  v=mix(v,a1*a1*v+2.0*a1*e*ctl+e*e*end,uFlow.x);',
    '  fade=mix(1.0,smoothstep(0.0,0.07,u)*(1.0-pow(u,2.4))*1.9,uFlow.x);',
    ' }',
    // проекция: ближние точки крупнее и ярче; вне плоскости резкости — мягче и тусклее
    ' float k=1.0/(1.0-v.z*uPt.w);',
    ' gl_Position=vec4(uGeo.xy+v.xy*uGeo.zw*k,0.0,1.0);',
    // яркость точек распределена неравномерно: немногие яркие искры и много тусклой пыли — так облако искрится, а не сереет
    // на бумаге иначе: тушь не светится, поэтому точки почти одинаково плотные, а различаются размером — как в гравюре пунктиром
    ' float depth=clamp(v.z*0.5+0.5,0.0,1.0),lot=fract(aSeed.x*13.7+aSeed.w*5.3),lit=0.1+0.9*lot*lot*lot,pap=uFx.z;',
    ' float base=uPt.x*mix(0.72+0.6*lit,0.55+0.85*lit,pap),coc=abs(v.z-0.28)*uPt.y,size=(base+coc)*k;',
    ' vSoft=clamp(coc/(base+coc),0.0,1.0);',
    // накал: к центру горячее, по краям уголёк
    ' float h=clamp(uHeat.x*(1.55-1.45*rn)+(aSeed.x-0.5)*0.14+band*0.4+uHeat.w*0.5-uFx.x*0.35,0.0,1.0)*4.0;',
    ' vec3 c=mix(uC0,uC1,clamp(h,0.0,1.0));c=mix(c,uC2,clamp(h-1.0,0.0,1.0));c=mix(c,uC3,clamp(h-2.0,0.0,1.0));c=mix(c,uC4,clamp(h-3.0,0.0,1.0));',
    ' float a=uPt.z*mix(lit,0.42+0.58*lit,pap)*(0.26+0.74*depth*depth)*pow(base/(base+coc),1.5)*mix(1.0,0.5,vSoft)',
    '  *(0.84+0.16*sin(uPh.w*(1.0+floor(aSeed.y*3.0))+aSeed.z*6.2831853))',
    '  *(1.0+band*1.4+rw*0.5)*(1.0-0.45*uFx.x)*fade*mix(1.0,0.75,smoothstep(2.2,4.0,h)*(1.0-pap));',   // белое каление светит сильнее — берём его чуть меньше
    ' a=min(a,1.3);if(size<1.5){a*=size*size/2.25;size=1.5;}',
    ' gl_PointSize=size;vCol=vec4(c,a);',
    '}'
  ].join('\n');
  // тёмная тема: свет складывается (blend ONE, ONE); бумага: тушь умножается (blend DST_COLOR, ZERO) — плотнее значит темнее, без свечения
  var FS = [
    'precision mediump float;',
    'uniform float uPaper;varying vec4 vCol;varying float vSoft;',
    'void main(){',
    ' vec2 c=gl_PointCoord*2.0-1.0;float d=dot(c,c);',
    ' float glow=exp(-d*mix(5.0,2.0,vSoft))*(1.0-smoothstep(0.6,1.0,d));',
    ' float disc=1.0-smoothstep(mix(0.5,0.0,vSoft),1.0,d);',
    ' gl_FragColor=vec4(mix(vCol.rgb*(vCol.a*glow),mix(vec3(1.0),vCol.rgb,clamp(vCol.a*disc,0.0,1.0)),uPaper),1.0);',
    '}'
  ].join('\n');
  // ореол: мягкий свет вокруг Ядра (на бумаге — лёгкая размывка туши); шум убирает ступени на плавном градиенте
  var AVS = 'attribute vec2 aPos;uniform vec4 uGeo;varying vec2 vP;void main(){vP=aPos*1.7;gl_Position=vec4(uGeo.xy+vP*uGeo.zw,0.0,1.0);}';
  var AFS = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH', 'precision highp float;', '#else', 'precision mediump float;', '#endif',
    'uniform vec4 uAura;uniform float uPaper;varying vec2 vP;',
    'void main(){',
    ' float d=dot(vP,vP),f=exp(-d*1.5)*(1.0-smoothstep(1.6,2.89,d));',
    ' float n=(fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))))-0.5)/255.0;',
    ' gl_FragColor=vec4(mix(max(uAura.rgb*(uAura.a*f)+n,0.0),mix(vec3(1.0),uAura.rgb,uAura.a*f)+n,uPaper),1.0);',
    '}'
  ].join('\n');

  /* ═══ 6. Сцена: холст, программы, буферы, кадр ═══ */
  var TIER_IDS = ['min', 'low', 'mid', 'high'];
  // n — точек; dpr — предел плотности пикселей; px — предел площади холста; rest/act — кадров в секунду в покое и в движении
  var TIERS = { high: { n: 14000, dpr: 2, px: 4.4e6, rest: 30, act: 60 }, mid: { n: 8000, dpr: 1.5, px: 2.4e6, rest: 30, act: 60 }, low: { n: 4200, dpr: 1, px: 1.3e6, rest: 30, act: 60 }, min: { n: 2200, dpr: 0.75, px: 0.6e6, rest: 15, act: 30 } };
  var NREF = 14000, RREF = 270;
  var G = { gl: null, cv: null, host: null, pts: null, aura: null, u: {}, ua: {}, bFrom: null, bTo: null, bSeed: null, bQuad: null, cap: 0, w: 0, h: 0, cw: 1, ch: 1, lost: false, pending: null };
  var seeds = null, fromArr = null, toArr = null;

  function shader(gl, type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
  function program(gl, vs, fs, attrs) {
    var p = gl.createProgram(), a = shader(gl, gl.VERTEX_SHADER, vs), b = shader(gl, gl.FRAGMENT_SHADER, fs), i;
    gl.attachShader(p, a); gl.attachShader(p, b);
    for (i = 0; i < attrs.length; i++) gl.bindAttribLocation(p, i, attrs[i]);
    gl.linkProgram(p); return p;
  }
  function uniforms(gl, p, names) { var o = {}, i; for (i = 0; i < names.length; i++) o[names[i]] = gl.getUniformLocation(p, names[i]); return o; }
  // Холст и контекст. Программный (медленный) WebGL не берём: failIfMajorPerformanceCaveat — тогда останется свечение.
  function glCreate() {
    var cv = G.cv || doc.createElement('canvas'), gl = null, o = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: true };
    cv.className = 'core-scene__gl';
    try { gl = cv.getContext('webgl', o) || cv.getContext('experimental-webgl', o); } catch (e) { gl = null; }
    if (!gl) return false;
    if (!G.cv) {
      cv.addEventListener('webglcontextlost', function (e) { e.preventDefault(); G.lost = true; G.pending = null; setMode('glow', 'context-lost'); }, false);
      cv.addEventListener('webglcontextrestored', function () { G.lost = false; glBuild(function (ok) { if (ok) { resize(true); setMode('live', ''); wake(); } else setMode('glow', 'shader'); }); }, false);
    }
    G.cv = cv; G.gl = gl; return true;
  }
  // Программы собираются без остановки страницы, если браузер умеет (KHR_parallel_shader_compile)
  function glBuild(done) {
    var gl = G.gl, ext = gl.getExtension('KHR_parallel_shader_compile'), t0 = performance.now();
    G.pts = program(gl, VS, FS, ['aFrom', 'aTo', 'aSeed']); G.aura = program(gl, AVS, AFS, ['aPos']);
    function finish() {
      if (G.lost) return done(false);
      if (!gl.getProgramParameter(G.pts, gl.LINK_STATUS) || !gl.getProgramParameter(G.aura, gl.LINK_STATUS)) return done(false);
      G.u = uniforms(gl, G.pts, ['uRot', 'uGeo', 'uPt', 'uPose', 'uPh', 'uHeat', 'uPulse', 'uFx', 'uLean', 'uPtr', 'uRip', 'uFlow', 'uGoal', 'uC0', 'uC1', 'uC2', 'uC3', 'uC4', 'uPaper']);
      G.ua = uniforms(gl, G.aura, ['uGeo', 'uAura', 'uPaper']);
      G.bFrom = gl.createBuffer(); G.bTo = gl.createBuffer(); G.bSeed = gl.createBuffer(); G.bQuad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, G.bQuad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, G.bSeed); gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
      upload(true); upload(false);
      gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND);
      done(true);
    }
    if (!ext) return finish();
    (function poll() {
      if (G.lost) return done(false);
      if ((gl.getProgramParameter(G.pts, ext.COMPLETION_STATUS_KHR) && gl.getProgramParameter(G.aura, ext.COMPLETION_STATUS_KHR)) || performance.now() - t0 > 4000) return finish();
      G.pending = raf(poll);
    })();
  }
  function upload(from) { var gl = G.gl; if (!gl || G.lost || !G.bFrom) return; gl.bindBuffer(gl.ARRAY_BUFFER, from ? G.bFrom : G.bTo); gl.bufferData(gl.ARRAY_BUFFER, from ? fromArr : toArr, gl.DYNAMIC_DRAW); }

  /* ═══ 7. Состояния и места. Каждое состояние — набор целей для плавных величин; переход из любого в любое идёт
         пружинами, поэтому не бывает скачка, даже если состояние сменили на полпути. ═══ */
  //            размер, сжатие в шар, накал, яркость, вращение (рад/с), дыхание, течение, импульсы, наклон, поток, ход времени, свет кромок, кадры/с
  var STATES = {
    rest:      { scale: 1,    ball: 0,    heat: 0.48, bright: 1,    spin: 0.07,  breath: 0.03,  turb: 1,   pulse: 0,   lean: 0,    flow: 0, go: 1, light: 1,    fps: 30 },
    listening: { scale: 1.02, ball: 0,    heat: 0.56, bright: 1.04, spin: 0.09,  breath: 0.022, turb: 1.1, pulse: 0,   lean: 1,    flow: 0, go: 1, light: 1.05, fps: 60 },
    thinking:  { scale: 0.62, ball: 0.72, heat: 0.95, bright: 1,    spin: 0.34,  breath: 0.012, turb: 0.5, pulse: 1,   lean: 0,    flow: 0, go: 1, light: 1.2,  fps: 60 },
    answering: { scale: 0.96, ball: 0.08, heat: 0.66, bright: 1.02, spin: 0.12,  breath: 0.024, turb: 1,   pulse: 0.3, lean: 0.35, flow: 1, go: 1, light: 1.1,  fps: 60 },
    receded:   { scale: 0.86, ball: 0,    heat: 0.34, bright: 0.42, spin: 0.035, breath: 0.02,  turb: 0.7, pulse: 0,   lean: 0,    flow: 0, go: 1, light: 0.7,  fps: 12 },
    still:     { scale: 0.94, ball: 0,    heat: 0.34, bright: 0.5,  spin: 0,     breath: 0,     turb: 0,   pulse: 0,   lean: 0,    flow: 0, go: 0, light: 0.85, fps: 0 }
  };
  var STATE_IDS = ['rest', 'listening', 'thinking', 'answering', 'receded', 'still'];
  // место: центр и радиус в пикселях окна; gain — яркость точек, aura — яркость ореола;
  // lift — при сжатии Ядро держится верхним краем, а не центром (у горизонта сжатый шар иначе ушёл бы под край экрана)
  var PLACES = {
    center: function (w, h) { return { x: w * 0.5, y: h * 0.46, r: clamp(Math.min(w, h) * 0.3, 110, 330), gain: 1, aura: 1, lift: 0 }; },
    horizon: function (w, h) { var r = clamp(w * 0.36, 240, 560); return { x: w * 0.5, y: h + r - clamp(h * 0.24, 120, 230), r: r, gain: 1, aura: 1.5, lift: 1.2 }; },
    full: function (w, h) { return { x: w * 0.5, y: h * 0.5, r: Math.sqrt(w * w + h * h) * 0.56, gain: 0.55, aura: 0.7, lift: 0 }; },
    far: function (w, h) { return { x: w * 0.5, y: h * 0.5, r: clamp(Math.min(w, h) * 0.19, 70, 200), gain: 0.8, aura: 1, lift: 0 }; }
  };
  var PLACE_IDS = ['center', 'horizon', 'full', 'far'];
  var A_DARK = 5.2, A_PAPER = 3.6, AURA_DARK = 0.06, AURA_PAPER = 0.035, FLOW_PART = 0.14, MORPH_S = 1.9, FLASH = 1.15;

  var want = { state: 'rest', place: 'center', form: shape('sphere') }, cur = { state: 'rest', place: 'center' };
  var mode = 'boot', reason = '', booted = false, focus = false, forced = false, slow = false;
  var S = { x: sp(0), y: sp(0), lr: sp(5), gx: sp(0), gy: sp(0), glr: sp(5), gain: sp(1), aura: sp(1), lift: sp(0), scale: sp(1), ball: sp(0), heat: sp(0.48), bright: sp(1), spin: sp(0.07), breath: sp(0.03), turb: sp(1),
    pulse: sp(0), lean: sp(0), flow: sp(0), go: sp(1), view: sp(0.24), norm: sp(1), scatter: sp(0), flash: sp(0), kick: sp(0), ptr: sp(0), px: sp(0), py: sp(0), tx: sp(0), ty: sp(0) };
  var ph = { spin: 0, a: 0, b: 0, breath: 0, tw: 0, pulse: 0, flow: 0, dir: 0 };
  var morph = { t: 1, swirl: 0.5 }, fx = { scatter: 0, flash: 0, rip: null };
  var tgt = { el: null, x: 0, y: 0, ax: 0.5, ay: 0.5, set: false, read: 0, px: 0, py: 0 };
  var ptr = { x: 0, y: 0, on: false };
  var view = { w: win.innerWidth || 1280, h: win.innerHeight || 800, ch: win.innerHeight || 800 };
  var q = { id: 'high', auto: true, top: 'high', late: 0, frames: 0, warm: 0 };
  var loop = { on: false, id: 0, timer: 0, step: 0, draw: 0, dirty: true, busy: true, stamps: [], ms: 0 };
  var holdTimer = 0, holdBack = null, lightTimer = 0, lightLast = '';

  function raf(f) { return win.requestAnimationFrame ? win.requestAnimationFrame(f) : setTimeout(function () { f(performance.now()); }, 16); }
  function idle(f) { if (win.requestIdleCallback) win.requestIdleCallback(function () { f(); }, { timeout: 1200 }); else setTimeout(f, 120); }
  function fire(type) { try { root.dispatchEvent(new CustomEvent('core:scene', { detail: Object.assign({ type: type }, info()) })); } catch (e) {} }
  function geo(p) {
    var w = view.w, h = view.h;
    if (typeof p === 'string') return (PLACES[p] || PLACES.center)(w, h);
    return { x: w * (p.x == null ? 50 : p.x) / 100, y: h * (p.y == null ? 50 : p.y) / 100, r: Math.max(40, Math.min(w, h) * (p.size || 0.3)), gain: p.gain == null ? 1 : p.gain, aura: 1, lift: 0 };
  }
  function placeKey(p) { return typeof p === 'string' ? p : [p.x, p.y, p.size, p.gain].join(','); }

  // Свет на кромках стекла (механизм шага 1) идёт за настоящим положением Ядра. Меняется только при смене места и
  // состояния, не каждый кадр. Пока открыто окно, свет страницы не трогаем: окно само считает Ядро «прямо за собой».
  function light(glide) {
    if (focus) return;
    var g = geo(want.place), o = { x: Math.round(clamp(g.x / view.w * 100, -10, 110) * 10) / 10, y: Math.round(clamp(g.y / view.h * 100, -10, 112) * 10) / 10, light: STATES[want.state].light }, k = o.x + ' ' + o.y + ' ' + o.light;
    if (k === lightLast) return; lightLast = k;
    if (win.CoreUI && win.CoreUI.light) win.CoreUI.light.set(o, !!glide && !reduced);
    else { root.style.setProperty('--core-x', String(o.x)); root.style.setProperty('--core-y', String(o.y)); root.style.setProperty('--core-light', String(o.light)); }
  }
  function apply(first) {
    var s = focus ? 'receded' : want.state, p = focus ? 'far' : want.place, moved = placeKey(p) !== placeKey(cur.place), changed = moved || s !== cur.state;
    cur.state = s; cur.place = p; relight();
    root.setAttribute('data-core-is', s); root.setAttribute('data-core-place', typeof p === 'string' ? p : 'custom');
    clearTimeout(lightTimer);
    if (first) light(false); else if (moved && !reduced && mode === 'live') lightTimer = setTimeout(function () { light(true); }, 380);   // свет трогается на середине пути Ядра
    else light(true);
    loop.dirty = true; wake();
    if (changed && !first) fire('state');
  }

  /* ── цель на экране: элемент (читается не чаще 5 раз в секунду) или точка ── */
  function aim(now) {
    if (tgt.el) {
      if (now - tgt.read > 200 || !tgt.read) { tgt.read = now || 1; if (tgt.el.isConnected === false) tgt.el = null; else { var r = tgt.el.getBoundingClientRect(); if (r.width || r.height) { tgt.px = r.left + r.width * tgt.ax; tgt.py = r.top + r.height * tgt.ay; } } }
    } else if (tgt.set) { tgt.px = tgt.x; tgt.py = tgt.y; }
    else { tgt.px = view.w * 0.5; tgt.py = view.h * (cur.state === 'answering' ? 0.6 : 0.86); }   // по умолчанию: поле ввода внизу, текст выше
  }

  /* ── шаг времени: пружины, разовые импульсы, фазы ── */
  var SPR = [['scale', 4.2], ['ball', 3.6], ['heat', 3.2], ['bright', 4], ['spin', 2.4], ['breath', 3], ['turb', 3], ['pulse', 3], ['lean', 5], ['flow', 2.6], ['go', 3]];
  function step(dt, now) {
    var st = STATES[cur.state], g = geo(cur.place), f = FORMS[want.form.form], i, k, busy = false, lr = Math.log(g.r);
    aim(now);
    // место: две пружины подряд — движение начинается и кончается мягко, одним непрерывным ходом
    spring(S.gx, g.x, 5.4, dt); spring(S.gy, g.y, 5.4, dt); spring(S.glr, lr, 5.4, dt);
    spring(S.x, S.gx.x, 5.4, dt); spring(S.y, S.gy.x, 5.4, dt); spring(S.lr, S.glr.x, 5.4, dt); spring(S.gain, g.gain, 4, dt); spring(S.aura, g.aura, 4, dt); spring(S.lift, g.lift, 4, dt);
    if (!near(S.x, g.x, 0.3) || !near(S.y, g.y, 0.3) || !near(S.lr, lr, 0.002)) busy = true;
    for (i = 0; i < SPR.length; i++) { k = SPR[i][0]; spring(S[k], st[k], SPR[i][1], dt); if (!near(S[k], st[k], 0.004)) busy = true; }
    spring(S.view, f.view, 2.2, dt); if (!near(S.view, f.view, 0.004)) busy = true;
    spring(S.norm, even(), 3.2, dt);
    spring(S.scatter, now < fx.scatter ? 1 : 0, now < fx.scatter ? 26 : 4.4, dt);
    spring(S.flash, now < fx.flash ? 1 : 0, now < fx.flash ? 40 : 5.5, dt);
    spring(S.kick, 0, 9, dt);
    if (now < fx.scatter || now < fx.flash || !near(S.scatter, 0, 0.004) || !near(S.flash, 0, 0.004) || !near(S.kick, 0, 0.004)) busy = true;
    var live = st.go > 0 && cur.state !== 'receded', on = ptr.on && live ? 1 : 0;
    spring(S.ptr, on, 5, dt); spring(S.px, ptr.x, 9, dt); spring(S.py, ptr.y, 9, dt);
    if (!near(S.ptr, on, 0.004) || (S.ptr.x > 0.01 && (!near(S.px, ptr.x, 0.4) || !near(S.py, ptr.y, 0.4)))) busy = true;
    spring(S.tx, tgt.px, 7, dt); spring(S.ty, tgt.py, 7, dt);
    if ((st.lean || st.flow) && (!near(S.tx, tgt.px, 0.4) || !near(S.ty, tgt.py, 0.4))) busy = true;
    if (morph.t < 1) { morph.t = Math.min(1, morph.t + dt / MORPH_S); busy = true; }
    if (fx.rip) { if (now - fx.rip.t > 1600) fx.rip = null; else busy = true; }
    var go = S.go.x;
    ph.spin = (ph.spin + S.spin.x * dt) % TAU; ph.a = (ph.a + 0.31 * dt * go) % TAU; ph.b = (ph.b + 0.23 * dt * go) % TAU;
    ph.breath = (ph.breath + 1.12 * dt * go) % TAU; ph.tw = (ph.tw + 0.9 * dt * go) % TAU;
    ph.pulse = (ph.pulse + 4.4 * dt) % TAU; ph.flow = (ph.flow + 0.4 * dt) % 1; ph.dir = (ph.dir + 0.21 * dt) % TAU;
    loop.busy = busy;
  }
  /* ── Предел яркости. Сколько света даёт самое плотное место облака, зависит от формы, позы и размера на экране.
        Здесь это место оценивается заранее: тысячи две точек раскладываются по сетке так же, как их разложит шейдер
        (поворот, сжатие в шар, накал, глубина), с восьми сторон и в четырёх масштабах — от пятна размытия стекла на телефоне
        до пятна на большом экране. Яркость точки потом делится на эту оценку, поэтому свет на единицу площади
        одинаков для любой формы, любой модели и любого места, и текст на стекле остаётся читаемым. ── */
  // «цена» света каждой ступени накала: какую долю запаса контраста на ближнем стекле съедает единица такого света
  // (уголёк дёшев, белое каление дорого; числа сняты с модели стекла шага 1, см. описание)
  var HEAT_COST = [1.8, 2.63, 3.39, 4, 4.88], EXPO_G = 144, EXPO_CELL = 0.01875, expoGrid = null;
  function exposure(f, heat, ball, add) {
    var key = f.form + f.seed + ':' + heat.toFixed(2) + ':' + ball.toFixed(2) + ':' + (add || 0), hit = f.L && f.L[key]; if (hit) return hit;
    var GN = EXPO_G, n = Math.min(G.cap, 2400), def = FORMS[f.form], cb = Math.cos(def.view), sb = Math.sin(def.view), out = [0, 0, 0, 0], k, i, j, lvl;
    if (!expoGrid) { expoGrid = []; for (lvl = 0, k = GN; lvl < 5; lvl++, k /= 2) expoGrid.push(new Float32Array(k * k)); }
    for (k = 0; k < 6; k++) {
      var c = Math.cos(k * TAU / 6 + 0.2), s = Math.sin(k * TAU / 6 + 0.2), g = expoGrid[0];
      for (j = 0; j < GN * GN; j++) g[j] = 0;
      for (i = 0; i < n; i++) {
        var x = toArr[i * 3], y = toArr[i * 3 + 1], z = toArr[i * 3 + 2], rn = Math.min(Math.sqrt(x * x + y * y + z * z), 1.25), q = (0.16 + 0.84 * Math.sqrt(seeds[i * 4 + 2])) / (rn || 1);
        x = mix(x, x * q, ball); y = mix(y, y * q, ball); z = mix(z, z * q, ball);
        var h = clamp(heat * (1.55 - 1.45 * rn) + (add || 0), 0, 1) * 4, hi = Math.min(3, Math.floor(h)), w = mix(HEAT_COST[hi], HEAT_COST[hi + 1], h - hi) * (1 - 0.25 * smooth((h - 2.2) / 1.8));
        var z1 = c * z - s * x, d = (sb * y + cb * z1) * 0.5 + 0.5, gx = Math.floor((c * x + s * z + 1.35) / EXPO_CELL), gy = Math.floor((cb * y - sb * z1 + 1.35) / EXPO_CELL);
        if (gx >= 0 && gx < GN && gy >= 0 && gy < GN) g[gy * GN + gx] += w * (0.26 + 0.74 * d * d);
      }
      // пирамида: каждая следующая сетка вдвое грубее; пятно — блок 2×2 клетки с любым сдвигом
      for (lvl = 1, j = GN; lvl < 5; lvl++, j /= 2) {
        var a = expoGrid[lvl - 1], b = expoGrid[lvl], m = j / 2, u, v, top = 0, cell = 5.4 / j;
        for (v = 0; v < m; v++) for (u = 0; u < m; u++) b[v * m + u] = a[2 * v * j + 2 * u] + a[2 * v * j + 2 * u + 1] + a[(2 * v + 1) * j + 2 * u] + a[(2 * v + 1) * j + 2 * u + 1];
        for (v = 0; v < j - 1; v++) for (u = 0; u < j - 1; u++) { var sum = a[v * j + u] + a[v * j + u + 1] + a[(v + 1) * j + u] + a[(v + 1) * j + u + 1]; if (sum > top) top = sum; }
        top = top / n / (cell * cell); if (top > out[lvl - 1]) out[lvl - 1] = top;
      }
    }
    (f.L || (f.L = {}))[key] = out; return out;
  }
  // оценка для пятна размытия нужного размера: 35 px экрана (2,5σ самого резкого стекла) в единицах радиуса Ядра
  function expoAt(L, rr) { var t = clamp(Math.log(0.3 / (35 / rr)) / Math.LN2, 0, 3), i = Math.min(2, Math.floor(t)); return mix(L[3 - i], L[2 - i], t - i); }
  var expoL = null, expoF = null, warming = 0;
  function relight() { expoF = null; expoL = toArr ? exposure(want.form, STATES[cur.state].heat, STATES[cur.state].ball, 0) : null; }
  // оценки для остальных состояний считаются заранее, по одной в свободную минуту: смена состояния их уже не ждёт
  function warm() {
    if (warming || !toArr) return; warming = 1;
    (function one(i) {
      if (i >= STATE_IDS.length) { warming = 0; return; }
      idle(function () { var st = STATES[STATE_IDS[i]]; if (toArr) { exposure(want.form, st.heat, st.ball, 0); if (i === 2) exposure(want.form, st.heat, st.ball, 0.5); } one(i + 1); });
    })(0);
  }
  function even() { if (!expoL) relight(); return expoL ? expoAt(expoL, Math.exp(S.lr.x) * S.scale.x) : 1; }
  // вспышка: накал подскакивает, а света на площадь становится ровно FLASH (в тех же единицах, что bright у состояний) — не выше предела
  function flashGain(rr) {
    if (S.flash.x < 0.002 || !expoL) return 1;
    var st = STATES[cur.state]; if (!expoF) expoF = exposure(want.form, st.heat, st.ball, 0.5);
    return mix(1, FLASH / st.bright * expoAt(expoL, rr) / expoAt(expoF, rr), clamp(S.flash.x, 0, 1));
  }
  function snap() {   // всё сразу в цель: первый кадр и «уменьшить движение»
    var st = STATES[cur.state], g = geo(cur.place), i, k;
    aim(0);
    S.gx.x = S.x.x = g.x; S.gy.x = S.y.x = g.y; S.glr.x = S.lr.x = Math.log(g.r); S.gain.x = g.gain; S.aura.x = g.aura; S.lift.x = g.lift; S.view.x = FORMS[want.form.form].view; S.norm.x = even();
    for (i = 0; i < SPR.length; i++) { k = SPR[i][0]; S[k].x = st[k]; }
    S.tx.x = tgt.px; S.ty.x = tgt.py; S.scatter.x = S.flash.x = S.kick.x = S.ptr.x = 0; fx.scatter = fx.flash = 0; fx.rip = null; morph.t = 1;
    for (k in S) S[k].v = 0;
    loop.busy = false;
  }

  /* ── кадр ── */
  var M3 = new Float32Array(9);
  function draw(now) {
    var gl = G.gl; if (!gl || G.lost || !G.bFrom) return;
    var u = G.u, t = TIERS[q.id], paper = theme.paper, n = Math.min(t.n, G.cap), W = view.w, CH = view.ch, R = Math.exp(S.lr.x), rr = R * S.scale.x, dpr = G.w / W;
    var cx = S.x.x, cy = S.y.x - S.lift.x * R * (1 - S.scale.x);
    var geoU = [cx / W * 2 - 1, 1 - cy / CH * 2, rr / W * 2, rr / CH * 2];
    // яркость на площадь не зависит от числа точек, плотности пикселей и размера Ядра — поэтому предел яркости один для всех устройств
    var sz = clamp(Math.sqrt(R / RREF), 0.8, 1.7) * Math.pow(NREF / n, 0.25), dens = (NREF / n) * (R * R) / (RREF * RREF) / (sz * sz) * S.scale.x * S.scale.x;
    var alpha = clamp((paper ? A_PAPER : A_DARK) * S.gain.x * S.bright.x * dens / Math.max(S.norm.x, 0.02) * flashGain(rr), 0, paper ? 2.4 : 4);
    var heat = clamp(S.heat.x, 0, 1), c = Math.cos(ph.spin), s = Math.sin(ph.spin), vb = S.view.x + 0.05 * Math.sin(ph.b), cb = Math.cos(vb), sb = Math.sin(vb);
    gl.viewport(0, 0, G.w, G.h);
    gl.clearColor(theme.scene[0], theme.scene[1], theme.scene[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);
    if (paper) gl.blendFunc(gl.DST_COLOR, gl.ZERO); else gl.blendFunc(gl.ONE, gl.ONE);
    // ореол
    if (q.id !== 'min') {
      var ac = paper ? mix3(theme.point, theme.heat[0], heat * 0.8) : mix3(theme.heat[1], theme.heat[2], heat), aa = (paper ? AURA_PAPER : AURA_DARK) * S.aura.x * S.bright.x * (0.8 + 0.3 * heat) * (1 + 0.3 * S.flash.x) * (1 - 0.4 * S.scatter.x);
      gl.useProgram(G.aura); gl.bindBuffer(gl.ARRAY_BUFFER, G.bQuad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
      gl.uniform4f(G.ua.uGeo, geoU[0], geoU[1], geoU[2], geoU[3]); gl.uniform4f(G.ua.uAura, ac[0], ac[1], ac[2], aa); gl.uniform1f(G.ua.uPaper, paper ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    // точки
    gl.useProgram(G.pts);
    gl.bindBuffer(gl.ARRAY_BUFFER, G.bFrom); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, G.bTo); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, G.bSeed); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
    M3[0] = c; M3[1] = sb * s; M3[2] = -cb * s; M3[3] = 0; M3[4] = cb; M3[5] = sb; M3[6] = s; M3[7] = -sb * c; M3[8] = cb * c;
    gl.uniformMatrix3fv(u.uRot, false, M3);
    gl.uniform4f(u.uGeo, geoU[0], geoU[1], geoU[2], geoU[3]);
    gl.uniform4f(u.uPt, (paper ? 2.2 : 2.8) * sz * dpr, (paper ? 1.6 : 4) * sz * dpr, alpha, 0.26);
    gl.uniform4f(u.uPose, morph.t, S.ball.x, S.turb.x, S.breath.x);
    gl.uniform4f(u.uPh, ph.a, ph.b, ph.breath, ph.tw);
    gl.uniform4f(u.uHeat, heat, S.pulse.x, ph.pulse, S.flash.x);
    var dx = Math.cos(ph.dir) * 0.8, dy = 0.35 + 0.4 * Math.sin(ph.dir * 2), dz = Math.sin(ph.dir) * 0.8, dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    gl.uniform3f(u.uPulse, dx / dl, dy / dl, dz / dl);
    gl.uniform4f(u.uFx, S.scatter.x, morph.swirl, paper ? 1 : 0, FLOW_PART);
    var lx = (S.tx.x - cx) / rr, ly = -(S.ty.x - cy) / rr, ld = Math.sqrt(lx * lx + ly * ly) || 1, la = (S.lean.x + S.kick.x * 0.2) * Math.min(0.36, (56 + 0.06 * rr) / rr) * Math.min(1, ld / 0.8);
    gl.uniform3f(u.uLean, lx / ld * la, ly / ld * la, 0.1 * la);
    gl.uniform3f(u.uGoal, lx, ly, 0.2);
    var sg = clamp(110 / rr, 0.1, 0.45);
    gl.uniform4f(u.uPtr, (S.px.x - cx) / rr, -(S.py.x - cy) / rr, S.ptr.x * 14 / (sg * rr), 1 / (sg * sg));
    var rip = fx.rip, age = rip ? clamp((now - rip.t) / 1600, 0, 1) : 1;
    if (rip) gl.uniform4f(u.uRip, (rip.x - cx) / rr, -(rip.y - cy) / rr, (40 + 560 * (1 - (1 - age) * (1 - age))) / rr, (1 - age) * (1 - age) * 0.9); else gl.uniform4f(u.uRip, 0, 0, 0, 0);
    gl.uniform4f(u.uFlow, S.flow.x, ph.flow, clamp(46 / rr, 0.05, 0.25), 0);
    var rp = theme.ramp;
    gl.uniform3f(u.uC0, rp[0][0], rp[0][1], rp[0][2]); gl.uniform3f(u.uC1, rp[1][0], rp[1][1], rp[1][2]); gl.uniform3f(u.uC2, rp[2][0], rp[2][1], rp[2][2]); gl.uniform3f(u.uC3, rp[3][0], rp[3][1], rp[3][2]); gl.uniform3f(u.uC4, rp[4][0], rp[4][1], rp[4][2]);
    gl.uniform1f(u.uPaper, paper ? 1 : 0);
    gl.drawArrays(gl.POINTS, 0, n);
  }

  /* ── цикл: рисует только когда вкладка видна и что-то меняется; частота зависит от того, что происходит ── */
  function tick(now) {
    loop.id = 0;
    if (hidden || mode !== 'live' || G.lost) { loop.on = false; return; }
    if (reduced || slow) { snap(); draw(now); loop.dirty = false; loop.on = false; return; }   // один неподвижный кадр
    var t = TIERS[q.id], sf = STATES[cur.state].fps, fps = loop.busy || sf >= 60 ? t.act : Math.min(sf, t.rest);   // слушает, думает, отвечает — полная частота; покой — половина
    if (!fps && !loop.dirty) { loop.on = false; return; }   // замерло, всё на месте — цикл спит до следующей команды
    var gap = fps ? 1000 / fps : 0;
    if (loop.draw && now - loop.draw < gap * 0.62) return next(gap);   // экраны 90–240 Гц: не чаще нужного
    var dt = loop.step ? clamp((now - loop.step) / 1000, 0, 0.1) : 0; loop.step = now;
    step(dt, now); draw(now); measure(now, gap); loop.dirty = false;
    next(gap);
  }
  function next(gap) { if (gap > 40) loop.timer = setTimeout(function () { loop.timer = 0; loop.id = raf(tick); }, gap - 14); else loop.id = raf(tick); }
  function wake() {
    if (mode !== 'live' || hidden) return;
    if (loop.timer) { clearTimeout(loop.timer); loop.timer = 0; loop.id = raf(tick); }
    if (loop.on) return;
    loop.on = true; loop.step = 0; loop.draw = 0; loop.busy = true; q.warm = 15; q.frames = q.late = 0; loop.id = raf(tick);
  }
  function stop() { if (loop.id && win.cancelAnimationFrame) win.cancelAnimationFrame(loop.id); clearTimeout(loop.timer); loop.id = loop.timer = 0; loop.on = false; }
  // Ядро само меряет время кадра. Если из 50 кадров 20 опоздали — ступень качества вниз (меньше точек и пикселей).
  // Не помогло и на самой низкой — остаётся неподвижный кадр. Выбор запоминается на сутки.
  function measure(now, gap) {
    var d = loop.draw ? now - loop.draw : 0; loop.draw = now;
    loop.stamps.push(now); while (loop.stamps.length && now - loop.stamps[0] > 1000) loop.stamps.shift();
    if (!d || d > 250) return;
    loop.ms = loop.ms ? loop.ms * 0.9 + d * 0.1 : d;
    if (!q.auto || !gap) return;
    if (q.warm > 0) { q.warm--; return; }
    q.frames++; if (d > gap * 1.55 + 2) q.late++;
    if (q.frames >= 50) { if (q.late >= 20) lower(); q.frames = q.late = 0; }
  }
  function lower() {
    var i = TIER_IDS.indexOf(q.id);
    if (i > 0) setTier(TIER_IDS[i - 1]); else { slow = true; fire('quality'); }
    try { win.localStorage.setItem('core-q', (slow ? 'still' : q.id) + ':' + Date.now()); } catch (e) {}
  }
  function setTier(id) { if (!TIERS[id]) return; q.id = id; q.warm = 15; q.frames = q.late = 0; if (booted && G.gl) { grow(); resize(true); } loop.dirty = true; wake(); fire('quality'); }
  function guess() {
    var nav = win.navigator || {}, mem = nav.deviceMemory || 0, cpu = nav.hardwareConcurrency || 0, mm = win.matchMedia, t = 'high';
    if ((mm && mm('(pointer:coarse)').matches) || Math.min(view.w, view.h) < 600) t = 'mid';
    if ((mem && mem <= 4) || (cpu && cpu <= 4)) t = t === 'high' ? 'mid' : 'low';
    if ((mem && mem <= 2) || (nav.connection && nav.connection.saveData)) t = 'low';
    return t;
  }

  /* ── холст: размер и точки ── */
  function resize(force) {
    var host = G.host;
    view.w = (host && host.clientWidth) || win.innerWidth || view.w; view.h = (host && host.clientHeight) || win.innerHeight || view.h;
    view.ch = (G.cv && G.cv.clientHeight) || view.h;
    if (G.cv) {
      var t = TIERS[q.id], d = Math.min(win.devicePixelRatio || 1, t.dpr), px = view.w * view.ch * d * d; if (px > t.px) d *= Math.sqrt(t.px / px);
      var w = Math.max(1, Math.round(view.w * d)), h = Math.max(1, Math.round(view.ch * d));
      if (force || w !== G.w || h !== G.h) { G.cv.width = G.w = w; G.cv.height = G.h = h; }
    }
    lightLast = ''; light(false);
    loop.dirty = true; q.warm = 15; wake();
  }
  // точек в памяти — по верхней ступени качества для этого устройства; больше понадобилось (ручной выбор) — пересоздаём
  function grow() {
    var n = TIERS[q.id].n; if (n <= G.cap) return;
    G.cap = n; var r = rng(0x5EED), i; seeds = new Float32Array(n * 4); for (i = 0; i < n * 4; i++) seeds[i] = r();
    toArr = cloud(want.form, n, false); fromArr = new Float32Array(toArr); morph.t = 1; relight();
    var gl = G.gl; if (gl && G.bSeed && !G.lost) { gl.bindBuffer(gl.ARRAY_BUFFER, G.bSeed); gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW); upload(true); upload(false); }
  }
  // новая форма: если прежнее перетекание не закончилось, точки стартуют оттуда, где они сейчас (та же формула, что в шейдере)
  function reshape() {
    if (!toArr) return;
    var n = G.cap, i, m, mid, sw, cs, sn, k, x, y, z, M = morph.t;
    if (M < 1 && !reduced) for (i = 0; i < n; i++) {
      m = smooth((M - seeds[i * 4 + 1] * 0.5) * 2); mid = Math.sin(PI * m); sw = mid * morph.swirl; cs = Math.cos(sw); sn = Math.sin(sw); k = 1 + 0.12 * mid * (seeds[i * 4] - 0.35);
      x = mix(fromArr[i * 3], toArr[i * 3], m); y = mix(fromArr[i * 3 + 1], toArr[i * 3 + 1], m); z = mix(fromArr[i * 3 + 2], toArr[i * 3 + 2], m);
      fromArr[i * 3] = (cs * x - sn * z) * k; fromArr[i * 3 + 1] = y * k; fromArr[i * 3 + 2] = (sn * x + cs * z) * k;
    } else fromArr.set(toArr);
    toArr = cloud(want.form, n, false); morph.t = reduced ? 1 : 0; morph.swirl = -morph.swirl; relight();
    upload(true); upload(false);
  }

  /* ── режимы: boot (ещё не запущено) · live (3D) · glow (свечение из CSS) ── */
  function setMode(m, why) {
    if (mode === m && reason === (why || '')) return;
    mode = m; reason = why || ''; root.setAttribute('data-core-scene', m);
    if (m !== 'live') stop();
    fire('mode');
  }
  function boot() {
    if (booted) return; booted = true;
    G.host = doc.querySelector('.core-scene');
    if (!G.host) { G.host = doc.createElement('div'); G.host.className = 'core-scene'; G.host.setAttribute('aria-hidden', 'true'); doc.body.insertBefore(G.host, doc.body.firstChild); }
    readTheme();
    if (win.ResizeObserver) new ResizeObserver(function () { resize(); }).observe(G.host); else win.addEventListener('resize', function () { resize(); });
    if (forced || !glCreate()) { resize(); return setMode('glow', forced ? 'forced' : 'no-webgl'); }
    G.host.appendChild(G.cv); resize(true); grow();
    glBuild(function (ok) {
      if (!ok) return setMode('glow', G.lost ? 'context-lost' : 'shader');
      snap(); draw(performance.now()); setMode('live', ''); fire('ready'); wake(); warm();
    });
  }

  /* ═══ 8. Команды ═══ */
  function setState(name, o) {
    o = o || {};
    if (name === 'error' || name === 'flash') return pulse(name);   // разовые: сыграть и вернуться
    if (!STATES[name]) return;
    if (o.target !== undefined) setTarget(o.target, o);
    clearTimeout(holdTimer); holdTimer = 0;
    if (o.hold > 0) { if (holdBack == null) holdBack = want.state; holdTimer = setTimeout(function () { var b = holdBack; holdBack = null; holdTimer = 0; setState(b); }, o.hold); } else holdBack = null;
    if (want.state !== name) { want.state = name; apply(); }
  }
  function pulse(kind) {
    var now = performance.now();
    if (kind === 'key') {   // пользователь печатает: точки подаются к полю ввода и сами возвращаются, когда он замолчал
      if (want.state === 'rest' || want.state === 'listening') { S.kick.v = Math.min(S.kick.v + 5, 9); setState('listening', { hold: 1500 }); loop.busy = true; wake(); }
      return;
    }
    if (reduced || slow || mode !== 'live') return;
    if (kind === 'error') fx.scatter = now + 170;
    else if (kind === 'flash') {
      fx.flash = now + 90;
      if (!focus && win.CoreUI && win.CoreUI.light) { var l = STATES[want.state].light; win.CoreUI.light.set({ light: l + 0.25 }, true); setTimeout(function () { if (!focus) win.CoreUI.light.set({ light: STATES[want.state].light }, true); }, 340); }
    } else return;
    loop.busy = true; wake();
  }
  function setForm(f) {
    if (f.form === want.form.form && f.seed === want.form.seed) return;
    want.form = f; if (toArr) { reshape(); loop.dirty = true; loop.busy = true; wake(); warm(); }
    fire('state');
  }
  function setPlace(p) {
    if (p == null || (typeof p === 'string' && !PLACES[p])) return;
    want.place = typeof p === 'string' ? p : { x: p.x, y: p.y, size: p.size, gain: p.gain }; apply();
  }
  function setTarget(t, o) {
    o = o || {}; tgt.ax = o.ax == null ? 0.5 : +o.ax; tgt.ay = o.ay == null ? 0.5 : +o.ay; tgt.el = null; tgt.set = false; tgt.read = 0;
    if (t && t.nodeType === 1) tgt.el = t; else if (t && typeof t.x === 'number' && typeof t.y === 'number') { tgt.x = t.x; tgt.y = t.y; tgt.set = true; }
    loop.dirty = true; wake();
  }
  function setQuality(v) {
    if (v === 'auto') { q.auto = true; slow = false; setTier(q.top); }
    else if (TIERS[v]) { q.auto = false; slow = false; setTier(v); }
  }
  function info() {
    var now = performance.now(), n = 0, i, t = TIERS[q.id];
    for (i = 0; i < loop.stamps.length; i++) if (now - loop.stamps[i] <= 1000) n++;
    return { mode: mode, reason: reason, state: want.state, shown: cur.state, place: typeof want.place === 'string' ? want.place : 'custom', form: want.form.form, model: want.form.model,
      quality: q.id, auto: q.auto, points: mode === 'live' ? Math.min(t.n, G.cap) : 0, width: G.w, height: G.h, fps: n, ms: Math.round(loop.ms * 10) / 10, still: reduced || slow, slow: slow };
  }

  /* ═══ 9. Связь со страницей: видимость вкладки, «уменьшить движение», тема, окно поверх, указатель ═══ */
  var mqMotion = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null, mqDark = win.matchMedia ? win.matchMedia('(prefers-color-scheme: dark)') : null;
  function listen(mq, f) { if (!mq) return; if (mq.addEventListener) mq.addEventListener('change', f); else if (mq.addListener) mq.addListener(f); }
  function onMotion() { var r = !!(mqMotion && mqMotion.matches) || root.getAttribute('data-core-motion') === 'reduce'; if (r === reduced) return; reduced = r; loop.dirty = true; miniRefresh(); wake(); }
  function onTheme() { readTheme(); miniRefresh(); loop.dirty = true; wake(); }
  function wire() {
    hidden = !!doc.hidden; reduced = !!(mqMotion && mqMotion.matches) || root.getAttribute('data-core-motion') === 'reduce';
    doc.addEventListener('visibilitychange', function () { hidden = !!doc.hidden; if (hidden) { stop(); clearTimeout(miniTimer); miniTimer = 0; } else { wake(); miniWake(); } });
    listen(mqMotion, onMotion); listen(mqDark, onTheme);
    if (win.MutationObserver) new MutationObserver(function () { onMotion(); onTheme(); }).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-core-motion'] });
    // окно открыто (шаг 1 ставит data-core-focus и шлёт core:focus): Ядро уходит вдаль, тускнеет и рисуется реже
    focus = root.hasAttribute('data-core-focus');
    root.addEventListener('core:focus', function (e) { focus = !!(e.detail && e.detail.on); apply(); });
    // указатель: точки чуть подаются к курсору, нажатие пускает одну волну. Только для мыши и пера; ничего не читает из разметки.
    function close(x, y) { var rr = Math.exp(S.lr.x) * S.scale.x * 1.6 + 160, dx = x - S.x.x, dy = y - S.y.x; return dx * dx + dy * dy < rr * rr; }
    function calm() { return mode !== 'live' || reduced || slow || !STATES[cur.state].go || cur.state === 'receded'; }
    win.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      ptr.x = e.clientX; ptr.y = e.clientY; ptr.on = true;
      if (!calm() && close(ptr.x, ptr.y)) { loop.busy = true; wake(); }
    }, { passive: true });
    root.addEventListener('mouseleave', function () { ptr.on = false; });
    win.addEventListener('blur', function () { ptr.on = false; });
    doc.addEventListener('click', function (e) {
      if (calm() || (!e.clientX && !e.clientY) || !close(e.clientX, e.clientY)) return;
      fx.rip = { x: e.clientX, y: e.clientY, t: performance.now() }; loop.busy = true; wake();
    }, { capture: true, passive: true });
  }

  /* ═══ 10. Запуск. Файл только объявляет команды; сама сцена стартует после загрузки страницы, в свободную минуту,
          и не раньше, чем вкладка станет видимой. Команды, пришедшие раньше, просто задают, какой сцена появится. ═══ */
  function plan() {
    if (booted) return;
    if (doc.hidden) { var once = function () { if (!doc.hidden) { doc.removeEventListener('visibilitychange', once); plan(); } }; doc.addEventListener('visibilitychange', once); return; }
    idle(boot);
  }
  function start() {
    var a = function (n) { return root.getAttribute(n); }, saved = null;
    if (STATES[a('data-core-is')]) want.state = a('data-core-is');
    if (PLACES[a('data-core-place')]) want.place = a('data-core-place');
    if (a('data-core-model')) want.form = formOf(a('data-core-model')); else if (FORMS[a('data-core-form')]) want.form = shape(a('data-core-form'));
    q.top = q.id = guess();
    try { saved = /^(\w+):(\d+)$/.exec(win.localStorage.getItem('core-q') || ''); } catch (e) {}
    if (saved) {   // сутки помним, на чём устройство справлялось; потом пробуем на ступень выше
      var i = saved[1] === 'still' ? -1 : TIER_IDS.indexOf(saved[1]), fresh = Date.now() - saved[2] < 864e5;
      if (i < 0 && saved[1] === 'still' && fresh) { q.id = 'min'; slow = true; }
      else q.id = TIER_IDS[clamp(fresh ? i : i + 1, 0, TIER_IDS.indexOf(q.top))] || q.top;
    }
    if (TIERS[a('data-core-quality')]) { q.id = a('data-core-quality'); q.auto = false; slow = false; }
    var base = (Date.now() % 3600000) / 1000;   // фазы от общих часов: при переходе между страницами Ядро не «прыгает»
    ph.spin = base * 0.07 % TAU; ph.a = base * 0.31 % TAU; ph.b = base * 0.23 % TAU; ph.breath = base * 1.12 % TAU; ph.tw = base * 0.9 % TAU;
    root.setAttribute('data-core-scene', 'boot');
    wire(); apply(true);
    var dom = function () { idle(miniInit); };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', dom); else dom();
    if (doc.readyState === 'complete') plan(); else { win.addEventListener('load', plan); setTimeout(plan, 5000); }
  }

  win.Core = {
    version: 2,
    states: STATE_IDS, pulses: ['flash', 'error', 'key'], forms: FORM_IDS, places: PLACE_IDS, qualities: ['auto', 'high', 'mid', 'low', 'min'],
    set: function (o) {
      o = o || {};
      if (o.model != null) setForm(formOf(o.model)); else if (o.form != null && FORMS[o.form]) setForm(shape(o.form));
      if (o.place != null) setPlace(o.place);
      if (o.state != null) setState(o.state, o); else if (o.target !== undefined) setTarget(o.target, o);
      return this;
    },
    state: function (name, o) { if (name == null) return want.state; setState(name, o); return this; },
    pulse: function (kind) { pulse(kind); return this; },
    form: function (id) { if (id == null) return want.form.form; if (FORMS[id]) setForm(shape(id)); return this; },
    model: function (name) { if (name == null) return want.form.model; setForm(formOf(name)); return this; },
    place: function (p) { if (p == null) return typeof want.place === 'string' ? want.place : { x: want.place.x, y: want.place.y, size: want.place.size }; setPlace(p); return this; },
    target: function (t, o) { setTarget(t, o); return this; },
    quality: function (v) { if (v == null) return q.auto ? 'auto' : q.id; setQuality(v); return this; },
    info: info,
    formOf: function (name) { var f = formOf(name); return { form: f.form, variant: f.v.slice() }; },
    mini: { scan: miniScan, refresh: miniRefresh, count: miniList },
    // для витрины и проверок: потеря и возврат графического контекста, принудительное свечение
    test: {
      lose: function () { var e = G.gl && G.gl.getExtension('WEBGL_lose_context'); if (e) { G.ext = e; e.loseContext(); } return !!e; },
      restore: function () { if (G.ext) G.ext.restoreContext(); return !!G.ext; },
      glow: function (on) { forced = !!on; if (!booted) return; if (forced) setMode('glow', 'forced'); else if (G.gl && !G.lost && G.bFrom) { setMode('live', ''); loop.dirty = true; wake(); } }
    },
    _: { cloud: cloud, formOf: formOf, shape: shape, hash: hash, STATES: STATES, PLACES: PLACES, TIERS: TIERS, FORMS: FORMS, parseColor: parseColor, boot: boot }
  };
  start();
})();
