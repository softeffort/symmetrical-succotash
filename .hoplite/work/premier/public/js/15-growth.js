// Premier — клиент: рост. Пробный период за деньги и скидка первой покупки в окне тарифов, лимиты Free
// (счётчик «Осталось N из 20», мягкое предупреждение, экран «сообщения закончились»), «Пригласи друга», «Поделиться» чатом.
// Один файл для русской и английской версии (язык — по <html lang>). Другие модули вызывают функции отсюда через
// typeof-проверку, поэтому файл подключается последним. Тексты из настроек сервера (env) приходят в /api/config → growth.texts.
const GW_EN = document.documentElement.lang === 'en';
const gwPl = (n, a, b, c) => (GW_EN ? (n === 1 ? a : b) : n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);
const gwRub = (n) => Number(n).toLocaleString(GW_EN ? 'en-US' : 'ru-RU') + ' ₽';
const gwDays = (n) => n + ' ' + gwPl(n, GW_EN ? 'day' : 'день', GW_EN ? 'days' : 'дня', 'дней');
const GW_DEF = GW_EN ? { trialBadge: 'Popular start', warn: 'Your free messages are almost used up. Pro removes the limits' } : { trialBadge: 'Популярный старт', warn: 'Бесплатные сообщения почти закончились. Pro снимает лимиты' };
const gwText = (k) => (typeof CFG !== 'undefined' && CFG && CFG.growth && CFG.growth.texts && CFG.growth.texts[k]) || GW_DEF[k];
const GWS = GW_EN ? {
  left: (n, L) => `${n} of ${L} free messages left today`, plans: 'See plans', hide: 'Hide until tomorrow',
  outBar: 'Free messages for today are used up', outIn: (t) => 'New messages in ' + t, cont: 'Continue with Pro',
  endTitle: 'You’re out of free messages for today', endIn: 'New messages in', wait: 'Wait for the reset',
  endText: (L, at, pro) => `Free includes ${L} messages a day. The limit resets at 00:00 Moscow time${at ? ` (${at} your time)` : ''}.` + (pro ? ` ${pro.name} gives you ${pro.msgs == null ? 'unlimited messages' : pro.msgs + ' messages a day'} and all models.` : ''),
  trialBtn: (t) => `${t.name} for ${gwDays(t.days)} — ${gwRub(t.price)}`, h: 'h', min: 'min', soon: 'less than a minute',
  trialTitle: (t) => `${t.name} for ${gwDays(t.days)} — ${gwRub(t.price)}`, trialText: 'All models, the cloud computer and websites without the badge. Once per plan, before you pay for it. No auto-renewal.', trialLink: (t) => `or ${gwDays(t.days)} for ${gwRub(t.price)}`, trialLinkTip: (t) => `${t.name} trial: ${gwDays(t.days)} for ${gwRub(t.price)}. Once per plan, no auto-renewal`,
  trialGo: (t) => 'Try it for ' + gwRub(t.price), paySoon: 'Payments coming soon',
  first: (p) => `${p}% off your first purchase`, firstNote: (p, names) => `${p}% off your first ${names} purchase is applied automatically. It doesn’t stack with promo codes — you always get the better price.`,
  refTitle: 'Invite a friend', refSub: (d, plan) => `When your friend makes their first payment, you both get +${gwDays(d)} of ${plan}`, copy: 'Copy',
  refInv: 'invited', refPaid: 'paid', refBon: 'bonuses', refRules: (d, plan, max, trial) => [`Your friend signs up with your link and pays for any plan${trial === false ? ' (the trial doesn’t count)' : ' (the trial counts too)'}.`, `Then +${gwDays(d)} of ${plan} goes to both of you — added to your current plan.`, `Up to ${max} bonuses per account.`],
  refMax: (max) => `You’ve received the maximum of ${max} bonuses. Your friends still get their bonus days.`, copied: 'Link copied', copyFail: 'Copy the link:',
  bindOk: (j) => `Invitation accepted: after your first payment you both get +${gwDays(j.days)} of ${j.plan}`, bindLegacy: (j) => `You were invited by @${j.by || ''} — +${j.bonus || 50} messages for you`,
  share: 'Share', shTitle: 'Share chat', shIntro: 'Anyone with the link can read this conversation. Your name and email are not shown, and attached files and photos are not published.',
  shMake: 'Create link', shUpd: 'Update', shOpen: 'Open', shOff: 'Turn off link', shOffQ: 'Turn off the link? It will stop working for everyone right away.', shOffOk: 'Link turned off',
  shMeta: (d, v, n) => `Snapshot from ${d} · views: ${v} · messages: ${n}. New messages appear at the link after “Update”.`, shMade: 'Link created and copied', shUpdOk: 'Link updated', loading: 'Loading…', locale: 'en-US',
} : {
  left: (n, L) => `Осталось ${n} из ${L} ${gwPl(L, 'бесплатного сообщения', 'бесплатных сообщений', 'бесплатных сообщений')} на сегодня`, plans: 'Тарифы', hide: 'Скрыть до завтра',
  outBar: 'Бесплатные сообщения на сегодня закончились', outIn: (t) => 'Новые — через ' + t, cont: 'Продолжить на Pro',
  endTitle: 'Бесплатные сообщения на сегодня закончились', endIn: 'Новые сообщения через', wait: 'Дождаться сброса',
  endText: (L, at, pro) => `На Free — ${L} ${gwPl(L, 'сообщение', 'сообщения', 'сообщений')} в день. Лимит обновляется в 00:00 по Москве${at ? ` (у вас ${at})` : ''}.` + (pro ? ` На ${pro.name} — ${pro.msgs == null ? 'сообщения без ограничений' : pro.msgs + ' ' + gwPl(pro.msgs, 'сообщение', 'сообщения', 'сообщений') + ' в день'} и все модели.` : ''),
  trialBtn: (t) => `${t.name} на ${gwDays(t.days)} — ${gwRub(t.price)}`, h: 'ч', min: 'мин', soon: 'меньше минуты',
  trialTitle: (t) => `${t.name} на ${gwDays(t.days)} — ${gwRub(t.price)}`, trialText: 'Все модели, облачный компьютер и сайты без плашки. Один раз на тариф — пока вы за него не платили. Без автопродления.', trialLink: (t) => `или ${gwDays(t.days)} за ${gwRub(t.price)}`, trialLinkTip: (t) => `Пробный ${t.name}: ${gwDays(t.days)} за ${gwRub(t.price)}. Один раз на тариф, без автопродления`,
  trialGo: (t) => 'Попробовать за ' + gwRub(t.price), paySoon: 'Оплата скоро',
  first: (p) => `−${p}% на первую покупку`, firstNote: (p, names) => `−${p}% на первую покупку ${names} применяется автоматически, без промокода. С промокодом не суммируется — берётся более выгодная цена.`,
  refTitle: 'Пригласи друга', refSub: (d, plan) => `Когда друг впервые оплатит тариф, вы оба получите +${gwDays(d)} ${plan}`, copy: 'Скопировать',
  refInv: 'приглашено', refPaid: 'оплатили', refBon: 'бонусов', refRules: (d, plan, max, trial) => [`Друг регистрируется по вашей ссылке и оплачивает любой тариф${trial === false ? ' (пробный период не считается)' : ' (пробный период тоже подходит)'}.`, `Тогда вам обоим начисляется +${gwDays(d)} ${plan} — к текущему сроку.`, `Не больше ${max} бонусов на аккаунт.`],
  refMax: (max) => `Вы получили максимум — ${max} бонусов. Друзья по-прежнему получают свои дни.`, copied: 'Ссылка скопирована', copyFail: 'Скопируйте ссылку:',
  bindOk: (j) => `Приглашение принято: после первой оплаты вы оба получите +${gwDays(j.days)} ${j.plan}`, bindLegacy: (j) => `Вас пригласил @${j.by || ''} — вам +${j.bonus || 50} сообщений`,
  share: 'Поделиться', shTitle: 'Поделиться чатом', shIntro: 'Любой, у кого есть ссылка, сможет прочитать эту переписку. Ваше имя и почта не показываются, прикреплённые файлы и фото не публикуются.',
  shMake: 'Создать ссылку', shUpd: 'Обновить', shOpen: 'Открыть', shOff: 'Отключить ссылку', shOffQ: 'Отключить ссылку? Она сразу перестанет открываться у всех.', shOffOk: 'Ссылка отключена',
  shMeta: (d, v, n) => `Снимок от ${d} · просмотров: ${v} · сообщений: ${n}. Новые сообщения появятся по ссылке после «Обновить».`, shMade: 'Ссылка создана и скопирована', shUpdOk: 'Ссылка обновлена', loading: 'Загружаю…', locale: 'ru-RU',
};

function gwDur(ms) {
  if (ms < 60000) return GWS.soon;
  const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60000);
  return (h ? h + ' ' + GWS.h + ' ' : '') + m + ' ' + GWS.min;
}
const gwResetsAt = () => (BILL && BILL.resetsAt) || (Date.parse(new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10) + 'T00:00:00+03:00') + 864e5);
// местное время сброса, если пользователь не в часовом поясе Москвы
const gwLocalAt = (t) => (new Date(t).getTimezoneOffset() === -180 ? '' : new Date(t).toLocaleTimeString(GWS.locale, { hour: '2-digit', minute: '2-digit' }));
const gwToday = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const gwFree = () => !!(BILL && !BILL.unlimited && BILL.limits && BILL.limits.m != null && !(BILL.plan.tier > 0));
const gwPro = () => BILL && (BILL.plans.find((p) => p.id === 'pro') || BILL.plans.find((p) => p.tier === 1));
function gwCopy(text) {
  const ok = () => toast(GWS.copied), fail = () => prompt(GWS.copyFail, text);
  if (navigator.clipboard && window.isSecureContext !== false) navigator.clipboard.writeText(text).then(ok, fail); else fail();
}

/* ---------- лимиты Free: счётчик, предупреждение, лимит исчерпан (строка над полем ввода) ---------- */
function growthLimit() {
  const el = $('gwBar'); if (!el) return;
  if (!gwFree()) { el.hidden = true; el.innerHTML = ''; return; }
  const L = BILL.limits.m, rb = BILL.ref && BILL.ref.bonus ? BILL.ref.bonus.n : 0, left = Math.max(0, Math.floor(L - BILL.used.m)) + Math.floor(rb);
  const pct = Number.isFinite(+(CFG && CFG.growth && CFG.growth.warnPct)) ? +CFG.growth.warnPct : Number.isFinite(+BILL.warnPct) ? +BILL.warnPct : 20;
  const low = left > 0 && pct > 0 && left <= Math.max(1, Math.floor(L * pct / 100));
  let hidden = false; try { hidden = localStorage.getItem('premier:warn-hide') === gwToday(); } catch {}
  const meter = `<span class="gw-meter"><i style="width:${Math.max(0, Math.min(100, left / L * 100))}%"></i></span>`;
  let h = '';
  if (left <= 0) h = `<div class="gw-out" role="status"><span>${esc(GWS.outBar)}<small>${esc(GWS.outIn(gwDur(gwResetsAt() - Date.now())))}</small></span><button type="button" class="btn pri" data-gw="plans">${esc(GWS.cont)}</button></div>`;
  else if (low && !hidden) h = `<div class="gw-warn" role="status"><span>${esc(gwText('warn'))}</span><button type="button" class="btn pri" data-gw="plans">${esc(GWS.plans)}</button><button type="button" class="gw-x" data-gw="hide" aria-label="${esc(GWS.hide)}" title="${esc(GWS.hide)}">×</button></div>`;
  h += `<div class="gw-left${left <= 0 ? ' out' : low ? ' low' : ''}">${meter}<span>${esc(GWS.left(Math.min(left, L), L))}</span>${left > 0 && !(low && !hidden) ? `<button type="button" data-gw="plans">${esc(GWS.plans)}</button>` : ''}</div>`;
  el.innerHTML = h; el.hidden = false;
}
// экран «сообщения закончились»: время до сброса, «Продолжить на Pro», «Дождаться сброса» (и пробный период, если доступен)
let gwTick = null;
function growthOut(j) {
  if (!gwFree()) { openPlans(j && j.error); return; } // на платных тарифах — как раньше, окно тарифов
  const at = (j && j.resetsAt) || gwResetsAt(), t = BILL.offer && BILL.offer.trial, pro = gwPro(), L = BILL.limits.m;
  dlgW(false); $('dtitle').textContent = GWS.endTitle; $('modal').classList.add('on');
  $('dbody').innerHTML = `<div class="gw-end"><p style="margin-top:0">${esc(GWS.endIn)}</p><div class="gw-clock" id="gwClock">${esc(gwDur(at - Date.now()))}</div>
    <p>${esc(GWS.endText(L, gwLocalAt(at), pro && pro.price > 0 ? pro : null))}</p>
    <div class="gw-acts"><button type="button" class="btn pri" data-gw="plans">${esc(GWS.cont)}</button>${t && BILL.pay ? `<button type="button" class="btn" data-buy="trial">${esc(GWS.trialBtn(t))}</button>` : ''}<button type="button" class="btn" data-gw="close">${esc(GWS.wait)}</button></div>
    <div class="msgline" id="payMsg"></div></div>`;
  clearInterval(gwTick);
  gwTick = setInterval(() => {
    const c = $('gwClock'); if (!c || !$('modal').classList.contains('on')) { clearInterval(gwTick); return; }
    const ms = at - Date.now(); c.textContent = gwDur(Math.max(0, ms));
    if (ms <= 0) { clearInterval(gwTick); $('modal').classList.remove('on'); loadBill(); }
  }, 15000);
}

/* ---------- окно тарифов: пробный период и скидка первой покупки ---------- */
// «или 3 дня за 249 ₽» в карточке тарифа (пробный период этого тарифа, если доступен этому пользователю)
function growthTrialLink(p) {
  const t = BILL && BILL.pay && BILL.offer && (BILL.offer.trials || []).find((x) => x.plan === p.id); if (!t) return '';
  return `<button type="button" class="gw-tr" data-buy="trial:${esc(p.id)}" title="${esc(GWS.trialLinkTip(t))}">${esc(GWS.trialLink(t))}</button>`;
}
function growthTrialCard() {
  const t = BILL && BILL.offer && BILL.offer.trial; if (!t) return '';
  return `<div class="gw-trial"><span class="tag">${esc(gwText('trialBadge'))}</span><div><b>${esc(GWS.trialTitle(t))}</b><small>${esc(GWS.trialText)}</small></div>` +
    (BILL.pay ? `<button type="button" class="btn pri" data-buy="trial">${esc(GWS.trialGo(t))}</button>` : `<button type="button" class="btn" disabled>${esc(GWS.paySoon)}</button>`) + '</div>';
}
// цена со скидкой первой покупки для тарифа (или null)
function growthFirst(p) {
  const f = BILL && BILL.offer && BILL.offer.first;
  return f && p && p.price > 0 && f.plans.includes(p.id) ? { price: Math.max(1, Math.round(p.price * (100 - f.percent) / 100)), percent: f.percent, label: GWS.first(f.percent) } : null;
}
function growthPlansNote() {
  const f = BILL && BILL.offer && BILL.offer.first; if (!f) return '';
  const names = f.plans.map((id) => (BILL.plans.find((p) => p.id === id) || { name: id }).name).join(GW_EN ? ' or ' : ' и ');
  return `<p class="pnote">${esc(GWS.firstNote(f.percent, names))}</p>`;
}

/* ---------- «Пригласи друга»: бонус обоим после первой оплаты друга ---------- */
function growthRefCard(RF) {
  if (!RF || !RF.on) return '';
  const link = location.origin + '/r/' + RF.code;
  return `<div class="refcard"><div class="rc-top"><div class="rc-ic"><svg><use href="#i-user"/></svg></div><div class="rc-tt"><b>${esc(GWS.refTitle)}</b><small>${esc(GWS.refSub(RF.days, RF.plan))}</small></div></div>
    <div class="rc-link"><code>${esc(link)}</code><button type="button" class="btn rc-copy" data-gw-copy="${esc(link)}"><svg><use href="#i-copy"/></svg>${esc(GWS.copy)}</button></div>
    <div class="rc-stats"><div class="rc-stat"><b>${RF.total}</b><small>${esc(GWS.refInv)}</small></div><div class="rc-stat"><b>${RF.paid}</b><small>${esc(GWS.refPaid)}</small></div><div class="rc-stat"><b>${RF.rewarded} / ${RF.max}</b><small>${esc(GWS.refBon)}</small></div></div>
    <ul class="rc-rules">${GWS.refRules(RF.days, RF.plan, RF.max, RF.trial).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    ${RF.left <= 0 ? `<div class="rc-note">${esc(GWS.refMax(RF.max))}</div>` : ''}</div>`;
}

/* ---------- «Поделиться» чатом: ссылка только для чтения ---------- */
function growthTop() {
  const b = $('shareBtn'); if (!b) return;
  const c = typeof cur === 'function' ? cur() : null, on = !!(CFG && CFG.growth && CFG.growth.share);
  b.hidden = !on || !c || !c.msgs.some((m) => m.r === 'a' && !m.err && (m.t || (m.gens && m.gens.length)));
}
async function openShare() {
  const c = cur(); if (!c) return;
  dlgW(false); $('dtitle').textContent = GWS.shTitle; $('modal').classList.add('on');
  $('dbody').innerHTML = `<div class="gw-sh"><p>${esc(GWS.shIntro)}</p><div id="gwSh"><div class="msgline">${esc(GWS.loading)}</div></div></div>`;
  try { const j = await memApi('/api/share?cid=' + encodeURIComponent(c.id)); gwShare(c, j.share); }
  catch (e) { const el = $('gwSh'); if (el) el.innerHTML = `<div class="msgline err">${esc(e.message)}</div>`; }
}
function gwShare(c, sh, note) {
  const el = $('gwSh'); if (!el) return;
  const date = (t) => new Date(t).toLocaleString(GWS.locale, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  el.innerHTML = sh
    ? `<div class="gw-row"><input id="gwShUrl" readonly value="${esc(sh.url)}" aria-label="URL"><button type="button" class="btn pri" data-gw-copy="${esc(sh.url)}">${esc(GWS.copy)}</button></div>
      <div class="gw-acts"><a class="btn" href="${esc(sh.url)}" target="_blank" rel="noopener">${esc(GWS.shOpen)}</a><button type="button" class="btn" id="gwShMake">${esc(GWS.shUpd)}</button><button type="button" class="btn bad" id="gwShOff">${esc(GWS.shOff)}</button></div>
      <div class="gw-meta">${esc(GWS.shMeta(date(sh.updated), sh.views, sh.msgs))}</div><div class="msgline" id="gwShMsg">${note ? esc(note) : ''}</div>`
    : `<div class="gw-acts"><button type="button" class="btn pri" id="gwShMake">${esc(GWS.shMake)}</button></div><div class="msgline" id="gwShMsg">${note ? esc(note) : ''}</div>`;
  const say = (t, err) => { const m = $('gwShMsg'); if (m) { m.className = 'msgline' + (err ? ' err' : ''); m.textContent = t; } };
  const u = $('gwShUrl'); if (u) u.onfocus = () => u.select();
  $('gwShMake').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    const make = () => memApi('/api/share', { method: 'POST', body: JSON.stringify({ cid: c.id }) });
    try {
      await push(); // на сервере должен быть свежий чат
      let j; try { j = await make(); } catch (err) { if (!/не найден|not found/i.test(err.message)) throw err; await new Promise((r) => setTimeout(r, 1800)); await push(); j = await make(); }
      gwShare(c, j.share, sh ? GWS.shUpdOk : GWS.shMade); if (!sh) gwCopy(j.share.url);
    } catch (err) { b.disabled = false; say(err.message, true); }
  };
  const off = $('gwShOff');
  if (off) off.onclick = async () => {
    if (!confirm(GWS.shOffQ)) return; off.disabled = true;
    try { await memApi('/api/share/' + encodeURIComponent(sh.id), { method: 'DELETE' }); gwShare(c, null, GWS.shOffOk); }
    catch (err) { off.disabled = false; say(err.message, true); }
  };
}

/* ---------- запуск ---------- */
(function growthInit() {
  const sb = $('shareBtn'); if (sb) { sb.onclick = openShare; const s = sb.querySelector('span'); if (s) s.textContent = GWS.share; }
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-gw-copy],[data-gw]'); if (!t) return;
    if (t.dataset.gwCopy) { e.preventDefault(); gwCopy(t.dataset.gwCopy); return; }
    const a = t.dataset.gw;
    if (a === 'plans') openPlans();
    else if (a === 'close') $('modal').classList.remove('on');
    else if (a === 'hide') { try { localStorage.setItem('premier:warn-hide', gwToday()); } catch {} growthLimit(); }
  });
  // приглашение: код запомнили на главной или на странице входа (/r/<код> → /login?ref=…)
  try {
    const r = localStorage.getItem('premier:ref');
    if (r && ME.id && ME.id !== 'guest') {
      localStorage.removeItem('premier:ref');
      const fp = typeof fpHash === 'function' ? fpHash() : (() => { try { const s = [navigator.userAgent, Intl.DateTimeFormat().resolvedOptions().timeZone || '', screen.width + 'x' + screen.height, navigator.language || ''].join('|'); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); } catch { return ''; } })();
      fetch('/api/referrals/bind', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: r, fp }) })
        .then((x) => x.json().catch(() => ({})))
        .then((j) => { if (j.ok) { toast(j.by ? GWS.bindLegacy(j) : GWS.bindOk(j)); loadBill(); } else if (j.error && j.code !== 409) toast(j.error); })
        .catch(() => {});
    }
  } catch {}
  // с главной нажали «Попробовать за 99 ₽» или «Выбрать Pro» — сразу показываем тарифы
  try { const o = localStorage.getItem('premier:open'); if (o && ME.id && ME.id !== 'guest') { localStorage.removeItem('premier:open'); setTimeout(() => openPlans(), 600); } } catch {}
  if (typeof BILL !== 'undefined' && BILL) growthLimit();
  growthTop();
  setInterval(() => { const el = $('gwBar'); if (el && !el.hidden && el.querySelector('.gw-out')) growthLimit(); }, 60000); // «Новые — через …»
})();
