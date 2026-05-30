const CACHE_NAME = 'umdenos-admin-v10';
const urlsToCache = [
  '/um-de-nos/admin.html',
  '/um-de-nos/admin.js',
  '/um-de-nos/style.css',
  '/um-de-nos/firebase-config.js',
  '/um-de-nos/manifest-admin.json',
  '/um-de-nos/assets/icon-72.png',
  '/um-de-nos/assets/icon-96.png',
  '/um-de-nos/assets/icon-128.png',
  '/um-de-nos/assets/icon-144.png',
  '/um-de-nos/assets/icon-152.png',
  '/um-de-nos/assets/icon-192.png',
  '/um-de-nos/assets/icon-384.png',
  '/um-de-nos/assets/icon-512.png'
];

self.addEventListener('install', event => {
  console.log('Service Worker Admin instalado v10');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache Admin aberto');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  console.log('Service Worker Admin ativado v10');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Removendo cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', event => {
  if (event.request.url.includes('firebase') || 
      event.request.url.includes('googleapis') ||
      event.request.url.includes('loteriascaixa-api')) {
    event.respondWith(fetch(event.request));
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        const fetchRequest = event.request.clone();
        return fetch(fetchRequest).then(response => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });
          return response;
        });
      })
  );
});