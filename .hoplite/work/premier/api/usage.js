'use strict';
// Журнал запросов к API (без текстов запросов и ответов) и статистика для кабинета.
const KEEP_DAYS = 31;
const MSK = 3 * 3600e3; // сутки лимитов считаются по Москве — так же, как в тарифах
const dayOf = (ms) => new Date(ms + MSK).toISOString().slice(0, 10);
const dayStart = (ms = Date.now()) => { const d = new Date(ms + MSK); d.setUTCHours(0, 0, 0, 0); return d.getTime() - MSK; };

// monitor — для тревоги, когда запись журнала потеряна (API-11): журнал — «лучшее усилие», а лимиты ключа от него зависеть не должны.
function createUsage(store, monitor) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS api_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, key_id TEXT, at INTEGER NOT NULL,
    model TEXT, proto TEXT, client TEXT, stream INTEGER, status INTEGER, ms INTEGER, ttft INTEGER,
    in_tok INTEGER, out_tok INTEGER, cost REAL, err TEXT, credits REAL);
    CREATE INDEX IF NOT EXISTS api_log_uid_at ON api_log(uid, at);`);
  store.db.exec('CREATE INDEX IF NOT EXISTS api_log_at ON api_log(at)'); // prune() по одному at без uid
  const q = (sql) => store.db.prepare(sql);
  // Ultra-кредиты запроса (cost у Ultra всегда 0 — списываются кредиты, а не сообщения)
  if (!q('PRAGMA table_info(api_log)').all().some((c) => c.name === 'credits')) store.db.exec('ALTER TABLE api_log ADD COLUMN credits REAL');
  store.db.exec('CREATE INDEX IF NOT EXISTS api_log_key_at ON api_log(key_id, at)');
  // Дневной счётчик расхода ключа (API-11): лимиты ключа считаются по нему, а не по строкам api_log (их вставка может не удаться, строки могут удалить).
  // Меняется в той же транзакции, что и списание (spend), и уточняется по итогам запроса (возврат/Ultra-кредиты).
  store.db.exec('CREATE TABLE IF NOT EXISTS api_key_spend (key_id TEXT NOT NULL, day TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0, credits REAL NOT NULL DEFAULT 0, PRIMARY KEY (key_id, day))');
  const prune = () => { try { q('DELETE FROM api_log WHERE at < ?').run(Date.now() - KEEP_DAYS * 86400000); q('DELETE FROM api_key_spend WHERE day < ?').run(dayOf(Date.now() - KEEP_DAYS * 86400000)); } catch {} };
  prune(); setInterval(prune, 6 * 3600e3).unref();

  let lost = 0;
  return {
    dayStart,
    get lost() { return lost; },
    // изменить счётчик ключа за сутки момента at: dRequests/dCredits могут быть отрицательными (возврат); ошибки НЕ глотаем — вызывающий решает
    spend(keyId, dRequests, dCredits = 0, at = Date.now()) {
      if (!keyId || (!dRequests && !dCredits)) return;
      const r = Math.round((Number(dCredits) || 0) * 1e6) / 1e6, n = Math.trunc(Number(dRequests) || 0);
      // первая запись за сутки: счётчик стартует с того, что уже есть в журнале (день обновления / потерянный счётчик), и дальше он — единственный источник
      const d0 = dayStart(at);
      q('INSERT OR IGNORE INTO api_key_spend (key_id, day, requests, credits) SELECT ?, ?, count(*), coalesce(sum(credits), 0) FROM api_log WHERE key_id = ? AND at >= ? AND at < ? AND (cost > 0 OR credits > 0)').run(keyId, dayOf(at), keyId, d0, d0 + 86400000);
      q('INSERT INTO api_key_spend (key_id, day, requests, credits) VALUES (?, ?, max(0, ?), max(0, ?)) ON CONFLICT(key_id, day) DO UPDATE SET requests = max(0, requests + ?), credits = max(0, round(credits + ?, 6))').run(keyId, dayOf(at), n, r, n, r);
    },
    log(r) {
      try {
        q('INSERT INTO api_log (uid, key_id, at, model, proto, client, stream, status, ms, ttft, in_tok, out_tok, cost, err, credits) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(r.uid, r.key_id || null, r.at || Date.now(), r.model || null, r.proto || null, r.client ? String(r.client).slice(0, 60) : null, r.stream ? 1 : 0, r.status | 0, r.ms | 0, r.ttft == null ? null : r.ttft | 0, r.in_tok | 0, r.out_tok | 0, Number(r.cost) || 0, r.err ? String(r.err).slice(0, 300) : null, Number(r.credits) || 0);
      } catch (e) { lost++; console.log('api log:', e.message); if (monitor && monitor.error) { try { monitor.error('API журнал запросов: запись потеряна', e); } catch {} } }
    },
    todayByKey(uid) {
      const m = new Map();
      for (const r of q('SELECT key_id, count(*) AS n FROM api_log WHERE uid = ? AND at >= ? GROUP BY key_id').all(uid, dayStart())) m.set(r.key_id, r.n);
      return m;
    },
    // сколько запросов и Ultra-кредитов ключ потратил за сутки по Москве момента at (для лимитов ключа); отказы и возвращённые запросы не считаются.
    // Источник один — счётчик; пока его строки за сутки нет (день обновления), значение берётся из журнала за те же сутки, без записи (spend создаст строку из него же)
    keyToday(keyId, at = Date.now()) {
      const c = q('SELECT requests, credits FROM api_key_spend WHERE key_id = ? AND day = ?').get(keyId, dayOf(at));
      if (c) return { requests: c.requests, credits: c.credits };
      const d0 = dayStart(at), r = q('SELECT count(*) AS n, coalesce(sum(credits), 0) AS credits FROM api_log WHERE key_id = ? AND at >= ? AND at < ? AND (cost > 0 OR credits > 0)').get(keyId, d0, d0 + 86400000);
      return { requests: r.n, credits: r.credits };
    },
    stats(uid, days) {
      days = Math.min(KEEP_DAYS, Math.max(1, days | 0 || 30));
      const from = dayStart() - (days - 1) * 86400000;
      const rows = q(`SELECT date((at + ${MSK}) / 1000, 'unixepoch') AS day, count(*) AS requests, sum(cost) AS messages, sum(credits) AS credits, sum(status >= 400) AS errors, sum(in_tok) AS in_tok, sum(out_tok) AS out_tok
        FROM api_log WHERE uid = ? AND at >= ? GROUP BY day`).all(uid, from);
      const byDay = new Map(rows.map((r) => [r.day, r]));
      const out = [];
      for (let i = 0; i < days; i++) {
        const day = dayOf(from + i * 86400000 + 3600e3), r = byDay.get(day);
        out.push({ day, requests: r ? r.requests : 0, messages: r ? Math.round(r.messages * 10) / 10 : 0, credits: r ? Math.round(r.credits * 10) / 10 : 0, errors: r ? r.errors : 0, in_tok: r ? r.in_tok : 0, out_tok: r ? r.out_tok : 0 });
      }
      const by_model = q('SELECT model, count(*) AS requests, sum(cost) AS messages, sum(credits) AS credits FROM api_log WHERE uid = ? AND at >= ? GROUP BY model ORDER BY requests DESC LIMIT 20').all(uid, from)
        .map((r) => ({ model: r.model, requests: r.requests, messages: Math.round(r.messages * 10) / 10, credits: Math.round(r.credits * 10) / 10 }));
      const by_client = q('SELECT coalesce(client, ?) AS client, count(*) AS requests FROM api_log WHERE uid = ? AND at >= ? GROUP BY 1 ORDER BY requests DESC LIMIT 12').all('—', uid, from);
      return { days: out, by_model, by_client };
    },
    list(uid, { limit = 50, before = null, key = null } = {}) {
      limit = Math.min(200, Math.max(1, limit | 0 || 50));
      const args = [uid]; let where = 'uid = ?';
      if (before) { where += ' AND id < ?'; args.push(Number(before) | 0); }
      if (key) { where += ' AND key_id = ?'; args.push(String(key)); }
      const items = q(`SELECT * FROM api_log WHERE ${where} ORDER BY id DESC LIMIT ?`).all(...args, limit + 1);
      const more = items.length > limit; if (more) items.pop();
      return { items: items.map((r) => ({ id: r.id, at: r.at, key_id: r.key_id, client: r.client, model: r.model, proto: r.proto, stream: !!r.stream, status: r.status, ms: r.ms, ttft: r.ttft, in_tok: r.in_tok, out_tok: r.out_tok, cost: Math.round(r.cost * 10) / 10, credits: Math.round((r.credits || 0) * 10) / 10, err: r.err })), next: more ? items[items.length - 1].id : null };
    },
  };
}

module.exports = { createUsage, dayStart };
