const CACHE_NAME = 'umdenos-admin-v12';
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

// Instalação - cacheia os arquivos
self.addEventListener('install', event => {
  console.log('Service Worker Admin instalado v12');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache Admin aberto');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting(); // Força ativação imediata
});

// Ativação - limpa caches antigos e toma controle
self.addEventListener('activate', event => {
  console.log('Service Worker Admin ativado v12');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME && cacheName.startsWith('umdenos-admin')) {
            console.log('Removendo cache antigo do Admin:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  event.waitUntil(clients.claim());
});

// ESTRATÉGIA: Network First para sempre buscar dados atualizados
self.addEventListener('fetch', event => {
  const url = event.request.url;
  
  // Firebase e APIs externas - nunca cachear
  if (url.includes('firebase') || 
      url.includes('googleapis') ||
      url.includes('loteriascaixa-api') ||
      url.includes('firestore')) {
    event.respondWith(fetch(event.request));
    return;
  }
  
  // Para HTML, CSS, JS - Network First (prioriza rede)
  if (url.includes('.html') || url.includes('.css') || url.includes('.js')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then(response => {
          // Cachear a nova resposta em segundo plano
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Fallback para cache se offline
          return caches.match(event.request);
        })
    );
    return;
  }
  
  // Para imagens e assets - Cache First com atualização em segundo plano
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          // Atualizar em segundo plano
          fetch(event.request).then(freshResponse => {
            if (freshResponse && freshResponse.status === 200) {
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, freshResponse);
              });
            }
          });
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