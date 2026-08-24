/* Keeps the app openable with no signal. The shell and the Firebase SDK are
 * precached, so you never get a blank screen in a parking garage at 11:50pm.
 * Live data still needs a connection.
 *
 * Two strategies, and the split matters:
 *
 *   App code (html, css, js, manifest)  ->  network first, cache as fallback.
 *     These change on every deploy. Serving them cache-first would strand an
 *     installed phone on an old build, which is exactly how you ship a config
 *     change that never arrives.
 *
 *   Icons, fonts, the pinned Firebase SDK  ->  cache first.
 *     These are effectively immutable, and they are the slow ones. */

const CACHE = "75hard-v2";
const SDK = "https://www.gstatic.com/firebasejs/11.10.0/";

const CODE = ["./", "index.html", "styles.css", "app.js", "core.js", "config.js", "manifest.webmanifest"];
const STATIC = [
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  SDK + "firebase-app.js",
  SDK + "firebase-auth.js",
  SDK + "firebase-database.js"
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One bad URL must not sink the whole install, so add them one at a time.
    await Promise.all([...CODE, ...STATIC].map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

const isCodePath = (url) =>
  url.pathname.endsWith("/") ||
  /\.(html|css|js|mjs|webmanifest)$/.test(url.pathname);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isSdk = req.url.startsWith(SDK);
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";

  // Everything else, above all the Firebase database and auth endpoints, goes
  // straight to the network. Cached auth or data would be stale and wrong.
  if (!sameOrigin && !isSdk && !isFont) return;

  const networkFirst = sameOrigin && isCodePath(url);

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);

    const fromNetwork = fetch(req).then((res) => {
      if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);

    if (networkFirst) {
      const fresh = await fromNetwork;
      if (fresh) return fresh;
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === "navigate") {
        const shell = await cache.match("index.html");
        if (shell) return shell;
      }
      return new Response("Offline", { status: 503, statusText: "Offline" });
    }

    // Cache first for the immutable assets, refreshing quietly behind it.
    const hit = await cache.match(req, { ignoreSearch: sameOrigin });
    if (hit) { fromNetwork; return hit; }
    const res = await fromNetwork;
    return res || new Response("Offline", { status: 503, statusText: "Offline" });
  })());
});
