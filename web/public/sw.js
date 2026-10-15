// Offline shell for the hosted app. Pages open from cache when there is no network, so a worker can
// still fill in a day and have it saved on the phone (see src/queue.ts). Arkiv data itself is never
// cached here: reads go to the network, and the server functions under api/ are left alone.
const CACHE = "nexora-shell-v1";
const SHELL = ["./", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/api/")) return;

  if (request.mode === "navigate") {
    // Network first, so a new deploy shows at once; the cached page only when offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put("./", copy));
          }
          return response;
        })
        .catch(() => caches.match("./").then((cached) => cached ?? Response.error())),
    );
    return;
  }

  // Built assets have content hashes in their names, so a cached copy is always the right one.
  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
      if (response.ok && url.pathname.includes("/assets/")) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })),
  );
});
