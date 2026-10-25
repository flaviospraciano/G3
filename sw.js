// Service worker do G3: funcionamento offline e notificações.
const CACHE = "g3-v18";
const ARQUIVOS = ["./","index.html","config.js","g3-app-v1.webmanifest","g3-logo.png","g3-logo-flat.png","g3-logo-white.png","g3-icon-192.png","g3-icon-512.png","g3-maskable-512.png","g3-apple-touch.png"];
try {
  importScripts("config.js");
  if (self.G3_CONFIG && self.G3_CONFIG.vapidKey && !/COLE/.test(self.G3_CONFIG.firebase.apiKey)) {
    importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js", "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
    firebase.initializeApp(self.G3_CONFIG.firebase); firebase.messaging();
  }
} catch (e) {}
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("notificationclick", e => { e.notification.close(); e.waitUntil(self.clients.matchAll({type: "window"}).then(l => l.length ? l[0].focus() : self.clients.openWindow("./"))); });
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.searchParams.has("t") || u.hostname.endsWith("googleapis.com")) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req, {cache: "no-cache"}).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put("index.html", c)); return r; }).catch(() => caches.match("index.html")));
    return;
  }
  if (u.origin === location.origin && u.pathname.endsWith("config.js")) {
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); return r; }).catch(() => caches.match(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req).then(resp => {
    if (resp.ok && (u.origin === location.origin || u.hostname === "www.gstatic.com" || u.hostname === "cdnjs.cloudflare.com" || u.hostname === "cdn.jsdelivr.net")) { const c = resp.clone(); caches.open(CACHE).then(x => x.put(req, c)); }
    return resp;
  })));
});
