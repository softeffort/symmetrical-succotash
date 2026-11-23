/* Витрина Premier · Core — логика самой страницы /core/showcase.html (в продукте не используется).
   Строит таблицы состояний из одного образца, показывает значения токенов и запускает живые примеры. */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  var $$ = function (s, el) { return Array.prototype.slice.call((el || doc).querySelectorAll(s)); };

  /* ── принудительные состояния: правила :hover/:active/:focus копируются под классы .sc-* ── */
  function forceStates() {
    var out = [], map = [[/:focus-visible/g, '.sc-focus-visible'], [/:focus-within/g, '.sc-focus-within'], [/:focus(?![-\w])/g, '.sc-focus'], [/:hover/g, '.sc-hover'], [/:active/g, '.sc-active']];
    function walk(rules, wrap) {
      Array.prototype.forEach.call(rules, function (r) {
        if (r.cssRules && r.conditionText != null) {   // @media / @supports
          var hoverOnly = r.type === 4 && /hover/.test(r.conditionText);
          return walk(r.cssRules, hoverOnly ? wrap : wrap.concat([(r.type === 4 ? '@media ' : '@supports ') + r.conditionText]));
        }
        if (!r.selectorText || !/:(hover|active|focus)/.test(r.selectorText)) return;
        var sel = r.selectorText; map.forEach(function (m) { sel = sel.replace(m[0], m[1]); });
        var css = sel + '{' + r.style.cssText + '}';
        wrap.slice().reverse().forEach(function (w) { css = w + '{' + css + '}'; });
        out.push(css);
      });
    }
    $$('link[rel=stylesheet]').forEach(function (l) {
      if (!/\/core\/core-(base|components)\.css/.test(l.href)) return;
      try { walk(l.sheet.cssRules, []); } catch (e) {}
    });
    var st = doc.createElement('style'); st.id = 'sc-forced'; st.textContent = out.join('\n'); doc.head.appendChild(st);
  }

  /* ── таблица состояний из одного образца ── */
  var LABEL = { rest: 'покой', hover: 'наведение', active: 'нажатие', focus: 'фокус', disabled: 'выключено', busy: 'загрузка', invalid: 'ошибка', filled: 'заполнено', checked: 'включено', mixed: 'частично', selected: 'выбрано', pressed: 'выбрано', 'disabled-checked': 'выключено · вкл' };
  var uid = 0;
  function buildStates() {
    $$('.sc-states[data-states]').forEach(function (box) {
      var proto = box.firstElementChild; if (!proto) return;
      box.removeChild(proto);
      box.dataset.states.split(/\s+/).forEach(function (state) {
        var el = proto.cloneNode(true), ctl = el.matches('input,button,select,textarea,a') ? el : el.querySelector('input,button,select,textarea,a') || el;
        var all = [el].concat($$('*', el)), cell = doc.createElement('figure'), wrap = doc.createElement('div'), cap = doc.createElement('figcaption');
        $$('[name]', el).concat(el.name ? [el] : []).forEach(function (n) { n.name = n.name + '-' + (++uid); });
        function check() { if (ctl.type === 'checkbox' || ctl.type === 'radio') ctl.checked = true; }
        if (state === 'hover') all.forEach(function (n) { n.classList.add('sc-hover'); });
        if (state === 'active') all.forEach(function (n) { n.classList.add('sc-active'); });
        if (state === 'focus') { ctl.classList.add('sc-focus-visible', 'sc-focus'); el.classList.add('sc-focus-within'); if (ctl.parentElement && el.contains(ctl.parentElement)) ctl.parentElement.classList.add('sc-focus-within'); }
        if (state === 'disabled' || state === 'disabled-checked') { if ('disabled' in ctl) ctl.disabled = true; else ctl.setAttribute('aria-disabled', 'true'); }
        if (state === 'disabled-checked' || state === 'checked') check();
        if (state === 'mixed') ctl.indeterminate = true;
        if (state === 'busy') el.setAttribute('aria-busy', 'true');
        if (state === 'invalid') ctl.setAttribute('aria-invalid', 'true');
        if (state === 'filled') ctl.value = 'anna@example.com';
        if (state === 'selected') ctl.setAttribute('aria-selected', 'true');
        if (state === 'pressed') ctl.setAttribute('aria-pressed', 'true');
        if (state !== 'rest' && state !== 'focus') ctl.tabIndex = -1;   // образцы не засоряют путь клавиши Tab
        cell.className = 'sc-cell'; wrap.className = 'sc-cell__box'; cap.textContent = LABEL[state] || state;
        wrap.appendChild(el); cell.appendChild(wrap); cell.appendChild(cap); box.appendChild(cell);
      });
    });
  }

  /* ── токены: значения читаются из стилей страницы ── */
  var COLORS = [
    ['Сцена и стекло'], ['--core-scene', 'Сцена'], ['--core-glass-far', 'Стекло дальнее'], ['--core-glass-mid', 'Стекло среднее'], ['--core-glass-near', 'Стекло ближнее'], ['--core-glass-dense', 'Стекло плотное'], ['--core-edge', 'Свет кромки'], ['--core-scrim', 'Затемнение под окном'],
    ['Текст'], ['--core-text', 'Текст'], ['--core-text-2', 'Текст вторичный'], ['--core-text-3', 'Текст третий'], ['--core-text-on-heat', 'Чернила на накале'],
    ['Накал: главное действие и «ИИ работает»'], ['--core-heat-1', 'Уголёк'], ['--core-heat-2', 'Пламя'], ['--core-heat-3', 'Янтарь'], ['--core-heat-4', 'Свечение'], ['--core-heat-5', 'Белое каление'],
    ['Статус'], ['--core-ok', 'Успех'], ['--core-warn', 'Предупреждение'], ['--core-bad', 'Ошибка'],
    ['Поверх стекла'], ['--core-fill-1', 'Слой: наведение'], ['--core-fill-2', 'Слой: нажатие, выбор'], ['--core-fill-3', 'Слой: подложка'], ['--core-well', 'Углубление поля'], ['--core-line', 'Линия'], ['--core-line-2', 'Линия заметная'], ['--core-on', '«Включено»'], ['--core-focus', 'Рамка фокуса'], ['--core-select', 'Выделение текста']
  ];
  function paintTokens() {
    var cs = getComputedStyle(root), box = doc.querySelector('[data-sc-swatches]');
    if (box) {
      box.textContent = '';
      COLORS.forEach(function (c) {
        if (c.length === 1) { var h = doc.createElement('h4'); h.textContent = c[0]; box.appendChild(h); return; }
        var d = doc.createElement('div'), i = doc.createElement('i'), b = doc.createElement('b'), s = doc.createElement('span');
        d.className = 'sc-sw'; i.style.background = 'var(' + c[0] + ')'; b.textContent = c[1]; s.textContent = c[0].replace('--core-', '') + ' · ' + cs.getPropertyValue(c[0]).trim();
        s.title = c[0] + ': ' + cs.getPropertyValue(c[0]).trim(); s.setAttribute('data-core-native', '');
        d.appendChild(i); d.appendChild(b); d.appendChild(s); box.appendChild(d);
      });
    }
    var sp = doc.querySelector('[data-sc-space]');
    if (sp && !sp.firstChild) ['05', '1', '15', '2', '3', '4', '5', '6', '8', '10', '12', '16'].forEach(function (n) {
      var v = cs.getPropertyValue('--core-s-' + n).trim(), d = doc.createElement('div'), a = doc.createElement('span'), b = doc.createElement('span'), i = doc.createElement('i');
      a.textContent = 's-' + n; b.textContent = v; i.style.width = v; d.appendChild(a); d.appendChild(b); d.appendChild(i); sp.appendChild(d);
    });
  }

  /* ── тема, положение Ядра, режимы ── */
  function setTheme(v) { if (v === 'dark' || v === 'light') root.setAttribute('data-theme', v); else root.removeAttribute('data-theme'); requestAnimationFrame(paintTokens); }
  function initControls() {
    var cur = root.getAttribute('data-theme') || 'auto';
    // тему переключают и шапка, и пульт Ядра: обе группы показывают одно и то же
    $$('input[name=sc-theme],input[name=sc-theme2]').forEach(function (r) {
      r.checked = r.value === cur;
      r.addEventListener('change', function () { if (!r.checked) return; setTheme(r.value); $$('input[name=sc-theme],input[name=sc-theme2]').forEach(function (o) { o.checked = o.value === r.value; }); });
    });
    if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { requestAnimationFrame(paintTokens); });
    var menu = doc.getElementById('sc-settings');
    function flags() {
      $$('[data-sc-flag]', menu).forEach(function (b) { b.setAttribute('aria-checked', String(root.getAttribute('data-core-' + b.dataset.scFlag) === 'reduce')); });
      $$('[data-sc-check=motion]').forEach(function (i) { i.checked = root.getAttribute('data-core-motion') === 'reduce'; });
    }
    function flag(name, on) { if (on) root.setAttribute('data-core-' + name, 'reduce'); else root.removeAttribute('data-core-' + name); flags(); requestAnimationFrame(paintTokens); }
    flags();
    menu.addEventListener('core:select', function (e) { var b = e.detail.item; if (b.dataset.scFlag) flag(b.dataset.scFlag, b.getAttribute('aria-checked') === 'true'); });
    $$('[data-sc-check=motion]').forEach(function (i) { i.addEventListener('change', function () { flag('motion', i.checked); }); });
  }

  /* ── Ядро: пульт. Всё управление — через команды Core, так же, как это будут делать страницы продукта ── */
  var RU = {
    state: { rest: 'Покой', listening: 'Слушает', thinking: 'Думает', answering: 'Отвечает', receded: 'Отступило', still: 'Замерло' },
    form: { sphere: 'Сфера', torus: 'Тор', spiral: 'Спираль', lattice: 'Решётка', helix: 'Двойная спираль', knot: 'Узел', bloom: 'Цветок', orbits: 'Орбиты', ribbon: 'Лента', vortex: 'Воронка', crystal: 'Кристалл' },
    place: { center: 'В центре', horizon: 'Горизонт', full: 'Весь экран', far: 'Вдали', side: 'Сбоку' },
    quality: { auto: 'Авто', high: 'Высокое', mid: 'Среднее', low: 'Низкое', min: 'Минимум' },
    mode: { boot: 'запуск', live: '3D', glow: 'свечение' },
    cond: { steady: 'работает', flicker: 'сбои', dark: 'недоступна' }
  };
  var MODELS = ['GPT-5', 'GPT-5 mini', 'Claude Opus 4.5', 'Claude Sonnet 4.5', 'Gemini 3 Pro', 'DeepSeek V3', 'Grok 4', 'Qwen 3 Max', 'YandexGPT 5', 'GigaChat 2 Max', 'Llama 4', 'Mistral Large'];
  var MIX = ['steady', 'steady', 'flicker', 'steady', 'dark', 'steady'];
  var ANSWER = 'Пока я думал, Ядро сжалось в плотный шар. Теперь оно отдаёт точки туда, где появляется текст, а когда ответ закончится — вернётся в покой.';
  function initCore() {
    var C = window.Core; if (!C) return;
    var SIDE = { x: 86, y: 30, size: 0.2 }, side = false, timers = [];
    var one = function (s) { return doc.querySelector(s); }, put = function (s, v) { var el = one(s); if (el && el.textContent !== String(v)) el.textContent = v; };
    function later(ms, f) { timers.push(setTimeout(f, ms)); }
    function cancel() { timers.forEach(clearTimeout); timers = []; one('[data-sc-answer-box]').hidden = true; }
    function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
    ['state', 'form', 'place', 'quality'].forEach(function (kind) {
      var box = one('[data-sc-core=' + kind + ']'), ids = kind === 'state' ? C.states : kind === 'form' ? C.forms : kind === 'place' ? C.places.concat(['side']) : C.qualities;
      ids.forEach(function (id) { var b = el('button', 'core-chip', RU[kind][id]); b.type = 'button'; b.value = id; b.dataset.scSet = kind; b.setAttribute('aria-pressed', 'false'); box.appendChild(b); });
    });
    function sync() {
      var i = C.info(), now = { state: i.state, form: i.model ? '' : i.form, place: side ? 'side' : i.place, quality: i.auto ? 'auto' : i.quality }, live = i.mode === 'live';
      $$('[data-sc-set]').forEach(function (b) { b.setAttribute('aria-pressed', String(now[b.dataset.scSet] === b.value)); });
      put('[data-sc-fps]', live ? i.fps : '—'); put('[data-sc-ms]', live && i.ms ? i.ms.toFixed(1) : '—'); put('[data-sc-points]', live ? i.points : '—'); put('[data-sc-size]', live ? i.width + '×' + i.height : '—');
      put('[data-sc-mode]', RU.mode[i.mode] + (i.still && live ? ' · неподвижный кадр' : ''));
      put('[data-sc-qnote]', 'Сейчас: ' + RU.quality[i.quality].toLowerCase() + (i.auto ? ' (выбрано само)' : '') + (i.slow ? '. Устройство не справилось — оставлен неподвижный кадр.' : '.'));
      $$('[data-sc-check=glow]').forEach(function (c) { c.checked = i.mode === 'glow' && i.reason === 'forced'; });
    }
    doc.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sc-set],[data-sc-pulse],[data-sc-play],[data-sc-send],[data-sc-lose],[data-sc-restore]'); if (!b) return;
      if (b.dataset.scSet) {
        var v = b.value; cancel();
        if (b.dataset.scSet === 'state') C.state(v);
        if (b.dataset.scSet === 'form') { C.form(v); one('[data-sc-model]').value = ''; model(); }
        if (b.dataset.scSet === 'place') { side = v === 'side'; C.place(side ? SIDE : v); }
        if (b.dataset.scSet === 'quality') C.quality(v);
      }
      if (b.dataset.scPulse) C.pulse(b.dataset.scPulse);
      if (b.hasAttribute('data-sc-lose')) C.test.lose();
      if (b.hasAttribute('data-sc-restore')) C.test.restore();
      if (b.hasAttribute('data-sc-send')) ask();
      if (b.hasAttribute('data-sc-play')) {   // все состояния по очереди
        cancel(); var t = 0;
        [['rest', 1600], ['listening', 2600], ['thinking', 3400], ['answering', 3600], ['error', 2000], ['flash', 1600], ['receded', 2400], ['still', 2400], ['rest', 0]].forEach(function (s) {
          later(t, function () { if (s[0] === 'error' || s[0] === 'flash') { C.state('rest'); C.pulse(s[0]); } else C.set({ state: s[0], target: s[0] === 'listening' ? one('[data-sc-ask]') : s[0] === 'answering' ? one('[data-sc-ask]') : undefined, ay: s[0] === 'answering' ? -1.2 : 0.5 }); sync(); });
          t += s[1];
        });
      }
      sync();
    });
    // проба: печатаем — Ядро слушает; отправили — думает, затем отвечает туда, где появляется текст
    var input = one('[data-sc-ask]');
    input.addEventListener('input', function () { C.target(input); C.pulse('key'); sync(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') ask(); });
    function ask() {
      cancel(); input.value = '';
      var box = one('[data-sc-answer-box]'), out = one('[data-sc-answer-text]'), caret = one('[data-sc-caret]'), words = ANSWER.split(' '), n = 0;
      out.textContent = ''; C.state('thinking'); sync();
      later(2600, function () {
        box.hidden = false; C.set({ state: 'answering', target: caret }); sync();
        (function type() { if (n >= words.length) return later(900, function () { C.state('rest'); sync(); }); out.textContent += (n ? ' ' : '') + words[n++]; later(90, type); })();
      });
    }
    // форма по имени модели
    function model() {
      var v = one('[data-sc-model]').value.trim(), f = v && C.formOf(v);
      put('[data-sc-model-out]', f ? 'Форма: ' + RU.form[f.form].toLowerCase() + '. То же имя всегда даёт ту же форму.' : 'Новая модель получает форму сама: она выводится из имени.');
      if (v) C.model(v);
    }
    one('[data-sc-model]').addEventListener('input', function () { model(); sync(); });
    $$('[data-sc-check=glow]').forEach(function (c) { c.addEventListener('change', function () { C.test.glow(c.checked); sync(); }); });
    $$('[data-sc-check=solo]').forEach(function (c) { c.addEventListener('change', function () { root.toggleAttribute('data-sc-solo', c.checked); }); });
    // малые ядра: все формы, список моделей, размеры
    var grid = one('[data-sc-minis]'), list = one('[data-sc-models]'), sizes = one('[data-sc-sizes]');
    C.forms.forEach(function (id) { var f = el('figure'), m = el('span', 'core-mini core-mini--xl'); m.setAttribute('data-core-form', id); m.setAttribute('data-sc-mini', ''); f.appendChild(m); f.appendChild(el('figcaption', '', RU.form[id])); grid.appendChild(f); });
    MODELS.forEach(function (name) {
      var li = el('li'), row = el('div', 'core-row'), m = el('span', 'core-mini'), body = el('span', 'core-row__body');
      m.setAttribute('data-core-model', name); m.setAttribute('data-sc-mini', ''); body.appendChild(el('span', 'core-row__title', name));
      row.appendChild(m); row.appendChild(body); row.appendChild(el('span', 'core-row__trail')); li.appendChild(row); list.appendChild(li);
    });
    [['core-mini--sm', '16'], ['', '20'], ['core-mini--lg', '28'], ['core-mini--xl', '48']].forEach(function (s) {
      var f = el('figure'), m = el('span', ('core-mini ' + s[0]).trim()); m.setAttribute('data-core-model', MODELS[2]); f.appendChild(m); f.appendChild(el('figcaption', 'core-machine-1 core-text-3', s[1] + ' px')); sizes.appendChild(f);
    });
    function cond(v) {
      $$('[data-sc-mini]').forEach(function (m, i) {
        var c = v === 'mix' ? MIX[i % MIX.length] : v, trail = m.parentNode.querySelector('.core-row__trail');
        m.setAttribute('data-core-cond', c); if (trail) trail.textContent = RU.cond[c];
      });
    }
    $$('input[name=sc-cond]').forEach(function (r) { r.addEventListener('change', function () { if (r.checked) cond(r.value); }); });
    cond('mix'); C.mini.scan(doc);
    root.addEventListener('core:scene', sync); setInterval(sync, 500); sync();
  }

  /* ── живые примеры ── */
  var TOAST = {
    '': { text: 'Ссылка скопирована' },
    ok: { text: 'Сайт опубликован', tone: 'ok' },
    warn: { text: 'Осталось 5 сообщений на сегодня', tone: 'warn' },
    bad: { text: 'Не удалось сохранить файл. Проверьте соединение и попробуйте ещё раз.', tone: 'bad' },
    action: { text: 'Чат удалён', action: { label: 'Вернуть', onClick: function () { CoreUI.toast({ text: 'Чат возвращён', tone: 'ok' }); } } }
  };
  function initDemos() {
    doc.addEventListener('click', function (e) {
      var t = e.target.closest('[data-sc-toast],[data-sc-ask],[data-sc-run],[data-sc-regather],[data-sc-spend],[data-sc-refill],[data-sc-doselect]'); if (!t) return;
      var answer = doc.querySelector('[data-sc-answer]'), say = function (v) { answer.textContent = v === undefined ? 'закрыто' : JSON.stringify(v); };
      if (t.hasAttribute('data-sc-toast')) CoreUI.toast(TOAST[t.getAttribute('data-sc-toast')]);
      if (t.dataset.scAsk === 'confirm') CoreUI.confirm('Сделать эту версию основой следующих правок?').then(say);
      if (t.dataset.scAsk === 'danger') CoreUI.confirm({ text: 'Удалить этот чат?', ok: 'Удалить', danger: true }).then(say);
      if (t.dataset.scAsk === 'prompt') CoreUI.prompt({ text: 'Новое название проекта', value: 'Лендинг кофейни' }).then(say);
      if (t.dataset.scAsk === 'alert') CoreUI.alert('Файл слишком большой: до 20 МБ.').then(say);
      if (t.dataset.scAsk === 'long') CoreUI.confirm('Опубликовать «coffee» по постоянной ссылке?\nВсе файлы папки, кроме скрытых, станут доступны всем, у кого есть ссылка.').then(say);
      if (t.hasAttribute('data-sc-run')) { var m = doc.querySelector('[data-sc-motion]'); m.classList.toggle('sc-run'); }
      if (t.hasAttribute('data-sc-regather')) { var g = doc.querySelector('[data-sc-gather]'), h = g.innerHTML; g.innerHTML = ''; void g.offsetWidth; g.innerHTML = h; }
      if (t.hasAttribute('data-sc-spend') || t.hasAttribute('data-sc-refill')) {
        $$('[data-sc-ring]').forEach(function (r, i) {
          var v = t.hasAttribute('data-sc-refill') ? 100 : Math.max(0, Number(r.getAttribute('aria-valuenow')) - 10);
          r.setAttribute('aria-valuenow', v); r.style.setProperty('--core-ring-v', (v / 100).toFixed(2)); $$('[data-sc-ring-n]')[i].textContent = v;
        });
      }
      if (t.hasAttribute('data-sc-doselect')) { var s = getSelection(); s.removeAllRanges(); var r = doc.createRange(); r.selectNodeContents(doc.querySelector('[data-sc-select]')); s.addRange(r); }
    });
    doc.getElementById('sc-menu').addEventListener('core:select', function (e) { CoreUI.toast({ text: 'Выбрано: ' + e.detail.item.textContent.trim().replace(/\s+/g, ' ') }); });
    var long = doc.querySelector('[data-sc-long]'), p = '';
    for (var i = 1; i <= 14; i++) p += '<p>' + i + '. Длинный текст для чтения лежит на плотном стекле и прокручивается внутри окна: шапка и кнопки остаются на месте, а фон под окном не двигается.</p>';
    long.innerHTML = p;
  }

  function start() {
    forceStates(); buildStates(); paintTokens(); initControls(); initCore(); initDemos();
    root.setAttribute('data-sc-ready', '');
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
})();
