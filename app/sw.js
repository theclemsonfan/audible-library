// Cache only the public shell. Private API responses and passwords are never cached.
const CACHE='next-chapter-shell-0.2.0';const ASSETS=['/','/style.css','/app.js','/model.js','/icon.svg','/manifest.webmanifest'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin||!ASSETS.includes(u.pathname))return;e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));});
