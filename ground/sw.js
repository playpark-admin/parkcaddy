const CACHE = "parkcaddy-ground-v2-1",
  SHELL = [
    "./",
    "./index.html",
    "./styles.css",
    "./app.mjs",
    "./physics.mjs",
    "./storage.mjs",
    "./cloud.mjs",
    "./firebase-config.js",
    "./icon.svg",
    "./manifest.webmanifest",
  ];
self.addEventListener("install", (e) =>
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))),
);
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("parkcaddy-ground-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (
    e.request.method !== "GET" ||
    u.origin !== self.location.origin ||
    u.pathname.startsWith("/__/")
  )
    return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (
          r.ok &&
          SHELL.some((p) => new URL(p, self.location).pathname === u.pathname)
        ) {
          const copy = r.clone();
          e.waitUntil(caches.open(CACHE).then((c) => c.put(e.request, copy)));
        }
        return r;
      })
      .catch(() =>
        caches
          .match(e.request)
          .then(
            (r) =>
              r ||
              (e.request.mode === "navigate"
                ? caches.match("./index.html")
                : Response.error()),
          ),
      ),
  );
});
