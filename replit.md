# Vidorey — Dual-Platform Video Browser

Web app untuk browse dan nonton video dari dua platform terpisah.

## Stack
- **Backend**: Node.js + Express (proxy + HTML scraper) — `server.js`
- **Frontend**: Vanilla JS SPA (no framework), dua halaman terpisah
- **Port**: 5000

## Dua Platform (Completely Isolated)

| Platform | URL | Source | HTML | JS |
|---|---|---|---|---|
| Platform 1 | `/` | xpvid.cc | `index.html` | `app.js` |
| Platform 2 | `/rb` | ruangbokep.ws | `rb.html` | `rb.js` |

Navigasi antar platform via tombol di kanan atas topbar.

## Cara Kerja — Platform 1 (xpvid.cc)
1. `/api/folder/:id` → scrape subfolder & video list dari xpvid.cc
2. `/api/video/:id` → ambil direct MP4 URL dari `embed.php?bucket=vidoycdn&id=:id`
3. `/proxy/stream/:id` → stream video dengan Range support & Referer spoofing ke xpvid.cc
4. `/proxy/thumb?url=` → proxy thumbnail dari `i.xpvid.cc` (allowlist only)
5. `/embed/:id` → minimal HTML player page (tidak dipakai frontend, ada untuk fallback debug)

### CDN Allowlist (STREAM_HOSTS)
- `vidoycdn.b-cdn.net` — video reguler
- `cache.cdnvdy.com`
- `*.overfetch.video` — video DoodStream/Doodshare (subdomain variatif: cache, meiva, dll)

### Video Playback (cross-origin safe)
- `<video>` **tanpa** atribut `crossorigin` — browser load no-cors mode, bebas cross-origin tanpa CORS check
- `video.src` di-set **langsung** saat modal buka (tidak tunggu API title) → playback mulai secepat mungkin
- Fetch `/api/video/:id` jalan paralel di background hanya untuk update judul

## Cara Kerja — Platform 2 (ruangbokep.ws)
1. `/api/rb/categories` → fetch kategori via WordPress REST API
2. `/api/rb/posts` → scrape listing video (support pagination & kategori)
3. `/api/rb/video/:slug` → resolve iframe embed URL (putarvid/streamruby) → HLS
4. `/proxy/rb/thumb?url=` → proxy thumbnail dari ruangbokep.ws & streamruby

## Deployment
- **Replit (backend + dev frontend)**: server jalan di port 5000, URL `https://vidorey--lturner686.replit.app`
- **Firebase (production frontend)**: `vidorey.web.app` — host file statis dari `public/`
  - Deploy via: `bash deploy.sh` (hanya deploy Firebase, bukan Replit backend)
- `public/config.js` — `window.BACKEND_URL` hardcode ke `https://vidorey--lturner686.replit.app`
  - Replit dev: override ke `''` (relatif) berdasarkan hostname `.replit.app` / `.replit.dev` / `localhost`

## Monitor — Real-Time Visitor Dashboard

Route khusus di Replit backend, **tidak** ada di Firebase (Firebase hanya serve file statis).

| Route | Fungsi |
|---|---|
| `/monitor` | Dashboard HTML (SSE-based, live event feed) |
| `/monitor/events` | SSE stream (text/event-stream) |

### Auth
- Diproteksi dengan `SESSION_SECRET` env var sebagai key
- Buka `/monitor` tanpa `?key=` → tampil form login (input password)
- Submit form → redirect ke `/monitor?key=...` — bisa di-bookmark
- Key salah → pesan error di form, bukan 401 polos

### Event Types yang Ditrack
| Badge | Trigger |
|---|---|
| `stream` | `/proxy/stream/:id` dipanggil (user menonton) |
| `video` | `/api/video/:id` dipanggil (user buka player) |
| `folder` | `/api/folder/:id` dipanggil (user browse folder) |
| `rb_video` | `/api/rb/video/:slug` dipanggil |
| `rb_posts` | `/api/rb/posts` dipanggil |

### Implementasi
- Buffer di memory: 500 event terakhir (`monitorLog` array)
- SSE: koneksi terbuka push event realtime; history dikirim sekali saat connect
- Keepalive ping setiap 25 detik agar koneksi tidak di-drop
- Dua tombol di dashboard: **🔥 vidorey.web.app** dan **📊 Firebase Analytics** (→ analytics.google.com)

## User Preferences
- Dark theme (Obsidian Archive design system)
- Bahasa Indonesia untuk UI
- Setiap platform harus terisolasi penuh — tidak boleh ada data/logic yang bocor antar platform
