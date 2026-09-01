const CACHE_NAME = 'agnail-cache-v2.0.5';
const ASSETS_ESTATICOS = [
  'assets/logo.png',
  'https://fonts.googleapis.com/css2?family=Nunito:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];
const PAGINAS_APP = [
  '/',
  'index.html',
  'login.html',
  'cobranca.html',
  'manicures.html',
  'agendamentos.html'
  // F16: 'adm.html' removido de propósito — este service worker também é
  // registrado por agendamentos.html (página pública, sem login), então
  // qualquer visitante anônimo acabava com o HTML do painel admin
  // pré-armazenado no Cache Storage do próprio navegador. O admin ainda
  // acessa adm.html normalmente; só não é mais pré-cacheado no install.
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_ESTATICOS.concat(PAGINAS_APP)))
      .catch(err => console.log('Falha ao cachear recursos:', err))
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => Promise.all(
      cacheNames.map(cacheName => {
        if (!cacheWhitelist.includes(cacheName)) {
          return caches.delete(cacheName);
        }
      })
    )).then(() => self.clients.claim())
  );
});

function ehCodigoDoApp(url) {
  return url.origin === self.location.origin &&
    (url.pathname.endsWith('.html') || url.pathname.endsWith('.js') || url.pathname === '/');
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (ehCodigoDoApp(url)) {
    event.respondWith(
      fetch(req)
        .then(resp => {
          if (resp && resp.status === 200) {
            const copia = resp.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copia));
          }
          return resp;
        })
        .catch(() => caches.match(req).then(cached => cached || new Response(
          'Conteúdo indisponível offline', { status: 503, statusText: 'Offline' }
        )))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const copia = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copia));
        }
        return resp;
      }).catch(() => new Response('Conteúdo indisponível offline', { status: 503, statusText: 'Offline' }));
    })
  );
});