---
name: Vidorey Monitor — Real-Time SSE Dashboard
description: /monitor dan /health/detail: auth pattern, SSE architecture, virtual list rendering, ring buffer + REST pagination, Histats counter.
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

## SSE — Koyeb Proxy Fix (wajib dipertahankan)

Koyeb (dan proxy non-Nginx seperti Caddy) buffer SSE response sehingga `onopen`
di browser tidak pernah fired — monitor stuck di "Connecting..." selamanya.

**Fix yang sudah diterapkan di `/monitor/events`:**

```js
res.setHeader('X-Accel-Buffering', 'no');   // nginx
res.setHeader('X-Pad', 'avoid browser bug'); // legacy flush trigger
res.flushHeaders();
res.write(': ok\n\n');  // ← WAJIB: paksa proxy flush headers segera ke browser
```

**Keepalive interval: 15 detik** (bukan 25) — Koyeb timeout proxy biasanya 30s,
25s terlalu dekat batasnya dan berisiko drop.

**Why:** `X-Accel-Buffering: no` hanya dikenal Nginx. Koyeb pakai proxy sendiri
yang mengabaikan header itu. Satu-satunya cara paksa flush adalah kirim data
nyata (`: ok\n\n`) sebelum server punya event untuk dikirim.

**Jangan hapus** `: ok\n\n` atau ubah interval >20s — monitor akan kembali
stuck "Connecting..." di Koyeb deployment.

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

| Badge | Trigger path | CSS color (background → text) |
|---|---|---|
| `stream` | `/proxy/stream/:id` | — |
| `video` | `/api/video/:id` | — |
| `folder` | `/api/folder/:id` | — |
| `rb_video` | `/api/rb/video/:slug` | — |
| `rb_posts` | `/api/rb/posts` | — |
| `yb_video` | `/api/yb/video/:slug` | — |
| `yb_posts` | `/api/yb/posts` | — |
| `bk_video` | `/api/bk/video/:slug` | `#1c2a3a` → `#38bdf8` |
| `bk_posts` | `/api/bk/posts` | `#1c2a3a` → `#38bdf8` |
| `tp_video` | `/api/tp/video/:slug` | `#3a0a1a` → `#e91e8c` |
| `tp_posts` | `/api/tp/posts` | `#3a0a1a` → `#ff4d6d` |

IP dari `x-forwarded-for` header (first value), truncated karena Replit proxy.

---

## Histats Counter di Monitor Page

Counter muncul di strip tipis antara stat boxes dan log list (`#histats_wrap`).

### Implementasi saat ini
```html
<div id="histats_wrap">
  <!-- JS counter — hanya render di domain terdaftar Histats -->
  <div id="histats_counter"></div>
  <!-- Fallback link langsung ke halaman statistik -->
  <a href="https://www.histats.com/viewstats/?sid=5040431&act=2" target="_blank">
    📊 Lihat Statistik Histats
  </a>
</div>

<!-- Tracking script di bawah body -->
<script>
  var _Hasync = _Hasync || [];
  _Hasync.push(['Histats.start', '1,5040431,4,5,172,25,00011111']);
  _Hasync.push(['Histats.fasi', '1']);
  _Hasync.push(['Histats.track_hits', '']);
  // Histats.framed_page TIDAK dipakai — menyebabkan counter tidak render
  ...
</script>
```

### Kenapa counter JS tidak muncul di dev URL
Histats JS (`js15_as.js`) memvalidasi domain sebelum render counter widget.
URL `*.pike.replit.dev` (Replit dev) bukan domain terdaftar → counter tidak render.
URL `vidorey.web.app` (deployed) = domain terdaftar → counter muncul.
Ini perilaku normal Histats, bukan bug. Link fallback "Lihat Statistik" selalu bisa diklik.

### CSP yang dibutuhkan Histats
- `scriptSrc`: `https://s10.histats.com`
- `connectSrc`: `https://s10.histats.com`, `https://sstatic1.histats.com`, `https://histats.com`, `https://www.histats.com`
- `imgSrc`: `https:` (wildcard sudah cukup, covers `sstatic1.histats.com`)

Jika `www.histats.com` absen dari `connectSrc`, counter JS tidak bisa fetch data dan tidak render — meski script-nya sendiri load sukses.

### Yang TIDAK boleh dilakukan
- `_Hasync.push(['Histats.framed_page', ''])` — bikin Histats anggap halaman dalam iframe, counter tidak render
- Pakai `0.gif` sebagai counter visual — `0.gif` adalah tracking pixel transparan 1×1, bukan counter badge

---

## Yang Tidak Bisa Ditrack

Firebase page views (static CDN) tidak terlihat — pakai Firebase Analytics untuk itu.
