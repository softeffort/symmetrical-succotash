'use strict';
// Общие помощники API-шлюза: ключи, ошибки в форматах OpenAI/Anthropic, SSE, оценка токенов.
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function randomB62(n) {
  let s = '';
  while (s.length < n) for (const b of crypto.randomBytes(n * 2)) { if (b < 248) { s += B62[b % 62]; if (s.length === n) break; } } // 248 = 62·4 — без смещения
  return s;
}
function toB62(num, len) { let s = ''; for (let i = 0; i < len; i++) { s = B62[num % 62] + s; num = Math.floor(num / 62); } return s; }

// Ключ: prm_ + 36 случайных + 6 символов CRC32 — опечатку видно без запроса к базе, сканеры секретов узнают формат.
const KEY_RE = /^prm_([0-9A-Za-z]{36})([0-9A-Za-z]{6})$/;
// Старый формат (до v2): sk-premier-<64 hex> — принимается для совместимости с выданными ранее ключами.
const LEGACY_KEY_RE = /^sk-premier-[a-f0-9]{64}$/i;
const newKey = () => { const body = randomB62(36); return 'prm_' + body + toB62(zlib.crc32(body), 6); };
const keyLooksValid = (k) => { const s = String(k || ''); if (LEGACY_KEY_RE.test(s)) return true; const m = KEY_RE.exec(s); return !!m && toB62(zlib.crc32(m[1]), 6) === m[2]; };
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const rid = (prefix, n = 24) => prefix + randomB62(n);

/* ---------- ошибки ---------- */
// kind → [HTTP, тип OpenAI, код OpenAI, тип Anthropic]
const KINDS = {
  invalid: [400, 'invalid_request_error', null, 'invalid_request_error'],
  context: [400, 'invalid_request_error', 'context_length_exceeded', 'invalid_request_error'],
  auth: [401, 'invalid_request_error', 'invalid_api_key', 'authentication_error'],
  permission: [403, 'invalid_request_error', 'permission_denied', 'permission_error'],
  not_found: [404, 'invalid_request_error', 'model_not_found', 'not_found_error'],
  too_large: [413, 'invalid_request_error', 'request_too_large', 'request_too_large'],
  rate_limit: [429, 'rate_limit_error', 'rate_limit_exceeded', 'rate_limit_error'],
  quota: [429, 'insufficient_quota', 'insufficient_quota', 'rate_limit_error'],
  upstream: [502, 'server_error', 'upstream_error', 'api_error'],
  overloaded: [503, 'server_error', 'overloaded', 'overloaded_error'],
  timeout: [504, 'server_error', 'timeout', 'api_error'],
  server: [500, 'server_error', 'internal_error', 'api_error'],
};
class ApiError extends Error {
  constructor(kind, message, extra = {}) { super(message); this.kind = KINDS[kind] ? kind : 'server'; Object.assign(this, extra); }
  get status() { return KINDS[this.kind][0]; }
}
const err = (kind, message, extra) => new ApiError(kind, message, extra);
function errorBody(e, proto) {
  const [, type, code, aType] = KINDS[e.kind] || KINDS.server;
  if (proto === 'messages') return { type: 'error', error: { type: aType, message: e.message } };
  return { error: { message: e.message, type, param: e.param || null, code: e.code || code } };
}
function sendError(res, e, proto) {
  if (res.headersSent) return res.end();
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (e.retryAfter) headers['Retry-After'] = String(Math.max(1, Math.ceil(e.retryAfter)));
  if (e.shouldRetry === false) headers['x-should-retry'] = 'false';
  else if (e.shouldRetry === true) headers['x-should-retry'] = 'true';
  const status = proto === 'messages' && e.kind === 'overloaded' ? 529 : (KINDS[e.kind] || KINDS.server)[0];
  res.writeHead(status, headers);
  res.end(JSON.stringify(errorBody(e, proto)));
}

/* ---------- SSE ---------- */
// Поток событий с обратным давлением и пингами: Claude Code рвёт соединение, если долго тихо.
const WRITE_TIMEOUT_MS = Math.max(1, Number(process.env.API_WRITE_TIMEOUT_MS) || 60000);
function sseStream(res, { anthropic = false, keepaliveMs = 12000, writeTimeoutMs = WRITE_TIMEOUT_MS } = {}) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  if (res.socket) res.socket.setNoDelay(true);
  let last = Date.now(), closed = false, pending = null;
  const write = (s) => {
    if (closed || res.destroyed || res.writableEnded) return Promise.resolve();
    last = Date.now();
    if (res.write(s)) return Promise.resolve();
    // клиент не читает: ждём освобождения буфера не дольше writeTimeoutMs, потом рвём соединение (иначе слот держится вечно)
    if (pending) return pending;
    pending = new Promise((r) => {
      const t = setTimeout(() => res.destroy(), writeTimeoutMs);
      const done = () => { clearTimeout(t); res.off('drain', done); res.off('close', done); pending = null; r(); };
      res.once('drain', done); res.once('close', done);
    });
    return pending;
  };
  const timer = setInterval(() => {
    if (pending || Date.now() - last < keepaliveMs - 500) return;
    write(anthropic ? 'event: ping\ndata: {"type":"ping"}\n\n' : ': keepalive\n\n');
  }, keepaliveMs);
  timer.unref();
  const stop = () => { closed = true; clearInterval(timer); };
  res.on('close', stop);
  return {
    event: (name, data) => write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`),
    data: (data) => write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`),
    raw: write,
    end: () => { stop(); if (!res.writableEnded) res.end(); },
  };
}

// Разбор SSE из ReadableStream (fetch). Отдаёт { event, data } на каждое событие.
// onChunk(chunk) вызывается на каждый полученный кусок (в том числе на комментарии «: keepalive») — для таймера тишины и счётчика байт.
const MAX_SSE_BUF = 16 * 1048576;
const NL = /\r\n|\n|\r/g;
async function* readSse(body, signal, onChunk) {
  const dec = new TextDecoder();
  let buf = '', scan = 0, event = '', data = [], dataSize = 0;
  const tooBig = () => err('upstream', 'The model provider sent an event that is too large.');
  for await (const chunk of body) {
    if (signal && signal.aborted) return;
    if (onChunk) onChunk(chunk);
    buf += dec.decode(chunk, { stream: true });
    let pos = 0;
    for (;;) {
      NL.lastIndex = Math.max(pos, scan);
      const m = NL.exec(buf);
      if (!m) break;
      const i = m.index;
      if (buf[i] === '\r' && i === buf.length - 1) { scan = i; break; } // CRLF мог разорваться между кусками
      const line = buf.slice(pos, i);
      pos = i + (buf[i] === '\r' && buf[i + 1] === '\n' ? 2 : 1); scan = pos;
      if (line === '') { if (data.length) yield { event: event || 'message', data: data.join('\n') }; event = ''; data = []; dataSize = 0; continue; }
      if (line[0] === ':') continue;
      const c = line.indexOf(':'), field = c < 0 ? line : line.slice(0, c);
      let value = c < 0 ? '' : line.slice(c + 1); if (value[0] === ' ') value = value.slice(1);
      if (field === 'data') { dataSize += value.length; if (dataSize > MAX_SSE_BUF) throw tooBig(); data.push(value); } else if (field === 'event') event = value;
    }
    if (pos) { buf = buf.slice(pos); scan -= pos; if (scan < 0) scan = 0; }
    if (buf.length > MAX_SSE_BUF) throw tooBig();
    // дальше ищем перевод строки только в новых данных (длинная строка без переводов не пересканируется)
    if (!buf.endsWith('\r')) scan = buf.length; else scan = buf.length - 1;
  }
  buf += dec.decode();
  if (buf && buf.startsWith('data:')) data.push(buf.slice(5).trimStart());
  if (data.length) yield { event: event || 'message', data: data.join('\n') };
}

// Глубина вложенности JSON-значения (без рекурсии). Слишком глубокие тела роняют рекурсивные обходчики (cleanSchema, JSON.stringify).
const MAX_DEPTH = 100;
function checkDepth(v, max = MAX_DEPTH) {
  if (!v || typeof v !== 'object') return;
  const stack = [[v, 1]];
  while (stack.length) {
    const [x, d] = stack.pop();
    if (d > max) throw err('invalid', `The request JSON is nested too deeply (more than ${max} levels).`);
    for (const k of Array.isArray(x) ? x.keys() : Object.keys(x)) { const y = x[k]; if (y && typeof y === 'object') stack.push([y, d + 1]); }
  }
}

/* ---------- оценка токенов (без токенизатора: ~4 байта UTF-8 на токен) ---------- */
function estimateTokens(messages, tools) {
  let bytes = 0, images = 0;
  for (const m of messages || []) {
    if (!m) continue;
    if (typeof m.content === 'string') bytes += Buffer.byteLength(m.content);
    else if (Array.isArray(m.content)) for (const p of m.content) {
      if (!p) continue;
      if (p.type === 'text') bytes += Buffer.byteLength(String(p.text || ''));
      else if (p.type === 'image_url') images++;
      else if (p.type === 'file') images += 2;
    }
    if (m.tool_calls) bytes += Buffer.byteLength(JSON.stringify(m.tool_calls));
    bytes += 12;
  }
  if (tools && tools.length) bytes += Buffer.byteLength(JSON.stringify(tools));
  return Math.ceil(bytes / 4) + images * 1100;
}

// Идентификатор вызова инструмента для клиента: исходный id провайдера внутри (base64url) + случайный хвост.
// Так id уникален во всём диалоге (у некоторых провайдеров id повторяются) и обратимо превращается в исходный.
const TOOL_TAIL = 6;
const encodeToolId = (upstreamId, prefix) => prefix + 'pm' + Buffer.from(String(upstreamId)).toString('base64url') + randomB62(TOOL_TAIL);
function decodeToolId(id) {
  const s = String(id || ''); const m = /^(?:toolu_|call_|fc_)pm([A-Za-z0-9_-]+)$/.exec(s);
  if (!m || m[1].length <= TOOL_TAIL) return s;
  const enc = m[1].slice(0, -TOOL_TAIL), raw = Buffer.from(enc, 'base64url').toString('utf8');
  return raw && Buffer.from(raw).toString('base64url') === enc && !/[\u0000-\u001f]/.test(raw) ? raw : s;
}

// Тело запроса: JSON до limit байт, gzip/deflate/br/zstd.
// stat (необязательно) получает bytes — размер тела после распаковки: по нему резерв памяти уточняется (API-05).
function readJson(req, limit, timeoutMs = 0, stat = null) {
  return new Promise((ok0, fail0) => {
    // срок на всё тело: медленная загрузка по байту не держит место в бюджете и слот бесконечно
    const tm = timeoutMs > 0 ? setTimeout(() => { fail0(err('timeout', 'The request body was not received in time')); try { req.destroy(); } catch {} }, timeoutMs) : null;
    const ok = (v) => { if (tm) clearTimeout(tm); ok0(v); }, fail = (e) => { if (tm) clearTimeout(tm); fail0(e); };
    const enc = String(req.headers['content-encoding'] || 'identity').toLowerCase();
    let src = req;
    try {
      if (enc === 'gzip' || enc === 'x-gzip') src = req.pipe(zlib.createGunzip());
      else if (enc === 'deflate') src = req.pipe(zlib.createInflate());
      else if (enc === 'br') src = req.pipe(zlib.createBrotliDecompress());
      else if (enc === 'zstd' && zlib.createZstdDecompress) src = req.pipe(zlib.createZstdDecompress());
      else if (enc !== 'identity') return fail(err('invalid', `Unsupported Content-Encoding: ${enc}`));
    } catch { return fail(err('invalid', 'Could not decode the request body')); }
    const parts = []; let n = 0, over = false;
    // клиент оборвал загрузку: через gunzip/inflate это само не дойдёт до 'end'/'error' — иначе запрос завис бы навсегда
    req.on('error', () => { if (!over) { over = true; fail(err('invalid', 'The request body was interrupted')); } src.destroy(); });
    req.on('close', () => { if (!req.complete && !over) { over = true; fail(err('invalid', 'The request body was interrupted')); if (src !== req) src.destroy(); } });
    src.on('data', (c) => { if (over) return; n += c.length; if (n > limit) { over = true; fail(err('too_large', `Request body is larger than ${Math.round(limit / 1048576)} MB`)); if (src !== req) { req.unpipe(src); src.destroy(); } req.resume(); } else parts.push(c); });
    src.on('error', () => { if (!over) fail(err('invalid', 'Could not read the request body')); over = true; });
    src.on('end', () => {
      if (over) return;
      const buf = Buffer.concat(parts); parts.length = 0; // куски больше не нужны — не держим тело в памяти дважды
      if (stat) stat.bytes = buf.length;
      const s = buf.toString('utf8');
      if (!s.trim()) return fail(err('invalid', 'Request body is empty; send a JSON object'));
      try { const j = JSON.parse(s); if (!j || typeof j !== 'object' || Array.isArray(j)) throw 0; ok(j); }
      catch { fail(err('invalid', 'Request body is not valid JSON')); }
    });
  });
}

// Потолок на весь ответ API и на тело, которое мы читаем у провайдера целиком (API_RESPONSE_MAX_MB, по умолчанию 32 МБ).
const RESPONSE_LIMIT = Math.max(1, Number(process.env.API_RESPONSE_MAX_MB) || 32) * 1048576;
// Тело ответа провайдера — потоком, с потолком (вместо res.text() без предела). onBytes(n) вызывается на каждый кусок (учёт памяти).
// truncate: тело длиннее предела обрезается (для текста ошибки), иначе — ошибка upstream.
async function readBodyLimited(res, limit = RESPONSE_LIMIT, { onBytes, truncate = false } = {}) {
  if (!res.body) return '';
  const dec = new TextDecoder(); let n = 0, s = '';
  for await (const c of res.body) {
    if (onBytes) onBytes(c.length);
    n += c.length;
    if (n > limit) { if (truncate) { s += dec.decode(c.subarray(0, Math.max(0, c.length - (n - limit)))); return s; } throw err('upstream', 'The model provider response is larger than the allowed size.'); }
    s += dec.decode(c, { stream: true });
  }
  return s + dec.decode();
}

// Клиент по заголовкам — для журнала и «подключено» в кабинете.
const CLIENTS = [
  [/claude[- ]?(cli|code)/i, 'Claude Code'], [/codex/i, 'Codex'], [/cursor/i, 'Cursor'], [/\bcline\b/i, 'Cline'],
  [/roo-?code|roocode/i, 'Roo Code'], [/kilo-?code/i, 'Kilo Code'], [/opencode/i, 'OpenCode'], [/aider|litellm/i, 'Aider'],
  [/continue/i, 'Continue'], [/\bzed\b/i, 'Zed'], [/jetbrains|intellij/i, 'JetBrains'], [/crush/i, 'Crush'],
  [/^curl\//i, 'curl'], [/anthropic\/python|anthropic-python/i, 'Anthropic Python'], [/anthropic\/js|anthropic-typescript/i, 'Anthropic Node'],
  [/openai\/python/i, 'OpenAI Python'], [/openai\/js/i, 'OpenAI Node'], [/python-requests|httpx|aiohttp/i, 'Python'],
  [/node-fetch|undici|axios|node\b/i, 'Node.js'], [/premier-playground/i, 'Playground'],
];
function detectClient(req) {
  const h = req.headers, ua = String(h['user-agent'] || '');
  const hints = [ua, String(h.originator || ''), String(h['x-title'] || ''), String(h['http-referer'] || h.referer || ''), String(h['x-client-name'] || '')].join(' ');
  for (const [re, name] of CLIENTS) if (re.test(hints)) return name;
  return ua ? ua.split(/[\s/]/)[0].slice(0, 40) : null;
}

module.exports = { RESPONSE_LIMIT, readBodyLimited, randomB62, newKey, keyLooksValid, sha256, rid, ApiError, err, errorBody, sendError, sseStream, readSse, estimateTokens, encodeToolId, decodeToolId, readJson, detectClient, checkDepth };
