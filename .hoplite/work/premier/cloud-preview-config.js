'use strict';
// Адрес превью сайтов облачного компьютера (общая настройка для cloud.js и cloud-preview.js).
//   CLOUD_PREVIEW_URL=https://*.pc.example.ru  — у каждого открытия сайта свой случайный поддомен
//                                                (нужны запись DNS *.pc.example.ru и сертификат на неё)
// Один адрес на все сайты (https://pc.example.ru) больше не включается (этап 3, CLD-13): у всех проектов был бы общий
// origin, и service worker, cookie и хранилище прошлого проекта доставались бы следующему. Если поддомены пока
// настроить нельзя, старый режим включается только явно: CLOUD_PREVIEW_SINGLE=unsafe — тогда при каждом открытии
// браузеру отправляется команда стереть данные адреса (Clear-Site-Data), но защита зависит от браузера.
const RAW = (process.env.CLOUD_PREVIEW_URL || '').trim().replace(/\/+$/, '');
const m = /^(https?):\/\/(\*\.)?([a-z0-9.-]+(?::\d+)?)$/i.exec(RAW);
const MAIN = (() => { try { return new URL(process.env.PUBLIC_URL).host.toLowerCase(); } catch { return ''; } })();
const SINGLE = String(process.env.CLOUD_PREVIEW_SINGLE || '').toLowerCase() === 'unsafe';
// PARSED — адрес распознан; CFG — превью включено (поддомены или явно разрешённый общий адрес)
const PARSED = m && m[3].toLowerCase() !== MAIN ? { proto: m[1].toLowerCase(), wild: !!m[2], host: m[3].toLowerCase() } : null;
const CFG = PARSED && (PARSED.wild || SINGLE) ? PARSED : null;
const WHY = !RAW ? '' : !PARSED ? 'CLOUD_PREVIEW_URL не распознан или совпадает с адресом Premier (нужен отдельный, например https://*.pc.example.ru) — превью сайтов выключено'
  : !CFG ? `CLOUD_PREVIEW_URL задан без «*.» — превью сайтов выключено: у каждого сайта должен быть свой поддомен. Укажите ${PARSED.proto}://*.${PARSED.host} (нужны запись DNS *.${PARSED.host} и сертификат на неё)`
  : !CFG.wild ? 'ВНИМАНИЕ: CLOUD_PREVIEW_SINGLE=unsafe — все сайты облачного компьютера открываются на одном адресе; настройте поддомены (CLOUD_PREVIEW_URL=https://*.адрес)' : '';
module.exports = { RAW, PARSED, CFG, SINGLE, WHY };
