'use strict';
// Гайды и блог: blog.js (Markdown → безопасный HTML, адреса, переводы, стартовые черновики), публичные страницы
// /blog, /blog/<адрес>, RSS и sitemap, API Панели и подключение на лендинге и в Панели.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');
const { copyApp, seed, startServer, rm, ROOT } = require('./helpers');

function unit() {
  const assert = require('assert');
  const B = require(process.cwd() + '/blog');
  // стартовые черновики: три, не опубликованы
  const L = B.list(); assert.strictEqual(L.length, 3); assert.ok(L.every((p) => p.status === 'draft' && p.lang === 'ru'));
  assert.strictEqual(B.published('ru').total, 0); assert.strictEqual(B.sitemapEntries('https://x').length, 2);
  // Markdown: всё экранируется, опасные ссылки — текстом
  const x = B.render('<script>alert(1)</script>\n\n[жми](javascript:alert(1)) [ok](https://a.b/c?d=1&e=2) [внутри](/chat)\n\n![a](data:image/png;base64,AAAA) ![b](/og.png)\n\n<img src=x onerror=alert(1)>\n\n[x](//evil.example) **ж**');
  assert.ok(!/<script|<img src=x|onerror="|href="javascript|href="\/\/evil|src="data:/i.test(x.html), x.html);
  assert.match(x.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(x.html, /<a href="https:\/\/a\.b\/c\?d=1&amp;e=2" target="_blank" rel="noopener">ok<\/a>/);
  assert.match(x.html, /<a href="\/chat">внутри<\/a>/); assert.match(x.html, /<img src="\/og\.png" alt="b" loading="lazy">/); assert.match(x.html, /<strong>ж<\/strong>/);
  const y = B.render('# Введение\nтекст `<b>**не жирный**</b>` и *курсив*\n\n## Шаг 1\n\n## Шаг 1\n\n### Подробности\n\n- один\n- [x] сделано\n\n3. три\n4. четыре\n\n> совет\n\n```js\nif (a < b) alert("x")\n```\n\n| А | Б |\n|---|--:|\n| 1 | <i>2</i> |\n\n---');
  assert.match(y.html, /<h2 id="vvedenie">Введение<\/h2>/); assert.match(y.html, /<h2 id="shag-1">/); assert.match(y.html, /<h2 id="shag-1-2">/); assert.match(y.html, /<h3 id="podrobnosti">/);
  assert.deepStrictEqual(y.toc.map((t) => t.id), ['vvedenie', 'shag-1', 'shag-1-2']);
  assert.match(y.html, /<code>&lt;b&gt;\*\*не жирный\*\*&lt;\/b&gt;<\/code>/); assert.match(y.html, /<em>курсив<\/em>/);
  assert.match(y.html, /<ul><li>один<\/li><li class="task done">сделано<\/li><\/ul>/); assert.match(y.html, /<ol start="3"><li>три<\/li><li>четыре<\/li><\/ol>/);
  assert.match(y.html, /<blockquote><p>совет<\/p><\/blockquote>/); assert.match(y.html, /<pre><code class="language-js">if \(a &lt; b\) alert\(&quot;x&quot;\)<\/code><\/pre>/);
  assert.match(y.html, /<th>А<\/th><th style="text-align:right">Б<\/th>/); assert.match(y.html, /<td style="text-align:right">&lt;i&gt;2&lt;\/i&gt;<\/td>/); assert.match(y.html, /<hr>/);
  assert.ok(y.words > 10 && y.minutes === 1);
  // адреса
  assert.strictEqual(B.slugify('Как сделать сайт за 5 минут!'), 'kak-sdelat-sayt-za-5-minut');
  assert.strictEqual(B.slugify('Щётка и южный ящик — Café'), 'schetka-i-yuzhnyy-yaschik-cafe');
  const a = B.save(null, { title: 'Как сделать сайт', body: 'текст' }, 'Анна');
  assert.strictEqual(a.slug, 'kak-sdelat-sayt'); assert.strictEqual(a.status, 'draft'); assert.strictEqual(a.lang, 'ru'); assert.strictEqual(a.author, 'Анна'); assert.ok(!a.published);
  assert.throws(() => B.save(null, { title: 'Как сделать сайт' }), (e) => e.status === 409 && /уже занят/.test(e.message));
  assert.throws(() => B.save(null, { title: 'аб' }), (e) => e.status === 400);
  assert.throws(() => B.save(null, { title: 'Нормально', slug: 'Плохой адрес' }), (e) => e.status === 400);
  assert.throws(() => B.save(null, { title: 'Нормально', slug: 'ok-slug', cover: 'javascript:alert(1)' }), (e) => e.status === 400);
  assert.throws(() => B.save(null, { title: 'Пустой', status: 'published' }), /пустой/);
  const t = B.save(a.id, { tags: 'Сайты, сайты, python, ' + 'x'.repeat(50), status: 'published' });
  assert.deepStrictEqual(JSON.parse(t.tags), ['Сайты', 'python', 'x'.repeat(30)]); assert.ok(t.published); const first = t.published;
  B.save(a.id, { status: 'draft' }); assert.strictEqual(B.save(a.id, { status: 'published' }).published, first, 'дата первой публикации сохраняется');
  // переводы: двусторонняя связь
  const e1 = B.save(null, { title: 'How to build a website', lang: 'en', body: 'text', pair: a.id });
  assert.strictEqual(e1.pair, a.id); assert.strictEqual(B.get(a.id).pair, e1.id);
  assert.throws(() => B.save(null, { title: 'Same language', lang: 'ru', pair: a.id }), /другом языке/);
  const e2 = B.save(null, { title: 'Another English', lang: 'en', body: 'text' });
  B.save(a.id, { pair: e2.id }); assert.strictEqual(B.get(a.id).pair, e2.id); assert.strictEqual(B.get(e2.id).pair, a.id); assert.strictEqual(B.get(e1.id).pair, '', 'старая связь снята');
  B.remove(e2.id); assert.strictEqual(B.get(a.id).pair, ''); assert.strictEqual(B.get(e2.id), null);
  assert.throws(() => B.remove('ffffffffffff'), (e) => e.status === 404);
  assert.deepStrictEqual(B.stats(), { total: 5, published: 1, drafts: 4, views: 0 });
  console.log('UNIT_OK');
}

test('blog.js: Markdown, адреса, переводы, стартовые черновики', (t) => {
  const dir = copyApp(); seed(dir); t.after(() => rm(dir));
  const r = spawnSync(process.execPath, ['-e', `(${unit})()`], { cwd: dir, encoding: 'utf8' });
  assert.match(r.stdout, /UNIT_OK/, r.stderr + r.stdout);
  const off = copyApp(); seed(off); t.after(() => rm(off));
  const r2 = spawnSync(process.execPath, ['-e', "console.log('N=' + require(process.cwd() + '/blog').list().length)"], { cwd: off, encoding: 'utf8', env: { ...process.env, BLOG_SEED: '0' } });
  assert.match(r2.stdout, /N=0/, r2.stderr);
});

test('блог на сайте и в Панели: черновики, публикация, SEO, RSS, sitemap', async (t) => {
  const dir = copyApp(); seed(dir);
  const s = await startServer(dir, { PUSH_OFF: '1' });
  t.after(() => { s.stop(); rm(dir); });
  const login = await s.req('POST', '/api/admin/login', { body: { password: 'Test-Admin-Pass-2026' } });
  assert.equal(login.status, 200, login.text); const H = { Authorization: 'Bearer ' + login.json.token };
  const A = (m, u, body) => s.req(m, u, { body, headers: H });

  assert.equal((await s.req('GET', '/api/admin/blog')).status, 401);
  const l0 = await A('GET', '/api/admin/blog'); assert.equal(l0.status, 200, l0.text);
  assert.equal(l0.json.list.length, 3); assert.equal(l0.json.canEdit, true); assert.deepEqual(l0.json.stats, { total: 3, published: 0, drafts: 3, views: 0 });
  const pv = await A('POST', '/api/admin/blog/preview', { body: '## Привет\n\n<b>x</b>' });
  assert.equal(pv.status, 200); assert.match(pv.json.html, /<h2 id="privet">Привет<\/h2>/); assert.match(pv.json.html, /&lt;b&gt;/);

  // стартовый черновик не виден на сайте, но открывается по ссылке предпросмотра
  const sd = l0.json.list.find((p) => p.slug === 'dvuhfaktornaya-zaschita'); assert.ok(sd);
  const sdf = await A('GET', '/api/admin/blog/' + sd.id); assert.equal(sdf.status, 200); assert.ok(sdf.json.key && sdf.json.preview.html.includes('<h2'));
  assert.equal((await s.req('GET', '/blog/dvuhfaktornaya-zaschita')).status, 404);
  assert.equal((await s.req('GET', '/blog/dvuhfaktornaya-zaschita?preview=wrong-key-wrong-key-')).status, 404);
  const pr = await s.req('GET', sdf.json.previewUrl);
  assert.equal(pr.status, 200); assert.match(pr.headers.get('x-robots-tag'), /noindex/); assert.match(pr.headers.get('cache-control'), /no-store/);
  assert.match(pr.text, /class="bl-draft"/); assert.match(pr.text, /<meta name="robots" content="noindex,nofollow">/); assert.ok(!/rel="canonical"/.test(pr.text));

  // пустой блог
  const e0 = await s.req('GET', '/blog'); assert.equal(e0.status, 200); assert.match(e0.text, /Скоро здесь появятся/);
  assert.match(e0.headers.get('content-language'), /ru/);

  // публикация
  const body = 'Вступление про сайты.\n\n## Шаг первый\n\nТекст.\n\n## Шаг второй\n\nТекст.\n\n## Итог\n\n[Открыть](/chat)';
  const bad = await A('POST', '/api/admin/blog', { title: 'Как сделать сайт', slug: 'fajly-proekta' }); assert.equal(bad.status, 409); assert.match(bad.json.error, /занят/);
  const c = await A('POST', '/api/admin/blog', { title: 'Как сделать сайт с Premier', description: 'Пошагово и без кода.', tags: 'сайты, советы', body, status: 'published' });
  assert.equal(c.status, 200, c.text); assert.equal(c.json.slug, 'kak-sdelat-sayt-s-premier'); assert.equal(c.json.status, 'published');
  const ru = c.json;
  const page = await s.req('GET', '/blog/kak-sdelat-sayt-s-premier', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  assert.equal(page.status, 200); const h = page.text;
  assert.match(h, /<html lang="ru">/); assert.match(h, /<title>Как сделать сайт с Premier — Premier<\/title>/);
  assert.match(h, /<meta name="description" content="Пошагово и без кода.">/); assert.match(h, /<link rel="canonical" href="[^"]+\/blog\/kak-sdelat-sayt-s-premier">/);
  assert.match(h, /<meta property="og:type" content="article">/); assert.match(h, /<meta property="article:tag" content="сайты">/); assert.match(h, /<meta name="twitter:card" content="summary_large_image">/);
  const ld = [...h.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const bp = ld.find((o) => o['@type'] === 'BlogPosting'); assert.ok(bp); assert.equal(bp.headline, 'Как сделать сайт с Premier'); assert.equal(bp.inLanguage, 'ru'); assert.equal(bp.keywords, 'сайты, советы');
  assert.ok(ld.find((o) => o['@type'] === 'BreadcrumbList'));
  assert.match(h, /class="bl-toc"/); assert.match(h, /<a href="#shag-pervyy">Шаг первый<\/a>/); assert.match(h, /href="\/blog\/rss\.xml"/); assert.match(h, /href="\/blog.css\?v=1"/);
  assert.ok(!/rel="alternate" hreflang=/.test(h), 'без перевода — без hreflang');
  // просмотры: боты не считаются
  await s.req('GET', '/blog/kak-sdelat-sayt-s-premier', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YandexBot/3.0)' } });
  await s.req('HEAD', '/blog/kak-sdelat-sayt-s-premier', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  assert.equal((await A('GET', '/api/admin/blog/' + ru.id)).json.views, 1);
  assert.equal((await s.req('GET', '/blog/Kak-Sdelat-Sayt-S-Premier')).status, 301);
  assert.equal((await s.req('POST', '/blog/kak-sdelat-sayt-s-premier')).status, 405);

  // список, языки и метки
  const list = await s.req('GET', '/blog'); assert.match(list.text, /Как сделать сайт с Premier/); assert.ok(!/Двухфакторная защита: как/.test(list.text), 'черновика нет в списке');
  assert.match(list.text, /<link rel="alternate" hreflang="en" href="[^"]+\/blog\?lang=en">/); assert.match(list.text, /"@type":"Blog"/);
  const en = await s.req('GET', '/blog?lang=en'); assert.match(en.text, /<html lang="en">/); assert.ok(!/Как сделать сайт/.test(en.text)); assert.match(en.text, /The first guides are coming soon/);
  const tag = await s.req('GET', '/blog?tag=' + encodeURIComponent('Сайты') + '&lang=ru'); assert.match(tag.text, /noindex,follow/); assert.match(tag.text, /Как сделать сайт/);
  const tag2 = await s.req('GET', '/blog?tag=nope&lang=ru'); assert.ok(!/Как сделать сайт с Premier<\/a>/.test(tag2.text));
  assert.equal((await s.req('GET', '/blog?page=5&lang=ru')).status, 404);

  // перевод → hreflang на обеих страницах
  const ce = await A('POST', '/api/admin/blog', { title: 'How to build a website with Premier', lang: 'en', body: 'Intro.\n\n## Step', status: 'published', pair: ru.id });
  assert.equal(ce.status, 200, ce.text); assert.equal(ce.json.slug, 'how-to-build-a-website-with-premier');
  const ruP = (await s.req('GET', '/blog/kak-sdelat-sayt-s-premier')).text;
  assert.match(ruP, /hreflang="en" href="[^"]+\/blog\/how-to-build-a-website-with-premier"/); assert.match(ruP, /hreflang="x-default" href="[^"]+\/blog\/kak-sdelat-sayt-s-premier"/);
  const enP = await s.req('GET', '/blog/how-to-build-a-website-with-premier'); assert.match(enP.text, /<html lang="en">/); assert.match(enP.headers.get('content-language'), /en/); assert.match(enP.text, /rel="alternate" hreflang="ru"/);
  assert.match((await s.req('GET', '/blog?lang=en')).text, /How to build a website with Premier/);

  // sitemap и RSS
  const sm = (await s.req('GET', '/sitemap.xml')).text;
  assert.match(sm, /\/<\/loc>/); assert.match(sm, /\/blog<\/loc>/); assert.match(sm, /\/blog\/kak-sdelat-sayt-s-premier<\/loc>/); assert.match(sm, /\/blog\/how-to-build-a-website-with-premier<\/loc>/);
  assert.ok(!/dvuhfaktornaya-zaschita/.test(sm), 'черновика нет в sitemap');
  const rss = await s.req('GET', '/blog/rss.xml'); assert.equal(rss.status, 200); assert.match(rss.headers.get('content-type'), /rss\+xml/);
  assert.match(rss.text, /<item><title>Как сделать сайт с Premier<\/title>/); assert.ok(!/How to build/.test(rss.text));
  assert.match((await s.req('GET', '/blog/rss.xml?lang=en')).text, /How to build a website with Premier/);

  // снять с публикации и удалить
  const un = await A('PATCH', '/api/admin/blog/' + ru.id, { status: 'draft' }); assert.equal(un.status, 200); assert.equal(un.json.status, 'draft');
  assert.equal((await s.req('GET', '/blog/kak-sdelat-sayt-s-premier')).status, 404);
  assert.ok(!/kak-sdelat-sayt-s-premier/.test((await s.req('GET', '/sitemap.xml')).text));
  assert.ok(!/rel="alternate" hreflang="ru"/.test((await s.req('GET', '/blog/how-to-build-a-website-with-premier')).text), 'hreflang только на опубликованный перевод');
  const del = await A('DELETE', '/api/admin/blog/' + ce.json.id); assert.equal(del.status, 200);
  assert.equal((await A('GET', '/api/admin/blog/' + ce.json.id)).status, 404);
  assert.equal((await A('GET', '/api/admin/blog/' + ru.id)).json.pair, '');

  // журнал действий: создание/изменение/удаление пишутся, предпросмотр — нет
  const au = await A('GET', '/api/admin/audit');
  assert.equal(au.status, 200, au.text);
  const bl = au.json.items.filter((i) => i.path.startsWith('/api/admin/blog'));
  assert.deepEqual([...new Set(bl.map((i) => i.method))].sort(), ['DELETE', 'PATCH', 'POST']);
  assert.ok(!bl.some((i) => i.path.endsWith('/preview')), 'предпросмотр не пишется в журнал');
  assert.ok(bl.some((i) => /Снято с публикации: Как сделать сайт/.test(i.action)));
  assert.ok(bl.filter((i) => i.status === 200).every((i) => /^post:[a-f0-9]{16}$/.test(i.target)), JSON.stringify(bl.map((i) => [i.method, i.target])));

  // лендинг: ссылка на гайды
  assert.match((await s.req('GET', '/')).text, /<a href="\/blog">Гайды<\/a>/);
  assert.match((await s.req('GET', '/?lang=en')).text, /<a href="\/blog\?lang=en">Guides<\/a>/);
  const css = await s.req('GET', '/blog.css?v=1'); assert.equal(css.status, 200); assert.match(css.text, /\.bl-prose/);
});

test('Панель: раздел «Гайды и блог» подключён, права content.view / content.edit', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'public/panel.html'), 'utf8');
  assert.match(panel, /<script src="\/admin\/v-blog\.js\?v=1"><\/script>/);
  const shell = fs.readFileSync(path.join(ROOT, 'public/admin/shell.js'), 'utf8');
  assert.match(shell, /v: 'blog', t: 'Гайды и блог'.*perm: 'content\.view'/);
  const v = fs.readFileSync(path.join(ROOT, 'public/admin/v-blog.js'), 'utf8');
  assert.match(v, /R\.blog = async/); assert.match(v, /\/api\/admin\/blog\/preview/);
  const idx = fs.readFileSync(path.join(ROOT, 'admin/index.js'), 'utf8');
  assert.match(idx, /\['GET', \/\^\\\/api\\\/admin\\\/blog\(\\\/\|\$\)\/, 'content\.view'\]/);
  assert.match(idx, /\['W', \/\^\\\/api\\\/admin\\\/blog\(\\\/\|\$\)\/, 'content\.edit'\]/);
});
