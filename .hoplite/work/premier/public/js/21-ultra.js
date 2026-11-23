// Premier — клиент: Ultra-модели и кредиты. Отдельное окно «Ultra-кредиты» (#ulWin): баланс, карточки-пакеты,
// своё количество, закреплённая панель оплаты, история. Плюс баланс в строке лимитов, метка Ultra в меню моделей
// и цена запроса над полем ввода. Один файл для RU и EN, подключается последним.
(function ultra() {
  const EN = document.documentElement.lang === 'en';
  const pl = (n, a, b, c) => (EN ? (n === 1 ? a : b) : n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);
  const num = (n) => Number(n).toLocaleString(EN ? 'en-US' : 'ru-RU', { maximumFractionDigits: 2 });
  const rub = (n) => num(n) + ' ₽';
  const kr = (n) => pl(Math.round(n), EN ? 'credit' : 'кредит', EN ? 'credits' : 'кредита', 'кредитов');
  const reqs = (n) => pl(n, EN ? 'request' : 'запрос', EN ? 'requests' : 'запроса', 'запросов');
  const when = (t) => new Date(t).toLocaleString(EN ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const T = EN ? {
    title: 'Ultra credits', off: 'Ultra mode is not enabled yet.', close: 'Close', total: 'Credit balance',
    bought: 'purchased — never expire', gift: (p) => 'from the ' + p + ' plan — expire at the end of the day (Moscow time)', next: (n) => ', tomorrow you get ' + num(n) + ' new',
    needMax: (p) => 'Ultra models are available on the ' + p + ' plan. Purchased credits are kept and will work once ' + p + ' is active.', plans: 'Plans',
    calc: 'How many to buy', per: (p) => '1 credit = ' + rub(p) + ' · the price does not depend on the amount', packs: 'Credit pack', max: 'Maximum',
    own: 'Custom amount', ownSub: (m, p) => 'from 1 to ' + num(m) + ' · 1 credit = ' + rub(p), ownPh: 'Amount', less: 'Less', more: 'More',
    est: (n, m) => '≈ <b>' + num(n) + '</b> ' + reqs(n) + ' to ' + h(m), buy: (q, s) => 'Buy ' + num(q) + ' ' + kr(q) + ' for ' + rub(s), method: 'Payment method',
    rules: 'How credits are spent', rulesShort: 'No answer — refund · purchased credits never expire',
    note: (c) => 'Credits are spent only on Ultra models: the model price per request' + (c.ctxCredits ? ' plus ' + c.ctxCredits + ' for every ' + Math.round(c.ctxStep / 1000) + 'K tokens of chat above ' + Math.round(c.ctxFree / 1000) + 'K' : '') + '. No answer — credits come back. Plan credits are spent first, then purchased ones. Purchased credits never expire.',
    hist: 'History', back: 'Back', histNone: 'No operations yet', histErr: 'Could not load the history', retry: 'Retry',
    kinds: { buy: 'Purchase', use: 'Request', refund: 'Refund', gift: 'Daily plan credits', admin: 'Adjustment', chargeback: 'Payment refunded', api: 'API, daily total' },
    paid: (n) => 'Payment successful! +' + num(n) + ' Ultra ' + kr(n), open: 'Buy credits', lmTitle: 'Ultra credits',
    hint: (c, x) => 'Ultra · this request ≈ ' + num(c) + ' ' + kr(c) + (x ? ' (+' + num(x) + ' for a long chat)' : ''), have: (n) => 'balance ' + num(n), top: 'top up', onMax: (p) => 'Ultra model — available on ' + p,
  } : {
    title: 'Ultra-кредиты', off: 'Ultra-режим пока не включён.', close: 'Закрыть', total: 'Баланс кредитов',
    bought: 'куплено — не сгорают', gift: (p) => 'по тарифу ' + p + ' — сгорят в конце суток по МСК', next: (n) => ', завтра придут новые ' + num(n),
    needMax: (p) => 'Ultra-модели работают на тарифе ' + p + '. Купленные кредиты сохранятся и заработают, когда ' + p + ' будет активен.', plans: 'Тарифы',
    calc: 'Сколько докупить', per: (p) => '1 кредит = ' + rub(p) + ' · цена не зависит от объёма', packs: 'Пакет кредитов', max: 'Максимум',
    own: 'Своё количество', ownSub: (m, p) => 'от 1 до ' + num(m) + ' · 1 кредит = ' + rub(p), ownPh: 'Сколько', less: 'Меньше', more: 'Больше',
    est: (n, m) => '≈ <b>' + num(n) + '</b> ' + reqs(n) + ' к ' + h(m), buy: (q, s) => 'Купить ' + num(q) + ' ' + kr(q) + ' за ' + rub(s), method: 'Способ оплаты',
    rules: 'Как списываются кредиты', rulesShort: 'Нет ответа — вернём · купленные не сгорают',
    note: (c) => 'Кредиты тратятся только на Ultra-модели: цена модели за запрос' + (c.ctxCredits ? ' плюс ' + c.ctxCredits + ' за каждые ' + Math.round(c.ctxStep / 1000) + 'K токенов чата сверх ' + Math.round(c.ctxFree / 1000) + 'K' : '') + '. Нет ответа — кредиты вернутся. Сначала тратятся кредиты тарифа, потом купленные. Купленные не сгорают.',
    hist: 'История', back: 'Назад', histNone: 'Операций пока нет', histErr: 'Не удалось загрузить историю', retry: 'Повторить',
    kinds: { buy: 'Покупка', use: 'Запрос', refund: 'Возврат', gift: 'Кредиты тарифа', admin: 'Начисление', chargeback: 'Возврат платежа', api: 'API за день' },
    paid: (n) => 'Оплата прошла! +' + num(n) + ' Ultra-' + kr(n), open: 'Купить кредиты', lmTitle: 'Ultra-кредиты',
    hint: (c, x) => 'Ultra · этот запрос ≈ ' + num(c) + ' ' + kr(c) + (x ? ' (+' + num(x) + ' за длинный чат)' : ''), have: (n) => 'на балансе ' + num(n), top: 'пополнить', onMax: (p) => 'Ultra-модель — доступна на ' + p,
  };
  const byId = (id) => document.getElementById(id);
  const h = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // глобальные функции чата (в т. ч. объявленные через const) — по прямым ссылкам, не через window
  const G = { cur: () => (typeof cur === 'function' ? cur : null), curModel: () => (typeof curModel === 'function' ? curModel : null), toast: () => (typeof toast === 'function' ? toast : null), loadBill: () => (typeof loadBill === 'function' ? loadBill : null), closePanel: () => (typeof closePanel === 'function' ? closePanel : null), growthLimit: () => (typeof growthLimit === 'function' ? growthLimit : null), openPlans: () => (typeof openPlans === 'function' ? openPlans : null) };
  const call = (name, ...a) => { try { const f = G[name] && G[name](); if (f) return f(...a); } catch {} };
  const hasBill = () => typeof BILL !== 'undefined' && !!BILL;
  const U = () => (hasBill() && BILL.ultra) || null;
  // тариф, на котором работают Ultra-модели (по умолчанию — Ultra); имя берётся из панели
  const pn = () => { const u = U(); return (u && u.plan && u.plan.name) || 'Ultra'; };
  const ultraModels = () => (typeof MODELS !== 'undefined' && Array.isArray(MODELS) ? MODELS.filter((m) => m.ultra) : []);
  const shortName = (n) => String(n || '').replace(/^Claude\s+/i, '');
  const ICO = {
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17h.01"/></svg>',
  };

  /* ---------- расчёты (без DOM, проверяются в tests/ultra.test.js через openUltra.calc) ---------- */
  const PACKS = [100, 500, 1000, 5000];
  const clamp = (q, max) => Math.max(1, Math.min(max, Math.round(+q) || 1));
  const priceOf = (q, u) => Math.max(1, Math.ceil(q * u.price - 1e-9));
  // пакеты, которые помещаются в лимит покупки, плюс «максимум», если его нет среди готовых
  const packsFor = (max) => { const p = PACKS.filter((x) => x <= max); if (max >= 1 && !p.includes(max)) p.push(max); return p; };
  // шаг кнопок −/+ в «своём количестве»
  const stepOf = (q, dir) => (dir > 0 ? (q < 100 ? 10 : q < 1000 ? 100 : 1000) : q <= 100 ? 10 : q <= 1000 ? 100 : 1000);
  const bump = (q, dir, max) => { const s = stepOf(q, dir); const n = dir > 0 ? Math.floor(q / s) * s + s : Math.ceil(q / s) * s - s; return clamp(n, max); };
  // сколько не хватает на запрос (ошибка 402): самый маленький подходящий пакет, иначе максимум
  const pickFor = (short, max) => { if (!(short > 0) || !(max >= 1)) return null; const p = packsFor(max); return { qty: p.find((x) => x >= short) || p[p.length - 1], own: false }; };

  /* ---------- окно «Ultra-кредиты» ---------- */
  const ST = { qty: 500, own: false, view: 'buy', reason: '', back: null, flash: 0, hist: null };
  let root = null, mo = null;
  const isOpen = () => !!root && !root.hidden;
  const phone = () => typeof matchMedia === 'function' && matchMedia('(max-width:700px)').matches;

  function build() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'ulWin'; root.className = 'ulw'; root.hidden = true;
    root.innerHTML = '<div class="ulw-dlg" role="dialog" aria-modal="true" aria-labelledby="ulwTitle"><i class="ulw-grab" aria-hidden="true"></i>' +
      '<div class="ulw-head"><h2 id="ulwTitle" tabindex="-1">' + h(T.title) + '</h2>' +
      '<button type="button" class="btn ulw-hbtn" data-ulw="hist" aria-pressed="false">' + ICO.clock + '<span>' + h(T.hist) + '</span></button>' +
      '<button type="button" class="ib ulw-x" data-ulw="close" aria-label="' + h(T.close) + '">' + ICO.x + '</button></div>' +
      '<div class="ulw-body" id="ulwBody"></div><div class="ulw-foot" id="ulwFoot"></div></div>';
    document.body.appendChild(root);
    root.addEventListener('mousedown', (e) => { if (e.target === root) closeUltra(); });
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onInput);
    root.addEventListener('focusout', (e) => { if (e.target.id === 'ulOwn') syncOwn(true); });
    return root;
  }

  function openUltra(reason, extra) {
    build();
    const wasOpen = isOpen();
    // общее окно (#modal) закрываем, а его старый #payMsg отключаем: lmBuy/lmMsg пишут в первый #payMsg в документе
    if (byId('modal') && byId('modal').classList.contains('on')) call('closePanel');
    document.querySelectorAll('#dbody #payMsg').forEach((x) => x.removeAttribute('id'));
    if (!wasOpen) {
      const a = document.activeElement;
      ST.back = a && a !== document.body && !root.contains(a) ? a : null;
      ST.view = extra && extra.view === 'hist' ? 'hist' : 'buy';
      ST.hist = null;
    }
    ST.reason = typeof reason === 'string' ? reason : '';
    const u = U();
    if (u && extra && extra.need != null) { const p = pickFor(extra.need - (extra.have || 0), u.maxBuy); if (p) { ST.qty = p.qty; ST.own = p.own; } }
    root.hidden = false;
    document.documentElement.classList.add('ulw-lock');
    requestAnimationFrame(() => root.classList.add('on'));
    document.addEventListener('keydown', onKey, true);
    if (!hasBill()) {
      paint();
      call('loadBill');
      let n = 0; const t = setInterval(() => { if (hasBill() || ++n > 40 || !isOpen()) { clearInterval(t); if (isOpen()) { paint(); focusFirst(); } } }, 150);
    } else { paint(); }
    if (!wasOpen) focusFirst();
  }

  function closeUltra() {
    if (!isOpen()) return;
    root.classList.remove('on'); root.hidden = true;
    document.documentElement.classList.remove('ulw-lock');
    document.removeEventListener('keydown', onKey, true);
    if (mo) { mo.disconnect(); mo = null; }
    // тело очищаем, чтобы скрытый #payMsg окна не перехватывал сообщения других окон
    byId('ulwBody').innerHTML = ''; byId('ulwFoot').innerHTML = '';
    const b = ST.back; ST.back = null;
    if (b && document.contains(b) && typeof b.focus === 'function') { try { b.focus(); } catch {} }
  }

  function focusFirst() {
    if (!isOpen()) return;
    const t = phone() ? byId('ulwTitle') : root.querySelector('.ulw-pack[aria-checked="true"]') || (ST.own && byId('ulOwn')) || root.querySelector('.ulw-pack') || byId('ulwTitle');
    try { t.focus({ preventScroll: true }); } catch { t.focus(); }
  }

  const focusables = () => [...root.querySelectorAll('button,input,summary,a[href],[tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null && x.getAttribute('tabindex') !== '-1');

  function onKey(e) {
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeUltra(); return; }
    if (e.key === 'Tab') {
      const f = focusables(); if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
      return;
    }
    // стрелки в группах выбора: пакеты и способы оплаты
    const g = e.target.closest && e.target.closest('[role=radiogroup]');
    if (g && root.contains(g) && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
      const r = [...g.querySelectorAll('[role=radio]')].filter((x) => !x.disabled); const i = r.indexOf(e.target); if (i < 0) return;
      e.preventDefault();
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? r.length - 1 : (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + r.length) % r.length;
      r[j].focus(); r[j].click();
    }
  }

  function paint() {
    const body = byId('ulwBody'), foot = byId('ulwFoot'), hb = root.querySelector('[data-ulw=hist]');
    if (!hasBill()) { hb.hidden = true; foot.innerHTML = ''; body.innerHTML = '<div class="p-skel" role="status" aria-busy="true"><i></i><i></i><i></i></div>'; return; }
    const u = U();
    if (!u || !u.on) {
      hb.hidden = true;
      body.innerHTML = '<div class="ulw-empty"><p>' + h(T.off) + '</p></div>';
      foot.innerHTML = '<div class="ulw-row"><button type="button" class="btn" data-ulw="close">' + h(T.close) + '</button></div>';
      return;
    }
    hb.hidden = false; hb.setAttribute('aria-pressed', String(ST.view === 'hist'));
    if (ST.view === 'hist') { paintHist(); return; }
    ST.qty = clamp(ST.qty, u.maxBuy);
    body.innerHTML = (ST.reason ? '<div class="ulw-alert err" role="alert">' + ICO.warn + '<span>' + h(ST.reason) + '</span></div>' : '') +
      (!u.max ? '<div class="ulw-alert"><span>' + h(T.needMax(pn())) + '</span><button type="button" class="btn" data-ul="plans">' + h(T.plans) + '</button></div>' : '') +
      balHtml(u) +
      '<div class="ulw-sec"><h3 id="ulwCalc">' + h(T.calc) + '</h3><small>' + h(T.per(u.price)) + '</small></div>' +
      '<div class="ulw-packs" role="radiogroup" aria-labelledby="ulwCalc">' + packsFor(u.maxBuy).map((q) => packHtml(q, u)).join('') +
      '<div class="ulw-own" role="group" aria-labelledby="ulwOwnT"><div><b id="ulwOwnT">' + h(T.own) + '</b><small>' + h(T.ownSub(u.maxBuy, u.price)) + '</small></div>' +
      '<div class="ulw-step"><button type="button" data-ulw="minus" aria-label="' + h(T.less) + '">' + ICO.minus + '</button>' +
      '<input id="ulOwn" type="text" inputmode="numeric" autocomplete="off" placeholder="' + h(T.ownPh) + '" aria-label="' + h(T.own) + '" value="' + (ST.own ? ST.qty : '') + '">' +
      '<button type="button" data-ulw="plus" aria-label="' + h(T.more) + '">' + ICO.plus + '</button></div></div></div>' +
      '<details class="ulw-rules"><summary>' + ICO.info + '<b>' + h(T.rules) + '</b><small>' + h(T.rulesShort) + '</small>' + ICO.down + '</summary><p>' + h(T.note(u)) + '</p></details>';
    const m = (BILL.methods) || {};
    const opts = [m.card && ['card', EN ? 'Card' : 'Карта'], m.robokassa && ['robokassa', EN ? 'Foreign card' : 'Зарубежная карта'], m.cispay && ['cispay', EN ? 'SBP' : 'СБП'], m.crypto && ['crypto', EN ? 'Crypto' : 'Криптовалюта']].filter(Boolean);
    const pm = typeof payMethod === 'function' ? payMethod() : '';
    foot.innerHTML = '<div class="ulw-row">' +
      (opts.length > 1 ? '<div class="ulw-pm"><span id="ulwPmT">' + h(T.method) + '</span><div class="ulw-seg" role="radiogroup" aria-labelledby="ulwPmT">' + opts.map(([k, t]) => '<button type="button" role="radio" data-ulpaym="' + k + '" aria-checked="' + (pm === k) + '" tabindex="' + (pm === k ? 0 : -1) + '">' + h(t) + '</button>').join('') + '</div></div>' : '') +
      '<button type="button" class="btn pri ulw-buy" id="ulBuy"></button></div><div class="msgline" id="payMsg" role="status" aria-live="polite"></div>';
    watchBusy();
    sync();
  }

  function balHtml(u) {
    const total = Math.round((u.bal + u.bonus) * 10) / 10, all = Math.max(1e-9, u.bal + u.bonus);
    const showGift = u.bonus > 0 || (u.max && u.daily > 0);
    return '<div class="ulw-bal"><div class="ulw-tot"><small>' + h(T.total) + '</small><b aria-live="polite">⚡ ' + num(total) + (ST.flash ? '<em class="ulw-flash">+' + num(ST.flash) + '</em>' : '') + '</b></div>' +
      '<div class="ulw-leg"><div><i class="d1"></i><b>' + num(u.bal) + '</b><span>' + h(T.bought) + '</span></div>' +
      (showGift ? '<div><i class="d2"></i><b>' + num(u.bonus) + '</b><span>' + h(T.gift(pn()) + (u.max && u.daily ? T.next(u.daily) : '')) + '</span></div>' : '') + '</div>' +
      (total > 0 ? '<div class="ulw-bar" aria-hidden="true"><i class="d1" style="width:' + (u.bal / all) * 100 + '%"></i><i class="d2" style="width:' + (u.bonus / all) * 100 + '%"></i></div>' : '') + '</div>';
  }

  function packHtml(q, u) {
    const ms = ultraModels().slice(0, 3), sum = priceOf(q, u);
    return '<button type="button" class="ulw-pack" role="radio" data-ulpre="' + q + '" aria-checked="false" tabindex="-1" aria-label="' + h(num(q) + ' ' + kr(q) + ' — ' + rub(sum)) + '">' +
      '<span class="ck">' + ICO.check + '</span>' + (q === u.maxBuy && !PACKS.includes(q) ? '<span class="tag">' + h(T.max) + '</span>' : '') +
      '<span class="n">' + num(q) + '</span><span class="u">' + h(kr(q)) + '</span><span class="p">' + rub(sum) + '</span>' +
      (ms.length ? '<span class="e">' + ms.map((m) => { const n = Math.floor(q / Math.max(1, m.credits || 1)); return '<span class="lg">' + T.est(n, shortName(m.name)) + '</span><span class="sm"><i>' + h(shortName(m.name)) + '</i><b>≈ ' + num(n) + '</b></span>'; }).join('') + '</span>' : '') + '</button>';
  }

  // выбор → карточки, поле «своё», кнопка покупки
  function sync() {
    const u = U(); if (!u || ST.view !== 'buy') return;
    const packs = [...root.querySelectorAll('.ulw-pack')];
    const hit = !ST.own && packs.find((x) => +x.dataset.ulpre === ST.qty);
    if (!hit && !ST.own) ST.own = true;
    packs.forEach((x) => { const on = x === hit; x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; });
    if (!hit && packs[0]) packs[0].tabIndex = 0;
    const own = root.querySelector('.ulw-own'); if (own) own.classList.toggle('on', !!ST.own);
    const inp = byId('ulOwn'); if (inp && ST.own && document.activeElement !== inp) inp.value = String(ST.qty);
    if (inp && !ST.own) inp.value = '';
    const b = byId('ulBuy'); if (b && !b.disabled) b.textContent = T.buy(ST.qty, priceOf(ST.qty, u));
  }

  function syncOwn(final) {
    const u = U(), inp = byId('ulOwn'); if (!u || !inp) return;
    const raw = inp.value.replace(/\D/g, '');
    if (!raw) { if (final && ST.own) inp.value = String(ST.qty); return; }
    ST.qty = clamp(+raw, u.maxBuy); ST.own = true;
    if (final || +raw !== ST.qty) inp.value = String(ST.qty);
    sync();
  }

  // пока идёт оплата (lmBuy блокирует кнопку), блокируем и выбор
  function watchBusy() {
    if (mo) mo.disconnect();
    const b = byId('ulBuy'); if (!b || typeof MutationObserver !== 'function') return;
    mo = new MutationObserver(() => {
      const busy = b.disabled;
      byId('ulwFoot').setAttribute('aria-busy', String(busy));
      root.querySelectorAll('.ulw-pack,.ulw-step button,#ulOwn,[data-ulpaym]').forEach((x) => { x.disabled = busy; });
      root.querySelector('.ulw-dlg').classList.toggle('busy', busy);
      if (!busy) sync();
    });
    mo.observe(b, { attributes: true, attributeFilter: ['disabled'] });
  }

  function onClick(e) {
    const t = e.target.closest && e.target.closest('[data-ulw],[data-ulpre],[data-ulpaym],#ulBuy'); if (!t || !root.contains(t)) return;
    const u = U(), a = t.dataset.ulw;
    if (a === 'close') closeUltra();
    else if (a === 'hist') { ST.view = ST.view === 'hist' ? 'buy' : 'hist'; paint(); const f = ST.view === 'hist' ? root.querySelector('[data-ulw=back]') : root.querySelector('[data-ulw=hist]'); if (f) f.focus(); }
    else if (a === 'back') { ST.view = 'buy'; paint(); focusFirst(); }
    else if (a === 'retry') { ST.hist = null; paintHist(); }
    else if ((a === 'minus' || a === 'plus') && u) { ST.qty = bump(ST.own ? ST.qty : ST.qty, a === 'plus' ? 1 : -1, u.maxBuy); ST.own = true; sync(); }
    else if (t.dataset.ulpre && u) { ST.qty = clamp(+t.dataset.ulpre, u.maxBuy); ST.own = false; sync(); }
    else if (t.dataset.ulpaym) {
      if (typeof PL !== 'undefined') PL.method = t.dataset.ulpaym;
      try { localStorage.setItem('premier:paym', t.dataset.ulpaym); } catch {}
      root.querySelectorAll('[data-ulpaym]').forEach((x) => { const on = x === t; x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; });
    } else if (t.id === 'ulBuy' && u && !t.disabled) {
      const m = byId('payMsg'); if (m) { m.className = 'msgline'; m.textContent = ''; }
      if (typeof lmBuy === 'function') lmBuy('credits', t, { qty: ST.qty });
    }
  }

  function onInput(e) { if (e.target.id === 'ulOwn') syncOwn(e.type === 'change'); }

  async function loadHist() {
    try {
      const r = await fetch('/api/billing/ultra'); if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      if (j.ultra && hasBill()) BILL.ultra = j.ultra;
      return j.history || [];
    } catch { return null; }
  }

  async function paintHist() {
    const body = byId('ulwBody'), foot = byId('ulwFoot');
    foot.innerHTML = '';
    const head = '<button type="button" class="ulw-back" data-ulw="back">' + ICO.back + '<span>' + h(T.back) + '</span></button><h3 class="ulw-htitle">' + h(T.hist) + '</h3>';
    if (!ST.hist) {
      body.innerHTML = head + '<div class="p-skel" role="status" aria-busy="true"><i></i><i></i><i></i></div>';
      const list = await loadHist();
      if (!isOpen() || ST.view !== 'hist') return;
      if (!list) { body.innerHTML = head + '<div class="ulw-empty"><p>' + h(T.histErr) + '</p><button type="button" class="btn" data-ulw="retry">' + h(T.retry) + '</button></div>'; return; }
      ST.hist = list;
    }
    const list = ST.hist.slice(0, 50);
    body.innerHTML = head + (list.length ? '<ul class="ulw-hist">' + list.map((x) => '<li><span>' + h(T.kinds[x.kind] || x.kind) + '<small>' + h(when(x.at)) + '</small></span><b class="' + (x.n > 0 ? 'plus' : 'minus') + '">' + (x.n > 0 ? '+' : '') + num(x.n) + '</b></li>').join('') + '</ul>' : '<div class="ulw-empty"><p>' + h(T.histNone) + '</p></div>');
  }

  openUltra.calc = { clamp, priceOf, packsFor, stepOf, bump, pickFor };
  window.openUltra = openUltra;
  window.closeUltra = closeUltra;

  /* ---------- оплата подтверждена (watchPay в 13-billing.js вызывает resetsPaid) ---------- */
  if (typeof resetsPaid === 'function') {
    const rp = resetsPaid;
    resetsPaid = function (j) {
      if (j && j.plan === 'credits') {
        call('toast', T.paid(j.credits || 0)); call('growthLimit');
        if (isOpen()) {
          loadHist().then((list) => {
            if (!isOpen()) return;
            ST.hist = list; ST.flash = j.credits || 0; ST.reason = '';
            if (ST.view === 'buy') { ST.qty = 500; ST.own = false; }
            paint(); ST.flash = 0;
          });
        }
        return;
      }
      return rp.apply(this, arguments);
    };
  }
  /* ---------- «Лимиты и покупки»: раздел с балансом кредитов ---------- */
  if (typeof openLimits === 'function') {
    const ol = openLimits;
    openLimits = function () {
      ol.apply(this, arguments);
      const u = U(), body = byId('dbody'); if (!u || !u.on || !body) return;
      const sec = document.createElement('div'); sec.className = 'lm-sec ul-lm';
      sec.innerHTML = '<h4>⚡ ' + h(T.lmTitle) + '<small>' + h(T.have(Math.round((u.bal + u.bonus) * 10) / 10)) + '</small></h4><button type="button" class="btn" data-ul="open">' + h(T.open) + '</button>';
      const first = body.querySelector('.lm-sec'); if (first) first.after(sec); else body.prepend(sec);
    };
  }
  /* ---------- строка лимитов: бейдж с балансом ---------- */
  function chip() {
    const u = U(), bar = byId('gwBar'); if (!bar || !u || !u.on || !u.max) return;
    const total = Math.round((u.bal + u.bonus) * 10) / 10;
    let line = bar.querySelector('.gw-left');
    if (!line) { line = document.createElement('div'); line.className = 'gw-left'; bar.appendChild(line); bar.hidden = false; }
    let c = line.querySelector('.ul-chip');
    if (!c) { c = document.createElement('button'); c.type = 'button'; c.className = 'ul-chip'; c.dataset.ul = 'open'; line.appendChild(c); }
    c.textContent = '⚡ ' + num(total); c.title = T.title;
  }
  if (typeof growthLimit === 'function') { const gl = growthLimit; growthLimit = function () { gl.apply(this, arguments); try { chip(); hint(); } catch {} }; }

  /* ---------- меню моделей: метка Ultra ---------- */
  function decorateMenu() {
    const menu = byId('menu'); if (!menu) return;
    menu.querySelectorAll('.opt[data-m]').forEach((el) => {
      const m = ultraModels().find((x) => x.id === el.dataset.m); if (!m || el.querySelector('.ul-tag')) return;
      const b = el.querySelector('b'); if (!b) return;
      const t = document.createElement('span'); t.className = 'ul-tag'; t.textContent = 'Ultra · ' + num(m.credits || 1) + (EN ? ' cr' : ' кр.');
      b.after(t);
    });
  }
  /* ---------- над полем ввода: сколько стоит этот запрос ---------- */
  function hint() {
    const bar = byId('gwBar'); if (!bar) return;
    let el = byId('ulHint');
    if (!el) { el = document.createElement('div'); el.id = 'ulHint'; el.className = 'ul-hint'; el.hidden = true; bar.after(el); }
    const u = U(), m = call('curModel');
    if (!u || !u.on || !m || !m.ultra) { el.hidden = true; return; }
    if (!u.max) { el.innerHTML = '<span>⚡ ' + h(T.onMax(pn())) + '</span>'; el.hidden = false; return; }
    const c = call('cur'), q = byId('q');
    let chars = 6000 + ((q && q.value) || '').length, imgs = 0;
    for (const x of ((c && c.msgs) || []).slice(-40)) { chars += String(x.t || '').length; imgs += (x.images || []).length; }
    const tok = Math.round(chars / 3.5) + Math.min(imgs, 4) * 1000;
    const extra = Math.ceil(Math.max(0, tok - u.ctxFree) / Math.max(1, u.ctxStep)) * u.ctxCredits, cost = Math.max(1, m.credits || 1) + extra;
    const have = Math.round((u.bal + u.bonus) * 10) / 10;
    el.classList.toggle('low', have < cost);
    el.innerHTML = '<span>⚡ ' + h(T.hint(cost, extra)) + ' · ' + h(T.have(have)) + '</span>' + (have < cost ? '<button type="button" data-ul="open">' + h(T.top) + '</button>' : '');
    el.hidden = false;
  }

  /* ---------- клики вне окна: чип, «Лимиты и покупки», подсказка, кнопка «Тарифы» ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-ul]'); if (!t) return;
    if (t.dataset.ul === 'open') openUltra();
    else if (t.dataset.ul === 'hist') openUltra('', { view: 'hist' });
    else if (t.dataset.ul === 'plans') { closeUltra(); call('openPlans'); }
    requestAnimationFrame(hint);
  });
  let queued = false;
  const run = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; try { decorateMenu(); hint(); } catch {} }); };
  const q = byId('q'); if (q) q.addEventListener('input', run);
  const menu = byId('menu'); if (menu) new MutationObserver(run).observe(menu, { childList: true });
  const mname = byId('mname'); if (mname) new MutationObserver(run).observe(mname, { childList: true, characterData: true, subtree: true });
  run();
  // кабинет разработчика ведёт на /chat?ultra=1 — открываем окно пополнения кредитов (параметр убираем из адреса)
  try {
    const qs = new URLSearchParams(location.search);
    if (qs.get('ultra') === '1') {
      qs.delete('ultra'); const rest = qs.toString(); history.replaceState(history.state, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
      const loggedIn = () => typeof ME !== 'undefined' && ME && ME.id && ME.id !== 'guest';
      setTimeout(() => { if (loggedIn() && !isOpen()) openUltra(); }, 600);
    }
  } catch {}
})();
