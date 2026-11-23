'use strict';
// Публикация папки из облачного компьютера: снимок статических файлов в data/sites/<id>/ — постоянная ссылка /s/<id>,
// которая работает, даже когда компьютер спит. Раздаёт publication.js (тот же sandbox и плашка Premier, что у сайтов
// из чата). Повторная публикация той же папки обновляет сайт по прежней ссылке.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfs = require('./cloud-fs');
const fsp = fs.promises;

const MAX_BYTES = 25 * 1048576, MAX_FILES = 2000, MAX_SITES = 20;
// пределы обхода папки при публикации (CLD-17): записей всего (вместе с пропускаемыми), вложенность, время
const SCAN_MAX = 20000, DEPTH_MAX = 30, SCAN_MS = 20000;
const SKIP = new Set(['node_modules', '__pycache__']);
const mbs = (n) => (n / 1048576).toFixed(1).replace(/\.0$/, '') + ' МБ';

const TOOL = { type: 'function', function: { name: 'computer_publish', description: 'Опубликовать папку с готовым сайтом из облачного компьютера по постоянной ссылке, которую можно отправить кому угодно (работает и когда компьютер спит). Нужен index.html в папке; скрытые файлы и node_modules не публикуются. Повторная публикация той же папки обновляет сайт по той же ссылке. Пользователь подтверждает.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Папка сайта, например ~/landing или ~/app/dist' } }, required: ['path'] } } };
const NOTE = '\n- Постоянная ссылка для всех: computer_publish с папкой сайта (статические файлы: index.html, CSS, JS, картинки). Серверный код (Python, Node) так не работает — только то, что открывается в браузере. Для Vite/React сначала собери с относительными путями: npx vite build --base=./ и публикуй папку dist. Ссылку из результата передай пользователю.';

function createCloudSites({ dir, cloud, store }) {
  const index = (uid) => store.kv.get('cloudsites:' + uid, []);
  const saveIndex = (uid, list) => store.kv.set('cloudsites:' + uid, list);
  const metaOf = (id) => { try { return JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8')); } catch { return null; } };

  // ссылки от корня (/style.css) ведут на корень Premier — переводим их в папку сайта
  const rewrite = (id, rel, buf) => {
    const ext = path.extname(rel).toLowerCase(), base = `/s/${id}/`;
    if (ext === '.html' || ext === '.htm') return Buffer.from(buf.toString('utf8').replace(/(\s(?:src|href|action|poster)\s*=\s*["'])\/(?![/\\])/gi, `$1${base}`));
    if (ext === '.css') return Buffer.from(buf.toString('utf8').replace(/url\(\s*(["']?)\/(?![/\\])/gi, `url($1${base}`));
    return buf;
  };

  // Публикация читает файлы пользователя, поэтому идёт от открытой папки (cloud-fs.js, CLD-01): каждая папка и каждый
  // файл открываются без перехода по ссылкам, а содержимое читается из уже открытого файла. Если во время публикации
  // файл или папку подменить ссылкой на файл сервера, он просто не попадёт на сайт. Обход асинхронный и с пределами
  // (CLD-17): записей, глубины и времени — большая папка не останавливает остальные запросы.
  const busy = new Set();
  async function publish(uid, src, opt) {
    if (busy.has(uid)) throw new Error('публикация уже идёт — дождитесь её окончания');
    busy.add(uid);
    try { return await publishNow(uid, src, opt?.signal); } finally { busy.delete(uid); }
  }
  async function publishNow(uid, src, signal) {
    if (signal?.aborted) throw new Error('публикация остановлена — сайт не изменён');
    const parts = cloud.relOf(uid, src);
    if (parts == null) throw new Error('опубликовать можно только папку внутри ~');
    const home = cloud.hostPath(uid, '~'), from = parts.length ? '~/' + parts.join('/') : '~', big = '— опубликуйте только папку сайта (для Vite/React — dist после сборки)';
    const list = index(uid), old = list.find((x) => x.src === from);
    if (!old && list.length >= MAX_SITES) throw new Error(`опубликовано уже ${MAX_SITES} сайтов — снимите ненужные (вкладка «Сайты»)`);
    const id = old?.id || crypto.randomBytes(5).toString('hex'), prev = old && metaOf(id);
    const tmp = path.join(dir, `${id}.tmp-${crypto.randomBytes(3).toString('hex')}`);
    await fsp.mkdir(tmp, { recursive: true });
    try {
      const files = [], titles = {}; let bytes = 0, title = '';
      try {
        await cfs.walk(home, parts, {
          maxEntries: SCAN_MAX, maxDepth: DEPTH_MAX, maxMs: SCAN_MS,
          tooMany: `в папке больше ${SCAN_MAX} записей ${big}`, tooLong: `папка обходится слишком долго ${big}`,
          skip: (name) => name.startsWith('.') || SKIP.has(name),
          onDeep: () => { throw new Error(`вложенность папок больше ${DEPTH_MAX} ${big}`); },
          onFile: async ({ rel, name, dir: d }) => {
            let f; try { f = await cfs.openFileA(d, name); } catch { return; } // стал ссылкой или исчез — не публикуем
            try {
              if (files.length + 1 > MAX_FILES) throw new Error(`в папке больше ${MAX_FILES} файлов ${big}`);
              if (bytes + f.st.size > MAX_BYTES) throw new Error(`папка больше ${mbs(MAX_BYTES)} ${big}`);
              // читаем из открытого файла и не больше остатка: файл мог вырасти после fstat
              const buf = await cfs.readAll(f.fh, MAX_BYTES - bytes).catch((e) => { throw e.code === 'ETOOBIG' ? new Error(`папка больше ${mbs(MAX_BYTES)} ${big}`) : e; });
              bytes += buf.length; files.push({ r: rel, size: buf.length });
              const to = path.join(tmp, rel); await fsp.mkdir(path.dirname(to), { recursive: true });
              await fsp.writeFile(to, rewrite(id, rel, buf));
              if (!rel.includes('/') && /\.html?$/i.test(rel)) (titles[rel] = (/<title[^>]*>([^<]{1,200})<\/title>/i.exec(buf.toString('utf8', 0, Math.min(buf.length, 200000))) || [])[1]?.trim() || '');
            } finally { await f.fh.close().catch(() => {}); }
          },
        });
      } catch (e) {
        if (e.code === 'ENOENT' || e.code === 'ELINK') throw new Error('папка не найдена: ' + src);
        if (e.code === 'ENOTDIR') throw new Error('нужна папка, а не файл: ' + from);
        throw e;
      }
      const html = files.filter((f) => !f.r.includes('/') && /\.html?$/i.test(f.r));
      const entry = html.find((f) => f.r.toLowerCase() === 'index.html') || (html.length === 1 ? html[0] : null);
      if (!entry) throw new Error('в папке нет index.html — опубликовать можно папку с готовым сайтом (для Vite/React — dist после сборки)');
      title = titles[entry.r] || (parts.length ? parts[parts.length - 1] : path.basename(home));
      const meta = { key: prev?.key || crypto.randomBytes(16).toString('hex'), uid, title, created: prev?.created || new Date().toISOString(), updated: new Date().toISOString(), dir: true, src: from, entry: entry.r, files: files.length, bytes };
      // пока шло копирование (ожидания выше), сайт могли снять с публикации: обновление не должно вернуть его в сеть
      if (old && (!index(uid).some((x) => x.id === id) || metaOf(id)?.uid !== uid)) throw new Error('сайт сняли с публикации, пока шло обновление — опубликуйте папку заново');
      // «Стоп» или срок ответа пришли, пока шло копирование, — в сеть ничего не выходит (tmp убирается в finally/catch ниже)
      if (signal?.aborted) throw new Error('публикация остановлена — сайт не изменён');
      const live = path.join(dir, id), trashDir = live + '.old-' + crypto.randomBytes(3).toString('hex');
      if (fs.existsSync(live)) fs.renameSync(live, trashDir);
      fs.renameSync(tmp, live);
      fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(meta));
      await fsp.rm(trashDir, { recursive: true, force: true });
      // список мог измениться, пока шла публикация (ожидания выше): берём свежий
      if (!old) { const now = index(uid); if (!now.some((x) => x.id === id)) { now.unshift({ id, src: from }); saveIndex(uid, now); } }
      return { id, path: '/s/' + id, title, src: from, files: files.length, bytes, updated: !!old };
    } finally { await fsp.rm(tmp, { recursive: true, force: true }); }
  }
  function list(uid) {
    return index(uid).map((x) => { const m = metaOf(x.id); return m && m.uid === uid ? { id: x.id, path: '/s/' + x.id, title: m.title, src: m.src, files: m.files, bytes: m.bytes, updated: m.updated } : null; }).filter(Boolean);
  }
  function unpublish(uid, id) {
    const m = metaOf(id); if (!m || m.uid !== uid || !m.dir) return false;
    fs.rmSync(path.join(dir, id), { recursive: true, force: true }); fs.rmSync(path.join(dir, id + '.json'), { force: true });
    saveIndex(uid, index(uid).filter((x) => x.id !== id)); return true;
  }
  const removeUser = (uid) => { for (const x of index(uid)) unpublish(uid, x.id); store.kv.set('cloudsites:' + uid, []); };
  return { publish, list, unpublish, removeUser, TOOL, NOTE, mbs };
}

module.exports = { createCloudSites, MAX_BYTES, MAX_FILES, SCAN_MAX, DEPTH_MAX };
