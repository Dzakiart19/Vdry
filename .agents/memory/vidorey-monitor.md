---
name: Vidorey Monitor — Real-Time SSE Dashboard
description: /monitor dan /health/detail: auth pattern, event tracking, SSE architecture, dan ring buffer limits (bukan unlimited lagi).
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
function checkMonitorKey(req, res, action = '/monitor') { ... }

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

## Buffer — Ring Buffer (BUKAN unlimited)

Buffer sekarang dibatasi supaya `/monitor` tidak lag di puluhan ribu event:

```js
MON_BUF       = 2000   // max event tersimpan di monitorLog (ring buffer)
CDN_ALERT_MAX = 200    // max CDN alert tersimpan
SSE_HISTORY   = 300    // max event dikirim ke client baru saat connect
MAX_ROWS      = 300    // max baris DOM di dashboard (trim oldest)
```

`totalEvents` adalah counter integer terpisah yang selalu naik — tidak berkurang saat ring buffer trim. Dipakai untuk stat "Total Events" yang akurat di dashboard.

**Why:** Dengan unlimited buffer, puluhan ribu event menyebabkan:
1. RAM server terus naik
2. Saat SSE connect baru, seluruh history dikirim sekaligus → browser freeze
3. DOM feed menumpuk ribuan node → render lag

**How to apply:** Jangan kembalikan ke unlimited tanpa alasan eksplisit.

---

## SSE Event Architecture

```
monitorLog[]         — ring buffer, max MON_BUF entries
totalEvents          — integer counter, tidak berkurang
monitorSSE[]         — array active res objects (SSE clients)
pushMonitorEvent()   — push ke ring buffer, trim jika > MON_BUF, write ke SSE clients
```

On SSE connect (`/monitor/events?key=`):
1. Kirim `monitorLog.slice(-SSE_HISTORY).reverse()` sebagai `event: history` + `totalEvents`
2. Push `res` ke `monitorSSE[]`
3. Send `: ping` setiap 25 detik keepalive
4. On `req.close`, remove dari `monitorSSE[]`

Client JS mendengarkan dua event type:
- `history` — bulk load (max SSE_HISTORY events), render via DocumentFragment (satu reflow)
- `event` — event live baru di-push satu per satu dengan animasi

**Client DOM trim:** setiap `prepend` live event, cek `feed.children.length > MAX_ROWS` → `removeChild(lastChild)`.

**History tidak animate:** row dari `event: history` tidak pakai class `.live` supaya tidak ada 300 animasi sekaligus saat load.

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
  "caches": [ ... ],
  "cdnAlerts": { "total": 3, "items": [...] }
}
```

---

## Dashboard UI

- Dark theme matching app (`#0d0d12` background, `#a78bfa` accent)
- Stats bar: Total Events (akurat via `totalEvents`) · Streams · Video Opens · Unique IPs
- Event rows: time · colored badge · resource ID · IP (truncated)
- Hint text di bawah feed: "Menampilkan N event terbaru dari total X event sejak server start"
- Tombol: **🔥 vidorey.web.app** dan **📊 Firebase Analytics**

---

## Yang Tidak Bisa Ditrack

Firebase serve file statis dari CDN — page views dan navigasi di `vidorey.web.app` yang tidak memanggil Replit backend tidak terlihat di monitor ini. Gunakan Firebase Analytics untuk page-view-level data.
