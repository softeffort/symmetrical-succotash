// Premier — клиент: оформление чата. Один файл для русской и английской версии (язык — по <html lang>), подключается последним.
// Ничего не перестраивает: дополняет уже отрисованный HTML — меню моделей (статус, цена, «видит фото»), подсказки
// (категории), ошибки (кнопки), блоки кода (скачать, строки, сворачивание) — и делает выбор модели шторкой на телефоне.
(function chatUi() {
  const EN = document.documentElement.lang === 'en';
  const pl = (n, a, b, c) => (EN ? (n === 1 ? a : b) : n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);
  const T = EN ? {
    st: { ok: 'Working', bad: 'Having issues', na: 'No data yet' }, vision: 'sees images', costTip: (w) => 'One request uses ' + w + ' messages of your limit',
    retry: 'Retry', other: 'Another model', status: 'Model status', draft: 'Clear the input field first — your draft is there',
    dl: 'Download', lines: (n) => pl(n, 'line', 'lines'), more: (n) => 'Show all ' + n + ' lines', less: 'Collapse',
    cats: [
      { t: 'Website', q: 'Make a website for … : home, services, prices, contacts and a request form. Style — modern and clean' },
      { t: 'Code', q: 'Write a Python function that … Explain the code and add a usage example' },
      { t: 'Image', q: 'Draw an image: … , photorealistic, 16:9' },
      { t: 'Study', q: 'Explain the topic “…” in simple words with examples, then ask me 3 questions to check myself' },
      { t: 'Text', q: 'Write a text for … : goal — …, friendly tone, up to 1000 characters' },
    ],
  } : {
    st: { ok: 'Работает', bad: 'Есть сбои', na: 'Пока нет данных' }, vision: 'видит фото', costTip: (w) => 'Один запрос списывает ' + w + ' ' + pl(w, 'сообщение', 'сообщения', 'сообщений') + ' лимита',
    retry: 'Повторить', other: 'Другая модель', status: 'Статус моделей', draft: 'Сначала очистите поле ввода — там ваш черновик',
    dl: 'Скачать', lines: (n) => pl(n, 'строка', 'строки', 'строк'), more: (n) => 'Показать все ' + n + ' ' + pl(n, 'строку', 'строки', 'строк'), less: 'Свернуть',
    cats: [
      { t: 'Сайт', q: 'Сделай сайт для … : главная, услуги, цены, контакты и форма заявки. Стиль — современный и чистый' },
      { t: 'Код', q: 'Напиши на Python функцию, которая … Объясни код и добавь пример запуска' },
      { t: 'Картинка', q: 'Нарисуй картинку: … , фотореализм, формат 16:9' },
      { t: 'Учёба', q: 'Объясни простыми словами тему «…» с примерами и задай мне 3 вопроса для самопроверки' },
      { t: 'Текст', q: 'Напиши текст для … : цель — …, тон — дружелюбный, длина — до 1000 знаков' },
    ],
  };
  const byId = (id) => document.getElementById(id);
  const h = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mobile = () => window.matchMedia('(max-width: 700px)').matches;
  // глобальные функции чата (в т. ч. объявленные через const) — по прямым ссылкам, не через window
  const G = { cur: () => (typeof cur === 'function' ? cur : null), grow: () => (typeof grow === 'function' ? grow : null), renderSend: () => (typeof renderSend === 'function' ? renderSend : null), toast: () => (typeof toast === 'function' ? toast : null), openAccount: () => (typeof openAccount === 'function' ? openAccount : null) };
  const call = (name, ...a) => { try { const f = G[name] && G[name](); if (f) return f(...a); } catch {} };

  /* ---------- статус моделей (точка в меню) ---------- */
  const ST = new Map(); let stAt = 0;
  async function loadStatus(force) {
    if (!force && Date.now() - stAt < 55000) return;
    stAt = Date.now();
    try {
      const j = await (await fetch('/api/models/status')).json();
      if (!Array.isArray(j)) return;
      ST.clear();
      for (const x of j) ST.set(x.id, x.live && x.live.degraded ? 'bad' : x.probe ? (x.probe.ok ? 'ok' : 'bad') : 'na');
      decorateMenu();
    } catch {}
  }
  setInterval(() => { if (document.visibilityState === 'visible') loadStatus(); }, 60000);

  function decorateMenu() {
    const menu = byId('menu'); if (!menu || typeof MODELS === 'undefined' || !Array.isArray(MODELS)) return;
    menu.querySelectorAll('.opt[data-m]').forEach((el) => {
      const m = MODELS.find((x) => x.id === el.dataset.m); if (!m) return;
      const b = el.querySelector('b'); if (!b) return;
      const st = ST.get(m.id) || 'na';
      let dot = b.querySelector('.cu-dot');
      if (!dot) { dot = document.createElement('i'); b.prepend(dot); }
      if (dot.className !== 'cu-dot ' + st) { dot.className = 'cu-dot ' + st; dot.title = T.st[st]; }
      if (!el.querySelector('.cu-badges')) {
        const w = Number(m.weight) || 1, tags = [];
        if (w > 1) tags.push('<span class="cu-tag cost" title="' + h(T.costTip(w)) + '">×' + w + '</span>');
        if (m.vision) tags.push('<span class="cu-tag">' + h(T.vision) + '</span>');
        if (tags.length) { const box = document.createElement('span'); box.className = 'cu-badges'; box.innerHTML = tags.join(''); b.after(box); }
      }
    });
  }

  /* ---------- новый чат: категории над подсказками ---------- */
  function decorateSugg() {
    const box = byId('sugg'); if (!box) return;
    const s = box.querySelector('.sugg');
    if (!s || box.querySelector('.cu-cats')) return;
    const row = document.createElement('div'); row.className = 'cu-cats';
    row.innerHTML = T.cats.map((c, i) => '<button type="button" data-cucat="' + i + '">' + h(c.t) + '</button>').join('');
    box.insertBefore(row, s);
  }
  function fill(text) {
    const q = byId('q'); if (!q) return;
    q.value = text; call('grow'); call('renderSend'); q.focus();
    const i = text.indexOf('…'); if (i >= 0) q.setSelectionRange(i, i + 1); // выделено «…» — сразу печатайте своё
  }

  /* ---------- ошибки: карточка с действиями ---------- */
  function decorateErrors() {
    const msgs = document.querySelectorAll('.msg'), last = msgs[msgs.length - 1];
    document.querySelectorAll('.errbox:not([data-cu])').forEach((el) => {
      el.dataset.cu = '1';
      const acts = document.createElement('div'); acts.className = 'cu-acts';
      acts.innerHTML = (el.closest('.msg') === last ? '<button type="button" data-cuerr="retry">' + h(T.retry) + '</button>' : '') +
        '<button type="button" data-cuerr="model">' + h(T.other) + '</button><button type="button" data-cuerr="status">' + h(T.status) + '</button>';
      el.after(acts);
    });
  }
  function retry() {
    const c = call('cur'); if (!c || !Array.isArray(c.msgs)) return;
    const u = [...c.msgs].reverse().find((x) => x.r === 'u' && typeof x.t === 'string' && x.t.trim()); if (!u) return;
    const q = byId('q'); if (!q) return;
    if (q.value.trim() && q.value !== u.t) { call('toast', T.draft); return; }
    q.value = u.t; call('grow'); call('renderSend');
    const f = byId('form'); if (f && f.requestSubmit) f.requestSubmit(); else if (byId('send')) byId('send').click();
  }

  /* ---------- блоки кода: строки, «Скачать», сворачивание длинных ---------- */
  const EXT = { python: 'py', py: 'py', javascript: 'js', js: 'js', jsx: 'jsx', typescript: 'ts', ts: 'ts', tsx: 'tsx', html: 'html', css: 'css', json: 'json', bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', powershell: 'ps1', sql: 'sql', yaml: 'yml', yml: 'yml', java: 'java', go: 'go', rust: 'rs', cpp: 'cpp', 'c++': 'cpp', c: 'c', cs: 'cs', csharp: 'cs', php: 'php', ruby: 'rb', kotlin: 'kt', swift: 'swift', xml: 'xml', markdown: 'md', md: 'md', lua: 'lua', dart: 'dart', vue: 'vue', svelte: 'svelte', toml: 'toml', ini: 'ini', dockerfile: 'Dockerfile' };
  // Развёрнутые блоки запоминаем, чтобы перерисовка чата не сворачивала их снова.
  const OPENED = new Set();
  const openKey = (pre) => { const msg = pre.closest('.msg'); return msg && msg.dataset.id ? msg.dataset.id + ':' + [...msg.querySelectorAll('.pre')].indexOf(pre) : ''; };
  function decorateCode() {
    document.querySelectorAll('.pre:not([data-cu])').forEach((pre) => {
      const bar = pre.querySelector('.bar'), code = pre.querySelector('pre code'); if (!bar || !code) return;
      if (bar.querySelector('[data-fdl]')) { pre.dataset.cu = '1'; return; } // файлы проекта — у них своя «Скачать»
      const n = code.textContent.replace(/\n$/, '').split('\n').length, label = bar.querySelector('span');
      if (label) { let c = label.querySelector('.cu-n'); if (!c) { c = document.createElement('small'); c.className = 'cu-n'; label.appendChild(c); } c.textContent = n + ' ' + T.lines(n); }
      const msg = pre.closest('.msg'); if (msg && msg.querySelector('.cursor')) return; // ещё печатается — оформим, когда допишется
      pre.dataset.cu = '1';
      const dl = document.createElement('button'); dl.type = 'button'; dl.dataset.cudl = '1'; dl.textContent = T.dl;
      const copy = bar.querySelector('[data-copycode]'); if (copy) copy.before(dl); else bar.appendChild(dl);
      if (n > 40) {
        pre.classList.add('cu-long'); const more = document.createElement('button'); more.type = 'button'; more.className = 'cu-more'; more.dataset.cumore = String(n);
        const key = openKey(pre); if (key && OPENED.has(key)) pre.classList.add('cu-open');
        more.textContent = pre.classList.contains('cu-open') ? T.less : T.more(n); pre.appendChild(more);
      }
    });
  }
  function download(btn) {
    const pre = btn.closest('.pre'), code = pre && pre.querySelector('pre code'); if (!code) return;
    const label = pre.querySelector('.bar span'), lang = ((label && label.firstChild && label.firstChild.textContent) || '').trim().toLowerCase();
    const ext = EXT[lang] || (/^[a-z0-9]{1,6}$/.test(lang) && lang !== 'код' && lang !== 'code' ? lang : 'txt');
    const url = URL.createObjectURL(new Blob([code.textContent], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = ext === 'Dockerfile' ? 'Dockerfile' : 'premier-code.' + ext;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- общий обработчик кликов ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-cucat],[data-cuerr],[data-cudl],[data-cumore]'); if (!t) return;
    if (t.dataset.cucat !== undefined) { const c = T.cats[+t.dataset.cucat]; if (c) fill(c.q); }
    else if (t.dataset.cuerr === 'retry') retry();
    else if (t.dataset.cuerr === 'model') { const b = byId('mbtn'); if (b) { b.scrollIntoView({ block: 'nearest' }); b.click(); } loadStatus(true); }
    else if (t.dataset.cuerr === 'status') call('openAccount', 'models');
    else if (t.dataset.cudl) download(t);
    else if (t.dataset.cumore) { const pre = t.closest('.pre'), open = pre.classList.toggle('cu-open'), key = openKey(pre); if (key) { if (open) OPENED.add(key); else OPENED.delete(key); } t.textContent = open ? T.less : T.more(+t.dataset.cumore); if (!open) pre.scrollIntoView({ block: 'nearest' }); }
  });

  /* ---------- телефон: выбор модели — шторка снизу ---------- */
  const scrim = document.createElement('div'); scrim.className = 'cu-scrim'; document.body.appendChild(scrim);
  const menu = byId('menu');
  if (menu) {
    new MutationObserver(() => {
      const on = menu.classList.contains('open');
      scrim.classList.toggle('on', on && mobile());
      document.documentElement.classList.toggle('cu-sheet', on && mobile());
      if (on) loadStatus();
    }).observe(menu, { attributes: true, attributeFilter: ['class'] });
    scrim.addEventListener('click', () => menu.classList.remove('open'));
    let y0 = null;
    menu.addEventListener('touchstart', (e) => { y0 = menu.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
    menu.addEventListener('touchend', (e) => { if (y0 != null && e.changedTouches[0].clientY - y0 > 70) menu.classList.remove('open'); y0 = null; }, { passive: true });
  }

  /* ---------- запуск: дополняем всё, что перерисовалось (не чаще раза за кадр) ---------- */
  let queued = false;
  const run = () => {
    if (queued) return; queued = true;
    requestAnimationFrame(() => { queued = false; try { decorateMenu(); decorateSugg(); decorateErrors(); decorateCode(); } catch (e) { console.warn('chat-ui:', e); } });
  };
  new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
  run(); loadStatus(true);
})();
