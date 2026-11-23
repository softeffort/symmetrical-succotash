'use strict';
// Гайды и блог: статьи на русском и английском. Пишутся в Панели (Контент → «Гайды и блог») в Markdown,
// сырой HTML в тексте не допускается — всё экранируется. Публичные страницы рендерятся на сервере:
//   /blog            — список (язык — как у сайта: ?lang=en или кука; ?tag=… — по метке, ?page=N — страницы)
//   /blog/<адрес>    — статья (title/description/canonical/hreflang/OG/JSON-LD BlogPosting + хлебные крошки)
//   /blog/rss.xml    — RSS (?lang=en — английская лента)
// Черновик виден только по ссылке предпросмотра из Панели (/blog/<адрес>?preview=<ключ>, noindex).
// Опубликованные статьи попадают в sitemap.xml (seo.sitemap получает их через sitemapEntries).
const crypto = require('crypto');
const store = require('./db');

const fresh = !store.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'blog_posts'").get();
store.db.exec(`
  CREATE TABLE IF NOT EXISTS blog_posts (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, lang TEXT NOT NULL, title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', cover TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft', pair TEXT NOT NULL DEFAULT '', key TEXT NOT NULL, author TEXT NOT NULL DEFAULT '',
    views INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL, published INTEGER);
  CREATE INDEX IF NOT EXISTS blog_posts_pub ON blog_posts (status, lang, published);
`);
const P = new Map(); const q = (sql) => { let s = P.get(sql); if (!s) { s = store.db.prepare(sql); P.set(sql, s); } return s; };
const fail = (status, msg) => Object.assign(new Error(msg), { status });

const LIMITS = { title: 140, description: 300, body: 100000, cover: 500, tags: 8, tag: 30, slug: 80 };
const PER_PAGE = 12;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|vkshare|telegram|whatsapp|curl|wget|python|headless/i;

/* ---------- утилиты ---------- */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const unesc = (s) => String(s).replace(/&(amp|lt|gt|quot|#39);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[k]));
const ldJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's',
  т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const slugify = (s) => String(s || '').toLowerCase().replace(/[а-яё]/g, (c) => TR[c] ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, LIMITS.slug).replace(/-+$/, '');
// ссылки и картинки: только http(s), адреса сайта (/…), якоря и почта — никакого javascript:/data:
function safeUrl(u) {
  u = String(u || '').trim();
  if (/^https?:\/\/[^\s"'<>]+$/i.test(u) || /^\/(?!\/)[^\s"'<>]*$/.test(u) || /^#[\w-]+$/.test(u) || /^mailto:[^\s"'<>@]+@[^\s"'<>]+$/i.test(u)) return u;
  return '';
}
const tagsOf = (p) => { try { const a = JSON.parse(p.tags || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const words = (s) => (String(s).match(/[\p{L}\p{N}]+/gu) || []).length;
const readMin = (n) => Math.max(1, Math.round(n / 180));
const plain = (md) => String(md || '').replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)]|\|)\s*/gm, '').replace(/[*_`~|]/g, '').replace(/\s+/g, ' ').trim();
const autoDesc = (p) => p.description || (() => { const t = plain(p.body); return t.length > 180 ? t.slice(0, 177).replace(/\s+\S*$/, '') + '…' : t; })();

/* ---------- Markdown → безопасный HTML ---------- */
// Поддерживается: # ## ### ####, абзацы, **жирный**, *курсив*, ~~зачёркнутый~~, `код`, ```блоки кода```, [ссылки](url),
// ![картинки](url), списки (- и 1.), цитаты >, таблицы | a | b |, линия ---. Вложенные списки выравниваются в один уровень.
function inline(s) {
  const codes = [];
  s = String(s).replace(/`([^`\n]+)`/g, (m, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => { const u = safeUrl(unesc(url)); return u && !u.startsWith('mailto:') ? `<img src="${esc(u)}" alt="${alt}" loading="lazy">` : alt; });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, url) => { const u = safeUrl(unesc(url)); if (!u) return t; return `<a href="${esc(u)}"${/^https?:/i.test(u) ? ' target="_blank" rel="noopener"' : ''}>${t}</a>`; });
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*\w])\*([^*\n]+?)\*(?![*\w])/g, '$1<em>$2</em>').replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');
  s = s.replace(/ {2,}\n|\\\n/g, '<br>').replace(/\n/g, ' ');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${esc(codes[+i])}</code>`);
}
const LIST = /^\s*([-*+]|\d{1,3}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const cells = (ln) => ln.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
function render(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [], toc = [], used = new Set();
  const uid = (t) => { const b = slugify(plain(t)) || 'section'; let id = b, n = 2; while (used.has(id)) id = b + '-' + n++; used.add(id); return id; };
  let para = [], i = 0;
  const flush = () => { if (para.length) { out.push('<p>' + inline(para.join('\n')) + '</p>'); para = []; } };
  while (i < lines.length) {
    const ln = lines[i]; let m;
    if (/^\s*```/.test(ln)) {
      flush(); const lang = ln.replace(/^\s*```/, '').trim().replace(/[^\w+#-]/g, '').slice(0, 20), buf = []; i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++; out.push(`<pre><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(buf.join('\n'))}</code></pre>`); continue;
    }
    if ((m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(ln))) {
      flush(); const lvl = Math.min(4, Math.max(2, m[1].length)), id = uid(m[2]);
      if (lvl === 2) toc.push({ id, text: plain(m[2]) });
      out.push(`<h${lvl} id="${id}">${inline(m[2])}</h${lvl}>`); i++; continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(ln)) { flush(); out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(ln)) {
      flush(); const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      const ps = buf.join('\n').split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
      out.push('<blockquote>' + ps.map((x) => '<p>' + inline(x) + '</p>').join('') + '</blockquote>'); continue;
    }
    if ((m = LIST.exec(ln))) {
      flush(); const ordered = /\d/.test(m[1]), start = ordered ? parseInt(m[1], 10) : 1, items = [];
      while (i < lines.length) {
        const x = LIST.exec(lines[i]);
        if (x && /\d/.test(x[1]) === ordered) { items.push(x[2]); i++; continue; }
        if (x && items.length) { items.push(x[2]); i++; continue; } // вложенный список другого типа — тем же уровнем
        if (items.length && /^\s{2,}\S/.test(lines[i])) { items[items.length - 1] += '\n' + lines[i].trim(); i++; continue; }
        break;
      }
      const li = items.map((t) => { const c = /^\[([ xX])\]\s+/.exec(t); return c ? `<li class="task${c[1] === ' ' ? '' : ' done'}">${inline(t.slice(c[0].length))}</li>` : `<li>${inline(t)}</li>`; }).join('');
      out.push(ordered ? `<ol${start > 1 ? ` start="${start}"` : ''}>${li}</ol>` : `<ul>${li}</ul>`); continue;
    }
    if (/\|/.test(ln) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && /\|/.test(lines[i + 1])) {
      flush(); const head = cells(ln), al = cells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''));
      i += 2; const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(cells(lines[i++]));
      const td = (tag, c, k) => `<${tag}${al[k] ? ` style="text-align:${al[k]}"` : ''}>${inline(c)}</${tag}>`;
      out.push(`<div class="table"><table><thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((h, k) => td('td', r[k] || '', k)).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (!ln.trim()) { flush(); i++; continue; }
    para.push(ln.replace(/^\s+/, '')); i++;
  }
  flush();
  const n = words(plain(src));
  return { html: out.join('\n'), toc, words: n, minutes: readMin(n) };
}

/* ---------- данные ---------- */
const newId = () => crypto.randomBytes(8).toString('hex');
const newKey = () => crypto.randomBytes(12).toString('base64url');
const get = (id) => (id && /^[a-f0-9]{6,32}$/.test(id) ? q('SELECT * FROM blog_posts WHERE id = ?').get(String(id)) || null : null);
const bySlug = (slug) => (slug && SLUG_RE.test(slug) ? q('SELECT * FROM blog_posts WHERE slug = ?').get(String(slug)) || null : null);
const isPub = (p) => !!p && p.status === 'published';
const pairOf = (p) => { const x = p && p.pair ? get(p.pair) : null; return x && x.lang !== p.lang ? x : null; };

function normTags(v) {
  const a = Array.isArray(v) ? v : String(v == null ? '' : v).split(',');
  const out = [], seen = new Set();
  for (const t of a) { const c = clean(t, LIMITS.tag).replace(/[<>"]/g, ''); if (c && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); out.push(c); } if (out.length >= LIMITS.tags) break; }
  return out;
}

function save(id, b, author) {
  b = b || {};
  const old = id ? get(id) : null;
  if (id && !old) throw fail(404, 'Материал не найден');
  const p = old ? { ...old } : { id: newId(), key: newKey(), author: clean(author, 60), views: 0, created: Date.now(), status: 'draft', pair: '', published: null, tags: '[]', cover: '', description: '', body: '' };
  if ('title' in b || !old) { p.title = clean(b.title, LIMITS.title); if (p.title.length < 3) throw fail(400, 'Заголовок — от 3 символов'); }
  if ('lang' in b || !old) { p.lang = b.lang === 'en' ? 'en' : 'ru'; }
  if ('slug' in b || !old) {
    let s = String(b.slug == null ? '' : b.slug).trim().toLowerCase();
    if (!s) s = slugify(p.title) || 'post-' + p.id.slice(0, 6);
    if (s.length < 2 || s.length > LIMITS.slug || !SLUG_RE.test(s)) throw fail(400, 'Адрес — латиница, цифры и дефисы, от 2 до 80 символов (например, kak-sdelat-sait)');
    const other = bySlug(s); if (other && other.id !== p.id) throw fail(409, 'Такой адрес уже занят другим материалом');
    p.slug = s;
  }
  if ('description' in b) p.description = clean(b.description, LIMITS.description);
  if ('body' in b) { const body = String(b.body == null ? '' : b.body).replace(/\r\n?/g, '\n'); if (body.length > LIMITS.body) throw fail(400, 'Текст слишком длинный — до 100 000 символов'); p.body = body; }
  if ('cover' in b) { const c = String(b.cover == null ? '' : b.cover).trim(); if (c && (c.length > LIMITS.cover || !safeUrl(c) || c.startsWith('#') || c.startsWith('mailto:'))) throw fail(400, 'Обложка — ссылка на картинку: https://… или /путь/на/сайте'); p.cover = c; }
  if ('tags' in b) p.tags = JSON.stringify(normTags(b.tags));
  if ('status' in b) {
    const st = b.status === 'published' ? 'published' : 'draft';
    if (st === 'published' && !String(p.body || '').trim()) throw fail(400, 'Нельзя опубликовать пустой материал — добавьте текст');
    if (st === 'published' && !p.published) p.published = Date.now();
    p.status = st;
  }
  let pairTo = null;
  if ('pair' in b) {
    const t = b.pair ? get(String(b.pair)) : null;
    if (b.pair && !t) throw fail(400, 'Перевод не найден');
    if (t && t.id === p.id) throw fail(400, 'Материал не может быть переводом самого себя');
    if (t && t.lang === p.lang) throw fail(400, 'Перевод должен быть на другом языке');
    pairTo = t ? t.id : '';
  }
  p.updated = Date.now();
  store.tx(() => {
    if (old) q(`UPDATE blog_posts SET slug = ?, lang = ?, title = ?, description = ?, body = ?, cover = ?, tags = ?, status = ?, updated = ?, published = ? WHERE id = ?`)
      .run(p.slug, p.lang, p.title, p.description, p.body, p.cover, p.tags, p.status, p.updated, p.published, p.id);
    else q(`INSERT INTO blog_posts (id, slug, lang, title, description, body, cover, tags, status, pair, key, author, views, created, updated, published)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, 0, ?, ?, ?)`).run(p.id, p.slug, p.lang, p.title, p.description, p.body, p.cover, p.tags, p.status, p.key, p.author, p.created, p.updated, p.published);
    if (pairTo !== null) setPair(p.id, pairTo);
    else if (old && old.lang !== p.lang && old.pair) setPair(p.id, ''); // сменили язык — связь с переводом больше не верна
  });
  return get(p.id);
}
// связь «перевод»: двусторонняя; старые связи обеих статей снимаются
function setPair(id, to) {
  const me = get(id), prev = me && me.pair ? get(me.pair) : null;
  if (prev && prev.pair === id) q("UPDATE blog_posts SET pair = '' WHERE id = ?").run(prev.id);
  if (to) { const t = get(to); if (t && t.pair && t.pair !== id) q("UPDATE blog_posts SET pair = '' WHERE id = ?").run(t.pair); q('UPDATE blog_posts SET pair = ? WHERE id = ?').run(id, to); }
  q('UPDATE blog_posts SET pair = ? WHERE id = ?').run(to || '', id);
}
function remove(id) {
  const p = get(id); if (!p) throw fail(404, 'Материал не найден');
  store.tx(() => { q("UPDATE blog_posts SET pair = '' WHERE pair = ?").run(p.id); q('DELETE FROM blog_posts WHERE id = ?').run(p.id); });
  return p;
}

// для Панели
const brief = (p) => ({ id: p.id, slug: p.slug, lang: p.lang, title: p.title, description: p.description, status: p.status, tags: tagsOf(p), cover: p.cover,
  pair: p.pair || '', views: p.views, author: p.author, created: p.created, updated: p.updated, published: p.published, words: words(plain(p.body)) });
const full = (p) => ({ ...brief(p), body: p.body, key: p.key, url: '/blog/' + p.slug, previewUrl: '/blog/' + p.slug + '?preview=' + p.key });
function list() { return q('SELECT * FROM blog_posts ORDER BY CASE status WHEN \'draft\' THEN 0 ELSE 1 END, COALESCE(published, updated) DESC').all().map(brief); }
function stats() {
  const r = q("SELECT COUNT(*) n, SUM(status = 'published') pub, SUM(status = 'draft') draft, COALESCE(SUM(views), 0) views FROM blog_posts").get() || {};
  return { total: r.n || 0, published: r.pub || 0, drafts: r.draft || 0, views: r.views || 0 };
}

// для сайта
function published(lang, { tag = '', limit = 1000, offset = 0 } = {}) {
  let rows = q("SELECT * FROM blog_posts WHERE status = 'published' AND lang = ? ORDER BY published DESC").all(lang === 'en' ? 'en' : 'ru');
  if (tag) { const t = String(tag).toLowerCase(); rows = rows.filter((p) => tagsOf(p).some((x) => x.toLowerCase() === t)); }
  return { total: rows.length, items: rows.slice(offset, offset + limit) };
}
function allTags(lang) {
  const m = new Map();
  for (const p of published(lang).items) for (const t of tagsOf(p)) { const k = t.toLowerCase(); const x = m.get(k) || { name: t, n: 0 }; x.n++; m.set(k, x); }
  return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, 20);
}
const view = (id) => { try { q('UPDATE blog_posts SET views = views + 1 WHERE id = ?').run(id); } catch {} };

/* ---------- страницы ---------- */
const T = {
  ru: { blog: 'Гайды и блог', short: 'Гайды', lead: 'Как получать от Premier максимум: пошаговые инструкции, приёмы и новости.', all: 'Все', empty: 'Скоро здесь появятся первые гайды.',
    min: 'мин чтения', toc: 'Содержание', more: 'Ещё гайды', open: 'Открыть Premier', ctaT: 'Попробуйте сами', ctaP: 'Всё из этого гайда можно сделать в Premier — без VPN и зарубежной карты. Начните бесплатно.',
    plans: 'Тарифы', back: 'Все гайды', prev: '← Новее', next: 'Старее →', page: 'Страница', notFound: 'Материал не найден', notFoundP: 'Возможно, его сняли с публикации или адрес изменился.',
    privacy: 'Конфиденциальность', terms: 'Условия', draft: 'Черновик — эту страницу видят только по ссылке предпросмотра', updated: 'обновлено', tagT: 'Метка', rss: 'RSS' },
  en: { blog: 'Guides & blog', short: 'Guides', lead: 'Get the most out of Premier: step-by-step guides, tips and news.', all: 'All', empty: 'The first guides are coming soon.',
    min: 'min read', toc: 'Contents', more: 'More guides', open: 'Open Premier', ctaT: 'Try it yourself', ctaP: 'Everything in this guide works in Premier right in your browser. Start for free.',
    plans: 'Plans', back: 'All guides', prev: '← Newer', next: 'Older →', page: 'Page', notFound: 'Post not found', notFoundP: 'It may have been unpublished or moved.',
    privacy: 'Privacy', terms: 'Terms', draft: 'Draft — only people with the preview link can see this page', updated: 'updated', tagT: 'Tag', rss: 'RSS' },
};
const MON = { ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] };
function day(t, lang) { const d = new Date(t + 3 * 3600e3); const m = MON[lang][d.getUTCMonth()]; return lang === 'en' ? `${m} ${d.getUTCDate()}, ${d.getUTCFullYear()}` : `${d.getUTCDate()} ${m} ${d.getUTCFullYear()}`; }
const isoTime = (t) => new Date(t).toISOString();
const listPath = (lang, extra = {}) => { const u = new URLSearchParams(); if (lang === 'en') u.set('lang', 'en'); for (const [k, v] of Object.entries(extra)) if (v) u.set(k, v); const s = u.toString(); return '/blog' + (s ? '?' + s : ''); };
const abs = (origin, u) => (/^https?:/i.test(u) ? u : origin + u);

function layout({ lang, title, description, canonical, alternates = [], og = [], ld = [], body, robots, origin, switchTo }) {
  const t = T[lang];
  const head = [
    `<title>${esc(title)}</title>`, `<meta name="description" content="${esc(description)}">`,
    canonical ? `<link rel="canonical" href="${esc(canonical)}">` : '',
    ...alternates.map(([hl, href]) => `<link rel="alternate" hreflang="${hl}" href="${esc(href)}">`),
    robots ? `<meta name="robots" content="${robots}">` : '',
    `<link rel="alternate" type="application/rss+xml" title="Premier — ${esc(t.blog)}" href="${esc(origin + '/blog/rss.xml' + (lang === 'en' ? '?lang=en' : ''))}">`,
    ...og.map(([k, v]) => `<meta ${k.startsWith('twitter:') ? 'name' : 'property'}="${k}" content="${esc(v)}">`),
    ...ld.map((o) => `<script type="application/ld+json">${ldJson(o)}</script>`),
  ].filter(Boolean).join('\n');
  const sw = switchTo ? `<a class="bl-lang" href="${esc(switchTo)}" hreflang="${lang === 'en' ? 'ru' : 'en'}">${lang === 'en' ? 'RU' : 'EN'}</a>` : '';
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${head}
<link rel="icon" type="image/svg+xml" href="/icon-p-amber.svg"><link rel="icon" type="image/png" href="/icon-p-2.png">
<link rel="manifest" href="${lang === 'en' ? '/manifest-en.webmanifest' : '/manifest.webmanifest'}"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="theme-color" content="#F7F4EE" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#12110F" media="(prefers-color-scheme: dark)">
<link rel="preload" href="/fonts/onest-cyrillic-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/tokens.css?v=3">
<link rel="stylesheet" href="/blog.css?v=1">
</head>
<body class="bl">
<header class="bl-top"><div class="bl-wrap">
  <a href="${lang === 'en' ? '/?lang=en' : '/'}" class="bl-brand"><img src="/icon-p-amber.svg" alt="" width="26" height="26">Premier</a>
  <nav class="bl-nav" aria-label="${lang === 'en' ? 'Sections' : 'Разделы'}"><a href="${listPath(lang)}">${t.short}</a><a href="${lang === 'en' ? '/?lang=en#pricing' : '/#pricing'}">${t.plans}</a></nav>
  <span class="bl-sp"></span>${sw}
  <a href="${lang === 'en' ? '/chat?lang=en' : '/chat'}" class="bl-btn">${t.open}</a>
</div></header>
<main class="bl-wrap">
${body}
</main>
<footer class="bl-foot"><div class="bl-wrap">
  <span>© ${new Date().getFullYear()} Premier</span><span class="bl-sp"></span>
  <a href="${esc('/blog/rss.xml' + (lang === 'en' ? '?lang=en' : ''))}">${t.rss}</a><a href="/privacy">${t.privacy}</a><a href="/terms">${t.terms}</a>
</div></footer>
</body>
</html>
`;
}

const card = (p, lang) => {
  const r = readMin(words(plain(p.body))), tags = tagsOf(p);
  return `<article class="bl-card">${p.cover ? `<a href="/blog/${p.slug}" class="bl-cover" tabindex="-1" aria-hidden="true"><img src="${esc(p.cover)}" alt="" loading="lazy"></a>` : ''}
    ${tags.length ? `<div class="bl-tags">${tags.slice(0, 3).map((x) => `<a href="${esc(listPath(lang, { tag: x }))}">${esc(x)}</a>`).join('')}</div>` : ''}
    <h2><a href="/blog/${p.slug}">${esc(p.title)}</a></h2><p>${esc(autoDesc(p))}</p>
    <div class="bl-meta"><time datetime="${isoTime(p.published || p.updated)}">${day(p.published || p.updated, lang)}</time> · ${r} ${T[lang].min}</div></article>`;
};
const org = (origin) => ({ '@type': 'Organization', name: 'Premier', url: origin + '/', logo: { '@type': 'ImageObject', url: origin + '/icon-p-2.png' } });

function listPage({ lang, origin, tag, page }) {
  const t = T[lang], all = published(lang, { tag, limit: PER_PAGE, offset: (page - 1) * PER_PAGE }), pages = Math.max(1, Math.ceil(all.total / PER_PAGE));
  if (page > pages) return null;
  const tags = allTags(lang);
  const selfPath = listPath(lang, { tag, page: page > 1 ? page : '' });
  const title = (tag ? `${tag} — ` : '') + t.blog + (page > 1 ? ` · ${t.page} ${page}` : '') + ' — Premier';
  const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Premier', item: origin + (lang === 'en' ? '/?lang=en' : '/') },
    { '@type': 'ListItem', position: 2, name: t.blog, item: origin + listPath(lang) }] };
  const blogLd = { '@context': 'https://schema.org', '@type': 'Blog', name: 'Premier — ' + t.blog, description: t.lead, url: origin + listPath(lang), inLanguage: lang, publisher: org(origin),
    blogPost: all.items.map((p) => ({ '@type': 'BlogPosting', headline: p.title, url: origin + '/blog/' + p.slug, datePublished: isoTime(p.published || p.updated), dateModified: isoTime(p.updated) })) };
  const pager = pages > 1 ? `<nav class="bl-pager">${page > 1 ? `<a rel="prev" href="${esc(listPath(lang, { tag, page: page - 1 > 1 ? page - 1 : '' }))}">${t.prev}</a>` : '<span></span>'}<span>${t.page} ${page} / ${pages}</span>${page < pages ? `<a rel="next" href="${esc(listPath(lang, { tag, page: page + 1 }))}">${t.next}</a>` : '<span></span>'}</nav>` : '';
  const body = `<section class="bl-hero"><h1>${esc(t.blog)}</h1><p>${esc(t.lead)}</p></section>
${tags.length ? `<nav class="bl-chips" aria-label="${t.tagT}"><a href="${listPath(lang)}"${!tag ? ' class="on" aria-current="page"' : ''}>${t.all}</a>${tags.map((x) => `<a href="${esc(listPath(lang, { tag: x.name }))}"${tag && tag.toLowerCase() === x.name.toLowerCase() ? ' class="on" aria-current="page"' : ''}>${esc(x.name)}</a>`).join('')}</nav>` : ''}
${all.items.length ? `<div class="bl-grid">${all.items.map((p) => card(p, lang)).join('\n')}</div>` : `<div class="bl-empty">${esc(t.empty)}</div>`}
${pager}`;
  return layout({ lang, origin, title, description: t.lead, body, canonical: origin + selfPath, robots: tag ? 'noindex,follow' : '',
    alternates: tag || page > 1 ? [] : [['ru', origin + '/blog'], ['en', origin + '/blog?lang=en'], ['x-default', origin + '/blog']],
    og: [['og:type', 'website'], ['og:site_name', 'Premier'], ['og:title', title], ['og:description', t.lead], ['og:url', origin + selfPath], ['og:image', origin + (lang === 'en' ? '/og-en.png' : '/og.png')],
      ['og:locale', lang === 'en' ? 'en_US' : 'ru_RU'], ['twitter:card', 'summary_large_image']],
    ld: [blogLd, crumbs], switchTo: lang === 'en' ? '/blog?lang=ru' : '/blog?lang=en' });
}

function postPage(p, { origin, preview }) {
  const lang = p.lang, t = T[lang], r = render(p.body), tags = tagsOf(p), url = origin + '/blog/' + p.slug, desc = autoDesc(p);
  const tr = pairOf(p), trPub = tr && isPub(tr) ? tr : null;
  const img = p.cover ? abs(origin, p.cover) : origin + (lang === 'en' ? '/og-en.png' : '/og.png');
  const pub = p.published || p.updated;
  const posting = { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: desc, image: [img], url, mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    datePublished: isoTime(pub), dateModified: isoTime(p.updated), inLanguage: lang, wordCount: r.words, author: org(origin), publisher: org(origin), ...(tags.length ? { keywords: tags.join(', ') } : {}) };
  const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Premier', item: origin + (lang === 'en' ? '/?lang=en' : '/') },
    { '@type': 'ListItem', position: 2, name: t.blog, item: origin + listPath(lang) },
    { '@type': 'ListItem', position: 3, name: p.title, item: url }] };
  const more = published(lang, { limit: 4 }).items.filter((x) => x.id !== p.id).slice(0, 3);
  const upd = p.updated - pub > 864e5 ? ` · ${t.updated} <time datetime="${isoTime(p.updated)}">${day(p.updated, lang)}</time>` : '';
  const body = `${preview ? `<div class="bl-draft">${esc(t.draft)}</div>` : ''}
<nav class="bl-crumbs" aria-label="breadcrumbs"><a href="${lang === 'en' ? '/?lang=en' : '/'}">Premier</a><span>/</span><a href="${listPath(lang)}">${esc(t.blog)}</a></nav>
<article class="bl-post">
<header>${tags.length ? `<div class="bl-tags">${tags.map((x) => `<a href="${esc(listPath(lang, { tag: x }))}">${esc(x)}</a>`).join('')}</div>` : ''}
<h1>${esc(p.title)}</h1>${p.description ? `<p class="bl-lead">${esc(p.description)}</p>` : ''}
<div class="bl-meta"><time datetime="${isoTime(pub)}">${day(pub, lang)}</time>${upd} · ${r.minutes} ${t.min}</div>
${p.cover ? `<img class="bl-hero-img" src="${esc(p.cover)}" alt="">` : ''}</header>
${r.toc.length >= 3 ? `<details class="bl-toc" open><summary>${t.toc}</summary><ol>${r.toc.map((x) => `<li><a href="#${x.id}">${esc(x.text)}</a></li>`).join('')}</ol></details>` : ''}
<div class="bl-prose">
${r.html}
</div>
<aside class="bl-cta"><div><b>${t.ctaT}</b><p>${t.ctaP}</p></div><a class="bl-btn" href="${lang === 'en' ? '/chat?lang=en' : '/chat'}">${t.open}</a></aside>
</article>
${more.length ? `<section class="bl-more"><h2>${t.more}</h2><div class="bl-grid">${more.map((x) => card(x, lang)).join('\n')}</div><p><a href="${listPath(lang)}">${t.back} →</a></p></section>` : ''}`;
  const alternates = trPub && !preview ? [[lang, url], [trPub.lang, origin + '/blog/' + trPub.slug], ['x-default', lang === 'ru' ? url : origin + '/blog/' + trPub.slug]] : [];
  return layout({ lang, origin, title: p.title + ' — Premier', description: desc, body, canonical: preview ? '' : url, robots: preview ? 'noindex,nofollow' : '', alternates,
    og: [['og:type', 'article'], ['og:site_name', 'Premier'], ['og:title', p.title], ['og:description', desc], ['og:url', url], ['og:image', img], ['og:locale', lang === 'en' ? 'en_US' : 'ru_RU'],
      ['article:published_time', isoTime(pub)], ['article:modified_time', isoTime(p.updated)], ...tags.map((x) => ['article:tag', x]), ['twitter:card', 'summary_large_image'], ['twitter:title', p.title], ['twitter:description', desc], ['twitter:image', img]],
    ld: preview ? [] : [posting, crumbs], switchTo: trPub ? '/blog/' + trPub.slug : (lang === 'en' ? '/blog?lang=ru' : '/blog?lang=en') });
}

function notFoundPage(lang, origin) {
  const t = T[lang];
  return layout({ lang, origin, title: t.notFound + ' — Premier', description: t.notFoundP, robots: 'noindex', body: `<section class="bl-hero"><h1>${esc(t.notFound)}</h1><p>${esc(t.notFoundP)}</p><p><a class="bl-btn" href="${listPath(lang)}">${t.back}</a></p></section>` });
}

function rss(lang, origin) {
  const t = T[lang], items = published(lang, { limit: 30 }).items;
  const x = (s) => esc(s);
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>',
    `<title>${x('Premier — ' + t.blog)}</title><link>${x(origin + listPath(lang))}</link><description>${x(t.lead)}</description><language>${lang}</language>`,
    `<atom:link href="${x(origin + '/blog/rss.xml' + (lang === 'en' ? '?lang=en' : ''))}" rel="self" type="application/rss+xml"/>`,
    ...items.map((p) => `<item><title>${x(p.title)}</title><link>${x(origin + '/blog/' + p.slug)}</link><guid isPermaLink="true">${x(origin + '/blog/' + p.slug)}</guid><pubDate>${new Date(p.published || p.updated).toUTCString()}</pubDate><description>${x(autoDesc(p))}</description>${tagsOf(p).map((c) => `<category>${x(c)}</category>`).join('')}</item>`),
    '</channel></rss>', ''].join('\n');
}

// записи для sitemap.xml: список (RU/EN) и все опубликованные статьи
function sitemapEntries(origin) {
  const rows = q("SELECT * FROM blog_posts WHERE status = 'published' ORDER BY published DESC").all();
  const last = (lang) => rows.filter((p) => p.lang === lang).reduce((m, p) => Math.max(m, p.updated), 0);
  const listAlt = [['ru', origin + '/blog'], ['en', origin + '/blog?lang=en'], ['x-default', origin + '/blog']];
  const out = [{ loc: origin + '/blog', lastmod: last('ru') || null, prio: '0.7', alt: listAlt }, { loc: origin + '/blog?lang=en', lastmod: last('en') || null, prio: '0.6', alt: listAlt }];
  for (const p of rows) {
    const tr = pairOf(p), alt = tr && isPub(tr) ? [[p.lang, origin + '/blog/' + p.slug], [tr.lang, origin + '/blog/' + tr.slug], ['x-default', origin + '/blog/' + (p.lang === 'ru' ? p.slug : tr.slug)]] : null;
    out.push({ loc: origin + '/blog/' + p.slug, lastmod: p.updated, prio: '0.6', alt });
  }
  return out;
}

// обработчик страниц: вернёт true, если запрос про блог
function handle(req, res, url, ctx) {
  const p = url.pathname;
  if (p !== '/blog' && p !== '/blog/' && !p.startsWith('/blog/')) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return true; }
  const { origin, languageOf, languageHeaders, withMetrika = (h) => h, touch } = ctx;
  const send = (code, html, lang, extra = {}) => {
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Language': lang, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', ...extra });
    res.end(req.method === 'HEAD' ? undefined : withMetrika(html));
  };
  if (p === '/blog/') { res.writeHead(301, { Location: '/blog' + url.search }); res.end(); return true; }
  if (p === '/blog/rss.xml') {
    const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'ru';
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
    res.end(req.method === 'HEAD' ? undefined : rss(lang, origin)); return true;
  }
  if (p === '/blog') {
    const lang = languageHeaders ? languageHeaders(req, res) : (languageOf ? languageOf(req) : 'ru');
    if (touch) touch();
    const tag = clean(url.searchParams.get('tag') || '', LIMITS.tag), pageN = Math.max(1, Math.min(1000, parseInt(url.searchParams.get('page') || '1', 10) || 1));
    const html = listPage({ lang, origin, tag, page: pageN });
    if (!html) { send(404, notFoundPage(lang, origin), lang, { 'Cache-Control': 'no-cache' }); return true; }
    send(200, html, lang, { 'Cache-Control': 'no-cache' }); return true;
  }
  const m = /^\/blog\/([^/]+)\/?$/.exec(p);
  const post = m ? bySlug(decodeURIComponent(m[1]).toLowerCase()) : null;
  const key = url.searchParams.get('preview') || '';
  const preview = !!(post && !isPub(post) && key && key.length === post.key.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(post.key)));
  if (!post || (!isPub(post) && !preview)) { const lang = languageOf ? languageOf(req) : 'ru'; send(404, notFoundPage(lang, origin), lang, { 'Cache-Control': 'no-cache' }); return true; }
  if (m[1] !== post.slug) { res.writeHead(301, { Location: '/blog/' + post.slug + url.search }); res.end(); return true; }
  if (preview) { send(200, postPage(post, { origin, preview: true }), post.lang, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }); return true; }
  if (touch) touch();
  if (req.method === 'GET' && !BOT_RE.test(req.headers['user-agent'] || '')) view(post.id);
  send(200, postPage(post, { origin }), post.lang, { 'Cache-Control': 'no-cache' });
  return true;
}

/* ---------- стартовые черновики (только при первом создании таблицы) ---------- */
if (fresh && process.env.BLOG_SEED !== '0') {
  try {
    const seeds = require('./blog-seed');
    for (const s of seeds) save(null, { ...s, status: 'draft' }, 'Premier');
  } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') console.error('blog seed:', e.message); }
}

module.exports = { render, slugify, safeUrl, save, remove, get, bySlug, list, stats, full, brief, published, allTags, sitemapEntries, handle, rss, LIMITS };
