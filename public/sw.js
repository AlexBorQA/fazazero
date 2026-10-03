/**
 * Fazazero Service Worker (v1.1.0)
 * Автономный кеширующий шлюз для 100% Client-Side Air-Gap режима.
 * Работает как в корне домена (fazazero.ru), так и во вложенной папке (/fazazero/).
 */

const CACHE_NAME = 'fazazero-v2';

// Базовые ассеты приложения для прекеширования
const PRECACHE_ASSETS = [
  './',
  'index.html',
  'css/style.css?v=4',
  'js/core.js',
  'js/app.js?v=10',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/favicon-32.png',
  'icons/apple-touch-icon.png',
  'Кабельный_журнал_ГРЩ_70_линий_ГОСТ.xlsx',
];

// Установка: прогрев кеша статики
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Кэшируем ассеты по отдельности с отказоустойчивостью
      return Promise.allSettled(
        PRECACHE_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
            console.warn('[SW] Ошибка прекеширования ресурса:', url, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// Активация: удаление устаревших версий кеша и перехват управления
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Удаление устаревшего кеша:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Перехват сетевых запросов
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Игнорируем запросы, не являющиеся GET
  if (request.method !== 'GET') {
    return;
  }

  // Стратегия: Stale-While-Revalidate для ассетов / Cache-First с Network Fallback
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      // Фоновое обновление из сети при наличии интернета
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === 'basic'
          ) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Сеть недоступна (чистый офлайн / режим Air-Gap)
          return null;
        });

      // Если ресурс уже есть в локальном кеше — отдаем мгновенно (0 мс)
      if (cachedResponse) {
        return cachedResponse;
      }

      // Если в кеше нет — ждем сеть
      return fetchPromise.then((networkResponse) => {
        if (networkResponse) {
          return networkResponse;
        }

        // Если это запрос навигации (HTML) и сети нет — отдаем главный index.html
        if (request.mode === 'navigate') {
          return caches.match('./') || caches.match('index.html');
        }

        return new Response('Офлайн-ресурс недоступен', {
          status: 503,
          statusText: 'Service Unavailable (Offline)',
        });
      });
    })
  );
});
