'use strict';
// Прямая передача (native Anthropic Messages / OpenAI Responses): слежение за протоколом и очистка событий провайдера (API-02/03/04).
//  · «доставлено» (delivered) — только если клиент получил полезный результат: непустой текст/размышление или готовый вызов инструмента.
//    Пустой content_block_start / output_item.added — ещё не результат: если дальше ничего нет, списание возвращается;
//  · поток обязан закончиться финальным событием (message_stop / response.completed|incomplete|failed / error). Конец без него — обрыв:
//    клиент получает ошибку протокола, а не «успех», журнал — 502;
//  · события error / response.failed и ответы провайдера не передаются сырыми: остаются тип, код и очищенный текст (up.scrub),
//    без ключей и адресов провайдера; нечитаемые данные не пересылаются;
//  · событие с ошибкой собирается заново из списка допустимых полей (лишние поля провайдера — debug, url, ключи — отбрасываются);
//    остальные события (и успешные ответы целиком) идут клиенту как есть, но из каждой строки на любой глубине вырезаются
//    известные значения: ключи и адреса провайдера (точное совпадение, cut = up.cutKnown). Имя SSE-события — только [a-z_.], иначе берётся type.
const { err } = require('./util');

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';
const jsonObj = (s) => { if (s == null || s === '') return true; if (isObj(s)) return true; try { return isObj(JSON.parse(s)); } catch { return false; } };

/* ---------- что считать результатом ---------- */
// блок content из Messages (непотоковый ответ или content_block_start с готовым содержимым)
function usefulBlock(c) {
  if (!isObj(c)) return false;
  if (c.type === 'text') return nonEmpty(c.text);
  if (c.type === 'thinking') return nonEmpty(c.thinking);
  if (c.type === 'tool_use') return nonEmpty(c.name) && isObj(c.input);
  return false;
}
// элемент output из Responses
function usefulItem(it) {
  if (!isObj(it)) return false;
  switch (it.type) {
    case 'message': return Array.isArray(it.content) && it.content.some((p) => isObj(p) && ((p.type === 'output_text' && nonEmpty(p.text)) || (p.type === 'refusal' && nonEmpty(p.refusal))));
    case 'function_call': return nonEmpty(it.name) && typeof it.arguments === 'string' && isObj(safeParse(it.arguments));
    case 'custom_tool_call': return nonEmpty(it.name) && typeof it.input === 'string';
    case 'local_shell_call': return isObj(it.action);
    case 'reasoning': return Array.isArray(it.summary) && it.summary.some((p) => isObj(p) && nonEmpty(p.text));
    default: return false;
  }
}
function safeParse(s) { try { return JSON.parse(s); } catch { return undefined; } }

/* ---------- очистка ошибок ---------- */
const A_TYPES = new Set(['invalid_request_error', 'rate_limit_error', 'api_error', 'overloaded_error', 'not_found_error', 'request_too_large', 'timeout_error']);
const A_HIDE = new Set(['authentication_error', 'permission_error', 'billing_error']); // проблемы ключа/оплаты владельца — клиенту не показываем
const R_CODES = new Set(['server_error', 'rate_limit_exceeded', 'context_length_exceeded', 'invalid_prompt', 'max_output_tokens', 'invalid_request_error']);
const R_HIDE = /auth|api_key|permission|billing|credit|insufficient_(quota|funds)|account|organization/i;
const GENERIC = 'The model provider is temporarily unavailable. Retry the request.';
const A_STATUS = { rate_limit_error: 429, overloaded_error: 503, invalid_request_error: 502, not_found_error: 502, request_too_large: 502, timeout_error: 504 };

const EV_NAME = /^[a-z_.]+$/i;
const evName = (n, j) => (typeof n === 'string' && n.length < 60 && EV_NAME.test(n) ? n : typeof j.type === 'string' && j.type.length < 60 && EV_NAME.test(j.type) ? j.type : 'message');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const numObj = (o) => { if (!isObj(o)) return undefined; const r = {}; for (const k of Object.keys(o).slice(0, 20)) if (num(o[k]) !== undefined) r[k] = o[k]; return r; };
const R_STATUS = new Set(['completed', 'failed', 'incomplete', 'in_progress', 'cancelled', 'queued']);

const R_INCOMPLETE = new Set(['max_output_tokens', 'content_filter']);
function createNative({ proto, slug, scrub, alert, onFirst, cut = (x) => x, onGrow }) {
  // вырезать из всех строк объекта (на любой глубине, без рекурсии) известные ключи и адреса провайдера; короткие строки не трогаем
  const redactDeep = (x) => {
    const stack = [x];
    while (stack.length) {
      const o = stack.pop();
      for (const k of Object.keys(o)) { const v = o[k]; if (typeof v === 'string') { if (v.length >= 6) { const c = cut(v); if (c !== v) o[k] = c; } } else if (v && typeof v === 'object') stack.push(v); }
    }
    return x;
  };
  const usage = { in: 0, out: 0, cached: 0, think: 0 };
  const st = { delivered: false, chars: 0, final: false, error: null, usage }; // chars — сколько знаков текста и размышлений получил клиент (для политики возвратов)
  let doneChars = 0;
  const itemChars = (it) => { let n = 0; for (const k of ['content', 'summary']) if (Array.isArray(it && it[k])) for (const c of it[k]) if (c && typeof c.text === 'string') n += c.text.length; return n; };
  const blocks = new Map(); // Messages: index → { type, args, input, name }
  const deliver = (s) => { if (typeof s === 'string') st.chars += s.length; if (!st.delivered) { st.delivered = true; if (onFirst) onFirst(); } };
  const clean = (m) => (typeof m === 'string' && m ? scrub(m) : '');
  const note = (what) => { try { alert && alert(what); } catch {} };

  // ошибка провайдера внутри потока/ответа → { event, data (для клиента), error ({status,message}) }
  function anthropicError(e) {
    const o = isObj(e) ? e : {};
    let type = typeof o.type === 'string' ? o.type : 'api_error', message = clean(o.message);
    if (A_HIDE.has(type)) { note(`провайдер ${slug} вернул ошибку «${type}» посреди ответа — проверьте ключ и баланс модели`); type = 'api_error'; message = GENERIC; }
    if (!A_TYPES.has(type)) type = 'api_error';
    if (!message) message = type === 'overloaded_error' ? 'The model provider is overloaded. Retry shortly.' : GENERIC;
    return { data: { type: 'error', error: { type, message } }, error: { status: A_STATUS[type] || 502, message } };
  }
  function responsesError(e) {
    const o = isObj(e) ? e : {};
    let code = typeof o.code === 'string' ? o.code : typeof o.type === 'string' ? o.type : 'server_error', message = clean(o.message);
    if (R_HIDE.test(code)) { note(`провайдер ${slug} вернул ошибку «${code}» посреди ответа — проверьте ключ и баланс модели`); code = 'server_error'; message = GENERIC; }
    if (!R_CODES.has(code)) code = 'server_error';
    if (!message) message = GENERIC;
    return { error: { code, message }, status: code === 'rate_limit_exceeded' ? 429 : 502 };
  }

  const isFinalType = (t) => (proto === 'messages' ? t === 'message_stop' : t === 'response.completed' || t === 'response.incomplete' || t === 'response.failed');

  // Разобрать событие провайдера. Возвращает { send: [{ event, data }] , end: bool } — что переслать клиенту и надо ли закончить.
  function onEvent(ev) {
    let j; try { j = JSON.parse(ev.data); } catch { j = undefined; }
    if (!isObj(j)) {
      // нечитаемые данные не пересылаем; «event: error» без JSON — всё равно ошибка провайдера
      if (ev.event === 'error') return failEvent(proto === 'messages' ? anthropicError({ type: 'api_error' }) : { ...responsesError({}), data: null });
      return { send: [], end: false };
    }
    if (proto === 'messages') return onMessages(ev, j); return onResponses(ev, j);
  }
  function failEvent(x) {
    st.final = true;
    if (proto === 'messages') { st.error = x.error; return { send: [{ event: 'error', data: x.data }], end: true }; }
    st.error = { status: x.status, message: x.error.message };
    return { send: [{ event: 'error', data: { type: 'error', code: x.error.code, message: x.error.message, param: null } }], end: true };
  }

  function onMessages(ev, j) {
    const t = j.type;
    if (t === 'error' || ev.event === 'error' || isObj(j.error)) return failEvent(anthropicError(j.error)); // событие с ошибкой — только из допустимых полей
    if (t === 'message_start' && isObj(j.message)) {
      j.message.model = slug; const u = j.message.usage || {};
      usage.cached = u.cache_read_input_tokens || 0; usage.in = (u.input_tokens || 0) + usage.cached + (u.cache_creation_input_tokens || 0); usage.out = u.output_tokens || 0;
    } else if (t === 'message_delta' && isObj(j.usage)) usage.out = j.usage.output_tokens || usage.out;
    else if (t === 'content_block_start' && isObj(j.content_block)) {
      const c = j.content_block;
      blocks.set(j.index, { type: c.type, name: c.name, input: isObj(c.input) ? c.input : null, args: '' });
      if (c.type !== 'tool_use' && usefulBlock(c)) deliver(typeof c.text === 'string' ? c.text : typeof c.thinking === 'string' ? c.thinking : ''); // блок с готовым текстом; пустой старт — ещё не результат
    } else if (t === 'content_block_delta' && isObj(j.delta)) {
      const d = j.delta, b = blocks.get(j.index);
      if (d.type === 'text_delta' && nonEmpty(d.text)) deliver(d.text);
      else if (d.type === 'thinking_delta' && nonEmpty(d.thinking)) deliver(d.thinking);
      else if (d.type === 'input_json_delta' && b && typeof d.partial_json === 'string') { b.args += d.partial_json; if (onGrow) onGrow(d.partial_json.length); }
    } else if (t === 'content_block_stop') {
      const b = blocks.get(j.index);
      if (b && b.type === 'tool_use' && nonEmpty(b.name) && (b.input && Object.keys(b.input).length ? true : jsonObj(b.args))) deliver(); // инструмент считается готовым, когда есть имя и разборчивые аргументы
      blocks.delete(j.index);
    }
    if (isFinalType(t)) st.final = true;
    return { send: [{ event: evName(ev.event, j), data: redactDeep(j) }], end: st.final };
  }

  // response.failed / событие с response.error: ответ собирается заново из допустимых полей (output и прочее провайдера не пересылаются)
  function rebuildResponse(t, j, r, x) {
    const u = isObj(r.usage) ? { input_tokens: num(r.usage.input_tokens), output_tokens: num(r.usage.output_tokens), total_tokens: num(r.usage.total_tokens), input_tokens_details: numObj(r.usage.input_tokens_details), output_tokens_details: numObj(r.usage.output_tokens_details) } : undefined;
    // строки поставщика в разрешённых полях: id — только обычный идентификатор без известных ключей и адресов (иначе не передаётся);
    // причина незавершённости — только из списка
    const idv = (v) => (typeof v === 'string' && /^[\w.:-]{1,128}$/.test(v) && cut(v) === v ? v : undefined);
    const reason = isObj(r.incomplete_details) && R_INCOMPLETE.has(r.incomplete_details.reason) ? r.incomplete_details.reason : null;
    const response = { id: idv(r.id), object: 'response', created_at: num(r.created_at), status: t === 'response.failed' ? 'failed' : R_STATUS.has(r.status) ? r.status : 'failed', model: slug, error: x.error, incomplete_details: isObj(r.incomplete_details) ? { reason } : null, usage: u };
    return { type: t, sequence_number: num(j.sequence_number), response };
  }

  function onResponses(ev, j) {
    const t = j.type;
    if (t === 'error' || ev.event === 'error') { const x = responsesError(j.error || j); return failEvent(x); }
    const r = isObj(j.response) ? j.response : null;
    if (r && r.usage) { usage.in = num(r.usage.input_tokens) || 0; usage.out = num(r.usage.output_tokens) || 0; usage.cached = num((r.usage.input_tokens_details || {}).cached_tokens) || 0; }
    if (isObj(j.error)) return failEvent(responsesError(j.error)); // событие с ошибкой — только из допустимых полей
    if (t === 'response.failed' || (r && r.error != null)) {
      const x = responsesError(r && r.error != null ? r.error : {});
      if (t === 'response.failed') st.error = { status: x.status, message: x.error.message };
      if (isFinalType(t)) st.final = true;
      return { send: [{ event: evName(ev.event, j), data: rebuildResponse(t, j, r || {}, x) }], end: st.final };
    }
    if (r) r.model = slug;
    if (t === 'response.output_item.done' && usefulItem(j.item)) {
      deliver();
      // текст готового элемента: поставщик мог не слать delta-события; берётся большее из двух счётов — дважды один текст не считается
      doneChars += itemChars(j.item); if (doneChars > st.chars) st.chars = doneChars;
    }
    else if (t === 'response.output_text.delta' && nonEmpty(j.delta)) deliver(j.delta);
    else if (t === 'response.refusal.delta' && nonEmpty(j.delta)) deliver(j.delta);
    else if (t === 'response.reasoning_summary_text.delta' && nonEmpty(j.delta)) deliver(j.delta);
    if (isFinalType(t)) st.final = true;
    return { send: [{ event: evName(ev.event, j), data: redactDeep(j) }], end: st.final };
  }

  // Ответ целиком (stream:false): превращает ошибку-в-теле-200 в исключение, проверяет, что ответ — настоящий, и считает «доставлено»
  function whole(j) {
    if (!isObj(j)) throw err('upstream', 'The model provider returned an unreadable response.');
    if (proto === 'messages') {
      if (j.type === 'error' || isObj(j.error)) { const x = anthropicError(j.error); throw err(x.error.status === 429 ? 'rate_limit' : x.error.status === 503 ? 'overloaded' : x.error.status === 504 ? 'timeout' : 'upstream', x.error.message); }
      if (j.type !== 'message') throw err('upstream', 'The model provider returned an unreadable response.');
      j.model = slug; const u = j.usage || {};
      usage.cached = u.cache_read_input_tokens || 0; usage.in = (u.input_tokens || 0) + usage.cached + (u.cache_creation_input_tokens || 0); usage.out = u.output_tokens || 0;
      if (Array.isArray(j.content) && j.content.some(usefulBlock)) deliver();
      redactDeep(j);
    } else {
      if (isObj(j.error) || j.status === 'failed') { const x = responsesError(j.error); throw err(x.status === 429 ? 'rate_limit' : 'upstream', x.error.message); }
      if (j.object !== 'response') throw err('upstream', 'The model provider returned an unreadable response.');
      j.model = slug;
      if (j.usage) { usage.in = j.usage.input_tokens || 0; usage.out = j.usage.output_tokens || 0; usage.cached = (j.usage.input_tokens_details || {}).cached_tokens || 0; }
      if (Array.isArray(j.output) && j.output.some(usefulItem)) deliver();
      redactDeep(j);
    }
    return j;
  }

  // событие для клиента, если поток оборвался без финального события
  function cutEvent(message) {
    return proto === 'messages'
      ? { event: 'error', data: { type: 'error', error: { type: 'api_error', message } } }
      : { event: 'response.failed', data: { type: 'response.failed', response: { status: 'failed', model: slug, error: { code: 'server_error', message } } } };
  }

  return { st, usage, onEvent, whole, cutEvent };
}

module.exports = { createNative, usefulBlock, usefulItem };
