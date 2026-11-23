'use strict';
// Рост: платный пробный период, скидка на первую покупку, приглашения, публичные ссылки на чаты, предупреждения о лимитах.
// Все числа и ключевые тексты берутся из переменных окружения с безопасными значениями по умолчанию
// (полный список — deploy/premier.env.example и КАК-ПРИМЕНИТЬ.txt). Значения читаются при каждом вызове: дёшево и удобно в тестах.
const crypto = require('crypto');

const env = () => process.env;
// значение переменной без «хвостового» комментария: systemd не убирает « # …» после значения (REF_MAX=20  # потолок)
const raw = (name) => { const v = env()[name]; return v == null ? v : String(v).replace(/\s+#.*$/, ''); };
// целое в диапазоне [min, max]; пусто или мусор — значение по умолчанию (отрицательные и огромные значения обрезаются)
function num(name, def, min, max) {
  const v = raw(name);
  if (v == null || String(v).trim() === '') return def;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
}
function flag(name, def) {
  const v = String(raw(name) ?? '').trim().toLowerCase();
  return v === '' ? def : !['0', 'off', 'false', 'no', 'нет'].includes(v);
}
function text(name, def, max = 300) {
  const v = raw(name);
  return v == null || !String(v).trim() ? def : String(v).trim().replace(/\s+/g, ' ').slice(0, max);
}
const id = (name, def) => { const v = text(name, def, 20).toLowerCase(); return /^[a-z0-9_-]{1,20}$/.test(v) ? v : def; };
function ids(name, def) {
  const v = raw(name); if (v == null || !String(v).trim()) return def;
  return [...new Set(String(v).split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z0-9_-]{1,20}$/.test(s)))];
}

// пробные тарифы по каждому платному тарифу: TRIAL_PLANS (по умолчанию pro,max,ultra), TRIAL_PRICE_<ПЛАН> и TRIAL_DAYS_<ПЛАН>;
// прежние TRIAL_PRICE / TRIAL_DAYS / TRIAL_PLAN относятся к основному тарифу (по умолчанию Pro). Цена 0 — не задана (billing.js посчитает по цене тарифа)
const TRIAL_PRICES = { pro: 99, max: 249, ultra: 990 };
function trialPlans(main, mainPrice, mainDays) {
  const set = raw('TRIAL_PLANS') != null && String(raw('TRIAL_PLANS')).trim() !== '', list = ids('TRIAL_PLANS', ['pro', 'max', 'ultra']);
  if (!set && !list.includes(main)) list.unshift(main); // TRIAL_PLAN=<свой тариф> без TRIAL_PLANS — он тоже в списке
  return Object.fromEntries(list.map((p) => {
    const N = p.toUpperCase().replace(/-/g, '_'), legacy = p === main;
    return [p, { price: raw('TRIAL_PRICE_' + N) != null && String(raw('TRIAL_PRICE_' + N)).trim() !== '' ? num('TRIAL_PRICE_' + N, 0, 1, 100000) : legacy ? mainPrice : TRIAL_PRICES[p] || 0,
      days: raw('TRIAL_DAYS_' + N) != null && String(raw('TRIAL_DAYS_' + N)).trim() !== '' ? num('TRIAL_DAYS_' + N, 3, 1, 30) : legacy ? mainDays : 3 }];
  }));
}

function conf() {
  const trial = { on: flag('TRIAL_OFFER', true), price: num('TRIAL_PRICE', 99, 1, 100000), days: num('TRIAL_DAYS', 3, 1, 30), plan: id('TRIAL_PLAN', 'pro') };
  return {
    // «Pro на 3 дня за 99 ₽» — один раз, только для никогда не плативших; trials — то же по каждому платному тарифу (Pro 99, Max 249, Ultra 990)
    trial, trials: { on: trial.on, plans: trialPlans(trial.plan, trial.price, trial.days) },
    // автоскидка на первую покупку (без кода; с промокодом не суммируется — берётся меньшая цена). 0 — выключено
    first: { percent: num('FIRST_DISCOUNT', 30, 0, 90), plans: ids('FIRST_DISCOUNT_PLANS', ['pro', 'max']), afterTrial: flag('FIRST_DISCOUNT_AFTER_TRIAL', true) },
    // приглашения: pay — бонус обоим после первой оплаты приглашённого; legacy — прежние ступени (+50 сообщений, 10/25/50/100)
    ref: {
      mode: text('REF_MODE', 'pay').toLowerCase() === 'legacy' ? 'legacy' : 'pay',
      days: num('REF_BONUS_DAYS', 3, 0, 90), plan: id('REF_BONUS_PLAN', 'pro'), max: num('REF_MAX', 20, 0, 100000),
      bindHours: num('REF_BIND_HOURS', 72, 0, 87600), payDays: num('REF_PAY_DAYS', 365, 1, 3650), signupMsgs: num('REF_SIGNUP_MSGS', 0, 0, 1000),
      rateUser: num('REF_RATE_USER', 10, 1, 1000), rateIp: num('REF_RATE_IP', 30, 1, 10000),
      trialCounts: flag('REF_TRIAL_COUNTS', true), // пробный период за TRIAL_PRICE считается «первой оплатой» приглашённого
    },
    // публичные ссылки на чат «только чтение»
    share: { on: flag('SHARE', true), rate: num('SHARE_RATE', 20, 1, 10000), max: num('SHARE_MAX', 200, 1, 100000), index: flag('SHARE_INDEX', false), ref: flag('SHARE_REF', false) },
    // мягкое предупреждение на Free, когда осталось не больше N% дневного лимита
    limits: { warnPct: num('FREE_WARN_PCT', 20, 0, 100) },
  };
}

// ключевые тексты: RU по умолчанию; английская версия — та же переменная с суффиксом _EN
const TEXTS = {
  ru: {
    trialBadge: ['TRIAL_BADGE', 'Популярный старт'],
    warn: ['FREE_WARN_TEXT', 'Бесплатные сообщения почти закончились. Pro снимает лимиты'],
    shareCta: ['SHARE_CTA', 'Попробовать самому'],
    shareTagline: ['SHARE_TAGLINE', 'Premier — ИИ, у которого есть компьютер: пишет код, сам запускает его в облачном Linux и собирает готовые сайты и игры прямо в чате.'],
    seoTitle: ['SEO_TITLE', 'Premier — ИИ, у которого есть компьютер'],
    seoDescription: ['SEO_DESCRIPTION', 'ИИ, который не только отвечает, но и сам запускает код в облачном Linux: GPT, Gemini, DeepSeek, Kimi и Qwen в одном чате. Сайты, игры и Python без VPN и зарубежной карты. Начните бесплатно.'],
  },
  en: {
    trialBadge: ['TRIAL_BADGE', 'Popular start'],
    warn: ['FREE_WARN_TEXT', 'Your free messages are almost used up. Pro removes the limits'],
    shareCta: ['SHARE_CTA', 'Try it yourself'],
    shareTagline: ['SHARE_TAGLINE', 'Premier is the AI that has its own computer: it writes code, runs it on a cloud Linux machine and builds finished websites and games right in the chat.'],
    seoTitle: ['SEO_TITLE', 'Premier — the AI that has its own computer'],
    seoDescription: ['SEO_DESCRIPTION', 'An AI that doesn’t just answer but runs code on its own cloud Linux machine: GPT, Gemini, DeepSeek, Kimi and Qwen in one chat. Websites, games and Python. Start for free.'],
  },
};
function texts(lang) {
  const en = lang === 'en';
  return Object.fromEntries(Object.entries(TEXTS[en ? 'en' : 'ru']).map(([k, [name, def]]) => [k, text(name + (en ? '_EN' : ''), def, 400)]));
}

// неугадываемые короткие коды: base62 из криптографического генератора (10 знаков ≈ 59 бит)
const ABC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function token(n = 10) { let s = ''; for (let i = 0; i < n; i++) s += ABC[crypto.randomInt(62)]; return s; }
// почта для проверки «один пробный период на человека»: регистр, +метки и точки Gmail не дают второй попытки
function normEmail(e) {
  const m = /^([^@\s]+)@([^@\s]+)$/.exec(String(e || '').trim().toLowerCase()); if (!m) return '';
  let [, local, domain] = m; local = local.split('+')[0];
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return local ? local + '@' + domain : '';
}
const hashKey = (kind, v) => crypto.createHash('sha256').update('premier:' + kind + ':' + v).digest('hex').slice(0, 40);

module.exports = { conf, texts, token, normEmail, hashKey, TEXTS };
