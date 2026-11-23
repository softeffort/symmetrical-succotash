'use strict';
// Превью сайтов из облачного компьютера. Код сайта пишет пользователь или модель, поэтому сайт открывается не на
// адресе Premier, а на отдельном (CLOUD_PREVIEW_URL): там нет cookie Premier, а запросы с него к API Premier
// отклоняются (fromPreview в server.js).
// Адрес и режим — в cloud-preview-config.js: у каждого открытия сайта свой случайный поддомен (CLD-13).
// Вход: Premier выдаёт одноразовую ссылку (open), адрес превью обменивает её на свою cookie и проксирует запросы
// (и WebSocket) в контейнер пользователя на нужный порт — через ретранслятор (cloud.connect).
const http = require('http');
const crypto = require('crypto');
const cloud = require('./cloud');

const { PARSED, CFG, WHY } = require('./cloud-preview-config');
if (WHY) console.log(WHY);
// CLD-14: пределы превью — запросов и WebSocket одновременно на пользователя, ожидание ответа сервера в контейнере, тишина в потоке
const num = (k, d, min) => { const v = Number(process.env[k]); return Number.isFinite(v) && v >= min ? Math.floor(v) : d; };
const REQ_MAX = num('CLOUD_PREVIEW_MAX_REQ', 32, 1), WS_MAX = num('CLOUD_PREVIEW_MAX_WS', 16, 1);
const HEAD_MS = num('CLOUD_PREVIEW_HEAD_MS', 60e3, 100), IDLE_MS = num('CLOUD_PREVIEW_IDLE_MS', 300e3, 100);
const active = new Map(); // uid -> { req, ws }
const slot = (uid, kind, max) => {
  const a = active.get(uid) || { req: 0, ws: 0 };
  if (a[kind] >= max) return null;
  a[kind]++; active.set(uid, a);
  let freed = false;
  return () => { if (freed) return; freed = true; a[kind]--; if (!a.req && !a.ws) active.delete(uid); };
};
const COOKIE = 'premier_pc', TOKEN_TTL = 60e3, SESSION_TTL = 12 * 3600e3;
const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const rand = (n) => crypto.randomBytes(n).toString('hex');
const hostOf = (req) => String(req.headers.host || '').toLowerCase();
let allow = () => false; // init: тариф пользователя ещё позволяет облачный компьютер

const tokens = new Map(), sessions = new Map(); // одноразовые ссылки и вошедшие браузеры
setInterval(() => { const now = Date.now(); for (const mp of [tokens, sessions]) for (const [k, v] of mp) if (v.exp < now) mp.delete(k); }, 60e3).unref();

function label(host) { // поддомен превью (режим *.) или '' для единственного адреса; null — чужой адрес
  if (!CFG) return null;
  if (!CFG.wild) return host === CFG.host ? '' : null;
  const sub = host.endsWith('.' + CFG.host) ? host.slice(0, -CFG.host.length - 1) : '';
  return /^[a-f0-9]{16}$/.test(sub) ? sub : null;
}
// адрес превью выключенного режима (один адрес без поддоменов): сайт не открываем, но и приложение Premier на нём не показываем
// (то же — для адреса без поддомена и для поддоменов неверного вида при включённых поддоменах)
const parked = (req) => { const h = hostOf(req); return !!PARSED && (h === PARSED.host || h.endsWith('.' + PARSED.host)) && label(h) == null; };
const match = (req) => label(hostOf(req)) != null || parked(req);
// запрос пришёл со страницы превью (защита API Premier от чужого кода сайта)
function fromPreview(req) {
  const o = req.headers.origin; if (!PARSED || !o) return false;
  try { const h = new URL(o).host.toLowerCase(); return h === PARSED.host || h.endsWith('.' + PARSED.host); } catch { return false; }
}

function open(uid, port) {
  const id = CFG.wild ? rand(8) : '', t = rand(24);
  tokens.set(t, { uid, port, id, exp: Date.now() + TOKEN_TTL });
  return `${CFG.proto}://${id ? id + '.' : ''}${CFG.host}/__premier/open?t=${t}`;
}

const page = (res, code, title, text, retry) => {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  res.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${retry ? '<meta http-equiv="refresh" content="3">' : ''}<title>${title}</title><body style="font:16px/1.6 system-ui;background:#101014;color:#ccc;padding:32px;max-width:640px"><h2 style="color:#eee;font-weight:600">${title}</h2><p>${text}</p></body></html>`);
};
function session(req) {
  const c = String(req.headers.cookie || '').split(/;\s*/).find((x) => x.startsWith(COOKIE + '='));
  const [sid, secret] = (c ? c.slice(COOKIE.length + 1) : '').split('.');
  const s = sid && sessions.get(sid), id = label(hostOf(req));
  if (!s || s.exp < Date.now() || s.id !== id || !secret || secret.length !== s.secret.length || !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(s.secret))) return null;
  return allow(s.uid) ? s : null;
}
// заголовки для сервера в контейнере: Host — localhost (dev-серверы вроде Vite не пускают чужие имена), без cookie превью
function headersFor(req, s, upgrade) {
  const h = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) || (upgrade && (k === 'connection' || k === 'upgrade'))) h[k] = v;
  h.host = 'localhost:' + s.port;
  const ck = String(req.headers.cookie || '').split(/;\s*/).filter((x) => x && !x.startsWith(COOKIE + '=')).join('; ');
  if (ck) h.cookie = ck; else delete h.cookie;
  h['x-forwarded-host'] = hostOf(req); h['x-forwarded-proto'] = CFG.proto;
  return h;
}

async function handle(req, res) {
  if (parked(req)) return CFG ? page(res, 404, 'Нет такого сайта', 'Откройте сайт из Premier кнопкой «Открыть сайт».')
    : page(res, 503, 'Превью сайтов выключено', 'Для сайтов облачного компьютера на этом сервере не настроены отдельные поддомены. Владельцу сервера: укажите CLOUD_PREVIEW_URL с «*.».');
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__premier/open') {
    const t = tokens.get(url.searchParams.get('t') || ''); tokens.delete(url.searchParams.get('t') || '');
    if (!t || t.exp < Date.now() || t.id !== label(hostOf(req))) return page(res, 403, 'Ссылка устарела', 'Откройте сайт заново из Premier — кнопкой «Открыть сайт».');
    const sid = rand(9), secret = rand(24);
    sessions.set(sid, { uid: t.uid, port: t.port, id: t.id, secret, exp: Date.now() + SESSION_TTL });
    res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store', ...(CFG.wild ? {} : { 'Clear-Site-Data': '"cache", "storage"' }), 'Set-Cookie': `${COOKIE}=${sid}.${secret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}${CFG.proto === 'https' ? '; Secure' : ''}` });
    return res.end();
  }
  const s = session(req);
  if (!s) return page(res, 401, 'Нет доступа', 'Сайты облачного компьютера видит только владелец. Откройте сайт из Premier кнопкой «Открыть сайт».');
  if (!cloud.awake(s.uid)) return page(res, 503, 'Облачный компьютер спит', 'Без действий компьютер засыпает, и серверы останавливаются. Запустите сервер снова в Premier — страница обновится сама.', true);
  // CLD-14: не больше REQ_MAX запросов одного пользователя одновременно; место освобождается, когда ответ закрыт
  const free = slot(s.uid, 'req', REQ_MAX);
  if (!free) { res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '2', 'Cache-Control': 'no-store' }); return res.end('Слишком много запросов к сайту одновременно — повторите через пару секунд.'); }
  cloud.touch(s.uid);
  let timer = null, got = false, over = false;
  const arm = (ms, fn) => { clearTimeout(timer); timer = setTimeout(fn, ms); };
  const end = () => { if (over) return; over = true; clearTimeout(timer); free(); up.destroy(); }; // соединение с контейнером закрывается всегда
  const up = http.request({ createConnection: () => cloud.connect(s.uid, s.port), method: req.method, path: req.url, headers: headersFor(req, s) }, (r) => {
    got = true;
    const h = { ...r.headers };
    for (const k of Object.keys(h)) if (HOP.has(k)) delete h[k];
    // перенаправления сервера на localhost:порт ведут на адрес превью
    if (h.location) h.location = String(h.location).replace(new RegExp(`^https?://(localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0)(:${s.port})?(?=/|$)`, 'i'), '') || '/';
    res.writeHead(r.statusCode, r.statusMessage, h);
    const idle = () => arm(IDLE_MS, () => { res.destroy(); end(); }); // поток молчит слишком долго — закрываем обе стороны
    idle(); r.on('data', idle); res.on('drain', idle);
    r.on('error', () => res.destroy());
    r.pipe(res);
  });
  // сервер в контейнере принял соединение, но не отвечает: 504 вместо вечного ожидания (пока браузер шлёт тело запроса — ждём)
  const late = () => { if (got || over) return; end(); if (res.headersSent) return res.destroy(); page(res, 504, `Сервер на порту ${s.port} не отвечает`, 'Сервер в облачном компьютере не ответил вовремя. Проверьте его в Premier — страница обновится сама.', true); };
  arm(HEAD_MS, late); req.on('data', () => { if (!got && !over) arm(HEAD_MS, late); });
  up.on('error', (e) => {
    if (over) return; end();
    if (res.headersSent) return res.destroy();
    page(res, 502, `На порту ${s.port} ничего не отвечает`, `Сервер на этом порту не запущен. Запустите его в Premier — страница обновится сама.<br><small style="color:#888">${String(e.code || e.message).replace(/[<&]/g, '')}</small>`, true);
  });
  // браузер ушёл (закрыл вкладку, отменил запрос) или ответ отдан — соединение с контейнером закрывается (раньше оно оставалось висеть)
  res.on('close', end);
  req.on('error', end);
  req.pipe(up);
}

async function upgrade(req, socket, head) {
  if (parked(req)) return socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
  const s = session(req);
  if (!s || !cloud.awake(s.uid)) return socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  const free = slot(s.uid, 'ws', WS_MAX); // CLD-14
  if (!free) return socket.end('HTTP/1.1 429 Too Many Requests\r\nRetry-After: 2\r\nConnection: close\r\n\r\n');
  cloud.touch(s.uid);
  const up = cloud.connect(s.uid, s.port), h = headersFor(req, s, true);
  up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(h).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `${k}: ${x}\r\n`)).join('') + '\r\n');
  if (head?.length) up.write(head);
  up.pipe(socket); socket.pipe(up);
  const done = () => { free(); up.destroy(); socket.destroy(); };
  up.on('error', done); socket.on('error', done); up.on('close', done); socket.on('close', done);
  up.on('data', () => cloud.touch(s.uid));
}

module.exports = { on: !!CFG, init: (x) => { allow = x.allow; }, match, fromPreview, open, handle, upgrade, CFG, REQ_MAX, WS_MAX, active };
