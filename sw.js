// Offline support. Network first (revalidating the HTTP cache), so a deploy shows up on
// the next load when online; the cache is the fallback when offline. Bump VERSION when the file list changes.

const VERSION = "v2";
const CACHE = `site-editor-${VERSION}`;
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/editor.css",
  "js/app.js",
  "js/csv.js",
  "js/fields.js",
  "js/profiles.js",
  "js/store.js",
  "img/logo.svg",
  "img/favicon.svg",
  "img/favicon-32.png",
  "img/apple-touch-icon.png",
  "img/icon-192.png",
  "img/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("site-editor-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html"))),
  );
});
