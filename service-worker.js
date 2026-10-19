const CACHE_NAME = 'cardtrader-pwa-v12';
const BASE = new URL('./', self.location).pathname;
const APP_SHELL = ['', 'index.html', 'style.css', 'config.js', 'main.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'app-icon-180.png', 'app-icon-192.png', 'app-icon-512.png', 'icon.svg'].map(file => BASE + file);
const VUE_URL = 'https://unpkg.com/vue@3/dist/vue.global.prod.js';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    try {
      await cache.add(VUE_URL);
    } catch (error) {
      console.warn('Vue non è stato memorizzato per l\'uso offline:', error);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith('cardtrader-pwa-') && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return;

  if (url.origin === self.location.origin) {
    const isAppShell = APP_SHELL.includes(url.pathname) || request.mode === 'navigate';
    if (!isAppShell) return;

    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        const cached = await caches.match(request) || await caches.match(BASE + 'index.html');
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }

  if (url.href === VUE_URL) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    })());
  }
});

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    console.error('Payload della notifica push non valido:', error);
  }
  event.waitUntil(self.registration.showNotification(data.title || 'CardTrader', {
    body: data.body || 'Lo stato di un articolo è cambiato.',
    icon: BASE + 'app-icon-192.png',
    badge: BASE + 'icon-192.png',
    tag: data.tag || 'cardtrader-status',
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = self.registration.scope;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url === target && 'focus' in client) return client.focus();
    }
    return self.clients.openWindow(target);
  })());
});
