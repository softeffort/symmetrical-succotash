// Двухфакторная защита (общий для RU и EN): строка в «Аккаунт → Безопасность» — включить по QR-коду,
// резервные коды (скопировать / скачать), новые коды, выключить. Второй шаг входа — на /login?step=2fa (login.html).
(function () {
  'use strict';
  const EN = /^en/i.test(document.documentElement.lang || '');
  const $id = (i) => document.getElementById(i);
  const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const say = (m) => { if (typeof toast === 'function') toast(m); };
  const date = (t) => new Date(t).toLocaleDateString(EN ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const codesRu = (n) => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'резервный код' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'резервных кода' : 'резервных кодов');
  const T = EN ? {
    title: 'Two-factor authentication', loading: 'Loading…', failed: 'Could not load the status',
    offInfo: 'Off. Turn it on to ask for a code from an authenticator app every time you sign in with Google or GitHub',
    onInfo: (since, n) => `On since ${date(since)} · ${n} backup ${n === 1 ? 'code' : 'codes'} left`,
    enable: 'Turn on', disable: 'Turn off', newCodes: 'New backup codes', cancel: 'Cancel', code: 'Code', phAny: '123456 or abcd-efgh',
    step1: '<b>1.</b> Scan the QR code with an authenticator app — Google Authenticator, Microsoft Authenticator, 1Password or any other',
    manual: 'Can’t scan it? Enter this key manually:', copyKey: 'Copy key', openApp: 'Open in an app on this device',
    step2: '<b>2.</b> Enter the 6-digit code from the app', confirm: 'Turn on 2FA',
    codesTitle: 'Save your backup codes',
    codesText: 'If your phone is not at hand, sign in with one of these codes. Each code works once. We won’t show them again.',
    copy: 'Copy', download: 'Download .txt', done: 'Codes saved', copied: 'Copied', copyFail: 'Could not copy — select the text manually',
    loggedOut: 'You were signed out on other devices — sign in there again with a code.',
    disableAsk: 'To turn protection off, enter a code from the app or a backup code', disableBtn: 'Turn off 2FA',
    regenAsk: 'Enter a code from the app or a backup code. Your old backup codes will stop working', regenBtn: 'Get new codes',
    enabledToast: 'Two-factor authentication is on', disabledToast: 'Two-factor authentication is off',
    fileTitle: 'Premier — backup codes for two-factor authentication', fileAcc: 'Account: ', fileDate: 'Created: ',
    fileNote: 'Each code works once. Keep them somewhere safe.',
  } : {
    title: 'Двухфакторная защита', loading: 'Загрузка…', failed: 'Не удалось загрузить состояние',
    offInfo: 'Выключена. Включите — и при каждом входе через Google или GitHub понадобится ещё код из приложения на телефоне',
    onInfo: (since, n) => `Включена с ${date(since)} · осталось ${codesRu(n)}`,
    enable: 'Включить', disable: 'Выключить', newCodes: 'Новые резервные коды', cancel: 'Отмена', code: 'Код', phAny: '123456 или abcd-efgh',
    step1: '<b>1.</b> Отсканируйте QR-код в приложении-аутентификаторе — Яндекс Ключ, Google Authenticator, 1Password или любом другом',
    manual: 'Не получается отсканировать? Введите ключ вручную:', copyKey: 'Скопировать ключ', openApp: 'Открыть в приложении на этом устройстве',
    step2: '<b>2.</b> Введите 6-значный код из приложения', confirm: 'Включить 2FA',
    codesTitle: 'Сохраните резервные коды',
    codesText: 'Если телефона не будет под рукой, войдите с одним из этих кодов. Каждый код подходит один раз. Больше мы их не покажем.',
    copy: 'Скопировать', download: 'Скачать .txt', done: 'Коды сохранены', copied: 'Скопировано', copyFail: 'Не удалось скопировать — выделите текст вручную',
    loggedOut: 'Вход на других устройствах завершён — войдите там заново с кодом.',
    disableAsk: 'Чтобы выключить защиту, введите код из приложения или резервный код', disableBtn: 'Выключить 2FA',
    regenAsk: 'Введите код из приложения или резервный код. Старые резервные коды перестанут работать', regenBtn: 'Получить новые коды',
    enabledToast: 'Двухфакторная защита включена', disabledToast: 'Двухфакторная защита выключена',
    fileTitle: 'Premier — резервные коды двухфакторной защиты', fileAcc: 'Аккаунт: ', fileDate: 'Созданы: ',
    fileNote: 'Каждый код подходит один раз. Храните их в надёжном месте.',
  };
  // сервер отвечает по-русски — для EN переводим известные ответы
  const ERR = {
    'Неверный код': 'Wrong code',
    'Код не подошёл — проверьте время на телефоне и введите новый код': 'The code didn’t work — check the time on your phone and enter a new code',
    'Двухфакторная защита уже включена': 'Two-factor authentication is already on',
    'Двухфакторная защита не включена': 'Two-factor authentication is off',
    'Сначала начните подключение заново': 'Please start the setup again',
    'Слишком много попыток. Подождите 10 минут.': 'Too many attempts. Please wait 10 minutes.',
  };
  async function call(path, body) {
    const r = await fetch('/api/account/2fa' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    if (r.status === 401 && typeof toLogin === 'function') toLogin();
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const m = j.error || (EN ? 'Error ' : 'Ошибка ') + r.status; throw new Error(EN ? ERR[m] || m : m); }
    return j;
  }

  // QR-код: та же библиотека, что в Панели (/vendor/qrcode.js), грузится только при подключении
  let qrP = null;
  const loadQr = () => (typeof window.qrcode === 'function' ? Promise.resolve() : (qrP = qrP || new Promise((ok, no) => {
    const s = document.createElement('script'); s.src = '/vendor/qrcode.js?v=1'; s.onload = ok; s.onerror = () => { qrP = null; no(new Error('qr')); }; document.head.appendChild(s);
  })));
  function qrSVG(text) {
    if (typeof window.qrcode !== 'function') return '';
    const q = window.qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount(); let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
    return `<svg viewBox="0 0 ${n + 4} ${n + 4}" shape-rendering="crispEdges" role="img" aria-label="QR"><path d="${d}" fill="#000"/></svg>`;
  }
  async function copy(text) { try { await navigator.clipboard.writeText(text); say(T.copied); } catch { say(T.copyFail); } }
  function download(codes) {
    const who = typeof ME !== 'undefined' && ME ? ME.email || ME.login || '' : '';
    const lines = [T.fileTitle]; if (who) lines.push(T.fileAcc + who);
    lines.push(T.fileDate + new Date().toLocaleString(EN ? 'en-GB' : 'ru-RU'), '', ...codes, '', T.fileNote);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/plain;charset=utf-8' }));
    a.download = 'premier-backup-codes.txt'; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // строка в Аккаунт → Безопасность (js/10-account.js) и панель под ней для шагов
  const row = () => `<div class="acc-row tfa-row" id="tfaRow"><div><b>${T.title}</b><small id="tfaInfo">${T.loading}</small></div><div class="tfa-btns"><button class="btn" id="tfaNew" hidden>${T.newCodes}</button><button class="btn" id="tfaBtn" hidden>${T.enable}</button></div></div><div class="tfa-box" id="tfaBox" hidden></div>`;
  let st = null;
  function paint() {
    const info = $id('tfaInfo'), btn = $id('tfaBtn'), nw = $id('tfaNew'); if (!info || !st) return;
    info.textContent = st.on ? T.onInfo(st.since, st.codesLeft) : T.offInfo;
    btn.textContent = st.on ? T.disable : T.enable; btn.hidden = false; btn.disabled = false; nw.hidden = !st.on;
  }
  function box(html) { const b = $id('tfaBox'); if (!b) return null; b.innerHTML = html; b.hidden = !html; return b; }
  const close = () => box('');
  const form = (ask, btnText, o = {}) => `<p>${ask}</p><form class="tfa-form" id="tfaF" autocomplete="off" novalidate>`
    + `<input id="tfaCode" name="code" ${o.any ? 'inputmode="text" maxlength="20"' : 'inputmode="numeric" maxlength="7"'} autocomplete="one-time-code" spellcheck="false" placeholder="${o.any ? T.phAny : '123456'}" aria-label="${T.code}">`
    + `<button class="btn ${o.danger ? 'dangerb solid' : 'pri'}" id="tfaGo">${btnText}</button><button type="button" class="btn" id="tfaCancel">${T.cancel}</button></form><p class="tfa-err" id="tfaErr" role="alert"></p>`;
  function wire(onCode) {
    const f = $id('tfaF'), inp = $id('tfaCode'), go = $id('tfaGo'), er = $id('tfaErr');
    $id('tfaCancel').onclick = close; inp.focus();
    inp.oninput = () => { er.textContent = ''; };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const code = inp.value.trim(); if (!code) { inp.focus(); return; }
      go.disabled = true; er.textContent = '';
      try { await onCode(code); } catch (err) { if ($id('tfaErr')) { er.textContent = err.message; go.disabled = false; inp.select(); } }
    };
  }
  function showCodes(codes, loggedOut) {
    box(`<p><b>${T.codesTitle}</b><br>${T.codesText}</p><div class="tfa-codes" id="tfaCodes">${codes.map((c) => `<span>${h(c)}</span>`).join('')}</div>`
      + (loggedOut ? `<p>${T.loggedOut}</p>` : '')
      + `<div class="tfa-form"><button type="button" class="btn" id="tfaCopy">${T.copy}</button><button type="button" class="btn" id="tfaDl">${T.download}</button><button type="button" class="btn pri" id="tfaDone">${T.done}</button></div>`);
    $id('tfaCopy').onclick = () => copy(codes.join('\n'));
    $id('tfaDl').onclick = () => download(codes);
    $id('tfaDone').onclick = close;
  }
  async function startSetup() {
    const btn = $id('tfaBtn'); btn.disabled = true;
    let s; try { s = await call('/setup', {}); } catch (e) { btn.disabled = false; say(e.message); return; }
    await loadQr().catch(() => {});
    btn.disabled = false;
    const key = s.secret.replace(/(.{4})/g, '$1 ').trim();
    box(`<p>${T.step1}</p><div class="tfa-setup"><div class="tfa-qr" id="tfaQr">${qrSVG(s.uri)}</div><div class="tfa-side"><p>${T.manual}</p>`
      + `<div class="tfa-key"><code id="tfaKey">${h(key)}</code><button type="button" class="tm-link" id="tfaCopyKey">${T.copyKey}</button></div>`
      + `<p><a class="tm-link" href="${h(s.uri)}">${T.openApp}</a></p></div></div>` + form(T.step2, T.confirm));
    if (!$id('tfaQr').innerHTML) $id('tfaQr').hidden = true;
    $id('tfaCopyKey').onclick = () => copy(s.secret);
    wire(async (code) => { const r = await call('/enable', { code }); st = r; paint(); showCodes(r.codes, r.loggedOut); say(T.enabledToast); });
  }
  function askDisable() { box(form(T.disableAsk, T.disableBtn, { any: true, danger: true })); wire(async (code) => { st = await call('/disable', { code }); paint(); close(); say(T.disabledToast); }); }
  function askRegen() { box(form(T.regenAsk, T.regenBtn, { any: true })); wire(async (code) => { const r = await call('/codes', { code }); st = r; paint(); showCodes(r.codes, 0); }); }
  async function bind() {
    const info = $id('tfaInfo'); if (!info) return;
    try { st = await call(''); } catch { if ($id('tfaInfo')) $id('tfaInfo').textContent = T.failed; return; }
    paint();
    if (!$id('tfaBtn')) return;
    $id('tfaBtn').onclick = () => (st.on ? askDisable() : startSetup());
    $id('tfaNew').onclick = askRegen;
  }
  window.premierTfa = { row, bind };
})();
