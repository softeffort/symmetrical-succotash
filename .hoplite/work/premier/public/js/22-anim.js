// Premier — клиент: «видео кодом». Если в открытой версии есть <meta name="premier-animation">, под шапкой окна предпросмотра
// появляется полоса со сведениями о ролике и кнопкой «Скачать MP4»: сервер записывает анимацию покадрово (animation.js),
// страница опрашивает ход записи и скачивает готовый файл. Один файл для RU и EN, подключается последним.
(function anim() {
  const EN = document.documentElement.lang === 'en';
  const T = EN ? {
    kind: 'Code video', sec: 's', fps: 'fps', dl: 'Download MP4', again: 'Download again', retry: 'Try again', rec: 'Recording', queue: (n) => 'In queue: #' + n,
    done: 'MP4 is ready', start: 'Starting…', lost: 'Lost connection to the server',
    codes: {
      no_ffmpeg: 'MP4 export is not available on this server (ffmpeg is not installed). The animation still plays in the preview.',
      no_browser: 'MP4 export is not available on this server (the built-in browser is not installed). The animation still plays in the preview.',
      busy: 'The previous video is still being recorded — wait for it to finish.', rate: 'Too many recordings this hour, try again later.',
      queue_full: 'The recording queue is full, try again in a couple of minutes.', timeout: 'Recording took too long. Make the animation shorter or simpler.',
      bad_html: 'The animation code is not complete yet.', render: 'Could not record the video.',
    },
  } : {
    kind: 'Видео кодом', sec: 'с', fps: 'к/с', dl: 'Скачать MP4', again: 'Скачать ещё раз', retry: 'Повторить', rec: 'Запись', queue: (n) => 'В очереди: №' + n,
    done: 'MP4 готов', start: 'Запускаем…', lost: 'Нет связи с сервером',
    codes: {
      no_ffmpeg: 'Скачать MP4 здесь нельзя: на сервере не установлен ffmpeg. Анимация по-прежнему работает в предпросмотре.',
      no_browser: 'Скачать MP4 здесь нельзя: на сервере не установлен встроенный браузер. Анимация по-прежнему работает в предпросмотре.',
      busy: 'Предыдущий ролик ещё записывается — дождитесь окончания.', rate: 'Слишком много записей за час, попробуйте позже.',
      queue_full: 'Очередь записи заполнена, попробуйте через пару минут.', timeout: 'Запись заняла слишком много времени. Сделайте анимацию короче или проще.',
      bad_html: 'Код анимации ещё не готов.', render: 'Не удалось записать видео.',
    },
  };
  const META = /<meta\b[^>]*\bname\s*=\s*["']?premier-animation["']?[^>]*>/i;
  // сведения для подписи; границы и умолчания — те же, что на сервере (animation.js, parseMeta)
  function info(code) {
    const tag = META.exec(code); if (!tag) return null;
    const c = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag[0]), kv = {};
    for (const part of String((c && (c[1] ?? c[2] ?? c[3])) || '').split(/[;,]/)) { const m = /^\s*([a-z]+)\s*[=:]\s*(\S+)\s*$/i.exec(part); if (m) kv[m[1].toLowerCase()] = m[2]; }
    const n = (v, d, lo, hi) => { const x = parseFloat(v); return x > 0 ? Math.min(hi, Math.max(lo, x)) : d; };
    return { d: n(kv.duration, 8, 0.5, 60), f: Math.round(n(kv.fps, 30, 10, 60)), w: Math.round(n(kv.width, 1920, 128, 1920)), h: Math.round(n(kv.height, 1080, 128, 1920)) };
  }
  let st = null; // { code, status: 'start'|'queued'|'running'|'done'|'error', progress, pos, msg }
  const bar = () => document.getElementById('animbar');

  function render() {
    const el = bar(), a = typeof curArt === 'function' ? curArt() : null, i = a && a.closed ? info(a.code) : null;
    if (!el) return;
    if (!i) { el.hidden = true; return; }
    const s = st && st.code === a.code ? st : null, busy = !!s && ['start', 'queued', 'running'].includes(s.status);
    let text = `${T.kind} · ${+i.d.toFixed(1)} ${T.sec} · ${i.f} ${T.fps} · ${i.w}×${i.h}`, cls = 'anim-info';
    if (s) {
      if (s.status === 'start') text = T.start;
      else if (s.status === 'queued') text = T.queue(s.pos || 1);
      else if (s.status === 'running') text = T.rec + '… ' + Math.round(s.progress || 0) + '%';
      else if (s.status === 'done') text = T.done;
      else if (s.status === 'error') { text = s.msg; cls += ' anim-err'; }
    }
    const label = busy ? T.rec : s && s.status === 'done' ? T.again : s && s.status === 'error' ? T.retry : T.dl;
    const pct = s && s.status === 'running' ? Math.round(s.progress || 0) : s && s.status === 'done' ? 100 : 0;
    el.hidden = false;
    el.innerHTML = `<span class="${cls}"${s && s.status === 'error' ? ' role="alert"' : ' aria-live="polite"'}>${esc(text)}</span>` +
      `<button type="button" class="pri" id="pMp4" ${busy ? 'disabled aria-busy="true"' : ''}><svg><use href="#i-dl"/></svg>${esc(label)}</button>` +
      (busy ? '<span class="anim-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></span>' : '');
    const prog = el.querySelector('.anim-prog i'); if (prog) prog.style.width = pct + '%';
    const pb = el.querySelector('.anim-prog'); if (pb) pb.setAttribute('aria-valuenow', String(pct));
  }

  const fail = (s, code, fallback) => { s.status = 'error'; s.msg = T.codes[code] || (EN ? T.codes.render : fallback) || T.codes.render; render(); };
  async function poll(s, id) {
    let misses = 0;
    while (st === s) {
      await new Promise((r) => setTimeout(r, 1000));
      if (st !== s) return;
      try {
        const r = await fetch('/api/animation/render/' + id);
        if (r.status === 401) return toLogin();
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return fail(s, j.code, j.error);
        misses = 0; apply(s, j); if (s.status === 'done' || s.status === 'error') return;
      } catch { if (++misses > 5) { s.status = 'error'; s.msg = T.lost; render(); return; } }
    }
  }
  const live = (s) => !!s && ['start', 'queued', 'running'].includes(s.status);
  // закрыли окно, открыли другую версию или ушли со страницы во время записи — просим сервер остановить её (best effort)
  function cancel(keepalive) {
    const s = st; if (!live(s)) return; st = null;
    if (s.id) { try { fetch('/api/animation/render/' + s.id, { method: 'DELETE', keepalive: !!keepalive }).catch(() => {}); } catch {} }
    try { render(); } catch {}
  }
  function apply(s, j) {
    s.id = j.id || s.id;
    if (j.status === 'error') return fail(s, j.code, j.error);
    s.status = j.status; s.progress = j.progress || 0; s.pos = j.position || 0;
    if (j.status === 'done') { s.url = j.url; s.name = j.name; save_(s); }
    render();
  }
  function save_(s) {
    const a = document.createElement('a');
    const title = ((typeof curArt === 'function' && curArt() && curArt().title) || '').replace(/[^\wа-яё -]/gi, '').trim();
    a.href = s.url + '?dl=1'; a.download = (title || 'animation') + '.mp4'; document.body.appendChild(a); a.click(); a.remove();
  }
  async function start() {
    const a = typeof curArt === 'function' ? curArt() : null; if (!a || !a.closed || !info(a.code)) return;
    if (st && st.code === a.code && ['start', 'queued', 'running'].includes(st.status)) return;
    const s = st = { code: a.code, status: 'start', progress: 0 }; render();
    try {
      const r = await fetch('/api/animation/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html: a.code, title: a.title }) });
      if (r.status === 401) return toLogin();
      const j = await r.json().catch(() => ({}));
      if (st !== s) { if (r.ok && j.id && j.status !== 'done') fetch('/api/animation/render/' + j.id, { method: 'DELETE' }).catch(() => {}); return; } // окно закрыли, пока шёл запрос
      if (!r.ok) return fail(s, j.code, j.error);
      apply(s, j); if (s.status !== 'done' && s.status !== 'error') poll(s, j.id);
    } catch { s.status = 'error'; s.msg = T.lost; render(); }
  }

  if (typeof paneUI === 'function') {
    const p = paneUI;
    paneUI = function () {
      p.apply(this, arguments);
      try { const a = typeof curArt === 'function' ? curArt() : null; if (live(st) && (!a || a.code !== st.code)) cancel(); render(); } catch {}
    };
  }
  if (typeof closeArt === 'function') { const c = closeArt; closeArt = function () { try { cancel(); } catch {} return c.apply(this, arguments); }; }
  window.addEventListener('pagehide', () => cancel(true));
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('#pMp4'); if (b && !b.disabled) start(); });
  // кнопка «Скачать MP4» под карточкой ролика в самом ответе: открываем предпросмотр (там виден ход записи) и сразу начинаем запись
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-mp4]'); if (!b || typeof showArt !== 'function') return;
    const [mid, k] = b.dataset.mp4.split(':');
    try { showArt(mid, +k, 'preview'); start(); } catch {}
  });
})();
