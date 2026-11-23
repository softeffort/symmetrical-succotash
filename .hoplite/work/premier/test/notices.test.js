// Личные уведомления: отправка из панели (выбранным, сегменту, списком, повтор), показ на сайте с подстановками,
// закрытие навсегда, кнопка и ответ, отзыв, расписание и срок показа, права ролей, гости и английская версия.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { copyApp, seed, startServer, rm } = require('./helpers');

const PW = 'Test-Admin-Pass-2026';
const DAY = 864e5;
const users = [
  { id: 'a1a1a1a1a1a1', login: 'anna', name: 'Анна', email: 'anna@example.com', created: '2026-01-01T00:00:00Z' },
  { id: 'b2b2b2b2b2b2', login: 'boris', email: 'boris@example.com', created: new Date(Date.now() - 2 * DAY).toISOString(), plan: 'pro', until: Date.now() + 5 * DAY - 3600e3 },
  { id: 'c3c3c3c3c3c3', login: 'clara', email: 'clara@example.com', created: '2026-02-01T00:00:00Z', plan: 'pro', until: Date.now() + 40 * DAY },
  { id: 'd4d4d4d4d4d4', login: 'dmitry', email: 'dmitry@example.com', created: '2026-02-01T00:00:00Z', banned: { at: Date.now(), reason: 'spam' } },
];
const ids = (r) => r.json.items.map((x) => x.id);

test('уведомления: панель → карточка на сайте → закрыто навсегда', { timeout: 90000 }, async (t) => {
  const dir = copyApp();
  seed(dir, { users, sessions: { tokA: 'a1a1a1a1a1a1', tokB: 'b2b2b2b2b2b2', tokC: 'c3c3c3c3c3c3', tokD: 'd4d4d4d4d4d4' } });
  const s = await startServer(dir);
  t.after(async () => { await s.stop(); rm(dir); });
  const as = (token) => (method, url, body) => s.req(method, url, { body, headers: { Authorization: 'Bearer ' + token } });
  const owner = as((await s.req('POST', '/api/admin/login', { body: { password: PW } })).json.token);
  const mine = (tok, lang) => s.req('GET', '/api/notices' + (lang ? '?lang=' + lang : ''), { token: tok });

  // гость: пусто и признак «не спрашивать дальше»
  const guest = await s.req('GET', '/api/notices');
  assert.equal(guest.status, 200); assert.deepEqual(guest.json.items, []); assert.equal(guest.json.guest, true);
  assert.equal((await s.req('POST', '/api/notices/abcdefabcdef/close')).status, 401);

  // проверка полей
  assert.equal((await owner('POST', '/api/admin/notices', { to: { ids: ['a1a1a1a1a1a1'] }, text: '  ' })).status, 400);
  assert.equal((await owner('POST', '/api/admin/notices', { to: { ids: ['a1a1a1a1a1a1'] }, text: 'x', link: 'javascript:alert(1)' })).status, 400);
  assert.equal((await owner('POST', '/api/admin/notices', { to: { ids: ['a1a1a1a1a1a1'] }, text: 'x'.repeat(1001) })).status, 400);
  assert.equal((await owner('POST', '/api/admin/notices', { to: { ids: ['d4d4d4d4d4d4'] }, text: 'Заблокированному' })).status, 400);
  assert.equal((await owner('POST', '/api/admin/notices', { text: 'Без получателей' })).status, 400);

  // одному пользователю: срочно, с кнопкой и подстановками
  const one = await owner('POST', '/api/admin/notices', { to: { ids: ['a1a1a1a1a1a1'] }, level: 'urgent', title: '{name}, проверьте почту', text: 'Здравствуйте, {name} ({login})! Тариф: {plan}. {unknown}', link: '/chat?pay=1', linkText: 'Открыть' });
  assert.equal(one.status, 200, one.text); assert.equal(one.json.total, 1); assert.match(one.json.id, /^[a-f0-9]{12}$/);
  let a = await mine('tokA');
  assert.equal(a.json.items.length, 1);
  const n1 = a.json.items[0];
  assert.equal(n1.level, 'urgent'); assert.equal(n1.title, 'Анна, проверьте почту');
  assert.match(n1.text, /^Здравствуйте, Анна \(anna\)! Тариф: .+\. \{unknown\}$/);
  assert.equal(n1.link, '/chat?pay=1'); assert.equal(n1.reply, false);
  assert.deepEqual((await mine('tokB')).json.items, []); // другим не видно

  // «увидел» не убирает карточку; «закрыть» — убирает навсегда, повторное закрытие безопасно
  assert.equal((await s.req('POST', `/api/notices/${n1.id}/seen`, { token: 'tokA' })).status, 200);
  assert.equal((await mine('tokA')).json.items.length, 1);
  assert.equal((await s.req('POST', `/api/notices/${n1.id}/close`, { token: 'tokA' })).status, 200);
  assert.equal((await s.req('POST', `/api/notices/${n1.id}/close`, { token: 'tokA' })).status, 200);
  assert.deepEqual((await mine('tokA')).json.items, []);
  assert.equal((await s.req('POST', `/api/notices/${n1.id}/close`, { token: 'tokB' })).status, 404); // чужое
  assert.equal((await s.req('POST', `/api/notices/${n1.id}/close`, { token: 'tokA', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);

  // сегмент «Платные»: заблокированные и бесплатные не попадают; {days} и {until} — по тарифу каждого
  const res = await owner('POST', '/api/admin/notices/resolve', { to: { filter: { status: 'paid' } } });
  assert.equal(res.status, 200); assert.equal(res.json.n, 2); assert.equal(res.json.label, 'Платные');
  assert.equal((await owner('POST', '/api/admin/notices/resolve', { to: { filter: { status: 'banned' } } })).status, 400);
  const seg = await owner('POST', '/api/admin/notices', { to: { filter: { status: 'paid' } }, level: 'warn', text: 'Осталось {days} дн., до {until}', reply: true });
  assert.equal(seg.status, 200, seg.text); assert.equal(seg.json.total, 2);
  const b = (await mine('tokB')).json.items[0], c = (await mine('tokC')).json.items[0];
  assert.match(b.text, /^Осталось 5 дн\., до \d+ \S+$/); assert.match(c.text, /^Осталось 40 дн\./);
  assert.deepEqual((await mine('tokA')).json.items, []);

  // ответ: один раз, закрывает карточку, видно в панели и в счётчике меню
  assert.equal((await s.req('POST', `/api/notices/${seg.json.id}/reply`, { token: 'tokB', body: { text: '' } })).status, 400);
  assert.equal((await s.req('POST', `/api/notices/${seg.json.id}/reply`, { token: 'tokB', body: { text: 'Продлю завтра, спасибо' } })).status, 200);
  assert.equal((await s.req('POST', `/api/notices/${seg.json.id}/reply`, { token: 'tokB', body: { text: 'Ещё раз' } })).status, 409);
  assert.deepEqual((await mine('tokB')).json.items, []);
  assert.equal((await s.req('POST', `/api/notices/${one.json.id}/reply`, { token: 'tokA', body: { text: 'нельзя' } })).status, 400);
  assert.equal((await owner('GET', '/api/admin/badges')).json.notices, 1);

  // кнопка: считается нажатием и тоже закрывает
  assert.equal((await s.req('POST', `/api/notices/${seg.json.id}/click`, { token: 'tokC' })).status, 200);
  assert.deepEqual((await mine('tokC')).json.items, []);

  // панель: список, статистика, получатели, ответы
  const list = await owner('GET', '/api/admin/notices/list');
  assert.equal(list.status, 200); assert.equal(list.json.total, 2); assert.equal(list.json.counts.replies, 1);
  const row = list.json.items.find((x) => x.id === seg.json.id);
  assert.equal(row.n, 2); assert.equal(row.closed, 2); assert.equal(row.replied, 1); assert.equal(row.clicked, 1); assert.equal(row.state, 'done'); assert.equal(row.unread, 1);
  assert.equal(row.audience.label, 'Платные');
  const det = await owner('GET', '/api/admin/notices/' + seg.json.id);
  assert.equal(det.json.replies.length, 1); assert.equal(det.json.replies[0].reply, 'Продлю завтра, спасибо'); assert.equal(det.json.replies[0].login, 'boris');
  assert.equal(det.json.recipients.length, 2); assert.equal(det.json.resend.noreply, 1);
  assert.equal((await owner('GET', '/api/admin/badges')).json.notices, 0); // открыли — прочитано
  assert.equal((await owner('GET', `/api/admin/notices/${seg.json.id}?who=replied`)).json.recipients.length, 1);
  assert.equal((await owner('GET', '/api/admin/notices/list?state=replies')).json.total, 1);

  // карточка пользователя в панели — история уведомлений
  const card = await owner('GET', '/api/admin/users/b2b2b2b2b2b2');
  assert.equal(card.json.notices.length, 1); assert.equal(card.json.notices[0].answer, 'Продлю завтра, спасибо');

  // повтор тем, кто не ответил; список логинов/почт с ненайденными
  const again = await owner('POST', '/api/admin/notices', { to: { from: seg.json.id, who: 'noreply' }, text: 'Напоминаем' });
  assert.equal(again.json.total, 1); assert.equal((await mine('tokC')).json.items[0].text, 'Напоминаем');
  const lr = await owner('POST', '/api/admin/notices/resolve', { to: { list: 'anna, @boris\nclara@example.com nobody' } });
  assert.equal(lr.json.n, 3); assert.deepEqual(lr.json.missing, ['nobody']); assert.equal(lr.json.busy, 1);

  // срочность: критичное показывается раньше; отзыв убирает у всех
  const crit = await owner('POST', '/api/admin/notices', { to: { ids: ['c3c3c3c3c3c3'] }, level: 'critical', text: 'Критично' });
  assert.deepEqual(ids(await mine('tokC')), [crit.json.id, again.json.id]);
  assert.equal((await owner('POST', `/api/admin/notices/${crit.json.id}/revoke`)).status, 200);
  assert.deepEqual(ids(await mine('tokC')), [again.json.id]);
  assert.equal((await owner('GET', '/api/admin/notices/list?state=done')).json.items.some((x) => x.id === crit.json.id && x.state === 'revoked'), true);

  // расписание и срок показа
  const later = await owner('POST', '/api/admin/notices', { to: { ids: ['a1a1a1a1a1a1'] }, text: 'Завтра', starts: Date.now() + DAY });
  assert.equal(later.json.scheduled, true); assert.deepEqual((await mine('tokA')).json.items, []);
  assert.equal((await owner('GET', '/api/admin/notices/list?state=scheduled')).json.total, 1);
  assert.equal((await owner('POST', '/api/admin/notices', { to: { ids: ['a1a1a1a1a1a1'] }, text: 'x', starts: Date.now() + 400 * DAY })).status, 400);
  const short = await owner('POST', '/api/admin/notices', { to: { ids: ['a1a1a1a1a1a1'] }, text: 'Сутки', days: 1 });
  assert.ok(short.json.expires > Date.now() + DAY - 60e3 && short.json.expires < Date.now() + DAY + 60e3);

  // английская версия текста — для английского интерфейса, иначе русский
  const en = await owner('POST', '/api/admin/notices', { to: { ids: ['a1a1a1a1a1a1'] }, text: 'Привет, {name}', textEn: 'Hi, {name}', link: '/chat', linkText: 'Открыть', linkTextEn: 'Open' });
  const ruItem = (await mine('tokA')).json.items.find((x) => x.id === en.json.id), enItem = (await mine('tokA', 'en')).json.items.find((x) => x.id === en.json.id);
  assert.equal(ruItem.text, 'Привет, Анна'); assert.equal(enItem.text, 'Hi, Анна'); assert.equal(enItem.linkText, 'Open');
  assert.equal((await s.req('POST', '/api/notices/abcdefabcdef/close', { token: 'tokA', headers: { Cookie: 'premier_session=tokA; premier_lang=en' } })).json.error, 'Notification not found');

  // журнал действий: отправка записана на пользователя
  const au = await owner('GET', '/api/admin/audit?target=user:a1a1a1a1a1a1');
  assert.ok(au.json.items.some((x) => /^Уведомление \(срочное\)/.test(x.action)));

  // права: наблюдатель видит, но не отправляет; поддержка — только до 20 получателей
  const created = await owner('POST', '/api/admin/admins', { login: 'olga', role: 'viewer' });
  const vtok = (await s.req('POST', '/api/admin/login', { body: { login: 'olga', password: created.json.password } })).json.token, viewer = as(vtok);
  assert.equal((await viewer('GET', '/api/admin/notices/list')).status, 200);
  assert.equal((await viewer('POST', '/api/admin/notices', { to: { ids: ['a1a1a1a1a1a1'] }, text: 'x' })).status, 403);
  assert.equal((await viewer('POST', `/api/admin/notices/${en.json.id}/revoke`)).status, 403);
  await owner('PATCH', '/api/admin/admins/' + created.json.admin.id, { role: 'support' });
  assert.equal((await viewer('POST', '/api/admin/notices', { to: { ids: ['a1a1a1a1a1a1'] }, text: 'От поддержки' })).status, 200);
  const many = ['b2b2b2b2b2b2', ...Array.from({ length: 20 }, (_, i) => 'e' + String(i).padStart(11, '0'))]; // 21 ID: право проверяется до отсева несуществующих
  assert.equal((await viewer('POST', '/api/admin/notices', { to: { ids: many }, text: 'Массово' })).status, 403);
  assert.equal((await viewer('POST', '/api/admin/notices/resolve', { to: { filter: {} } })).json.canBulk, false);

  // удалённый пользователь пропадает из получателей
  assert.equal((await owner('DELETE', '/api/admin/users/a1a1a1a1a1a1')).status, 200);
  assert.equal((await owner('GET', '/api/admin/notices/' + en.json.id)).json.recipients.length, 0);
});
