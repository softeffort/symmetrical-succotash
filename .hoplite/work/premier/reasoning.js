'use strict';
// Размышления модели в чате.
// 1) extract(delta) — достаёт текст размышлений из кусочка потока в любом из распространённых форматов:
//    reasoning_content (DeepSeek, LiteLLM, new-api/one-api), reasoning (OpenRouter), reasoning_details (OpenRouter),
//    thinking (часть прокси для Claude), части content с type thinking/reasoning.
// 2) params(model, maxTok) — что добавить в запрос, чтобы провайдер прислал размышления (настройка модели «think»):
//      ''          — ничего не добавлять (как раньше);
//      'reasoning' — reasoning: { max_tokens } (OpenRouter);
//      'thinking'  — thinking: { type: 'enabled', budget_tokens } (Claude через LiteLLM, new-api, Anthropic-совместимые прокси);
//      'effort'    — reasoning_effort: 'medium' (OpenAI-совместимые: o-серия, Gemini, Grok, LiteLLM).
// 3) Если провайдер отвечает 400 на это поле, сервер повторяет запрос без него и помнит это для модели час (unsupported/mark).

const MODES = ['', 'reasoning', 'thinking', 'effort'];
const BUDGET = Math.max(1024, Number(process.env.CHAT_THINK_BUDGET) || 8000);

const str = (x) => (typeof x === 'string' ? x : '');
function extract(delta) {
  if (!delta || typeof delta !== 'object') return '';
  let s = str(delta.reasoning_content) || str(delta.reasoning);
  if (!s && Array.isArray(delta.reasoning_details)) {
    s = delta.reasoning_details.map((d) => (d && d.type !== 'reasoning.encrypted' ? str(d.text) || str(d.summary) : '')).join('');
  }
  if (!s) s = str(delta.thinking) || str(delta.thinking && delta.thinking.content) || str(delta.thinking && delta.thinking.thinking);
  if (!s && Array.isArray(delta.content)) {
    s = delta.content.map((c) => (c && (c.type === 'thinking' || c.type === 'reasoning') ? str(c.thinking) || str(c.text) : '')).join('');
  }
  return s;
}
// Текст ответа из кусочка: строка или массив частей (часть прокси шлёт content массивом).
function text(delta) {
  if (!delta) return '';
  if (typeof delta.content === 'string') return delta.content;
  if (Array.isArray(delta.content)) return delta.content.map((c) => (c && c.type === 'text' ? str(c.text) : '')).join('');
  return '';
}

const off = new Map(); // ключ модели → время, когда провайдер отказался от поля
const TTL = 3600000;
const key = (model) => String(model.baseUrl || '').replace(/\/+$/, '') + '|' + (model.modelId || model.id || '');
function unsupported(model, now = Date.now()) {
  const t = off.get(key(model));
  if (t && now - t < TTL) return true;
  if (t) off.delete(key(model));
  return false;
}
function mark(model, now = Date.now()) { off.set(key(model), now); }

function params(model, maxTok) {
  const mode = model && MODES.includes(model.think) ? model.think : '';
  if (!mode || unsupported(model)) return {};
  if (mode === 'effort') return { reasoning_effort: 'medium' };
  // бюджет размышлений меньше потолка ответа: иначе провайдер отклонит запрос, а на текст ничего не останется
  const budget = maxTok ? Math.min(BUDGET, maxTok - 1024) : BUDGET;
  if (budget < 1024) return {};
  if (mode === 'reasoning') return { reasoning: { max_tokens: budget } };
  return { thinking: { type: 'enabled', budget_tokens: budget } };
}
const FIELDS = ['reasoning', 'thinking', 'reasoning_effort'];
const has = (body) => FIELDS.some((f) => f in body);
function strip(body) { const b = { ...body }; for (const f of FIELDS) delete b[f]; return b; }
// Ответ 400/422 похож на «поле не поддерживается»?
const rejects = (status, text) => (status === 400 || status === 422) && /reasoning|thinking|budget|effort|unknown|unrecognized|unsupported|not supported|extra (inputs|fields)|additional propert|not permitted|invalid param/i.test(String(text || ''));

module.exports = { MODES, extract, text, params, has, strip, rejects, unsupported, mark };
