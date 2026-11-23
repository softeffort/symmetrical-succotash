// Premier — клиент: billing (общие переменные — в 01-core.js; файлы подключаются по порядку в chat.html)
/* ---------- тарифы и оплата ---------- */
let BILL = null;
const PL = { promo: null, months: (() => { try { return +localStorage.getItem('premier:months') || 1; } catch { return 1; } })() };
// paying for several months at once with a discount: terms and discounts are set in the admin panel (Plans & payments)
const pmPeriods = () => (BILL && Array.isArray(BILL.periods) && BILL.periods.length ? BILL.periods : [{ months: 1, off: 0 }]);
const pmPeriod = () => { const l = pmPeriods(); return l.find((x) => x.months === PL.months) || l[0]; };
const pmDisc = (price, off) => Math.max(1, Math.round(price * (100 - off) / 100));
const pmMonths = (n) => n + (n === 1 ? ' month' : ' months');
// Yandex Metrica goals (if a counter is connected in the admin panel)
const pmGoal = (g) => { try { if (window.PM_YM && typeof window.ym === 'function') window.ym(window.PM_YM, 'reachGoal', g); } catch {} };
let pmPlansSeen = false;
const fmtD = (t) => new Date(t).toLocaleDateString('en-US', { day: 'numeric', month: 'long' });
const rub = (n) => Number(n).toLocaleString('en-US') + ' ₽';
const tierName = (m) => (BILL?.plans.filter((p) => (m.plans || []).includes(p.id)).sort((a, b) => a.price - b.price)[0] || {}).name || 'Pro';
const locked = (m) => !!BILL && !(m.plans || []).includes(BILL.plan.id);
async function loadBill() {
  try { const r = await fetch('/api/billing'); if (r.status === 401) return toLogin(); if (r.ok) BILL = await r.json(); } catch {}
  pickModel(); renderPlan(); renderTop(); renderPub();
}
// модель по умолчанию; недоступную по тарифу меняем на доступную
function pickModel() {
  const ok = (m) => m && !locked(m), c = curModel();
  if (ok(c)) return;
  const d = MODELS.find((m) => m.def);
  const next = ok(d) ? d : MODELS.find(ok) || d || MODELS[0];
  if (next && next.id !== S.model) { S.model = next.id; save(); }
}
function renderPlan() {
  const b = BILL; $('planCard').hidden = !b; if (!b) return;
  const top = Math.max(...b.plans.map((p) => p.tier));
  $('pcName').innerHTML = esc(b.plan.name);
  $('pcUp').textContent = b.plan.tier >= top ? 'Plans' : 'Upgrade';
  const pcRst = $('pcRst'); if (pcRst) pcRst.hidden = !(b.pay && (b.plan.id === 'max' || b.plan.id === 'ultra')); if (pcRst) pcRst.title = 'Gives back up to ' + (b.resetMsgs ?? 1000) + ' messages and clears the Python, websites and images counters for ' + (b.resetPrice ?? 200) + ' ₽';
  const L = b.limits.m, u = b.used.m, bar = !b.unlimited && L != null;
  $('pcBarW').hidden = !bar;
  if (bar) { $('pcBar').style.width = Math.min(100, u / L * 100) + '%'; $('pcBarW').className = 'pc-bar' + (u >= L ? ' out' : L - u <= Math.max(2, L * 0.15) ? ' low' : ''); }
  $('pcText').textContent = (bar ? `${Math.min(u, L)} of ${L} ${plural(L, 'messages', 'messages', 'messages')} today` : 'Unlimited') + (b.plan.until ? ' · until ' + fmtD(b.plan.until) : '');
  if (typeof growthLimit === 'function') growthLimit(); // "N of 20 left" above the input (15-growth.js)
}
function planFeats(p) {
  const top = Math.max(...BILL.plans.map((x) => x.tier)), mods = MODELS.filter((m) => (m.plans || []).includes(p.id)).map((m) => m.name);
  const lim = (n, one, few, many, unl) => n == null ? unl : `${n} ${plural(n, one, few, many)} per day`;
  return [
    lim(p.msgs, 'message', 'messages', 'messages', 'Unlimited messages'),
    mods.length && mods.length === MODELS.length && MODELS.length > 1 ? 'All models: ' + mods.join(', ') : mods.length ? 'Models: ' + mods.join(', ') : 'Basic models',
    ...(p.ultra && p.credits ? ['Claude · ' + p.credits + ' Ultra ' + (p.credits === 1 ? 'credit' : 'credits') + ' per day'] : []),
    p.code == null ? 'Unlimited Python' : `${p.code} Python runs per day`,
    lim(p.sites, 'website', 'websites', 'websites', 'Unlimited websites'),
    ...(BILL.images ? [lim(p.images, 'image', 'images', 'images', 'Unlimited images')] : []),
    ...(BILL.cloud ? [p.pc === 0 ? 'No cloud computer' : 'Cloud computer' + (p.pc ? ' · ' + (p.pc >= 1024 ? +(p.pc / 1024).toFixed(1) + ' GB' : p.pc + ' MB') : '')] : []),
    p.id === 'pro' || p.id === 'max' || p.tier > 0 ? 'Publications without the Premier badge' : 'Publications with the Premier badge',
    'Web, memory, files and voice',
  ];
}
function openPlans(reason) {
  if (!BILL) { loadBill().then(() => BILL && openPlans(reason)); return; }
  dlgW(true); $('dtitle').textContent = 'Premier plans'; $('modal').classList.add('on');
  const top = Math.max(...BILL.plans.map((x) => x.tier)), pro = BILL.plans.find((x) => x.tier === 1);
  const cards = BILL.plans.map((p) => {
    // term: price × months with the term discount; a promo code and the first-purchase discount don't stack — the best price wins (same as the server)
    const per = p.price ? pmPeriod() : { months: 1, off: 0 }, mo = per.months, list = p.price * mo, base = mo > 1 && per.off ? pmDisc(list, per.off) : list;
    const cur = p.id === BILL.plan.id, promo0 = PL.promo && (PL.promo.plan ? PL.promo.plan === p.id : !p.strict) && p.price > 0 ? pmDisc(list, PL.promo.discount) : null;
    const promoP = promo0 != null && promo0 <= base ? promo0 : null, best0 = promoP ?? base;
    const fo = typeof growthFirst === 'function' ? growthFirst({ ...p, price: list }) : null, firstWins = !!fo && fo.price < best0;
    const pay = firstWins ? fo.price : best0, disc = pay < list ? pay : null;
    const term = mo > 1 ? (Math.abs(p.days - 30) <= 1 ? mo + ' months' : p.days * mo + ' days') : p.days + ' days';
    let btn;
    if (!p.price) btn = `<button class="btn" disabled>${cur ? 'Your plan' : 'Free'}</button>`;
    else if (!BILL.pay) btn = `<button class="btn" disabled>Payments coming soon</button>`;
    else btn = `<button class="btn ${p === pro || cur ? 'pri' : ''}" data-buy="${p.id}">${cur ? 'Renew' : p.tier < BILL.plan.tier ? 'Switch' : 'Pay'} ${rub(pay)}</button>`;
    return `<div class="plan${p === pro ? ' hot' : ''}${cur ? ' cur' : ''}">${p === pro ? '<span class="tag">Popular</span>' : ''}
      <div><h3>${esc(p.name)}${cur ? ' <span class="pc-badge">current</span>' : ''}</h3><p>${esc(p.desc || '')}</p></div>
      <div class="price">${p.price ? (disc != null ? `<s>${list}</s>` : '') + rub(pay) + ` <small>/ ${term}</small>` : '0 ₽'}</div>${p.price && mo > 1 ? `<div class="pm-month">≈ ${rub(Math.round(pay / mo))} per month${per.off && !firstWins && promoP == null ? ' · −' + per.off + '%' : ''}</div>` : ''}${firstWins ? `<div class="gw-first">${esc(fo.label)}</div>` : ''}
      <ul>${planFeats(p).map((f) => `<li><svg><use href="#i-check"/></svg><span>${esc(f)}</span></li>`).join('')}</ul>${btn}${p.price && typeof growthTrialLink === 'function' ? growthTrialLink(p) : ''}</div>`;
  }).join('');
  $('dbody').innerHTML = `${reason ? `<div class="reason">${esc(reason)}</div>` : ''}${BILL.pay && pmPeriods().length > 1 ? `<div class="pm-per" role="radiogroup" aria-label="Billing period">${pmPeriods().map((x) => { const on = x.months === pmPeriod().months; return `<button type="button" role="radio" aria-checked="${on}" class="${on ? 'on' : ''}" data-per="${x.months}">${pmMonths(x.months)}${x.off ? `<small>−${x.off}%</small>` : ''}</button>`; }).join('')}</div>` : ''}
    ${BILL.plan.until ? `<div class="msgline">Current: <b>${esc(BILL.plan.name)}</b> until ${fmtD(BILL.plan.until)}. Renewing adds days to your current subscription.</div>` : ''}
    ${BILL.methods?.card && BILL.methods?.crypto ? `<div class="paym" role="radiogroup" aria-label="Payment method"><span>Payment method</span><div class="seg"><button type="button" data-paym="card" aria-checked="${payMethod() === 'card'}">Card or SBP</button><button type="button" data-paym="crypto" aria-checked="${payMethod() === 'crypto'}">Cryptocurrency</button></div></div>` : ''}
    ${typeof growthTrialCard === 'function' ? growthTrialCard() : ''}
    <div class="plans${BILL.plans.length >= 4 ? ' n4' : ''}">${cards}</div>
    ${typeof growthPlansNote === 'function' ? growthPlansNote() : ''}
    <form class="promo" id="promoF" autocomplete="off"><input id="promoIn" placeholder="Promo code" maxlength="30" value="${esc(PL.promo?.code || '')}"><button class="btn">Apply</button><span class="msgline" id="promoMsg">${PL.promo ? `Discount ${PL.promo.discount}% discount will be applied at checkout` + (BILL.offer?.first && BILL.offer.first.percent > PL.promo.discount ? ` (where the ${BILL.offer.first.percent}% first-purchase discount is better, it applies instead)` : '') : ''}</span></form>
    <div class="msgline" id="payMsg"></div>
    <p class="pnote">${BILL.pay ? (payMethod() === 'crypto' ? 'Pay in @CryptoBot: USDT, TON, BTC and other coins — ruble prices are converted at the current exchange rate.' : 'Pay by card or via SBP (Platega).') + ' No auto-renewal — your plan lasts for the period you pay for.' : 'Online payments are coming soon. For now, get a plan through <a href="https://t.me/eidevip" target="_blank" rel="noopener">our Telegram</a>.'} Limits reset at midnight Moscow time.</p>`;
  $('dbody').querySelectorAll('[data-paym]').forEach((b) => { b.onclick = () => { PL.method = b.dataset.paym; try { localStorage.setItem('premier:paym', PL.method); } catch {} openPlans(reason); }; });
  $('dbody').querySelectorAll('[data-per]').forEach((b) => { b.onclick = () => { PL.months = +b.dataset.per; try { localStorage.setItem('premier:months', PL.months); } catch {} openPlans(reason); }; });
  // funnel: the plans window was opened (once per visit)
  if (!pmPlansSeen) { pmPlansSeen = true; pmGoal('plans'); memApi('/api/track', { method: 'POST', body: JSON.stringify({ step: 'plans' }) }).catch(() => {}); }
  $('promoF').onsubmit = async (e) => {
    e.preventDefault(); const code = $('promoIn').value.trim(); if (!code) return;
    const say = (t, c = '') => { $('promoMsg').className = 'msgline ' + c; $('promoMsg').textContent = t; };
    try {
      const j = await memApi('/api/billing/promo', { method: 'POST', body: JSON.stringify({ code }) });
      if (j.gift) { PL.promo = null; BILL = j.billing; renderPlan(); renderTop(); openPlans(); toast(`Promo code activated: ${BILL.plan.name} until ${fmtD(BILL.plan.until)}`); }
      else { PL.promo = j; openPlans(reason); }
    } catch (err) { say(err.message, 'err'); }
  };
}
// paid reset of daily limits: modal with payment method choice (button in the plan card)
function openReset() {
  if (!BILL) { loadBill().then(() => BILL && openReset()); return; }
  if (!BILL.pay) return;
  dlgW(true); $('dtitle').textContent = 'Reset daily limits'; $('modal').classList.add('on');
  const m = BILL.methods || {};
  const opts = [m.card && `<button type="button" data-paym="card" aria-checked="${payMethod() === 'card'}">Card or SBP</button>`, m.crypto && `<button type="button" data-paym="crypto" aria-checked="${payMethod() === 'crypto'}">Cryptocurrency</button>`].filter(Boolean);
  $('dbody').innerHTML = `<div class="msgline">The reset gives back up to ${(BILL.resetMsgs ?? 1000).toLocaleString('en-US')} messages of today's limit (Moscow time) and clears the Python runs, websites and images counters. It applies right after payment.</div>
    ${opts.length > 1 ? `<div class="paym" role="radiogroup" aria-label="Payment method"><span>Payment method</span><div class="seg">${opts.join('')}</div></div>` : ''}
    <button class="btn pri" id="resetGo" style="width:100%;margin-top:12px">Reset limits — ${rub(BILL.resetPrice ?? 200)}</button>
    <div class="msgline" id="payMsg"></div>
    <p class="pnote">No auto-renewals. Limits reset at midnight Moscow time anyway.</p>`;
  $('dbody').querySelectorAll('[data-paym]').forEach((b) => { b.onclick = () => { PL.method = b.dataset.paym; try { localStorage.setItem('premier:paym', PL.method); } catch {} openReset(); }; });
  $('resetGo').onclick = () => buyPlan('reset', $('resetGo'));
}
function payMethod() {
  const m = BILL?.methods || {}; if (!m.card) return m.crypto ? 'crypto' : 'card'; if (!m.crypto) return 'card';
  if (!PL.method) { try { PL.method = localStorage.getItem('premier:paym'); } catch {} }
  return PL.method === 'crypto' ? 'crypto' : 'card';
}
async function buyPlan(id, b, o) {
  const method = payMethod(), crypto_ = method === 'crypto';
  // счёт Crypto Bot открываем в новой вкладке (Telegram), а здесь ждём оплату; окно открываем сразу, иначе браузер заблокирует
  const w = crypto_ && !/Telegram/i.test(navigator.userAgent) ? window.open('', '_blank') : null;
  b.disabled = true; const t = b.textContent; b.textContent = crypto_ ? 'Creating invoice…' : 'Redirecting to payment…';
  try {
    const j = await memApi('/api/pay/create', { method: 'POST', body: JSON.stringify({ plan: id, method, months: id === 'reset' || /^trial/.test(id) ? 1 : pmPeriod().months, qty: id === 'reset' ? ((o && o.qty) || 1) : undefined, now: id === 'reset' ? ((o && o.now) ? 1 : 0) : undefined, promo: id === 'reset' || /^trial/.test(id) ? '' : (PL.promo && (!PL.promo.plan || PL.promo.plan === id) ? PL.promo.code : '') }) });
    if (id !== 'reset') pmGoal('checkout');
    if (!crypto_) { location.href = j.url; return; }
    if (w) { w.location.href = j.url; } else { location.href = j.url; return; }
    b.textContent = 'Waiting for payment…'; const pm = $('payMsg'); if (pm) pm.className = 'msgline';
    if (pm) pm.innerHTML = `The invoice is open in Crypto Bot. Cannot see it? <a href="${esc(j.url)}" target="_blank" rel="noopener">Open invoice</a>. ${id === 'reset' ? 'Your daily limits will be reset automatically after payment.' : 'Your plan will activate automatically after payment.'}`;
    watchPay(j.order, 1200).finally(() => { b.disabled = false; b.textContent = t; });
  }
  catch (err) { if (w) w.close(); b.disabled = false; b.textContent = t; const pm = $('payMsg'); if (pm) { pm.className = 'msgline err'; pm.textContent = err.message; } else toast(err.message); }
}
// ждём подтверждения платежа (возврат со страницы оплаты или счёт в Crypto Bot)
async function watchPay(order, tries = 20) {
  let plan = null;
  for (let i = 0; i < tries; i++) {
    try {
      const j = await (await fetch('/api/pay/check?order=' + encodeURIComponent(order))).json(); plan = j.plan || plan;
      if (j.status === 'CONFIRMED') { if (j.plan !== 'reset' && j.plan !== 'pack' && j.plan !== 'credits') pmGoal('paid'); BILL = j.billing; renderPlan(); renderTop(); if ($('modal').classList.contains('on') && (['Premier plans', 'Reset daily limits'].includes($('dtitle').textContent) || (typeof GWS !== 'undefined' && $('dtitle').textContent === GWS.endTitle))) $('modal').classList.remove('on'); if ((j.plan === 'reset' || j.plan === 'pack' || j.plan === 'credits') && typeof resetsPaid === 'function') resetsPaid(j); else toast(j.plan === 'reset' ? 'Payment successful! Daily limits reset' : `Payment successful! ${BILL.plan.name} active until ${fmtD(BILL.plan.until)}`); return 'ok'; }
      if (j.status === 'CANCELED') { toast('Payment cancelled or invoice expired'); return 'cancel'; }
    } catch {}
    await new Promise((r) => setTimeout(r, 3000));
  }
  toast(plan === 'reset' ? 'Payment is still processing — your daily limits will be reset automatically' : 'Payment is still processing — your plan will activate automatically'); return 'wait';
}
// возврат со страницы оплаты
(async () => {
  const q = new URLSearchParams(location.search), st = q.get('pay'), order = q.get('order'); if (!st) return;
  history.replaceState(null, '', '/chat');
  if (st === 'fail') { toast('Payment failed — please try again'); return; }
  toast('Checking payment…');
  await watchPay(order);
})();
