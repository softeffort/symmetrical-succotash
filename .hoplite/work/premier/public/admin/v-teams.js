// Раздел «Командный тариф»: команды клиентов, оплаченные места, цена места и ручное изменение срока.
'use strict';
(() => {
  const HOW = [
    ['Покупка', 'владелец выбирает число мест (он сам — тоже место) и срок; скидки за 3/6/12 месяцев — как у обычных тарифов'],
    ['Приглашение', 'владелец отправляет ссылку /t/… — человек входит в аккаунт и нажимает «Вступить в команду»'],
    ['Лимиты', 'каждый на оплаченном месте получает Pro со своими лимитами; свой Max или более долгий Pro у человека сохраняется'],
    ['Докупить места', 'в оплаченной команде — доплата только за оставшиеся дни текущего срока'],
    ['Конец срока', 'за сутки владельцу приходит push; после — участники возвращаются на свой тариф'],
  ];

  R.teams = async () => {
    const el = $('view');
    $('vact').innerHTML = '';
    const j = await api('/api/admin/teams');
    if (!el.isConnected) return;
    const c = j.conf || {};
    const form = !j.canEdit ? '<p class="muted">Менять настройки может администратор с правом «Тарифы».</p>'
      : `<div style="display:grid;gap:10px;max-width:460px;margin-top:10px">
          <label class="check"><input type="checkbox" id="tmOn"${c.on ? ' checked' : ''}> Командный тариф доступен для покупки</label>
          <label>Цена места в месяц, ₽<input class="inp" id="tmPrice" type="number" min="1" max="100000" value="${esc(c.price)}"></label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <label>Минимум мест<input class="inp" id="tmMin" type="number" min="1" max="100" value="${esc(c.min)}"></label>
            <label>Максимум мест<input class="inp" id="tmMax" type="number" min="1" max="1000" value="${esc(c.max)}"></label>
          </div>
          <div><button class="btn" id="tmSave">Сохранить</button></div>
          <div class="msg" id="tmRes"></div>
        </div>`;
    const rows = (j.list || []).map((t) => `<tr>
        <td><b>${esc(t.name)}</b><div class="dim" style="font-size:12px">${esc(t.login)}${t.email ? ' · ' + esc(t.email) : ''}</div>
          <div class="dim" style="font-size:12px">${t.people.map((p) => esc(p.login) + (p.owner ? ' (владелец)' : '') + (p.seat ? '' : ' — без места')).join(', ')}</div></td>
        <td>${num(t.used)} из ${num(t.seats)}</td>
        <td>${t.active ? 'до ' + dt(t.until) : '<span class="dim">не оплачена' + (t.until ? ' · была до ' + dt(t.until) : '') + '</span>'}</td>
        <td>${rub(t.paid)}<div class="dim" style="font-size:12px">${num(t.pays)} ${plural(t.pays, 'платёж', 'платежа', 'платежей')}</div></td>
        <td>${j.canEdit ? `<button class="btn ghost" data-tmdays="${esc(t.id)}" data-tmname="${esc(t.name)}">Изменить срок</button>` : ''}</td>
      </tr>`).join('');
    el.innerHTML = `
      <div class="grid g4 mb">${[
        ['Активных команд', num(j.active), 'всего создано: ' + num(j.teams)],
        ['Оплачено мест', num(j.seats), 'занято: ' + num(j.members)],
        ['Выручка за 30 дней', rub(j.revenue30), 'за всё время: ' + rub(j.revenue)],
        ['Цена места', rub(c.price), c.on ? `от ${num(c.min)} до ${num(c.max)} мест` : 'продажа выключена'],
      ].map(([a, b, d]) => `<div class="kpi"><small>${a}</small><b>${b}</b><div class="meta"><span>${d}</span></div></div>`).join('')}</div>
      <div class="grid g2 mb">
        <div class="card" style="margin:0"><h2>Настройки</h2><div class="sub">Цена действует для новых оплат и продлений. Уже оплаченные сроки не меняются.</div>${form}</div>
        <div class="card" style="margin:0"><h2>Как это работает</h2><div class="sub">Ссылка на покупку для рассылок и сайта: <span class="mono">/team</span></div>
          ${HOW.map(([a, b]) => `<div style="margin-top:10px"><b>${a}</b><div class="dim" style="font-size:12.5px">${b}</div></div>`).join('')}
        </div>
      </div>
      <div class="card"><h2>Команды</h2>${rows ? `<div class="tw"><table><thead><tr><th>Команда</th><th>Места</th><th>Срок</th><th>Оплачено</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">Пока ни одной команды. Ссылка на покупку — /team.</p>'}</div>`;
    const save = $('tmSave');
    if (save) save.onclick = () => busy(save, async () => {
      try {
        await post('/api/admin/teams/settings', { on: $('tmOn').checked, price: +$('tmPrice').value, min: +$('tmMin').value, max: +$('tmMax').value });
        toast('Настройки сохранены', 'ok'); R.teams();
      } catch (er) { fail('tmRes')(er); }
    });
    qsa('[data-tmdays]', el).forEach((b) => { b.onclick = async () => {
      const v = prompt(`На сколько дней изменить срок команды «${b.dataset.tmname}»? Например, 7 — продлить, −3 — сократить.`, '7');
      if (v == null || !v.trim()) return;
      try { const r = await post('/api/admin/teams/' + encodeURIComponent(b.dataset.tmdays) + '/days', { days: +v.replace('−', '-') }); toast('Срок: до ' + dt(r.until), 'ok'); R.teams(); }
      catch (er) { toast(er.message, 'err'); }
    }; });
  };
})();
