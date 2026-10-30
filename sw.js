/* 离线缓存：联网时优先取最新文件，断网时用缓存。每次改版请同步修改下面的 VERSION。 */
var VERSION = '1.0.0';
var CACHE = 'wmcam-' + VERSION;
var FILES = ['./', 'index.html', 'style.css', 'diag.js', 'region-data.js', 'wm.js', 'util.js', 'app.js',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(FILES.map(function (f) { return c.add(f).catch(function () { /* 单个失败不影响安装 */ }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(new Promise(function (resolve) {
    var done = false;
    function fromCache() { return caches.match(req, { ignoreSearch: true }).then(function (r) { return r || caches.match('index.html'); }); }
    var timer = setTimeout(function () { // 网络太慢(3秒)就先用缓存
      fromCache().then(function (r) { if (r && !done) { done = true; resolve(r); } });
    }, 3000);
    fetch(req).then(function (res) {
      clearTimeout(timer);
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      if (!done) { done = true; resolve(res); }
    }).catch(function () {
      clearTimeout(timer);
      fromCache().then(function (r) { if (!done) { done = true; resolve(r || Response.error()); } });
    });
  }));
});
