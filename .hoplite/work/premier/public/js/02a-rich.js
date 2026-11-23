// Premier — клиент: оформление ответов. Один файл для русской и английской версии (язык — по <html lang>).
// Подсветка кода (highlight.js) и формулы (KaTeX) лежат в /vendor и загружаются только тогда,
// когда в чате появился код или формула. Пока библиотека не загрузилась, показываем простой текст.
// Ещё здесь: кнопка «Вниз», время и длительность ответа.
const RICH_EN = document.documentElement.lang === 'en';

/* ---------- ленивая загрузка библиотек ---------- */
const RICH_LIBS = {};
function richLoad(name, js, css) {
  if (RICH_LIBS[name]) return;
  RICH_LIBS[name] = 'loading';
  if (css) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = css; document.head.appendChild(l); }
  const s = document.createElement('script'); s.src = js; s.async = true;
  s.onload = () => { RICH_LIBS[name] = 'ready'; RICH_CACHE.clear(); richRepaint(); };
  s.onerror = () => { RICH_LIBS[name] = 'failed'; };
  document.head.appendChild(s);
}
// После загрузки библиотеки перерисовываем чат один раз (не чаще раза за кадр).
let richQueued = false;
function richRepaint() {
  if (richQueued) return; richQueued = true;
  requestAnimationFrame(() => { richQueued = false; try { if (typeof renderChat === 'function') renderChat(); } catch {} });
}
// Кэш готового HTML: во время печати ответ перерисовывается каждый кадр, а готовые блоки не меняются.
const RICH_CACHE = new Map();
function richCached(key, make) {
  let v = RICH_CACHE.get(key);
  if (v === undefined) { v = make(); if (RICH_CACHE.size > 400) RICH_CACHE.delete(RICH_CACHE.keys().next().value); RICH_CACHE.set(key, v); }
  return v;
}

/* ---------- код: подсветка и номера строк ---------- */
const HL_ALIAS = { js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', python3: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', yml: 'yaml', htm: 'xml', html: 'xml', svg: 'xml', vue: 'xml', 'c++': 'cpp', 'c#': 'csharp', cs: 'csharp', rb: 'ruby', rs: 'rust', kt: 'kotlin', golang: 'go', md: 'markdown', toml: 'ini', jsonc: 'json', json5: 'json' };
const HL_EXT = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', sh: 'bash', css: 'css', scss: 'scss', less: 'less', html: 'xml', htm: 'xml', svg: 'xml', xml: 'xml', json: 'json', yml: 'yaml', yaml: 'yaml', md: 'markdown', sql: 'sql', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', php: 'php', rb: 'ruby', swift: 'swift', lua: 'lua', ini: 'ini', toml: 'ini' };
const HL_MAX = 60000; // очень длинный код не подсвечиваем — это заметно тормозит печать
// Разбивает подсвеченный HTML на строки так, чтобы теги <span> не пересекали границу строки.
function richLines(html) {
  const stack = []; let out = '<span class="cv-l">', last = 0, m;
  const re = /<span [^>]*>|<\/span>|\n/g;
  while ((m = re.exec(html))) {
    out += html.slice(last, m.index); last = re.lastIndex;
    if (m[0] === '\n') out += '</span>'.repeat(stack.length) + '\n</span><span class="cv-l">' + stack.join('');
    else if (m[0] === '</span>') { stack.pop(); out += m[0]; }
    else { stack.push(m[0]); out += m[0]; }
  }
  return out + html.slice(last) + '</span>'.repeat(stack.length) + '</span>';
}
// Возвращает готовый тег <code> для блока кода. lang — язык из ```lang, path — имя файла (если есть).
function codeTag(code, lang, path) {
  let name = String(lang || '').toLowerCase();
  if (!name && path) name = HL_EXT[(String(path).match(/\.(\w+)$/) || [])[1]?.toLowerCase()] || '';
  name = HL_ALIAS[name] || name;
  const n = code.split('\n').length;
  const known = !!name && name !== 'text' && name !== 'plaintext' && name !== 'txt';
  if (known && !window.hljs && code.length <= HL_MAX) richLoad('hljs', '/vendor/hljs/highlight.min.js');
  const ready = known && window.hljs && window.hljs.getLanguage(name) && code.length <= HL_MAX;
  const inner = richCached((ready ? name : '') + '\u0001' + code, () => {
    let h = esc(code);
    if (ready) { try { h = window.hljs.highlight(code, { language: name, ignoreIllegals: true }).value; } catch {} }
    return n > 2 ? richLines(h) : h;
  });
  return `<code class="cv-code${ready ? ' hljs' : ''}${n > 2 ? ' cv-ln' : ''}">${inner}</code>`;
}

/* ---------- формулы ---------- */
function mathHtml(tex, display) {
  tex = String(tex).trim();
  if (!tex) return '';
  if (!window.katex) {
    richLoad('katex', '/vendor/katex/katex.min.js', '/vendor/katex/katex.min.css');
    return `<span class="cv-math-src${display ? ' block' : ''}">${esc(display ? '$$' + tex + '$$' : '$' + tex + '$')}</span>`;
  }
  return richCached((display ? 'D' : 'I') + '\u0002' + tex, () => {
    try { return window.katex.renderToString(tex, { displayMode: !!display, throwOnError: false, strict: 'ignore', trust: false, maxSize: 40, maxExpand: 500, output: 'htmlAndMathml' }); }
    catch { return `<span class="cv-math-src">${esc(tex)}</span>`; }
  });
}

/* ---------- ссылка на файл облачного компьютера ---------- */
function cloudLink(p, label) {
  const un = (x) => String(x).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  let path = un(p).trim(); try { path = decodeURIComponent(path); } catch {}
  if (/^home\/premier/.test(path)) path = '/' + path;
  const name = path.split('/').filter(Boolean).pop() || path;
  return `<a class="cldl" href="/api/cloud/file?path=${encodeURIComponent(path)}" download="${esc(name)}" title="${esc(path)}">${label != null ? label : esc(name)}</a>`;
}

// Файлы, которые модель сделала в облачном компьютере за этот ответ (m.cfiles приходит от сервера в конце ответа):
// видео и звук можно включить сразу, картинку — посмотреть, любой файл — скачать одним нажатием, без похода в меню «Компьютер».
function cloudFilesHtml(m) {
  const list = m.cfiles?.files || [], dirs = m.cfiles?.dirs || []; if (!list.length && !dirs.length) return '';
  const T = RICH_EN ? { dl: 'download', proj: (n) => `project · ${n} file${n === 1 ? '' : 's'}`, zip: 'download ZIP', more: (n) => `${n} more file${n === 1 ? '' : 's'} — see Computer → Files`, cap: 'Files from the cloud computer' } : { dl: 'скачать', proj: (n) => `проект · файлов: ${n}`, zip: 'скачать ZIP', more: (n) => `Ещё файлов: ${n} — они в меню «Компьютер» → «Файлы»`, cap: 'Файлы из облачного компьютера' };
  const size = (n) => (typeof fmtB === 'function' ? fmtB(n) : Math.ceil(n / 1024) + ' KB');
  const url = (f) => '/api/cloud/file?path=' + encodeURIComponent(f.path);
  const card = (f) => `<a class="ofile cldl" href="${url(f)}" download="${esc(f.name)}" title="${esc(f.path)}"><span class="art-ic"><svg><use href="#i-${f.kind === 'video' ? 'video' : 'file'}"/></svg></span><span style="min-width:0"><b>${esc(f.name)}</b><small>${size(f.size)} · ${T.dl}</small></span></a>`;
  const media = list.filter((f) => f.view && f.kind !== 'image').map((f) => f.kind === 'video'
    ? `<figure class="gen vid"><video src="${url(f)}&inline=1" controls playsinline preload="metadata" title="${esc(f.name)}"></video></figure>`
    : `<audio src="${url(f)}&inline=1" controls preload="none" title="${esc(f.name)}"></audio>`).join('');
  const pics = list.filter((f) => f.view && f.kind === 'image').map((f) => `<div class="imgw"><img src="${url(f)}&inline=1" alt="${esc(f.name)}" data-zoom loading="lazy"><a class="cldl" href="${url(f)}" download="${esc(f.name)}">${esc(f.name)} · ${T.dl}</a></div>`).join('');
  const cards = list.filter((f) => !(f.view && f.kind === 'image')).map(card).join('');
  // папка, в которой модель за этот ответ собрала проект, — одним архивом (без node_modules и venv)
  const projs = dirs.map((d) => `<a class="ofile clzip" href="/api/cloud/zip?path=${encodeURIComponent(d.path)}" download="${esc(d.name)}.zip" title="${esc(d.path)}"><span class="art-ic"><svg><use href="#i-zip"/></svg></span><span style="min-width:0"><b>${esc(d.name)}</b><small>${T.proj(d.files)} · ${size(d.size)} · ${T.zip}</small></span></a>`).join('');
  return `<div class="outs cfs" role="group" aria-label="${T.cap}">${media}${pics}${projs}${cards}${m.cfiles.more ? `<small class="cfs-more">${T.more(m.cfiles.more)}</small>` : ''}</div>`;
}

/* ---------- строка текста: код, формулы, жирный, курсив, зачёркнутый, ссылки ---------- */
function mdInline(t) {
  const keep = [];
  const put = (h) => '\u0000' + (keep.push(h) - 1) + '\u0000';
  t = String(t).replace(/\u0000/g, '');
  t = t.replace(/`([^`]+)`/g, (_, c) => put('<code>' + esc(c) + '</code>'));
  t = t.replace(/\\\$/g, () => put('$')); // \$ — обычный знак доллара
  t = t.replace(/\\\((.+?)\\\)/g, (_, x) => put(mathHtml(x, false)));
  t = t.replace(/\$\$([^$]+?)\$\$/g, (_, x) => put(mathHtml(x, true)));
  // $…$ — как в Pandoc: после открывающего и перед закрывающим знаком нет пробела, после закрывающего нет цифры.
  // Поэтому «$5 и $10» остаётся текстом.
  t = t.replace(/(^|[^\\$\w])\$(?=[^\s$])([^$\n]*?[^\s\\$])\$(?![\w$])/g, (_, a, x) => a + put(mathHtml(x, false)));
  t = t.replace(/(^|[^\\$\w])\$([^\s$\d])\$(?![\w$])/g, (_, a, x) => a + put(mathHtml(x, false)));
  let h = esc(t);
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, a, u) => put(`<a href="${u}" target="_blank" rel="noopener">${a}</a>`));
  // файл в облачном компьютере: модели пишут [видео](computer:///home/premier/x.mp4) или sandbox:/home/premier/x —
  // такую ссылку браузер не открывает, поэтому превращаем её в скачивание через /api/cloud/file
  h = h.replace(/\[([^\]]+)\]\(\s*(?:&lt;)?(?:computer|sandbox|file):\/{0,3}((?:~|home\/premier)(?:\/[^)\n]*?)?)(?:&gt;)?\s*\)/g, (_, a, p) => put(cloudLink(p, a.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>"))));
  h = h.replace(/(^|[\s(«"])(?:computer|sandbox):\/{0,3}((?:~|home\/premier)\/[^\s<)»"]*[^\s<)»".,;:!?])/g, (_, pre, p) => pre + put(cloudLink(p)));
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  h = h.replace(/(^|[^*\w])\*([^*\s](?:[^*]*[^*\s])?)\*(?![*\w])/g, '$1<em>$2</em>');
  h = h.replace(/(^|[^_\w])_([^_\s](?:[^_]*[^_\s])?)_(?![_\w])/g, '$1<em>$2</em>');
  h = h.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  for (let i = 0; i < 3 && h.includes('\u0000'); i++) h = h.replace(/\u0000(\d+)\u0000/g, (_, k) => keep[+k] ?? '');
  return h;
}

/* ---------- время и длительность ответа ---------- */
function richDur(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return RICH_EN ? s + 's' : s + ' с';
  const m = Math.floor(s / 60), r = s % 60;
  return RICH_EN ? m + 'm ' + String(r).padStart(2, '0') + 's' : m + ' мин ' + String(r).padStart(2, '0') + ' с';
}
function metaHtml(m) {
  if (!m || !m.sentAt || m.live) return '';
  const d = new Date(m.sentAt), now = new Date(), loc = RICH_EN ? 'en-GB' : 'ru-RU';
  const time = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  const day = d.toDateString() === now.toDateString() ? '' : d.toLocaleDateString(loc, { day: 'numeric', month: 'short' }) + ', ';
  const full = d.toLocaleString(loc, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const dur = m.dur > 0 ? richDur(m.dur) : '';
  const tip = [full, m.m || '', dur ? (RICH_EN ? 'answered in ' : 'ответ за ') + dur : ''].filter(Boolean).join(' · ');
  return `<span class="cv-meta" title="${esc(tip)}">${esc(day + time)}${dur ? ' · ' + esc(dur) : ''}</span>`;
}

/* ---------- кнопка «Вниз» ---------- */
(function richDown() {
  const chat = document.getElementById('chat'), dock = document.querySelector('.dock');
  if (!chat || !dock) return;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'cv-down'; b.hidden = true;
  b.setAttribute('aria-label', RICH_EN ? 'Scroll to the latest message' : 'К последнему сообщению');
  b.title = RICH_EN ? 'Scroll down' : 'Вниз';
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  dock.prepend(b);
  const far = () => chat.scrollHeight - chat.scrollTop - chat.clientHeight > 240;
  let q = false;
  const upd = () => { if (q) return; q = true; requestAnimationFrame(() => { q = false; const on = far() && !document.querySelector('.main.empty'); if (b.hidden === on) b.hidden = !on; }); };
  chat.addEventListener('scroll', upd, { passive: true });
  new ResizeObserver(upd).observe(document.getElementById('col') || chat);
  addEventListener('resize', upd);
  b.addEventListener('click', () => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    chat.scrollTo({ top: chat.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  });
})();

// Скачивание файла облачного компьютера по ссылке или карточке из ответа. Сначала короткая проверка (первый байт файла):
// при ошибке (файла нет, тариф закончился) человек видит понятное сообщение, а не скачанный JSON с ошибкой.
// Дальше файл качает сам браузер — большое видео не грузится в память страницы и видно в загрузках.
document.addEventListener?.('click', async (e) => {
  const a = e.target.closest && e.target.closest('a.cldl, a.clzip'); if (!a) return;
  const zip = a.classList.contains('clzip'); // папка архивом: сервер сначала проверяет размер, потом отдаёт поток
  e.preventDefault();
  if (a.dataset.busy) return; a.dataset.busy = '1';
  const say = (t) => (typeof toast === 'function' ? toast(t) : alert(t));
  const go = (href) => { const l = document.createElement('a'); l.href = href; l.download = a.getAttribute('download') || 'file'; l.hidden = true; document.body.appendChild(l); l.click(); l.remove(); };
  try {
    if (zip) {
      const c = await fetch(a.getAttribute('href') + '&check=1', { credentials: 'same-origin' }), j = await c.json().catch(() => ({}));
      if (!c.ok) throw new Error(j.error || (RICH_EN ? 'Error ' : 'Ошибка ') + c.status);
      go(a.getAttribute('href')); return;
    }
    const r = await fetch(a.getAttribute('href'), { credentials: 'same-origin', headers: { Range: 'bytes=0-0' } });
    if (r.status === 206 || r.status === 416) { try { await r.body?.cancel(); } catch {} go(a.getAttribute('href')); return; }
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || (RICH_EN ? 'Error ' : 'Ошибка ') + r.status); }
    // сервер отдал файл целиком (старый путь, до 25 МБ) — сохраняем уже полученное
    const url = URL.createObjectURL(await r.blob()); go(url);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (er) { say((RICH_EN ? (zip ? 'Could not download the folder: ' : 'Could not download the file: ') : (zip ? 'Не удалось скачать папку: ' : 'Не удалось скачать файл: ')) + er.message); }
  finally { delete a.dataset.busy; }
});
