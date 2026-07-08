---
name: Vidorey Monitor — Real-Time SSE Dashboard
description: /monitor dan /health/detail: auth pattern, SSE architecture, virtual list rendering, ring buffer + REST pagination.
---

# Vidorey Monitor

## Overview

`/monitor` dan `/health/detail` adalah endpoint monitoring yang diproteksi, dijalankan oleh Replit backend. Firebase hanya serve file statis, tidak ada monitoring di sana.

---

## Auth Pattern — Form Login, Bukan 401

Semua protected endpoint tanpa `?key=` tampilkan form login (bukan 401 mentah). Submit → GET dengan `?key=` → bisa di-bookmark.

```js
function checkMonitorKey(req, res, action = '/monitor') { ... }
// return true jika OK, false + render form jika gagal
```

Routes yang diproteksi: `/monitor`, `/monitor/events`, `/monitor/log`, `/health/detail`.

---

## Buffer + Konstanta

```js
MON_BUF       = 50_000   // ring buffer monitorLog (oldest-first push)
CDN_ALERT_MAX = 500       // ring buffer cdnAlerts
SSE_HISTORY   = 200       // event dikirim ke client baru saat SSE connect
```

`totalEvents` = integer counter yang tidak berkurang saat ring buffer trim — dipakai untuk stat akurat.

**Why:** 50k event ≈ ~10MB RAM, sangat aman. Lag bukan dari storage, tapi dari DOM rendering (virtual list solusinya).

---

## Arsitektur: Virtual List Client

**Prinsip utama:** Data hidup di JS array (`allEvents[]`), bukan di DOM. Hanya baris yang terlihat di viewport yang menjadi DOM node.

```
allEvents[]        — newest at index 0; bisa puluhan ribu entry
renderedMap        — Map<rowIndex, DOMElement>; hanya visible rows
ROW_H = 35         — px per baris (fixed height 34px + 1px border)
OVER = 12          — overscan (baris extra di atas/bawah viewport)
```

### Render loop (requestAnimationFrame)
1. Set `vlist.style.height = allEvents.length * ROW_H`
2. Hitung `startIdx`/`endIdx` dari `scrollTop + clientHeight`
3. Hapus dari `renderedMap` yang keluar range → `removeChild`
4. Tambah ke `renderedMap` yang masuk range → `appendChild` via Fragment
5. Tidak pernah rebuild semua baris — hanya delta per scroll tick

### Live events (SSE `event:`)
- `allEvents.unshift(ev)` → semua index shift +1
- Update `el.style.top` semua elemen di `renderedMap` (+ROW_H)
- Update Map keys (+1)
- Jika `scrollTop < ROW_H*3`: scroll ke 0; else `scrollTop += ROW_H` (maintain posisi visual)

### History awal (SSE `event: history`)
- Server kirim `monitorLog.slice(-SSE_HISTORY).reverse()` (newest-first) + `totalEvents`
- Client init `allEvents`, reset stats, clear renderedMap, render

### Load older events (REST pagination)
- Trigger: scroll ke bawah dalam threshold `ROW_H * 8`
- Fetch: `GET /monitor/log?key=&before=<oldest.ts>&limit=200`
- Response: `{ events: oldest-first, hasMore: bool, total: int }`
- Client: `allEvents.push(...data.events)` (append ke end = lebih lama)
- Tidak ada index shift → renderedMap tetap valid

---

## Endpoints

| Route | Fungsi |
|---|---|
| `/monitor` | Dashboard HTML (virtual list) |
| `/monitor/events?key=` | SSE: `event: history` (initial) + `event: event` (live) |
| `/monitor/log?key=&before=<ts>&limit=<n>` | REST: event lama untuk pagination, max 500/req |
| `/health` | Public: `{status:'ok', ts}` |
| `/health/detail?key=` | JSON: cache stats, memory, uptime, CDN alerts, monitorLog stats |

---

## Tracking Middleware

| Badge | Trigger path |
|---|---|
| `stream` | `/proxy/stream/:id` |
| `video` | `/api/video/:id` |
| `folder` | `/api/folder/:id` |
| `rb_video` | `/api/rb/video/:slug` |
| `rb_posts` | `/api/rb/posts` |
| `yb_video` | `/api/yb/video/:slug` |
| `yb_posts` | `/api/yb/posts` |
| `bk_video` | `/api/bk/video/:slug` |
| `bk_posts` | `/api/bk/posts` |

IP dari `x-forwarded-for` header (first value), truncated karena Replit proxy.

---

## Yang Tidak Bisa Ditrack

Firebase page views (static CDN) tidak terlihat — pakai Firebase Analytics untuk itu.
