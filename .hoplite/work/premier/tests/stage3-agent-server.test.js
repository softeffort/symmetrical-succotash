// Этап 3 плана: серверная сторона помощника на ПК и общий цикл действий.
//   CLD-07 — /premier-agent.js отдаётся байт в байт, рядом подпись; адрес сервера в команде установки — ключом --server
//   CLD-08 — у аккаунта одна привязка к одному устройству; новая привязка отзывает прежнюю; старый помощник получает 426
//   CLD-09 — «Стоп» в чате доходит до помощника как отмена задачи; перед каждым действием проверяется остановка
//   CLD-19 — полный доступ действует в одном ответе и для одного устройства, а не на весь аккаунт
//   CLD-20 — пределы на число действий и на общее время ответа; дальше — «Продолжить»
// В тестах «сквозных» работает настоящий desktop/premier-agent.js (отдельным процессом) и поддельный провайдер модели.
// Запуск: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { copyApp, startServer, rm, sha, ROOT } = require('../test/helpers');
const { sleep } = require('./stage3-util');

const DEV1 = '1'.repeat(32), DEV2 = '2'.repeat(32);
const WIN = process.platform === 'win32';

/* ================= agent.js напрямую ================= */
function unit(t, before) {
  const dir = copyApp(); t.after(() => rm(dir));
  const store = require(path.join(dir, 'db.js')); t.after(() => { try { store.db.close(); } catch {} });
  if (before) before(store);
  const agent = require(path.join(dir, 'agent.js'));
  const bind = (dev = DEV1, uid = 'u1') => agent.connect(agent.makeCode(uid), { host: 'pc' }, dev).token;
  // «помощник»: забирает одну задачу и отвечает
  const serve = async (uid = 'u1', reply = 'Готово') => { const j = await agent.poll(uid, null, undefined, []); agent.result(uid, j.jid, reply); return j; };
  const idle = async (uid = 'u1', busy = []) => { const ac = new AbortController(); const w = agent.poll(uid, null, ac.signal, busy); setTimeout(() => ac.abort(), 60); return w; };
  return { dir, store, agent, bind, serve, idle };
}

test('CLD-08: одна привязка на аккаунт — новая отзывает прежнюю; токен действует только на своём устройстве', async (t) => {
  const legacy = sha('старый-токен');
  const { store, agent, bind } = unit(t, (s) => s.kv.set('agent', { tokens: { [legacy]: 'u1' } }));
  assert.equal(agent.uidOf('старый-токен'), null, 'привязка прежнего формата (без устройства) не действует — помощник привязывается заново');
  const code = agent.makeCode('u1');
  assert.equal(agent.connect(code, {}, 'не-номер'), null, 'без номера устройства привязки нет');
  assert.equal(agent.connect(code, {}, undefined), null);
  const t1 = agent.connect(code, { host: 'первый' }, DEV1).token;
  assert.equal(agent.connect(code, {}, DEV1), null, 'код одноразовый');
  assert.equal(agent.uidOf(t1), 'u1'); assert.equal(agent.uidOf(t1, DEV1), 'u1'); assert.equal(agent.devOf('u1'), DEV1);
  assert.equal(agent.uidOf(t1, DEV2), null, 'тот же токен с другого устройства не принимается');
  // задача ушла первому помощнику — и тут привязывают второй компьютер
  const outs = []; const p = agent.call('u1', (x) => outs.push(x), 'computer_run', { command: 'x' }, 'all');
  const job = await agent.poll('u1', null, undefined, []); assert.equal(job.name, 'computer_run');
  const hang = agent.poll('u1', null, undefined, [job.jid]);
  const t2 = bind(DEV2);
  assert.deepEqual(await hang, { cancel: [job.jid] }, 'прежнему помощнику уходит отмена его задачи');
  assert.match(await p, /помощник привязан заново/);
  assert.equal(agent.uidOf(t1), null, 'прежний токен отозван'); assert.equal(agent.uidOf(t2, DEV2), 'u1'); assert.equal(agent.devOf('u1'), DEV2);
  assert.equal(agent.result('u1', job.jid, 'поздний ответ'), false);
  const saved = store.kv.get('agent', {}).tokens;
  assert.deepEqual(Object.values(saved).map((v) => [v.uid, v.dev]), [['u1', DEV2]], 'в хранилище — одна запись { uid, dev, at }');
  assert.ok(!(legacy in saved));
  agent.disconnect('u1'); assert.equal(agent.uidOf(t2), null); assert.equal(agent.connected('u1'), false);
  assert.deepEqual(store.kv.get('agent', {}).tokens, {});
});

test('CLD-09: «Стоп» — задача у помощника отменяется, задача в очереди снимается, новое действие не начинается', async (t) => {
  const { agent, bind, idle } = unit(t); bind();
  // 1) помощник уже выполняет задачу
  let ac = new AbortController(), outs = [];
  let p = agent.call('u1', (x) => outs.push(x), 'computer_run', { command: 'sleep 100' }, 'all', ac.signal);
  const job = await agent.poll('u1', null, undefined, []);
  const next = agent.poll('u1', null, undefined, [job.jid]); // помощник опрашивает сервер и во время работы
  ac.abort();
  assert.deepEqual(await next, { cancel: [job.jid] }, 'отмена приходит сразу, в уже открытый запрос');
  assert.match(await p, /^Остановлено: пользователь остановил ответ\./);
  assert.equal(outs.at(-1).agres.state, 'err');
  assert.equal(agent.result('u1', job.jid, 'Остановлено: пользователь остановил ответ.'), false, 'результат отменённой задачи уже никому не нужен');
  // 2) помощник между запросами: отмена ждёт следующего опроса
  ac = new AbortController(); p = agent.call('u1', () => {}, 'computer_run', { command: 'sleep 100' }, 'all', ac.signal);
  const job2 = await agent.poll('u1', null, undefined, []); ac.abort(); await p;
  assert.deepEqual(await agent.poll('u1', null, undefined, [job2.jid]), { cancel: [job2.jid] });
  // 3) задача ещё в очереди — просто снимается, помощник её не увидит
  ac = new AbortController(); p = agent.call('u1', () => {}, 'computer_delete', { path: '~/a' }, 'all', ac.signal);
  ac.abort(); assert.match(await p, /^Остановлено:/);
  assert.equal(await idle(), null, 'в очереди пусто и отменять нечего');
  // 4) остановлено до действия — оно не начинается и карточка не появляется
  outs = []; assert.equal(await agent.call('u1', (x) => outs.push(x), 'computer_delete', { path: '~/a' }, 'all', ac.signal), agent.STOPPED);
  assert.deepEqual(outs, []); assert.equal(await idle(), null);
  // 5) остановлено, пока ждали подтверждения, — действие не выполняется
  ac = new AbortController(); outs = []; p = agent.call('u1', (x) => outs.push(x), 'computer_delete', { path: '~/a' }, false, ac.signal);
  await sleep(20); assert.equal(outs[0].ag.ask, true); ac.abort(); assert.equal(await p, agent.STOPPED); assert.equal(await idle(), null);
  // 6) помощник сообщает о задаче, которой сервер не ждёт (например, сервер перезапускался) — получает отмену
  assert.deepEqual(await agent.poll('u1', null, undefined, ['aaaaaaaaaaaaaaaaaa']), { cancel: ['aaaaaaaaaaaaaaaaaa'] });
});

test('CLD-19: полный доступ — на один ответ и одно устройство; «Разрешать всегда» не действует в других ответах', async (t) => {
  const { agent, bind, serve } = unit(t); bind(DEV1);
  const A = agent.scope('u1', true), B = agent.scope('u1', false); // два ответа одного аккаунта: в чате A полный доступ включён, в чате B — нет
  assert.deepEqual([A.full, A.dev, B.full, B.dev], [true, DEV1, false, DEV1]);
  const run = async (sc, auto, name = 'computer_write', fn) => {
    const outs = []; const p = agent.call('u1', (x) => outs.push(x), name, { path: 'a.txt', content: '1' }, auto, undefined, fn, sc);
    await sleep(20); return { outs, p, ask: outs[0].ag.ask, cid: outs[0].ag.cid };
  };
  // ответ A: без вопросов
  let a = await run(A, false); assert.equal(a.ask, false); await serve(); assert.equal(await a.p, 'Готово');
  // ответ B идёт в то же время: подтверждение по-прежнему нужно
  let b = await run(B, false); assert.equal(b.ask, true, 'полный доступ чата A не действует в чате B');
  assert.equal(agent.decide('u1', b.cid, false), true); assert.match(await b.p, /ОТКЛОНИЛ/);
  // ответ B после чтения сайтов: тоже спрашивает, с пометкой
  b = await run(B, 'web'); assert.equal(b.ask, true); assert.equal(b.outs[0].ag.why, 'web'); agent.decide('u1', b.cid, false); await b.p;
  // …а ответу A чтение сайтов не мешает
  a = await run(A, 'web'); assert.equal(a.ask, false); await serve(); await a.p;
  // «Разрешать всегда» в карточке ответа B включает полный доступ только ему
  const C = agent.scope('u1', false);
  b = await run(B, false); assert.equal(agent.decide('u1', b.cid, true, true), true); await serve(); assert.equal(await b.p, 'Готово');
  assert.equal(B.full, true); assert.equal(C.full, false);
  b = await run(B, false); assert.equal(b.ask, false); await serve(); await b.p;
  const c = await run(C, false); assert.equal(c.ask, true, 'третий ответ по-прежнему спрашивает'); agent.decide('u1', c.cid, false); await c.p;
  // публикация видна всем — подтверждается и при полном доступе
  const pub = await run(A, false, 'computer_publish', async () => 'опубликовано'); assert.equal(pub.ask, true); agent.decide('u1', pub.cid, true); assert.equal(await pub.p, 'опубликовано');
  // посреди ответа привязали другой компьютер: авто-режим на него не переходит
  bind(DEV2);
  a = await run(A, 'all'); assert.equal(a.ask, true, 'после смены устройства каждое изменение подтверждается');
  agent.decide('u1', a.cid, false); await a.p;
  const r = await run(A, 'all', 'computer_read'); assert.equal(r.ask, false, 'чтение подтверждения не требует'); await serve(); await r.p;
  // новый ответ начинается уже с новым устройством
  const D = agent.scope('u1', true); assert.equal(D.dev, DEV2); const d = await run(D, false); assert.equal(d.ask, false); await serve(); await d.p;
  assert.equal(agent.setFull, undefined, 'общего флага на аккаунт больше нет'); assert.equal(agent.isFull, undefined);
});

test('CLD-09: «Стоп» после ответа «Запущено в фоне» отменяет и фоновую команду этого ответа; срок ответа её не трогает', async (t) => {
  const { agent, bind, idle } = unit(t); bind();
  const start = async (ac, args) => {
    const p = agent.call('u1', () => {}, 'computer_run', args, 'all', ac.signal);
    const job = await agent.poll('u1', null, undefined, []); agent.result('u1', job.jid, args.background ? 'Запущено в фоне (pid 4242) в ~/premier.\nВывод за первые секунды:\n(пусто)' : 'Код завершения 0 · 1 мс\n(вывода нет)');
    await p; return job.jid;
  };
  // фон запущен, ответ идёт дальше; «Стоп» — помощник получает отмену по номеру задания фоновой команды
  let ac = new AbortController(); const bg = await start(ac, { command: 'npm run dev', background: true });
  assert.equal(await idle(), null, 'пока ответ не остановлен, отмены нет');
  ac.abort(); assert.deepEqual(await idle(), { cancel: [bg] });
  // обычная команда уже завершилась — отменять нечего
  ac = new AbortController(); await start(ac, { command: 'ls' }); ac.abort(); assert.equal(await idle(), null);
  // ответ закончился сам (сигнал не сработал) — фон живёт дальше
  ac = new AbortController(); await start(ac, { command: 'npm run dev', background: true }); assert.equal(await idle(), null);
  // вышел общий срок ответа: фон остаётся для «Продолжить»
  ac = new AbortController(); await start(ac, { command: 'npm run dev', background: true }); ac.abort({ agent: 'вышло общее время ответа' }); assert.equal(await idle(), null);
  // помощник ещё числит задание занятым, пока не получил ответ на отправку результата: параллельный опрос не должен
  // счесть его потерянным и отменить — иначе только что запущенный фон был бы завершён без всякого «Стоп»
  ac = new AbortController(); const fresh = await start(ac, { command: 'npm run dev', background: true });
  assert.equal(await idle('u1', [fresh]), null, 'принятое задание не отменяется как потерянное');
  assert.deepEqual(await idle('u1', ['bbbbbbbbbbbbbbbbbb']), { cancel: ['bbbbbbbbbbbbbbbbbb'] }, 'неизвестное задание по-прежнему отменяется');
  ac.abort(); assert.deepEqual(await idle('u1', [fresh]), { cancel: [fresh] }, '«Стоп» его по-прежнему завершает');
  // помощника отвязали: отмена уходит не новому помощнику, а прежнему уже нечем её забрать
  ac = new AbortController(); await start(ac, { command: 'npm run dev', background: true }); bind(DEV2); ac.abort(); assert.equal(await idle(), null);
});

test('CLD-09: действие прервано по сроку ответа — причина названа верно, помощник получает отмену', async (t) => {
  const { agent, bind } = unit(t); bind();
  const ac = new AbortController(), outs = [];
  const p = agent.call('u1', (x) => outs.push(x), 'computer_run', { command: 'sleep 100' }, 'all', ac.signal);
  const job = await agent.poll('u1', null, undefined, []); const next = agent.poll('u1', null, undefined, [job.jid]);
  ac.abort({ agent: 'вышло общее время ответа' });
  assert.deepEqual(await next, { cancel: [job.jid] });
  assert.match(await p, /^Остановлено: вышло общее время ответа\. Помощнику/); assert.equal(outs.at(-1).agres.out, 'вышло общее время ответа');
  // исполнитель облака вернул «остановил пользователь» — по сроку текст исправляется и в карточке, и для модели
  const ac2 = new AbortController(), outs2 = [];
  const r = await agent.call('u1', (x) => outs2.push(x), 'computer_run', { command: 'x' }, 'all', ac2.signal, async () => { ac2.abort({ agent: 'вышло общее время ответа' }); return agent.STOPPED + ' Команда завершена.'; });
  assert.match(r, /^Остановлено: вышло общее время ответа — действие не выполнено\. Команда завершена\.$/); assert.equal(outs2.at(-1).agres.out, r);
});

test('CLD-08: помощника отключили или привязали к другому компьютеру, пока действие ждало подтверждения, — оно не выполняется', async (t) => {
  const { agent, bind, idle } = unit(t); bind(DEV1);
  const ask = async (run) => {
    const outs = [], p = agent.call('u1', (x) => outs.push(x), 'computer_delete', { path: '~/важное' }, false, undefined, run, agent.scope('u1', false));
    await sleep(20); assert.equal(outs[0].ag.ask, true); return { outs, p, cid: outs[0].ag.cid };
  };
  // 1) привязали другой компьютер: вопрос снят, согласие, данное позже, уже ничего не запускает
  let a = await ask(); bind(DEV2);
  assert.match(await a.p, /НЕ выполнено: пока оно ждало подтверждения.*другому компьютеру/); assert.equal(a.outs.at(-1).agres.state, 'no');
  assert.equal(agent.decide('u1', a.cid, true), false, 'запоздавшее «Разрешить» не принимается'); assert.equal(await idle(), null, 'на новый компьютер действие не ушло');
  // 2) отключили в чате
  a = await ask(); agent.disconnect('u1'); assert.match(await a.p, /НЕ выполнено/); bind(DEV2);
  assert.equal(await idle(), null);
  // 3) действие в облачном компьютере от привязки помощника не зависит — его вопрос остаётся
  a = await ask(async () => 'Готово: облако'); bind(DEV1); assert.equal(agent.decide('u1', a.cid, true), true); assert.equal(await a.p, 'Готово: облако');
  // 4) обычный путь не сломан: согласие на том же устройстве — действие уходит помощнику
  a = await ask(); assert.equal(agent.decide('u1', a.cid, true), true);
  const j = await agent.poll('u1', null, undefined, []); assert.equal(j.name, 'computer_delete'); agent.result('u1', j.jid, 'Готово: удалён файл'); assert.equal(await a.p, 'Готово: удалён файл');
});

/* ================= сквозные: сервер + настоящий помощник + поддельная модель ================= */
// Поддельный провайдер: сценарий — по тексту последнего сообщения пользователя.
//   BG число (sleep в фоне) | BGWAIT число (sleep в фоне, затем долгий sleep число+1)
//   WRITE имя | SLOW WRITE имя | RUN команда | MANY (по три действия в каждом шаге, пока дают инструменты) | STEP (по одной команде sleep 1 в шаге)
function provider() {
  let n = 0;
  const srv = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      let body = {}; try { body = JSON.parse(raw || '{}'); } catch {}
      const msgs = body.messages || [], users = msgs.filter((m) => m.role === 'user' && typeof m.content === 'string' && !/последний шаг этого ответа/.test(m.content));
      const text = users.at(-1)?.content || '', tooled = msgs.at(-1)?.role === 'tool';
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const say = (s) => { res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: s } }] }) + '\n\n'); res.end('data: [DONE]\n\n'); };
      const call = (...list) => { res.write('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: list.map(([name, args], index) => ({ index, id: 'c' + (++n), function: { name, arguments: JSON.stringify(args) } })) } }] }) + '\n\n'); res.end('data: [DONE]\n\n'); };
      if (!body.tools) return say('ИТОГ');
      const loop = /^MANY/.test(text) || /^STEP/.test(text);
      let bw;
      if ((bw = text.match(/^BGWAIT (\d+)/))) { // фоновая команда, затем долгая обычная
        const done = msgs.filter((x) => x.role === 'tool').length;
        if (done === 0) return call(['computer_run', { command: 'sleep ' + bw[1], background: true }]);
        if (done === 1) return call(['computer_run', { command: 'sleep ' + (Number(bw[1]) + 1) }]);
        return say('ИТОГ');
      }
      if (!tooled && (bw = text.match(/^BG (\d+)/))) return call(['computer_run', { command: 'sleep ' + bw[1], background: true }]);
      if (tooled && !loop) return say('ИТОГ');
      let m;
      if ((m = text.match(/^SLOW WRITE (\S+)/))) { await sleep(1500); return call(['computer_write', { path: m[1], content: 'из чата B' }]); }
      if ((m = text.match(/^WRITE (\S+)/))) return call(['computer_write', { path: m[1], content: 'из чата A' }]);
      if ((m = text.match(/^RUN (.+)/s))) return call(['computer_run', { command: m[1] }]);
      if (/^MANY/.test(text)) return call(['computer_list', { path: '.' }], ['computer_list', { path: '.' }], ['computer_list', { path: '.' }]);
      if (/^STEP/.test(text)) return call(['computer_run', { command: 'sleep 1' }]);
      say('ИТОГ');
    });
  });
  return { listen: () => new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok('http://127.0.0.1:' + srv.address().port))), close: () => new Promise((ok) => { srv.closeAllConnections?.(); srv.close(() => ok()); }) };
}

async function boot(t, env = {}) {
  const dir = copyApp(), fake = provider(), fakeUrl = await fake.listen();
  const store = require(path.join(dir, 'db.js'));
  store.users.put({ id: 'u1', login: 'u1', email: 'u1@example.invalid', plan: 'max', until: Date.now() + 864e5, created: new Date().toISOString() });
  const token = crypto.randomBytes(32).toString('hex'); store.sessions.put(sha(token), 'u1', Date.now() + 3600e3);
  store.kv.set('models', [{ id: 'm1', name: 'Fake', modelId: 'fake-1', baseUrl: fakeUrl + '/v1', apiKey: 'sk-fake-upstream-key', plans: ['free', 'pro', 'max'], weight: 1 }]);
  store.db.close();
  const s = await startServer(dir, (port) => ({ PUBLIC_URL: 'http://127.0.0.1:' + port, PROBE_MODELS: 'off', CLOUD_RUNNER: 'off', ...env }));
  const headers = { Cookie: 'premier_session=' + token, 'Content-Type': 'application/json', Origin: s.base };
  const api = async (p, body) => { const r = await fetch(s.base + p, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const raw = (p, body, bearer) => fetch(s.base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) }, body: JSON.stringify(body) });
  // чат с чтением потока по мере прихода строк
  const chat = (text, extra = {}) => {
    const lines = []; let fin = false;
    const done = (async () => {
      const r = await fetch(s.base + '/api/chat', { method: 'POST', headers, body: JSON.stringify({ model: 'm1', messages: [{ role: 'user', content: text }], agent: true, ...extra }) });
      if (!r.ok) { lines.push({ http: r.status, ...(await r.json().catch(() => ({}))) }); fin = true; return lines; }
      let buf = ''; const dec = new TextDecoder();
      for await (const chunk of r.body) { buf += dec.decode(chunk, { stream: true }); let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.startsWith('{')) lines.push(JSON.parse(l)); } }
      fin = true; return lines;
    })();
    const until = async (pred, ms = 15000) => { const t0 = Date.now(); for (;;) { const x = lines.find(pred); if (x) return x; if (fin || Date.now() - t0 > ms) throw new Error('в потоке нет ожидаемой строки: ' + JSON.stringify(lines).slice(0, 1500)); await sleep(25); } };
    return { lines, done, until };
  };
  // настоящий помощник отдельным процессом; настройка и рабочая папка — во временной папке теста
  const work = path.join(dir, 'pc-work'), conf = path.join(dir, 'pc-conf', 'agent.json');
  let helper = null, hlog = '';
  const startHelper = async (args = []) => {
    const code = (await api('/api/agent/code', {})).json.code;
    helper = spawn(process.execPath, [path.join(dir, 'desktop', 'premier-agent.js'), '--server', s.base, '--workdir', work, '--no-update', '--yes-commands', ...args, code], { env: { ...process.env, PREMIER_AGENT_CONF: conf }, stdio: ['ignore', 'pipe', 'pipe'] });
    helper.stdout.on('data', (d) => (hlog += d)); helper.stderr.on('data', (d) => (hlog += d));
    for (let i = 0; i < 100; i++) { if ((await api('/api/agent/status')).json.connected) return; await sleep(100); if (helper.exitCode != null) break; }
    throw new Error('помощник не подключился:\n' + hlog);
  };
  t.after(async () => { if (helper && helper.exitCode == null) helper.kill('SIGKILL'); await s.stop(); await fake.close(); rm(dir); });
  return { dir, base: s.base, api, raw, chat, startHelper, work, conf, hlog: () => hlog, log: s.log };
}
const sleeping = (n) => spawnSync('ps', ['-eo', 'args'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => l.trim() === 'sleep ' + n).length;

test('CLD-07: помощник отдаётся байт в байт, подпись — рядом; в команде установки адрес сервера идёт ключом', async (t) => {
  const { dir, base } = await boot(t);
  const file = fs.readFileSync(path.join(dir, 'desktop', 'premier-agent.js'));
  const r = await fetch(base + '/premier-agent.js'); const got = Buffer.from(await r.arrayBuffer());
  assert.equal(r.status, 200); assert.ok(got.equals(file), 'сервер ничего не подставляет в файл — иначе подпись не сошлась бы');
  assert.equal((await fetch(base + '/premier-agent.js.sig')).status, 404, 'подписи ещё нет — помощники не обновляются сами');
  // владелец создаёт ключ и подписывает (scripts/agent-sign.js) — сервер начинает отдавать подпись, и она подходит к отдаваемому файлу
  const sign = require(path.join(dir, 'scripts', 'agent-sign.js')), key = path.join(dir, 'k.key');
  const init = spawnSync(process.execPath, [path.join(dir, 'scripts', 'agent-sign.js'), 'init', '--key', key], { cwd: dir, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stdout + init.stderr);
  const js = Buffer.from(await (await fetch(base + '/premier-agent.js')).arrayBuffer()), sig = await (await fetch(base + '/premier-agent.js.sig')).text();
  assert.equal(sign.embeddedKeys(js).length, 1); assert.equal(sign.verify(js, sig, sign.embeddedKeys(js)), true);
  assert.equal(sign.verify(Buffer.concat([js, Buffer.from('\n// подмена')]), sig, sign.embeddedKeys(js)), false);
  for (const f of ['public/agent.js', 'public/en/agent.js']) assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /node ~\/premier-agent\.js --server \$\{server\} \$\{code\}/, f);
});

test('CLD-08: сервер — старый помощник получает 426, чужое устройство — 401, повторная привязка отключает прежний помощник', async (t) => {
  const { api, raw } = await boot(t);
  const code = async () => (await api('/api/agent/code', {})).json.code;
  let r = await raw('/api/agent/connect', { code: await code(), info: {} }); // помощник прежней версии: без v и dev
  assert.equal(r.status, 426); assert.match((await r.json()).error, /устарела/);
  assert.equal((await raw('/api/agent/connect', { code: await code(), info: {}, v: 2 })).status, 426, 'без номера устройства');
  const c1 = await code(); r = await raw('/api/agent/connect', { code: c1, info: { host: 'pc1', workdir: '/home/u/Premier' }, dev: DEV1, v: 2 });
  assert.equal(r.status, 200); const t1 = (await r.json()).token;
  assert.equal((await raw('/api/agent/poll', { info: {}, dev: DEV1 }, t1)).status, 426, 'опрос без версии протокола');
  assert.equal((await raw('/api/agent/poll', { info: {}, dev: DEV2, v: 2, busy: [] }, t1)).status, 401, 'токен унесли на другой компьютер');
  r = await raw('/api/agent/poll', { info: { host: 'pc1', workdir: '/home/u/Premier' }, dev: DEV1, v: 2, busy: ['bbbbbbbbbbbbbbbbbb'] }, t1);
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { cancel: ['bbbbbbbbbbbbbbbbbb'] });
  assert.equal((await api('/api/agent/status')).json.info.workdir, '/home/u/Premier');
  r = await raw('/api/agent/connect', { code: await code(), info: { host: 'pc2' }, dev: DEV2, v: 2 }); const t2 = (await r.json()).token;
  assert.equal((await raw('/api/agent/poll', { info: {}, dev: DEV1, v: 2, busy: [] }, t1)).status, 401, 'прежняя привязка отозвана');
  assert.equal((await raw('/api/agent/result', { jid: 'x', out: 'y' }, t1)).status, 401);
  assert.equal((await raw('/api/agent/result', { jid: 'x', out: 'y' }, t2)).status, 404);
  assert.equal((await api('/api/agent/status')).json.info.host, 'pc2');
  assert.equal((await api('/api/agent/off', {})).status, 200);
  assert.equal((await raw('/api/agent/poll', { info: {}, dev: DEV2, v: 2, busy: [] }, t2)).status, 401);
});

test('CLD-09: «Стоп» в чате завершает команду и её процессы на ПК за несколько секунд (настоящий помощник)', { skip: WIN && 'проверка процессов — через ps', timeout: 90000 }, async (t) => {
  const { api, chat, startHelper, work, hlog } = await boot(t); await startHelper();
  const N = 400000 + crypto.randomInt(500000); // по этому числу находим свои процессы sleep
  // обычная команда доходит до ПК и возвращает результат
  const ok = chat('RUN echo premier-$((6*7))', { agentAuto: true }); const okLines = await ok.done;
  assert.match(okLines.find((x) => x.agres?.state === 'ok')?.agres.out || '', /premier-42/, JSON.stringify(okLines).slice(0, 800) + hlog());
  // долгая команда с фоновым процессом; «Стоп»
  const g = chat(`RUN sleep ${N} & sleep ${N}`, { agentAuto: true, mid: 'gen-stop-1' });
  await g.until((x) => x.agres?.state === 'run');
  for (let i = 0; i < 100 && sleeping(N) < 2; i++) await sleep(50);
  assert.equal(sleeping(N), 2, 'команда запущена на ПК: два процесса');
  const t0 = Date.now(); assert.equal((await api('/api/chat/stop', { mid: 'gen-stop-1' })).status, 200);
  for (let i = 0; i < 200 && sleeping(N) > 0; i++) await sleep(25);
  const took = Date.now() - t0;
  assert.equal(sleeping(N), 0, 'процессы команды на ПК завершены'); assert.ok(took < 5000, `остановка заняла ${took} мс`);
  await g.done; assert.match(hlog(), /остановлено по запросу из чата/);
  assert.ok(fs.existsSync(work)); t.diagnostic(`«Стоп»: процессы на ПК завершены за ${took} мс`);
  // после остановки помощник работает дальше
  const again = await chat('RUN echo снова-$((1+1))', { agentAuto: true }).done;
  assert.match(again.find((x) => x.agres?.state === 'ok')?.agres.out || '', /снова-2/);
});

test('CLD-19: два чата одновременно — полный доступ первого не отключает подтверждения во втором', { timeout: 90000 }, async (t) => {
  const { api, chat, startHelper, work } = await boot(t); await startHelper();
  // чат B (без полного доступа) начал раньше, его действие придёт через 1,5 с; за это время чат A с полным доступом уже работает
  const B = chat('SLOW WRITE b.txt', { agentAuto: false, agentFull: false, mid: 'gen-b' });
  await sleep(200);
  const A = chat('WRITE a.txt', { agentAuto: false, agentFull: true, mid: 'gen-a' });
  const a = await A.until((x) => x.ag); assert.equal(a.ag.ask, false, 'чат A: полный доступ — без вопросов');
  await A.done; assert.equal(fs.readFileSync(path.join(work, 'a.txt'), 'utf8'), 'из чата A');
  const b = await B.until((x) => x.ag); assert.equal(b.ag.ask, true, 'чат B: подтверждение на месте');
  assert.equal(fs.existsSync(path.join(work, 'b.txt')), false, 'без подтверждения файл не записан');
  assert.equal((await api('/api/chat/agent', { cid: b.ag.cid, ok: false })).status, 200);
  await B.done; assert.equal(fs.existsSync(path.join(work, 'b.txt')), false);
  // и в обратном порядке: запрос без полного доступа, пришедший позже, не отбирает его у идущего ответа — проверено в тесте agent.js выше
});

test('CLD-20: пределы на число действий и на время ответа — модель подводит итог, пользователь видит «Продолжить»', { timeout: 120000 }, async (t) => {
  const { chat, startHelper } = await boot(t, { AGENT_MAX_ACTIONS: '5', AGENT_MAX_SEC: '5' }); await startHelper();
  // 1) число действий: модель присылает по три действия в шаге; выполняются пять, шестое — отказ, дальше — итог
  let lines = await chat('MANY', { agentAuto: true }).done;
  assert.equal(lines.filter((x) => x.ag).length, 5, 'выполнено ровно пять действий');
  assert.deepEqual(lines.filter((x) => x.s === 'limit').map((x) => x.q), ['5 действий']);
  assert.ok(lines.some((x) => x.more === 1), 'кнопка «Продолжить»'); assert.match(lines.filter((x) => typeof x.t === 'string').map((x) => x.t).join(''), /ИТОГ/);
  // 2) время: каждое действие идёт секунду; после пяти секунд — итог, хотя ни шаги (40), ни действия (5) не исчерпаны
  const t0 = Date.now(); lines = await chat('STEP', { agentAuto: true }).done; const took = Date.now() - t0;
  const n = lines.filter((x) => x.ag).length;
  assert.ok(n >= 2 && n <= 5, 'действий: ' + n); assert.deepEqual(lines.filter((x) => x.s === 'limit').map((x) => x.q), [n >= 5 ? '5 действий' : '5 с']);
  assert.ok(lines.some((x) => x.more === 1)); assert.ok(took < 20000, `ответ занял ${took} мс`);
});

test('CLD-09: «Стоп» завершает и фоновую команду остановленного ответа; фон законченного ответа живёт до отзыва доступа (настоящий помощник)', { skip: WIN && 'проверка процессов — через ps', timeout: 120000 }, async (t) => {
  const { api, chat, startHelper, hlog } = await boot(t); await startHelper();
  const N = 1400000 + crypto.randomInt(500000), M = N + 10;
  t.after(() => { for (const n of [N, N + 1, M]) spawnSync('pkill', ['-f', '^sleep ' + n + '$']); });
  // 1) ответ: фоновая команда (через 4 с — «Запущено в фоне»), затем долгая обычная; «Стоп»
  const g = chat('BGWAIT ' + N, { agentAuto: true, mid: 'gen-bg-1' });
  await g.until((x) => x.agres?.state === 'ok' && /Запущено в фоне/.test(x.agres.out || ''), 20000);
  for (let i = 0; i < 100 && sleeping(N + 1) < 1; i++) await sleep(50);
  assert.equal(sleeping(N), 1, 'фоновая команда работает'); assert.equal(sleeping(N + 1), 1, 'обычная команда работает');
  const t0 = Date.now(); assert.equal((await api('/api/chat/stop', { mid: 'gen-bg-1' })).status, 200);
  for (let i = 0; i < 200 && sleeping(N) + sleeping(N + 1) > 0; i++) await sleep(25);
  const took = Date.now() - t0;
  assert.equal(sleeping(N + 1), 0, 'обычная команда завершена'); assert.equal(sleeping(N), 0, 'фоновая команда остановленного ответа завершена' + hlog());
  assert.ok(took < 5000, `остановка заняла ${took} мс`); await g.done; t.diagnostic(`«Стоп»: обычная и фоновая команды завершены за ${took} мс`);
  // 2) ответ закончился сам — его фоновая команда продолжает работать
  await chat('BG ' + M, { agentAuto: true }).done; assert.equal(sleeping(M), 1, 'фон законченного ответа работает');
  await sleep(1500); assert.equal(sleeping(M), 1);
  // 3) CLD-08: помощника отключили в чате — он получает 401 и завершает всё, что запустил, вместе с фоном
  assert.equal((await api('/api/agent/off', {})).status, 200);
  for (let i = 0; i < 400 && sleeping(M) > 0; i++) await sleep(25);
  assert.equal(sleeping(M), 0, 'после отзыва доступа фоновая команда завершена' + hlog());
  for (let i = 0; i < 80 && !/Запущенные им команды остановлены/.test(hlog()); i++) await sleep(25); // строка в журнале идёт сразу после остановки
  assert.match(hlog(), /Запущенные им команды остановлены/);
});

test('CLD-09: общий срок ответа прерывает идущее действие, а не ждёт его конца; дальше — итог и «Продолжить»', { skip: WIN && 'проверка процессов — через ps', timeout: 90000 }, async (t) => {
  const { chat, startHelper } = await boot(t, { AGENT_MAX_SEC: '5' }); await startHelper();
  const N = 2400000 + crypto.randomInt(500000); t.after(() => spawnSync('pkill', ['-f', '^sleep ' + N + '$']));
  const t0 = Date.now(), lines = await chat('RUN sleep ' + N, { agentAuto: true }).done, took = Date.now() - t0;
  assert.ok(took >= 4500 && took < 15000, `ответ занял ${took} мс при сроке 5 с (раньше ждал бы команду до её конца)`);
  const res = lines.filter((x) => x.agres).at(-1).agres; assert.equal(res.state, 'err'); assert.match(res.out, /вышло общее время ответа/);
  for (let i = 0; i < 120 && sleeping(N) > 0; i++) await sleep(25);
  assert.equal(sleeping(N), 0, 'команда на ПК завершена');
  assert.deepEqual(lines.filter((x) => x.s === 'limit').map((x) => x.q), ['5 с']); assert.ok(lines.some((x) => x.more === 1), 'кнопка «Продолжить»');
  assert.match(lines.filter((x) => typeof x.t === 'string').map((x) => x.t).join(''), /ИТОГ/);
  t.diagnostic(`срок 5 с: действие прервано, ответ завершён за ${took} мс`);
});

test('CLD-19: кнопка в карточке действия не включает постоянный полный доступ в браузере (обе языковые версии)', () => {
  for (const f of ['public/agent.js', 'public/en/agent.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const i = src.indexOf('if (always) {'), j = src.indexOf("memApi('/api/chat/agent'", i);
    assert.ok(i > 0 && j > i, f + ': обработчик кнопки найден');
    const block = src.slice(i, j);
    assert.ok(!/AG\.(full|auto)\s*=/.test(block) && !/agSave\(/.test(block), f + ': согласие в карточке не меняет сохранённые настройки — в следующие ответы и другие чаты оно не уходит');
    assert.match(src.slice(j, j + 200), /always/, f + ': серверу уходит признак «до конца этого ответа»');
    // постоянный полный доступ включается только явной галочкой в настройках — и вопрос там говорит о всех следующих ответах,
    // а вопрос в карточке — только об этом ответе
    const k = src.indexOf("$('agFull').onchange"), settings = src.slice(k, src.indexOf('agSave()', k));
    assert.match(settings, /для всех следующих ответов в этом браузере|for all later replies in this browser/, f + ': галочка в настройках');
    assert.ok(!/до конца этого ответа|until this reply ends/.test(settings), f + ': галочка не обещает «только этот ответ»');
    assert.match(block, /до конца этого ответа|until this reply ends/, f + ': карточка');
    assert.equal((src.match(/AG\.full\s*=(?!=)/g) || []).length, 2, f + ': AG.full задаётся при чтении настроек и галочкой, больше нигде');
  }
  for (const [f, re] of [['public/chat.html', /\/agent\.js\?v=10"/], ['public/en/chat.html', /\/en\/agent\.js\?v=10"/]]) assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), re, f + ': версия скрипта поднята — браузеры возьмут новый файл');
});
