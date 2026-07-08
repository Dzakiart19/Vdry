# Vidorey — Tri-Platform Video Browser

Web app untuk browse dan nonton video dari tiga platform terpisah.

## Stack
- **Backend**: Node.js + Express (proxy + HTML scraper) — `server.js`
- **Frontend**: Vanilla JS SPA (no framework), tiga halaman terpisah
- **Port**: 5000

## Tiga Platform (Completely Isolated)

| Platform | URL | Source | HTML | JS |
|---|---|---|---|---|
| Platform 1 | `/` | xpvid.cc | `index.html` | `app.js` |
| Platform 2 | `/rb` | ruangbokep.ws | `rb.html` | `rb.js` |
| Platform 3 | `/yb` | yobokep.com | `yb.html` | `yb.js` |

Navigasi antar platform via dropdown di kanan atas topbar.

## Cara Kerja — Platform 1 (xpvid.cc)
1. `/api/folder/:id` → scrape subfolder & video list dari xpvid.cc
2. `/api/video/:id` → ambil direct MP4 URL dari `embed.php?bucket=vidoycdn&id=:id`
3. `/proxy/stream/:id` → stream video dengan Range support & Referer spoofing ke xpvid.cc
4. `/proxy/thumb?url=` → proxy thumbnail dari `i.xpvid.cc` (allowlist only)
5. `/embed/:id` → minimal HTML player page (same-origin iframe, menghindari cross-origin video issue)

### CDN Allowlist (STREAM_HOSTS)
- `vidoycdn.b-cdn.net` — video reguler
- `cache.cdnvdy.com`
- `*.overfetch.video` — video DoodStream/Doodshare (subdomain variatif)

### Video Playback (cross-origin safe)
- `<video>` **tanpa** atribut `crossorigin` — browser load no-cors mode, bebas cross-origin tanpa CORS check
- `video.src` di-set **langsung** saat modal buka (tidak tunggu API title) → playback mulai secepat mungkin
- Fetch `/api/video/:id` jalan paralel di background hanya untuk update judul

## Cara Kerja — Platform 2 (ruangbokep.ws)
1. `/api/rb/categories` → fetch kategori via WordPress REST API
2. `/api/rb/posts` → scrape listing HTML (`article.loop-video[data-main-thumb]`) — support pagination & kategori
3. `/api/rb/video/:slug` → resolve iframe embed URL (putarvid/streamruby) → HLS via PackerJS decode
4. `/proxy/rb/hls/:slug` → proxy master m3u8, rewrite semua URL ke `/proxy/rb/seg`
5. `/proxy/rb/seg` → proxy segment/sub-manifest; self-healing saat CDN 403 via `handleRbSeg` + `reresolveUrl`
6. `/proxy/rb/thumb?url=` → proxy thumbnail (validasi `content-type: image/*`)

## Cara Kerja — Platform 3 (yobokep.com)
1. `/api/yb/posts` → WP REST API untuk slug + title + totalPages; parallel-fetch `og:image` dari tiap post untuk thumbnail (cache 24 jam)
2. `/api/yb/video/:slug` → scrape post page → resolve embed (bysezejataos.com atau streamhls.to) → HLS URL
3. `/proxy/yb/hls/:slug` → proxy master m3u8, rewrite semua URL ke `/proxy/yb/seg`
4. `/proxy/yb/seg` → proxy segment/sub-manifest; self-healing saat CDN 403 via `handleYbSeg` + `reresolveYbUrl`
5. `/proxy/yb/thumb?url=` → proxy thumbnail (validasi `content-type: image/*`)

### Kenapa WP REST API untuk P3 (bukan HTML scrape seperti P2)
yobokep.com HTML listing page selalu mengembalikan 24 post yang sama di semua `/page/N/` — server-side pagination tidak berjalan (butuh JS/AJAX dari browser). WP REST API paginasinya benar via `x-wp-totalpages` header.

### CDN Allowlist P3 (isAllowedYbCdnUrl)
- `*.r66nv9ed.com` — bysezejataos CDN (SprintCDN), tidak IP-locked
- `*.owphbf24.com` — SprintCDN edge nodes geografis (moscow, frankfurt, dll)
- `*.savefiles.com` + `savefiles.com` — streamhls.to CDN, token `i=` dikunci ke IP

## Deployment
- **Replit (backend + dev frontend)**: server jalan di port 5000, URL `https://vidorey--lturner686.replit.app`
- **Firebase (production frontend)**: `vidorey.web.app` — host file statis dari `public/`
  - Deploy via: `bash deploy.sh` (hanya deploy Firebase, bukan Replit backend)
- `public/config.js` — `window.BACKEND_URL` hardcode ke `https://vidorey--lturner686.replit.app`
  - Replit dev: override ke `''` (relatif) berdasarkan hostname `.replit.app` / `.replit.dev` / `localhost`
  - **Wajib update** sebelum `firebase deploy` jika URL Replit berubah

## Monitor & Health — Protected Endpoints

Semua endpoint monitoring diproteksi dengan `SESSION_SECRET` env var sebagai key. Akses tanpa key → form login HTML. Akses dengan key benar → konten.

| Route | Fungsi |
|---|---|
| `/monitor` | Dashboard HTML real-time (SSE-based) |
| `/monitor/events` | SSE stream (text/event-stream) |
| `/health/detail` | JSON: cache stats, memory, uptime, CDN alerts |

### Auth
- Diproteksi dengan `SESSION_SECRET` env var sebagai key
- Buka endpoint tanpa `?key=` → tampil form login (input password)
- Submit form → redirect ke endpoint yang sama dengan `?key=...` — bisa di-bookmark
- Key salah → pesan error di form

### Event Types yang Ditrack
| Badge | Trigger |
|---|---|
| `stream` | `/proxy/stream/:id` dipanggil (user menonton P1) |
| `video` | `/api/video/:id` dipanggil (user buka player P1) |
| `folder` | `/api/folder/:id` dipanggil (user browse folder P1) |
| `rb_video` | `/api/rb/video/:slug` dipanggil (P2) |
| `rb_posts` | `/api/rb/posts` dipanggil (P2) |
| `yb_video` | `/api/yb/video/:slug` dipanggil (P3) |
| `yb_posts` | `/api/yb/posts` dipanggil (P3) |

### Implementasi Monitor
- Buffer di memory: **unlimited** — semua events tersimpan (tidak ada trim)
- CDN alerts: **unlimited** — semua alert tersimpan
- SSE: koneksi terbuka push event realtime; history dikirim sekali saat connect
- Keepalive ping setiap 25 detik agar koneksi tidak di-drop

## User Preferences
- Dark theme (Obsidian Archive design system)
- Bahasa Indonesia untuk UI
- Setiap platform harus terisolasi penuh — tidak boleh ada data/logic yang bocor antar platform
- Tidak ada nama sumber asli (xpvid.cc, ruangbokep.ws, yobokep.com) yang ditampilkan ke user di frontend
