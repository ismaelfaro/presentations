// Service worker de todo el sitio (portada, reproductor y charlas): una vez abierta, una charla funciona
// sin conexión (útil con la wifi de un auditorio). Está en la raíz para controlar también el worker del
// motor (player/engine/worker.js). Los modelos (.cact) no pasan por aquí: los guarda ese worker en su caché.
const CACHE = "voz-v3";
const SHELL = [
  "./", "index.html", "talks.json",
  "player/style.css", "player/app.js", "player/agent.js",
  "player/engine/worker.js", "player/engine/needle.js", "player/engine/needle.wasm",
  "player/icon.svg", "player/icon-180.png", "player/icon-192.png", "player/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // Cada charla (index, talk.json, slides.json, imágenes) se guarda al abrirla: el reproductor precarga sus slides.
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("voz-v") && k !== CACHE) await caches.delete(k);   // versiones viejas
    await self.clients.claim();
  })());
});

// El reproductor pide guardar su charla entera (página, talk.json, notas, imágenes) para usarla sin conexión.
self.addEventListener("message", (e) => {
  if (e.data?.type !== "cache-talk") return;
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(e.data.urls.map((u) => c.add(u).catch(() => {})))));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.endsWith(".cact")) return;                       // modelos: los gestiona el worker
  const sameOrigin = url.origin === location.origin;
  const isAsset = /\.(jpe?g|png|svg|wasm|woff2?)$/.test(url.pathname) || url.host.includes("fonts.");
  if (!sameOrigin && !isAsset) return;
  // Código y datos: red primero (así se ven los cambios), caché si no hay red.
  // Imágenes, fuentes y wasm: caché primero y se refresca en segundo plano.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: sameOrigin });
    const network = fetch(req).then((res) => {
      if (res.ok || res.type === "opaque") cache.put(req, res.clone());
      return res;
    });
    if (isAsset && cached) { network.catch(() => {}); return cached; }
    if (!cached) return network;
    // wifi lenta: si la red tarda más de 2,5 s, se sirve la copia guardada
    const slow = new Promise((r) => setTimeout(() => r(cached), 2500));
    try { return await Promise.race([network, slow]); } catch { return cached; }
  })());
});
