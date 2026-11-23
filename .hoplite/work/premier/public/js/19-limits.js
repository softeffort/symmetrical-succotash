// Premier — клиент: «Лимиты и покупки». Пакеты сообщений, сбросы с автосбросом, «Мои платежи» с перепроверкой оплаты,
// счётчик сообщений над полем ввода для платных тарифов. Один файл для русской и английской версии (язык — по <html lang>).
// Подключается после 15-growth.js: оборачивает growthLimit / growthOut и заменяет окно openReset.
const LM_EN = document.documentElement.lang === 'en';
const lmPl = (n, a, b, c) => (LM_EN ? (n === 1 ? a : b) : n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);
const lmNum = (n) => Number(n).toLocaleString(LM_EN ? 'en-US' : 'ru-RU', { maximumFractionDigits: 1 });
const lmRub = (n) => lmNum(n) + ' ₽';
const lmDate = (t) => new Date(t).toLocaleString(LM_EN ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const lmDay = (t) => new Date(t).toLocaleDateString(LM_EN ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'long' });
const lmMsgs = (n) => lmPl(Math.round(n), LM_EN ? 'message' : 'сообщение', LM_EN ? 'messages' : 'сообщения', 'сообщений');
const lmResets = (n) => lmPl(n, LM_EN ? 'reset' : 'сброс', LM_EN ? 'resets' : 'сброса', 'сбросов');
const LM = LM_EN ? {
  title: 'Limits & purchases', today: 'Messages today', unl: 'no daily cap', of: (u, l) => lmNum(u) + ' of ' + lmNum(l),
  renew: (msk, loc, inn) => 'Renews at 00:00 Moscow time' + (loc ? ' (' + loc + ' your time)' : '') + ' — in ' + inn + '.',
  packs: 'Message packs', packsSub: (d) => 'valid ' + d + ' days', packsNote: 'Pack messages are used only after the daily limit runs out. Expensive models use more than one message per request — same as the daily limit.',
  packBtn: (n) => lmNum(n) + ' ' + lmMsgs(n), per1k: (p) => lmRub(p) + ' per 1,000', have: (l, t) => lmNum(l) + ' left · until ' + lmDay(t),
  resets: 'Limit resets', resetsSub: (n) => n + ' on balance', auto: 'Auto-reset: when messages run out, spend a reset from the balance automatically',
  resetNote: (n) => 'A reset gives back up to ' + lmNum(n) + ' messages of today’s limit and clears the Python, sites and images counters. Resets on the balance never expire.',
  useNow: 'Use a reset now', buyReset: (p) => 'Buy a reset — ' + lmRub(p), method: 'Payment method',
  pays: 'My payments', paysNone: 'No payments yet', check: 'Check', checking: 'Checking…', loading: 'Loading…', paysErr: 'Could not load payments',
  st: { PENDING: 'Awaiting payment', CONFIRMED: 'Paid', CANCELED: 'Canceled', CHARGEBACKED: 'Refunded' },
  what: { reset: (q) => 'Limit reset' + (q > 1 ? ' × ' + q : ''), pack: (n) => 'Pack of ' + lmNum(n) + ' messages', team: 'Team plan' },
  barLeft: (l, L) => lmNum(l) + ' of ' + lmNum(L) + ' messages left today', barPack: (n) => 'pack ' + lmNum(n), barRs: (n) => n + ' ' + lmResets(n),
  barAt: (loc) => 'new at 00:00 MSK' + (loc ? ' (' + loc + ' yours)' : ''), barBtn: 'Limits', barBuy: 'Top up',
  making: 'Creating invoice…', going: 'Redirecting to payment…', waiting: 'Waiting for payment…',
  cryptoOpen: (u) => 'Invoice opened in Crypto Bot. Can’t see it? <a href="' + esc(u) + '" target="_blank" rel="noopener">Open invoice</a>. Everything is credited automatically after payment.',
  paidPack: (n) => 'Payment successful! +' + lmNum(n) + ' messages in your pack', paidNow: 'Payment successful! Limits reset',
  paidBal: (auto) => 'Payment successful! The reset is on your balance' + (auto ? ' — it will be used automatically when messages run out' : ' — use it in “Limits & purchases”'),
  used: 'Limits reset', autoOn: 'Auto-reset is on', autoOff: 'Auto-reset is off', stillPending: 'Payment not received yet — it will be credited automatically as soon as it arrives',
} : {
  title: 'Лимиты и покупки', today: 'Сообщения сегодня', unl: 'без дневного лимита', of: (u, l) => lmNum(u) + ' из ' + lmNum(l),
  renew: (msk, loc, inn) => 'Обновится в 00:00 по Москве' + (loc ? ' (у вас ' + loc + ')' : '') + ' — через ' + inn + '.',
  packs: 'Пакеты сообщений', packsSub: (d) => 'действуют ' + d + ' ' + lmPl(d, 'день', 'дня', 'дней'), packsNote: 'Сообщения из пакета тратятся только после дневного лимита. Дорогие модели списывают больше одного сообщения за запрос — так же, как дневной лимит.',
  packBtn: (n) => lmNum(n) + ' ' + lmMsgs(n), per1k: (p) => lmRub(p) + ' за 1000', have: (l, t) => 'осталось ' + lmNum(l) + ' · до ' + lmDay(t),
  resets: 'Сбросы лимита', resetsSub: (n) => 'на балансе: ' + n, auto: 'Автосброс: когда сообщения закончатся, сам потратить сброс с баланса',
  resetNote: (n) => 'Сброс возвращает до ' + lmNum(n) + ' сообщений из сегодняшнего лимита и обнуляет счётчики Python, сайтов и картинок. Сбросы на балансе не сгорают.',
  useNow: 'Использовать сброс сейчас', buyReset: (p) => 'Купить сброс — ' + lmRub(p), method: 'Способ оплаты',
  pays: 'Мои платежи', paysNone: 'Платежей пока нет', check: 'Проверить', checking: 'Проверяю…', loading: 'Загружаю…', paysErr: 'Не удалось загрузить платежи',
  st: { PENDING: 'Ожидает оплаты', CONFIRMED: 'Оплачен', CANCELED: 'Отменён', CHARGEBACKED: 'Возврат' },
  what: { reset: (q) => 'Сброс лимита' + (q > 1 ? ' × ' + q : ''), pack: (n) => 'Пакет ' + lmNum(n) + ' сообщений', team: 'Командный тариф' },
  barLeft: (l, L) => 'Осталось ' + lmNum(l) + ' из ' + lmNum(L) + ' сообщений на сегодня', barPack: (n) => 'пакет ' + lmNum(n), barRs: (n) => n + ' ' + lmResets(n),
  barAt: (loc) => 'новые в 00:00 МСК' + (loc ? ' (у вас ' + loc + ')' : ''), barBtn: 'Лимиты', barBuy: 'Докупить',
  making: 'Создаю счёт…', going: 'Переходим к оплате…', waiting: 'Жду оплату…',
  cryptoOpen: (u) => 'Счёт открыт в Crypto Bot. Не видите? <a href="' + esc(u) + '" target="_blank" rel="noopener">Открыть счёт</a>. После оплаты всё зачислится само.',
  paidPack: (n) => 'Оплата прошла! В пакете +' + lmNum(n) + ' сообщений', paidNow: 'Оплата прошла! Лимит сброшен',
  paidBal: (auto) => 'Оплата прошла! Сброс на балансе' + (auto ? ' — спишется сам, когда закончатся сообщения' : ' — используйте его в «Лимиты и покупки»'),
  used: 'Лимит сброшен', autoOn: 'Автосброс включён', autoOff: 'Автосброс выключен', stillPending: 'Оплата ещё не поступила — зачислится сама, как только придёт',
};
const LM_KEEP_IMAGES = 4;
const lmOpen = () => $('modal').classList.contains('on') && $('dtitle').textContent === LM.title;
const lmMsg = (html, err) => { const m = $('payMsg'); if (m) { m.className = 'msgline' + (err ? ' err' : ''); m.innerHTML = html; } else if (err) toast(String(html)); };
const lmLocal = (t) => (typeof gwLocalAt === 'function' ? gwLocalAt(t) : '');
const lmResetAt = () => (typeof gwResetsAt === 'function' ? gwResetsAt() : (BILL && BILL.resetsAt) || Date.now());
const lmDur = (ms) => (typeof gwDur === 'function' ? gwDur(ms) : Math.round(ms / 60000) + ' min');
function lmWhat(p) {
  if (p.plan === 'reset') return LM.what.reset(p.qty || 1);
  if (p.plan === 'pack') return LM.what.pack(p.pack || 0);
  if (p.plan === 'credits') return (LM_EN ? 'Ultra credits × ' : 'Ultra-кредиты × ') + lmNum(p.qty || 0);
  if (p.plan === 'team') return LM.what.team;
  const pl = BILL && BILL.plans ? BILL.plans.find((x) => x.id === p.plan) : null;
  return (pl ? pl.name : p.plan) + (p.months > 1 ? ' · ' + p.months + (LM_EN ? ' mo' : ' мес.') : '');
}

/* ---------- окно «Лимиты и покупки» ---------- */
function openLimits(reason) {
  if (!BILL) { loadBill().then(() => BILL && openLimits(reason)); return; }
  dlgW(true); $('dtitle').textContent = LM.title; $('modal').classList.add('on');
  const B = BILL, L = B.limits.m, u = B.used.m, at = lmResetAt(), pk = B.packs || { left: 0, list: [], offers: [], days: 30 }, rs = B.resets || { n: 0 };
  const out = L != null && u >= L, m = B.methods || {};
  const opts = [m.card && ['card', LM_EN ? 'Card' : 'Карта'], m.robokassa && ['robokassa', LM_EN ? 'Foreign card' : 'Зарубежная карта'], m.cispay && ['cispay', LM_EN ? 'SBP' : 'СБП'], m.crypto && ['crypto', LM_EN ? 'Crypto' : 'Криптовалюта']].filter(Boolean);
  $('dbody').innerHTML = (reason ? '<div class="msgline err">' + esc(reason) + '</div>' : '') +
    '<div class="lm-sec"><div class="lm-use"><span>' + esc(LM.today) + '</span><b>' + (L == null ? lmNum(u) + ' · ' + esc(LM.unl) : esc(LM.of(Math.min(u, L), L))) + '</b></div>' +
    (L != null ? '<div class="lm-meter' + (out ? ' out' : '') + '"><i style="width:' + Math.max(0, Math.min(100, (u / L) * 100)) + '%"></i></div>' : '') +
    '<p class="lm-note">' + esc(LM.renew('00:00', lmLocal(at), lmDur(at - Date.now()))) + '</p></div>' +
    (pk.offers && pk.offers.length ? '<div class="lm-sec"><h4>' + esc(LM.packs) + '<small>' + esc(LM.packsSub(pk.days || 30)) + '</small></h4>' +
      (pk.list && pk.list.length ? '<div class="lm-have">' + pk.list.map((x) => '<span>' + esc(LM.have(x.left, x.until)) + '</span>').join('') + '</div>' : '') +
      '<div class="lm-packs">' + pk.offers.map((o) => '<button type="button" class="lm-pack" data-lmpack="' + o.n + '"><b>' + esc(lmRub(o.price)) + '</b><span>' + esc(LM.packBtn(o.n)) + '</span><small>' + esc(LM.per1k(Math.round((o.price / o.n) * 1000))) + '</small></button>').join('') + '</div>' +
      '<p class="lm-note">' + esc(LM.packsNote) + '</p></div>' : '') +
    '<div class="lm-sec"><h4>' + esc(LM.resets) + '<small>' + esc(LM.resetsSub(rs.n || 0)) + '</small></h4>' +
      '<label class="lm-sw"><input type="checkbox" id="lmAuto"' + (B.autoReset !== false ? ' checked' : '') + '><span>' + esc(LM.auto) + '</span></label>' +
      '<div class="lm-row">' + (rs.n > 0 ? '<button type="button" class="btn" id="lmUse">' + esc(LM.useNow) + '</button>' : '') +
      '<button type="button" class="btn" id="lmBuyReset">' + esc(LM.buyReset(B.resetPrice != null ? B.resetPrice : 200)) + '</button></div>' +
      '<p class="lm-note">' + esc(LM.resetNote(B.resetMsgs != null ? B.resetMsgs : 1000)) + '</p></div>' +
    (opts.length > 1 ? '<div class="paym" role="radiogroup" aria-label="' + esc(LM.method) + '"><span>' + esc(LM.method) + '</span><div class="seg">' + opts.map(([k, t]) => '<button type="button" data-lmpaym="' + k + '" aria-checked="' + (payMethod() === k) + '">' + esc(t) + '</button>').join('') + '</div></div>' : '') +
    '<div class="msgline" id="payMsg"></div>' +
    '<div class="lm-sec"><h4>' + esc(LM.pays) + '</h4><div class="lm-pays" id="lmPays"><div class="p-skel" role="status" aria-busy="true"><span class="p-sr">' + esc(LM.loading) + '</span><i></i><i></i></div></div></div>';
  const body = $('dbody');
  body.querySelectorAll('[data-lmpaym]').forEach((b) => { b.onclick = () => { PL.method = b.dataset.lmpaym; try { localStorage.setItem('premier:paym', PL.method); } catch {} openLimits(); }; });
  body.querySelectorAll('[data-lmpack]').forEach((b) => { b.onclick = () => lmBuy('pack', b, { n: +b.dataset.lmpack }); });
  $('lmBuyReset').onclick = () => lmBuy('reset', $('lmBuyReset'), { qty: 1 });
  const use = $('lmUse'); if (use) use.onclick = async () => {
    use.disabled = true;
    try { const j = await memApi('/api/billing/resets/use', { method: 'POST', body: '{}' }); BILL = j.billing; toast(LM.used); lmRefresh(); }
    catch (e) { use.disabled = false; lmMsg(esc(e.message), true); }
  };
  $('lmAuto').onchange = async (e) => {
    const on = e.target.checked;
    try { const j = await memApi('/api/billing/auto-reset', { method: 'POST', body: JSON.stringify({ on }) }); BILL = j.billing; toast(on ? LM.autoOn : LM.autoOff); }
    catch (err) { e.target.checked = !on; lmMsg(esc(err.message), true); }
  };
  lmLoadPays();
}
function lmRefresh() { if (typeof renderPlan === 'function') renderPlan(); if (typeof renderTop === 'function') renderTop(); if (typeof growthLimit === 'function') growthLimit(); if (lmOpen()) openLimits(); }

/* ---------- мои платежи: последние 15, ожидающий можно перепроверить ---------- */
async function lmLoadPays() {
  const box = $('lmPays'); if (!box) return;
  let list;
  try { list = (await memApi('/api/billing/payments')).payments || []; } catch { box.innerHTML = '<p class="lm-note">' + esc(LM.paysErr) + '</p>'; return; }
  if (!$('lmPays')) return;
  if (!list.length) { box.innerHTML = '<p class="lm-note">' + esc(LM.paysNone) + '</p>'; return; }
  const cls = { CONFIRMED: 'ok', PENDING: 'wait', CANCELED: 'bad', CHARGEBACKED: 'bad' };
  box.innerHTML = list.map((p) => '<div class="lm-pay"><div><b>' + esc(lmWhat(p)) + '</b><small>' + esc(lmDate(p.created) + ' · ' + lmRub(p.amount || 0)) + '</small></div>' +
    '<span class="lm-st ' + (cls[p.status] || '') + '">' + esc(LM.st[p.status] || p.status) + '</span>' +
    (p.status === 'PENDING' ? '<button type="button" class="btn" data-lmcheck="' + esc(p.order) + '">' + esc(LM.check) + '</button>' : '') + '</div>').join('');
  box.querySelectorAll('[data-lmcheck]').forEach((b) => { b.onclick = () => lmCheck(b.dataset.lmcheck, b); });
}
async function lmCheck(order, b) {
  b.disabled = true; b.textContent = LM.checking;
  try {
    const j = await (await fetch('/api/pay/check?order=' + encodeURIComponent(order))).json();
    if (j.status === 'CONFIRMED') { if (j.billing) BILL = j.billing; if (j.plan === 'reset' || j.plan === 'pack') resetsPaid(j); else { toast(LM_EN ? 'Payment successful!' : 'Оплата прошла!'); lmRefresh(); } return; }
    if (j.status === 'PENDING') toast(LM.stillPending);
    lmLoadPays();
  } catch (e) { b.disabled = false; b.textContent = LM.check; lmMsg(esc(e.message), true); }
}

/* ---------- покупка пакета или сброса (как buyPlan в 13-billing.js, но со своим телом запроса) ---------- */
async function lmBuy(plan, b, extra) {
  const method = payMethod(), cr = method === 'crypto';
  const w = cr && !/Telegram/i.test(navigator.userAgent) ? window.open('', '_blank') : null;
  b.disabled = true; const t = b.innerHTML; b.textContent = cr ? LM.making : LM.going;
  try {
    const j = await memApi('/api/pay/create', { method: 'POST', body: JSON.stringify({ plan, method, ...extra }) });
    if (method === 'robokassa') { const d = document.createElement('div'); d.style.display = 'none'; d.innerHTML = j.form || ''; document.body.appendChild(d); const f = d.querySelector('form'); if (!f) throw new Error(LM_EN ? 'Could not open the payment page — try another method' : 'Не удалось открыть страницу оплаты — попробуйте другой способ'); f.submit(); return; }
    if (!cr) { location.href = j.url; return; }
    if (w) w.location.href = j.url; else { location.href = j.url; return; }
    b.textContent = LM.waiting; lmMsg(LM.cryptoOpen(j.url));
    watchPay(j.order, 1200).finally(() => { b.disabled = false; b.innerHTML = t; if (lmOpen()) lmLoadPays(); });
  } catch (e) { if (w) w.close(); b.disabled = false; b.innerHTML = t; lmMsg(esc(e.message), true); }
}

// оплата сброса или пакета подтверждена (watchPay в 13-billing.js и «Проверить» здесь)
function resetsPaid(j) {
  if (j.plan === 'pack') toast(LM.paidPack(j.pack || 0));
  else if (j.usedNow) toast(LM.paidNow);
  else toast(LM.paidBal(!BILL || BILL.autoReset !== false));
  lmRefresh();
}

/* ---------- счётчик над полем ввода для платных тарифов (Free — как раньше, в 15-growth.js) ---------- */
function lmBar() {
  const el = $('gwBar'); if (!el || !BILL || !BILL.limits || (typeof gwFree === 'function' && gwFree())) return;
  const L = BILL.limits.m, u = BILL.used.m, pk = (BILL.packs && BILL.packs.left) || 0, rs = (BILL.resets && BILL.resets.n) || 0;
  if (L == null && !pk && !rs) return;
  const left = L == null ? null : Math.max(0, Math.floor(L - u)), out = left === 0 && !pk && !rs, low = left != null && left <= L * 0.2;
  const parts = [left == null ? '' : LM.barLeft(left, L), pk ? LM.barPack(pk) : '', rs ? LM.barRs(rs) : '', left != null ? LM.barAt(lmLocal(lmResetAt())) : ''].filter(Boolean);
  el.innerHTML = '<div class="gw-left' + (out ? ' out' : low ? ' low' : '') + '">' + (L != null ? '<span class="gw-meter"><i style="width:' + Math.max(0, Math.min(100, (left / L) * 100)) + '%"></i></span>' : '') +
    '<span>' + esc(parts.join(' · ')) + '</span><button type="button" data-lm="open">' + esc(out ? LM.barBuy : LM.barBtn) + '</button></div>';
  el.hidden = false;
}

(function lmInit() {
  if (typeof growthLimit === 'function') { const gl = growthLimit; growthLimit = function () { gl.apply(this, arguments); lmBar(); }; }
  // лимит исчерпан на платном тарифе: вместо окна тарифов — «Лимиты и покупки» (пакет, сброс, автосброс)
  if (typeof growthOut === 'function') { const go = growthOut; growthOut = function (j) { if (typeof gwFree === 'function' && !gwFree()) return openLimits(j && j.error); return go.apply(this, arguments); }; }
  openReset = function () { openLimits(); };
  // старые картинки истории заново не отправляем (сервер делает то же): запрос легче и не упирается в лимит прокси 45 МБ
  if (typeof buildHistory === 'function') {
    const bh = buildHistory;
    buildHistory = function () {
      const list = bh.apply(this, arguments);
      try {
        let seen = 0;
        for (let i = list.length - 1; i >= 0; i--) {
          const c = list[i] && list[i].content; if (!Array.isArray(c) || !c.some((p) => p && p.type === 'image_url')) continue;
          if (++seen <= LM_KEEP_IMAGES) continue;
          const text = c.filter((p) => p && p.type === 'text').map((p) => p.text).join('\n');
          list[i] = { ...list[i], content: (text ? text + '\n' : '') + (LM_EN ? '[image from earlier in the chat]' : '[картинка из ранней части чата]') };
        }
      } catch {}
      return list;
    };
  }
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-lm]'); if (b && b.dataset.lm === 'open') openLimits(); });
})();
