'use strict';
// /v1 — API для Cursor, Codex, Claude Code и SDK. Три протокола поверх OpenAI-совместимых провайдеров.
const { err, sendError, sseStream, readJson, readSse, readBodyLimited, RESPONSE_LIMIT, estimateTokens, detectClient, checkDepth } = require('./util');
const conv = require('./convert');
const up = require('./upstream');
const { MessagesOut, ResponsesOut, ChatOut, THINK_SIG } = require('./output');
const { resolve } = require('./models');
const { createNative } = require('./native');

const BODY_LIMIT = Math.max(1, Number(process.env.API_BODY_MB) || 32) * 1048576;
const RPM = Math.max(1, Number(process.env.API_RPM) || 60);
const CONCURRENCY = Math.max(1, Number(process.env.API_CONCURRENCY) || 10);
const ROUTES = { '/v1/chat/completions': 'chat', '/v1/responses': 'responses', '/v1/messages': 'messages' };
const COUNT_BODY_LIMIT = BODY_LIMIT; // count_tokens получает тот же разговор, что и /v1/messages (Claude Code) — лимит тот же
// сколько байт тел запросов можно читать одновременно: на весь сервер и на одного пользователя (один ключ не займёт всё)
const BODY_INFLIGHT = Math.max(1, Number(process.env.API_BODY_INFLIGHT_MB) || 128) * 1048576;
const BODY_INFLIGHT_USER = Math.min(BODY_INFLIGHT, Math.max(1, Number(process.env.API_BODY_INFLIGHT_USER_MB) || 2 * BODY_LIMIT / 1048576) * 1048576);
// сколько байт ответа каждый запрос копит вне общего бюджета (API_RESPONSE_FREE_KB, по умолчанию 1 МБ) — см. memReserve.grow
const RESPONSE_FREE = Math.max(0, process.env.API_RESPONSE_FREE_KB != null && process.env.API_RESPONSE_FREE_KB !== '' ? Number(process.env.API_RESPONSE_FREE_KB) || 0 : 1024) * 1024;
const BODY_TIMEOUT_MS = Math.max(1000, Number(process.env.API_BODY_TIMEOUT_MS) || 60000); // тело должно дойти за это время (медленная загрузка не держит место)

/* ---------- прямая передача провайдеру: только то, что клиент вправе использовать за наш счёт ---------- */
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const ANTHROPIC_FIELDS = ['model', 'messages', 'system', 'max_tokens', 'metadata', 'stop_sequences', 'stream', 'temperature', 'top_p', 'top_k', 'tools', 'tool_choice', 'thinking'];
// инструменты Anthropic, которые выполняет клиент; серверные (web_search_*, web_fetch_*, code_execution_*…) — это платные возможности провайдера
const anthropicClientTool = (t) => isObj(t) && (t.type == null || t.type === 'custom' || /^(bash|text_editor|computer)_\d+$/.test(String(t.type)));
const BETA_OK = ['interleaved-thinking-', 'fine-grained-tool-streaming-', 'token-efficient-tools-', 'prompt-caching-', 'extended-cache-ttl-', 'claude-code-', 'context-management-', ...String(process.env.API_NATIVE_BETAS || '').split(',').map((x) => x.trim()).filter(Boolean)];
const betaHeader = (v) => String(v || '').split(',').map((x) => x.trim()).filter((x) => x && BETA_OK.some((p) => x.startsWith(p))).join(',');
const RESPONSES_TOOLS = new Set(['function', 'custom', 'local_shell', 'namespace']);
const RESPONSES_DROP = ['background', 'conversation', 'previous_response_id', 'prompt', 'service_tier'];
function nativeBody(proto, body) {
  let b;
  if (proto === 'messages') {
    b = {}; for (const k of ANTHROPIC_FIELDS) if (body[k] !== undefined) b[k] = body[k];
    if (Array.isArray(b.tools)) b.tools = b.tools.filter(anthropicClientTool);
    // потолок max_tokens мог стать меньше бюджета размышлений — Anthropic ответит 400
    if (isObj(b.thinking) && b.thinking.type === 'enabled' && typeof b.max_tokens === 'number' && typeof b.thinking.budget_tokens === 'number' && b.thinking.budget_tokens >= b.max_tokens) {
      if (b.max_tokens > 1024) b.thinking = { ...b.thinking, budget_tokens: Math.max(1024, b.max_tokens - 1024) }; else delete b.thinking;
    }
    const names = new Set(Array.isArray(b.tools) ? b.tools.map((t) => t.name) : []);
    if (!Array.isArray(b.tools) || !b.tools.length) { delete b.tools; delete b.tool_choice; }
    else if (isObj(b.tool_choice) && b.tool_choice.type === 'tool' && !names.has(b.tool_choice.name)) delete b.tool_choice;
  } else {
    b = { ...body }; for (const k of RESPONSES_DROP) delete b[k];
    b.store = false;
    if (Array.isArray(b.tools)) b.tools = b.tools.filter((t) => isObj(t) && RESPONSES_TOOLS.has(t.type));
    if (!Array.isArray(b.tools) || !b.tools.length) { delete b.tools; delete b.tool_choice; }
    else if (isObj(b.tool_choice) && b.tool_choice.type !== 'allowed_tools' && !RESPONSES_TOOLS.has(b.tool_choice.type)) delete b.tool_choice;
  }
  return b;
}
// провайдер говорит на протоколе клиента — решаем это до полного перевода запроса
const isNative = (model, proto) => (model.native === 'anthropic' && proto === 'messages') || (model.native === 'responses' && proto === 'responses');
// лёгкая проверка для native: перевод не нужен, нужны только stream и приблизительный размер для оценки цены
function nativeLight(proto, body) {
  checkDepth(body); // глубокий JSON ломает рекурсивную оценку размера и сериализацию — 400
  if (proto === 'messages') {
    if (!Array.isArray(body.messages) || !body.messages.length) throw err('invalid', 'messages: a non-empty array is required', { param: 'messages' });
    // серверные инструменты (веб-поиск Claude Code и т. п.) и mcp_servers выполнить нечем — честная 400 до списания, а не ответ без поиска (API-09).
    // С API_DROP_SERVER_TOOLS=1 их убирают молча, но запрос ТОЛЬКО с серверными инструментами остаётся ошибкой в любом случае
    if (Array.isArray(body.tools) && body.tools.length && !body.tools.some(anthropicClientTool)) throw err('invalid', 'Server tools (web search, web fetch, code execution) are not available through this API. Use client-side tools instead.', { param: 'tools', code: 'unsupported_tool' });
    conv.rejectServerTools([...(Array.isArray(body.tools) ? body.tools.filter((t) => !anthropicClientTool(t)) : []), ...(Array.isArray(body.mcp_servers) && body.mcp_servers.length ? [{ type: 'mcp_servers' }] : [])]);
    const sys = typeof body.system === 'string' ? body.system : Array.isArray(body.system) ? body.system.map((x) => (x && typeof x.text === 'string' ? x.text : '')).join('\n') : '';
    return { stream: body.stream === true, body: { messages: body.messages, system: sys, tools: body.tools } };
  }
  if (body.input == null || (typeof body.input !== 'string' && !Array.isArray(body.input))) throw err('invalid', 'input: a string or an array of input items is required', { param: 'input' });
  conv.reasoningEffort(body); // незнакомое reasoning.effort — 400, а не ошибка провайдера после списания (API-07)
  conv.rejectServerTools([...(Array.isArray(body.tools) ? body.tools.filter((t) => !(isObj(t) && RESPONSES_TOOLS.has(t.type))) : []), ...(isObj(body.tool_choice) && !['allowed_tools', ...RESPONSES_TOOLS].includes(body.tool_choice.type) ? [body.tool_choice] : [])], Array.isArray(body.tools) && body.tools.some((t) => !(isObj(t) && RESPONSES_TOOLS.has(t.type))) ? 'tools' : 'tool_choice');
  // ответы не хранятся у провайдера: продолжение по id невозможно — честная ошибка, а не ответ без контекста
  if (body.previous_response_id != null) throw err('invalid', 'previous_response_id is not supported: responses are not stored. Send the full conversation in input.', { param: 'previous_response_id' });
  if (body.conversation != null) throw err('invalid', 'conversation is not supported. Send the full conversation in input.', { param: 'conversation' });
  return { stream: body.stream === true, body: { messages: [{ role: 'user', content: typeof body.input === 'string' ? body.input : JSON.stringify(body.input) }], system: typeof body.instructions === 'string' ? body.instructions : '', tools: body.tools } };
}

const ttlCache = (fn, ttl = 2000) => { let v, at = 0; return () => { const now = Date.now(); if (v === undefined || now - at > ttl) { v = fn(); at = now; } return v; }; };

function createGateway(d) {
  // d: { store, bill, loadModels, loadSettings, monitor, clientIp, keys, usage, origin }
  d = { ...d, loadModels: ttlCache(d.loadModels), loadSettings: ttlCache(d.loadSettings) }; // не разбираем модели и настройки из базы на каждый запрос
  const active = new Map(), hits = new Map(), fails = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of fails) if (v.until < now) fails.delete(k); for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 60000) hits.delete(k); }, 60000).unref();
  const alert = (text) => d.monitor.alert && d.monitor.alert('API: ' + text);
  // отдельные лимиты для /v1/models и count_tokens (не съедают минутный лимит генерации) и общий потолок байт читаемых тел
  const auxHits = new Map(), bodyByUser = new Map(); let bodyInflight = 0;
  setInterval(() => { const now = Date.now(); for (const [k, v] of auxHits) if (!v.length || now - v[v.length - 1] > 60000) auxHits.delete(k); }, 60000).unref();
  function takeAux(kind, uid) {
    const now = Date.now(), k = kind + ':' + uid, h = (auxHits.get(k) || []).filter((t) => now - t < 60000), lim = RPM * 2;
    if (h.length >= lim) throw err('rate_limit', `Rate limit: up to ${lim} ${kind === 'count' ? 'token counts' : 'model list requests'} per minute. Retry shortly.`, { retryAfter: Math.max(1, Math.ceil((h[0] + 60000 - now) / 1000)), shouldRetry: true });
    h.push(now); auxHits.set(k, h);
  }
  // Память под запрос (API-05): место резервируется до чтения тела и держится, пока запрос жив — тело остаётся в памяти до конца ответа,
  // а буферизуемый ответ провайдера растёт сверху (grow). Одиночный запрос может превысить лимит (иначе большой запрос не пройдёт вообще),
  // отказ — только когда ДРУГИЕ запросы уже занимают место: пользователю — 429, серверу целиком — 503.
  function memReserve(uid, n = 0) {
    let held = 0, closed = false, free = RESPONSE_FREE;
    const add = (k) => { held += k; bodyInflight += k; bodyByUser.set(uid, (bodyByUser.get(uid) || 0) + k); };
    const m = {
      get held() { return held; },
      claim(k) {
        if (closed || k <= 0) return;
        const mine = (bodyByUser.get(uid) || 0) - held, others = bodyInflight - held;
        if (mine > 0 && mine + held + k > BODY_INFLIGHT_USER) throw err('rate_limit', 'Too many request bodies are being uploaded at once from your account. Retry shortly.', { retryAfter: 5 });
        if (others > 0 && others + held + k > BODY_INFLIGHT) throw err('overloaded', 'The server is busy receiving other requests. Retry shortly.', { retryAfter: 5, shouldRetry: true });
        add(k);
      },
      // Рост идущего запроса (ответ копится в памяти). Первые RESPONSE_FREE байт ответа в бюджет не идут: обычный ответ не зависит
      // от чужих запросов и не обрывается из-за них. Сверх этого место берётся из бюджета; если его уже заняли ДРУГИЕ запросы —
      // этот запрос получает ошибку (429 / 503, в потоке — событие ошибки). Так память процесса ограничена сверху:
      // бюджет + RESPONSE_FREE на каждый запрос в работе.
      grow(k) {
        if (closed || k <= 0) return;
        if (free > 0) { const f = Math.min(free, k); free -= f; k -= f; if (!k) return; }
        const mine = (bodyByUser.get(uid) || 0) - held, others = bodyInflight - held;
        if (mine > 0 && mine + held + k > BODY_INFLIGHT_USER) throw err('rate_limit', 'Your parallel requests hold too much memory for this response. Retry shortly.', { retryAfter: 5 });
        if (others > 0 && others + held + k > BODY_INFLIGHT) throw err('overloaded', 'The server has no memory left for this response. Retry shortly.', { retryAfter: 5, shouldRetry: true });
        add(k);
      },
      shrink(to) { if (!closed && to < held) add(to - held); },
      release() { if (closed) return; closed = true; bodyInflight -= held; const left = (bodyByUser.get(uid) || 0) - held; if (left > 0) bodyByUser.set(uid, left); else bodyByUser.delete(uid); held = 0; },
    };
    if (n > 0) m.claim(n);
    return m;
  }
  // отказ, пока тело запроса не прочитано: закрываем соединение после ответа, не вычитывая гигабайты
  function dropBody(req, res) {
    res.setHeader('Connection', 'close');
    res.once('finish', () => { setTimeout(() => { if (!req.complete) req.socket.destroy(); }, 1000).unref(); });
  }

  function cors(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', String(req.headers['access-control-request-headers'] || 'authorization, content-type, x-api-key, anthropic-version, anthropic-beta').replace(/[^\w\s,-]/g, '').slice(0, 1000));
    res.setHeader('Access-Control-Expose-Headers', 'retry-after, x-should-retry, request-id');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  function authenticate(req, ip, origin) {
    const now = Date.now(), h = req.headers;
    const raw = ((/^Bearer\s+(\S+)\s*$/i.exec(String(h.authorization || '')) || [])[1] || String(h['x-api-key'] || h['api-key'] || '')).trim();
    if (!raw) throw err('auth', `Missing API key. Send it as "Authorization: Bearer prm_…" or "x-api-key". Create a key at ${origin}/developers`);
    const v = d.keys.verify(raw, ip);
    if (v.error) { // блокировка по IP — только для неверных ключей: верный ключ проходит всегда (за общим адресом соседи не мешают друг другу)
      const f = fails.get(ip);
      if (f && f.until > now && f.n >= 30) throw err('rate_limit', `Too many failed authentication attempts from this IP. Wait ${Math.ceil((f.until - now) / 60000)} min.`, { retryAfter: Math.ceil((f.until - now) / 1000), shouldRetry: false });
      if (v.error !== 'ip') { const x = f && f.until > now ? f : { n: 0, until: now + 600000 }; x.n++; fails.set(ip, x); }
      if (v.error === 'format') throw err('auth', 'Invalid API key format. Premier keys look like "prm_…" (46 characters). Copy the key again without spaces.');
      if (v.error === 'expired') throw err('auth', `This API key has expired. Create a new one at ${origin}/developers`);
      if (v.error === 'ip') throw err('permission', `This API key is not allowed from IP ${v.ip}. Edit the key's IP allowlist at ${origin}/developers`);
      throw err('auth', `Invalid API key: it was revoked, rolled or never existed. Check it at ${origin}/developers`);
    }
    const user = d.store.users.get(v.uid);
    if (!user) throw err('auth', 'The account that owns this API key no longer exists.');
    if (user.banned) throw err('permission', 'The account that owns this API key is blocked. Contact Premier support.');
    return { key: v.key, user };
  }

  const available = (user, key) => {
    const plan = d.bill.planOf(user).id;
    return d.loadModels().filter((m) => d.bill.modelPlans(m).includes(plan) && (!key || !key.models || key.models.includes(m.slug)) && !(key && m.ultra && !key.allow_ultra));
  };
  const modelObj = (m, anthropic) => (anthropic
    ? { type: 'model', id: m.slug, display_name: m.name, created_at: '2025-01-01T00:00:00Z' }
    : { id: m.slug, object: 'model', created: 1735689600, owned_by: 'premier', name: m.name });

  function takeSlot(uid) {
    const now = Date.now(), h = (hits.get(uid) || []).filter((t) => now - t < 60000);
    if (h.length >= RPM) throw err('rate_limit', `Rate limit: up to ${RPM} requests per minute. Retry shortly.`, { retryAfter: Math.max(1, Math.ceil((h[0] + 60000 - now) / 1000)), shouldRetry: true });
    const a = active.get(uid) || 0;
    if (a >= CONCURRENCY) throw err('rate_limit', `Too many parallel requests: up to ${CONCURRENCY} at a time. Retry shortly.`, { retryAfter: 2, shouldRetry: true });
    h.push(now); hits.set(uid, h); active.set(uid, a + 1);
  }
  const release = (uid) => { const a = (active.get(uid) || 1) - 1; if (a > 0) active.set(uid, a); else active.delete(uid); };

  function quotaError(user, origin) {
    const plan = d.bill.planOf(user), lim = d.bill.limitOf(plan, 'm'), secs = Math.max(60, Math.ceil((d.bill.resetsAt() - Date.now()) / 1000));
    const h = Math.floor(secs / 3600), m = Math.ceil((secs % 3600) / 60);
    return err('quota', `Сообщения на сегодня закончились (${lim ?? '∞'} на тарифе ${plan.name}; лимит общий с чатом). Обновится в 00:00 по Москве — через ${h ? h + ' ч ' : ''}${m} мин. Больше сообщений — на ${origin}/chat. / Daily message limit reached; it resets at 00:00 Moscow time.`, { retryAfter: secs, shouldRetry: false });
  }

  /* ---------- генерация ---------- */
  // ctx: { req, res, proto, body, user, key, client, ip, origin }
  async function generate(ctx) {
    const { req, res, proto, body, user, key } = ctx;
    const started = Date.now();
    const log = { uid: user.id, key_id: key ? key.id : null, proto, client: ctx.client, stream: body.stream === true, status: 200, model: typeof body.model === 'string' ? body.model.slice(0, 64) : null, at: started };
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ac.abort(new Error('client closed')); });
    let charge = null, slot = false, delivered = false, ttft = null, usage = null, spentCr = 0, spentAt = 0, spentKey = null;
    let outcome = 'complete', chars = 0; // исход и число знаков, которые клиент реально получил, — для общей политики возвратов (bill.settle)
    const mem = ctx.mem || memReserve(user.id), ownMem = !ctx.mem; ctx = { ...ctx, mem };
    try {
      const models = d.loadModels(), model = resolve(models, body.model);
      up.registerSecrets(models); // ключи и адреса провайдеров — в список вырезаемого из любых текстов ошибок (API-02)
      const native = !!model && isNative(model, proto);
      const parsed = native ? nativeLight(proto, body) : proto === 'chat' ? conv.fromChat(body) : proto === 'responses' ? conv.fromResponses(body) : conv.fromMessages(body);
      log.stream = parsed.stream;
      if (!model) {
        const list = available(user, key).map((m) => m.slug);
        throw err('not_found', typeof body.model === 'string' && body.model ? `Model "${body.model.slice(0, 100)}" not found. Available: ${list.slice(0, 25).join(', ') || 'none'}.` : 'model: field required. Available: ' + list.slice(0, 25).join(', '), { param: 'model' });
      }
      log.model = model.slug;
      if (key && key.models && !key.models.includes(model.slug)) throw err('permission', `This API key may only use: ${key.models.join(', ')}. Change it at ${ctx.origin}/developers`);
      const plan = d.bill.planOf(user), plans = d.bill.modelPlans(model);
      if (!plans.includes(plan.id)) {
        const np = d.bill.cfg().plans.filter((p) => plans.includes(p.id)).sort((a, b) => a.price - b.price)[0];
        throw err('permission', np ? `Модель «${model.name}» доступна на тарифе ${np.name} — ${ctx.origin}/chat. / "${model.slug}" requires the ${np.name} plan.` : `"${model.slug}" is not available right now.`);
      }
      if (key && model.ultra && !key.allow_ultra) throw err('permission', `This API key is not allowed to use Ultra models (credits). Enable it in the key settings at ${ctx.origin}/developers`);
      const ctxTokens = model.ultra ? d.bill.estimateTokens(ctx.body) : 0; // только Ultra платит за контекст; весь запрос: сообщения, tools, tool_calls/tool_use, thinking, документы
      if (key && (key.req_cap || (model.ultra && key.ultra_cap))) { // дневные лимиты ключа (сутки по Москве)
        const t = d.usage.keyToday(key.id), wait = { retryAfter: Math.max(60, Math.ceil((d.bill.resetsAt() - Date.now()) / 1000)), shouldRetry: false };
        if (key.req_cap && t.requests >= key.req_cap) throw err('quota', `This API key reached its daily limit of ${key.req_cap} requests. It resets at 00:00 Moscow time; change the limit at ${ctx.origin}/developers`, wait);
        if (model.ultra && key.ultra_cap && t.credits + d.bill.ultraCost(model, ctxTokens).total > key.ultra_cap) throw err('quota', `This API key reached its daily limit of ${key.ultra_cap} Ultra credits. It resets at 00:00 Moscow time; change the limit at ${ctx.origin}/developers`, wait);
      }
      if (!ctx.slotHeld) { takeSlot(user.id); slot = true; } // обычно слот уже взят в handle до чтения тела
      // списание и счётчик расхода ключа — одной транзакцией (API-11): лимиты ключа не зависят от журнала api_log; проверка выше и списание — без await между ними
      const ch = d.store.tx(() => { const c = d.bill.charge(user, model, { burst: false, api: true, ctxTokens }); if (!c.error && key) { spentAt = Date.now(); spentKey = key.id; spentCr = c.credits || 0; d.usage.spend(key.id, 1, spentCr, spentAt); } return c; });
      if (ch.error) throw ch.code === 'model' ? err('permission', ch.error) : ch.code === 'credits' ? err('quota', ch.error + ' ' + ctx.origin + '/chat / Not enough Ultra credits: need ' + ch.need + ', have ' + ch.have + '.') : quotaError(user, ctx.origin);
      charge = ch; log.cost = ch.weight;
      try { d.bill.refMsgTick(user.id); } catch {}

      if (model.ultra) { // Ultra — потолок длины ответа из панели (стоимость ответа ограничена)
      const mo = d.bill.ultraCfg().maxOut;
      for (const o of [parsed.body, ctx.body]) if (o && typeof o === 'object') { for (const k of ['max_tokens', 'max_completion_tokens', 'max_output_tokens']) if (typeof o[k] === 'number' && o[k] > mo) o[k] = mo; if (o === parsed.body && o.max_tokens == null && o.max_completion_tokens == null) o.max_tokens = mo; }
    }
      const r = native ? await passthrough(ctx, model, ac.signal, started) : await translated(ctx, parsed, model, ac.signal, started);
      ({ delivered, ttft, usage } = r); chars = r.chars || 0;
      // исход — как в веб-чате: клиент отключился — cancelled; поток провайдера оборвался без завершения — upstream_error; срок — timeout; прочее — error
      if (r.error || r.incomplete) outcome = ac.signal.aborted ? 'cancelled' : r.incomplete ? 'upstream_error' : r.error.status === 504 ? 'timeout' : 'error';
      if (r.error) { log.status = r.error.status; log.err = r.error.message; }
      if (r.incomplete) { log.status = log.status >= 400 ? log.status : 502; log.err = log.err || 'incomplete: the provider stream ended without a finish reason'; }
    } catch (e) {
      if (!e || !e.kind) { d.monitor.error('API ' + proto, e); e = err('server', 'Internal server error. It has been logged.'); }
      else if (e.internal) d.monitor.error('API ' + proto, e.internal);
      if (ac.signal.aborted && !res.headersSent) e = err('invalid', 'Client closed the request');
      outcome = ac.signal.aborted ? 'cancelled' : e.kind === 'timeout' ? 'timeout' : 'error';
      log.status = ac.signal.aborted && e.kind === 'invalid' ? 499 : e.status; log.err = e.message;
      if (!res.headersSent && !res.destroyed) {
        if (e.raw && e.upstreamStatus) { res.writeHead(e.upstreamStatus, { 'Content-Type': 'application/json' }); res.end(e.raw); }
        else sendError(res, e, proto === 'messages' ? 'messages' : 'openai');
      } else if (!res.writableEnded) res.end();
    } finally {
      if (slot) release(user.id);
      if (ownMem) mem.release();
      try {
        // BIZ-10: возврат решает общая политика биллинга (bill.settle) — та же, что в веб-чате. Клиент отключился до первого
        // результата — возврат не чаще ABORT_REFUNDS раз в сутки на пользователя, дальше списание остаётся; оборвали мы сами
        // (перезапуск сервера) — возвращаем всегда и предел отмен не тратим; ошибка без результата — полный возврат.
        if (charge) {
          // Политике передаётся то, что было на самом деле: исход и число полученных знаков. Сбой после пары знаков — возврат, как в веб-чате
          // (раньше любой первый знак считался полным ответом). Готовый вызов инструмента — результат, только если ответ завершён или клиент ушёл сам.
          const failedOut = outcome !== 'complete' && outcome !== 'cancelled';
          const st = d.bill.settle(user, charge, { outcome, delivered: { text: chars, actions: delivered && !failedOut ? 1 : 0 }, shutdown: !!res.premierShutdown });
          if (st.keep === 'none') log.cost = 0;
          // реальный размер контекста известен после ответа: доплата за длинный контекст пересчитывается в обе стороны.
          // API-01: доплата не выходит за остаток суточного предела ключа (ultra_cap). В счётчике ключа уже стоят начальные списания
          // всех запросов, в том числе параллельных; до сверки счётчика ниже нет ни одного await — два ответа не займут один остаток.
          else if (charge.ultra && delivered && usage && !usage.approx && usage.in > 0) {
            const cap = key && key.ultra_cap ? Math.max(0, key.ultra_cap - d.usage.keyToday(key.id, spentAt).credits) : null;
            d.bill.ultraTopUp(user, charge, usage.in, cap == null ? {} : { cap });
          }
        }
      } catch (e) { d.monitor.error('API refund', e); }
      log.credits = charge ? charge.credits || 0 : 0;
      if (spentKey) { // счётчик ключа сверяется с итогом: возврат — минус запрос и кредиты, Ultra-доплата/возврат — разница кредитов
        try { const fin = log.cost > 0 || log.credits > 0; d.usage.spend(spentKey, (fin ? 1 : 0) - 1, (fin ? log.credits : 0) - spentCr, spentAt); }
        catch (e) { d.monitor.error('API счётчик ключа', e); }
      }
      log.ms = Date.now() - started; log.ttft = ttft;
      if (usage) { log.in_tok = usage.in; log.out_tok = usage.out; }
      if (res.premierShutdown && log.status === 499) { log.status = 503; log.err = delivered ? 'Server restart: stream cut' : 'Server restart: request cut, refunded'; }
      d.usage.log(log);
    }
  }

  async function translated(ctx, parsed, model, signal, started) {
    const { res, proto } = ctx;
    const body = { ...parsed.body, stream: true, stream_options: { include_usage: true } };
    if (!model.vision && conv.hasMedia(body.messages)) conv.stripMedia(body.messages);
    const inputEst = estimateTokens(body.messages, body.tools);
    const upstream = await up.open(model, body, { signal, onAlert: alert });
    const sse = parsed.stream ? sseStream(res, { anthropic: proto === 'messages' }) : null;
    const out = proto === 'messages' ? new MessagesOut({ sse, model: model.slug, thinking: parsed.wantsThinking, inputEst, stops: body.stop })
      : proto === 'responses' ? new ResponsesOut({ sse, model: model.slug, req: ctx.body, custom: parsed.custom, shell: parsed.shell, ns: parsed.ns, inputEst })
      : new ChatOut({ sse, model: model.slug, includeUsage: parsed.includeUsage, inputEst });
    let ttft = null, buffered = 0;
    try {
      await out.start();
      const r = await up.pump(upstream, {
        signal, onBytes: (k) => ctx.mem.grow(k),
        onEvent: async (e) => {
          if (ttft == null && e.t !== 'args') ttft = Date.now() - started;
          // выход копится в памяти до конца ответа (и без потока, и в SSE: ChatOut/MessagesOut/ResponsesOut держат текст, размышления и аргументы): занимает место и ограничен (API-05)
          if (typeof e.d === 'string') { buffered += e.d.length; if (buffered > RESPONSE_LIMIT) throw err('upstream', 'The model provider response is larger than the allowed size.'); ctx.mem.grow(e.d.length); }
          await out.on(e); // сколько знаков реально ушло клиенту, считает сам адаптер (out.sentChars): скрытые размышления не в счёт
        },
        onChunk: proto === 'chat' && sse ? (j) => out.chunk(j) : null,
      });
      const fin = await out.finish(r);
      if (sse) { sse.end(); return { delivered: out.delivered, chars: out.sentChars, ttft, usage: fin, incomplete: r.incomplete }; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(fin.body));
      return { delivered: out.delivered, chars: out.sentChars, ttft, usage: fin.u, incomplete: r.incomplete };
    } catch (e) {
      upstream.done();
      if (!sse) throw e;
      const ex = e && e.kind ? e : err('server', 'Internal server error. It has been logged.');
      if (!(e && e.kind)) d.monitor.error('API stream ' + proto, e); else if (e.internal) d.monitor.error('API stream ' + proto, e.internal);
      if (!signal.aborted) { try { await out.fail(ex); } catch {} }
      sse.end();
      return { delivered: out.delivered, chars: out.sentChars, ttft, usage: null, error: { status: signal.aborted ? 499 : ex.status, message: ex.message } };
    }
  }

  // Провайдер сам говорит на протоколе клиента (Anthropic Messages / OpenAI Responses) — передаём без перевода:
  // сохраняются кэш промпта, thinking, beta-возможности.
  async function passthrough(ctx, model, signal, started) {
    const { req, res, proto, body } = ctx;
    const b = { ...nativeBody(proto, body), model: model.modelId || model.id };
    if (model.ultra) { const mo = d.bill.ultraCfg().maxOut, k = proto === 'messages' ? 'max_tokens' : 'max_output_tokens'; if (typeof b[k] !== 'number' || b[k] > mo) b[k] = mo; }
    let headers;
    if (proto === 'messages') {
      // «размышления», которые выдал шлюз в переводном режиме, у настоящего Anthropic не пройдут проверку подписи
      if (Array.isArray(b.messages)) b.messages = b.messages.map((m) => (Array.isArray(m && m.content) ? { ...m, content: m.content.filter((c) => !(c && (c.type === 'thinking' || c.type === 'redacted_thinking') && c.signature === THINK_SIG)) } : m));
      headers = { 'Content-Type': 'application/json', 'anthropic-version': String(req.headers['anthropic-version'] || '2023-06-01'), 'x-api-key': model.apiKey };
      const beta = betaHeader(req.headers['anthropic-beta']); if (beta) headers['anthropic-beta'] = beta;
      if (!/(^|\.)anthropic\.com$/i.test(hostOf(up.nativeUrl(model)))) headers.Authorization = 'Bearer ' + model.apiKey;
    } else {
      if (Array.isArray(b.input)) b.input = b.input.filter((it) => !(it && it.type === 'reasoning' && !it.encrypted_content));
      headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + model.apiKey };
    }
    up.registerSecrets([model]);
    let upstream;
    try { upstream = await up.open(model, b, { signal, url: up.nativeUrl(model), headers, native: true, onAlert: alert }); }
    catch (e) { if (e.upstreamText && [400, 413, 422].includes(e.upstreamStatus) && e.kind !== 'context' && !e.outOfCredit) { e.raw = JSON.stringify(up.scrubBody(e.upstreamText, proto)); } throw e; }
    let ttft = null;
    const nat = createNative({ proto, slug: model.slug, scrub: up.scrub, cut: up.cutKnown, onGrow: (k) => ctx.mem.grow(k), alert, onFirst: () => { if (ttft == null) ttft = Date.now() - started; } });
    const { st, usage } = nat;
    const type = String(upstream.res.headers.get('content-type') || '');
    const timedOut = () => /timeout/.test(String(upstream.ac.signal.reason && upstream.ac.signal.reason.message || ''));
    try {
      if (!type.includes('text/event-stream')) {
        const text = await readBodyLimited(upstream.res, RESPONSE_LIMIT, { onBytes: (k) => ctx.mem.grow(k) }).catch((e) => { throw e && e.kind ? e : signal.aborted ? err('invalid', 'Request cancelled') : timedOut() ? err('timeout', 'The model stopped responding. Retry the request.', { retryAfter: 5 }) : err('upstream', 'The connection to the model provider was interrupted. Retry the request.', { retryAfter: 2 }); });
        let j; try { j = JSON.parse(text); } catch { throw err('upstream', 'The model provider returned an unreadable response.'); }
        nat.whole(j); // ошибка в теле «200» → исключение, а не успех (API-02/03)
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(j));
        return { delivered: st.delivered, chars: st.chars, ttft, usage };
      }
      const sse = sseStream(res, { anthropic: proto === 'messages' });
      const wire = (x) => sse.raw(`${x.event && x.event !== 'message' ? 'event: ' + x.event + '\n' : ''}data: ${JSON.stringify(x.data)}\n\n`);
      try {
        let total = 0;
        for await (const ev of readSse(upstream.res.body, signal, (c) => { upstream.kick(); total += c.length; if (total > RESPONSE_LIMIT) throw err('upstream', 'The model provider response is larger than the allowed size.'); })) {
          const x = nat.onEvent(ev);
          for (const o of x.send) await wire(o);
          if (x.end) break;
        }
      } catch (e) {
        if (!signal.aborted) {
          const m = timedOut() ? 'The model stopped responding. Retry the request.' : 'The connection to the model provider was interrupted. Retry the request.';
          await wire(nat.cutEvent(m));
        }
        sse.end();
        return { delivered: st.delivered, chars: st.chars, ttft, usage, error: { status: signal.aborted ? 499 : timedOut() ? 504 : 502, message: 'stream interrupted' } };
      }
      if (!st.final && !signal.aborted) { // провайдер закрыл поток без финального события — это обрыв, а не успех (API-03)
        await wire(nat.cutEvent('The model provider ended the stream before the response was complete. Retry the request.'));
        sse.end();
        return { delivered: st.delivered, chars: st.chars, ttft, usage, incomplete: true, error: { status: 502, message: 'incomplete: the provider stream ended without a final event' } };
      }
      sse.end();
      return { delivered: st.delivered, chars: st.chars, ttft, usage, ...(st.error ? { error: st.error } : {}) };
    } finally { upstream.done(); }
  }
  const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };

  /* ---------- маршрутизация /v1 ---------- */
  async function handle(req, res, url) {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const proto = p.startsWith('/v1/messages') ? 'messages' : 'openai';
    const origin = d.origin(req), ip = d.clientIp(req);
    let slotUid = null, mem = null;
    try {
      if (p === '/v1') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, docs: origin + '/developers' })); }
      if (d.loadSettings().api === false) throw err('permission', 'The API is turned off by the site administrator.');
      const route = ROUTES[p], isModels = p === '/v1/models' || p.startsWith('/v1/models/'), isCount = p === '/v1/messages/count_tokens';
      if (!route && !isModels && !isCount) throw err('not_found', `Unknown endpoint ${req.method} ${p}. Supported: POST /v1/chat/completions, POST /v1/responses, POST /v1/messages, POST /v1/messages/count_tokens, GET /v1/models.`, { code: 'unknown_endpoint' });
      if (isModels ? req.method !== 'GET' : req.method !== 'POST') { res.setHeader('Allow', isModels ? 'GET' : 'POST'); throw err('invalid', `Use ${isModels ? 'GET' : 'POST'} for ${p}`, { code: 'method_not_allowed' }); }
      const { key, user } = authenticate(req, ip, origin);
      const client = detectClient(req);
      d.keys.touch(key.id, ip, client);
      if (isModels) {
        takeAux('models', user.id);
        const anthropic = !!req.headers['anthropic-version'];
        const list = available(user, key);
        if (p === '/v1/models') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          return res.end(JSON.stringify(anthropic ? { data: list.map((m) => modelObj(m, true)), has_more: false, first_id: list[0] ? list[0].slug : null, last_id: list.length ? list[list.length - 1].slug : null } : { object: 'list', data: list.map((m) => modelObj(m, false)) }));
        }
        let id; try { id = decodeURIComponent(p.slice('/v1/models/'.length)); } catch { throw err('not_found', 'Model not found or not available on your plan.'); }
        const m = resolve(list, id);
        if (!m) throw err('not_found', 'Model not found or not available on your plan.');
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(modelObj(m, anthropic)));
      }
      // порядок: размер из заголовка → лимит запросов и слот → место под тело → чтение. Слот берётся ДО чтения тела,
      // иначе один ключ мог бы держать сотни гигабайтных тел в памяти, не упираясь в лимит параллельных запросов.
      const limit = isCount ? COUNT_BODY_LIMIT : BODY_LIMIT, cl = Number(req.headers['content-length']);
      const early = (e) => { dropBody(req, res); return e; };
      if (cl > limit) throw early(err('too_large', `Request body is larger than ${Math.round(limit / 1048576)} MB`));
      if (isCount) { try { takeAux('count', user.id); } catch (e) { throw early(e); } }
      else { try { takeSlot(user.id); slotUid = user.id; } catch (e) { throw early(e); } }
      const enc = String(req.headers['content-encoding'] || 'identity').toLowerCase();
      // резерв держится до конца ответа (а не только на время чтения тела): тело и ответ остаются в памяти (API-05)
      try { mem = memReserve(user.id, enc === 'identity' && Number.isFinite(cl) ? cl : limit); } catch (e) { throw early(e); } // сжатое тело в памяти больше, а без длины размер неизвестен
      const stat = { bytes: 0 };
      const body = await readJson(req, limit, BODY_TIMEOUT_MS, stat);
      mem.shrink(stat.bytes);
      if (isCount) {
        const parsed = conv.fromMessages({ ...body, max_tokens: 1 });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ input_tokens: estimateTokens(parsed.body.messages, parsed.body.tools) }));
      }
      return await generate({ req, res, proto: route, body, user, key, client, ip, origin, slotHeld: true, mem });
    } catch (e) {
      if (!e || !e.kind) { d.monitor.error('API ' + p, e); e = err('server', 'Internal server error. It has been logged.'); }
      return sendError(res, e, proto);
    } finally {
      if (slotUid) release(slotUid);
      if (mem) mem.release();
    }
  }

  return { handle, generate, available, limits: { rpm: RPM, concurrency: CONCURRENCY } };
}

module.exports = { createGateway };
