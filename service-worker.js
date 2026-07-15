const CACHE_NAME = 'nova-recipe-builder-github-pages-v37';
const BASE_PATH = '/nova-recipe-builder/';
const APP_SHELL = [BASE_PATH, BASE_PATH + 'index.html', BASE_PATH + 'app.js', BASE_PATH + 'manifest.json', BASE_PATH + 'icon-192x192.png', BASE_PATH + 'icon-512x512.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))); self.clients.claim(); });
self.addEventListener('fetch', event => { const requestUrl = new URL(event.request.url); if (!requestUrl.pathname.startsWith(BASE_PATH)) return; event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).catch(() => caches.match(BASE_PATH + 'index.html')))); });
