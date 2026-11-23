// Раздел «Уведомления»: сколько устройств подписано на push и рассылка новостей.
'use strict';
(() => {
  const AUD = [['all', 'Всем'], ['free', 'Только Free'], ['paid', 'Только платным']];
  const AUTO = [
    ['Оплата прошла', 'сразу после подтверждения платежа: какой тариф и до какого числа (или «лимит сброшен»)'],
    ['Тариф заканчивается завтра', 'за сутки до конца платного тарифа, один раз на каждый срок'],
    ['Проверка', 'когда пользователь нажимает «Проверить» в Аккаунт → Профиль'],
  ];

  R.push = async () => {
    const el = $('view');
    $('vact').innerHTML = '';
    const j = await api('/api/admin/push');
    if (!el.isConnected) return;
    let to = 'all';
    const form = !j.canSend ? '<p class="muted">Для рассылки нужно право менять настройки системы.</p>'
      : j.off ? '<p class="muted">Уведомления выключены на сервере (переменная <span class="mono">PUSH_OFF=1</span>).</p>'
      : `<div style="display:grid;gap:10px;max-width:560px;margin-top:10px">
          <input class="inp" id="puTitle" maxlength="120" placeholder="Заголовок, например: В Premier появилась новая модель">
          <textarea class="inp" id="puBody" maxlength="500" rows="3" placeholder="Текст уведомления (необязательно, до 500 символов)" style="resize:vertical"></textarea>
          <input class="inp" id="puUrl" value="/chat" placeholder="Куда ведёт нажатие: /chat или https://…">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><div class="seg" id="puTo">${AUD.map(([k, n]) => `<button data-to="${k}" class="${k === to ? 'on' : ''}">${n}</button>`).join('')}</div><button class="btn" id="puSend">Отправить</button></div>
          <div class="msg" id="puRes"></div>
        </div>`;
    el.innerHTML = `
      <div class="grid g4 mb">${[
        ['Подписано устройств', num(j.subs), 'браузеры и установленные приложения'],
        ['Пользователей', num(j.users), 'хотя бы одно устройство'],
        ['Состояние', j.off ? 'Выключены' : 'Работают', j.off ? 'PUSH_OFF=1 на сервере' : 'оплаты, напоминания, рассылки'],
      ].map(([a, b, c]) => `<div class="kpi"><small>${a}</small><b>${b}</b><div class="meta"><span>${c}</span></div></div>`).join('')}</div>
      <div class="grid g2 mb">
        <div class="card" style="margin:0"><h2>Рассылка</h2><div class="sub">Уведомление придёт на все подписанные устройства выбранных пользователей. Пишите коротко и по делу — из-за спама люди выключают уведомления.</div>${form}</div>
        <div class="card" style="margin:0"><h2>Что приходит само</h2><div class="sub">Пользователи включают уведомления в Аккаунт → Профиль → «Уведомления». На iPhone — после добавления сайта на экран «Домой».</div>
          ${AUTO.map(([a, b]) => `<div style="margin-top:10px"><b>${a}</b><div class="dim" style="font-size:12.5px">${b}</div></div>`).join('')}
        </div>
      </div>`;
    const seg = $('puTo');
    if (seg) seg.onclick = (e) => { const b = e.target.closest('[data-to]'); if (!b) return; to = b.dataset.to; qsa('[data-to]', seg).forEach((x) => x.classList.toggle('on', x === b)); };
    const send = $('puSend');
    if (send) send.onclick = () => busy(send, async () => {
      const title = $('puTitle').value.trim(), body = $('puBody').value.trim(), url = $('puUrl').value.trim() || '/chat';
      if (!title) return say('puRes', 'Введите заголовок', 'err');
      const who = AUD.find((x) => x[0] === to)[1].toLowerCase();
      if (!confirm(`Отправить уведомление «${title}» (${who})? Отменить рассылку потом нельзя.`)) return;
      try {
        const r = await post('/api/admin/push', { title, body, url, to });
        say('puRes', `Доставлено: ${num(r.sent)} · не дошло: ${num(r.failed)} · удалено устаревших подписок: ${num(r.removed)}`, 'ok');
        toast('Рассылка отправлена', 'ok');
      } catch (er) { fail('puRes')(er); }
    });
  };
})();
