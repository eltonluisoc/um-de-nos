const CACHE_NAME = 'umdenos-v5'; // Mudei a versão para forçar atualização
const urlsToCache = [
  '/um-de-nos/',
  '/um-de-nos/index.html',
  '/um-de-nos/admin.html',
  '/um-de-nos/style.css',
  '/um-de-nos/firebase-config.js',
  '/um-de-nos/public.js',
  '/um-de-nos/admin.js',
  '/um-de-nos/manifest.json'
];

self.addEventListener('install', event => {
  console.log('Service Worker instalado v2');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache aberto');
        return cache.addAll(urlsToCache);
      })
  );
  // Forçar ativação imediata
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  console.log('Service Worker ativado v2');
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
  // Tomar controle das páginas imediatamente
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', event => {
  // Ignorar requisições para o Firebase e API
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