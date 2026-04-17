const CACHE_NAME = 'financas-pwa-v4.8';

const FILES_TO_CACHE = [
  '/index.html',
  '/manifest.json',
  '/src/app.js'
];

// INSTALL
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return Promise.all(
          FILES_TO_CACHE.map(file =>
            fetch(file).then(response => {
              if (!response.ok) {
                throw new Error(`Falha ao cachear ${file}`);
              }
              return cache.put(file, response);
            })
          )
        );
      })
      .catch(err => console.error('❌ Erro no cache:', err))
  );
  self.skipWaiting();
});

// ACTIVATE
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => key !== CACHE_NAME && caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// FETCH
self.addEventListener('fetch', event => {
  // ❌ Nunca cachear API
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});

self.addEventListener('push', (event) => {
    const data = event.data ? event.data.json() : { title: 'Aviso', body: 'Nova atualização!' };
    
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: '/img/icon-192.png', // Verifique se esse arquivo abre no seu navegador
            vibrate: [100, 50, 100],
            data: { url: '/' }
        })
    );
});

// Abre o app ao clicar na notificação
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});
