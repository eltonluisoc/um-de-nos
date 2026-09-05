const CACHE_NAME = 'umdenos-admin-v16';
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
  console.log('Service Worker Admin instalado v16');
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
  console.log('Service Worker Admin ativado v16');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME && cacheName.startsWith("umdenos-admin")) {
            console.log('Removendo cache antigo do Admin:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', event => {
  const url = event.request.url;
  
  if (url.includes('firebase') || 
      url.includes('googleapis') ||
      url.includes('loteriascaixa-api') ||
      url.includes('firestore')) {
    event.respondWith(fetch(event.request));
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request).then(freshResponse => {
          const responseClone = freshResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
          return freshResponse;
        });
      })
  );
});