// 서비스 워커 — 앱 셸 캐시로 오프라인 지원

const CACHE = 'chaekgalpi-v4';

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
  './js/sync.js',
  './js/brand.js',
  './js/image.js',
  './js/photonote.js',
  './js/ocr.js',
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

  // 앱 셸은 네트워크 우선, 안 되면 캐시.
  //
  // 캐시를 먼저 주면 배포 직후에 옛 파일과 새 파일이 섞일 수 있다.
  // 이 앱은 ES 모듈이라 한쪽에만 있는 함수를 부르는 순간 화면 전체가 죽는다
  // (제목줄만 남고 아래가 백지가 된다). 그래서 온라인일 때는 늘 새것을 받는다.
  // 오프라인이면 캐시로 떨어지고, 그때는 캐시 안의 것끼리 짝이 맞는다.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html'))),
  );
});
