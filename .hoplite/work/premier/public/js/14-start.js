// Premier — клиент: start (общие переменные — в 01-core.js; файлы подключаются по порядку в chat.html)
/* ---------- запуск ---------- */
paintMe(); render(); loadModels(); loadBill(); renderPick();
pull(true);
setTimeout(startPendingResume, 600); // добираем ответ, который генерировался при закрытой вкладке
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(false); });

// Language switches reload UI assets, not the stored conversations. Preserve the composer.
if (window.PremierLanguage) {
  const draftKey = 'premier:language-draft:' + ME.id;
  try { const draft = sessionStorage.getItem(draftKey); if (draft !== null) { $('q').value = draft; sessionStorage.removeItem(draftKey); grow(); renderSend(); } } catch {}
  window.PremierLanguage.beforeSwitch = async () => {
    if (anyBusy()) { toast('Остановите генерацию перед сменой языка'); return false; }
    if (PEND.length) { toast('Отправьте или уберите вложения перед сменой языка'); return false; }
    try { sessionStorage.setItem(draftKey, $('q').value); } catch { if ($('q').value) { toast('Не удалось сохранить черновик — скопируйте его перед сменой языка'); return false; } }
    persistLocal(); await push(); return true;
  };
}

/* ---------- реферальная привязка после входа — в 15-growth.js (там же текст под режим REF_MODE) ---------- */
