/* Premier · Core — поведение базовых компонентов (шаг 1 редизайна). Описание: /CORE-DESIGN-SYSTEM.md
   Без зависимостей и сборки. Один глобальный объект CoreUI. Всё работает через делегирование,
   поэтому разметку можно добавлять на страницу когда угодно — инициализация не нужна.
     окно          data-core-open="#id" на кнопке, data-core-close внутри окна; CoreUI.dialog.open/close
     меню          data-core-menu="#id" на кнопке; CoreUI.menu.open/close; событие core:select
     подсказка     data-core-tip="текст" (title подхватывается сам)
     уведомление   CoreUI.toast('текст') или CoreUI.toast({ text, tone, action, duration })
     капсула       await CoreUI.confirm(…) / CoreUI.alert(…) / CoreUI.prompt(…) — вместо confirm / alert / prompt
     вкладки       .core-tabs[role=tablist] > .core-tab[role=tab][aria-controls]
     список        select.core-input на компьютере открывает стеклянный список (data-core-native — оставить системный)
     свет Ядра     CoreUI.light.set({ x, y, light }, плавно) */
(function () {
  'use strict';
  if (window.CoreUI) return;
  var doc = document, root = doc.documentElement;
  var FOCUSABLE = 'a[href],button:not(:disabled),input:not(:disabled):not([type=hidden]),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
  var ITEM = '[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[role=option]';

  function token(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }
  // длительность из токена — так «уменьшить движение» действует и на полёты, заданные скриптом
  function ms(name) { var v = token(name), n = parseFloat(v); return isNaN(n) ? 0 : /ms$/.test(v) ? n : n * 1000; }
  function still() { return ms('--core-dur-3') < 1; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function view() { var v = window.visualViewport; return { w: v ? v.width : root.clientWidth, h: v ? v.height : root.clientHeight }; }
  function fire(el, name, detail) { return el.dispatchEvent(new CustomEvent(name, { bubbles: true, cancelable: true, detail: detail || {} })); }
  function off(el) { return !el || el.disabled || el.getAttribute('aria-disabled') === 'true'; }

  /* ── точка рождения: место последнего нажатия; с клавиатуры — центр элемента в фокусе ── */
  var last = null;
  doc.addEventListener('pointerdown', function (e) { last = { x: e.clientX, y: e.clientY, t: performance.now(), key: false }; }, true);
  doc.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var a = doc.activeElement; if (!a || a === doc.body) return;
    var r = a.getBoundingClientRect(); last = { x: r.left + r.width / 2, y: r.top + r.height / 2, t: performance.now(), key: true };
  }, true);
  function origin(o) {
    if (o && o.nodeType === 1) { var r = o.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    if (o && typeof o.clientX === 'number' && (o.clientX || o.clientY)) return { x: o.clientX, y: o.clientY };
    if (o && typeof o.x === 'number' && typeof o.y === 'number') return { x: o.x, y: o.y };
    if (last && performance.now() - last.t < 1500) return { x: last.x, y: last.y };
    return null;
  }
  function byKey() { return !!(last && last.key && performance.now() - last.t < 1500); }

  /* ── слой всплывающих поверхностей: поверх окон, не блокируется ими ── */
  var layer = null;
  function layers() {
    if (!layer || !layer.isConnected) { layer = doc.createElement('div'); layer.className = 'core core-layers'; doc.body.appendChild(layer); }
    return layer;
  }

  /* ── появление и исчезновение: состояние в data-core-state, движение — в CSS ── */
  // ждём только конечные анимации (точки загрузки внутри окна крутятся бесконечно) и не дольше запаса по времени:
  // во вкладке на фоне кадры не идут, а окно всё равно должно открыться и закрыться
  function settled(el) {
    if (still()) return Promise.resolve();
    var list = (el.getAnimations ? el.getAnimations({ subtree: true }) : []).filter(function (a) {
      var t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
      return !t || isFinite(t.endTime);
    });
    return Promise.race([
      Promise.all(list.map(function (a) { return a.finished.catch(function () {}); })),
      new Promise(function (r) { setTimeout(r, ms('--core-dur-4') + 240); })
    ]);
  }
  function enter(el) {
    el.hidden = false; el.dataset.coreState = 'opening';
    return settled(el).then(function () { if (el.dataset.coreState === 'opening') el.dataset.coreState = 'open'; });
  }
  function leave(el) {
    if (el.hidden || el.dataset.coreState === 'closing') return Promise.resolve(false);
    el.dataset.coreState = 'closing';
    return settled(el).then(function () {
      if (el.dataset.coreState !== 'closing') return false;
      el.hidden = true; delete el.dataset.coreState; return true;
    });
  }

  /* ── место всплывающей поверхности у якоря: переворот, если не помещается; точка роста — у якоря ── */
  function place(el, a, o) {
    o = o || {}; var v = view(), m = 8, gap = o.gap == null ? 6 : o.gap, side = o.side || 'bottom', align = o.align || 'start';
    el.style.left = '0px'; el.style.top = '0px';
    var w = el.offsetWidth, h = el.offsetHeight, x, y;
    if (side === 'bottom' && a.bottom + gap + h > v.h - m && a.top - gap - h >= m) side = 'top';
    else if (side === 'top' && a.top - gap - h < m && a.bottom + gap + h <= v.h - m) side = 'bottom';
    y = side === 'bottom' ? a.bottom + gap : a.top - gap - h;
    x = align === 'center' ? (a.left + a.right) / 2 - w / 2 : align === 'end' ? a.right - w : a.left;
    x = clamp(x, m, Math.max(m, v.w - w - m)); y = clamp(y, m, Math.max(m, v.h - h - m));
    el.style.left = Math.round(x) + 'px'; el.style.top = Math.round(y) + 'px';
    el.style.transformOrigin = clamp((a.left + a.right) / 2 - x, 0, w).toFixed(1) + 'px ' + (side === 'bottom' ? 0 : h) + 'px';
    at(el, x + w / 2, y + h / 2);
    return side;
  }
  // где поверхность стоит в окне — по этому кромка находит Ядро
  function at(el, cx, cy) { var v = view(); el.style.setProperty('--core-at-x', (cx / v.w * 100).toFixed(1)); el.style.setProperty('--core-at-y', (cy / v.h * 100).toFixed(1)); }
  function point(p) { return { left: p.x, right: p.x, top: p.y, bottom: p.y }; }

  /* ── искра на месте свернувшегося окна ── */
  function glint(p) {
    if (!p || still()) return;
    var g = doc.createElement('i'); g.className = 'core-glint'; g.style.left = p.x + 'px'; g.style.top = p.y + 'px';
    layers().appendChild(g); settled(g).then(function () { g.remove(); });
  }

  /* ═══ Окно ═══ */
  var stack = [];
  function focusState() {
    var on = stack.length > 0;
    root.toggleAttribute('data-core-focus', on);   // Ядро отступает и тускнеет — сцена читает этот атрибут
    fire(root, 'core:focus', { on: on, depth: stack.length });
  }
  function lock(el) {
    var marked = [], freed = [], n = el;
    while (n && n !== doc.body && n.parentElement) {
      // окно, открытое поверх другого, могло быть заблокировано первым — снимаем блокировку на время
      if (n.inert) { n.inert = false; freed.push(n); }
      for (var s = n.parentElement.firstElementChild; s; s = s.nextElementSibling) {
        if (s !== n && s !== layer && !s.inert && !/^(SCRIPT|STYLE|LINK)$/.test(s.tagName)) { s.inert = true; marked.push(s); }
      }
      n = n.parentElement;
    }
    var st = { marked: marked, freed: freed, overflow: null, pad: null };
    if (stack.length === 0) {
      var bar = window.innerWidth - root.clientWidth;
      st.overflow = root.style.overflow; st.pad = root.style.paddingRight;
      root.style.overflow = 'hidden'; if (bar > 0) root.style.paddingRight = bar + 'px';
    }
    return st;
  }
  function unlock(st) {
    st.marked.forEach(function (s) { s.inert = false; });
    if (stack.length) st.freed.forEach(function (s) { s.inert = true; });
    if (st.overflow !== null) { root.style.overflow = st.overflow; root.style.paddingRight = st.pad; }
  }
  var dialog = {
    open: function (target, opt) {
      var el = typeof target === 'string' ? doc.querySelector(target) : target;
      if (!el || stack.indexOf(el) >= 0) return el;
      var pane = el.querySelector('.core-dialog__pane') || el, o = origin(opt && opt.origin), ret = doc.activeElement;
      menu.close(); tip.hide();
      el.hidden = false; delete el.dataset.coreState;
      var r = pane.getBoundingClientRect(), dx = 0, dy = 16, tx = 0, ty = 0;
      if (o) {
        dx = o.x - (r.left + r.width / 2); dy = o.y - (r.top + r.height / 2);
        var k = Math.hypot(dx, dy) || 1; tx = dy / k * 10; ty = -dx / k * 10;   // лёгкий поворот в сторону точки рождения
      }
      pane.style.setProperty('--core-from-x', dx.toFixed(1) + 'px'); pane.style.setProperty('--core-from-y', dy.toFixed(1) + 'px');
      pane.style.setProperty('--core-tilt-x', tx.toFixed(2) + 'deg'); pane.style.setProperty('--core-tilt-y', ty.toFixed(2) + 'deg');
      el._core = { ret: ret, origin: o, lock: lock(el) };
      stack.push(el); focusState();
      enter(el);
      if (!pane.hasAttribute('tabindex')) pane.setAttribute('tabindex', '-1');
      var first = el.querySelector('[autofocus]') || (byKey() && pane.querySelector(FOCUSABLE)) || pane;
      first.focus({ preventScroll: true });
      fire(el, 'core:open');
      return el;
    },
    close: function (target, value) {
      var el = typeof target === 'string' ? doc.querySelector(target) : target || stack[stack.length - 1];
      var i = stack.indexOf(el); if (i < 0) return Promise.resolve();
      if (!fire(el, 'core:beforeclose', { value: value })) return Promise.resolve();
      var st = el._core || {}; stack.splice(i, 1);
      menu.close(); tip.hide();
      return leave(el).then(function () {
        if (st.lock) unlock(st.lock);
        focusState(); glint(st.origin);
        if (st.ret && st.ret.isConnected && st.ret.focus) st.ret.focus({ preventScroll: true });
        fire(el, 'core:close', { value: value });
      });
    },
    top: function () { return stack[stack.length - 1] || null; }
  };

  /* ═══ Меню ═══ */
  var opened = null;   // { el, trig, pick, temp }
  function items(el) { return Array.prototype.filter.call(el.querySelectorAll(ITEM), function (i) { return !off(i); }); }
  var menu = {
    open: function (target, anchor, opt) {
      var el = typeof target === 'string' ? doc.querySelector(target) : target; if (!el) return null;
      opt = opt || {};
      if (opened && opened.el === el) { menu.close(); return null; }
      menu.close(); tip.hide();
      if (el.parentNode !== layers()) layers().appendChild(el);
      el.hidden = false;
      if (opt.width) el.style.minWidth = opt.width + 'px';
      var rect = anchor && anchor.nodeType === 1 ? anchor.getBoundingClientRect() : anchor ? point(anchor) : point(origin() || { x: 16, y: 16 });
      place(el, rect, { side: opt.side || 'bottom', align: opt.align || 'start' });
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      var trig = anchor && anchor.nodeType === 1 ? anchor : null;
      if (trig) trig.setAttribute('aria-expanded', 'true');
      opened = { el: el, trig: trig, pick: opt.pick || null, temp: !!opt.temp };
      enter(el);
      var list = items(el), start = opt.focus || (byKey() || opt.keyboard ? list[0] : null);
      (start || el).focus({ preventScroll: true });
      if (start && start.scrollIntoView) start.scrollIntoView({ block: 'nearest' });
      return el;
    },
    close: function (refocus) {
      var m = opened; if (!m) return;
      opened = null;
      if (m.trig) { m.trig.setAttribute('aria-expanded', 'false'); if (refocus) m.trig.focus({ preventScroll: true }); }
      leave(m.el).then(function () { if (m.temp) m.el.remove(); });
    }
  };
  function choose(item) {
    var m = opened; if (!m || off(item)) return;
    var role = item.getAttribute('role');
    if (role === 'menuitemradio') {
      var group = item.closest('[role=group]') || m.el;
      group.querySelectorAll('[role=menuitemradio]').forEach(function (x) { x.setAttribute('aria-checked', x === item ? 'true' : 'false'); });
    } else if (role === 'menuitemcheckbox') item.setAttribute('aria-checked', item.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    if (m.pick) m.pick(item);
    fire(m.el, 'core:select', { item: item, value: item.dataset.value, trigger: m.trig });
    if (!item.hasAttribute('data-core-keep')) menu.close(true);
  }

  /* ═══ Список: select.core-input открывает стеклянный список; на телефоне остаётся системный ═══ */
  function fancy(s) { return s && s.matches('select.core-input:not([multiple]):not([data-core-native])') && !s.disabled && matchMedia('(hover:hover) and (pointer:fine)').matches; }
  function openSelect(s, keyboard) {
    var el = doc.createElement('div'), box = doc.createElement('div'), current = null;
    el.className = 'core-menu'; el.setAttribute('role', 'listbox'); box.className = 'core-menu__scroll'; el.appendChild(box);
    var label = s.getAttribute('aria-label') || (s.labels && s.labels[0] && s.labels[0].textContent.trim()); if (label) el.setAttribute('aria-label', label);
    Array.prototype.forEach.call(s.children, function add(n) {
      if (n.tagName === 'OPTGROUP') {
        var g = doc.createElement('div'); g.className = 'core-menu__label'; g.textContent = n.label; box.appendChild(g);
        Array.prototype.forEach.call(n.children, add); return;
      }
      if (n.tagName !== 'OPTION' || n.hidden) return;
      var b = doc.createElement('button'), t = doc.createElement('span');
      b.type = 'button'; b.className = 'core-menu__item'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', n.selected ? 'true' : 'false');
      b.dataset.i = n.index; b.disabled = n.disabled || (n.parentNode.tagName === 'OPTGROUP' && n.parentNode.disabled);
      t.textContent = n.label || n.text; b.appendChild(t); box.appendChild(b);
      if (n.selected) current = b;
    });
    menu.open(el, s, { width: s.offsetWidth, temp: true, keyboard: true, focus: current, pick: function (item) {
      var i = Number(item.dataset.i); if (s.selectedIndex === i) return;
      s.selectedIndex = i;
      s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true }));
    } });
  }

  /* ═══ Подсказка ═══ */
  var tipEl = null, tipFor = null, tipTimer = 0, tipSeen = 0;
  var tip = {
    show: function (target, text, key) {
      clearTimeout(tipTimer);
      if (!tipEl) { tipEl = doc.createElement('div'); tipEl.className = 'core-tip'; tipEl.id = 'core-tip'; tipEl.setAttribute('role', 'tooltip'); tipEl.hidden = true; }
      if (tipEl.parentNode !== layers()) layers().appendChild(tipEl);
      tipEl.textContent = text;
      if (key) { var k = doc.createElement('kbd'); k.className = 'core-kbd'; k.textContent = key; tipEl.appendChild(k); }
      tipEl.hidden = false; delete tipEl.dataset.coreState;
      place(tipEl, target.getBoundingClientRect(), { side: target.dataset.coreTipSide || 'top', align: 'center', gap: 8 });
      if (tipFor && tipFor !== target) tipFor.removeAttribute('aria-describedby');
      tipFor = target; target.setAttribute('aria-describedby', 'core-tip');
      enter(tipEl);
    },
    hide: function () {
      clearTimeout(tipTimer);
      if (!tipFor) return;
      tipFor.removeAttribute('aria-describedby'); tipFor = null; tipSeen = performance.now();
      leave(tipEl);
    }
  };
  function tipTarget(n) {
    var t = n && n.closest ? n.closest('[data-core-tip],[title]') : null; if (!t) return null;
    if (t.hasAttribute('title')) {   // системную подсказку заменяем своей; имя для экранного диктора сохраняем
      if (!t.closest('.core') || t.closest('[data-core-native]') || /^(IFRAME|LINK|STYLE|ABBR|svg)$/.test(t.tagName)) return null;
      var text = t.getAttribute('title'); if (!text) return null;
      if (!t.hasAttribute('data-core-tip')) t.setAttribute('data-core-tip', text);
      if (!t.getAttribute('aria-label') && !t.textContent.trim()) t.setAttribute('aria-label', text);
      t.removeAttribute('title');
    }
    return t.getAttribute('data-core-tip') ? t : null;
  }
  function tipWant(t, now) {
    clearTimeout(tipTimer);
    if (!t || t === tipFor) return;
    var run = function () { if (t.isConnected) tip.show(t, t.getAttribute('data-core-tip'), t.getAttribute('data-core-tip-key')); };
    if (now || performance.now() - tipSeen < 300) run(); else tipTimer = setTimeout(run, 400);
  }
  doc.addEventListener('pointerover', function (e) {
    if (e.pointerType === 'touch') return;
    var t = tipTarget(e.target);
    if (t) tipWant(t); else if (tipFor && !tipFor.contains(e.target)) tip.hide(); else if (!tipFor) clearTimeout(tipTimer);
  }, true);
  doc.addEventListener('pointerout', function (e) {
    if (!e.relatedTarget) { clearTimeout(tipTimer); tip.hide(); }
  }, true);
  doc.addEventListener('focusin', function (e) {
    var t = tipTarget(e.target), kb = false;
    try { kb = e.target.matches(':focus-visible'); } catch (x) {}
    if (t && kb) tipWant(t, true); else if (tipFor && tipFor !== t) tip.hide();
  });
  doc.addEventListener('focusout', function () { if (tipFor) tip.hide(); });

  /* ═══ Уведомление: вылетает из Ядра, возвращается в него ═══ */
  var toastBox = null;
  function corePoint() { var v = view(), x = parseFloat(token('--core-x')), y = parseFloat(token('--core-y')); return { x: (isNaN(x) ? 50 : x) / 100 * v.w, y: (isNaN(y) ? 50 : y) / 100 * v.h }; }
  function flight(el) { var r = el.getBoundingClientRect(), c = corePoint(); return 'translate(' + (c.x - r.left - r.width / 2).toFixed(1) + 'px,' + (c.y - r.top - r.height / 2).toFixed(1) + 'px) scale(.16)'; }
  // остальные уведомления встают на новое место плавно, а не скачком
  function reflow(change) {
    var kids = Array.prototype.slice.call(toastBox.children), before = kids.map(function (k) { return k.getBoundingClientRect().top; });
    change();
    kids.forEach(function (k, i) {
      if (!k.isConnected || !k.animate) return;
      var d = before[i] - k.getBoundingClientRect().top;
      if (d) k.animate([{ transform: 'translateY(' + d + 'px)' }, { transform: 'none' }], { duration: ms('--core-dur-2'), easing: token('--core-ease-move') || 'ease' });
    });
  }
  function toast(o) {
    o = typeof o === 'string' ? { text: o } : o || {};
    if (!toastBox || !toastBox.isConnected) { toastBox = doc.createElement('div'); toastBox.className = 'core-toasts'; layers().appendChild(toastBox); }
    var el = doc.createElement('div'), mark = doc.createElement('i'), text = doc.createElement('span'), timer = 0, gone = false;
    el.className = 'core-toast'; if (o.tone) el.dataset.tone = o.tone;
    el.setAttribute('role', o.tone === 'bad' ? 'alert' : 'status');
    mark.className = 'core-toast__mark'; mark.setAttribute('aria-hidden', 'true'); text.className = 'core-toast__text'; text.textContent = o.text == null ? '' : String(o.text);
    el.appendChild(mark); el.appendChild(text);
    if (o.action && o.action.label) {
      var b = doc.createElement('button'); b.type = 'button'; b.className = 'core-btn core-btn--quiet core-btn--sm'; b.textContent = o.action.label;
      b.addEventListener('click', function (e) { e.stopPropagation(); if (o.action.onClick) o.action.onClick(); dismiss(); });
      el.appendChild(b);
    }
    function dismiss() {
      if (gone) return; gone = true; clearTimeout(timer);
      var end = function () { reflow(function () { el.remove(); }); };
      if (still() || !el.animate) return end();
      el.animate([{ transform: 'none', opacity: 1 }, { opacity: 1, offset: .5 }, { transform: flight(el), opacity: 0 }], { duration: ms('--core-dur-3'), easing: token('--core-ease-in'), fill: 'forwards' }).finished.then(end, end);
    }
    function arm() { clearTimeout(timer); if (o.duration !== 0) timer = setTimeout(dismiss, o.duration || clamp(2600 + String(o.text || '').length * 45, 3200, o.action ? 9000 : 7000)); }
    el.addEventListener('pointerenter', function () { clearTimeout(timer); });
    el.addEventListener('pointerleave', arm);
    el.addEventListener('focusin', function () { clearTimeout(timer); });
    el.addEventListener('focusout', arm);
    el.addEventListener('click', dismiss);
    while (toastBox.children.length >= 3) toastBox.firstElementChild.remove();
    toastBox.appendChild(el); at(el, view().w / 2, el.getBoundingClientRect().top + 22);
    if (!still() && el.animate) el.animate([{ transform: flight(el), opacity: 0 }, { opacity: 1, offset: .45 }, { transform: 'none', opacity: 1 }], { duration: ms('--core-dur-4'), easing: token('--core-ease-out') });
    arm();
    return { el: el, dismiss: dismiss };
  }

  /* ═══ Капсула подтверждения ═══ */
  var capsule = null;
  function ask(kind, o) {
    o = typeof o === 'string' ? { text: o } : o || {};
    if (capsule) capsule.cancel();
    menu.close(); tip.hide();
    return new Promise(function (resolve) {
      var ru = /^ru/i.test(root.lang || 'ru'), p = origin(o.at) || { x: view().w / 2, y: view().h / 2 }, ret = doc.activeElement;
      var shell = doc.createElement('div'), el = doc.createElement('div'), text = doc.createElement('p'), acts = doc.createElement('div'), field = null;
      var id = 'core-capsule-' + Date.now().toString(36);
      shell.className = 'core-capsule-layer'; el.className = 'core-capsule';
      el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-describedby', id); el.setAttribute('tabindex', '-1');
      text.className = 'core-capsule__text'; text.id = id; text.textContent = o.text == null ? '' : String(o.text);
      acts.className = 'core-capsule__acts'; el.appendChild(text);
      if (kind === 'prompt') {
        field = doc.createElement('input'); field.className = 'core-input core-capsule__field'; field.type = o.type || 'text';
        field.value = o.value == null ? '' : String(o.value); if (o.placeholder) field.placeholder = o.placeholder;
        field.setAttribute('aria-labelledby', id); el.appendChild(field);
      }
      function button(label, cls, value) {
        var b = doc.createElement('button'); b.type = 'button'; b.className = 'core-btn ' + cls; b.textContent = label;
        b.addEventListener('click', function () { done(typeof value === 'function' ? value() : value); });
        acts.appendChild(b); return b;
      }
      // подписи по умолчанию — те же, что сегодня показывает браузер в своих окнах
      var no = kind === 'alert' ? null : button(o.cancel || (ru ? 'Отмена' : 'Cancel'), 'core-btn--quiet', kind === 'confirm' ? false : null);
      var yes = button(o.ok || (ru ? 'ОК' : 'OK'), o.danger ? 'core-btn--danger' : o.main ? 'core-btn--main' : '', kind === 'confirm' ? true : kind === 'prompt' ? function () { return field.value; } : undefined);
      el.appendChild(acts); shell.appendChild(el); layers().appendChild(shell);
      place(el, point(p), { side: 'bottom', align: 'start', gap: 14 });
      enter(el);
      (field || (o.danger && no) || yes).focus({ preventScroll: true }); if (field) field.select();
      function done(value) {
        if (!capsule || capsule.el !== el) return;
        capsule = null;
        leave(el).then(function () { shell.remove(); });
        if (ret && ret.isConnected && ret.focus) ret.focus({ preventScroll: true });
        resolve(value);
      }
      shell.addEventListener('pointerdown', function (e) { if (e.target === shell) { e.preventDefault(); done(kind === 'confirm' ? false : kind === 'prompt' ? null : undefined); } });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target === field) { e.preventDefault(); done(field.value); }
        if (e.key !== 'Tab') return;
        var f = el.querySelectorAll(FOCUSABLE), a = f[0], z = f[f.length - 1];
        if (e.shiftKey && doc.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && doc.activeElement === z) { e.preventDefault(); a.focus(); }
      });
      capsule = { el: el, done: done, cancel: function () { done(kind === 'confirm' ? false : kind === 'prompt' ? null : undefined); } };
    });
  }

  /* ═══ Вкладки ═══ */
  function selectTab(tab, focus) {
    var list = tab.closest('[role=tablist]'); if (!list || off(tab)) return;
    list.querySelectorAll('[role=tab]').forEach(function (t) {
      var on = t === tab, p = t.getAttribute('aria-controls') && doc.getElementById(t.getAttribute('aria-controls'));
      t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1;
      if (p) p.hidden = !on;
    });
    if (focus) tab.focus();
    if (tab.scrollIntoView) tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    fire(tab, 'core:tab', { tab: tab });
  }

  /* ═══ Общие обработчики ═══ */
  doc.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target : e.target.parentElement; if (!t) return;
    var item = opened && t.closest(ITEM);
    if (item && opened.el.contains(item)) { choose(item); return; }
    var trig = t.closest('[data-core-menu]');
    if (trig && !off(trig)) { e.preventDefault(); menu.open(trig.getAttribute('data-core-menu'), trig, { align: trig.dataset.coreAlign, side: trig.dataset.coreSide }); return; }
    if (opened && !opened.el.contains(t) && !(opened.trig && opened.trig.contains(t))) menu.close();
    var open = t.closest('[data-core-open]');
    if (open && !off(open)) { e.preventDefault(); dialog.open(open.getAttribute('data-core-open'), { origin: e }); return; }
    var close = t.closest('[data-core-close]');
    if (close) { var d = close.closest('.core-dialog'); if (d) { e.preventDefault(); dialog.close(d, close.getAttribute('data-core-close') || undefined); } return; }
    var tab = t.closest('.core-tabs [role=tab]'); if (tab) selectTab(tab);
  });
  // нажатие мимо окна закрывает его (нажатие должно начаться на фоне — выделение текста внутри окна не считается)
  var downOn = null;
  doc.addEventListener('pointerdown', function (e) {
    downOn = e.target;
    if (opened && !opened.el.contains(e.target) && !(opened.trig && opened.trig.contains(e.target))) menu.close();
    if (tipFor) tip.hide();
  }, true);
  doc.addEventListener('click', function (e) {
    var d = dialog.top();
    if (d && e.target === d && downOn === d && !d.hasAttribute('data-core-static')) dialog.close(d);
  });
  doc.addEventListener('mousedown', function (e) {
    var s = e.target.closest && e.target.closest('select'); if (e.button !== 0 || !fancy(s)) return;
    e.preventDefault(); s.focus();
    if (opened && opened.trig === s) menu.close(); else openSelect(s);
  });
  doc.addEventListener('keydown', function (e) {
    var a = doc.activeElement, k = e.key;
    if (k === 'Escape') {
      if (tipFor) tip.hide();
      if (capsule) { e.preventDefault(); capsule.cancel(); return; }
      if (opened) { e.preventDefault(); menu.close(true); return; }
      var d = dialog.top(); if (d && !d.hasAttribute('data-core-static')) { e.preventDefault(); dialog.close(d); }
      return;
    }
    if (opened && opened.el.contains(a) || opened && a === opened.trig) {
      var list = items(opened.el), i = list.indexOf(a), go = null;
      if (k === 'ArrowDown') go = list[(i + 1) % list.length];
      else if (k === 'ArrowUp') go = list[(i - 1 + list.length) % list.length];
      else if (k === 'Home') go = list[0];
      else if (k === 'End') go = list[list.length - 1];
      else if (k === 'Tab') { menu.close(true); return; }
      else if (k.length === 1 && k !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {   // переход по первой букве
        var q = k.toLowerCase(), rest = list.slice(i + 1).concat(list.slice(0, i + 1));
        go = rest.filter(function (x) { return x.textContent.trim().toLowerCase().indexOf(q) === 0; })[0] || null;
        if (!go) return;
      }
      if (go) { e.preventDefault(); go.focus({ preventScroll: true }); go.scrollIntoView({ block: 'nearest' }); }
      return;
    }
    if (a && a.matches) {
      if (a.matches('[data-core-menu]') && (k === 'ArrowDown' || k === 'ArrowUp') && !off(a)) { e.preventDefault(); menu.open(a.getAttribute('data-core-menu'), a, { keyboard: true, align: a.dataset.coreAlign, side: a.dataset.coreSide }); return; }
      if (fancy(a) && (k === ' ' || k === 'Enter' || k === 'ArrowDown' || k === 'ArrowUp') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openSelect(a, true); return; }
      if (a.matches('.core-tabs [role=tab]') && /^(ArrowLeft|ArrowRight|Home|End)$/.test(k)) {
        var tabs = Array.prototype.filter.call(a.closest('[role=tablist]').querySelectorAll('[role=tab]'), function (x) { return !off(x); }), j = tabs.indexOf(a);
        e.preventDefault(); selectTab(k === 'Home' ? tabs[0] : k === 'End' ? tabs[tabs.length - 1] : tabs[(j + (k === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length], true);
        return;
      }
    }
    // запасная ловушка фокуса для браузеров без inert
    var top = dialog.top();
    if (k === 'Tab' && top && !('inert' in HTMLElement.prototype)) {
      var f = top.querySelectorAll(FOCUSABLE); if (!f.length) return;
      if (e.shiftKey && (a === f[0] || !top.contains(a))) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && (a === f[f.length - 1] || !top.contains(a))) { e.preventDefault(); f[0].focus(); }
    }
  });
  // прокрутка страницы и смена размера окна закрывают то, что привязано к месту
  window.addEventListener('scroll', function (e) {
    if (opened && !(e.target.nodeType === 1 && opened.el.contains(e.target))) menu.close();
    if (tipFor) tip.hide();
  }, true);
  window.addEventListener('resize', function () { menu.close(); tip.hide(); });

  /* ═══ Свет Ядра: единственное место, где задаётся его положение для кромок ═══ */
  var lightTimer = 0;
  var light = {
    set: function (o, smooth) {
      if (smooth && !still()) {
        root.classList.add('core-light-move'); clearTimeout(lightTimer);
        lightTimer = setTimeout(function () { root.classList.remove('core-light-move'); }, ms('--core-dur-4') + 80);
      }
      ['x', 'y', 'light'].forEach(function (k) { if (o && o[k] != null) root.style.setProperty('--core-' + k, String(o[k])); });
    },
    get: function () { return { x: parseFloat(token('--core-x')), y: parseFloat(token('--core-y')), light: parseFloat(token('--core-light')) }; }
  };

  window.CoreUI = {
    version: 1,
    dialog: dialog, menu: menu, tip: tip, toast: toast, light: light, origin: origin,
    confirm: function (o) { return ask('confirm', o); },
    alert: function (o) { return ask('alert', o); },
    prompt: function (o) { return ask('prompt', o); },
    tabs: { select: selectTab }
  };
})();
