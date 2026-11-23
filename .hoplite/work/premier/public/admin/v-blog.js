// Раздел «Гайды и блог»: список материалов, редактор Markdown с живым предпросмотром, публикация и превью в поиске.
// Читать можно с правом «Контент: просмотр», менять — с правом «Контент: изменение».
'use strict';
(() => {
  const LANG = { ru: 'RU', en: 'EN' };
  const ST = { published: ['Опубликовано', 'ok'], draft: ['Черновик', 'out'] };
  const F = { status: '', lang: '', q: '' };
  const css = () => {
    if ($('blStyle')) return;
    const s = document.createElement('style'); s.id = 'blStyle';
    s.textContent = `.bl-ed{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);align-items:start}@media(max-width:1100px){.bl-ed{grid-template-columns:1fr}}
.bl-ed textarea.mono{font-family:var(--p-font-mono,monospace);font-size:13px;line-height:1.55;min-height:420px;resize:vertical}
.bl-tb{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}.bl-tb button{min-width:32px;padding:4px 8px;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--text);font:600 12px/1.4 inherit;cursor:pointer}.bl-tb button:hover{background:var(--hover)}
.bl-side{position:sticky;top:12px;display:grid;gap:14px}.bl-snip{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--card2)}.bl-snip b{display:block;color:#5b8def;font-size:16px;font-weight:500;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bl-snip small{display:block;color:var(--ok);font-size:12px;margin-bottom:4px;word-break:break-all}.bl-snip p{margin:0;color:var(--muted);font-size:13px;line-height:1.45}
.bl-md{font-size:14px;line-height:1.65;max-height:70vh;overflow:auto;padding-right:6px;word-wrap:break-word}.bl-md h2{font-size:19px;margin:18px 0 8px}.bl-md h3{font-size:16px;margin:14px 0 6px}.bl-md h4{font-size:14px;margin:12px 0 6px}.bl-md p,.bl-md ul,.bl-md ol,.bl-md blockquote,.bl-md pre,.bl-md .table{margin:0 0 10px}
.bl-md a{color:var(--acc)}.bl-md code{font-family:var(--p-font-mono,monospace);font-size:.9em;background:var(--card2);border:1px solid var(--line);border-radius:5px;padding:0 4px}.bl-md pre{background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;overflow:auto}.bl-md pre code{border:0;padding:0;background:none}
.bl-md blockquote{border-left:3px solid var(--acc);padding:2px 0 2px 12px;color:var(--muted)}.bl-md img{max-width:100%;border-radius:10px}.bl-md table{border-collapse:collapse;width:100%}.bl-md th,.bl-md td{border:1px solid var(--line);padding:5px 8px;text-align:left}.bl-md li.task{list-style:none}.bl-md li.task::before{content:'☐ '}.bl-md li.task.done::before{content:'☑ '}
.bl-cnt{float:right;font-weight:400}.bl-cnt.warn{color:var(--warn)}.bl-row{cursor:pointer}.bl-row td small{display:block;color:var(--dim)}.bl-help{font-size:12px;color:var(--muted);line-height:1.6;margin-top:6px}.bl-help code{font-size:11.5px}
.bl-slug{display:flex;align-items:center;gap:0}.bl-slug span{padding:0 8px 0 0;color:var(--dim);font-size:13px;white-space:nowrap}`;
    document.head.append(s);
  };

  R.blog = async (params, id) => { css(); return id ? editor(id) : listView(); };

  /* ---------- список ---------- */
  async function listView() {
    const el = $('view');
    const j = await api('/api/admin/blog');
    if (!el.isConnected) return;
    $('vact').innerHTML = `<a class="btn" href="/blog" target="_blank" rel="noopener">${I('ext')}Открыть блог</a>${j.canEdit ? `<button class="btn pri" id="blNew">${I('plus')}Новый материал</button>` : ''}`;
    if ($('blNew')) $('blNew').onclick = () => go('blog', 'new');
    const s = j.stats || {};
    const draw = () => {
      const qq = F.q.trim().toLowerCase();
      const rows = j.list.filter((p) => (!F.status || p.status === F.status) && (!F.lang || p.lang === F.lang) && (!qq || (p.title + ' ' + p.slug + ' ' + p.tags.join(' ')).toLowerCase().includes(qq)));
      $('blList').innerHTML = !j.list.length ? emptyBox('Пока нет ни одного материала', j.canEdit ? 'Нажмите «Новый материал», чтобы написать первый гайд' : '', 'edit')
        : !rows.length ? emptyBox('Ничего не найдено', 'Попробуйте изменить фильтры', 'search')
        : `<div class="tw"><table><thead><tr><th>Материал</th><th style="width:60px">Язык</th><th style="width:140px">Статус</th><th style="width:150px">Дата</th><th style="width:100px" class="num">Просмотры</th></tr></thead><tbody>${rows.map((p) => `<tr class="bl-row" data-id="${esc(p.id)}">
            <td><b>${esc(p.title)}</b><small>/blog/${esc(p.slug)}${p.tags.length ? ' · ' + esc(p.tags.join(', ')) : ''}${p.pair ? ' · есть перевод' : ''}</small></td>
            <td>${LANG[p.lang] || esc(p.lang)}</td><td><span class="badge ${ST[p.status][1]}">${ST[p.status][0]}</span></td>
            <td>${p.status === 'published' ? dt(p.published) : '<span class="dim">изм. ' + esc(ago(p.updated)) + '</span>'}</td><td class="num">${p.status === 'published' ? num(p.views) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
    };
    el.innerHTML = `<div class="card"><div class="chead"><div><h2>${I('edit')}Гайды и блог</h2><div class="sub">Опубликовано ${num(s.published)} · черновиков ${num(s.drafts)} · просмотров ${num(s.views)}</div></div></div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px">
        <div class="seg" id="blSt">${[['', 'Все'], ['published', 'Опубликованные'], ['draft', 'Черновики']].map(([k, t]) => `<button type="button" data-k="${k}" class="${F.status === k ? 'on' : ''}">${t}</button>`).join('')}</div>
        <div class="seg" id="blLg">${[['', 'Все языки'], ['ru', 'RU'], ['en', 'EN']].map(([k, t]) => `<button type="button" data-k="${k}" class="${F.lang === k ? 'on' : ''}">${t}</button>`).join('')}</div>
        <input class="inp" id="blQ" placeholder="Поиск по заголовку, адресу, меткам" value="${esc(F.q)}" style="flex:1;min-width:200px">
      </div><div id="blList"></div>
      <p class="muted" style="margin:12px 0 0;font-size:13px">Опубликованные материалы сразу появляются на <a href="/blog" target="_blank" rel="noopener">/blog</a> (английские — на /blog?lang=en), в sitemap.xml и RSS. Черновики видны только по ссылке предпросмотра.</p></div>`;
    const seg = (id, key) => { $(id).onclick = (e) => { const b = e.target.closest('[data-k]'); if (!b) return; F[key] = b.dataset.k; qsa('#' + id + ' button').forEach((x) => x.classList.toggle('on', x === b)); draw(); }; };
    seg('blSt', 'status'); seg('blLg', 'lang');
    $('blQ').oninput = debounce(() => { F.q = $('blQ').value; draw(); }, 150);
    $('blList').onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) go('blog', tr.dataset.id); };
    draw();
  }

  /* ---------- редактор ---------- */
  async function editor(id) {
    const el = $('view'), isNew = id === 'new';
    const [j, p] = await Promise.all([api('/api/admin/blog'), isNew ? null : api('/api/admin/blog/' + encodeURIComponent(id))]);
    if (!el.isConnected) return;
    const ed = j.canEdit, dis = ed ? '' : ' disabled', L = j.limits || { title: 140, description: 300 };
    if (isNew && !ed) { go('blog'); return; }
    const cur = p || { title: '', slug: '', lang: 'ru', description: '', tags: [], cover: '', pair: '', body: '', status: 'draft' };
    let dirty = false;
    const back = async () => { if (dirty && !(await confirmBox('Уйти без сохранения?', 'Изменения в материале не сохранены.', { ok: 'Уйти', danger: true }))) return; dirty = false; go('blog'); };
    $('vact').innerHTML = `<button class="btn" id="blBack">${I('left')}Все материалы</button>`;
    $('blBack').onclick = back;
    const pairOpts = (lang) => `<option value="">— нет —</option>` + j.list.filter((x) => x.lang !== lang && x.id !== cur.id).map((x) => `<option value="${esc(x.id)}"${cur.pair === x.id ? ' selected' : ''}>${esc(LANG[x.lang] + ' · ' + x.title)}${x.status === 'draft' ? ' (черновик)' : ''}</option>`).join('');
    const status = () => isNew ? 'Новый материал — ещё не сохранён' : `<span class="badge ${ST[cur.status][1]}">${ST[cur.status][0]}</span> ${cur.status === 'published' ? 'с ' + esc(dt(cur.published)) + ' · просмотров: ' + num(cur.views) : ''} · изменён ${esc(ago(cur.updated))}${cur.author ? ' · автор: ' + esc(cur.author) : ''}`;
    const TB = [['B', '**', '**', 'Жирный'], ['I', '*', '*', 'Курсив'], ['H2', '\n## ', '', 'Заголовок раздела'], ['H3', '\n### ', '', 'Подзаголовок'], ['•', '\n- ', '', 'Список'], ['1.', '\n1. ', '', 'Нумерованный список'],
      ['❝', '\n> ', '', 'Цитата или совет'], ['</>', '`', '`', 'Код в строке'], ['{ }', '\n```\n', '\n```\n', 'Блок кода'], ['Ссылка', '[', '](https://)', 'Ссылка'], ['Картинка', '![', '](https://)', 'Картинка по ссылке'], ['Таблица', '\n| Колонка | Колонка |\n|---|---|\n| ', ' |  |\n', 'Таблица']];
    el.innerHTML = `<div class="grid bl-ed">
      <form class="card" id="blF" style="margin:0" autocomplete="off" novalidate>
        <div class="chead"><div><h2>${I('edit')}${isNew ? 'Новый материал' : esc(cur.title)}</h2><div class="sub" id="blStat">${status()}</div></div></div>
        <label class="field"><span>Заголовок <b class="bl-cnt" data-c="title"></b></span><input name="title" maxlength="${L.title}" value="${esc(cur.title)}" placeholder="Как сделать сайт за 5 минут"${dis}></label>
        <div class="grid g2" style="gap:0 12px">
          <label class="field"><span>Адрес страницы</span><div class="bl-slug"><span>/blog/</span><input name="slug" class="inp" maxlength="80" value="${esc(cur.slug)}" placeholder="заполнится из заголовка" style="flex:1"${dis}></div><small>Латиница, цифры и дефисы. После публикации лучше не менять</small></label>
          <label class="field"><span>Язык</span><select name="lang"${dis}><option value="ru"${cur.lang === 'ru' ? ' selected' : ''}>Русский — /blog</option><option value="en"${cur.lang === 'en' ? ' selected' : ''}>English — /blog?lang=en</option></select></label>
        </div>
        <label class="field"><span>Краткое описание <b class="bl-cnt" data-c="description"></b></span><textarea name="description" rows="2" maxlength="${L.description}" placeholder="1–2 предложения: что читатель узнает. Показывается в поиске и соцсетях"${dis}>${esc(cur.description)}</textarea><small>Лучше всего 120–160 символов. Если пусто — возьмём начало текста</small></label>
        <div class="grid g2" style="gap:0 12px">
          <label class="field"><span>Метки <span class="dim">(через запятую)</span></span><input name="tags" value="${esc(cur.tags.join(', '))}" placeholder="сайты, python, советы"${dis}></label>
          <label class="field"><span>Обложка <span class="dim">(необязательно)</span></span><input name="cover" value="${esc(cur.cover)}" placeholder="https://…/cover.png или /media/…"${dis}></label>
        </div>
        <label class="field"><span>Перевод этого материала <span class="dim">(необязательно)</span></span><select name="pair"${dis}>${pairOpts(cur.lang)}</select><small>Свяжите русскую и английскую версии — поисковики будут показывать нужную (hreflang), а кнопка RU/EN на странице ведёт на перевод</small></label>
        <div class="field"><span>Текст <span class="dim">(Markdown)</span> <b class="bl-cnt" id="blWords"></b></span>
          ${ed ? `<div class="bl-tb" id="blTb">${TB.map((b, k) => `<button type="button" data-k="${k}" title="${esc(b[3])}">${esc(b[0])}</button>`).join('')}</div>` : ''}
          <textarea name="body" class="inp mono" rows="22" spellcheck="true" placeholder="## Заголовок раздела\n\nОбычный абзац текста.\n\n- пункт списка\n- **жирный** и *курсив*"${dis}>${esc(cur.body)}</textarea>
          <div class="bl-help">## заголовок · ### подзаголовок · <code>**жирный**</code> · <code>*курсив*</code> · <code>[текст](https://…)</code> · <code>![подпись](https://…/картинка.png)</code> · списки <code>-</code> и <code>1.</code> · <code>&gt; совет</code> · <code>\`код\`</code> и блоки <code>\`\`\`</code> · таблицы <code>| a | b |</code>. HTML в тексте показывается как есть. Сохранить — Ctrl+S.</div>
        </div>
        <div class="msg" id="blMsg"></div>
        ${ed ? `<div class="btns" style="flex-wrap:wrap"><button type="submit" class="btn pri" id="blSave">Сохранить</button>
          <button type="button" class="btn" id="blPub">${cur.status === 'published' ? 'Снять с публикации' : 'Опубликовать'}</button>
          <span style="flex:1"></span>${isNew ? '' : `<button type="button" class="btn danger" id="blDel">${I('trash')}Удалить</button>`}</div>` : '<p class="muted">Менять материалы может администратор с правом «Контент: изменение».</p>'}
      </form>
      <div class="bl-side">
        <div class="card" style="margin:0"><div class="chead"><div><h2>${I('search')}Как в поиске</h2></div><div id="blLinks"></div></div><div class="bl-snip" id="blSnip"></div></div>
        <div class="card" style="margin:0"><div class="chead"><div><h2>${I('eye')}Предпросмотр</h2><div class="sub" id="blRead"></div></div></div><div class="bl-md" id="blPrev"></div></div>
      </div></div>`;
    const f = $('blF'), E = f.elements;
    const links = () => { $('blLinks').innerHTML = isNew ? '' : cur.status === 'published' ? `<a class="btn sm" href="${esc(cur.url)}" target="_blank" rel="noopener">${I('ext')}На сайте</a>` : `<a class="btn sm" href="${esc(cur.previewUrl)}" target="_blank" rel="noopener" title="Ссылка работает без входа — можно отправить на вычитку">${I('eye')}Черновик</a>`; };
    const counters = () => {
      for (const k of ['title', 'description']) { const c = qs(`[data-c="${k}"]`, f), n = E[k].value.trim().length, warn = k === 'description' ? n && (n < 70 || n > 170) : n > 70; c.textContent = n + ' / ' + L[k]; c.classList.toggle('warn', !!warn); }
      const host = location.host, slug = E.slug.value.trim() || '…', d = E.description.value.trim() || E.body.value.replace(/[#*`>\[\]()!|_-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      $('blSnip').innerHTML = `<b>${esc((E.title.value.trim() || 'Заголовок') + ' — Premier')}</b><small>${esc(host + '/blog/' + slug)}</small><p>${esc(d || 'Описание появится здесь')}</p>`;
    };
    const showPrev = (r) => { $('blPrev').innerHTML = r.html || '<p class="muted">Здесь будет текст материала так, как его увидят читатели.</p>'; $('blRead').textContent = r.words ? `${pn(r.words, 'слово', 'слова', 'слов')} · ~${r.minutes} мин чтения${r.toc && r.toc.length >= 3 ? ' · с оглавлением' : ''}` : ''; $('blWords').textContent = r.words ? pn(r.words, 'слово', 'слова', 'слов') : ''; };
    const refresh = debounce(async () => { if (!ed) return; try { showPrev(await post('/api/admin/blog/preview', { body: E.body.value })); } catch (e) { if (e.message !== 'auth') $('blRead').textContent = e.message; } }, 350);
    if (p && p.preview) showPrev(p.preview); else if (ed) refresh(); else showPrev({});
    counters(); links();
    f.oninput = (e) => { dirty = true; counters(); if (e.target === E.body) refresh(); };
    E.lang.onchange = () => { const v = E.pair.value; E.pair.innerHTML = pairOpts(E.lang.value); if ([...E.pair.options].some((o) => o.value === v)) E.pair.value = v; };
    if (!ed) return;
    $('blTb').onclick = (e) => {
      const b = e.target.closest('[data-k]'); if (!b) return;
      const [, a, z] = TB[+b.dataset.k], t = E.body, s = t.selectionStart, en = t.selectionEnd, sel = t.value.slice(s, en);
      const pre = a.startsWith('\n') && (s === 0 || t.value[s - 1] === '\n') ? a.slice(1) : a;
      t.setRangeText(pre + sel + z, s, en, 'end'); if (!sel && z) t.selectionStart = t.selectionEnd = s + pre.length;
      t.focus(); dirty = true; refresh(); counters();
    };
    const body = (extra) => ({ title: E.title.value, slug: E.slug.value, lang: E.lang.value, description: E.description.value, tags: E.tags.value, cover: E.cover.value, pair: E.pair.value, body: E.body.value, ...extra });
    const saveIt = async (btn, extra, okText) => {
      try {
        const r = await busy(btn, () => (isNew ? post('/api/admin/blog', body(extra)) : post('/api/admin/blog/' + cur.id, body(extra), 'PATCH')));
        if (!r) return; dirty = false; toast(okText || 'Сохранено', 'ok');
        if (isNew) { location.hash = '#blog/' + r.id; return; }
        Object.assign(cur, r); editor(cur.id);
      } catch (e) { fail('blMsg')(e); }
    };
    f.onsubmit = (e) => { e.preventDefault(); saveIt($('blSave'), {}, cur.status === 'published' ? 'Сохранено — изменения уже на сайте' : 'Черновик сохранён'); };
    f.onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); f.requestSubmit(); } };
    $('blPub').onclick = async () => {
      if (cur.status === 'published') {
        if (!(await confirmBox('Снять с публикации?', 'Страница перестанет открываться и исчезнет из sitemap.xml. Текст останется черновиком.', { ok: 'Снять' }))) return;
        return saveIt($('blPub'), { status: 'draft' }, 'Снято с публикации');
      }
      if (!E.body.value.trim()) return say('blMsg', 'Добавьте текст перед публикацией', 'err');
      saveIt($('blPub'), { status: 'published' }, 'Опубликовано — страница уже на сайте');
    };
    if ($('blDel')) $('blDel').onclick = async () => {
      if (!(await confirmBox('Удалить материал?', `«${cur.title}» будет удалён навсегда. Если нужно просто скрыть его с сайта — снимите с публикации.`, { ok: 'Удалить', danger: true }))) return;
      try { await busy($('blDel'), () => post('/api/admin/blog/' + cur.id, {}, 'DELETE')); dirty = false; toast('Материал удалён', 'ok'); go('blog'); } catch (e) { fail('blMsg')(e); }
    };
  }
})();
