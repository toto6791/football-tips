// Пази файловете на приложението и последните прогнози, за да работи без интернет.
const CACHE = "f24-tips-v1";
const FILES = [
  "./", "./index.html", "./manifest.webmanifest", "./css/styles.css",
  "./js/config.js", "./js/utils.js", "./js/tip-text.js", "./js/data.js", "./js/render.js", "./js/app.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png",
  "./fonts/firasans-regular.woff2", "./fonts/firasans-medium.woff2",
  "./fonts/firasanscondensed-semibold.woff2", "./fonts/firasanscondensed-bold.woff2",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // Прогнозите, страницата и кодът: първо от интернет, иначе от кеша
  const fresh = req.mode === "navigate" || /\.(html|js|css|json)$/.test(url.pathname) || url.pathname.endsWith("/");
  if (fresh) {
    const key = url.pathname.endsWith("tips.json") ? "./tips.json" : req;
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(key, copy));
          }
          return res;
        })
        .catch(() => caches.match(key, { ignoreSearch: true }).then((hit) => hit || caches.match("./index.html"))),
    );
    return;
  }
  // Шрифтове и икони: от кеша
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
