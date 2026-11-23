/* Premier — установка как приложение (PWA) и push-уведомления (js/16-pwa.js). Один файл для RU и EN: язык берётся из <html lang>. */
'use strict';
(() => {
  const EN = /^en/i.test(document.documentElement.lang || '');
  const T = EN ? {
    title: 'Notifications', off: 'Turned off by the administrator', unsupported: 'This browser does not support notifications',
    ios: 'On iPhone and iPad, add Premier to your Home Screen first (Share → Add to Home Screen), then open it from there',
    denied: 'Notifications are blocked in your browser settings for this site', onInfo: (n) => `On — payments, plan reminders and news. Devices: ${n}`,
    offInfo: 'Payment confirmations and a reminder a day before your plan ends', enable: 'Turn on', disable: 'Turn off', test: 'Test',
    sent: 'Sent — check your notifications', nothing: 'Could not deliver to this device', failed: 'Something went wrong',
    install: 'Install Premier', installTxt: 'Opens in one tap like a regular app and can notify you about payments.', installBtn: 'Install',
    iosTxt: 'Tap Share, then “Add to Home Screen” — Premier will open like an app.', close: 'Close',
  } : {
    title: 'Уведомления', off: 'Выключены администратором', unsupported: 'Этот браузер не поддерживает уведомления',
    ios: 'На iPhone и iPad сначала добавьте Premier на экран «Домой» («Поделиться» → «На экран Домой») и откройте его оттуда',
    denied: 'Уведомления запрещены в настройках браузера для этого сайта', onInfo: (n) => `Включены — оплаты, напоминания о тарифе и новости. Устройств: ${n}`,
    offInfo: 'Подтверждение оплаты и напоминание за сутки до конца тарифа', enable: 'Включить', disable: 'Выключить', test: 'Проверить',
    sent: 'Отправлено — проверьте уведомления', nothing: 'Не удалось доставить на это устройство', failed: 'Что-то пошло не так',
    install: 'Установите Premier', installTxt: 'Открывается в одно нажатие, как обычное приложение, и может присылать уведомления об оплате.', installBtn: 'Установить',
    iosTxt: 'Нажмите «Поделиться», затем «На экран Домой» — Premier будет открываться как приложение.', close: 'Закрыть',
  };
  const HIDE = 'premier-pwa-hide';
  const ua = navigator.userAgent || '';
  const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const swOk = 'serviceWorker' in navigator && window.isSecureContext;
  const supported = swOk && 'PushManager' in window && 'Notification' in window;
  const say = (t) => { if (typeof window.toast === 'function') window.toast(t); };
  const $id = (id) => document.getElementById(id);

  if (swOk) navigator.serviceWorker.register('/sw.js').catch(() => {});

  async function call(name, body) {
    const r = await fetch('/api/push/' + name, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || T.failed), { status: r.status });
    return j;
  }
  const keyBytes = (b) => { const s = atob(String(b).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(b).length % 4)) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
  const sameKey = (sub, key) => {
    const k = sub && sub.options && sub.options.applicationServerKey; if (!k) return true;
    const a = new Uint8Array(k); if (a.length !== key.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== key[i]) return false;
    return true;
  };
  const registration = async () => (await navigator.serviceWorker.getRegistration('/')) || navigator.serviceWorker.ready;

  async function isOn() {
    if (!supported || Notification.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.getRegistration('/');
    return !!(reg && (await reg.pushManager.getSubscription()));
  }
  async function enable() {
    if (!supported) throw new Error(ios && !standalone() ? T.ios : T.unsupported);
    const st = await call('state');
    if (!st.on || !st.key) throw new Error(T.off);
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error(T.denied);
    const reg = await registration(), key = keyBytes(st.key);
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub, key)) { await sub.unsubscribe().catch(() => {}); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    return call('subscribe', { subscription: sub.toJSON(), lang: EN ? 'en' : 'ru' });
  }
  async function disable() {
    const reg = supported && (await navigator.serviceWorker.getRegistration('/'));
    const sub = reg && (await reg.pushManager.getSubscription());
    if (!sub) return { ok: true, devices: 0 };
    const r = await call('unsubscribe', { endpoint: sub.endpoint }).catch(() => ({ ok: true }));
    await sub.unsubscribe().catch(() => {});
    return r;
  }
  const test = () => call('test', {});

  // строка «Уведомления» в Аккаунт → Профиль (js/10-account.js)
  const row = () => `<div class="acc-row push-row" id="pushRow"><div><b>${T.title}</b><small id="pushInfo">${T.offInfo}</small></div><div class="push-btns"><button class="btn" id="pushTest" hidden>${T.test}</button><button class="btn" id="pushBtn" disabled>${T.enable}</button></div></div>`;
  async function bind() {
    const info = $id('pushInfo'), btn = $id('pushBtn'), tst = $id('pushTest');
    if (!info || !btn) return;
    const show = (text, on, canClick = true) => { info.textContent = text; btn.textContent = on ? T.disable : T.enable; btn.dataset.on = on ? '1' : ''; btn.disabled = !canClick; btn.hidden = false; tst.hidden = !on; };
    if (!supported) { info.textContent = ios && !standalone() ? T.ios : T.unsupported; btn.hidden = true; return; }
    let st;
    try { st = await call('state'); } catch { info.textContent = T.failed; return; }
    if (!st.on) { info.textContent = T.off; btn.hidden = true; return; }
    if (Notification.permission === 'denied') { show(T.denied, false, false); return; }
    const on = await isOn().catch(() => false);
    show(on ? T.onInfo(st.devices || 1) : T.offInfo, on);
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        if (btn.dataset.on) { await disable(); show(T.offInfo, false); }
        else { const r = await enable(); show(T.onInfo(r.devices || 1), true); }
      } catch (e) { btn.disabled = false; info.textContent = e.message; say(e.message); }
    };
    tst.onclick = async () => {
      tst.disabled = true;
      try { const r = await test(); say(r.sent ? T.sent : T.nothing); } catch (e) { say(e.message); }
      setTimeout(() => { tst.disabled = false; }, 3000);
    };
  }

  // карточка «Установите Premier»: один раз, можно закрыть навсегда
  let deferred = null, card = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
  addEventListener('appinstalled', () => { try { localStorage.setItem(HIDE, '1'); } catch {} hideCard(); });
  function hideCard() { if (card) { card.remove(); card = null; } }
  function showCard() {
    let hidden = false; try { hidden = !!localStorage.getItem(HIDE); } catch {}
    if (card || hidden || standalone()) return;
    const iosSafari = ios && !deferred && /safari/i.test(ua) && !/crios|fxios|edgios|yabrowser/i.test(ua);
    if (!deferred && !iosSafari) return;
    card = document.createElement('div');
    card.className = 'pwa-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', T.install);
    card.innerHTML = `<img src="/icons/icon-192.png" alt="" width="40" height="40"><div class="pwa-txt"><b>${T.install}</b><span>${deferred ? T.installTxt : T.iosTxt}</span></div><div class="pwa-act">${deferred ? `<button class="btn pwa-go">${T.installBtn}</button>` : ''}<button class="pwa-x" aria-label="${T.close}" title="${T.close}">×</button></div>`;
    card.querySelector('.pwa-x').onclick = () => { try { localStorage.setItem(HIDE, '1'); } catch {} hideCard(); };
    const go = card.querySelector('.pwa-go');
    if (go) go.onclick = async () => { const e = deferred; deferred = null; hideCard(); if (!e) return; e.prompt(); const c = await e.userChoice.catch(() => null); if (c && c.outcome === 'accepted') try { localStorage.setItem(HIDE, '1'); } catch {} };
    document.body.appendChild(card);
  }
  const delay = window.PREMIER_PWA_DELAY ?? 25000;
  setTimeout(showCard, Math.max(0, +delay || 0));

  window.premierPush = { supported, isOn, enable, disable, test, row, bind, showCard };
})();
