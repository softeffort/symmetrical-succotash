// Service worker Premier: установка как приложения, офлайн-страница, кеш статики и push-уведомления.
// API, опубликованные сайты и админка не кешируются никогда; страницы — сначала из сети.
'use strict';
const V = 'premier-v1';
const PRE = ['/offline.html', '/icons/icon-192.png'];
const STATIC = /^\/(js|en\/js|theme|fonts|vendor|icons)\/|^\/[^/]+\.(css|png|svg|ico|woff2|webp|jpg)$/;
const SKIP = /^\/(api|s|panelp|admin|ws)(\/|$)|^\/sw\.js$/;

self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(PRE)).catch(() => {}).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', (e) => {
  const r = e.request; if (r.method !== 'GET' || r.headers.has('range')) return;
  const u = new URL(r.url); if (u.origin !== location.origin || SKIP.test(u.pathname)) return;
  if (r.mode === 'navigate') { e.respondWith(fetch(r).catch(() => caches.match('/offline.html'))); return; }
  if (!STATIC.test(u.pathname)) return;
  e.respondWith(caches.open(V).then(async (c) => {
    const hit = await c.match(r);
    const net = fetch(r).then((res) => { if (res.ok && res.type === 'basic') c.put(r, res.clone()).catch(() => {}); return res; }).catch(() => hit || Response.error());
    return hit || net;
  }));
});

self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Premier', { body: d.body || '', icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', tag: d.tag || undefined, data: { url: d.url || '/chat' } }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/chat', location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const same = list.find((w) => new URL(w.url).origin === location.origin);
    if (same) return same.focus().then((w) => (w && w.url !== url && 'navigate' in w ? w.navigate(url).catch(() => w) : w));
    return self.clients.openWindow(url);
  }));
});
