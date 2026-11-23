'use strict';
// Длинная цепочка инструментов (сборка проекта в облачном компьютере, на своём компьютере или в папке): каждый шаг
// добавляет в переписку с моделью вывод команд, прочитанные файлы и полный текст записанных файлов. Без уборки
// десятки шагов не помещаются в контекст модели, и ответ обрывается ошибкой провайдера.
// shrink() сокращает СТАРЫЕ шаги: результат инструмента — до начала и конца, большой аргумент записи — до начала.
// Последние шаги не трогаются: с ними модель работает прямо сейчас. Сам файл на диске не меняется — модель может
// прочитать его снова.
const envNum = (k, d, min, max) => { const v = Number(process.env[k]); return Number.isFinite(v) && v >= min ? Math.min(max, Math.floor(v)) : d; };
const BUDGET = envNum('AGENT_CONTEXT_CHARS', 240000, 20000, 4e6); // символов на все шаги инструментов одного ответа
const KEEP_STEPS = 3;      // столько последних шагов (ответ модели с вызовами + их результаты) остаются целыми
const TOOL_MIN = 1500;     // результат короче — не трогаем
const TOOL_HEAD = 600, TOOL_TAIL = 400;
const ARG_MIN = 600, ARG_HEAD = 200;
const IMG_COST = 20000;    // условная «цена» картинки в символах

const partSize = (p) => (p && p.type === 'text' ? String(p.text || '').length : IMG_COST);
function size(m) {
  let n = typeof m.content === 'string' ? m.content.length : Array.isArray(m.content) ? m.content.reduce((a, p) => a + partSize(p), 0) : 0;
  for (const c of m.tool_calls || []) n += String(c.function?.arguments || '').length;
  return n;
}
const total = (convo, from = 0) => { let n = 0; for (let i = from; i < convo.length; i++) n += size(convo[i]); return n; };

function shrinkTool(m) {
  const s = m.content; if (typeof s !== 'string' || s.length < TOOL_MIN) return false;
  m.content = s.slice(0, TOOL_HEAD) + `\n…[Premier: старый результат сокращён, было ${s.length} символов. Нужны эти данные — вызови инструмент ещё раз]…\n` + s.slice(-TOOL_TAIL);
  return true;
}
function shrinkCalls(m) {
  let changed = false;
  for (const c of m.tool_calls || []) {
    const raw = c.function?.arguments; if (typeof raw !== 'string' || raw.length < ARG_MIN) continue;
    let a; try { a = JSON.parse(raw); } catch { continue; }
    if (!a || typeof a !== 'object') continue;
    let hit = false;
    for (const k of Object.keys(a)) {
      if (typeof a[k] === 'string' && a[k].length >= ARG_MIN) { a[k] = a[k].slice(0, ARG_HEAD) + `…[Premier: сокращено, было ${a[k].length} символов; действие уже выполнено, актуальный текст — в файле]`; hit = true; }
    }
    if (hit) { c.function.arguments = JSON.stringify(a); changed = true; }
  }
  return changed;
}
function shrinkImages(m) {
  if (m.role !== 'user' || !Array.isArray(m.content) || !m.content.some((p) => p?.type === 'image_url')) return false;
  m.content = m.content.filter((p) => p?.type === 'text').map((p) => p.text).join('\n') + '\n[Premier: старые скриншоты убраны из переписки]';
  return true;
}

// convo — сообщения запроса к модели; from — индекс первого сообщения, добавленного цепочкой инструментов (всё, что
// раньше, — системная подсказка и история чата, их не трогаем). Возвращает, сколько символов убрано.
function shrink(convo, from, budget = BUDGET) {
  const before = total(convo, from);
  if (before <= budget) return 0;
  // границы шагов: каждый ответ модели с вызовами инструментов начинает новый шаг
  const steps = []; for (let i = from; i < convo.length; i++) if (convo[i].role === 'assistant' && convo[i].tool_calls) steps.push(i);
  const stop = steps.length > KEEP_STEPS ? steps[steps.length - KEEP_STEPS] : from;
  const goal = budget * 0.6; // с запасом: уборка меняет начало переписки и сбрасывает кэш провайдера — делаем её реже
  let now = before;
  const pass = (to, target) => {
    for (let i = from; i < to && now > target; i++) {
      const m = convo[i], was = size(m);
      if (m.role === 'tool' ? shrinkTool(m) : m.role === 'assistant' ? shrinkCalls(m) : shrinkImages(m)) now -= was - size(m);
    }
  };
  pass(stop, goal);
  // старых шагов не хватило (например, подряд прочитаны три огромных файла) — сокращаем всё, кроме самого последнего шага
  if (now > budget && steps.length > 1) pass(steps[steps.length - 1], budget);
  return before - now;
}

module.exports = { shrink, total, size, BUDGET, KEEP_STEPS };
