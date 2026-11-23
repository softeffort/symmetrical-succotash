// Раздел «Уведомления» и окно отправки: личные сообщения пользователям — карточка в левом нижнем углу сайта (public/notices.js).
// Окно отправки открывается отсюда, из «Пользователей» (вкладка-сегмент, выделение, меню строки) и из карточки пользователя.
'use strict';
(() => {
  const LV = [
    ['info', 'Обычное', 'Спокойная синяя карточка: новости, благодарности, подсказки.'],
    ['warn', 'Важное', 'Жёлтая: нужно что-то сделать в ближайшее время.'],
    ['urgent', 'Срочное', 'Оранжевая с пульсирующим значком — срочная просьба.'],
    ['critical', 'Критичное', 'Красная, без крестика: закрыть можно только кнопкой «Понятно». Для безопасности и блокировок.'],
  ];
  const LVN = Object.fromEntries(LV.map(([k, t]) => [k, t]));
  const LVB = { info: 'info', warn: 'warn', urgent: 'acc', critical: 'bad' };
  const lvBadge = (l) => `<span class="badge ${LVB[l] || ''}">${esc(LVN[l] || l)}</span>`;
  const ST = { active: ['Показывается', 'ok'], scheduled: ['Запланировано', 'info'], done: ['Все закрыли', 'out'], expired: ['Срок показа истёк', 'out'], revoked: ['Отозвано', 'bad'] };
  const stBadge = (s) => `<span class="badge ${(ST[s] || ['', ''])[1]}">${esc((ST[s] || [s])[0])}</span>`;
  const DUR = [['', 'Пока не закроют'], ['1', '1 день'], ['3', '3 дня'], ['7', '7 дней'], ['14', '14 дней'], ['30', '30 дней']];
  const VARS = [['name', 'имя'], ['login', 'логин'], ['plan', 'тариф'], ['until', 'действует до'], ['days', 'дней осталось']];
  const SEG = [['', 'Все пользователи'], ['paid', 'Платные'], ['trial', 'Пробный'], ['free', 'Free'], ['expiring', 'Заканчивается'], ['expired', 'Истекла'], ['new7', 'Новые за 7 дней'],
    ['active7', 'Активны 7 дней'], ['inactive30', 'Неактивны 30+ дней'], ['payers', 'Платили'], ['api', 'С API-ключами'], ['ext', 'Повышен лимит'], ['noted', 'С заметками']];
  const RESEND = { all: 'всем получателям', unseen: 'тем, кто не открыл', noclick: 'тем, кто не нажал кнопку', noreply: 'тем, кто не ответил', open: 'тем, кто не закрыл' };
  const TPL = [
    { id: 'renew', t: 'Подписка заканчивается', level: 'warn', title: 'Подписка заканчивается через {days} дн.', text: '{name}, ваш тариф {plan} действует до {until}. Продлите заранее — история чатов и настройки сохранятся.', link: '/chat?pay=1', linkText: 'Продлить', titleEn: 'Your subscription ends in {days} days', textEn: '{name}, your {plan} plan is active until {until}. Renew in advance to keep everything as it is.', linkTextEn: 'Renew' },
    { id: 'feedback', t: 'Попросить отзыв', level: 'info', title: 'Как вам Premier?', text: '{name}, нам важно ваше мнение. Что работает хорошо, а что стоит улучшить? Ответьте прямо здесь — мы читаем каждое сообщение.', reply: true, titleEn: 'How do you like Premier?', textEn: '{name}, your opinion matters. What works well and what should we improve? Reply right here — we read every message.' },
    { id: 'security', t: 'Подозрительная активность', level: 'critical', title: 'Проверьте безопасность аккаунта', text: 'Мы заметили необычную активность в вашем аккаунте. Если это были не вы — **смените пароль почты** и напишите нам ответом на это сообщение.', reply: true, titleEn: 'Check your account security', textEn: 'We noticed unusual activity in your account. If it was not you, **change your email password** and reply to this message.' },
    { id: 'rules', t: 'Нарушение правил', level: 'urgent', title: 'Срочная просьба', text: 'Часть ваших запросов нарушает правила использования. Пожалуйста, ознакомьтесь с ними, иначе доступ придётся ограничить.', link: '/terms', linkText: 'Правила', reply: true, titleEn: 'Urgent request', textEn: 'Some of your requests violate the terms of use. Please review them, otherwise access will have to be restricted.', linkTextEn: 'Terms' },
    { id: 'gift', t: 'Подарок', level: 'info', title: 'Подарок от Premier 🎁', text: '{name}, спасибо, что вы с нами! Мы добавили вам бонус — загляните в кабинет.', link: '/chat', linkText: 'Открыть', titleEn: 'A gift from Premier 🎁', textEn: '{name}, thank you for being with us! We have added a bonus to your account.', linkTextEn: 'Open' },
    { id: 'maint', t: 'Плановые работы', level: 'warn', title: 'Плановые работы', text: 'Сегодня с 02:00 до 03:00 по Москве возможны перерывы в работе. Сохраните важные ответы заранее.', titleEn: 'Scheduled maintenance', textEn: 'Today from 02:00 to 03:00 Moscow time the service may be briefly unavailable.' },
  ];
  const FIELDS = ['level', 'title', 'text', 'link', 'linkText', 'reply', 'titleEn', 'textEn', 'linkTextEn'];
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const local = (t) => (t ? new Date(t - new Date(t).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
  const people = (n) => pn(n, 'получатель', 'получателя', 'получателей');
  const dat = (n) => pn(n, 'получателю', 'получателям', 'получателям');
  const fill = (s, v) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  const sampleVars = (u) => {
    const until = u && u.until;
    return { name: u ? u.name || u.login : 'Анна', login: u ? u.login : 'anna', email: (u && u.email) || 'anna@example.com', plan: (u && u.plan) || 'Pro',
      until: until ? new Date(until).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : '—', days: until ? String(Math.max(0, Math.ceil((until - Date.now()) / 864e5))) : '0' };
  };
  const cardEl = (n, o) => (window.PremierNotices ? window.PremierNotices.card(n, { preview: true, ...o }) : Object.assign(document.createElement('div'), { className: 'note', textContent: n.text }));
  const myTpl = () => pref.get('noticeTpl', []);

  /* ---------- окно отправки ---------- */
  // o.to — получатели ({ids} | {filter} | {from, who}); без него в окне есть выбор сегмента или списка
  // o.prefill — поля уведомления (копия, повтор); o.onSent(r) — после отправки
  async function compose(o = {}) {
    if (!can('notices.send')) { toast('Нет права отправлять уведомления', 'err'); return null; }
    const pick = !o.to;
    const draft = !o.prefill ? pref.get('noticeDraft', null) : null; // недописанный текст не теряется, если окно случайно закрыли
    const v0 = { level: pref.get('noticeLevel', 'info'), title: '', text: '', link: '', linkText: '', reply: false, titleEn: '', textEn: '', linkTextEn: '', ...(draft || {}), ...(o.prefill || {}) };
    let to = o.to || { filter: {} }, aud = null, theme = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), lang = 'ru', armed = false, when = 'now';
    const body = `<div class="nc">
      <div class="nc-aud${pick ? ' pick' : ''}" id="ncAud">
        ${pick ? `<div class="nc-pick"><div class="seg" id="ncMode"><button type="button" data-m="seg" class="on">Сегмент</button><button type="button" data-m="list">Список</button></div>
          <span data-mode="seg" class="row" style="gap:8px;flex-wrap:wrap"><select class="inp sm" id="ncSt" style="width:auto">${SEG.map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select><select class="inp sm" id="ncPlan" style="width:auto"><option value="">Все тарифы</option>${S.plans.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></span>
          <textarea class="inp" data-mode="list" id="ncList" rows="2" placeholder="Логины, почты или ID — через запятую или с новой строки" hidden></textarea></div>` : ''}
        <div class="nc-sum" id="ncSum"><span class="nc-ico">${I('users')}</span><div class="grow"><b>Считаем получателей…</b><small>&nbsp;</small></div></div>
      </div>
      <div class="nc-grid">
        <div class="nc-form">
          <div class="field"><span>Срочность</span><div class="seg nc-lv" id="ncLv">${LV.map(([k, t]) => `<button type="button" data-l="${k}" class="${v0.level === k ? 'on' : ''}"><i class="nc-dot ${k}"></i>${t}</button>`).join('')}</div><small id="ncLvHint"></small></div>
          <div class="note info nc-draft" id="ncDraft" hidden>${I('edit')} Восстановлен недописанный черновик <button type="button" class="btn sm ghost">Очистить</button></div>
          <div class="nc-tplrow"><select class="inp sm" id="ncTpl" style="width:auto"></select><button type="button" class="btn sm ghost" id="ncTplSave">${I('plus')}Сохранить как шаблон</button><button type="button" class="btn sm ghost" id="ncTplDel" hidden>${I('trash')}Удалить шаблон</button>
            <span class="nc-tplname" id="ncTplName" hidden><input class="inp sm" maxlength="40" placeholder="Название шаблона"><button type="button" class="btn sm pri" data-save>Сохранить</button></span></div>
          <label class="field"><span>Заголовок <span class="dim">(необязательно)</span></span><input name="title" maxlength="90" value="${esc(v0.title)}" placeholder="Например: Срочная просьба"></label>
          <label class="field"><span>Текст</span><textarea name="text" rows="5" maxlength="1000" autofocus placeholder="Что нужно сделать и почему это важно. **Жирный**, ссылки https://… и переносы строк работают.">${esc(v0.text)}</textarea>
            <div class="nc-vars">${VARS.map(([k, t]) => `<button type="button" class="nc-var" data-var="{${k}}" title="Подставится ${t} каждого получателя">{${k}}</button>`).join('')}<span class="nc-cnt" id="ncCnt"></span></div></label>
          <div class="grid g2" style="gap:0 12px"><label class="field"><span>Кнопка <span class="dim">(необязательно)</span></span><input name="linkText" maxlength="40" value="${esc(v0.linkText)}" placeholder="Продлить"></label><label class="field"><span>Ссылка кнопки</span><input name="link" value="${esc(v0.link)}" placeholder="/chat?pay=1 или https://…"></label></div>
          <label class="check"><input type="checkbox" name="reply"${v0.reply ? ' checked' : ''}>Можно ответить прямо в карточке <span class="dim">— ответы появятся в разделе «Уведомления»</span></label>
          <details class="nc-en"${v0.textEn ? ' open' : ''}><summary>Английская версия <span class="dim">— для тех, у кого сайт на английском</span></summary>
            <label class="field"><span>Title</span><input name="titleEn" maxlength="90" value="${esc(v0.titleEn)}"></label>
            <label class="field"><span>Text</span><textarea name="textEn" rows="3" maxlength="1000" placeholder="Если пусто — покажем русский текст">${esc(v0.textEn)}</textarea></label>
            <label class="field"><span>Button</span><input name="linkTextEn" maxlength="40" value="${esc(v0.linkTextEn)}" placeholder="Open"></label></details>
          <div class="grid g2" style="gap:0 12px">
            <div class="field"><span>Когда показать</span><div class="seg" id="ncWhen"><button type="button" data-w="now" class="on">Сразу</button><button type="button" data-w="later">По расписанию</button></div><input type="datetime-local" class="inp" name="starts" hidden style="margin-top:8px"></div>
            <label class="field"><span>Сколько показывать</span><select name="days">${DUR.map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select><small>Потом карточка исчезнет сама, даже если её не закрыли</small></label>
          </div>
          <div class="note warn nc-armed" id="ncArmed" hidden></div>
        </div>
        <div class="nc-side">
          <div class="nc-ph"><b class="grow">Предпросмотр</b><div class="seg sm" id="ncLang" hidden><button type="button" data-g="ru" class="on">RU</button><button type="button" data-g="en">EN</button></div><div class="seg sm" id="ncTheme"><button type="button" data-t="light" title="Светлая тема">${I('sun')}</button><button type="button" data-t="dark" title="Тёмная тема">${I('moon')}</button></div></div>
          <div class="nc-stage pn-scope" id="ncStage"><div class="nc-page" aria-hidden="true"><div class="nc-mside"><i></i><i></i><i></i><i></i></div><div class="nc-mmain"><i style="width:58%"></i><i style="width:80%;margin-left:auto"></i><i style="width:66%"></i><div class="nc-minput"></div></div></div><div class="nc-slot" id="ncSlot"></div></div>
          <div class="nc-tip" id="ncTip"></div>
        </div>
      </div></div>`;
    return modal({
      title: o.title || 'Уведомление пользователям', wide: true, ok: 'Отправить', body,
      onOpen: (f) => {
        f.classList.add('nc-modal');
        const E = f.elements, okBtn = f.querySelector('[data-ok]');
        let level = v0.level;
        if (v0.days) E.days.value = String(v0.days);
        const collect = () => ({ level, title: E.title.value.trim(), text: E.text.value.trim(), link: E.link.value.trim(), linkText: E.linkText.value.trim(), reply: E.reply.checked,
          titleEn: E.titleEn.value.trim(), textEn: E.textEn.value.trim(), linkTextEn: E.linkTextEn.value.trim(), days: E.days.value ? +E.days.value : null,
          starts: when === 'later' && E.starts.value ? new Date(E.starts.value).getTime() : null });
        f._collect = collect; f._aud = () => aud; f._to = () => to;
        const disarm = () => { if (!armed) return; armed = false; $('ncArmed').hidden = true; okBtn.classList.remove('danger', 'solid'); okBtn.classList.add('pri'); label(); };
        const label = () => { okBtn.textContent = !aud ? 'Отправить' : (when === 'later' ? 'Запланировать для ' : 'Отправить ') + dat(aud.n); okBtn.disabled = !aud || !aud.n; };
        const paint = () => {
          const v = collect(), en = lang === 'en' && !!v.textEn, sv = sampleVars(aud && aud.sample && aud.sample[0]);
          $('ncLvHint').textContent = (LV.find((x) => x[0] === level) || LV[0])[2];
          const len = E.text.value.length; $('ncCnt').textContent = len + ' / 1000'; $('ncCnt').classList.toggle('over', len > 950);
          $('ncLang').hidden = !v.textEn; if (!v.textEn && lang === 'en') { lang = 'ru'; qsa('#ncLang button').forEach((b) => b.classList.toggle('on', b.dataset.g === 'ru')); }
          const stage = $('ncStage'); stage.classList.toggle('pn-theme-dark', theme === 'dark'); stage.classList.toggle('pn-theme-light', theme !== 'dark');
          qsa('#ncTheme button').forEach((b) => b.classList.toggle('on', b.dataset.t === theme));
          const n = { id: 'preview', level, at: Date.now() - 2000, title: fill(en ? v.titleEn : v.title, sv), text: fill(en ? v.textEn : v.text, sv) || (en ? 'Your message will appear here' : 'Здесь появится текст уведомления'),
            link: v.link, linkText: en ? v.linkTextEn || v.linkText : v.linkText, reply: v.reply };
          const slot = $('ncSlot'); slot.innerHTML = ''; slot.append(cardEl(n, { lang: en ? 'en' : 'ru' }));
          const s0 = aud && aud.sample && aud.sample[0];
          $('ncTip').innerHTML = s0 ? `Так увидит <b>${esc(s0.login)}</b>${/\{\w+\}/.test(v.text + v.title) ? ' — подстановки заполнены его данными' : ''}` : 'Подстановки {name}, {plan} и другие заполнятся данными каждого получателя';
          label();
          if (!o.prefill) pref.set('noticeDraft', v.text || v.title ? { ...v, starts: null, days: null } : null);
        };
        // получатели
        const paintSum = () => {
          const box = $('ncSum');
          if (!aud) return;
          const names = aud.sample.filter((u) => !u.banned).slice(0, 5).map((u) => esc(u.login)).join(', ');
          const warn = [aud.banned ? `пропустим заблокированных: ${num(aud.banned)}` : '', aud.missingN ? `не найдены: ${aud.missing.map(esc).join(', ')}${aud.missingN > aud.missing.length ? '…' : ''}` : ''].filter(Boolean).join(' · ');
          box.innerHTML = `<span class="nc-ico">${I(aud.n === 1 ? 'user' : 'users')}</span><div class="grow"><b>${esc(aud.label || 'Получатели')} · ${people(aud.n)}</b><small>${aud.n ? names + (aud.n > 5 ? ` и ещё ${num(aud.n - Math.min(5, aud.sample.length))}` : '') : 'Никого не нашлось — измените сегмент или список'}${warn ? ` <span class="warn-t">· ${warn}</span>` : ''}</small></div>
            ${aud.busy ? `<span class="badge warn" title="Новое встанет в очередь: карточки листаются, первым показывается самое срочное">у ${num(aud.busy)} уже висит уведомление</span>` : ''}
            ${aud.n > aud.bulk && !aud.canBulk ? `<span class="badge bad" title="Нужно право «Уведомления: массовая рассылка»">больше ${aud.bulk} — нет права</span>` : ''}`;
          label(); paint();
        };
        const resolve = debounce(async () => {
          try { const r = await post('/api/admin/notices/resolve', { to }); aud = r; paintSum(); }
          catch (e) { aud = { n: 0, sample: [], label: '', banned: 0, missing: [], missingN: 0, bulk: 20, canBulk: false }; $('ncSum').innerHTML = `<span class="nc-ico">${I('alert')}</span><div class="grow"><b>${esc(e.message)}</b><small>Выберите других получателей</small></div>`; label(); }
        }, 250);
        if (pick) {
          const segTo = () => { const st = $('ncSt').value, plan = $('ncPlan').value; to = { filter: { ...(st ? { status: st } : {}), ...(plan ? { plan } : {}) } }; };
          $('ncMode').onclick = (e) => { const b = e.target.closest('[data-m]'); if (!b) return; qsa('#ncMode button').forEach((x) => x.classList.toggle('on', x === b)); qsa('[data-mode]', f).forEach((x) => (x.hidden = x.dataset.mode !== b.dataset.m)); if (b.dataset.m === 'seg') segTo(); else to = { list: $('ncList').value }; disarm(); resolve(); if (b.dataset.m === 'list') $('ncList').focus(); };
          $('ncSt').onchange = $('ncPlan').onchange = () => { segTo(); disarm(); resolve(); };
          $('ncList').oninput = () => { to = { list: $('ncList').value }; disarm(); resolve(); };
        }
        resolve();
        // шаблоны: встроенные и свои (хранятся в этом браузере)
        const paintTpl = () => {
          const mine = myTpl();
          $('ncTpl').innerHTML = `<option value="">Шаблон…</option><optgroup label="Готовые">${TPL.map((t) => `<option value="b:${t.id}">${esc(t.t)}</option>`).join('')}</optgroup>${mine.length ? `<optgroup label="Мои">${mine.map((t, i) => `<option value="m:${i}">${esc(t.t)}</option>`).join('')}</optgroup>` : ''}`;
          $('ncTplDel').hidden = true;
        };
        paintTpl();
        const apply = (t) => { for (const k of FIELDS) { if (k === 'level') continue; const el = E[k]; if (!el) continue; if (el.type === 'checkbox') el.checked = !!t[k]; else el.value = t[k] || ''; } level = LV.some((x) => x[0] === t.level) ? t.level : 'info'; qsa('#ncLv button').forEach((b) => b.classList.toggle('on', b.dataset.l === level)); f.querySelector('.nc-en').open = !!t.textEn; disarm(); paint(); };
        $('ncTpl').onchange = () => {
          const val = $('ncTpl').value; if (!val) return;
          const t = val.startsWith('b:') ? TPL.find((x) => 'b:' + x.id === val) : myTpl()[+val.slice(2)];
          if (t) apply(t);
          $('ncTplDel').hidden = !val.startsWith('m:');
        };
        $('ncTplSave').onclick = () => { const box = $('ncTplName'); box.hidden = !box.hidden; if (!box.hidden) box.querySelector('input').focus(); };
        $('ncTplName').querySelector('[data-save]').onclick = () => {
          const name = $('ncTplName').querySelector('input').value.trim(), v = collect();
          if (!name) return $('ncTplName').querySelector('input').focus();
          if (!v.text) return toast('Сначала напишите текст', 'err');
          const list = myTpl().filter((t) => t.t !== name); list.unshift({ t: name, ...Object.fromEntries(FIELDS.map((k) => [k, v[k]])) }); pref.set('noticeTpl', list.slice(0, 20));
          $('ncTplName').hidden = true; $('ncTplName').querySelector('input').value = ''; paintTpl(); toast('Шаблон сохранён в этом браузере', 'ok');
        };
        $('ncTplName').querySelector('input').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('ncTplName').querySelector('[data-save]').click(); } };
        $('ncTplDel').onclick = () => { const val = $('ncTpl').value; if (!val.startsWith('m:')) return; const list = myTpl(); list.splice(+val.slice(2), 1); pref.set('noticeTpl', list); paintTpl(); toast('Шаблон удалён', 'ok'); };
        // срочность, время, тема и язык предпросмотра
        $('ncLv').onclick = (e) => { const b = e.target.closest('[data-l]'); if (!b) return; level = b.dataset.l; qsa('#ncLv button').forEach((x) => x.classList.toggle('on', x === b)); disarm(); paint(); };
        $('ncWhen').onclick = (e) => {
          const b = e.target.closest('[data-w]'); if (!b) return; when = b.dataset.w; qsa('#ncWhen button').forEach((x) => x.classList.toggle('on', x === b));
          E.starts.hidden = when !== 'later'; if (when === 'later') { if (!E.starts.value) E.starts.value = local(Date.now() + 3600e3 - (Date.now() % 600e3)); E.starts.focus(); } disarm(); label();
        };
        $('ncTheme').onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) { theme = b.dataset.t; paint(); } };
        $('ncLang').onclick = (e) => { const b = e.target.closest('[data-g]'); if (!b) return; lang = b.dataset.g; qsa('#ncLang button').forEach((x) => x.classList.toggle('on', x === b)); paint(); };
        // подстановки — в место курсора
        let lastField = E.text;
        f.addEventListener('focusin', (e) => { if (e.target === E.title || e.target === E.text) lastField = e.target; });
        f.querySelector('.nc-vars').onmousedown = (e) => { if (e.target.closest('[data-var]')) e.preventDefault(); }; // фокус остаётся в поле
        f.querySelector('.nc-vars').onclick = (e) => {
          const b = e.target.closest('[data-var]'); if (!b) return; e.preventDefault();
          const ta = lastField, a = ta.selectionStart ?? ta.value.length, z = ta.selectionEnd ?? a;
          ta.value = ta.value.slice(0, a) + b.dataset.var + ta.value.slice(z); ta.focus(); ta.selectionStart = ta.selectionEnd = a + b.dataset.var.length; disarm(); paint();
        };
        $('ncSlot').addEventListener('click', (e) => e.preventDefault(), true); // в предпросмотре ссылки и кнопки не работают
        f.addEventListener('input', (e) => { if (e.target.closest('.nc-form')) { disarm(); paint(); } });
        f.addEventListener('change', (e) => { if (e.target === E.days || e.target === E.starts) { disarm(); label(); } });
        // Enter в поле не отправляет; Ctrl+Enter — отправить
        f.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); f.requestSubmit(); }
          else if (e.target.matches('input')) e.preventDefault();
        });
        f._arm = () => { armed = true; okBtn.classList.remove('pri'); okBtn.classList.add('danger', 'solid'); okBtn.textContent = 'Да, отправить ' + dat(aud.n); };
        f._armed = () => armed;
        if (draft && draft.text) { const nd = $('ncDraft'); nd.hidden = false; nd.querySelector('button').onclick = () => { apply({ level: pref.get('noticeLevel', 'info') }); pref.set('noticeDraft', null); nd.hidden = true; E.text.focus(); }; }
        paint();
      },
      onOk: async (f) => {
        const v = f._collect(), aud = f._aud(), to = f._to();
        if (!aud) throw new Error('Подождите — считаем получателей');
        if (!aud.n) throw new Error('Нет получателей');
        if (aud.n > aud.bulk && !aud.canBulk) throw new Error(`Можно отправить не больше чем ${aud.bulk} пользователям за раз: для массовой рассылки нужно право «Уведомления: массовая рассылка»`);
        if (!v.text) { f.elements.text.focus(); throw new Error('Напишите текст уведомления'); }
        if (v.link && !/^(\/(?!\/)|https?:\/\/)/i.test(v.link)) { f.elements.link.focus(); throw new Error('Ссылка: https://… или путь на сайте, например /chat?pay=1'); }
        if (v.starts && v.starts < Date.now() - 60e3) throw new Error('Время показа уже прошло — выберите будущее');
        // большая рассылка или критичное — второе нажатие подтверждает
        if ((aud.n > 20 || v.level === 'critical') && !f._armed()) {
          const box = f.querySelector('#ncArmed');
          box.innerHTML = `${I('alert')} <b>Проверьте ещё раз.</b> ${LVN[v.level]} уведомление увидят ${people(aud.n)} (${esc(aud.label || '')})${v.starts ? ', начиная с ' + esc(dtt(v.starts)) : ''}. Отменить можно будет в разделе «Уведомления» — у тех, кто ещё не закрыл. Нажмите кнопку ещё раз, чтобы отправить.`;
          box.hidden = false; f._arm(); box.scrollIntoView({ block: 'nearest' }); return false;
        }
        const r = await post('/api/admin/notices', { to, ...v, label: to.filter || to.list ? undefined : o.label });
        pref.set('noticeLevel', v.level); pref.set('noticeDraft', null);
        toast(r.scheduled ? `Запланировано на ${dtt(r.starts)} — ${people(r.total)}` : `Отправлено: ${people(r.total)}${r.skipped ? ` · пропущено ${num(r.skipped)}` : ''}`, 'ok', can('notices.view') ? { label: 'Открыть', on: () => go('notices', r.id) } : null);
        refreshBadges();
        if (o.onSent) o.onSent(r);
        return r;
      },
    });
  }
  window.noticeCompose = compose;

  /* ---------- раздел «Уведомления» ---------- */
  let st = {}, data = null, openId = null, rs = { who: 'all', q: '', page: 1 }, prevLang = 'ru';
  const sync = () => setHash('notices', openId || '', { state: st.state, q: st.q, page: st.page > 1 ? st.page : '' });
  R.notices = async (params, id) => {
    st = { state: '', q: '', page: 1, ...params };
    const el = $('view');
    $('vact').innerHTML = can('notices.send') ? `<button class="btn pri" id="nNew">${I('send')}Новое уведомление</button>` : '';
    if ($('nNew')) $('nNew').onclick = () => compose({ onSent: () => load() });
    el.innerHTML = `<div class="grid g4 mb" id="nKpi"></div>
      <div class="toolbar"><div class="filters" id="nChips" style="margin:0"></div><span class="sp"></span><label class="inp-ico">${I('search')}<input class="inp" id="nq" placeholder="Текст, автор или получатели" value="${esc(st.q)}" autocomplete="off"></label></div>
      <div class="card tight" id="nCard"></div>`;
    $('nq').oninput = debounce(() => { st.q = $('nq').value.trim(); st.page = 1; load(); }, 250);
    $('nChips').onclick = (e) => { const b = e.target.closest('[data-st]'); if (!b) return; st.state = b.dataset.st; st.page = 1; load(); };
    await load();
    if (id) openNotice(id);
  };
  async function load() {
    sync();
    const j = await api('/api/admin/notices/list' + qstr({ state: st.state, q: st.q, page: st.page }));
    if (!$('nCard')) return;
    data = j; st.page = j.page;
    const s = j.summary;
    $('nKpi').innerHTML = [
      ['Отправлено за 30 дней', pn(s.sent, 'рассылка', 'рассылки', 'рассылок'), `${people(s.recipients)}${s.scheduled ? ` · запланировано ${num(s.scheduled)}` : ''}`, 'send'],
      ['Открыли', s.recipients ? pct(s.seen, s.recipients) + '%' : '—', `${num(s.seen)} из ${num(s.recipients)}`, 'eye'],
      ['Нажали кнопку', s.withLink ? pct(s.clicked, s.withLink) + '%' : '—', s.withLink ? `${num(s.clicked)} из ${num(s.withLink)} с кнопкой` : 'в рассылках без кнопки не считаем', 'link'],
      ['Ответы', num(s.replied), s.unread ? `<span class="badge acc">${num(s.unread)} новых</span>` : s.replied ? 'все прочитаны' : 'пока нет', 'mail'],
    ].map(([t, b, m, ic]) => `<div class="kpi"><small>${I(ic)}${t}</small><b>${b}</b><div class="meta">${m}</div></div>`).join('');
    const CH = [['', 'Все', 'all'], ['active', 'Показываются'], ['scheduled', 'Запланированы'], ['replies', 'С ответами'], ['done', 'Завершены']];
    $('nChips').innerHTML = CH.map(([k, t, c]) => `<button class="chip${st.state === k ? ' on' : ''}" data-st="${k}">${t} <i>${num(j.counts[c || k] || 0)}</i></button>`).join('');
    const cols = [
      { t: 'Уведомление', render: (x) => `<div class="nt"><div class="nt-h">${lvBadge(x.level)}${x.title ? `<b>${esc(x.title)}</b>` : ''}${x.unread ? ` <span class="badge acc">${pn(x.unread, 'новый ответ', 'новых ответа', 'новых ответов')}</span>` : ''}</div><div class="nt-t">${esc(x.text)}</div></div>` },
      { t: 'Кому', render: (x) => `<div class="nt-aud">${esc(x.audience.label || '—')}</div><div class="dim" style="font-size:12px">${people(x.n)}</div>` },
      { t: 'Охват', render: (x) => `<div class="nr" title="Открыли ${x.seen} · нажали ${x.clicked} · закрыли ${x.closed} · ответили ${x.replied}"><div class="track"><i style="width:${pct(x.seen, x.n)}%"></i></div><small>открыли ${pct(x.seen, x.n)}%${x.link ? ` · нажали ${pct(x.clicked, x.n)}%` : ''}${x.reply ? ` · ${pn(x.replied, 'ответ', 'ответа', 'ответов')}` : ''}</small></div>` },
      { t: 'Отправил', render: (x) => `${esc(x.byName || x.by || '—')}<div class="dim" style="font-size:12px" title="${esc(dtt(x.created))}">${x.state === 'scheduled' ? 'покажем ' + esc(dtt(x.starts)) : ago(x.created)}</div>` },
      { t: 'Статус', render: (x) => stBadge(x.state) + (x.expires && x.state === 'active' ? `<div class="dim" style="font-size:12px">до ${esc(dtt(x.expires))}</div>` : '') },
    ];
    $('nCard').innerHTML = tableHTML({ cols, rows: j.items, empty: j.counts.all ? 'Ничего не нашлось' : 'Уведомлений ещё не было', emptyIcon: 'bell' })
      + (!j.counts.all ? `<div style="padding:0 18px 18px;text-align:center" class="dim">Откройте «Пользователи», выберите вкладку или отметьте людей — и нажмите «Оповестить».</div>` : '')
      + pagerHTML({ ...j, sizes: [j.size] });
    bindTable($('nCard'), { rows: j.items, onRow: (x) => openNotice(x.id) });
    bindPager($('nCard'), (p) => { st.page = p; load(); }, () => {});
  }

  async function openNotice(id, keep) {
    openId = id; if (!keep) rs = { who: 'all', q: '', page: 1 };
    const sc = keep ? $('drawer').scrollTop : 0;
    const d0 = keep ? $('drawer') : drawer({ title: 'Загрузка…', body: skeleton(7), onClose: () => { openId = null; sync(); } });
    sync();
    let r; try { r = await api(`/api/admin/notices/${id}` + qstr({ who: rs.who, q: rs.q, page: rs.page })); } catch (e) { d0.querySelector('.db').innerHTML = emptyBox('Не удалось открыть', esc(e.message), 'alert'); return; }
    if (openId !== id) return;
    const x = r.notice, live = x.state === 'active' || x.state === 'scheduled';
    if (x.unread) refreshBadges();
    const funnel = [['Получили', x.n, 'var(--dim)'], ['Открыли', x.seen, 'var(--info)'], x.link ? ['Нажали кнопку', x.clicked, 'var(--p-accent)'] : null, x.reply ? ['Ответили', x.replied, 'var(--ok)'] : null, ['Закрыли', x.closed, 'var(--muted)']].filter(Boolean);
    const WHO = [['all', 'Все'], ['unseen', 'Не открыли'], ['seen', 'Открыли'], x.link ? ['clicked', 'Нажали'] : null, x.reply ? ['replied', 'Ответили'] : null, ['open', 'Не закрыли']].filter(Boolean);
    const mark = (t) => (t ? `<span class="ok-t" title="${esc(dtt(t))}">${I('check')}</span>` : '<span class="dim">—</span>');
    const html = `
      <div class="nprev pn-scope" id="nPrev"></div>
      ${x.textEn ? `<div class="row" style="justify-content:flex-end;margin:-6px 0 12px"><div class="seg sm" id="nLang"><button type="button" data-g="ru" class="${prevLang === 'ru' ? 'on' : ''}">RU</button><button type="button" data-g="en" class="${prevLang === 'en' ? 'on' : ''}">EN</button></div></div>` : ''}
      <div class="card flat"><dl class="kv">
        <dt>Статус</dt><dd>${stBadge(x.state)}${x.revoked ? ` <span class="dim">${esc(dtt(x.revoked))}</span>` : ''}</dd>
        <dt>Кому</dt><dd>${esc(x.audience.label || '—')} · ${people(x.n)}${x.audience.kind === 'resend' && x.audience.from ? ` · <a href="#notices/${esc(x.audience.from)}">исходное</a>` : ''}</dd>
        <dt>Показ</dt><dd>${x.starts > x.created + 60e3 ? 'с ' + esc(dtt(x.starts)) : 'сразу'}${x.expires ? ' до ' + esc(dtt(x.expires)) : ', пока не закроют'}</dd>
        ${x.link ? `<dt>Кнопка</dt><dd>«${esc(x.linkText)}» → <span class="mono" style="font-size:12px">${esc(x.link)}</span></dd>` : ''}
        <dt>Ответы</dt><dd>${x.reply ? 'можно ответить в карточке' : 'выключены'}</dd>
        <dt>Отправил</dt><dd>${esc(x.byName || x.by || '—')} · ${esc(dtt(x.created))}</dd>
      </dl></div>
      <div class="card flat"><h3>Что с ним сделали</h3><div class="bars">${funnel.map(([t, v, c]) => `<div class="bar-row"><span>${t}</span><div class="track"><i style="width:${pct(v, x.n)}%;background:${c}"></i></div><b>${num(v)} <span class="dim" style="font-weight:500">${pct(v, x.n)}%</span></b></div>`).join('')}</div></div>
      ${x.reply ? `<div class="card flat"><h3>Ответы ${r.replies.length ? `<span class="dim">${num(r.replies.length)}</span>` : ''}</h3>${r.replies.length ? r.replies.map((y) => `<div class="nrep${y.unread ? ' unread' : ''}"><div class="row" style="gap:8px"><a href="#users/${esc(y.uid)}"><b>${esc(y.login || y.uid)}</b></a><span class="dim" style="font-size:12px">${esc(y.email || '')} · ${ago(y.replied)}</span>${y.unread ? '<span class="badge acc">новый</span>' : ''}<span class="sp" style="flex:1"></span><button class="ib sm" data-copy="${esc(y.reply)}" title="Скопировать ответ" aria-label="Скопировать">${I('copy')}</button></div><p>${esc(y.reply)}</p></div>`).join('') : '<div class="dim">Пока никто не ответил</div>'}</div>` : ''}
      <div class="card flat tight"><div class="chead" style="flex-wrap:wrap;gap:8px"><h3 style="margin:0">Получатели</h3><span class="sp" style="flex:1"></span><div class="seg sm" id="nWho">${WHO.map(([k, t]) => `<button type="button" data-w="${k}" class="${rs.who === k ? 'on' : ''}">${t}</button>`).join('')}</div>
        <label class="inp-ico" style="width:200px">${I('search')}<input class="inp sm" id="nRq" placeholder="Логин или почта" value="${esc(rs.q)}" autocomplete="off"></label></div>
        <div id="nRt">${tableHTML({ cols: [
          { t: 'Пользователь', render: (u) => `<b>${esc(u.login || 'удалён')}</b><div class="dim" style="font-size:12px">${esc(u.email || '')}</div>` },
          { t: 'Открыл', cls: 'r', render: (u) => mark(u.seen) }, ...(x.link ? [{ t: 'Нажал', cls: 'r', render: (u) => mark(u.clicked) }] : []), ...(x.reply ? [{ t: 'Ответил', cls: 'r', render: (u) => mark(u.replied) }] : []),
          { t: 'Закрыл', cls: 'r', render: (u) => mark(u.closed) }], rows: r.recipients, key: 'uid', empty: 'Никого', emptyIcon: 'users' })}
        ${pagerHTML({ page: r.page, pages: r.pages, total: r.rtotal, size: r.size, sizes: [r.size] })}</div></div>`;
    const d = drawer({ title: `${esc(x.title || 'Уведомление')}`, sub: `${esc(LVN[x.level])} · ${esc(ago(x.created))}`, avatar: `<span class="av lg nc-av ${esc(x.level)}">${I(x.level === 'info' ? 'info' : x.level === 'urgent' ? 'bell' : 'alert')}</span>`,
      actions: `<button class="ib" id="nMore" aria-label="Действия">${I('more')}</button>`, body: html, onClose: () => { openId = null; sync(); } });
    const prev = () => { const en = prevLang === 'en' && x.textEn, n = { id: x.id, level: x.level, at: x.starts, title: en ? x.titleEn : x.title, text: en ? x.textEn : x.text, link: x.link, linkText: en ? x.linkTextEn || x.linkText : x.linkText, reply: x.reply }; const box = $('nPrev'); box.innerHTML = ''; box.append(cardEl(n, { lang: en ? 'en' : 'ru' })); };
    prev();
    $('nPrev').addEventListener('click', (e) => e.preventDefault(), true);
    if ($('nLang')) $('nLang').onclick = (e) => { const b = e.target.closest('[data-g]'); if (!b) return; prevLang = b.dataset.g; qsa('#nLang button').forEach((y) => y.classList.toggle('on', y === b)); prev(); };
    $('nWho').onclick = (e) => { const b = e.target.closest('[data-w]'); if (!b) return; rs.who = b.dataset.w; rs.page = 1; openNotice(id, true); };
    $('nRq').oninput = debounce(() => { rs.q = $('nRq').value.trim(); rs.page = 1; openNotice(id, true).then(() => { const i = $('nRq'); if (i) { i.focus(); i.selectionStart = i.selectionEnd = i.value.length; } }); }, 300);
    bindTable($('nRt'), { rows: r.recipients, key: 'uid', onRow: (u) => u.login && go('users', u.uid) });
    bindPager($('nRt'), (p) => { rs.page = p; openNotice(id, true); }, () => {});
    const pre = Object.fromEntries(FIELDS.map((k) => [k, x[k]]));
    $('nMore').onclick = (e) => menu(e.currentTarget, [
      can('notices.send') && { label: 'Копировать в новое уведомление…', icon: 'copy', on: () => compose({ prefill: pre, title: 'Новое уведомление (копия)', onSent: () => load() }) },
      can('notices.send') && '-',
      ...(can('notices.send') ? Object.entries(RESEND).filter(([k]) => (k !== 'noclick' || x.link) && (k !== 'noreply' || x.reply) && (k !== 'open' || !live)).map(([k, t]) => ({
        label: `Отправить ещё раз ${t} · ${num(r.resend[k] || 0)}`, icon: 'refresh', disabled: !r.resend[k],
        on: () => compose({ to: { from: x.id, who: k }, prefill: pre, title: 'Повтор: ' + t, onSent: () => load() }),
      })) : []),
      can('notices.send') && live && '-',
      can('notices.send') && live && { label: x.state === 'scheduled' ? 'Отменить показ' : 'Отозвать — убрать у всех', icon: 'undo', danger: true, on: async () => {
        if (!(await confirmBox(x.state === 'scheduled' ? 'Отменить запланированное уведомление?' : 'Отозвать уведомление?', x.state === 'scheduled' ? 'Его никто не увидит.' : `Карточка исчезнет у тех, кто ещё не закрыл её (${num(r.resend.open)}). Статистика и ответы сохранятся.`, { danger: true, ok: x.state === 'scheduled' ? 'Отменить показ' : 'Отозвать' }))) return;
        try { await post(`/api/admin/notices/${x.id}/revoke`); toast('Уведомление отозвано', 'ok'); load(); openNotice(x.id, true); } catch (er) { fail()(er); }
      } },
      '-',
      { label: 'Скопировать ID', icon: 'copy', on: () => copyText(x.id) },
    ]);
    if (keep) d.scrollTop = sc; // не прыгаем наверх при фильтрах и листании
  }
  R.notices.open = openNotice;
  R.notices.compose = compose;

  /* ---------- вкладка «Уведомления» в карточке пользователя ---------- */
  window.noticeUserTab = (u, list) => {
    const rows = (list || []).map((x) => {
      const state = x.revoked ? ['отозвано', 'bad'] : x.scheduled ? ['запланировано · ' + dtt(x.starts), 'info'] : x.replied ? ['ответил', 'ok'] : x.clicked ? ['нажал кнопку', 'ok'] : x.closed ? ['закрыл', 'out'] : x.live ? [x.seen ? 'видел, не закрыл' : 'ещё не открыл', 'warn'] : ['срок истёк', 'out'];
      return `<div class="nrep" data-nid="${esc(x.id)}" style="cursor:${can('notices.view') ? 'pointer' : 'default'}"><div class="row" style="gap:8px;flex-wrap:wrap">${lvBadge(x.level)}<b>${esc(x.title || x.text.slice(0, 60))}</b><span class="badge ${state[1]}">${esc(state[0])}</span><span class="sp" style="flex:1"></span><span class="dim" style="font-size:12px">${esc(x.by || '')} · ${ago(x.created)}</span></div>
        ${x.title ? `<p class="dim" style="margin-top:4px">${esc(x.text.slice(0, 220))}${x.text.length > 220 ? '…' : ''}</p>` : ''}${x.answer ? `<div class="note" style="margin-top:8px">${I('mail')} <b>Ответ</b> <span class="dim">${ago(x.replied)}</span><div style="white-space:pre-wrap;margin-top:4px;color:var(--text)">${esc(x.answer)}</div></div>` : ''}</div>`;
    }).join('');
    return `${can('notices.send') && !u.banned ? `<div class="btns left" style="margin-bottom:12px"><button class="btn sm pri" data-a="notice">${I('send')}Новое уведомление</button></div>` : ''}${u.banned ? '<div class="note bad mb">Заблокированный пользователь не видит уведомлений</div>' : ''}
      ${rows ? `<div class="card flat">${rows}</div>` : emptyBox('Уведомлений не было', can('notices.send') && !u.banned ? 'Отправьте первое — оно появится в левом нижнем углу сайта' : '', 'bell')}`;
  };
})();
