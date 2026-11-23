// Premier — клиент: chat (общие переменные — в 01-core.js; файлы подключаются по порядку в chat.html)
/* ---------- models ---------- */
async function loadModels() {
  try { MODELS = await (await fetch('/api/models')).json(); } catch { MODELS = []; }
  try { CFG = await (await fetch('/api/config')).json(); } catch { CFG = { search: false }; }
  pickModel();
  save(); render();
}

/* ---------- chat ---------- */
// Сколько символов ответа уже показано: текст выводится плавно, а не рывками по кускам от сервера.
const SHOWN = new WeakMap();
// Ответ готовится на сервере, даже когда человек ушёл: закрыл вкладку, свернул приложение, пропала связь.
// Готовый ответ ждёт на сервере сутки (CHAT_GEN_KEEP_HOURS) и переживает перезапуск. При возвращении страница
// сама дочитывает его через /api/chat/resume — сидеть и ждать с открытым окном не нужно.
const PENDING_TTL = 24 * 3600e3, PENDING_MAX = 30 * 24 * 3600e3;
const GEN_GONE = 'Ответ не сохранился на сервере: прошло слишком много времени или сервер перезапускался. Нажмите «Повторить».';
// id живого сообщения -> { at: когда последний раз пришли данные (сервер шлёт «#kb» каждые 15 с), cut: оборвать соединение и переподключиться }
const NET = new Map();
// ответ, которого в этом браузере ещё нет: страницу закрыли раньше, чем он пришёл (или чат открыт на другом устройстве)
const emptyAnswer = (m) => !m.t && !m.gens?.length && !m.vids?.length && !m.runs?.length && !m.agops?.length && !m.fsops?.length && !m.cfiles?.files?.length && !m.steps?.length;
function pendingOf(c) {
  if (busyMap.has(c.id)) return null;
  let best = null;
  for (const m of c.msgs) {
    if (m.r !== 'a' || m.cancelled || m.live) continue;
    let at = 0;
    if (m.pendingGen) { // ответ готовился, когда страницу закрыли или пропала связь
      if (Date.now() - m.pendingGen < PENDING_MAX) at = m.pendingGen;
      else { delete m.pendingGen; if (emptyAnswer(m) && !m.err) m.err = GEN_GONE; }
    } else if (!m.err && m === c.msgs.at(-1) && emptyAnswer(m) && m.sentAt && Date.now() - m.sentAt < PENDING_TTL) at = m.sentAt;
    if (at && (!best || at > best.at)) best = { c, m, at };
  }
  return best;
}
function findPending() { return S.chats.map(pendingOf).filter(Boolean).sort((a, b) => b.at - a.at); }
function startPendingResume() {
  const list = findPending(); if (!list.length) return;
  // чат с ответом, которого человек ждал только что, открываем; остальные ответы дочитываются в фоне
  const f = list[0];
  if (!anyBusy() && S.cur !== f.c.id && Date.now() - f.at < 30 * 60000) { S.cur = f.c.id; persistLocal(); }
  render();
  for (const x of list) stream(x.c, x.m, true);
}
async function readLines(body, id, onLine) {
  const rd = body.getReader(), dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { done, value } = await rd.read(); if (done) break;
    const n = NET.get(id); if (n) n.at = Date.now();
    buf += dec.decode(value, { stream: true });
    const ls = buf.split('\n'); buf = ls.pop();
    for (const line of ls) { if (!line.trim()) continue; let o; try { o = JSON.parse(line); } catch { continue; } onLine(o); }
  }
}
// Дочитываем ответ с сервера: с места pos() и до отметки конца (isFin). Связь может рваться много раз — каждый раз
// продолжаем с того же места. Итог: 'done' — получен целиком; 'gone' — на сервере такого ответа нет;
// 'lost' — связь так и не вернулась (ответ остаётся ждать на сервере); 'stop' — остановил человек.
async function tryResume(msg, pos, handle, ra, isFin) {
  let fails = 0;
  while (msg.live && !ra.signal.aborted) {
    const at = new AbortController(), off = () => at.abort(), was = pos();
    ra.signal.addEventListener('abort', off);
    NET.set(msg.id, { at: Date.now(), cut: off });
    try {
      const rr = await fetch('/api/chat/resume?g=' + encodeURIComponent(msg.id) + '&from=' + was, { signal: at.signal });
      if (rr.status === 401) { toLogin(); return 'stop'; }
      if (rr.status === 404) return 'gone';
      if (rr.ok && rr.body) { await readLines(rr.body, msg.id, handle); if (isFin()) return 'done'; }
    } catch {}
    finally { ra.signal.removeEventListener('abort', off); NET.delete(msg.id); }
    if (ra.signal.aborted) break;
    if (pos() > was) fails = 0; // что-то дошло — связь была, считаем попытки заново
    else if ((fails += navigator.onLine === false ? 0.15 : 1) >= 45) return 'lost'; // полторы минуты при сети, десять — без неё
    await new Promise((r) => setTimeout(r, 2000));
  }
  return 'stop';
}
async function stream(c, msg, resumed) {
  const model = curModel();
  if (!model && !resumed) { msg.err = 'Модель не выбрана.'; delete msg.pendingGen; save(); render(); return; }
  const pinned = PremierArtifact.forChat(c, msg.id);
  msg.artifactParent = pinned ? { mid: pinned.mid, k: pinned.k } : null;
  msg.m = resumed ? (msg.m || (model && model.name) || '') : model.name;
  const before = resumed && !emptyAnswer(msg) ? clean(msg) : null; // то, что уже было на экране, — вернём, если на сервере ответа не окажется
  msg.live = true; msg.thinking = true; msg.t = ''; SHOWN.set(msg, 0);
  if (!resumed || !msg.sentAt) msg.sentAt = Date.now(); delete msg.dur;
  delete msg.err; delete msg.cancelled; delete msg.diag; delete msg.validation; delete msg.steps; delete msg.sources; delete msg.think; delete msg.thinkMs; delete msg.runs; delete msg.gens; delete msg.vids; delete msg.assets; delete msg.vprog; delete msg.drawAt; delete msg.fsops; delete msg.agops; delete msg.cfiles; delete msg.more;
  msg.stepOn = false;
  msg.pendingGen = resumed ? (msg.pendingGen || Date.now()) : Date.now();
  liveMap.set(c.id, msg);
  persistLocal(); // отметка «ответ готовится» должна пережить закрытие вкладки: по ней ответ дочитывается при следующем входе
  const history = resumed ? [] : buildHistory(c.msgs.filter((x) => x !== msg && !x.err && !x.cancelled && (x.t || x.files?.length || x.images?.length || x.agops?.length || x.fsops?.length))).slice(-40);
  // Старые большие версии не должны раздувать транспорт. Последнее сообщение
  // пользователя не обрезаем; закреплённый исходник передаётся отдельно.
  while (history.length > 1 && JSON.stringify(history).length > 8 * 1024 * 1024) history.shift();
  const proj = S.projects.find((p) => p.id === c.proj);
  const ac = new AbortController(); busyMap.set(c.id, ac);
  if (!resumed) pushNow(c.id); // вопрос сразу уходит на сервер, а не после ответа: он не пропадёт, если страницу закроют
  let thinkAt = 0; // Нужен и после try: ответ только с reasoning не должен ломать завершение.
  let first = true, pending = false, shown = 0;
  let saved = false, fin = false, lost = false, opened = false; // fin — сервер прислал отметку конца: ответ получен целиком
  let raw = '', srvThink = '', inThink = '', applied = 0;
  const setThink = () => { const t = srvThink + (inThink ? (srvThink ? '\n' : '') + inThink : ''); if (t) { msg.think = t; thinkAt ||= Date.now(); } };
  const tb = () => { if (c.id === S.cur) toBottom(); };
  const paint = () => {
    pending = false;
    if (!msg.live) return;
    if (c.id !== S.cur) { shown = msg.t.length; SHOWN.set(msg, shown); return; } // ответ закончился или чат в фоне — его DOM сейчас не отображается, скролл не трогаем
    const ch = $('chat'), near = ch.scrollHeight - ch.scrollTop - ch.clientHeight < 80;
    const el = document.querySelector(`[data-id="${msg.id}"] .md`);
    // Плавный вывод: за кадр добавляем часть «хвоста», который ещё не показан. Большой хвост догоняем сразу.
    const full = msg.t, back = full.length - shown;
    shown = back <= 0 ? full.length : shown + (back > 600 ? back - 300 : Math.max(2, Math.ceil(back / 6)));
    if (shown < full.length && /[\uD800-\uDBFF]/.test(full[shown - 1] || '')) shown++;
    SHOWN.set(msg, shown);
    const vis = full.slice(0, shown);
    if (el) el.innerHTML = md(vis, msg.id) + (vis ? '<span class="cursor"></span>' : '');
    const tb = document.querySelector(`[data-id="${msg.id}"] .think-b`);
    if (msg.think && !tb) renderChat(); else if (tb && tb.textContent !== msg.think.trim()) { const atEnd = tb.scrollHeight - tb.scrollTop - tb.clientHeight < 30; tb.textContent = msg.think.trim(); if (atEnd) tb.scrollTop = tb.scrollHeight; }
    followArt(msg);
    if (near) toBottom();
    if (shown < msg.t.length && !pending) { pending = true; requestAnimationFrame(paint); }
  };
  // Строка «Модель думает» закрывается, как только пришло что-то, кроме самого ожидания.
  const endWait = () => { const w = msg.steps?.at(-1); if (w && w.s === 'waiting' && w.from && !w.end) w.end = Date.now(); };
  const handle = (o) => { applied++; msg.lastAt = Date.now();
    if (o.fin) { fin = true; return; }
    if (o.s !== 'waiting' && !o.bill && !o.diag && !o.src) endWait();
    if (o.reset) {
      raw = ''; inThink = ''; msg.t = ''; first = true; shown = 0; SHOWN.set(msg, 0);
      if (A.mid === msg.id) closeArt();
      renderChat();
    } else if (o.t) {
      raw += o.t;
      const tm = raw.match(/^\s*<think>([\s\S]*?)(<\/think>\s*|$)/);
      if (tm) { inThink = tm[1]; msg.t = tm[2] ? raw.slice(tm[0].length) : ''; setThink(); }
      else msg.t = raw.trim() && '<think>'.startsWith(raw.trimStart()) ? '' : raw;
      if (msg.t && msg.think && !msg.thinkMs) { msg.thinkMs = Date.now() - thinkAt; renderChat(); }
      if ((first && msg.t) || (msg.stepOn && msg.t)) { first = false; msg.thinking = false; msg.stepOn = false; renderChat(); }
      if (!pending) { pending = true; requestAnimationFrame(paint); }
    } else if (o.r) {
      srvThink += o.r; setThink(); msg.thinking = false;
      if (msg.stepOn && msg.steps?.at(-1)?.s === 'waiting') { msg.stepOn = false; renderChat(); }
      if (!pending) { pending = true; requestAnimationFrame(paint); }
    } else if (o.fs) {
      fsHandle(o.fs, msg);
    } else if (o.ag) { agHandle(o.ag, msg);
    } else if (o.agres) { agResult(o.agres, msg);
    } else if (o.asset) {
      (msg.assets ||= []).push(o.asset); msg.stepOn = false; renderChat(); tb();
    } else if (o.img) {
      (msg.gens ||= []).push(o.img); msg.stepOn = false; delete msg.drawAt; renderChat(); tb();
    } else if (o.vid) {
      (msg.vids ||= []).push(o.vid); msg.stepOn = false; delete msg.drawAt; delete msg.vprog; renderChat(); tb();
    } else if (o.vp != null) {
      msg.vprog = o.vp; const b = document.querySelector('.gen.draw .dbar i'); if (b) b.style.width = Math.max(3, o.vp) + '%';
    } else if (o.run) {
      (msg.runs ||= []).push(o.run); msg.stepOn = false; renderChat(); tb();
    } else if (o.more) {
      msg.more = 1; // шаги с инструментами закончились — под ответом появится кнопка «Продолжить»
    } else if (o.cfiles) {
      msg.cfiles = o.cfiles; msg.stepOn = false; renderChat(); tb();
    } else if (o.s === 'waiting' && o.ms != null) {
      const w = msg.steps?.at(-1), from = Date.now() - o.ms;
      if (w && w.s === 'waiting' && w.from && !w.end) Object.assign(w, { q: o.q, ms: o.ms, from: Math.min(w.from, from) });
      else (msg.steps ||= []).push({ s: 'waiting', q: o.q, ms: o.ms, from });
      msg.stepOn = true; renderChat();
    } else if (o.s === 'ok') { const ch = (msg.steps || []).filter((x) => x.s === 'check').pop(); if (ch) ch.ok = true; msg.stepOn = false; renderChat(); }     else if (o.s) { (msg.steps ||= []).push({ s: o.s, q: o.q }); msg.stepOn = o.s !== 'fail'; renderChat(); tb(); }
    else if (o.src) msg.sources = o.src;
    else if (o.bill) { BILL = o.bill; renderPlan(); }
    else if (o.validation) { msg.validation = o.validation; renderChat(); }
    else if (o.diag) msg.diag = o.diag;
    else if (o.e) msg.err = o.e; // Дочитываем bill/diag после ошибки.
  };
  render(); if (c.id === S.cur) toBottom();
  const folderInfo = resumed ? null : await fsInfo();
  const none = () => emptyAnswer({ ...msg, steps: null });
  // дочитать ответ с сервера после разрыва или при возвращении на страницу
  const resume = async () => {
    const ra = new AbortController(); resumeMap.set(c.id, ra);
    const st = await tryResume(msg, () => applied, handle, ra, () => fin);
    resumeMap.delete(c.id);
    if (st === 'done') { saved = true; msg._resumed = true; if (none() && !msg.err) { msg.cancelled = true; msg.t = 'Генерация остановлена.'; } }
    else if (st === 'stop') { saved = true; msg.cancelled = true; if (!msg.t) msg.t = 'Генерация остановлена.'; }
    else if (st === 'lost') { saved = true; lost = true; msg.err = 'Нет связи с сервером. Ответ готовится дальше и подгрузится сам, когда связь вернётся.'; }
    return st;
  };
  try {
    if (resumed) {
      if (await resume() === 'gone') { if (before) Object.assign(msg, JSON.parse(before)); msg.err = before ? 'Соединение оборвалось — ответ не дошёл до конца. Нажмите «Повторить», чтобы сгенерировать его заново.' : GEN_GONE; }
    } else {
      const r = await fetch('/api/chat', { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        model: model.id, messages: history, instructions: proj?.instructions || '', ...(proj?.files?.length ? { knowledge: proj.files.map((x) => ({ name: x.name, text: x.text })) } : {}), web: !!(S.web && CFG.search), img: !!S.img, mid: msg.id,
        ...(pinned ? { currentArtifact: { source: pinned.source } } : {}),
        ...(folderInfo ? { folder: folderInfo } : {}), ...(agUsable() ? { agent: true, agentAuto: AG.auto } : {}), ...(clUsable() ? { cloud: true } : {}), ...(agUsable() || clUsable() ? { agentFull: agFull() } : {}),
      }) });
      if (r.status === 401) return toLogin();
      if (!r.ok) { const j = await r.json().catch(() => ({ error: r.status === 413 ? 'Запрос слишком большой — уберите часть вложений или начните новый чат' : r.status >= 502 && r.status <= 504 ? 'Сервер Premier временно недоступен — повторите через минуту' : 'Ошибка сервера ' + r.status })); if (j.code === 'limit' && typeof growthOut === 'function') loadBill().then(() => growthOut(j)); else if (j.code === 'limit' || j.code === 'model') { setTimeout(() => openPlans(j.error), 300); loadBill(); } if (j.code === 'credits' && typeof openUltra === 'function') setTimeout(() => openUltra(j.error), 300); throw new Error(j.error || 'Ошибка сервера ' + r.status); }
      opened = true;
      NET.set(msg.id, { at: Date.now(), cut: () => { msg.stale = true; ac.abort(); } });
      const reader = r.body.getReader(), dec = new TextDecoder();
      const ndjson = (r.headers.get('content-type') || '').includes('ndjson');
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        const net = NET.get(msg.id); if (net) net.at = Date.now();
        const chunk = dec.decode(value, { stream: true });
        if (!ndjson) { handle({ t: chunk }); continue; }
        buf += chunk;
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) { if (!line.trim()) continue; let o; try { o = JSON.parse(line); } catch { continue; } handle(o); }
      }
      // поток закрылся без отметки конца — соединение оборвали по дороге (прокси, сеть): дочитываем остальное
      if (ndjson && !fin) throw new Error('Соединение оборвалось — ответ не дошёл до конца. Нажмите «Повторить», чтобы сгенерировать его заново.');
      if (!msg.err && !msg.t && !msg.gens?.length && !msg.vids?.length && !msg.cfiles?.files?.length && !msg.fsops?.some((o) => o.op) && !msg.agops?.some((o) => o.write)) msg.err = 'Модель вернула пустой ответ.';
    }
  } catch (e) {
    const stale = msg.stale === true; msg.stale = false; // соединение оборвали мы сами: оно молчало
    // запрос не ушёл вовсе, сети нет — ждать нечего, сразу показываем ошибку
    if (!resumed && msg.live && msg.id && (e.name !== 'AbortError' || stale) && (opened || navigator.onLine !== false)) {
      if (await resume() === 'done' && !msg.cancelled) toast('Соединение восстановлено');
    }
    if (!saved) {
      if (!resumed && ac.signal.aborted && !stale) { msg.cancelled = true; if (!msg.t) msg.t = 'Генерация остановлена.'; }
      else if (!resumed) { const mid = !!(msg.t || (msg.steps || []).length || msg.gens?.length || msg.vids?.length); msg.err = mid ? 'Соединение оборвалось — ответ не дошёл до конца. Нажмите «Повторить», чтобы сгенерировать его заново.' : (/Failed to fetch|network/i.test(e.message || '') ? 'Не удалось подключиться к серверу — проверьте сеть и нажмите «Повторить».' : (e.message || 'Не удалось получить ответ.')); }
    }
  }
  fsCancel(msg); busyMap.delete(c.id); liveMap.delete(c.id); NET.delete(msg.id); msg.live = false; msg.thinking = false; msg.stepOn = false; delete msg.stale;
  if (!lost) delete msg.pendingGen; // связь не вернулась — отметка остаётся: ответ дочитается, когда сеть появится
  if (msg.sentAt && !resumed && !msg.err && !msg.cancelled) msg.dur = Date.now() - msg.sentAt;
  if (!msg.err && !msg.cancelled && (!ac.signal.aborted || msg._resumed === true) && (!msg.validation || msg.validation.status === 'passed')) {
    const versions = PremierArtifact.extract(msg.t);
    for (let k = versions.length - 1; k >= 0; k--) {
      if (versions[k].valid) {
        c.artifactRef = { mid: msg.id, k };
        if (msg.diag?.artifactMode === 'edit' && S.cur === c.id) showArt(msg.id, k, 'preview');
        break;
      }
    }
  }
  if (msg.think && !msg.thinkMs && thinkAt) msg.thinkMs = Date.now() - thinkAt;
  if (A.follow && A.mid === msg.id) { A.follow = false; const a = getArts(msg.t)[A.k]; if (a) showArt(msg.id, A.k, 'preview', { inspect: !!msg.validation && msg.validation.status !== 'passed' }); }
  if (settleRemote(c.id)) { prep(); if (A.open && !findMsg(A.mid)) closeArt(); } // пока шёл ответ, чат дополнили на другом устройстве
  save(); render();
}
function stop(chatId) {
  const cid = chatId || S.cur, lm = liveMap.get(cid);
  if (lm && lm.id) { try { fetch('/api/chat/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mid: lm.id }) }); } catch {} }
  const ac = busyMap.get(cid); if (ac) ac.abort();
  const ra = resumeMap.get(cid); if (ra) { try { ra.abort(); } catch {} resumeMap.delete(cid); }
}
// Соединение молчит (нет даже «#kb») — оно мертво, хотя браузер об этом не сообщил (телефон был в фоне, сменилась сеть):
// рвём его сами и дочитываем ответ с того же места.
const cutStale = (ms) => { for (const lm of liveMap.values()) { const n = NET.get(lm.id); if (lm.live && n && Date.now() - n.at > ms) { n.at = Date.now(); n.cut(); } } };
document.addEventListener('visibilitychange', () => { if (!document.hidden) { cutStale(40000); startPendingResume(); } });
window.addEventListener('online', () => { cutStale(20000); startPendingResume(); });
setInterval(() => { if (!document.hidden) cutStale(60000); }, 15000);
function send(t) {
  t = t.trim();
  const files = PEND.filter((x) => x.kind === 'file' && x.text != null), images = PEND.filter((x) => x.kind === 'img' && x.url);
  if ((!t && !files.length && !images.length) || busyMap.has(S.cur) || !MODELS.length) return;
  if (PEND.some((x) => x.loading)) { toast('Подождите, файлы ещё читаются'); return; }
  if (images.length && !curModel()?.vision) { toast('Эта модель не понимает картинки — выберите другую'); return; }
  const cm = curModel();
  if (cm && locked(cm)) { openPlans(`Модель «${cm.name}» доступна на тарифе ${tierName(cm)}. Выберите другую модель или улучшите тариф.`); return; }
  if (BILL && BILL.limits.m != null && BILL.used.m + (cm?.weight || 1) > BILL.limits.m && !((BILL.ref?.bonus?.n || 0) >= (cm?.weight || 1))) { if (typeof growthOut === 'function' && gwFree()) { growthOut({ resetsAt: BILL.resetsAt }); return; } openPlans(BILL.unlimited ? 'Достигнут дневной предел. Он обновится в полночь по Москве.' : `Сообщения на сегодня закончились (${BILL.plan.name}: ${BILL.limits.m} в день). Лимит обновится в полночь по Москве — или улучшите тариф прямо сейчас.`); return; }
  let c = cur();
  const title = t || files[0]?.name || 'Картинка';
  if (!c) { c = { id: uid(), title: title.length > 42 ? title.slice(0, 42) + '…' : title, proj: S.proj, msgs: [] }; S.chats.unshift(c); S.cur = c.id; }
  const um = { id: uid(), r: 'u', t };
  if (files.length) um.files = files.map((f) => ({ name: f.name, size: f.size, text: f.text }));
  const ups = typeof clUsable === 'function' && clUsable() ? PEND.filter((x) => x.up).map((x) => x.up) : []; // эти файлы уже лежат в облачном компьютере
  if (ups.length) um.up = ups;
  if (images.length) um.images = images.map((x) => x.url);
  if (PICK) { um.pick = PICK; PICK = null; renderPick(); }
  if (typeof micStop === 'function') micStop(true); // диктовка заканчивается: дораспознанные слова не должны вернуться в пустое поле
  c.msgs.push(um); PEND = []; renderAtts();
  const a = { id: uid(), r: 'a', t: '' }; c.msgs.push(a);
  $('q').value = ''; grow(); save(); stream(c, a);
}
function grow() {
  const q = $('q'), m = $('mirror'); m.style.width = q.clientWidth + 'px'; m.style.font = getComputedStyle(q).font; m.textContent = q.value + ' ';
  const h = Math.max(26, Math.min(200, m.scrollHeight)); q.style.height = h + 'px'; q.style.overflowY = m.scrollHeight > 200 ? 'auto' : 'hidden';
}
function switchTo(fn) {
  const col = $('col'); closeArt(); col.classList.add('fade'); fn(); renderSide(); renderTop();
  setTimeout(() => { markSeen(); renderChat(); renderSend(); toBottom(); col.classList.remove('fade'); }, 150);
}
function closeMobile() { $('side').classList.remove('mopen'); $('overlay').classList.remove('on'); }
function flash(b) { b.innerHTML = '<svg class="pop"><use href="#i-check"/></svg>'; setTimeout(() => (b.innerHTML = '<svg class="pop"><use href="#i-copy"/></svg>'), 1200); }
