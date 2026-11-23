// Командный тариф (общий для RU и EN): окно «Команда» — покупка мест, приглашение по ссылке, участники.
// Открывается из «Аккаунт → Тариф», из окна «Тарифы», по ссылкам /team и /t/<код> (кука premier_team) и по /chat?team=open.
(function () {
  'use strict';
  const EN = /^en/i.test(document.documentElement.lang || '');
  const seatsRu = (n) => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'место' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'места' : 'мест');
  const monRu = (n) => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'месяц' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'месяца' : 'месяцев');
  const daysRu = (n) => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'день' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'дня' : 'дней');
  const seats = (n) => (EN ? n + (n === 1 ? ' seat' : ' seats') : seatsRu(n));
  const money = (n) => Number(n).toLocaleString(EN ? 'en-US' : 'ru-RU') + ' ₽';
  const date = (t) => new Date(t).toLocaleDateString(EN ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' });
  const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const L = EN ? {
    title: 'Team plan', loading: 'Loading…',
    intro: (o) => `Pro for the whole team: ${money(o.price)} per seat per month, from ${seats(o.min)}. You pay for everyone, each member keeps their own Pro limits. People join via an invite link.`,
    off: 'The team plan is not available right now.', bad: 'This invite link is no longer valid — ask the team owner for a new one.',
    joinT: (n) => `Invitation to the team “${h(n)}”`, joinS: (p) => `Owner: ${h(p.owner)}. ${p.active ? `Free seats: ${p.free}. Pro until ${date(p.until)}.` : 'The team plan is not paid yet — you will get Pro once the owner pays.'}`,
    join: 'Join the team', later: 'Not now', joined: 'You joined the team',
    active: (d) => 'Pro until ' + d, expired: 'Not paid', used: (u, s) => `Members: ${u} of ${seats(s)}`,
    save: 'Save', saved: 'Saved', invite: 'Invite link — send it to colleagues:', copy: 'Copy', copied: 'Link copied',
    relink: 'Create a new link (the old one stops working)', relinkQ: 'Create a new invite link? The current one will stop working.', relinked: 'New link created',
    ownerTag: 'owner', noSeat: 'no seat — Free', remove: 'Remove', removeQ: (l) => `Remove ${l} from the team? They will return to their own plan.`, removed: 'Member removed',
    memberOf: (o) => `Team owner: ${h(o)}.`, youPro: 'You have Pro on a team seat.', youNoSeat: 'No free seat for you right now — ask the owner to add one.',
    leave: 'Leave the team', leaveQ: 'Leave the team? You will return to your own plan.', left: 'You left the team',
    buyT: 'Buy the team plan', renew: 'Renew the team plan', extend: 'Renew or add seats',
    nameL: 'Team name', nameP: 'e.g. Marketing', seatsL: 'Seats (including you)', perSeat: (p) => money(p) + ' per seat / month',
    periodL: 'Period', onlySeats: 'Seats only', months: (n) => n + (n === 1 ? ' month' : ' months'),
    m: { card: 'Card / SBP', robokassa: 'Robokassa', cispay: 'CISPay', crypto: 'Crypto' },
    calc: 'Calculating…', add: (n, d, a) => `+${seats(n)} for the remaining ${d} days: ${money(a)}`, total: 'Total', until: (d) => 'The team will have Pro until ' + d,
    fewer: 'Fewer seats than now: the most recent members will lose Pro.',
    pay: 'Pay', going: 'Redirecting to payment…', waiting: 'Waiting for payment…', noPay: 'Payments are not connected yet — message us on Telegram.',
    accT: 'Team plan', accOn: (n) => `You are on Pro in the team “${n}”`, accOff: (p) => `Pro for your team — ${money(p)} per seat per month`, manage: 'Manage', more: 'Learn more',
    ctaT: 'Need it for a team?', ctaS: (o) => `Pro for the team — ${money(o.price)} per seat per month, from ${seats(o.min)}`,
  } : {
    title: 'Командный тариф', loading: 'Загружаю…',
    intro: (o) => `Pro для всей команды: ${money(o.price)} за место в месяц, от ${seatsRu(o.min)}. Вы платите за всех, у каждого участника свои лимиты Pro. Люди вступают по ссылке-приглашению.`,
    off: 'Командный тариф сейчас недоступен.', bad: 'Ссылка-приглашение больше не действует — попросите у владельца команды новую.',
    joinT: (n) => `Приглашение в команду «${h(n)}»`, joinS: (p) => `Владелец: ${h(p.owner)}. ${p.active ? `Свободно мест: ${p.free}. Pro до ${date(p.until)}.` : 'Команда пока не оплачена — Pro появится, когда владелец оплатит.'}`,
    join: 'Вступить в команду', later: 'Не сейчас', joined: 'Вы в команде',
    active: (d) => 'Pro до ' + d, expired: 'Не оплачена', used: (u, s) => `Участников: ${u} из ${seatsRu(s)}`,
    save: 'Сохранить', saved: 'Сохранено', invite: 'Ссылка-приглашение — отправьте коллегам:', copy: 'Копировать', copied: 'Ссылка скопирована',
    relink: 'Сделать новую ссылку (старая перестанет работать)', relinkQ: 'Сделать новую ссылку? Текущая перестанет работать.', relinked: 'Новая ссылка готова',
    ownerTag: 'владелец', noSeat: 'нет места — Free', remove: 'Убрать', removeQ: (l) => `Убрать ${l} из команды? У него останется свой тариф.`, removed: 'Участник убран',
    memberOf: (o) => `Владелец команды: ${h(o)}.`, youPro: 'У вас Pro на месте команды.', youNoSeat: 'Для вас сейчас нет свободного места — попросите владельца докупить.',
    leave: 'Выйти из команды', leaveQ: 'Выйти из команды? У вас останется свой тариф.', left: 'Вы вышли из команды',
    buyT: 'Оформить командный тариф', renew: 'Продлить командный тариф', extend: 'Продлить или докупить места',
    nameL: 'Название команды', nameP: 'Например, Маркетинг', seatsL: 'Мест (включая вас)', perSeat: (p) => money(p) + ' за место в месяц',
    periodL: 'Срок', onlySeats: 'Только места', months: monRu,
    m: { card: 'Карта / СБП', robokassa: 'Robokassa', cispay: 'CISPay', crypto: 'Крипта' },
    calc: 'Считаю…', add: (n, d, a) => `+${seatsRu(n)} на оставшиеся ${daysRu(d)}: ${money(a)}`, total: 'Итого', until: (d) => 'Pro у команды до ' + d,
    fewer: 'Мест меньше, чем сейчас: у тех, кто вступил позже всех, Pro пропадёт.',
    pay: 'Оплатить', going: 'Переходим к оплате…', waiting: 'Жду оплату…', noPay: 'Оплата пока не подключена — напишите нам в Telegram.',
    accT: 'Командный тариф', accOn: (n) => `У вас Pro в команде «${n}»`, accOff: (p) => `Pro для вашей команды — ${money(p)} за место в месяц`, manage: 'Управлять', more: 'Подробнее',
    ctaT: 'Нужно для команды?', ctaS: (o) => `Pro для команды — ${money(o.price)} за место в месяц, от ${seatsRu(o.min)}`,
  };

  const S = { d: null, seats: 3, months: 1, name: '', method: '', q: null, qerr: '', err: '', timer: 0 };
  const api = (path, body) => memApi(path, body ? { method: 'POST', body: JSON.stringify(body) } : {});
  const bill = () => (typeof BILL !== 'undefined' ? BILL : null);
  const say = (t) => { try { toast(t); } catch {} };
  const methods = () => { const m = (bill() && bill().methods) || {}; return ['card', 'robokassa', 'cispay', 'crypto'].filter((k) => m[k]); };
  const canPay = () => !!(bill() && bill().pay) || methods().length > 0;
  const pickMethod = () => { const ms = methods(); if (ms.includes(S.method)) return S.method; let pm = ''; try { pm = typeof payMethod === 'function' ? payMethod() : ''; } catch {} return ms.includes(pm) ? pm : ms[0] || 'card'; };
  const owner = () => !!(S.d && S.d.team && S.d.team.role === 'owner');
  const activeTeam = () => !!(owner() && S.d.team.active);
  const minSeats = () => { const o = S.d.offer, t = owner() ? S.d.team : null; return S.months === 0 && t ? t.seats + 1 : Math.max(o.min, t ? t.used : 1); };
  const inviteLink = (t) => location.origin + '/t/' + t.code;

  function pendingBox() {
    const p = S.d.pending; if (!p) return '';
    if (p.kind === 'bad') return `<div class="tm-box tm-warn">${L.bad}</div>`;
    if (p.kind !== 'join') return '';
    return `<div class="tm-box tm-invite"><div class="tm-hd"><b>${L.joinT(p.name)}</b></div><div class="tm-meta">${L.joinS(p)}</div>
      <div class="tm-acts"><button class="tm-btn pri" id="tmJoin" type="button">${L.join}</button><button class="tm-btn" id="tmLater" type="button">${L.later}</button></div></div>`;
  }
  function status(t) { return `<span class="tm-st${t.active ? ' on' : ''}">${t.active ? L.active(date(t.until)) : L.expired}</span>`; }
  function ownerBox(t) {
    const people = (t.members || []).map((m) => `<div class="tm-who"><span>${h(m.login)}${m.owner ? ` <small>· ${L.ownerTag}</small>` : ''}${m.seat && t.active ? '' : ` <span class="tm-noseat">${t.active ? L.noSeat : ''}</span>`}</span>${m.owner ? '' : `<button class="tm-rm" type="button" data-tmrm="${h(m.id)}" data-tmlogin="${h(m.login)}">${L.remove}</button>`}</div>`).join('');
    return `<div class="tm-box"><div class="tm-hd"><b>${h(t.name)}</b>${status(t)}</div><div class="tm-meta">${L.used(t.used, t.seats)}</div>
      <div class="tm-row"><input class="tm-inp" id="tmRename" maxlength="60" value="${h(t.name)}"><button class="tm-btn" id="tmRenameBtn" type="button">${L.save}</button></div>
      <div class="tm-f">${L.invite}</div><div class="tm-row tm-linkrow"><code>${h(inviteLink(t))}</code><button class="tm-btn" id="tmCopy" type="button">${L.copy}</button></div>
      <button class="tm-link" id="tmRelink" type="button">${L.relink}</button>
      <div class="tm-list">${people}</div></div>`;
  }
  function memberBox(t) {
    return `<div class="tm-box"><div class="tm-hd"><b>${h(t.name)}</b>${status(t)}</div><div class="tm-meta">${L.memberOf(t.owner)} ${t.mine ? L.youPro : t.active ? L.youNoSeat : ''}</div>
      <div class="tm-acts"><button class="tm-btn" id="tmLeave" type="button">${L.leave}</button></div></div>`;
  }
  function sumHtml() {
    if (S.qerr) return `<span class="tm-err">${h(S.qerr)}</span>`;
    const q = S.q; if (!q) return `<span class="tm-meta">${L.calc}</span>`;
    let s = q.months === 0 ? L.add(q.addSeats, q.restDays, q.prorate)
      : `${seats(q.seats)} × ${money(q.price)} × ${L.months(q.months)} = ${money(q.base)}${q.off ? ` <span class="tm-off">−${q.off}%</span>` : ''}${q.prorate ? '<br>' + L.add(q.addSeats, q.restDays, q.prorate) : ''}`;
    s += `<div class="tm-tot">${L.total}: <b>${money(q.amount)}</b>${q.amount < q.list ? ` <s>${money(q.list)}</s>` : ''}</div><div class="tm-meta">${L.until(date(q.until))}</div>`;
    if (q.fewer) s += `<div class="tm-meta tm-warnt">${L.fewer}</div>`;
    return s;
  }
  function buyBox() {
    const o = S.d.offer, t = owner() ? S.d.team : null;
    if (!o.on) return `<div class="tm-box tm-warn">${L.off}</div>`;
    const pers = (activeTeam() ? [{ months: 0, off: 0 }] : []).concat(S.d.periods && S.d.periods.length ? S.d.periods : [{ months: 1, off: 0 }]);
    const ms = methods(); S.method = pickMethod();
    return `<div class="tm-box"><div class="tm-hd"><b>${t ? (t.active ? L.extend : L.renew) : L.buyT}</b></div>
      ${t ? '' : `<label class="tm-f" for="tmName">${L.nameL}</label><input class="tm-inp" id="tmName" maxlength="60" placeholder="${h(L.nameP)}" value="${h(S.name)}">`}
      <label class="tm-f" for="tmSeats">${L.seatsL}</label>
      <div class="tm-step"><button type="button" data-tmstep="-1" aria-label="−">−</button><input id="tmSeats" type="number" inputmode="numeric" min="${minSeats()}" max="${o.max}" value="${S.seats}"><button type="button" data-tmstep="1" aria-label="+">+</button><span class="tm-meta">${L.perSeat(o.price)}</span></div>
      <div class="tm-f">${L.periodL}</div>
      <div class="tm-seg">${pers.map((p) => `<button type="button" class="${p.months === S.months ? 'on' : ''}" data-tmper="${p.months}">${p.months === 0 ? L.onlySeats : L.months(p.months)}${p.off ? ` <span class="tm-off">−${p.off}%</span>` : ''}</button>`).join('')}</div>
      ${ms.length > 1 ? `<div class="tm-seg tm-paym">${ms.map((k) => `<button type="button" class="${k === S.method ? 'on' : ''}" data-tmpaym="${k}">${L.m[k] || k}</button>`).join('')}</div>` : ''}
      <div class="tm-sum" id="tmSum">${sumHtml()}</div>
      <button class="tm-btn pri tm-pay" id="tmPay" type="button"${canPay() ? '' : ' disabled'}>${L.pay}</button>
      ${canPay() ? '' : `<p class="tm-meta">${L.noPay}</p>`}</div>`;
  }
  function render() {
    const b = $('dbody'); if (!b || !S.d) return;
    const t = S.d.team;
    b.innerHTML = `<div class="tm"><p class="tm-intro">${L.intro(S.d.offer)}</p>${pendingBox()}${t && t.role === 'owner' ? ownerBox(t) + buyBox() : t ? memberBox(t) : buyBox()}<p class="tm-err" id="tmErr">${h(S.err)}</p></div>`;
    wire(b);
  }
  const updSum = () => { const el = $('tmSum'); if (el) el.innerHTML = sumHtml(); const p = $('tmPay'); if (p) p.disabled = !canPay() || !S.q; };
  function requote() {
    clearTimeout(S.timer); S.q = null; S.qerr = ''; updSum();
    if (!S.d || !S.d.offer.on || (S.d.team && S.d.team.role !== 'owner')) return;
    S.timer = setTimeout(() => {
      const want = S.seats + ':' + S.months;
      api('/api/team/quote', { seats: S.seats, months: S.months })
        .then((q) => { if (want === S.seats + ':' + S.months) { S.q = q; S.qerr = ''; } })
        .catch((e) => { if (e.message !== 'auth' && want === S.seats + ':' + S.months) { S.q = null; S.qerr = e.message; } })
        .finally(updSum);
    }, 300);
  }
  function setSeats(n) {
    const o = S.d.offer; n = Math.round(Number(n)); if (!Number.isFinite(n)) n = minSeats();
    S.seats = Math.min(o.max, Math.max(minSeats(), n));
    const i = $('tmSeats'); if (i && String(i.value) !== String(S.seats)) i.value = S.seats;
    requote();
  }
  async function act(path, body, ok, after) {
    S.err = '';
    try {
      const r = await api(path, body); S.d.team = r.team;
      if (after) after();
      say(ok); render(); requote();
      if (typeof loadBill === 'function') Promise.resolve(loadBill()).catch(() => {});
    } catch (e) { if (e.message === 'auth') return; S.err = e.message; const el = $('tmErr'); if (el) el.textContent = e.message; }
  }
  async function pay(btn) {
    S.err = ''; const er = $('tmErr'); if (er) er.textContent = '';
    const method = S.method = pickMethod(), cr = method === 'crypto';
    const w = cr && !/Telegram/i.test(navigator.userAgent) ? window.open('', '_blank') : null;
    const txt = btn.textContent; btn.disabled = true; btn.textContent = L.going;
    try {
      const nm = $('tmName'); if (nm) S.name = nm.value;
      const j = await api('/api/team/pay', { seats: S.seats, months: S.months, method, name: S.name });
      if (method === 'robokassa') {
        const d = document.createElement('div'); d.style.display = 'none'; d.innerHTML = j.form || ''; document.body.appendChild(d);
        const f = d.querySelector('form'); if (!f) throw new Error(EN ? 'Could not open the payment page — try again' : 'Не удалось открыть страницу оплаты — попробуйте ещё раз'); f.submit(); return;
      }
      if (!cr || !w) { if (w) w.close(); location.href = j.url; return; }
      w.location.href = j.url; btn.textContent = L.waiting;
      const done = () => { btn.disabled = false; btn.textContent = txt; reload(); };
      if (typeof watchPay === 'function') Promise.resolve(watchPay(j.order, 1200)).finally(done); else done();
    } catch (e) {
      if (w) w.close(); btn.disabled = false; btn.textContent = txt;
      if (e.message !== 'auth') { S.err = e.message; const el = $('tmErr'); if (el) el.textContent = e.message; }
    }
  }
  function wire(b) {
    const on = (id, fn) => { const el = b.querySelector('#' + id); if (el) el.onclick = () => fn(el); };
    on('tmJoin', () => act('/api/team/join', { code: S.d.pending.code }, L.joined, () => { S.d.pending = null; }));
    on('tmLater', () => { S.d.pending = null; render(); });
    on('tmRenameBtn', () => act('/api/team/rename', { name: $('tmRename').value }, L.saved));
    on('tmCopy', () => { const t = S.d.team, link = inviteLink(t); if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => say(L.copied), () => prompt(L.copy, link)); else prompt(L.copy, link); });
    on('tmRelink', () => { if (confirm(L.relinkQ)) act('/api/team/link', {}, L.relinked); });
    on('tmLeave', () => { if (confirm(L.leaveQ)) act('/api/team/leave', {}, L.left); });
    on('tmPay', (el) => pay(el));
    b.querySelectorAll('[data-tmrm]').forEach((el) => { el.onclick = () => { if (confirm(L.removeQ(el.dataset.tmlogin))) act('/api/team/remove', { uid: el.dataset.tmrm }, L.removed); }; });
    b.querySelectorAll('[data-tmstep]').forEach((el) => { el.onclick = () => setSeats(S.seats + Number(el.dataset.tmstep)); });
    b.querySelectorAll('[data-tmper]').forEach((el) => { el.onclick = () => { S.months = Number(el.dataset.tmper); if (S.seats < minSeats()) S.seats = minSeats(); render(); requote(); }; });
    b.querySelectorAll('[data-tmpaym]').forEach((el) => { el.onclick = () => { S.method = el.dataset.tmpaym; try { localStorage.setItem('premier:paym', S.method); if (typeof PL !== 'undefined' && PL) PL.method = S.method; } catch {} b.querySelectorAll('[data-tmpaym]').forEach((x) => x.classList.toggle('on', x === el)); }; });
    const si = b.querySelector('#tmSeats'); if (si) { si.oninput = () => { const n = Number(si.value); if (n >= minSeats() && n <= S.d.offer.max) { S.seats = n; requote(); } }; si.onchange = () => setSeats(si.value); }
    const nm = b.querySelector('#tmName'); if (nm) nm.oninput = () => { S.name = nm.value; };
  }
  async function reload() {
    const d = await api('/api/team');
    const keepPending = S.d && S.d.pending && !d.pending ? S.d.pending : d.pending;
    S.d = { ...d, pending: keepPending };
    const t = d.team;
    S.months = 1; S.seats = t && t.role === 'owner' ? Math.max(t.seats, d.offer.min) : d.offer.min;
    S.seats = Math.min(d.offer.max, Math.max(minSeats(), S.seats));
    render(); requote();
  }
  async function open() {
    dlgW(true); $('dtitle').textContent = L.title; $('dbody').innerHTML = `<p class="tm-meta">${L.loading}</p>`; $('modal').classList.add('on');
    S.err = ''; S.d = null;
    try { await reload(); }
    catch (e) { if (e.message !== 'auth') $('dbody').innerHTML = `<p class="tm-err">${h(e.message)}</p>`; return; }
    if (!bill() && typeof loadBill === 'function') Promise.resolve(loadBill()).then(() => { render(); requote(); }).catch(() => {});
  }

  // строка в «Аккаунт → Тариф»
  function row(B) {
    const o = B && B.teamOffer, t = B && B.plan && B.plan.team;
    if (!t && !(o && o.on)) return '';
    return `<div class="tm-acc"><svg class="tm-acc-ic"><use href="#i-user"/></svg><div class="tm-acc-tt"><b>${L.accT}</b><span>${t ? L.accOn(h(t)) : L.accOff(o.price)}</span></div><button class="tm-btn" id="tmAcc" type="button">${t ? L.manage : L.more}</button></div>`;
  }
  function bind(el) { const b = el && el.querySelector('#tmAcc'); if (b) b.onclick = () => open(); }

  // блок «Нужно для команды?» внизу окна «Тарифы»
  function addCta() {
    const B = bill(), o = B && B.teamOffer, b = $('dbody');
    if (!o || !o.on || !b || b.querySelector('.team-cta') || b.querySelector('.tm')) return;
    const d = document.createElement('div'); d.className = 'team-cta';
    d.innerHTML = `<svg class="tm-acc-ic"><use href="#i-user"/></svg><div class="tm-acc-tt"><b>${L.ctaT}</b><span>${L.ctaS(o)}</span></div><button class="tm-btn" type="button">${L.more}</button>`;
    d.querySelector('button').onclick = () => open();
    b.appendChild(d);
  }
  if (typeof openPlans === 'function') {
    const orig = openPlans;
    window.openPlans = function () { const r = orig.apply(this, arguments); try { addCta(); } catch {} return r; };
  }

  window.premierTeam = { row, bind, open };

  // автооткрытие: после /team, /t/<код> или из push «Оплата прошла» (/chat?team=open)
  const qs = new URLSearchParams(location.search);
  const fromUrl = qs.get('team') === 'open';
  if (fromUrl) { qs.delete('team'); const s = qs.toString(); history.replaceState(history.state, '', location.pathname + (s ? '?' + s : '') + location.hash); }
  const fromCookie = /(?:^|;\s*)premier_team=[^;]/.test(document.cookie);
  const loggedIn = () => typeof ME !== 'undefined' && ME && ME.id && ME.id !== 'guest';
  if ((fromUrl || fromCookie) && loggedIn()) setTimeout(() => { if (!$('modal').classList.contains('on')) open(); }, 600);
})();
