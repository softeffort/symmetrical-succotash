// Личные уведомления Premier: карточка в левом нижнем углу сайта. Отправляются из панели (Пользователи → «Оповестить»).
// Закрытая карточка больше не появляется: отметка хранится на сервере (и в localStorage, пока сервер не подтвердил).
// В панели скрипт подключён с data-preview="1": ничего не загружает, только рисует карточку для предпросмотра.
(() => {
  'use strict';
  const SELF = document.currentScript;
  const PREVIEW = !!(SELF && SELF.dataset.preview);
  const RANK = { info: 1, warn: 2, urgent: 3, critical: 4 };
  const T = {
    ru: { info: 'Сообщение от Premier', warn: 'Важно', urgent: 'Срочная просьба', critical: 'Требуется ваше внимание', close: 'Закрыть', ok: 'Понятно', open: 'Открыть',
      reply: 'Ответить', send: 'Отправить', cancel: 'Отмена', ph: 'Ваш ответ…', thanks: 'Спасибо! Ответ отправлен', prev: 'Предыдущее', next: 'Следующее',
      region: 'Уведомления', err: 'Не удалось отправить — попробуйте ещё раз', now: 'только что', min: 'мин назад', h: 'ч назад', yday: 'вчера', d: 'дн. назад', hint: 'Ctrl+Enter — отправить' },
    en: { info: 'Message from Premier', warn: 'Important', urgent: 'Urgent request', critical: 'Action required', close: 'Close', ok: 'Got it', open: 'Open',
      reply: 'Reply', send: 'Send', cancel: 'Cancel', ph: 'Your reply…', thanks: 'Thanks! Your reply has been sent', prev: 'Previous', next: 'Next',
      region: 'Notifications', err: 'Could not send — please try again', now: 'just now', min: 'min ago', h: 'h ago', yday: 'yesterday', d: 'd ago', hint: 'Ctrl+Enter to send' },
  };
  const pageLang = () => (/^en/i.test(document.documentElement.lang || '') ? 'en' : 'ru');
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICO = {
    info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6h.01"/>'),
    warn: svg('<path d="M10.3 4.2 2.7 17.4A2 2 0 0 0 4.4 20.4h15.2a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 16.9h.01"/>'),
    urgent: svg('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
    critical: svg('<path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z"/><path d="M12 8v4.5M12 16h.01"/>'),
    x: svg('<path d="M18 6 6 18M6 6l12 12"/>'), left: svg('<path d="m15 18-6-6 6-6"/>'), right: svg('<path d="m9 18 6-6-6-6"/>'),
    arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'), ext: svg('<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
    reply: svg('<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>'), check: svg('<path d="M20 6 9 17l-5-5"/>'),
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeLink = (u) => (/^\/(?!\/)/.test(u) || /^https?:\/\//i.test(u) ? u : '');
  const aTag = (url, text, preview) => { const ext = /^https?:/i.test(url); return `<a href="${preview ? '#' : url}"${ext && !preview ? ' target="_blank" rel="noopener noreferrer"' : ''}>${text}</a>`; };
  // текст: экранируем, затем **жирный**, [ссылка](https://…), голые https://…, переносы строк
  function fmt(s, preview) {
    let h = esc(s);
    h = h.replace(/\*\*([^*\n]{1,200})\*\*/g, '<b>$1</b>');
    h = h.replace(/\[([^\]\n]{1,80})\]\(((?:https?:\/\/|\/(?!\/))[^\s)]{1,300})\)/g, (m, text, url) => aTag(url, text, preview));
    // голые адреса — только вне уже готовых ссылок
    h = h.split(/(<a [^>]*>.*?<\/a>)/).map((part, i) => (i % 2 ? part : part.replace(/(^|[\s(])(https?:\/\/[^\s<)"]{2,300}[^\s<)".,!?;:])/g, (m, pre, url) => pre + aTag(url, url.replace(/^https?:\/\/(www\.)?/i, ''), preview)))).join('');
    return h.replace(/\n/g, '<br>');
  }
  function ago(ts, L, lang) {
    const s = (Date.now() - ts) / 1000;
    if (s < 60) return L.now;
    if (s < 3600) return Math.floor(s / 60) + ' ' + L.min;
    if (s < 86400) return Math.floor(s / 3600) + ' ' + L.h;
    if (s < 172800) return L.yday;
    if (s < 30 * 86400) return Math.floor(s / 86400) + ' ' + L.d;
    return new Date(ts).toLocaleDateString(lang === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'short' });
  }

  /* ---------- карточка (общая для сайта и предпросмотра в панели) ---------- */
  function card(n, o = {}) {
    const lang = o.lang || pageLang(), L = T[lang] || T.ru, level = RANK[n.level] ? n.level : 'info', count = o.count || 1, idx = o.index || 0;
    const link = safeLink(String(n.link || '')), ext = /^https?:/i.test(link), crit = level === 'critical';
    const el = document.createElement('section');
    el.className = 'pn-card pn-' + level + (o.preview ? ' pn-static' : '');
    el.setAttribute('role', level === 'urgent' || crit ? 'alert' : 'status');
    el.setAttribute('aria-label', L[level]);
    el.dataset.id = n.id || '';
    const pager = count > 1 ? `<div class="pn-pager"><button type="button" class="pn-ib" data-pn="prev" aria-label="${L.prev}"${idx <= 0 ? ' disabled' : ''}>${ICO.left}</button><span>${idx + 1} / ${count}</span><button type="button" class="pn-ib" data-pn="next" aria-label="${L.next}"${idx >= count - 1 ? ' disabled' : ''}>${ICO.right}</button></div>` : '';
    const acts = [
      link ? `<a class="pn-btn pn-cta" data-pn="click" href="${esc(o.preview ? '#' : link)}"${ext && !o.preview ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(n.linkText || L.open)}${ext ? ICO.ext : ICO.arrow}</a>` : '',
      crit ? `<button type="button" class="pn-btn ${link ? 'pn-ghost' : 'pn-cta'}" data-pn="close">${L.ok}</button>` : '',
      n.reply ? `<button type="button" class="pn-btn pn-ghost" data-pn="reply">${ICO.reply}${L.reply}</button>` : '',
    ].join('');
    el.innerHTML = `<div class="pn-head"><span class="pn-ico">${ICO[level]}</span><div class="pn-meta"><b>${L[level]}</b>${n.at ? `<span>${esc(ago(n.at, L, lang))}</span>` : ''}</div>${pager}${crit ? '' : `<button type="button" class="pn-ib pn-x" data-pn="close" aria-label="${L.close}" title="${L.close}">${ICO.x}</button>`}</div>`
      + (n.title ? `<div class="pn-title">${esc(n.title)}</div>` : '')
      + `<div class="pn-text">${fmt(n.text, o.preview)}</div>`
      + (acts ? `<div class="pn-actions" data-pn-acts>${acts}</div>` : '')
      + (n.reply ? `<form class="pn-reply" hidden novalidate><textarea maxlength="2000" rows="3" placeholder="${L.ph}" aria-label="${L.ph}"></textarea><div class="pn-err" hidden></div><div class="pn-actions"><button type="submit" class="pn-btn pn-cta">${L.send}</button><button type="button" class="pn-btn pn-ghost" data-pn="cancel">${L.cancel}</button><span class="pn-hint">${L.hint}</span></div></form>` : '');
    return el;
  }

  window.PremierNotices = { card, levels: Object.keys(RANK), labels: T, preview: PREVIEW };
  if (PREVIEW) return;

  /* ---------- живая карточка на сайте ---------- */
  const LS_CLOSED = 'premier:notices:closed', LS_QUEUE = 'premier:notices:queue';
  const ls = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const S = { items: [], cur: null, root: null, replying: false, seen: new Set(), last: 0, poll: 60e3, stopped: false, busy: false };
  const L = () => T[pageLang()] || T.ru;

  // закрытые в этом браузере: прячем сразу, не дожидаясь сервера (неделю — дальше решает сервер)
  function closedMap() { const c = ls.get(LS_CLOSED, {}), old = Date.now() - 7 * 864e5; for (const k of Object.keys(c)) if (c[k] < old) delete c[k]; return c; }
  function markClosed(id) { const c = closedMap(); c[id] = Date.now(); ls.set(LS_CLOSED, c); }
  // отметки «закрыл/нажал» — сначала в очередь, из очереди убираем после ответа сервера (переживает обрыв сети и переход по ссылке)
  const post = (id, act, body) => fetch('/api/notices/' + id + '/' + act, { method: 'POST', credentials: 'same-origin', keepalive: act !== 'reply', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  function report(id, act) {
    const q = ls.get(LS_QUEUE, []).filter((x) => !(x[0] === id && x[1] === act)); q.push([id, act]); ls.set(LS_QUEUE, q.slice(-50));
    post(id, act).then((r) => { if (r.status < 500) ls.set(LS_QUEUE, ls.get(LS_QUEUE, []).filter((x) => !(x[0] === id && x[1] === act))); }).catch(() => {});
  }
  function flushQueue() { for (const [id, act] of ls.get(LS_QUEUE, [])) report(id, act); }
  function markSeen(n) {
    if (!n || n.seen || S.seen.has(n.id) || document.hidden) return;
    S.seen.add(n.id); n.seen = true; post(n.id, 'seen').catch(() => S.seen.delete(n.id));
  }

  function load(force) {
    if (S.stopped || S.busy || (document.hidden && !force)) return;
    if (!force && Date.now() - S.last < 10e3) return;
    S.last = Date.now(); S.busy = true;
    fetch('/api/notices', { credentials: 'same-origin', cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      S.busy = false; if (!d) return;
      if (d.guest) { S.stopped = true; hide(); return; } // не вошёл — больше не спрашиваем
      if (d.poll) S.poll = Math.max(15, +d.poll || 60) * 1000;
      flushQueue();
      const closed = closedMap();
      update((Array.isArray(d.items) ? d.items : []).filter((n) => n && n.id && !closed[n.id]));
    }).catch(() => { S.busy = false; });
  }
  function update(list) {
    const before = S.items.map((n) => n.id).join(), had = new Set(S.items.map((n) => n.id)), fresh = list.filter((n) => !had.has(n.id));
    S.items = list;
    if (S.replying) return; // не мешаем писать ответ — обновим после
    if (!list.length) return hide();
    const cur = list.find((n) => n.id === S.cur);
    // пришло более срочное, чем то, что на экране, — показываем его
    if (!cur || fresh.some((n) => RANK[n.level] > RANK[cur.level])) S.cur = (fresh.length && cur ? fresh.sort((a, b) => RANK[b.level] - RANK[a.level])[0] : list[0]).id;
    if (list.map((n) => n.id).join() === before && S.root && S.root.isConnected) { // ничего не изменилось — только «5 мин назад»
      const n = list.find((x) => x.id === S.cur), t = S.root.querySelector('.pn-meta span');
      if (n && n.at && t) t.textContent = ago(n.at, L(), pageLang());
      return;
    }
    render(!S.root || !S.root.isConnected ? 'pn-in' : 'pn-swap');
  }
  function render(anim) {
    if (!S.items.length) return hide();
    let i = S.items.findIndex((n) => n.id === S.cur); if (i < 0) i = 0;
    const n = S.items[i]; S.cur = n.id;
    if (!S.root || !S.root.isConnected) {
      S.root = document.createElement('div'); S.root.className = 'pn-root'; S.root.setAttribute('role', 'region'); S.root.setAttribute('aria-label', L().region);
      S.root.addEventListener('click', onClick); S.root.addEventListener('keydown', onKey); S.root.addEventListener('submit', onSubmit);
      document.body.appendChild(S.root); anim = 'pn-in';
    }
    const el = card(n, { index: i, count: S.items.length });
    if (anim) el.classList.add(anim);
    S.root.innerHTML = (S.items.length > 2 ? '<div class="pn-layer pn-l2"></div>' : '') + (S.items.length > 1 ? '<div class="pn-layer pn-l1"></div>' : '');
    S.root.appendChild(el);
    markSeen(n);
  }
  function hide() { if (S.root) { S.root.remove(); S.root = null; } S.cur = null; S.replying = false; }
  // убрать карточку (закрыта, нажата кнопка, отправлен ответ) и показать следующую
  function drop(id) {
    const i = S.items.findIndex((n) => n.id === id);
    S.items = S.items.filter((n) => n.id !== id); S.replying = false;
    S.cur = S.items.length ? S.items[Math.min(Math.max(0, i), S.items.length - 1)].id : null;
    const el = S.root && S.root.querySelector('.pn-card');
    if (!el) return render('pn-in');
    el.classList.remove('pn-in', 'pn-swap'); el.classList.add('pn-out');
    setTimeout(() => { if (S.items.length) render('pn-in'); else hide(); }, 190);
  }
  function move(d) {
    const i = S.items.findIndex((n) => n.id === S.cur), j = Math.max(0, Math.min(S.items.length - 1, i + d));
    if (j === i) return; S.cur = S.items[j].id; render('pn-swap');
    const b = S.root && S.root.querySelector(`[data-pn="${d < 0 ? 'prev' : 'next'}"]:not(:disabled)`); if (b) b.focus();
  }
  function openReply(on) {
    const el = S.root && S.root.querySelector('.pn-card'); if (!el) return;
    const f = el.querySelector('.pn-reply'), acts = el.querySelector('[data-pn-acts]'); if (!f) return;
    S.replying = !!on; f.hidden = !on; if (acts) acts.hidden = !!on;
    if (on) { f.querySelector('textarea').focus(); return; }
    render(); // заодно применяем обновления, пришедшие, пока писали ответ
    const b = S.root && S.root.querySelector('[data-pn="reply"]'); if (b) b.focus();
  }
  function onClick(e) {
    const b = e.target.closest('[data-pn]'); if (!b) return;
    const a = b.dataset.pn, id = S.cur;
    if (a === 'close') { e.preventDefault(); markClosed(id); report(id, 'close'); drop(id); }
    else if (a === 'click') { markClosed(id); report(id, 'click'); drop(id); } // переход по ссылке не отменяем: отметка уходит с keepalive
    else if (a === 'prev' || a === 'next') move(a === 'prev' ? -1 : 1);
    else if (a === 'reply') openReply(true);
    else if (a === 'cancel') openReply(false);
  }
  function onKey(e) {
    if (e.target.matches('textarea')) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.target.form.requestSubmit ? e.target.form.requestSubmit() : onSubmit({ target: e.target.form, preventDefault() {} }); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); openReply(false); }
      return;
    }
    if (e.key === 'Escape') { const n = S.items.find((x) => x.id === S.cur); if (n && n.level !== 'critical') { e.stopPropagation(); markClosed(n.id); report(n.id, 'close'); drop(n.id); } }
    else if (e.key === 'ArrowLeft' && e.target.closest('.pn-pager')) move(-1);
    else if (e.key === 'ArrowRight' && e.target.closest('.pn-pager')) move(1);
  }
  function onSubmit(e) {
    const f = e.target.closest ? e.target.closest('.pn-reply') : null; if (!f) return;
    e.preventDefault();
    const id = S.cur, ta = f.querySelector('textarea'), btn = f.querySelector('[type=submit]'), err = f.querySelector('.pn-err'), text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    btn.disabled = true; err.hidden = true;
    post(id, 'reply', { text }).then((r) => r.json().catch(() => ({})).then((j) => {
      if (!r.ok && r.status !== 409) throw new Error(j.error || L().err);
      markClosed(id);
      f.outerHTML = `<div class="pn-thanks" role="status">${ICO.check}<span>${L().thanks}</span></div>`;
      S.replying = false; setTimeout(() => drop(id), 1700);
    })).catch((er) => { btn.disabled = false; err.textContent = er && er.message && er.message !== 'Failed to fetch' ? er.message : L().err; err.hidden = false; });
  }

  function start() {
    load(true);
    setInterval(() => { if (!document.hidden && Date.now() - S.last >= S.poll) load(); }, 5000);
    document.addEventListener('visibilitychange', () => { if (document.hidden) return; load(); markSeen(S.items.find((n) => n.id === S.cur)); });
    addEventListener('focus', () => load());
    addEventListener('online', () => load(true));
    // закрыли в другой вкладке — убираем и здесь
    addEventListener('storage', (e) => {
      if (e.key !== LS_CLOSED || S.replying) return;
      const c = closedMap(), list = S.items.filter((n) => !c[n.id]);
      if (list.length === S.items.length) return;
      if (S.cur && c[S.cur]) { S.items = list.concat(S.items.filter((n) => n.id === S.cur)); drop(S.cur); }
      else { S.items = list; render(); }
    });
  }
  const boot = () => setTimeout(start, 800); // после первой отрисовки страницы
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
