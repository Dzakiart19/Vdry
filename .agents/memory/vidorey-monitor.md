---
name: Vidorey Monitor — Real-Time SSE Dashboard
description: /monitor dan /health/detail: auth pattern, event tracking, SSE architecture, dan unlimited buffer.
---

# Vidorey Monitor

## Overview

`/monitor` dan `/health/detail` adalah endpoint monitoring yang diproteksi, dijalankan oleh Replit backend (`server.js`). Tidak ada di Firebase — Firebase hanya serve file statis.

---

## Auth Pattern — Form Login, Bukan 401

**Rule:** Semua protected monitoring endpoint tanpa `?key=` menampilkan form login, bukan error mentah.

**Why:** User tidak selalu tahu harus append `?key=SESSION_SECRET`. Form login lebih user-friendly. Submit form → GET ke endpoint yang sama dengan `?key=`, sehingga URL bisa di-bookmark.

**How to apply:**
```js
// checkMonitorKey sekarang menerima parameter action (default '/monitor')
function checkMonitorKey(req, res, action = '/monitor') { ... }

// Di route handler:
app.get('/monitor',        (req, res) => { if (!checkMonitorKey(req, res)) return; ... });
app.get('/health/detail',  (req, res) => { if (!checkMonitorKey(req, res, '/health/detail')) return; ... });
```

- Key benar → handler dilanjutkan, return `true`
- Key salah → render form login dengan error, return `false`
- Auth key = `process.env.SESSION_SECRET` (via konstanta `MONITOR_KEY`)

---

## Endpoint yang Diproteksi

| Route | Fungsi |
|---|---|
| `/monitor` | Dashboard HTML real-time (SSE live feed) |
| `/monitor/events?key=` | SSE stream (`text/event-stream`) |
| `/health/detail?key=` | JSON: cache stats, memory, uptime, CDN alerts |

---

## SSE Event Architecture

```
monitorLog[]         — unlimited array di memory (tidak ada trim)
monitorSSE[]         — array active res objects (SSE clients)
pushMonitorEvent()   — append ke monitorLog, write ke semua SSE clients
```

On SSE connect (`/monitor/events?key=`):
1. Send full history sebagai `event: history` (JSON array)
2. Push `res` ke `monitorSSE[]`
3. Send `: ping` setiap 25 detik keepalive
4. On `req.close`, remove dari `monitorSSE[]`

Client JS mendengarkan dua event type:
- `history` — bulk load semua events saat pertama connect
- `event` — event baru di-push live

---

## Buffer — Unlimited

Semua buffer monitoring sudah diubah ke unlimited (tidak ada batas):
- `MON_BUF = Infinity` — `monitorLog` tidak pernah di-trim
- `CDN_ALERT_MAX = Infinity` — `cdnAlerts` tidak pernah di-trim
- `MAX_ROWS = Infinity` — baris di tabel live feed tidak pernah dihapus

**Trade-off:** Memory server naik seiring traffic. Restart server = semua data hilang (in-memory). Untuk persistent storage perlu database.

---

## Tracking Middleware

Fires sebelum route handlers (didaftarkan setelah `express.static`):

| Badge | Trigger |
|---|---|
| `stream` | `/proxy/stream/:id` (user menonton P1) |
| `video` | `/api/video/:id` (user buka player P1) |
| `folder` | `/api/folder/:id` (user browse folder P1) |
| `rb_video` | `/api/rb/video/:slug` (P2) |
| `rb_posts` | `/api/rb/posts` (P2) |
| `yb_video` | `/api/yb/video/:slug` (P3) |
| `yb_posts` | `/api/yb/posts` (P3) |
| `bk_video` | `/api/bk/video/:slug` (P4) |
| `bk_posts` | `/api/bk/posts` (P4) |

IP diekstrak dari `x-forwarded-for` (value pertama, trimmed) — penting karena Replit proxy semua request.

---

## /health/detail Response

```json
{
  "status": "ok",
  "uptime": "2h 15m 30s",
  "startedAt": "2026-07-08T00:00:00.000Z",
  "memory": { "rss": "120.5 MB", "heapUsed": "45.2 MB" },
  "caches": [
    { "name": "p1_videoUrl", "size": 12, "hits": 340, "misses": 12 },
    { "name": "p2_m3u8",     "size": 8,  "hits": 120, "misses": 8  },
    { "name": "p2_posts",    "size": 3,  "hits": 45,  "misses": 3  },
    { "name": "p2_freshSession", ... },
    { "name": "p3_m3u8",    ... },
    { "name": "p3_posts",   ... }
  ],
  "cdnAlerts": { "total": 3, "items": [...] }
}
```

---

## Dashboard UI

- Dark theme matching app (`#0d0d12` background, `#a78bfa` accent)
- Stats bar: Total Events · Streams · Video Opens · Unique IPs
- Event rows: time · colored badge · resource ID · IP (truncated)
- Tombol: **🔥 vidorey.web.app** dan **📊 Firebase Analytics**

---

## Yang Tidak Bisa Ditrack

Firebase serve file statis dari CDN — page views dan navigasi di `vidorey.web.app` yang tidak memanggil Replit backend tidak terlihat di monitor ini. Gunakan Firebase Analytics untuk page-view-level data.
