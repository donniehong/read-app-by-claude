// 서비스 워커 — 앱 셸 캐시로 오프라인 지원

const CACHE = 'chaekgalpi-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './assets/icon.svg',
  './assets/icon-maskable.svg',
  './js/app.js',
  './js/util.js',
  './js/db.js',
  './js/store.js',
  './js/router.js',
  './js/ui.js',
  './js/theme.js',
  './js/search.js',
  './js/timer.js',
  './js/charts.js',
  './js/quotecard.js',
  './js/dialogs.js',
  './js/demo.js',
  './js/views/home.js',
  './js/views/library.js',
  './js/views/book.js',
  './js/views/timeline.js',
  './js/views/notes.js',
  './js/views/stats.js',
  './js/views/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[sw] precache 실패', err)),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 외부 요청(도서 검색 API, 표지 이미지)은 네트워크 우선, 실패 시 캐시
  if (url.origin !== location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // 표지 이미지는 캐시해 두면 오프라인에서도 보인다
          if (res.ok && req.destination === 'image') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }

  // 앱 셸은 캐시 우선 + 백그라운드 갱신
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached || caches.match('./index.html'));
      return cached || network;
    }),
  );
});
