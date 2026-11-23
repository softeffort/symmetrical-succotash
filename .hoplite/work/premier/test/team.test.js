// Командный тариф: расчёт, оплата и возврат, места и вступление по ссылке, API чата, Панель и файлы RU/EN
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { copyApp, seed, startServer, rm, ROOT } = require('./helpers');

const DAY = 86400000;
const U = (id, login) => ({ id, login, email: login + '@example.com', created: new Date().toISOString() });
const OWNER = 'o1o1o1o1o1o1', M1 = 'm1m1m1m1m1m1', M2 = 'm2m2m2m2m2m2', M3 = 'm3m3m3m3m3m3';
const USERS = [U(OWNER, 'olga'), U(M1, 'max'), U(M2, 'mia'), U(M3, 'mark')];
const near = (a, b, ms = 5000) => assert.ok(Math.abs(a - b) < ms, `${a} ≈ ${b}`);

test('team: расчёт, оплата, места, вступление, возврат и настройки', () => {
  const dir = copyApp();
  seed(dir, { users: USERS, sessions: {} });
  try {
    const bill = require(path.join(dir, 'billing'));
    const store = require(path.join(dir, 'db'));
    bill.init({ loadSettings: () => ({}), saveSettings() {}, onPaid() {} });
    const T = bill.teams, u = (id) => store.users.get(id), periods = bill.periods();
    assert.deepEqual(T.offer(), { on: true, price: 350, min: 3, max: 50, days: 30 });
    assert.equal(bill.summary(u(OWNER)).teamOffer.price, 350);

    // расчёт
    const q1 = T.quote(u(OWNER), 3, 1, periods);
    assert.equal(q1.amount, 1050); assert.equal(q1.days, 30); assert.equal(q1.renew, false);
    assert.throws(() => T.quote(u(OWNER), 2, 1, periods), /от 3 до 50/);
    assert.throws(() => T.quote(u(OWNER), 51, 1, periods), /от 3 до 50/);
    assert.throws(() => T.quote(u(OWNER), 3, 0, periods), /пока команда оплачена/);
    const long = periods.find((p) => p.months > 1 && p.off > 0);
    if (long) {
      const ql = T.quote(u(OWNER), 4, long.months, periods);
      assert.equal(ql.amount, Math.round(4 * 350 * long.months * (100 - long.off) / 100));
      assert.equal(ql.list, 4 * 350 * long.months); assert.equal(ql.off, long.off);
    }
    assert.throws(() => T.quote(u(OWNER), 3, 7, periods), /срока оплаты нет/);

    // оплата → команда с владельцем, Pro у владельца
    const now = Date.now();
    store.payments.put({ id: 'tp1', uid: OWNER, login: 'olga', plan: 'team', days: 30, amount: 1050, status: 'NEW', created: now, team: { seats: 3, months: 1, days: 30, name: 'Маркетинг' } });
    bill.apply(store.payments.get('tp1'), 'CONFIRMED');
    let me = T.info(u(OWNER));
    assert.equal(me.role, 'owner'); assert.equal(me.name, 'Маркетинг'); assert.equal(me.seats, 3); assert.equal(me.used, 1); assert.equal(me.active, true);
    near(me.until, now + 30 * DAY);
    let s = bill.summary(u(OWNER));
    assert.equal(s.plan.id, 'pro'); assert.equal(s.plan.team, 'Маркетинг');
    bill.apply(store.payments.get('tp1'), 'CONFIRMED'); // повтор не продлевает
    near(T.info(u(OWNER)).until, now + 30 * DAY);

    // вступление по ссылке и лимит мест
    const code = me.code;
    assert.equal(T.preview(code).free, 2);
    assert.throws(() => T.join(u(M1), 'bad-code-123'), /недействительна/);
    T.join(u(M1), code); T.join(u(M1), code); T.join(u(M2), code);
    assert.throws(() => T.join(u(M3), code), /нет свободных мест/);
    assert.equal(T.preview(code, Date.now(), M1).member, true);
    assert.equal(bill.summary(u(M1)).plan.id, 'pro'); assert.equal(bill.summary(u(M1)).plan.team, 'Маркетинг');
    assert.equal(bill.summary(u(M3)).plan.team, null);
    assert.equal(T.info(u(M1)).role, 'member'); assert.equal(T.info(u(M1)).mine, true); assert.equal(T.info(u(M1)).code, undefined);
    assert.throws(() => T.quote(u(M1), 3, 1, periods), /Вы участник команды/);
    assert.throws(() => T.quote(u(OWNER), 3, 1, periods) && T.quote(u(OWNER), 2, 1, periods), /от 3/);

    // докупка места на оставшиеся дни
    const q2 = T.quote(u(OWNER), 4, 0, periods);
    assert.equal(q2.addSeats, 1); assert.equal(q2.restDays, 30); assert.equal(q2.amount, 350); assert.equal(q2.renew, true);
    assert.throws(() => T.quote(u(OWNER), 3, 0, periods), /больше мест/);
    store.payments.put({ id: 'tp2', uid: OWNER, login: 'olga', plan: 'team', days: 0, amount: 350, status: 'NEW', created: Date.now(), team: { seats: 4, months: 0, days: 0 } });
    bill.apply(store.payments.get('tp2'), 'CONFIRMED');
    me = T.info(u(OWNER)); assert.equal(me.seats, 4); near(me.until, now + 30 * DAY);
    T.join(u(M3), code);
    assert.equal(T.info(u(OWNER)).used, 4);
    assert.throws(() => T.quote(u(OWNER), 3, 1, periods), /уже 4 чел/);

    // участники: убрать, выйти, новая ссылка, название
    T.remove(u(OWNER), M3);
    assert.throws(() => T.remove(u(OWNER), OWNER), /себя/);
    assert.throws(() => T.remove(u(M1), M2), /нет своей команды/);
    assert.throws(() => T.leave(u(OWNER)), /Владелец не может выйти/);
    T.leave(u(M2)); assert.equal(T.info(u(M2)), null); assert.equal(bill.summary(u(M2)).plan.team, null);
    T.relink(u(OWNER)); const code2 = T.info(u(OWNER)).code;
    assert.notEqual(code2, code); assert.equal(T.preview(code), null);
    assert.throws(() => T.rename(u(OWNER), 'x'), /от 2 до 60/);
    T.rename(u(OWNER), '  Отдел   <продаж>  '); assert.equal(T.info(u(OWNER)).name, 'Отдел продаж');

    // личный Max сильнее места в команде
    store.users.update(M1, (x) => { x.plan = 'max'; x.planUntil = new Date(Date.now() + 5 * DAY).toISOString(); return x; });
    const s1 = bill.summary(u(M1)); if (s1.plan.id === 'max') assert.equal(s1.plan.team, null);

    // возврат докупки возвращает места, возврат оплаты — срок
    bill.apply(store.payments.get('tp2'), 'CHARGEBACKED'); assert.equal(T.info(u(OWNER)).seats, 3);
    bill.apply(store.payments.get('tp1'), 'CHARGEBACKED');
    me = T.info(u(OWNER)); assert.equal(me.active, false); assert.notEqual(bill.summary(u(OWNER)).plan.team, 'Отдел продаж');

    // Ручное продление, статистика, настройки
    const id = T.list()[0].id;
    assert.throws(() => T.addDays(id, 0), /кроме нуля/); assert.throws(() => T.addDays('nope', 3), /не найдена/);
    const t5 = T.addDays(id, 5); near(t5.until, Date.now() + 5 * DAY);
    const st = T.stats(); assert.equal(st.teams, 1); assert.equal(st.active, 1); assert.equal(st.seats, 3);
    assert.equal(T.list()[0].login, 'olga'); assert.equal(T.list()[0].people.length, 2);
    assert.throws(() => T.saveConf({ price: 0 }), /от 1 до 100 000/);
    assert.throws(() => T.saveConf({ min: 10, max: 5 }), /не может быть меньше/);
    T.saveConf({ price: 400, min: 2 }); assert.equal(T.quote(u(OWNER), 2, 1, periods).amount, 800);
    T.saveConf({ on: false }); assert.throws(() => T.quote(u(OWNER), 3, 1, periods), /недоступен/);
    assert.equal(bill.summary(u(OWNER)).teamOffer.on, false);

    // удаление аккаунта владельца забирает команду
    T.removeUser(OWNER); assert.equal(T.list().length, 0); assert.equal(T.info(u(M1)), null);
  } finally { rm(dir); }
});

test('team: ссылки /team и /t/…, API чата и раздел Панели', async () => {
  const dir = copyApp();
  seed(dir, { users: USERS, sessions: { tok1: OWNER, tok2: M1, tok3: M2 } });
  // оплаченная команда до запуска сервера (настоящие платёжные системы в тестах не подключены)
  const r = spawnSync(process.execPath, ['-e', `const t = require('./teams'); require('./db').tx(() => t.onPaid({ uid: '${OWNER}', team: { seats: 3, days: 30, name: 'Маркетинг' } })); process.stdout.write(t.info({ id: '${OWNER}' }).code);`], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const code = r.stdout.trim().split('\n').pop(); assert.match(code, /^[A-Za-z0-9_-]{6,40}$/);
  const s = await startServer(dir, { PUSH_OFF: '1' });
  const ck = (tok, team) => ({ Cookie: `premier_session=${tok}; premier_team=${team}` });
  try {
    // ссылки ведут в чат и запоминают, что открыть
    let x = await s.req('GET', '/team');
    assert.equal(x.status, 302); assert.equal(x.headers.get('location'), '/chat');
    assert.match(x.headers.get('set-cookie'), /^premier_team=new; Path=\/; SameSite=Lax; Max-Age=86400/);
    x = await s.req('GET', '/t/' + code);
    assert.equal(x.status, 302); assert.match(x.headers.get('set-cookie'), new RegExp('premier_team=' + code + ';'));
    assert.notEqual((await s.req('GET', '/t/a<b')).status, 302);

    // публичное предложение и доступ только с аккаунтом
    x = await s.req('GET', '/api/team/offer'); assert.equal(x.status, 200); assert.equal(x.json.price, 350); assert.equal(x.json.min, 3);
    assert.equal((await s.req('GET', '/api/team')).status, 401);
    assert.equal((await s.req('POST', '/api/team/join', { body: { code } })).status, 401);

    // новый покупатель: пришёл по /team, расчёт, оплата без подключённых систем
    x = await s.req('GET', '/api/team', { headers: ck('tok3', 'new') });
    assert.equal(x.status, 200); assert.deepEqual(x.json.pending, { kind: 'new' }); assert.equal(x.json.team, null);
    assert.match(x.headers.get('set-cookie'), /premier_team=; Path=\/; SameSite=Lax; Max-Age=0/);
    assert.ok(x.json.periods.some((p) => p.months === 1));
    x = await s.req('POST', '/api/team/quote', { token: 'tok3', body: { seats: 3, months: 1 } });
    assert.equal(x.status, 200); assert.equal(x.json.amount, 1050);
    x = await s.req('POST', '/api/team/quote', { token: 'tok3', body: { seats: 1, months: 1 } });
    assert.equal(x.status, 400); assert.match(x.json.error, /от 3 до 50/);
    x = await s.req('POST', '/api/team/pay', { token: 'tok3', body: { seats: 3, months: 1, method: 'card' } });
    assert.equal(x.status, 400); assert.match(x.json.error, /Оплата пока не подключена|способ оплаты/);
    assert.equal((await s.req('GET', '/api/team/quote', { token: 'tok3' })).status, 405);
    assert.equal((await s.req('POST', '/api/team/nope', { token: 'tok3', body: {} })).status, 404);

    // приглашённый: видит приглашение, вступает и получает Pro
    x = await s.req('GET', '/api/team', { headers: ck('tok2', 'bad-code-123') }); assert.deepEqual(x.json.pending, { kind: 'bad' });
    x = await s.req('GET', '/api/team', { headers: ck('tok2', code) });
    assert.equal(x.json.pending.kind, 'join'); assert.equal(x.json.pending.name, 'Маркетинг'); assert.equal(x.json.pending.owner, 'olga'); assert.equal(x.json.pending.free, 2); assert.equal(x.json.pending.active, true);
    x = await s.req('POST', '/api/team/join', { token: 'tok2', body: { code: 'bad-code-123' } }); assert.equal(x.status, 400); assert.match(x.json.error, /недействительна/);
    x = await s.req('POST', '/api/team/join', { token: 'tok2', body: { code } });
    assert.equal(x.status, 200); assert.equal(x.json.team.role, 'member'); assert.equal(x.json.team.mine, true); assert.equal(x.json.team.code, undefined);
    x = await s.req('GET', '/api/billing', { token: 'tok2' }); assert.equal(x.json.plan.id, 'pro'); assert.equal(x.json.plan.team, 'Маркетинг'); assert.equal(x.json.teamOffer.price, 350);
    x = await s.req('GET', '/api/team', { headers: ck('tok2', code) }); assert.equal(x.json.pending, null, 'уже в команде — приглашение не показываем');

    // владелец: состав, переименован��е, новая ссылка, удаление участника
    x = await s.req('GET', '/api/team', { token: 'tok1' });
    assert.equal(x.json.team.role, 'owner'); assert.equal(x.json.team.used, 2); assert.equal(x.json.team.code, code);
    assert.deepEqual(x.json.team.members.map((m) => [m.login, m.owner, m.seat]), [['olga', true, true], ['max', false, true]]);
    x = await s.req('POST', '/api/team/quote', { token: 'tok1', body: { seats: 4, months: 0 } }); assert.equal(x.json.amount, 350); assert.equal(x.json.addSeats, 1);
    x = await s.req('POST', '/api/team/rename', { token: 'tok1', body: { name: 'Продажи' } }); assert.equal(x.json.team.name, 'Продажи');
    x = await s.req('POST', '/api/team/link', { token: 'tok1', body: {} }); assert.notEqual(x.json.team.code, code);
    x = await s.req('POST', '/api/team/leave', { token: 'tok1', body: {} }); assert.equal(x.status, 400);
    x = await s.req('POST', '/api/team/remove', { token: 'tok1', body: { uid: M1 } }); assert.equal(x.json.team.used, 1);
    x = await s.req('GET', '/api/billing', { token: 'tok2' }); assert.equal(x.json.plan.team, null);

    // Панель: список, настройки и ручное изменение срока
    const tok = (await s.req('POST', '/api/admin/login', { body: { password: 'Test-Admin-Pass-2026' } })).json.token;
    const A = { Authorization: 'Bearer ' + tok };
    assert.equal((await s.req('GET', '/api/admin/teams')).status, 401);
    x = await s.req('GET', '/api/admin/teams', { headers: A });
    assert.equal(x.status, 200); assert.equal(x.json.canEdit, true); assert.equal(x.json.active, 1); assert.equal(x.json.seats, 3); assert.equal(x.json.conf.price, 350);
    assert.equal(x.json.list[0].name, 'Продажи'); assert.equal(x.json.list[0].login, 'olga');
    const id = x.json.list[0].id, until = x.json.list[0].until;
    x = await s.req('POST', '/api/admin/teams/settings', { headers: A, body: { price: 0 } }); assert.equal(x.status, 400); assert.match(x.json.error, /Цена места/);
    x = await s.req('POST', '/api/admin/teams/settings', { headers: A, body: { on: true, price: 400, min: 2, max: 20 } }); assert.equal(x.status, 200); assert.equal(x.json.conf.price, 400);
    x = await s.req('GET', '/api/team/offer'); assert.equal(x.json.price, 400); assert.equal(x.json.min, 2); assert.equal(x.json.max, 20);
    x = await s.req('POST', '/api/admin/teams/' + id + '/days', { headers: A, body: { days: 7 } }); assert.equal(x.status, 200); near(x.json.until, until + 7 * 86400000);
    assert.equal((await s.req('POST', '/api/admin/teams/' + id + '/days', { headers: A, body: { days: 0 } })).status, 400);
    assert.equal((await s.req('POST', '/api/admin/teams/nope-nope/days', { headers: A, body: { days: 3 } })).status, 404);

    // файлы клиента отдаются
    for (const f of ['/js/17-team.js', '/team-offer.js', '/admin/v-teams.js']) assert.equal((await s.req('GET', f)).status, 200, f);
  } finally { await s.stop(); rm(dir); }
});

test('team: скрипты подключены на страницах RU/EN и в Панели', () => {
  const rd = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
  for (const f of ['chat.html', 'en/chat.html']) {
    const h = rd(f);
    assert.match(h, /<script src="\/js\/17-team\.js\?v=1"><\/script>/, f);
    assert.ok(h.indexOf('17-team.js') > h.indexOf('13-billing.js') && h.indexOf('17-team.js') > h.indexOf('10-account.js'), f + ': после billing и account');
    assert.ok(+((h.match(/growth\.css\?v=(\d+)/) || [])[1] || 0) >= 5, f + ': growth.css v>=5');
  }
  for (const f of ['js/10-account.js', 'en/js/10-account.js']) { const j = rd(f); assert.match(j, /premierTeam\.row\(B\)/, f); assert.match(j, /premierTeam\.bind\(el\)/, f); }
  for (const f of ['index.html', 'en/index.html']) { const h = rd(f); assert.match(h, /id="teamStrip" hidden/, f); assert.match(h, /team-offer\.js/, f); assert.match(h, /landing\.css\?v=\d+/, f); }
  const p = rd('panel.html'); assert.match(p, /v-teams\.js\?v=1/); assert.match(p, /shell\.js\?v=6/);
  assert.match(rd('admin/shell.js'), /v: 'teams'/);
  const t = rd('js/17-team.js'); assert.match(t, /Командный тариф/); assert.match(t, /Team plan/); assert.match(t, /premierTeam/);
  assert.match(rd('growth.css'), /\.tm-acc/);
});
