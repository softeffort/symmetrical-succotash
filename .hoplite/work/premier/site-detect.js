'use strict';
// Распознавание HTML-сайта в ответе модели. lastSite — готовый сайт в законченном ответе (перенесён из server.js без изменений);
// siteStart — где сайт начинается в ещё идущем потоке (этап 2, BIZ-15: лимит сайтов проверяет сервер до выдачи HTML).
const path = require('path');

// последний законченный HTML-сайт из ответа (одиночный блок или папка с index.html)
function lastSite(text) {
  const re = /```([\w-]*)([^\n]*)\n([\s\S]*?)```/g; let m, single = null; const files = new Map();
  while ((m = re.exec(text))) {
    const info = m[2].trim(), pm = info.match(/^:\s*(\S+)/) || info.match(/\b(?:path|file|filename)\s*=\s*["']?([^"'\s]+)/i);
    if (pm) files.set(pm[1].replace(/^\.?\//, ''), m[3]);
    else if ((/^html?$/i.test(m[1]) || !m[1]) && /<(!doctype|html|body)\b/i.test(m[3])) single = m[3];
  }
  const idx = [...files.keys()].filter((k) => /\.html?$/i.test(k)).sort((a, b) => /index\.html?$/i.test(b) - /index\.html?$/i.test(a) || a.length - b.length)[0];
  if (idx && files.size) {
    const dir = idx.replace(/[^/]*$/, ''), get = (ref) => files.get(path.posix.normalize(dir + ref.split(/[?#]/)[0]).replace(/^\.\//, ''));
    return { pack: true, html: files.get(idx).replace(/<link\b[^>]*>/gi, (t) => { if (!/stylesheet/i.test(t)) return t; const h = t.match(/href\s*=\s*["']([^"']+)/i)?.[1]; const c = h && !/^(https?:|\/\/)/.test(h) && get(h); return c != null && c !== false ? `<style>${c}</style>` : t; })
      .replace(/<script\b([^>]*?)\ssrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (t, a, src, b) => { const c = !/^(https?:|\/\/)/.test(src) && get(src); return c ? `<script${a}${b}>${c.replace(/<\/script/gi, '<\\/script')}</script>` : t; }) };
  }
  return single ? { pack: false, html: single } : null;
}

// Позиция в тексте, с которой начинается сайт (открывающая строка ``` первого блока сайта), или -1, если сайта нет.
// Правила те же, что у lastSite, но блок может быть ещё не закрыт: поток идёт, а закрывающих ``` пока нет.
function siteStart(text) {
  const src = String(text || '') + '\n```', re = /```([\w-]*)([^\n]*)\n([\s\S]*?)```/g; let m, single = -1, firstFile = -1, html = false;
  while ((m = re.exec(src))) {
    const info = m[2].trim(), pm = info.match(/^:\s*(\S+)/) || info.match(/\b(?:path|file|filename)\s*=\s*["']?([^"'\s]+)/i);
    if (pm) { if (firstFile < 0) firstFile = m.index; if (/\.html?$/i.test(pm[1])) html = true; }
    else if (single < 0 && (/^html?$/i.test(m[1]) || !m[1]) && /<(!doctype|html|body)\b/i.test(m[3])) single = m.index;
  }
  const pack = html ? firstFile : -1;
  return pack < 0 ? single : single < 0 ? pack : Math.min(pack, single);
}
// Наблюдатель за идущим потоком (BIZ-15): по мере роста текста говорит, начался ли сайт и с какого места текст пока нельзя
// отдавать пользователю. feed(text) → { site, hold }:
//   site — позиция начала сайта (как у siteStart) или -1;
//   hold — позиция открытого блока кода, про который ещё не ясно, сайт ли это (```html или ``` без языка, первая строка
//          ещё не пришла либо тегов <!doctype|html|body пока нет), или -1. Блок закрылся и сайтом не стал — hold снимается.
// Законченные блоки второй раз не разбираются, в открытом блоке просматривается только новый хвост — на длинном ответе это
// не замедляет поток.
function siteWatch() {
  const TAG = /<(!doctype|html|body)\b/i;
  let done = 0, firstFile = -1, open = -1, scanned = 0, site = -1;
  // блок с именем файла (```css:style.css) сам сайтом не является, но проект с файлом .html начинается с первого такого блока —
  // пока .html не встретился, первый файл придерживается так же, как нерешённый блок кода
  const held = (r) => (r.site < 0 && firstFile >= 0 ? { site: -1, hold: r.hold < 0 ? firstFile : Math.min(r.hold, firstFile) } : r);
  return { feed(text) { return held(scan(String(text || ''))); } };
  function scan(text) {
    if (site >= 0) return { site, hold: -1 };
    for (;;) {
      const idx = text.indexOf('```', done);
      if (idx < 0) return { site: -1, hold: -1 };
      const nl = text.indexOf('\n', idx + 3);
      if (nl < 0) return { site: -1, hold: idx }; // строка с языком блока ещё не пришла целиком
      const head = /^([\w-]*)([^\n]*)$/.exec(text.slice(idx + 3, nl)) || [], info = (head[2] || '').trim();
      const pm = info.match(/^:\s*(\S+)/) || info.match(/\b(?:path|file|filename)\s*=\s*["']?([^"'\s]+)/i);
      const close = text.indexOf('```', nl + 1);
      if (pm) {
        if (firstFile < 0) firstFile = idx;
        if (/\.html?$/i.test(pm[1])) { site = firstFile; return { site, hold: -1 }; }
      } else if (/^html?$/i.test(head[1] || '') || !head[1]) {
        if (open !== idx) { open = idx; scanned = nl + 1; }
        const end = close < 0 ? text.length : close;
        if (TAG.test(text.slice(Math.max(nl + 1, scanned - 10), end))) { site = idx; return { site, hold: -1 }; }
        scanned = end;
        if (close < 0) return { site: -1, hold: idx };
      }
      if (close < 0) return { site: -1, hold: -1 }; // открыт блок, который сайтом не станет (другой язык, файл не .html)
      done = close + 3;
    }
  }
}
module.exports = { lastSite, siteStart, siteWatch };
