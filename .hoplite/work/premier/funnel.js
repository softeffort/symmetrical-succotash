'use strict';
// Воронка пользователя: откуда пришёл (первое касание: UTM-метки, рекламный клик, сайт-источник) и какие шаги прошёл
// от регистрации до оплаты. Регистрация берётся из users.created, оплата — из платежей; промежуточные шаги пишутся сюда.
const DAY = 864e5;
const COOKIE = 'pm_src', TTL = 90 * DAY;
// шаги, которые сохраняются в таблицу funnel (каждый — один раз на пользователя)
const STEPS = ['msg', 'limit', 'plans', 'checkout'];
// шаги, о которых сообщает браузер (остальные сервер отмечает сам)
const CLIENT_STEPS = new Set(['plans']);
// продукт платежа: подписка (личный тариф, пробный период, команда) или допродажа (сброс лимита, пакет сообщений, Ultra-кредиты)
const ADDONS = new Set(['reset', 'pack', 'credits']);
const productKind = (plan) => (ADDONS.has(plan) ? 'addon' : 'subscription');
const clip = (s, n = 60) => String(s == null ? '' : s).replace(/[^\p{L}\p{N}._\-+ /:]/gu, '').trim().slice(0, n);
// известные сайты-источники → короткое имя; поисковики дают трафик «organic»
const HOSTS = [
  [/(^|\.)(yandex\.[a-z.]+|ya\.ru)$/, 'yandex', 'organic'], [/(^|\.)google\.[a-z.]+$/, 'google', 'organic'], [/(^|\.)bing\.com$/, 'bing', 'organic'],
  [/(^|\.)duckduckgo\.com$/, 'duckduckgo', 'organic'], [/(^|\.)(go\.)?mail\.ru$/, 'mail.ru', 'organic'],
  [/(^|\.)(t\.me|telegram\.(org|me))$/, 'telegram', 'social'], [/(^|\.)(vk\.com|vk\.ru|vkontakte\.ru)$/, 'vk', 'social'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube', 'social'],
  [/(^|\.)dzen\.ru$/, 'dzen', 'social'], [/(^|\.)(x\.com|twitter\.com|t\.co)$/, 'x', 'social'], [/(^|\.)reddit\.com$/, 'reddit', 'social'], [/(^|\.)habr\.com$/, 'habr', 'referral'],
];
// переходы со страниц входа и оплаты — это не источник трафика
const IGNORE = /(^|\.)(accounts\.google\.com|accounts\.youtube\.com|oauth\.yandex\.ru|platega\.io|robokassa\.(ru|com)|cispay\.[a-z]+|pay\.crypt\.bot)$/;

function refHost(referer, ownHost) {
  if (!referer) return '';
  let h = ''; try { h = new URL(referer).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
  const own = String(ownHost || '').toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
  if (!h || h === own || IGNORE.test(h)) return '';
  return h.slice(0, 60);
}
// источник визита по адресу страницы и заголовку Referer
function detect(url, referer, ownHost) {
  const q = url.searchParams;
  let s = clip(q.get('utm_source'), 40).toLowerCase(), m = clip(q.get('utm_medium'), 40).toLowerCase(), c = clip(q.get('utm_campaign'), 60);
  if (!s && q.get('yclid')) { s = 'yandex'; m = m || 'cpc'; }
  if (!s && (q.get('gclid') || q.get('gbraid') || q.get('wbraid'))) { s = 'google'; m = m || 'cpc'; }
  if (!s && q.get('fbclid')) { s = 'facebook'; m = m || 'social'; }
  if (!s && /^[a-zA-Z0-9_-]{8,64}$/.test(q.get('ref') || '')) { s = 'invite'; m = m || 'referral'; }
  const r = refHost(referer, ownHost);
  if (!s && r) { const k = HOSTS.find(([re]) => re.test(r)); s = k ? k[1] : r; m = m || (k ? k[2] : 'referral'); }
  if (!s) { s = 'direct'; m = m || 'none'; }
  return { s, m, c, l: clip(url.pathname, 40) || '/', r, t: Date.now() };
}
const encode = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function decode(v) {
  if (!v || v.length > 1200) return null;
  try {
    const o = JSON.parse(Buffer.from(v, 'base64url').toString('utf8'));
    if (!o || typeof o !== 'object' || !o.s) return null;
    return { s: clip(o.s, 40).toLowerCase() || 'direct', m: clip(o.m, 40).toLowerCase(), c: clip(o.c, 60), l: clip(o.l, 40), r: clip(o.r, 60).toLowerCase(), t: Number(o.t) || 0 };
  } catch { return null; }
}
function readCookie(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === COOKIE) return decode(decodeURIComponent(part.slice(i + 1).trim()));
  }
  return null;
}
function addCookie(res, c) {
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [...(prev == null ? [] : [].concat(prev)), c]);
}

function createFunnel({ store }) {
  let ins = null;
  const stmt = () => ins || (ins = store.db.prepare('INSERT OR IGNORE INTO funnel (uid, step, at) VALUES (?, ?, ?)'));
  const seen = new Set(); // uid:шаг, уже записанные — чтобы не ходить в базу на каждое сообщение
  function mark(uid, step) {
    if (!uid || !STEPS.includes(step)) return false;
    const k = uid + ':' + step; if (seen.has(k)) return false;
    if (seen.size > 200000) seen.clear();
    seen.add(k);
    try { return stmt().run(uid, step, Date.now()).changes > 0; } catch (e) { console.log('funnel:', e.message); return false; }
  }
  // HTML-страница сайта: запоминаем источник первого визита на 90 дней.
  // Уже сохранённый источник не перезаписываем — кроме «прямого захода», если теперь есть настоящий источник.
  function touch(req, res, url, secure) {
    const old = readCookie(req), now = detect(url, req.headers.referer, req.headers.host);
    if (old && !(old.s === 'direct' && now.s !== 'direct')) return old;
    addCookie(res, `${COOKIE}=${encode(now)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL / 1000}${secure ? '; Secure' : ''}`);
    return now;
  }
  // источник для нового аккаунта (из cookie первого визита)
  const srcOf = (req) => readCookie(req);
  // шаги пользователей: Map uid -> Set шагов (события не раньше since)
  function steps(since = 0) {
    const out = new Map();
    let rows = []; try { rows = store.db.prepare('SELECT uid, step FROM funnel WHERE at >= ?').all(since); } catch {}
    for (const r of rows) { let s = out.get(r.uid); if (!s) out.set(r.uid, (s = new Set())); s.add(r.step); }
    return out;
  }
  const forget = (uid) => { try { store.db.prepare('DELETE FROM funnel WHERE uid = ?').run(uid); } catch {} for (const s of STEPS) seen.delete(uid + ':' + s); };
  return { mark, touch, srcOf, steps, forget, productKind, STEPS, CLIENT_STEPS };
}

module.exports = { createFunnel, productKind, detect, decode, encode, refHost, STEPS, CLIENT_STEPS, COOKIE };
