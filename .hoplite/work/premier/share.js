'use strict';
// Публичные ссылки «только чтение» на чат: /c/<код>.
// - В ссылку попадает снимок переписки на момент «Поделиться» (кнопка «Обновить» делает новый снимок по той же ссылке).
// - Код ссылки случайный (12 знаков base62, ~71 бит) — не ID пользователя и не ID чата, перебором не найти.
// - На странице нет данных владельца: ни логина, ни почты, ни ID. Вложения пользователя (файлы, фото) не публикуются —
//   только их количество. Картинки и видео, созданные моделью, отдаются лишь те, что есть в снимке.
// - Страница рендерится на сервере, без скриптов (CSP script-src 'none'); сайты из ответов открываются в песочнице
//   (CSP sandbox — отдельный «непрозрачный» origin, без доступа к cookie и API Premier).
// - Владелец отключает ссылку в один клик: снимок стирается сразу; удалили чат или аккаунт — ссылка тоже перестаёт работать.
// - По умолчанию страница закрыта от поисковиков (SHARE_INDEX=1 — открыть).
const growth = require('./growth');
const artifactState = require('./public/js/00-artifact-state');
const { RAW_SANDBOX } = require('./publication');

const ID_RE = /^[0-9A-Za-z]{12}$/;
const PAGE = /^\/c\/([0-9A-Za-z]{12})(?:\/(?:(a|v)\/(\d{1,3})-(\d{1,2})|f\/([a-f0-9]{16})\/([^/]{1,400})))?\/?$/;
const MAX_MSGS = 200, MAX_TEXT = 200000, MAX_DATA = 4e6;
const FILE_URL = /^\/api\/files\/([a-f0-9]{16})\/([^/?#]+)$/;
const IMG = /\.(png|jpe?g|gif|webp)$/i, VID = /\.(mp4|webm|mov)$/i;
const FRAME_SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// строки-журналы, которые клиент тоже прячет (04-render.js, LOG_RE)
const LOG_RE = /^[ \t]*\[(Действия на компьютере|Изменения в папке|Нарисованные картинки|Сделанные видео|Созданные файлы):[^\n]*\][ \t]*$/gm;
const stripLog = (t) => String(t || '').replace(LOG_RE, '').replace(/\n{3,}/g, '\n\n').trim();

const T = {
  ru: {
    ro: 'Только чтение', meta: (n, d) => `Публичная копия чата · ${n} · обновлено ${d}`, msgs: (n) => n + ' ' + plural(n, 'сообщение', 'сообщения', 'сообщений'),
    cut: (n) => `Показаны последние ${n} сообщений`, att: (n) => n + ' ' + plural(n, 'вложение', 'вложения', 'вложений') + ' — не публикуются',
    site: 'Сайт · HTML', open: 'Открыть на весь экран', code: (n) => 'Код · ' + n + ' ' + plural(n, 'строка', 'строки', 'строк'), wip: 'Сайт не был дописан до конца',
    lines: (n) => n + ' ' + plural(n, 'строка', 'строки', 'строк'), copyHint: 'код', ctaNote: 'Бесплатно · вход через Google или GitHub', more: 'Что такое Premier',
    foot: 'Это копия переписки, которой поделился её автор. Он может отключить ссылку в любой момент.', made: 'Сделано в Premier',
    nf: 'Ссылка не найдена', nfText: 'Автор отключил эту ссылку или удалил чат.', home: 'На главную', image: 'Картинка', fileGone: 'Файл недоступен',
    pageTitle: (t) => t + ' — чат в Premier', locale: 'ru-RU', siteName: 'Сайт',
  },
  en: {
    ro: 'Read-only', meta: (n, d) => `Public copy of a chat · ${n} · updated ${d}`, msgs: (n) => n + (n === 1 ? ' message' : ' messages'),
    cut: (n) => `Showing the last ${n} messages`, att: (n) => n + (n === 1 ? ' attachment' : ' attachments') + ' — not shared',
    site: 'Website · HTML', open: 'Open full screen', code: (n) => 'Code · ' + n + (n === 1 ? ' line' : ' lines'), wip: 'The website was not finished',
    lines: (n) => n + (n === 1 ? ' line' : ' lines'), copyHint: 'code', ctaNote: 'Free · sign in with Google or GitHub', more: 'What is Premier',
    foot: 'This is a copy of a conversation shared by its author. They can turn the link off at any time.', made: 'Made with Premier',
    nf: 'Link not found', nfText: 'The author turned this link off or deleted the chat.', home: 'Home page', image: 'Image', fileGone: 'File unavailable',
    pageTitle: (t) => t + ' — a Premier chat', locale: 'en-US', siteName: 'Website',
  },
};
function plural(n, a, b, c) { return n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c; }

/* ---------- снимок переписки ---------- */
function fileRef(url) {
  const m = FILE_URL.exec(String(url || '')); if (!m) return null;
  let name; try { name = decodeURIComponent(m[2]); } catch { return null; }
  if (!name || name.length > 200 || /[\\/\x00-\x1f]/.test(name) || name.startsWith('.')) return null;
  return { fid: m[1], name };
}
// что публикуем: текст вопросов и ответов, имя модели, созданные моделью картинки/видео/графики; без ошибок, обрывков и вложений
function snapshot(chat) {
  const msgs = [];
  for (const m of Array.isArray(chat && chat.msgs) ? chat.msgs : []) {
    if (!m || (m.r !== 'u' && m.r !== 'a') || m.err || m.cancelled) continue;
    const t = typeof m.t === 'string' ? (m.r === 'a' ? stripLog(m.t) : m.t).slice(0, MAX_TEXT) : '';
    const media = [];
    if (m.r === 'a') {
      const imgs = [...(Array.isArray(m.gens) ? m.gens : []), ...(Array.isArray(m.runs) ? m.runs.flatMap((r) => (r && Array.isArray(r.files) ? r.files.filter((f) => f && f.image) : [])) : [])];
      for (const g of imgs) { const f = fileRef(g && g.url); if (f && IMG.test(f.name)) media.push({ k: 'img', ...f, alt: String((g && (g.prompt || g.name)) || '').slice(0, 300) }); }
      for (const v of Array.isArray(m.vids) ? m.vids : []) { const f = fileRef(v && v.url); if (f && VID.test(f.name)) media.push({ k: 'video', ...f, alt: String((v && v.prompt) || '').slice(0, 300) }); }
    }
    const att = m.r === 'u' ? (Array.isArray(m.files) ? m.files.length : 0) + (Array.isArray(m.images) ? m.images.length : 0) : 0;
    if (!t.trim() && !media.length && !att) continue;
    const x = { r: m.r, t };
    if (m.r === 'a' && typeof m.m === 'string' && m.m.trim()) x.m = m.m.trim().slice(0, 60);
    if (media.length) x.media = media.slice(0, 12);
    if (att) x.att = Math.min(att, 99);
    msgs.push(x);
  }
  const data = { v: 1, title: String((chat && chat.title) || '').replace(/\s+/g, ' ').trim().slice(0, 120), total: msgs.length, msgs: msgs.slice(-MAX_MSGS) };
  while (data.msgs.length > 1 && JSON.stringify(data).length > MAX_DATA) data.msgs = data.msgs.slice(Math.ceil(data.msgs.length / 4)); // слишком большой — без самых старых
  return data;
}

/* ---------- markdown → безопасный HTML (всё экранируется; ссылки только http/https) ---------- */
const inline = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="nofollow ugc noopener noreferrer">$1</a>');
const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
const isRow = (l) => /^\s*\|.*\|\s*$/.test(l || '');
const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l || '');
function table(rows) {
  const al = cells(rows[1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : ''));
  const td = (tag, c, i) => `<${tag}${al[i] ? ` style="text-align:${al[i]}"` : ''}>${inline(c)}</${tag}>`;
  return `<div class="tbl"><table><thead><tr>${cells(rows[0]).map((c, i) => td('th', c, i)).join('')}</tr></thead><tbody>${rows.slice(2).map((r) => `<tr>${cells(r).map((c, i) => td('td', c, i)).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function block(t) {
  let h = '', list = null; const close = () => { if (list) { h += `</${list}>`; list = null; } };
  const lines = t.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; let m;
    if (isRow(line) && isSep(lines[i + 1])) { close(); const rows = [line, lines[i + 1]]; i += 2; while (i < lines.length && isRow(lines[i])) rows.push(lines[i++]); i--; h += table(rows); continue; }
    if (!line.trim() || /^\s*([-*]|\d+[.)])\s*$/.test(line)) { close(); continue; }
    if ((m = line.match(/^#{1,4}\s+(.*)/))) { close(); h += `<h3>${inline(m[1])}</h3>`; }
    else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (list !== 'ul') { close(); h += '<ul>'; list = 'ul'; } h += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); h += '<ol>'; list = 'ol'; } h += `<li>${inline(m[1])}</li>`; }
    else { close(); h += `<p>${inline(line)}</p>`; }
  }
  close(); return h;
}
// путь файла в заголовке блока кода (```html:site/index.html, path=…) — как в 00-artifact-state.js
function filePath(lang, info) {
  info = info.trim();
  if (lang && /^[./]/.test(info)) return lang + info.split(/\s/)[0];
  const found = info.match(/^:\s*(\S+)/) || info.match(/\b(?:path|file|filename|name|title)\s*=\s*["']?([^"'\s]+)/i) || info.match(/^([\w.\-/]+\.\w{1,8})$/);
  return found ? found[1] : null;
}
const nLines = (code) => code.replace(/\n$/, '').split('\n').length;
const codeBlock = (lang, code) => `<div class="pre"><div class="bar">${esc(lang || 'code')}</div><pre><code>${esc(code.replace(/\n$/, ''))}</code></pre></div>`;
function artCard(L, sid, mi, k, art, code) {
  const title = esc(art && art.title && art.title !== 'Сайт' ? art.title : L.siteName), done = art && art.files.every((f) => f.closed);
  return `<figure class="art"><div class="art-h"><span class="art-t"><b>${title}</b><small>${esc(L.site)}</small></span>${done ? `<a class="btn sm" href="/c/${sid}/v/${mi}-${k}" target="_blank" rel="noopener">${esc(L.open)}</a>` : ''}</div>` +
    (done ? `<iframe src="/c/${sid}/a/${mi}-${k}" title="${title}" sandbox="${FRAME_SANDBOX}" loading="lazy" referrerpolicy="no-referrer"></iframe>` : `<div class="art-wip">${esc(L.wip)}</div>`) +
    (code != null ? `<details class="code"><summary>${esc(L.code(nLines(code)))}</summary><pre><code>${esc(code.replace(/\n$/, ''))}</code></pre></details>` : '') + '</figure>';
}
function renderMd(L, src, sid, mi) {
  const arts = artifactState.extract(src), singles = arts.filter((a) => !a.pack), pack = arts.find((a) => a.pack);
  const out = [], re = /```([\w-]*)([^\n]*)\n([\s\S]*?)(```|$)/g; let last = 0, m, k = 0, packAt = -1;
  while ((m = re.exec(src))) {
    out.push(block(src.slice(last, m.index)));
    const [, lang, info, code, end] = m, fp = filePath(lang, info);
    if (fp) {
      if (packAt < 0) { packAt = out.length; out.push(''); }
      out.push(`<details class="fileb"><summary><span class="fp">${esc(fp)}</span><small>${end ? esc(L.lines(nLines(code))) : '…'}</small></summary><pre><code>${esc(code.replace(/\n$/, ''))}</code></pre></details>`);
    } else if (/^html?$/i.test(lang) || (!lang && /^\s*<(?:!doctype|html|body)\b/i.test(code))) { out.push(artCard(L, sid, mi, k, singles[k], code)); k++; }
    else out.push(codeBlock(lang, code));
    last = re.lastIndex;
  }
  out.push(block(src.slice(last).replace(/`{1,3}[\w-]*$/, '')));
  if (packAt >= 0) out[packAt] = pack ? artCard(L, sid, mi, singles.length, pack, null) : '';
  return out.join('');
}
// сайт из нескольких файлов: CSS, JS и SVG встраиваются в index.html (как в 02-markdown.js inlineSite)
function normPath(p) {
  const out = [];
  for (const seg of String(p).replace(/\\/g, '/').split('/')) { if (!seg || seg === '.') continue; if (seg === '..') out.pop(); else out.push(seg); }
  return out.join('/');
}
function artifactHtml(art) {
  if (!art.pack) return art.files[0].code;
  const files = art.files, entry = files.filter((f) => /\.html?$/i.test(f.path)).sort((a, b) => Number(/(?:^|\/)index\.html?$/i.test(b.path)) - Number(/(?:^|\/)index\.html?$/i.test(a.path)) || a.path.length - b.path.length)[0];
  if (!entry) return '';
  const dir = entry.path.replace(/[^/]*$/, '');
  const get = (ref) => (/^(https?:|data:|blob:|\/\/|#|mailto:)/i.test(ref) ? null : files.find((f) => f.path === normPath(dir + ref.split(/[?#]/)[0])));
  let h = entry.code;
  h = h.replace(/<link\b[^>]*>/gi, (tag) => { if (!/stylesheet/i.test(tag)) return tag; const f = get(tag.match(/href\s*=\s*["']([^"']+)/i)?.[1] || ''); return f ? `<style>\n${f.code.replace(/<\/style/gi, '<\\/style')}\n</style>` : tag; });
  h = h.replace(/<script\b([^>]*?)\ssrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, a, src, b) => { const f = get(src); return f ? `<script${a}${b}>\n${f.code.replace(/<\/script/gi, '<\\/script')}\n</script>` : tag; });
  h = h.replace(/(src|href)\s*=\s*["']([^"']+\.svg)["']/gi, (all, attr, ref) => { const f = get(ref); return f ? `${attr}="data:image/svg+xml;charset=utf-8,${encodeURIComponent(f.code)}"` : all; });
  return h;
}

/* ---------- страницы ---------- */
const FONT = "@font-face{font-family:Onest;font-weight:100 900;font-display:swap;src:url(/fonts/onest-cyrillic-wght-normal.woff2) format('woff2');unicode-range:U+0400-04FF}@font-face{font-family:Onest;font-weight:100 900;font-display:swap;src:url(/fonts/onest-latin-wght-normal.woff2) format('woff2');unicode-range:U+0000-00FF,U+2000-206F,U+20AC,U+2122}";
const CSS = FONT + `:root{color-scheme:light dark;--bg:#F7F4EE;--card:#FFFFFF;--card2:#EFEAE1;--line:#E2DBCF;--line2:#D2C8B7;--text:#1A1714;--muted:#6B635A;--dim:#6F655B;--accent:#E8590C;--accent-ink:#B6440A;--on-accent:#1A1714;--soft:rgba(232,89,12,.12);--code:#FBF9F5;--chip:rgba(26,23,20,.06);--barbg:rgba(247,244,238,.88)}
@media(prefers-color-scheme:dark){:root{--bg:#12110F;--card:#1B1916;--card2:#24211D;--line:#34302A;--line2:#463F37;--text:#F2EDE4;--muted:#A39A8E;--dim:#8A8176;--accent:#FF7A2F;--accent-ink:#FF9A5C;--soft:rgba(255,122,47,.15);--code:#0D0C0A;--chip:rgba(242,237,228,.07);--barbg:rgba(18,17,15,.88)}}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--text);font:16px/1.65 Onest,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent-ink)}.wrap{max-width:820px;margin:0 auto;padding:0 20px}
.bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;padding:12px 20px;background:var(--barbg);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:9px;color:var(--text);text-decoration:none;font-weight:650}.mark{width:26px;height:26px;border-radius:7px;display:block;flex:none}
.ro{font-size:12px;color:var(--muted);border:1px solid var(--line2);border-radius:99px;padding:2px 10px}.sp{flex:1}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:10px;padding:11px 18px;font-weight:600;text-decoration:none;color:var(--text);border:1px solid var(--line2);background:var(--card2);white-space:nowrap}
.btn.pri{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}.btn.sm{padding:7px 12px;font-size:14px}.btn:hover{filter:brightness(1.1)}
.head{padding:34px 0 8px}h1{font-size:28px;line-height:1.25;margin:0 0 6px;letter-spacing:-.01em;overflow-wrap:anywhere}.meta{margin:0;color:var(--dim);font-size:14px}
.cut{color:var(--dim);font-size:14px;text-align:center;margin:18px 0 0}
.thread{display:flex;flex-direction:column;gap:22px;padding:22px 0 10px}
.u{align-self:flex-end;max-width:85%}.bub{background:var(--card2);border:1px solid var(--line);border-radius:16px 16px 4px 16px;padding:10px 14px;white-space:pre-wrap;overflow-wrap:anywhere}
.att{font-size:13px;color:var(--dim);text-align:right;margin-top:4px}
.a{min-width:0}.who{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);margin-bottom:6px}.who i{font-style:normal;color:var(--dim)}.who .mark{width:20px;height:20px;border-radius:6px}
.md{overflow-wrap:anywhere}.md p{margin:0 0 10px}.md h3{font-size:17px;margin:16px 0 8px}.md ul,.md ol{margin:0 0 10px;padding-left:22px}.md code{font:13.5px/1.5 "JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;background:var(--chip);border-radius:5px;padding:1px 5px}
.pre,.fileb,.code{border:1px solid var(--line);border-radius:12px;background:var(--code);margin:0 0 12px;overflow:hidden}.pre .bar{position:static;padding:6px 12px;font-size:12px;color:var(--dim);border-bottom:1px solid var(--line);backdrop-filter:none;background:none}
pre{margin:0;padding:12px 14px;overflow:auto;max-height:520px}pre code{background:none!important;padding:0!important;white-space:pre}
details summary{cursor:pointer;padding:9px 14px;color:var(--muted);font-size:14px;list-style-position:inside}.fileb summary{display:flex;gap:10px;align-items:center}.fp{color:var(--text);font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}.fileb small{color:var(--dim)}
.tbl{overflow:auto;margin:0 0 12px}table{border-collapse:collapse;font-size:14px}th,td{border:1px solid var(--line2);padding:6px 10px}th{background:var(--card)}
.art{margin:0 0 12px;border:1px solid var(--line2);border-radius:14px;overflow:hidden;background:var(--card)}.art-h{display:flex;align-items:center;gap:12px;padding:10px 14px}.art-t{flex:1;min-width:0;display:flex;flex-direction:column}.art-t b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.art-t small{color:var(--dim);font-size:12px}
.art iframe{display:block;width:100%;height:440px;border:0;border-top:1px solid var(--line);background:#fff}.art-wip{padding:14px;color:var(--dim);border-top:1px solid var(--line)}.art .code{margin:0;border:0;border-top:1px solid var(--line);border-radius:0}
.media{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin:6px 0 0}.media img,.media video{width:100%;border-radius:12px;border:1px solid var(--line);display:block;background:var(--card2)}
.cta{margin:34px 0 26px;padding:26px 22px;border:1px solid var(--line2);border-radius:18px;background:radial-gradient(600px 220px at 50% 0,var(--soft),transparent 70%),var(--card);text-align:center}
.cta p{margin:0 auto 16px;max-width:560px;color:var(--text);font-size:17px}.cta small{display:block;margin-top:10px;color:var(--dim);font-size:13px}.cta .more{display:inline-block;margin-top:8px;font-size:14px;color:var(--muted)}
footer{border-top:1px solid var(--line);color:var(--dim);font-size:13px;padding:18px 20px 28px;text-align:center}
@media(max-width:600px){h1{font-size:23px}.u{max-width:92%}.art iframe{height:360px}.bar .ro{display:none}}`;
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src 'self'; frame-src 'self'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

function createShares({ store, coder, sendMedia, json, readBody, limited, hit, languageOf, languageHeaders, originOf, bill }) {
  const db = store.db, q = (sql) => db.prepare(sql);
  const conf = () => growth.conf().share;
  const L = (lang) => T[lang === 'en' ? 'en' : 'ru'];
  const chatAlive = (uid, cid) => !!q('SELECT 1 x FROM chats WHERE uid = ? AND cid = ? AND data IS NOT NULL').get(uid, cid);
  const revoke = (id) => q('UPDATE shares SET revoked = ?, data = NULL WHERE id = ? AND revoked IS NULL').run(Date.now(), id);
  const titleOf = (data, lang) => (data && data.title) || (lang === 'en' ? 'Chat' : 'Чат');
  const view = (r, origin) => {
    let d = null; try { d = r.data ? JSON.parse(r.data) : null; } catch {}
    return { id: r.id, cid: r.cid, url: origin + '/c/' + r.id, title: (d && d.title) || '', msgs: d ? d.msgs.length : 0, created: r.created, updated: r.updated, views: r.views };
  };
  const jsonOnly = (req) => req.headers['sec-fetch-site'] !== 'cross-site' && /^application\/json(?:;|$)/i.test(req.headers['content-type'] || '');

  // ---------- API владельца ----------
  async function api(req, res, url, user) {
    const p = url.pathname, m = req.method;
    if (!user) return json(res, 401, { error: 'Войдите в аккаунт' });
    const c = conf();
    if (!c.on) return json(res, 403, { error: 'Публичные ссылки на чаты сейчас выключены' });
    if (p === '/api/share' && m === 'GET') {
      const cid = url.searchParams.get('cid');
      if (cid != null) { const r = q('SELECT * FROM shares WHERE uid = ? AND cid = ? AND revoked IS NULL').get(user.id, String(cid).slice(0, 64)); return json(res, 200, { share: r ? view(r, originOf(req)) : null }); }
      const list = q('SELECT * FROM shares WHERE uid = ? AND revoked IS NULL ORDER BY updated DESC').all(user.id).map((r) => view(r, originOf(req)));
      return json(res, 200, { shares: list, max: c.max });
    }
    if (p === '/api/share' && m === 'POST') {
      if (!jsonOnly(req)) return json(res, 400, { error: 'Отправьте JSON-запрос с сайта' });
      const key = 'share:' + user.id;
      if (limited(key, c.rate, 3600e3)) return json(res, 429, { error: 'Слишком много ссылок за час — попробуйте позже' });
      const b = await readBody(req, 4000).catch(() => null);
      const cid = b && typeof b.cid === 'string' ? b.cid : '';
      if (!cid || cid.length > 64) return json(res, 400, { error: 'Не указан чат' });
      const row = q('SELECT data FROM chats WHERE uid = ? AND cid = ? AND data IS NOT NULL').get(user.id, cid);
      if (!row) return json(res, 404, { error: 'Чат не найден — подождите пару секунд, пока он сохранится, и попробуйте снова' });
      let chat = null; try { chat = JSON.parse(row.data); } catch {}
      const snap = snapshot(chat);
      if (!snap.msgs.length) return json(res, 400, { error: 'В чате пока нет сообщений' });
      hit(key);
      const now = Date.now(), data = JSON.stringify(snap);
      let r = q('SELECT id FROM shares WHERE uid = ? AND cid = ? AND revoked IS NULL').get(user.id, cid);
      if (r) q('UPDATE shares SET data = ?, updated = ? WHERE id = ?').run(data, now, r.id);
      else {
        if (q('SELECT COUNT(*) c FROM shares WHERE uid = ? AND revoked IS NULL').get(user.id).c >= c.max) return json(res, 409, { error: 'Слишком много публичных ссылок — отключите ненужные' });
        for (let i = 0; i < 5 && !r; i++) {
          const id = growth.token(12);
          try { q('INSERT INTO shares (id, uid, cid, data, created, updated, views) VALUES (?, ?, ?, ?, ?, ?, 0)').run(id, user.id, cid, data, now, now); r = { id }; }
          catch { r = q('SELECT id FROM shares WHERE uid = ? AND cid = ? AND revoked IS NULL').get(user.id, cid) || null; } // параллельный запрос уже создал
        }
        if (!r) throw new Error('Не удалось создать ссылку — попробуйте ещё раз');
      }
      return json(res, 200, { share: view(q('SELECT * FROM shares WHERE id = ?').get(r.id), originOf(req)) });
    }
    const dm = /^\/api\/share\/([0-9A-Za-z]{12})$/.exec(p);
    if (dm && m === 'DELETE') {
      // только владелец; чужая или несуществующая ссылка — одинаковый ответ (нельзя проверить, существует ли код)
      const r = q('SELECT uid FROM shares WHERE id = ? AND revoked IS NULL').get(dm[1]);
      if (!r || r.uid !== user.id) return json(res, 404, { error: 'Ссылка не найдена' });
      revoke(dm[1]); return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'Not found' });
  }

  // ---------- публичные страницы ----------
  const match = (pathname) => pathname === '/c' || pathname.startsWith('/c/');
  function live(id) {
    if (!conf().on || !ID_RE.test(id)) return null;
    const r = q('SELECT * FROM shares WHERE id = ? AND revoked IS NULL AND data IS NOT NULL').get(id); if (!r) return null;
    const owner = store.users.get(r.uid); if (!owner || owner.banned) return null;
    if (!chatAlive(r.uid, r.cid)) { revoke(id); return null; } // чат удалён — ссылка гаснет навсегда
    let data = null; try { data = JSON.parse(r.data); } catch {}
    return data && Array.isArray(data.msgs) ? { r, data, owner } : null;
  }
  function send(req, res, code, html, extra = {}) {
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PAGE_CSP, 'Permissions-Policy': 'fullscreen=()', ...extra });
    res.end(req.method === 'HEAD' ? undefined : html);
  }
  function ctaHref(owner) {
    const c = conf(); if (!c.ref) return '/login';
    try { const rf = bill.refInfo(owner); return rf && rf.on && rf.code ? '/login?ref=' + encodeURIComponent(rf.code) : '/login'; } catch { return '/login'; }
  }
  function notFound(req, res, lang) {
    const l = L(lang), tx = growth.texts(lang);
    send(req, res, 404, `<!doctype html><html lang="${lang === 'en' ? 'en' : 'ru'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(l.nf)} — Premier</title><link rel="icon" type="image/svg+xml" href="/icon-p-amber.svg"><style>${CSS}</style></head>
<body><header class="bar"><a class="brand" href="/"><img class="mark" src="/icon-p-amber.svg" alt="">Premier</a></header><main class="wrap"><div class="head"><h1>${esc(l.nf)}</h1><p class="meta">${esc(l.nfText)}</p></div>
<section class="cta"><p>${esc(tx.shareTagline)}</p><a class="btn pri" href="/login">${esc(tx.shareCta)}</a><small>${esc(l.ctaNote)}</small></section></main></body></html>`);
  }
  function page(req, res, s, lang) {
    const { r, data, owner } = s, l = L(lang), tx = growth.texts(lang), origin = originOf(req), sid = r.id, en = lang === 'en';
    const title = titleOf(data, lang), cta = ctaHref(owner), index = conf().index;
    const date = new Date(r.updated).toLocaleDateString(l.locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow' });
    const thread = data.msgs.map((m, mi) => {
      if (m.r === 'u') return `<div class="u">${m.t ? `<div class="bub">${esc(m.t)}</div>` : ''}${m.att ? `<div class="att">📎 ${esc(l.att(m.att))}</div>` : ''}</div>`;
      const media = (m.media || []).map((f) => {
        const src = `/c/${sid}/f/${f.fid}/${encodeURIComponent(f.name)}`;
        return f.k === 'video' ? `<video src="${esc(src)}" controls playsinline preload="metadata" title="${esc(f.alt)}"></video>` : `<img src="${esc(src)}" alt="${esc(f.alt || l.image)}" loading="lazy">`;
      }).join('');
      return `<div class="a"><div class="who"><img class="mark" src="/icon-p-amber.svg" alt="">Premier${m.m ? ` <i>· ${esc(m.m)}</i>` : ''}</div><div class="md">${renderMd(l, m.t || '', sid, mi)}</div>${media ? `<div class="media">${media}</div>` : ''}</div>`;
    }).join('\n');
    const shown = data.msgs.length, total = Math.max(shown, Number(data.total) || 0);
    const html = `<!doctype html>
<html lang="${en ? 'en' : 'ru'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(l.pageTitle(title))}</title>
<meta name="description" content="${esc(tx.shareTagline)}">
<meta name="robots" content="${index ? 'index, follow' : 'noindex, nofollow'}">
<meta name="referrer" content="no-referrer">
<link rel="icon" type="image/svg+xml" href="/icon-p-amber.svg"><link rel="icon" type="image/png" href="/icon-p-2.png">
<meta property="og:type" content="article"><meta property="og:site_name" content="Premier"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(tx.shareTagline)}">
<meta property="og:url" content="${esc(origin + '/c/' + sid)}"><meta property="og:image" content="${esc(origin + (en ? '/og-en.png' : '/og.png'))}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(tx.shareTagline)}"><meta name="twitter:image" content="${esc(origin + (en ? '/og-en.png' : '/og.png'))}">
<style>${CSS}</style></head>
<body>
<header class="bar"><a class="brand" href="/"><img class="mark" src="/icon-p-amber.svg" alt="">Premier</a><span class="ro">${esc(l.ro)}</span><span class="sp"></span><a class="btn pri sm" href="${esc(cta)}">${esc(tx.shareCta)}</a></header>
<main class="wrap">
<div class="head"><h1>${esc(title)}</h1><p class="meta">${esc(l.meta(l.msgs(total), date))}</p></div>
${total > shown ? `<p class="cut">${esc(l.cut(shown))}</p>` : ''}
<div class="thread">
${thread}
</div>
<section class="cta"><p>${esc(tx.shareTagline)}</p><a class="btn pri" href="${esc(cta)}">${esc(tx.shareCta)}</a><small>${esc(l.ctaNote)}</small><a class="more" href="/">${esc(l.more)} →</a></section>
</main>
<footer>${esc(l.foot)}</footer>
</body></html>`;
    if (req.method === 'GET') q('UPDATE shares SET views = views + 1 WHERE id = ?').run(sid);
    send(req, res, 200, html, index ? {} : { 'X-Robots-Tag': 'noindex, nofollow' });
  }
  // полноэкранный просмотр сайта: только статичная разметка, сам сайт — в iframe-песочнице
  function wrapper(req, res, s, key, art, lang) {
    const l = L(lang), tx = growth.texts(lang), title = esc(art.title && art.title !== 'Сайт' ? art.title : l.siteName), sid = s.r.id;
    send(req, res, 200, `<!doctype html>
<html lang="${lang === 'en' ? 'en' : 'ru'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex, nofollow"><title>${title} — Premier</title>
<style>:root{color-scheme:dark}*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden}body{height:100dvh;display:grid;grid-template-rows:minmax(0,1fr) auto;background:#12110F;color:#F2EDE4;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}iframe{display:block;width:100%;height:100%;border:0;background:#fff}footer{display:flex;gap:14px;justify-content:center;align-items:center;flex-wrap:wrap;padding:10px 16px calc(10px + env(safe-area-inset-bottom));border-top:1px solid #34302A;background:#1A1714}a{color:#A39A8E;text-decoration:none}a:hover{color:#F2EDE4}a.go{color:#1A1714;background:#FF7A2F;border-radius:8px;padding:5px 12px;font-weight:600}</style></head>
<body><main><iframe src="/c/${sid}/a/${key}" title="${title}" sandbox="${FRAME_SANDBOX}" referrerpolicy="no-referrer"></iframe></main>
<footer><a href="/c/${sid}">← ${esc(titleOf(s.data, lang))}</a><span>${esc(l.made)}</span><a class="go" href="${esc(ctaHref(s.owner))}">${esc(tx.shareCta)}</a></footer></body></html>`, { 'X-Robots-Tag': 'noindex, nofollow' });
  }
  async function serve(req, res, url) {
    res.setHeader('Cache-Control', 'no-store'); // отключённая ссылка перестаёт открываться сразу
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return true; }
    const lang = languageHeaders(req, res), mm = PAGE.exec(url.pathname), s = mm && live(mm[1]);
    if (!s) { notFound(req, res, lang); return true; }
    if (!mm[2] && !mm[5]) { page(req, res, s, lang); return true; }
    if (mm[5]) { // файл из снимка (картинка/видео модели); всё остальное — 404
      let name = ''; try { name = decodeURIComponent(mm[6]); } catch {}
      const f = s.data.msgs.some((m) => (m.media || []).some((x) => x.fid === mm[5] && x.name === name));
      const fp = f && coder.filePath(s.r.uid, mm[5], name);
      if (!fp) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex' }); res.end(req.method === 'HEAD' ? undefined : 'Not found'); return true; }
      res.setHeader('X-Robots-Tag', 'noindex');
      sendMedia(req, res, fp, name, url.searchParams.get('dl') === '1'); return true;
    }
    const mi = Number(mm[3]), k = Number(mm[4]), msg = s.data.msgs[mi];
    const art = msg && msg.r === 'a' ? artifactState.extract(msg.t || '')[k] : null;
    if (!art || !art.files.every((f) => f.closed)) { notFound(req, res, lang); return true; }
    if (mm[2] === 'v') { wrapper(req, res, s, mi + '-' + k, art, lang); return true; }
    // сам сайт открывается только внутри страницы Premier; прямой переход — на полноэкранную обёртку
    const dest = req.headers['sec-fetch-dest'];
    if (dest && dest !== 'iframe') { res.writeHead(302, { Location: `/c/${s.r.id}/v/${mi}-${k}`, Vary: 'Sec-Fetch-Dest' }); res.end(); return true; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': RAW_SANDBOX + "; frame-ancestors 'self'", 'X-Robots-Tag': 'noindex, nofollow', Vary: 'Sec-Fetch-Dest' });
    res.end(req.method === 'HEAD' ? undefined : artifactHtml(art)); return true;
  }
  return { api, match, serve };
}

module.exports = { createShares, snapshot, renderMd, artifactHtml, ID_RE };
