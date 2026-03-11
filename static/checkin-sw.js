/**
 * Service Worker for 每日打卡 PWA
 * 支持离线使用
 */
const CACHE_NAME = "checkin-v1";
const urlsToCache = [
  "/static/checkin.html",
  "/static/checkin-manifest.json",
  "/static/checkin-icon.svg",
  "/static/checkin-icon-512.png"
];

// 安装时缓存资源
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    }).then(() => self.skipWaiting())
  );
});

// 激活时清理旧缓存
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      );
    }).then(() => self.clients.claim())
  );
});

// 请求时：网络优先，失败则回退到缓存
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isCheckin = /\/static\/checkin(-manifest\.json|-icon.*\.(svg|png)|\.html)$/.test(url.pathname);
  if (!isCheckin) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
