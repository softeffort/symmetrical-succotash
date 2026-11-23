'use strict';
// Запросы к провайдеру модели (OpenAI-совместимый /chat/completions) и разбор его потока в единые события:
//   { t: 'text', d } · { t: 'think', d } · { t: 'tool', i, id, name } · { t: 'args', i, d }
const crypto = require('node:crypto');
const { err, readSse, randomB62, readBodyLimited, RESPONSE_LIMIT } = require('./util');

const FIRST_BYTE_MS = Math.min(600, Math.max(1, Number(process.env.MODEL_TIMEOUT) || 180)) * 1000;
// тишина после начала ответа (MODEL_IDLE_TIMEOUT, секунды); по умолчанию — не меньше 3 минут
const IDLE_MS = Number(process.env.MODEL_IDLE_TIMEOUT) > 0 ? Math.min(3600, Math.max(1, Number(process.env.MODEL_IDLE_TIMEOUT))) * 1000 : Math.max(FIRST_BYTE_MS, 180000);
const TOTAL_MS = 30 * 60000;
// не-потоковый нативный запрос: провайдер молчит, пока не сформирует весь ответ — ждём дольше
const NATIVE_WAIT_MS = Math.max(IDLE_MS, 600000);
// общий потолок одновременных запросов к провайдерам (защита процесса)
const GLOBAL_LIMIT = Math.max(1, Number(process.env.API_GLOBAL_CONCURRENCY) || 200);
let inflight = 0;
// поля, которые провайдер может не поддерживать: если он ругается на одно из них — повторяем без него
const OPTIONAL = ['stream_options', 'parallel_tool_calls', 'temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'seed', 'stop', 'logprobs', 'top_logprobs', 'user', 'reasoning_effort', 'reasoning', 'logit_bias'];
// провайдер+модель → { cap, at }: максимум max_tokens, который назвал провайдер (живёт CAP_TTL, не ниже CAP_MIN)
const learnedCap = new Map();
const CAP_TTL = 3600000, CAP_MIN = 1024;
const capKey = (model) => String((model && model.baseUrl) || '').trim().replace(/\/+$/, '') + '|' + ((model && (model.modelId || model.id)) || '');
const capGet = (key, now = Date.now()) => { const c = learnedCap.get(key); if (!c) return 0; if (now - c.at > CAP_TTL) { learnedCap.delete(key); return 0; } return c.cap; };
const capSet = (key, cap, now = Date.now()) => { if (key && cap >= CAP_MIN) learnedCap.set(key, { cap, at: now }); };

function chatUrl(baseUrl) {
  const u = String(baseUrl || '').trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(u) ? u : u + '/chat/completions';
}
function nativeUrl(model) {
  const u = String(model.nativeUrl || model.baseUrl || '').trim().replace(/\/+$/, '');
  if (model.native === 'anthropic') return /\/messages$/.test(u) ? u : /\/v1$/.test(u) ? u + '/messages' : u + '/v1/messages';
  return /\/responses$/.test(u) ? u : u + '/responses';
}

const msgOf = (text) => {
  try { const j = JSON.parse(text); const e = j.error || j; return String((e && (e.message || e.msg || e.detail)) || (typeof j.error === 'string' ? j.error : '') || text); } catch { return String(text || ''); }
};
// Секреты, которые шлюз знает сам: ключи провайдеров и их адреса из настроек моделей (API-02). Вырезаются по точному значению —
// регулярки ниже ловят только знакомые форматы и пропустили бы чужой формат ключа или адрес без схемы.
const secrets = new Set(); let secretRe = null;
const SECRET_MIN = 6; // короче — слишком много ложных срабатываний в обычном тексте
function registerSecrets(models) {
  let added = false;
  const add = (v) => { v = String(v == null ? '' : v).trim(); if (v.length >= SECRET_MIN && !secrets.has(v)) { secrets.add(v); added = true; } };
  for (const m of Array.isArray(models) ? models : [models]) {
    if (!m) continue;
    add(m.apiKey);
    for (const u of [m.baseUrl, m.nativeUrl]) {
      const t = String(u || '').trim().replace(/\/+$/, ''); if (!t) continue;
      add(t); add(t.replace(/^[a-z]+:\/\//i, ''));
      try { const x = new URL(t); add(x.host); add(x.hostname); } catch {}
    }
  }
  if (secrets.size > 2000) { secrets.clear(); added = true; } // потолок на случай бесконечно меняющихся настроек; ниже ничего не потеряем — модели регистрируются заново при каждом запросе
  if (added) secretRe = null;
}
const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function cutKnown(str) {
  if (!secrets.size) return str;
  if (!secretRe) {
    const all = new Set(); for (const v of secrets) { all.add(v); const e = encodeURIComponent(v); if (e !== v) all.add(e); }
    secretRe = new RegExp([...all].sort((a, b) => b.length - a.length).map(reEsc).join('|'), 'gi');
  }
  return str.replace(secretRe, '[redacted]');
}
// Сообщение провайдера наружу — без адресов и ключей
const scrub = (s) => cutKnown(String(s)).replace(/https?:\/\/\S+/g, '[url]').replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '[host]').replace(/\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|ai|ru|dev|cloud|app|co|xyz|tech|cn|eu|us|me|info|online|site|top)\b(?::\d+)?/gi, '[host]').replace(/\b(?=[A-Za-z_-]*\d)[A-Za-z0-9][A-Za-z0-9_-]{23,}\b/g, '[redacted]').replace(/\b(sk|rk|pk|key|prm)[-_][A-Za-z0-9_-]{8,}/gi, '[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/\s+/g, ' ').trim().slice(0, 400);
const CONTEXT_RE = /context.{0,20}(length|window|limit)|too many tokens|prompt is too long|input is too long|reduce the length|maximum context|exceeds? the (model'?s? )?(context|maximum)|context_length_exceeded|token limit/i;
// у провайдера кончились деньги/квота — это проблема владельца сервиса, а не клиента
const CREDIT_RE = /credit balance|insufficient[_ ](quota|credit|funds)|out of credit|billing|quota exceeded|exceeded your current quota|payment required/i;
const CREDIT_429_RE = /insufficient[_ ](quota|credit|funds)|credit balance|exceeded your current quota|billing/i;
const isCredit = (status, raw) => (status === 429 ? CREDIT_429_RE : CREDIT_RE).test(raw) && (status === 429 || status === 400 || status === 402 || status === 403);
// «контекст» — только по 400/413/422 или по коду context_length_exceeded: у 429/5xx «token limit» значит другое (лимит скорости)
const isContext = (status, raw, text) => (status === 400 || status === 413 || status === 422 ? CONTEXT_RE.test(raw) : false) || /context_length_exceeded/.test(String(text || ''));

function upstreamError(status, text, retryAfter, onAlert) {
  const raw = msgOf(text), m = scrub(raw);
  if (isCredit(status, raw)) {
    if (onAlert) onAlert(`Провайдер модели: закончились деньги/квота (HTTP ${status}): ${m}`);
    return err('upstream', 'The model provider account is out of credit. The administrator has been notified.', { outOfCredit: true });
  }
  if (isContext(status, raw, text)) return err('context', 'prompt is too long: ' + (m || 'the conversation does not fit into the model context window'));
  if (status === 400 || status === 413 || status === 422) return err('invalid', 'The model provider rejected the request: ' + (m || 'HTTP ' + status));
  if (status === 401 || status === 403 || status === 402) {
    if (onAlert) onAlert(`Провайдер модели ответил ${status}: ${m}`);
    return err('upstream', status === 402 ? 'The model provider account is out of credit. The administrator has been notified.' : 'The model provider rejected the server credentials. The administrator has been notified.');
  }
  if (status === 404) return err('upstream', 'The model is not available at the provider right now: ' + m);
  if (status === 429) return err('rate_limit', 'The model provider is rate limiting requests, retry shortly.' + (m ? ' (' + m + ')' : ''), { retryAfter: Math.min(120, Number(retryAfter) || 10), shouldRetry: true });
  if (status === 408 || status === 504) return err('timeout', 'The model provider timed out. Retry the request.', { retryAfter: 5, ...(status === 504 ? { shouldRetry: true } : {}) });
  return err('overloaded', `The model provider is temporarily unavailable (HTTP ${status}). Retry shortly.`, { retryAfter: 5, shouldRetry: true });
}

// Поле называют в тексте ошибки: в кавычках, после «parameter/unsupported…» или перед «is not supported»; составные имена (с «_») — по целому слову
const mentions = (low, k) => {
  const q = '[\'"`]' + k + '[\'"`]', w = k + '(?![a-z0-9_])', pre = '(^|[^a-z0-9_])';
  if (new RegExp(q).test(low)) return true;
  if (k.includes('_')) return new RegExp(pre + w).test(low);
  return new RegExp('(?:parameter|param|argument|field|property|unsupported|unrecognized|unknown|unexpected)\\W{0,8}' + w).test(low)
    || new RegExp(pre + w + '\\W{0,10}(?:is |are )?(?:not|un)(?:supported|recognized|allowed|known)').test(low);
};
// числа рядом со словами «maximum / at most / limit / up to»; цифры внутри идентификаторов моделей (gpt-4o-2024-08-06) не считаем
function capNumbers(raw, modelId) {
  let t = String(raw);
  if (modelId) t = t.split(String(modelId)).join(' ');
  t = t.replace(/\b[A-Za-z][A-Za-z0-9._\/-]*\d[A-Za-z0-9._\/-]*/g, ' ');
  const kw = /maximum|at most|<=|≤|limit|up to|\bmax\b|allowed/gi, out = [];
  const re = /\d{1,3}(?:[,_]\d{3})+|\d{3,7}/g;
  let m;
  while ((m = re.exec(t))) {
    const win = t.slice(Math.max(0, m.index - 45), m.index) + ' ' + t.slice(m.index + m[0].length, m.index + m[0].length + 45);
    if (kw.test(win)) out.push(Number(m[0].replace(/[,_]/g, '')));
    kw.lastIndex = 0;
  }
  return out;
}
// Подстраиваемся под ограничения провайдера по тексту ошибки 400. Возвращает новое тело или null.
function adapt(body, text, key, modelId) {
  const raw = msgOf(text), low = raw.toLowerCase(), b = { ...body };
  const ask = b.max_tokens ?? b.max_completion_tokens;
  // «maximum context length is 128000 … (100000 in the messages, 40000 in the completion)» — уменьшаем ответ
  const ctx = /maximum context length is (\d+)/i.exec(raw), inMsg = /(\d+) in the messages/i.exec(raw) || /input(?: length)?(?: of)? (\d+) tokens/i.exec(raw);
  if (ask && ctx && inMsg) {
    const room = Number(ctx[1]) - Number(inMsg[1]) - 64;
    if (room >= 512 && room < ask) { b[b.max_tokens != null ? 'max_tokens' : 'max_completion_tokens'] = room; return b; }
    return null;
  }
  if (b.max_tokens != null && /max_completion_tokens/.test(low) && /max_tokens/.test(low)) { b.max_completion_tokens = b.max_tokens; delete b.max_tokens; return b; }
  if (ask && /max_tokens|max_completion_tokens|max_output_tokens|maximum (output|completion)|output tokens|completion tokens/.test(low) && !CONTEXT_RE.test(raw)) {
    const nums = capNumbers(raw, modelId).filter((n) => n >= CAP_MIN && n < ask);
    const f = b.max_tokens != null ? 'max_tokens' : 'max_completion_tokens';
    if (nums.length) { b[f] = Math.max(...nums); capSet(key, b[f]); return b; }
    // число не названо: уменьшаем вдвое (не ниже минимума), ограничение ответа не снимаем — от него зависит стоимость Ultra
    if (ask / 2 >= CAP_MIN) { b[f] = Math.floor(ask / 2); return b; }
    return null;
  }
  for (const k of OPTIONAL) if (k in b && mentions(low, k)) { delete b[k]; return b; }
  if (b.stream_options && /stream.?options|include_usage/.test(low)) { delete b.stream_options; return b; }
  return null;
}

const sleep = (ms, signal) => new Promise((r) => { const t = setTimeout(r, ms); signal && signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });

/* ---------- повторы без двойной оплаты (API-10) ---------- */
// Сетевой повтор генерации может оплатиться у провайдера дважды: запрос мог дойти, а оборвался ответ. Поэтому:
//  · каждому запросу даём ключ идемпотентности (Idempotency-Key) — один и тот же во всех повторах этого тела;
//  · после неоднозначной сетевой ошибки (сброс соединения посреди обмена и т. п.) повторяем, только если провайдер подтверждённо
//    поддерживает ключ (model.idempotent === true или адрес в API_IDEMPOTENT_HOSTS), иначе отдаём ошибку клиенту;
//  · без ключа повторяем только то, что точно не ушло: отказ в соединении, DNS, недоступная сеть, таймаут соединения.
// API_IDEMPOTENCY_KEY=off — не отправлять заголовок вовсе.
const IDEM_HOSTS = new Set(String(process.env.API_IDEMPOTENT_HOSTS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
const SEND_IDEM = !/^(off|0|false|no)$/i.test(String(process.env.API_IDEMPOTENCY_KEY || ''));
const hostOfUrl = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } };
const supportsIdem = (model, url) => !!model && (model.idempotent === true || IDEM_HOSTS.has(hostOfUrl(url || chatUrl(model.baseUrl))));
const NEVER_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);
function neverSent(e) { for (let c = e, i = 0; c && i < 5; c = c.cause, i++) if (NEVER_SENT.has(c.code)) return true; return false; }
// Полученный HTTP 5xx не доказывает, что провайдер не выполнил (и не оплатил) генерацию: повторяем только при подтверждённой идемпотентности.
// Иначе клиент получает ошибку с shouldRetry и решает сам; автоматически повторяется лишь то, что точно не было отправлено (см. neverSent).
const retriable5xx = (status, idem) => status >= 500 && status !== 501 && !!idem;

// Открыть поток к провайдеру: повтор при сетевой ошибке/5xx (один раз, см. выше) и подстройка под 400.
// Возвращает { res, ac, kick, done } — kick() продлевает таймер тишины, done() снимает таймеры.
async function open(model, body, { signal, url, headers, onAlert, native = false }) {
  registerSecrets(model);
  if (signal && signal.aborted) throw err('invalid', 'Request cancelled');
  if (inflight >= GLOBAL_LIMIT) throw err('overloaded', 'The service is at capacity right now. Retry shortly.', { retryAfter: 5, shouldRetry: true });
  inflight++;
  const ac = new AbortController();
  const onAbort = () => ac.abort(signal.reason);
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  // не-потоковый нативный запрос: ответ приходит целиком и не сразу — ждём дольше
  const wait = native && body.stream !== true ? NATIVE_WAIT_MS : null, firstMs = wait || FIRST_BYTE_MS, idleMs = wait || IDLE_MS;
  let idle = null, finished = false; const total = setTimeout(() => ac.abort(new Error('total timeout')), TOTAL_MS);
  const kick = (ms = idleMs) => { clearTimeout(idle); idle = setTimeout(() => ac.abort(new Error('idle timeout')), ms); };
  const done = () => { if (finished) return; finished = true; inflight--; clearTimeout(idle); clearTimeout(total); if (signal) signal.removeEventListener('abort', onAbort); };
  let b = { ...body }, payload = null, idemKey = null;
  const idem = supportsIdem(model, url);
  const ckey = capKey(model);
  if (!native) {
    const cap = capGet(ckey);
    if (cap) for (const k of ['max_tokens', 'max_completion_tokens']) if (b[k] > cap) b[k] = cap;
  }
  try {
    for (let attempt = 0, retried = false; attempt < 6; attempt++) {
      kick(firstMs);
      // сериализуем до сети: слишком глубокий/неподходящий JSON — ошибка клиента (400), а не «сеть недоступна»
      if (payload == null) { idemKey = SEND_IDEM ? 'premier-' + crypto.randomUUID() : null; try { payload = JSON.stringify(native ? b : { ...b, model: model.modelId || model.id }); } catch { throw err('invalid', 'The request body could not be serialized (too deeply nested or contains unsupported values).'); } }
      let r;
      try {
        r = await fetch(url || chatUrl(model.baseUrl), { method: 'POST', signal: ac.signal, headers: { ...(headers || { 'Content-Type': 'application/json', Authorization: 'Bearer ' + model.apiKey }), ...(idemKey ? { 'Idempotency-Key': idemKey } : {}) }, body: payload });
      } catch (e) {
        if (signal && signal.aborted) throw err('invalid', 'Request cancelled');
        const timeout = /timeout/i.test(String(ac.signal.reason && ac.signal.reason.message));
        const safe = neverSent(e); // запрос точно не дошёл до провайдера
        if (!retried && !timeout && (safe || (idem && idemKey))) { retried = true; clearTimeout(idle); await sleep(1500, signal); continue; }
        if (timeout) throw err('timeout', 'The model did not start answering in time. Retry the request.', { retryAfter: 5 });
        if (safe) throw err('overloaded', 'Could not reach the model provider. Retry shortly.', { retryAfter: 5, shouldRetry: true });
        // неизвестно, дошёл ли запрос: автоматически не повторяем (не заплатить у провайдера дважды); списание клиенту вернётся — ответа нет
        throw err('upstream', 'The connection to the model provider was lost while the request was in flight, so it was not retried automatically. Retry the request.', { retryAfter: 2, shouldRetry: true });
      }
      if (r.ok) { kick(); return { res: r, ac, kick, done, body: b, onAlert }; }
      const text = await readBodyLimited(r, 262144, { truncate: true }).catch(() => ''); // текст ошибки провайдера — не больше 256 КБ
      if (!native && (r.status === 400 || r.status === 422)) { const nb = adapt(b, text, ckey, model.modelId || model.id); if (nb) { b = nb; payload = null; continue; } }
      if (!retried && retriable5xx(r.status, idem && !!idemKey)) { retried = true; clearTimeout(idle); await sleep(1500, signal); if (signal && signal.aborted) throw err('invalid', 'Request cancelled'); continue; }
      const e = upstreamError(r.status, text, r.headers.get('retry-after'), onAlert);
      e.upstreamStatus = r.status; e.upstreamText = native ? text : null;
      throw e;
    }
    throw err('upstream', 'The model provider rejected the request.');
  } catch (e) { done(); throw e; }
}

// Тело ошибки провайдера для клиента (нативный проход): только тип и сообщение, без адресов и ключей
function scrubBody(text, proto) {
  let j = null; try { j = JSON.parse(text); } catch {}
  const e = j && typeof j.error === 'object' && j.error ? j.error : j || {};
  const message = scrub(msgOf(text)) || 'The model provider rejected the request.';
  const type = typeof e.type === 'string' ? e.type.slice(0, 64) : 'invalid_request_error';
  if (proto === 'messages') return { type: 'error', error: { type, message } };
  return { error: { message, type, param: typeof e.param === 'string' ? e.param.slice(0, 64) : null, code: typeof e.code === 'string' ? e.code.slice(0, 64) : null } };
}

const normUsage = (u) => (u ? {
  in: Number(u.prompt_tokens ?? u.input_tokens) || 0,
  out: Number(u.completion_tokens ?? u.output_tokens) || 0,
  cached: Number((u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) ?? u.cache_read_input_tokens) || 0,
  think: Number(u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || 0,
} : null);

// Разбор потока Chat Completions. onChunk получает каждый (исправленный) кусок — для прозрачной передачи клиенту.
// ошибка в обработчиках событий (наш код, а не провайдер): не выдаём за обрыв соединения
class EmitFail { constructor(cause) { this.cause = cause; } }
async function pump(up, { onEvent, onChunk, signal, maxBytes = RESPONSE_LIMIT, onBytes }) {
  const st = { finish: null, usage: null, tools: new Map(), last: -1, done: false, content: false, stop: null };
  const onEv = onEvent || (async () => {});
  const emit = async (e) => { try { await onEv(e); } catch (x) { throw new EmitFail(x); } };
  const handle = async (j, whole) => {
    if (j.error) { const code = Number(j.error.code || j.error.status) || 502; throw upstreamError(code >= 400 && code < 600 ? code : 502, JSON.stringify(j), null, up.onAlert); }
    if (j.usage) st.usage = j.usage;
    const ch = Array.isArray(j.choices) ? j.choices[0] : null;
    if (ch) {
      const d = (whole ? ch.message : ch.delta) || {};
      if (Array.isArray(d.tool_calls)) for (const tc of d.tool_calls) {
        if (!tc || typeof tc !== 'object') continue;
        tc.function ||= {};
        let i = Number.isInteger(tc.index) ? tc.index : null;
        if (i == null) { // Gemini и др. не всегда присылают index
          const known = tc.id ? [...st.tools.entries()].find(([, t]) => t.up === tc.id) : null;
          i = known ? known[0] : tc.id || tc.function.name || st.last < 0 ? st.tools.size : st.last;
          tc.index = i;
        }
        let t = st.tools.get(i);
        if (!t) { t = { id: tc.id || 'call_' + randomB62(24), up: tc.id, name: '', args: '', started: false }; st.tools.set(i, t); if (!tc.id) tc.id = t.id; }
        if (tc.function.name && !t.name) t.name = tc.function.name;
        let a = tc.function.arguments;
        if (a != null && typeof a !== 'string') { a = JSON.stringify(a); tc.function.arguments = a; }
        if (a) t.args += a;
        st.content = true;
        if (t.name && !t.started) { t.started = true; await emit({ t: 'tool', i, id: t.id, name: t.name }); if (t.args) await emit({ t: 'args', i, d: t.args }); }
        else if (a && t.started) await emit({ t: 'args', i, d: a });
        st.last = i;
      }
      const rz = d.reasoning_content ?? d.reasoning;
      if (typeof rz === 'string' && rz) { st.content = true; await emit({ t: 'think', d: rz }); }
      if (typeof d.content === 'string' && d.content) { st.content = true; await emit({ t: 'text', d: d.content }); }
      if (typeof d.refusal === 'string' && d.refusal) { st.content = true; await emit({ t: 'text', d: d.refusal }); }
      if (ch.finish_reason) st.finish = ch.finish_reason;
      const sr = ch.stop_reason ?? ch.matched_stop; // vLLM и др. называют сработавшую стоп-последовательность
      if (typeof sr === 'string' && sr) st.stop = sr;
    }
    if (onChunk) { try { await onChunk(j); } catch (x) { throw new EmitFail(x); } }
  };
  try {
    const type = String(up.res.headers.get('content-type') || '');
    if (type.includes('application/json')) { // провайдер проигнорировал stream: true
      const text = await readBodyLimited(up.res, maxBytes, { onBytes });
      let j; try { j = JSON.parse(text); } catch { throw err('upstream', 'The model provider returned an unreadable response.'); }
      // для прозрачной передачи клиенту — в виде одного куска потока
      if (Array.isArray(j.choices)) j = { ...j, object: 'chat.completion.chunk', choices: j.choices.map((c) => ({ index: c.index || 0, delta: c.message || {}, finish_reason: c.finish_reason || 'stop' })) };
      await handle(j, false); st.done = true;
    } else {
      let total = 0; // весь принятый ответ ограничен (API-05): бесконечный поток не должен держать слот и память вечно
      for await (const ev of readSse(up.res.body, signal, (c) => { up.kick(); total += c.length; if (total > maxBytes) throw err('upstream', 'The model provider response is larger than the allowed size.'); })) {
        if (ev.data === '[DONE]') { st.done = true; break; }
        let j; try { j = JSON.parse(ev.data); } catch { continue; }
        await handle(j, false);
      }
    }
  } catch (e) {
    if (signal && signal.aborted) throw err('invalid', 'Request cancelled');
    if (e instanceof EmitFail) { const x = e.cause; if (x && x.kind) throw x; throw err('server', 'Internal server error. It has been logged.', { internal: x }); }
    if (e && e.kind) throw e;
    const reason = String(up.ac.signal.reason && up.ac.signal.reason.message || '');
    if (/timeout/.test(reason)) throw err('timeout', 'The model stopped responding. Retry the request.', { retryAfter: 5 });
    throw err('upstream', 'The connection to the model provider was interrupted. Retry the request.', { retryAfter: 2 });
  } finally { up.done(); }
  const incomplete = !st.finish && !st.done;
  if (incomplete) {
    // Провайдер закрыл поток без finish_reason / [DONE]. Если часть ответа (текст, размышления, вызовы инструментов) уже ушла клиенту —
    // не теряем её, но честно сообщаем «оборван» (length / incomplete / max_tokens); если не пришло ничего — ошибка с пометкой на повтор.
    if (!st.content) throw err('upstream', 'The model provider closed the stream before finishing. Retry the request.', { retryAfter: 2, shouldRetry: true });
  }
  for (const [i, t] of st.tools) if (!t.started) { t.started = true; t.name ||= 'unknown_tool'; await emit({ t: 'tool', i, id: t.id, name: t.name }); if (t.args) await emit({ t: 'args', i, d: t.args }); }
  let finish = st.finish || (incomplete ? 'length' : 'stop');
  if (st.tools.size && finish === 'stop') finish = 'tool_calls';
  return { finish, incomplete, stop: st.stop, usage: normUsage(st.usage), tools: st.tools };
}

module.exports = { registerSecrets, cutKnown, supportsIdem, neverSent, open, pump, chatUrl, nativeUrl, upstreamError, normUsage, scrub, scrubBody, msgOf, adapt, learnedCap, capKey, capGet, capSet, capNumbers };
