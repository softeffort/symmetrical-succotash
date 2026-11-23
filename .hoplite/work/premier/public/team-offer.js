// Полоска «Для команд» под тарифами на главной (RU и EN). Данные — из /api/team/offer, настраиваются в Панели.
(function () {
  'use strict';
  var el = document.getElementById('teamStrip');
  if (!el || !window.fetch) return;
  var EN = /^en/i.test(document.documentElement.lang || '');
  var seatsRu = function (n) { return n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'места' : 'мест'); };
  var money = function (n) { return Number(n).toLocaleString(EN ? 'en-US' : 'ru-RU') + ' ₽'; };
  fetch('/api/team/offer', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (o) {
    if (!o || !o.on) return;
    el.innerHTML = EN
      ? '<div class="ts-tt"><b>For teams</b><span>Pro for everyone — ' + money(o.price) + ' per seat per month, from ' + o.min + ' seats. You pay for the team, each member keeps their own Pro limits.</span></div><a class="ts-btn" href="/team">Get the team plan</a>'
      : '<div class="ts-tt"><b>Для команд</b><span>Pro для всех — ' + money(o.price) + ' за место в месяц, от ' + seatsRu(o.min) + '. Вы платите за команду, у каждого свои лимиты Pro.</span></div><a class="ts-btn" href="/team">Оформить для команды</a>';
    el.hidden = false;
  }).catch(function () {});
})();
