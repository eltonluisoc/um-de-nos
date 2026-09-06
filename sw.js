const CACHE_NAME = 'umdenos-index-v17';
// Caminhos relativos: funcionam em qualquer endereço (não dependem de "/um-de-nos/").
const urlsToCache = [
  './',
  'index.html',
  'admin.html',
  'admin.js',
  'firebase-config.js',
  'public.js',
  'manifest.json',
  'assets/icon-72.png',
  'assets/icon-96.png',
  'assets/icon-128.png',
  'assets/icon-144.png',
  'assets/icon-152.png',
  'assets/icon-192.png',
  'assets/icon-384.png',
  'assets/icon-512.png'
];

// Instalação - cacheia os arquivos
self.addEventListener('install', event => {
  console.log('Service Worker App instalado v17');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache Index aberto');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting(); // Força ativação imediata
});

// Ativação - limpa caches antigos e toma controle
self.addEventListener('activate', event => {
  console.log('Service Worker App ativado v17');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // Remove caches antigos (incluindo o do antigo app admin separado).
          if (cacheName !== CACHE_NAME && cacheName.startsWith('umdenos-')) {
            console.log('Removendo cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  event.waitUntil(clients.claim());
});

// ESTRATÉGIA: Network First com fallback para cache
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
  
  // Para HTML, CSS, JS - Network First
  if (url.includes('.html') || url.includes('.css') || url.includes('.js')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cachear a nova resposta
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Fallback para cache
          return caches.match(event.request);
        })
    );
    return;
  }
  
  // Para imagens e assets - Cache First
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