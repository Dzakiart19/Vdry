# Vidorey — Quad-Platform Video Browser

Web app untuk browse dan nonton video dari empat platform terpisah.

## Stack
- **Backend**: Node.js + Express (proxy + HTML scraper), modular — lihat struktur di bawah
- **Frontend**: Vanilla JS SPA (no framework), empat halaman terpisah
- **Port**: 5000

## Struktur Backend
`server.js` (composition root, ~150 baris) hanya merakit: security middleware (Helmet + CSP, CORS, rate limit) → static → monitor tracking → mount 4 router platform → monitor/health routes → SPA fallback.

```
server.js                 ← composition root (helmet/CSP, CORS, rate limit, mount routers, listen)
lib/
  cache.js                ← makeCache() factory generik (dipakai semua platform, instance terpisah per platform)
  proxy.js                ← UA string, apiError(), axios instances (ax/axNoRedirect), resolveUrl(), basenameNoQuery()
  monitor.js              ← MONITOR_KEY, monitorLog, cdnAlerts, trackRequest, checkMonitorKey, registerMonitorRoutes (/health, /health/detail, /monitor, /monitor/events)
  scrapers/
    p1.js                 ← xpvid.cc: folder/video API, stream+thumb proxy, /embed/:id
    rb.js                 ← ruangbokep.ws: PackerJS decode, self-healing CDN token, HLS proxy, /rb SPA route
    yb.js                 ← yobokep.com: dual embed provider (bysezejataos AES-256-GCM + streamhls.to), HLS proxy, /yb SPA route
    bk.js                 ← bokepking.cam: WP REST API listing, direct MP4 proxy, /bk SPA route
```

Tiap modul `lib/scrapers/*.js` export `{ router, caches }` — `caches` dipakai `server.js` untuk agregasi `getCacheStats()` di `/health/detail`. **Tidak ada cross-import antar `p1.js`/`rb.js`/`yb.js`/`bk.js`** — hanya `lib/cache.js` dan `lib/proxy.js` yang generik/stateless di-share.

## Empat Platform (Completely Isolated)

| Platform | URL | Source | HTML | JS |
|---|---|---|---|---|
| Platform 1 | `/` | xpvid.cc | `index.html` | `app.js` |
| Platform 2 | `/rb` | ruangbokep.ws | `rb.html` | `rb.js` |
| Platform 3 | `/yb` | yobokep.com | `yb.html` | `yb.js` |
| Platform 4 | `/bk` | bokepking.cam | `bk.html` | `bk.js` |

Navigasi antar platform via **sidebar drawer** — tombol hamburger ≡ di kiri topbar membuka panel geser dari kiri (seperti ChatGPT). Menampilkan Vidorey 1 / 2 / 3 / 4 dengan highlight platform aktif. Tutup dengan tombol ✕, klik backdrop, atau Esc.

## Iklan (Adsterra)
Tiga jenis slot iklan dipakai, semuanya identik di `index.html`/`rb.html`/`yb.html`/`bk.html`:
1. **Native banner** (`.ad-native-slot`, di bawah grid listing) — key `761a1a8645cd2263043bfeb6f2e87eea`, invoke.js dari `pl28423230.effectivecpmnetwork.com`. Punya container `id` tetap (`container-<key>`) yang di-hardcode oleh jaringan iklan — **jangan diduplikasi di halaman yang sama** (duplicate `id` bikin script hanya render ke elemen pertama).
2. **Display banner 300×250** (`.ad-display-slot` di listing, `.watch-ad-slot` di watch view) — pola `atOptions` + invoke.js dari `highperformanceformat.com`, **aman diduplikasi** berkali-kali di halaman yang sama karena scriptnya `document.write` langsung di lokasi tag, tidak butuh id unik (deklarasi `atOptions` di-reset tepat sebelum tiap invoke.js dipanggil).
3. **Popunder + Social Bar** (di akhir `<body>`, sekali per halaman) — dua script dari `effectivecpmnetwork.com` (`pl28418540`, `pl28427857`), sengaja tidak dipakai di watch view karena bersifat mengganggu (buka tab baru / overlay mengambang).

Semua domain iklan sudah masuk allowlist `script-src` di CSP (`server.js`) — kalau nambah jaringan iklan baru, domain barunya wajib ditambah eksplisit (CSP tidak pakai wildcard `https:`).

### Struktur Nav Drawer (sama di keempat HTML)
- `.nav-burger` (id `navBurger`) — tombol hamburger di dalam `.brand` di topbar
- `div.nav-overlay` (id `navOverlay`) — backdrop gelap, z-index 149
- `nav.nav-drawer` (id `navDrawer`) — panel slide-in, z-index 150
- `.nav-drawer-head` + `.nav-drawer-close` (id `navClose`) — header drawer
- `.nav-plat-item` + `.nav-plat-item.active` — item platform; avatar selalu `<img src="/logo.png">` (logo Vidorey sama untuk semua platform, konsisten dengan topbar)

**ID lama yang sudah dihapus:** `platformSwitcher`, `psTrigger`, `psMenu` — tidak ada lagi di HTML manapun. CSS `.ps-trigger`, `.ps-menu`, `.ps-chevron` di style.css adalah dead code (tidak membahayakan, tapi tidak dipakai).

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
3. `/api/rb/video/:slug` → resolve iframe embed URL (putarvid/streamruby) → HLS via PackerJS decode; response juga membawa `description` (og:description) dan `related` (array video terkait, discrape dari widget "Related videos" di halaman post itu sendiri)
4. `/proxy/rb/hls/:slug` → proxy master m3u8, rewrite semua URL ke `/proxy/rb/seg`
5. `/proxy/rb/seg` → proxy segment/sub-manifest; self-healing saat CDN 403 via `handleRbSeg` + `reresolveUrl`
6. `/proxy/rb/thumb?url=` → proxy thumbnail (validasi `content-type: image/*`)
7. `/rb/watch/:slug` → SPA route (sama seperti `/rb`, serve `rb.html`) — dipakai sebagai deep-link/share URL, langsung membuka watch view video tsb saat diakses

### Watch View P2 (gaya YouTube/XNXX)
Klik video membuka modal watch view (scrollable, **bukan** full-screen — desain sengaja): player di atas, lalu judul + deskripsi (gaya YouTube), lalu grid "Video Lainnya" + pagination client-side 8/halaman (gaya XNXX, dari `related` yang di-scrape). Tombol **Bagikan** di sebelah judul memakai `navigator.share()` (fallback copy-to-clipboard) dengan link `/rb/watch/<slug>` yang deep-link langsung ke video itu. URL address bar mengikuti video yang sedang tampil (`/rb/watch/<slug>`) via history API — lihat `openModal()`/popstate handler di `rb.js` untuk mekanisme back/forward yang harus tetap konsisten. Pola ini jadi acuan saat direplikasi ke P3/P4.

Di bawah grid "Video Lainnya" (paling bawah watch view, dipisah garis) ada satu slot iklan kecil (`.watch-ad-slot`, banner iframe 300×250 dari `highperformanceformat.com` — domain sama dengan display ad yang sudah dipakai di listing, jadi tidak perlu tambahan allowlist CSP). Sengaja dipilih ad ini (bukan popunder/social bar) karena tidak membuka tab baru atau menutupi konten — hanya satu blok statis di posisi paling akhir, jadi tidak mengganggu nonton video atau baca related videos. Identik di P2/P3/P4.

## Cara Kerja — Platform 3 (yobokep.com)
1. `/api/yb/posts` → WP REST API untuk slug + title + totalPages; parallel-fetch `og:image` dari tiap post untuk thumbnail (cache 24 jam)
2. `/api/yb/video/:slug` → scrape post page → resolve embed (bysezejataos.com atau streamhls.to) → HLS URL; response juga membawa `description` (og:description) dan `related` (di-scrape dari widget "Related videos" — `.under-video-block` dengan heading persis "Related videos", isi `article.loop-video[data-main-thumb]`, markup mirip P2)
3. `/proxy/yb/hls/:slug` → proxy master m3u8, rewrite semua URL ke `/proxy/yb/seg`
4. `/proxy/yb/seg` → proxy segment/sub-manifest; self-healing saat CDN 403 via `handleYbSeg` + `reresolveYbUrl`
5. `/proxy/yb/thumb?url=` → proxy thumbnail (validasi `content-type: image/*`)
6. `/yb/watch/:slug` → SPA route (sama seperti `/yb`, serve `yb.html`) — deep-link/share URL, buka watch view video tsb saat diakses

### Watch View P3 (sama seperti P2)
Pola watch view (player + judul/deskripsi + grid "Video Lainnya" + tombol Bagikan + slot iklan kecil di bawah, deep-link `/yb/watch/<slug>`) direplikasi identik dari P2 — lihat "Watch View P2" di atas untuk detail UX, mekanisme history/popstate, dan penempatan iklan.

### Kenapa WP REST API untuk P3 (bukan HTML scrape seperti P2)
yobokep.com HTML listing page selalu mengembalikan 24 post yang sama di semua `/page/N/` — server-side pagination tidak berjalan (butuh JS/AJAX dari browser). WP REST API paginasinya benar via `x-wp-totalpages` header.

### CDN Allowlist P3 (isAllowedYbCdnUrl)
- `*.r66nv9ed.com` — bysezejataos CDN (SprintCDN), tidak IP-locked
- `*.owphbf24.com` — SprintCDN edge nodes geografis (moscow, frankfurt, dll)
- `*.savefiles.com` + `savefiles.com` — streamhls.to CDN, token `i=` dikunci ke IP

## Cara Kerja — Platform 4 (bokepking.cam)
1. `/api/bk/posts?p=N&q=query` → WP REST API bypass (`/?rest_route=/wp/v2/posts`) untuk listing + pagination; parallel-fetch thumbnail dari `/wp/v2/media/:id` (cache 24 jam)
2. `/api/bk/video/:slug` → scrape post HTML → extract `<meta itemprop="contentURL" content="...mp4">` atau `<source type="video/mp4">` → MP4 URL langsung (tidak pakai HLS); response juga membawa `description` (meta og:description/itemprop/name description, urutan fallback) dan `related` (di-scrape dari `.under-video-block > .videos-list > article[id]` — satu-satunya blok di halaman, tanpa heading pembeda; thumbnail asli ada di `img[data-src]`, bukan `src`, karena lazy-loaded)
3. `/proxy/bk/stream/:slug` → proxy MP4 ke `vdn.bokepking.cam` dengan Range support; evict cache & retry sekali jika CDN 403/404
4. `/proxy/bk/thumb?url=` → proxy thumbnail (allowlist `vdn.bokepking.cam` only, validasi `content-type: image/*`)
5. `/bk/watch/:slug` → SPA route (sama seperti `/bk`, serve `bk.html`) — deep-link/share URL, buka watch view video tsb saat diakses

### Watch View P4 (sama seperti P2, player MP4 langsung tanpa iframe)
Pola watch view direplikasi dari P2/P3 — player (elemen `<video>` MP4 langsung, tidak ada iframe di modal P4) + judul/deskripsi + grid "Video Lainnya" + tombol Bagikan + slot iklan kecil di bawah, deep-link `/bk/watch/<slug>`. Mekanisme history/popstate identik dengan P2/P3.

### CDN Allowlist P4 (isAllowedBkCdnUrl + isAllowedBkThumbUrl)
- `vdn.bokepking.cam` — CDN video & thumbnail utama (tanpa signed token, TTL 30 mnt aman)

### Kenapa Direct MP4 (bukan HLS) untuk P4
bokepking.cam menyimpan video sebagai MP4 langsung di `vdn.bokepking.cam` — tidak ada playlist `.m3u8`. Proksi dilakukan via `/proxy/bk/stream/:slug` dengan Range support supaya seek/scrubbing berfungsi.

## Deployment
- **Replit (backend + dev frontend)**: server jalan di port 5000
- **Firebase (production frontend)**: `vidorey.web.app` — host file statis dari `public/`
  - Deploy via: `bash deploy.sh` (hanya deploy Firebase, bukan Replit backend)

### config.js — Auto-detect Backend URL
`public/config.js` mendeteksi environment saat runtime:
- **Replit dev** (hostname `*.replit.dev` / `*.replit.app` / `localhost`) → `BACKEND_URL = ''` (relatif)
- **Firebase production** (semua hostname lain) → `BACKEND_URL` di-inject oleh `deploy.sh`

File `config.js` menyimpan placeholder `__REPLIT_BACKEND_URL__` di repo. `deploy.sh` melakukan:
1. Baca URL dari Replit Secret **`REPLIT_BACKEND_URL`** (wajib diset sekali)
2. `sed` inject URL ke `config.js` sementara
3. Deploy ke Firebase
4. Restore `config.js` ke placeholder

**Jangan edit `config.js` manual** — cukup set/update secret `REPLIT_BACKEND_URL` jika URL Replit berubah.

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
| `bk_video` | `/api/bk/video/:slug` dipanggil (P4) |
| `bk_posts` | `/api/bk/posts` dipanggil (P4) |

### Implementasi Monitor
- Buffer di memory: **unlimited** — semua events tersimpan (tidak ada trim)
- CDN alerts: **unlimited** — semua alert tersimpan
- SSE: koneksi terbuka push event realtime; history dikirim sekali saat connect
- Keepalive ping setiap 25 detik agar koneksi tidak di-drop

## Keamanan (server.js)
- **CSP**: aktif via Helmet. `script-src` pakai `'unsafe-inline'` (wajib karena HTML masih pakai inline `<script>`) tapi **tidak pakai wildcard `https:`** — hanya domain eksplisit yang diizinkan: `cdn.jsdelivr.net` (hls.js), `pl28423230/pl28418540/pl28427857.effectivecpmnetwork.com` + `www.highperformanceformat.com` (Adsterra). `style-src` → `fonts.googleapis.com` saja. `font-src` → `fonts.gstatic.com` saja. Proteksi nyata dari `object-src 'none'`, `base-uri 'self'`, `connect-src 'self'`. **Jika menambah script/ad network baru, wajib tambahkan domainnya ke `scriptSrc` di server.js.**
- `/embed/:id` (P1) override `frame-ancestors`-nya sendiri lewat `res.setHeader` supaya bisa di-iframe dari Firebase frontend.
- **Rate limiting** (`express-rate-limit`): `/api/*` → 60 req/menit/IP (endpoint yang memicu scraping upstream), `/proxy/*` → 300 req/menit/IP (stream/segment/thumbnail, butuh limit lebih longgar). `app.set('trust proxy', 1)` wajib ada — tanpa ini semua pengunjung di belakang proxy Replit akan dianggap satu IP yang sama.
- **Monitor/CDN-alert buffer**: sengaja **unlimited**, tidak di-cap — ini keputusan sadar (monitoring pengunjung), bukan oversight.

## User Preferences
- Dark theme (Obsidian Archive design system)
- Bahasa Indonesia untuk UI
- Setiap platform harus terisolasi penuh — tidak boleh ada data/logic yang bocor antar platform
- Tidak ada nama sumber asli (xpvid.cc, ruangbokep.ws, yobokep.com) yang ditampilkan ke user di frontend
