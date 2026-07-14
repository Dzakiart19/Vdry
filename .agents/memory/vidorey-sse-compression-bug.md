---
name: SSE vs Compression Middleware
description: Global compression() middleware mematikan SSE stream — cara fix dan lokasi bug
---

## Problem
`app.use(compression())` dipasang secara global menyebabkan `/monitor/events` (SSE) stuck di "Connecting…". Middleware `compression` mem-buffer semua `res.write()` sambil menunggu data cukup untuk dikompresi → chunk SSE tidak pernah sampai ke browser → `EventSource.onopen` tidak pernah fired.

## Fix (diterapkan 2026-07-14)

**server.js** — gunakan filter, bukan `app.use(compression())` mentah:
```js
app.use(compression({
  filter: (req, res) => {
    if (req.path === '/monitor/events') return false;
    return compression.filter(req, res);
  }
}));
```

**lib/monitor.js** — tambah di SSE handler setelah `flushHeaders()`:
```js
if (res.socket) res.socket.setNoDelay(true); // disable Nagle's algorithm
res.write(': ok\n\n');
if (typeof res.flush === 'function') res.flush(); // drain compression buffer (safety)
```
Dan `res.flush()` setelah setiap `res.write()` berikutnya (history event, keepalive ping).

**Why:** `compression` middleware menambahkan layer `Transform` stream di atas `res`. Semua `res.write()` masuk ke compressor buffer. `res.flush()` (metode yang ditambahkan oleh `compression`) adalah satu-satunya cara untuk drain buffer ini tanpa menutup stream. Tanpa filter, SSE tidak bisa real-time sama sekali.

**How to apply:** Setiap kali ada route SSE baru, tambahkan `req.path === '/your-sse-route'` ke dalam filter fungsi compression di server.js. Jangan pernah mengandalkan `res.flushHeaders()` atau `X-Accel-Buffering` saja — compression middleware butuh filter eksplisit.
