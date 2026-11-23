'use strict';

// SSE с корректным flush: последний JSON не теряется, даже если нет финального \n.
// BIZ-14: поток, который закончился без [DONE] и без finish_reason, — обрыв, а не готовый ответ: после последнего события
// бросается ошибка с code 'stream_cut' (всё, что пришло до обрыва, вызывающий код уже получил). Проверку можно отключить
// для поставщика, который не присылает ни того, ни другого: STREAM_END_CHECK=off.
const END_CHECK = () => String(process.env.STREAM_END_CHECK || '').toLowerCase() !== 'off';
async function* events(response) {
  if (!response.body) throw new Error('API модели вернул пустой поток');
  const decoder = new TextDecoder();
  let buffer = '', ended = false;
  const parse = (line) => {
    line = line.trim();
    if (!line.startsWith('data:')) return null;
    const value = line.slice(5).trim();
    if (value === '[DONE]') { ended = true; return null; }
    if (!value) return null;
    let event;
    try { event = JSON.parse(value); } catch { throw new Error('API модели вернул некорректный JSON в потоке'); }
    if (event.error) {
      // 2026-11-13: показываем причину от провайдера — раньше ошибка была «безликой»,
      // и нельзя было отличить timeout relay от реальной ошибки генерации.
      const em = typeof event.error === 'string' ? event.error
        : ((event.error && (event.error.message || event.error.msg)) || '');
      throw new Error('API модели сообщил ошибку генерации' + (em ? ': ' + String(em).slice(0, 300) : ''));
    }
    if (Array.isArray(event.choices) && event.choices.some((c) => c && c.finish_reason != null)) ended = true;
    return event;
  };
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    if (buffer.length > 4e6) throw new Error('Слишком большой фрагмент потока модели');
    const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) { const event = parse(line); if (event) yield event; }
  }
  buffer += decoder.decode();
  if (buffer.trim()) { const event = parse(buffer); if (event) yield event; }
  if (!ended && END_CHECK()) throw Object.assign(new Error('API модели оборвал поток: ответ не завершён'), { code: 'stream_cut' });
}

function timeoutMs() {
  const value = Number(process.env.MODEL_REQUEST_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 1000 ? Math.min(1600000, Math.floor(value)) : 180000;
}
module.exports = { events, timeoutMs };
