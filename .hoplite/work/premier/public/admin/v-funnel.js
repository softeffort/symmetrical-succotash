// Раздел «Воронка»: путь от регистрации до оплаты, сравнение источников трафика (UTM, сайты, реклама) и Яндекс Метрика.
'use strict';
(() => {
  const PERIODS = [[7, '7 дней'], [30, '30 дней'], [90, '90 дней'], [365, 'Год']];
  const BY = [['source', 'Источник'], ['medium', 'Канал'], ['campaign', 'Кампания'], ['landing', 'Страница входа']];
  const STEPS = [['signups', 'Зарегистрировались'], ['msg', 'Написали в чат'], ['limit', 'Упёрлись в лимит'], ['plans', 'Открыли тарифы'], ['checkout', 'Начали оплату'], ['paid', 'Оплатили']];
  const NAMES = { direct: 'Прямые заходы', invite: 'Приглашения', yandex: 'Яндекс', google: 'Google', telegram: 'Telegram', vk: 'ВКонтакте', youtube: 'YouTube', dzen: 'Дзен', habr: 'Хабр', bing: 'Bing', '': 'Неизвестно' };
  const MEDIUM = { organic: 'Поиск', cpc: 'Реклама', social: 'Соцсети', referral: 'Ссылки', none: 'Прямые', email: 'Почта' };
  const label = (by, k) => (by === 'medium' ? MEDIUM[k] || k : by === 'source' ? NAMES[k] || k : k || 'Неизвестно');
  const share = (v, all) => (all ? Math.round((v / all) * 1000) / 10 : 0);

  R.funnel = async (params) => {
    const el = $('view'), days = +params.days || pref.get('funnelDays', 30), by = params.by || pref.get('funnelBy', 'source');
    $('vact').innerHTML = `<div class="seg" id="fPer">${PERIODS.map(([d, t]) => `<button data-d="${d}" class="${d === days ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    $('fPer').onclick = (e) => { const b = e.target.closest('[data-d]'); if (!b) return; pref.set('funnelDays', +b.dataset.d); setHash('funnel', '', { days: b.dataset.d, by }); R.funnel({ days: b.dataset.d, by }); };
    const j = await api('/api/admin/funnel?days=' + days + '&by=' + encodeURIComponent(by));
    if (!el.isConnected) return;
    const t = j.total, top = Math.max(1, t.signups);
    const steps = STEPS.map(([k, name], i) => {
      const v = t[k], prev = i ? t[STEPS[i - 1][0]] : 0, lost = i && prev > v ? prev - v : 0;
      return `<div class="st"><span>${name}${lost ? ` <span class="dim" style="font-size:12px">−${num(lost)} на этом шаге</span>` : ''}</span><b>${num(v)}${i && t.signups ? ` <span class="dim" style="font-weight:400">· ${num(share(v, t.signups), 1)}%</span>` : ''}</b><div class="track"><i style="width:${Math.max(v ? 2 : 0, (v / top) * 100)}%"></i></div></div>`;
    }).join('');
    const cell = (x, k) => `${num(x[k])}${k !== 'signups' && x.signups ? `<div class="dim" style="font-size:11.5px">${num(share(x[k], x.signups), 1)}%</div>` : ''}`;
    const m = j.metrika || {};
    el.innerHTML = `
      <div class="grid g4 mb">${[
        ['Регистрации', num(t.signups), `источник известен у ${num(share(j.tracked, t.signups), 1)}%`],
        ['Конверсия в оплату', t.conv == null ? '—' : num(t.conv, 1) + '%', `${num(t.paid)} из ${num(t.signups)}`],
        ['Выручка с новых', rub(t.revenue), t.addons ? `в т.ч. допродажи: ${num(t.addons)} на ${rub(t.addonRevenue)}` : 'оплаты этих пользователей'],
        ['На одну регистрацию', rub(t.arpu), 'средняя выручка'],
      ].map(([a, b, c]) => `<div class="kpi"><small>${a}</small><b>${b}</b><div class="meta"><span>${c}</span></div></div>`).join('')}</div>
      <div class="grid g2 mb">
        <div class="card" style="margin:0"><h2>Воронка</h2><div class="sub">Те, кто зарегистрировался за период, и до какого шага дошли</div><div class="funnel">${steps}</div></div>
        <div class="card" style="margin:0"><h2>Яндекс Метрика</h2><div class="sub">Счётчик подключается на главную, вход и чат. Цели отправляются сами: <span class="mono">plans</span>, <span class="mono">checkout</span>, <span class="mono">paid</span> — создайте их в Метрике как «Действие JavaScript».</div>
          ${m.env ? `<p class="muted">Номер счётчика задан на сервере (переменная YM_ID): <b class="mono">${esc(m.env)}</b>. Чтобы изменить его здесь, уберите переменную.</p>`
            : `<div style="display:flex;gap:8px;align-items:center;margin-top:10px"><input class="inp" id="ymId" inputmode="numeric" placeholder="Например, 98765432" value="${esc(m.id || '')}" ${m.canEdit ? '' : 'disabled'} style="max-width:220px">${m.canEdit ? '<button class="btn" id="ymSave">Сохранить</button>' : ''}</div>
               <div class="dim" style="font-size:12.5px;margin-top:8px">${m.id ? 'Счётчик работает. Чтобы отключить — очистите поле и сохраните.' : 'Не подключён. Воронка в этом разделе работает и без Метрики.'} Не забудьте упомянуть Метрику в политике конфиденциальности.</div>`}
          <div class="divider"></div><h3>Как размечать ссылки</h3>
          <div class="muted" style="font-size:13px">Добавляйте к ссылкам в рекламе и постах метки, например:<div class="mono" style="margin:6px 0;word-break:break-all">${esc(location.origin)}/?utm_source=telegram&amp;utm_medium=social&amp;utm_campaign=november</div>Клики из Яндекс Директа и Google Ads распознаются и без меток. Источник запоминается по первому визиту на 90 дней.</div>
        </div>
      </div>
      <div class="card tight"><div class="chead"><div><h2>По источникам</h2><div class="sub">У пользователей, зарегистрировавшихся до этого обновления, источник неизвестен</div></div>
        <div class="seg" id="fBy">${BY.map(([k, n]) => `<button data-by="${k}" class="${k === by ? 'on' : ''}">${n}</button>`).join('')}</div></div><div id="fRows"></div></div>`;
    $('fBy').onclick = (e) => { const b = e.target.closest('[data-by]'); if (!b) return; pref.set('funnelBy', b.dataset.by); setHash('funnel', '', { days, by: b.dataset.by }); R.funnel({ days, by: b.dataset.by }); };
    $('fRows').innerHTML = tableHTML({ rows: j.rows, key: 'key', click: false, empty: 'За этот период регистраций не было', emptyIcon: 'activity', cols: [
      { t: BY.find((x) => x[0] === j.by)[1], cls: 'wrap', render: (x) => `<b>${esc(label(j.by, x.key))}</b>` },
      ...STEPS.map(([k, n]) => ({ t: n.replace('Зарегистрировались', 'Регистр.').replace('Написали в чат', 'Писали').replace('Упёрлись в лимит', 'Лимит').replace('Открыли тарифы', 'Тарифы').replace('Начали оплату', 'К оплате'), cls: 'r', render: (x) => cell(x, k) })),
      { t: 'Выручка', cls: 'r', render: (x) => `<b>${rub(x.revenue)}</b>${x.signups ? `<div class="dim" style="font-size:11.5px">${rub(x.arpu)} на рег.</div>` : ''}` },
    ] });
    const save = $('ymSave');
    if (save) save.onclick = async () => {
      const id = $('ymId').value.replace(/\s+/g, '');
      if (id && !/^\d{4,12}$/.test(id)) return toast('Номер счётчика — только цифры', 'err');
      try { await post('/api/admin/metrika', { id }); toast(id ? 'Метрика подключена — счётчик появится на страницах сайта' : 'Метрика отключена', 'ok'); R.funnel({ days, by }); } catch (er) { fail()(er); }
    };
  };
})();
