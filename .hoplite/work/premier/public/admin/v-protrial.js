// Section "Pro-trial": who took the free trial, when it expired, and how many messages were spent.
'use strict';
(() => {
  let items = [], days = 1;
  R.protrial = async () => {
    $('view').innerHTML = `<div class="grid g4 mb" id="ptKpi"></div>
      <div class="toolbar"><label class="inp-ico" style="width:280px">${I('search')}<input class="inp" id="ptq" placeholder="Email or name"></label><span class="sp"></span><button class="btn sm" id="ptRefresh">${I('refresh')}Refresh</button></div>
      <div class="card" id="ptList"></div>`;
    $('ptq').oninput = debounce(() => paint(), 200);
    $('ptRefresh').onclick = () => busy($('ptRefresh'), load);
    await load();
  };
  async function load() {
    try {
      const j = await api('/api/admin/protrial');
      items = j.items || []; days = j.days || 1;
      const active = items.filter((i) => i.active).length;
      $('ptKpi').innerHTML = [
        ['Applications', num(items.length), pn(items.length, 'person', 'people', 'persons') + ' · ' + pn(days, 'day', 'days', 'days') + ' Pro'],
        ['Active now', num(active), active ? 'trial is still running' : 'no one is on trial'],
        ['Messages spent', num(j.msgs || 0), 'during the trial period'],
        ['Average per person', items.length ? num(Math.round((j.msgs || 0) / items.length)) : '0', 'messages'],
      ].map(([t, v, s]) => `<div class="kpi"><small>${t}</small><b>${v}</b><div class="meta">${s}</div></div>`).join('');
      paint();
    } catch (e) { fail('ptList')(e); }
  }
  function paint() {
    const q = (($('ptq') && $('ptq').value) || '').trim().toLowerCase();
    const list = items.filter((i) => !q || (i.email || '').toLowerCase().includes(q) || (i.name || i.login || '').toLowerCase().includes(q));
    const cols = [
      { t: 'User', render: (i) => `<a href="#users/${i.uid}">${esc(i.name || i.login || '—')}</a>` },
      { t: 'Email', render: (i) => `<span class="dim">${esc(i.email || '—')}</span>` },
      { t: 'Taken', render: (i) => dtt(i.at) },
      { t: 'Trial until', render: (i) => dtt(i.endAt) + (i.active ? ` <span class="dim">(${left(i.endAt)} left)</span>` : ' <span class="dim"> — expired</span>') },
      { t: 'Messages', cls: 'r', render: (i) => '<b>' + num(i.msgs) + '</b>' },
      { t: 'Status', render: (i) => i.active ? '<span class="badge ok">Active</span>' : '<span class="badge out">Expired</span>' },
    ];
    $('ptList').innerHTML = tableHTML({ cols, rows: list, sort: { k: 'at', dir: 'desc' }, empty: q ? 'Nothing found for this query' : 'No one has taken the pro-trial yet', emptyIcon: 'clock' });
  }
})();
