# Vidorey — Multi-Platform Video Browser

Web app untuk browse dan nonton video dari tujuh platform terpisah.

## Stack
- **Backend**: Node.js + Express (proxy + HTML scraper), modular — lihat struktur di bawah
- **Frontend**: Vanilla JS SPA (no framework), tujuh halaman terpisah
- **Port**: 5000

## Struktur Backend
`server.js` (composition root) hanya merakit: security middleware (Helmet + CSP, CORS, rate limit) → static → monitor tracking → mount 7 router platform → monitor/health routes → SPA fallback.

```
server.js                 ← composition root (helmet/CSP, CORS, rate limit, mount routers, /api/s/:platform/:token shortlink resolver, listen)
lib/
  cache.js                ← makeCache() factory generik (dipakai semua platform, instance terpisah per platform)
  proxy.js                ← UA string, apiError(), axios instances (ax/axNoRedirect), resolveUrl(), basenameNoQuery()
  monitor.js              ← MONITOR_KEY, monitorLog, cdnAlerts, trackRequest, checkMonitorKey, registerMonitorRoutes (/health, /health/detail, /monitor, /monitor/events)
  shortlink.js            ← token ↔ slug registry (in-memory, 48h TTL, 20k slots); registerSlug(platform,slug)→token; resolveToken(platform,token)→slug
  scrapers/
    p1.js                 ← xpvid.cc: folder/video API, stream+thumb proxy, /embed/:id
    rb.js                 ← ruangbokep.ws: PackerJS decode, self-healing CDN token, HLS proxy, /rb SPA route
    yb.js                 ← yobokep.com: dual embed provider (bysezejataos AES-256-GCM + streamhls.to), HLS proxy, /yb SPA route
    bk.js                 ← bokepking.cam: WP REST API listing, direct MP4 proxy, /bk SPA route
    tp.js                 ← tik.porn: __NEXT_DATA__ scrape, HLS via hls.js, TikTok-style feed, /tp SPA route
    rc.js                 ← api.reddclips.com: JSON API, direct MP4 proxy, kategori tabs feed, /rc SPA route
    sb.js                 ← situsbokep.cc: WP HTML scrape (cheerio), xvideos embedframe → HLS, /sb SPA route
```

Tiap modul `lib/scrapers/*.js` export `{ router, caches }` — `caches` dipakai `server.js` untuk agregasi `getCacheStats()` di `/health/detail`. **Tidak ada cross-import antar scraper files** — hanya `lib/cache.js` dan `lib/proxy.js` yang generik/stateless di-share.

## Tujuh Platform (Completely Isolated)

| Platform | URL | Source | HTML | JS | Nama UI |
|---|---|---|---|---|---|
| Platform 1 | `/` | xpvid.cc | `index.html` | `app.js` | Vidorey 1 |
| Platform 2 | `/rb` | ruangbokep.ws | `rb.html` | `rb.js` | Vidorey 2 |
| Platform 3 | `/yb` | yobokep.com | `yb.html` | `yb.js` | Vidorey 3 |
| Platform 4 | `/bk` | bokepking.cam | `bk.html` | `bk.js` | Vidorey 4 |
| Platform 5 | `/tp` | tik.porn | `tp.html` | `tp.js` | Vidorey TikTok 1 |
| Platform 6 | `/rc` | api.reddclips.com | `rc.html` | `rc.js` | Vidorey TikTok 2 |
| Platform 7 | `/sb` | situsbokep.cc | `sb.html` | `sb.js` | Vidorey 5 |

**Nama UI tidak menyebut nama web sumber** — user hanya melihat "Vidorey 1", "Vidorey 2", dst.

Navigasi antar platform via **sidebar drawer** — tombol hamburger ≡ di kiri topbar membuka panel geser dari kiri (seperti ChatGPT). Menampilkan dua seksi terpisah: **seksi atas** (listing biasa: Vidorey 1–5) dan **seksi bawah "Fitur Lain"** (khusus TikTok-style: Vidorey TikTok 1–2). Highlight platform aktif. Tutup dengan tombol ✕, klik backdrop, atau Esc.

## Iklan (Adsterra)
Tiga jenis slot iklan dipakai, semuanya identik di `index.html`/`rb.html`/`yb.html`/`bk.html`/`sb.html`/`tp.html`/`rc.html`:
1. **Native banner** (`.ad-native-slot`, di bawah grid listing) — key `761a1a8645cd2263043bfeb6f2e87eea`, invoke.js dari `pl28423230.effectivecpmnetwork.com`. Punya container `id` tetap (`container-<key>`) yang di-hardcode oleh jaringan iklan — **jangan diduplikasi di halaman yang sama** (duplicate `id` bikin script hanya render ke elemen pertama).
2. **Display banner 300×250** (`.ad-display-slot` di listing, `.watch-ad-slot` di watch view) — pola `atOptions` + invoke.js dari `highperformanceformat.com`, **aman diduplikasi** berkali-kali di halaman yang sama karena scriptnya `document.write` langsung di lokasi tag, tidak butuh id unik (deklarasi `atOptions` di-reset tepat sebelum tiap invoke.js dipanggil).
3. **Popunder + Social Bar** (di akhir `<body>`, sekali per halaman) — dua script dari `effectivecpmnetwork.com` (`pl28418540`, `pl28427857`), sengaja tidak dipakai di watch view karena bersifat mengganggu (buka tab baru / overlay mengambang).

Semua domain iklan sudah masuk allowlist `script-src` di CSP (`server.js`) — kalau nambah jaringan iklan baru, domain barunya wajib ditambah eksplisit (CSP tidak pakai wildcard `https:`).

### Struktur Nav Drawer (sama di ketujuh HTML)
- `.nav-burger` (id `navBurger`) — tombol hamburger di dalam `.brand` di topbar (listing platform P1–P4, P7/Vidorey 5); `tpNavBurger`/`rcNavBurger` untuk P5/P6 yang punya topbar custom
- `div.nav-overlay` (id `navOverlay`) — backdrop gelap, z-index 149
- `nav.nav-drawer` (id `navDrawer`) — panel slide-in, z-index 150
- `.nav-drawer-head` + `.nav-drawer-close` (id `navClose`) — header drawer
- `.nav-plat-item` + `.nav-plat-item.active` — item platform; avatar selalu `<img src="/logo.png">` (logo Vidorey sama untuk semua platform, konsisten dengan topbar)

**Dua seksi nav drawer:**
- **Seksi atas** (tanpa label) — listing platform biasa: P1 `/` (Vidorey 1), P2 `/rb` (Vidorey 2), P3 `/yb` (Vidorey 3), P4 `/bk` (Vidorey 4), P7 `/sb` (Vidorey 5)
- `<hr class="nav-section-divider">` — pemisah visual
- **"Fitur Lain"** — KHUSUS TikTok-style (vertical scroll-snap): P5 `/tp`, P6 `/rc`

⚠️ Platform listing baru WAJIB masuk seksi atas (sebelum `<hr>`). Platform TikTok-style WAJIB masuk di bawah label "Fitur Lain". Jangan campur.

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
3. `/api/rb/video/:slug` → cek `rbVideoCache` (30 mnt) lebih dulu; miss: resolve iframe embed URL (putarvid/streamruby, dengan m3u8Cache fast-path untuk skip putarvid round-trip jika URL CDN sudah di-cache) → HLS via PackerJS decode → cache hasil di `rbVideoCache`; response membawa `description`, `related`, dan `token` (11-char shortlink dari `lib/shortlink.js`). Cache hit kembali dalam <1ms → `history.replaceState` ke token URL selalu berhasil sebelum client timeout 15s.
4. `/proxy/rb/hls/:slug` → proxy master m3u8, rewrite semua URL ke `/proxy/rb/seg`
5. `/proxy/rb/seg` → proxy segment/sub-manifest; self-healing saat CDN 403 via `handleRbSeg` + `reresolveUrl`
6. `/proxy/rb/thumb?url=` → proxy thumbnail (validasi `content-type: image/*`)
7. `/rb/watch/:slug` → SPA route (sama seperti `/rb`, serve `rb.html`) — dipakai sebagai deep-link/share URL, langsung membuka watch view video tsb saat diakses

### Watch View P2 (full-page, gaya XNXX)
Klik video membuka **full-page watch view** (cover seluruh layar, bukan modal mengambang). Layout desktop: kolom kiri (`watch-main`) berisi player + judul + deskripsi + tombol Bagikan; kolom kanan (`watch-related`, 356px, sticky) berisi grid "Video Lainnya" 1-kolom dengan scroll independen. Mobile ≤860px: stack vertikal, sidebar jadi static flow, related grid 2-kolom.

Topbar watch (`watch-topbar`, 52px): tombol **← Kembali** (`rbModalClose`) di kiri + label platform di sebelahnya. Menutup ke listing dan restore URL ke `/rb`.

**URL scheme — shortlink 11 karakter (bukan slug):** Address bar dan share link memakai token 11-char acak (`/rb/watch/m4k9zqr2xab`) yang tidak mengandung judul video. Flow: (1) `openModal(slug)` push URL ke `/rb/watch/<base64url(slug)>` sementara; (2) setelah API `/api/rb/video/:slug` return, server menyertakan field `token` (dihasilkan `registerSlug('rb', slug)` dari `lib/shortlink.js`); (3) client langsung `history.replaceState` ke `/rb/watch/<token>` dan simpan ke `currentToken`; (4) tombol Share pakai `currentToken || encodeSlug(currentSlug)`. Deep-link saat load: jika segment URL 11-char `[a-z0-9]` → resolve via `/api/s/rb/<token>`; jika base64url panjang → `decodeSlug()` (backward compat link lama). Token berlaku 48 jam (in-memory, hilang saat server restart). Mekanisme back/forward via popstate: state selalu menyimpan slug asli (bukan token), jadi Forward tidak perlu resolve ulang. Lihat `openModal()`/`openPlayer()`/popstate handler di `rb.js`. Pola ini identik di P3/P4/P7.

Di bawah grid "Video Lainnya" (paling bawah sidebar) ada satu slot iklan kecil (`.watch-ad-slot`, banner iframe 300×250 dari `highperformanceformat.com`). Identik di P2/P3/P4/P7.

## Cara Kerja — Platform 3 (yobokep.com)
1. `/api/yb/posts` → WP REST API untuk slug + title + totalPages; parallel-fetch `og:image` dari tiap post untuk thumbnail (cache 24 jam)
2. `/api/yb/video/:slug` → scrape post page → resolve embed (bysezejataos.com atau streamhls.to) → HLS URL; response juga membawa `description` (og:description), `related` (di-scrape dari widget "Related videos" — `.under-video-block` dengan heading persis "Related videos", isi `article.loop-video[data-main-thumb]`, markup mirip P2), dan `token` (11-char shortlink)
3. `/proxy/yb/hls/:slug` → proxy master m3u8, rewrite semua URL ke `/proxy/yb/seg`
4. `/proxy/yb/seg` → proxy segment/sub-manifest; self-healing saat CDN 403 via `handleYbSeg` + `reresolveYbUrl`
5. `/proxy/yb/thumb?url=` → proxy thumbnail (validasi `content-type: image/*`)
6. `/yb/watch/:slug` → SPA route (sama seperti `/yb`, serve `yb.html`) — deep-link/share URL, buka watch view video tsb saat diakses

### Watch View P3 (sama seperti P2)
Full-page layout identik P2 — `watch-topbar` (tombol ← Kembali `ybModalClose`), `watch-main` (player + info), `watch-related` sticky sidebar (grid 1-kolom). Deep-link `/yb/watch/<token>`. Lihat "Watch View P2" untuk detail UX, URL scheme, dan mekanisme history/popstate.

### Kenapa WP REST API untuk P3 (bukan HTML scrape seperti P2)
yobokep.com HTML listing page selalu mengembalikan 24 post yang sama di semua `/page/N/` — server-side pagination tidak berjalan (butuh JS/AJAX dari browser). WP REST API paginasinya benar via `x-wp-totalpages` header.

### CDN Allowlist P3 (isAllowedYbCdnUrl)
- `*.r66nv9ed.com` — bysezejataos CDN (SprintCDN), tidak IP-locked
- `*.owphbf24.com` — SprintCDN edge nodes geografis (moscow, frankfurt, dll)
- `*.savefiles.com` + `savefiles.com` — streamhls.to CDN, token `i=` dikunci ke IP

## Cara Kerja — Platform 4 (bokepking.cam)
1. `/api/bk/posts?p=N&q=query` → WP REST API bypass (`/?rest_route=/wp/v2/posts`) untuk listing + pagination; parallel-fetch thumbnail dari `/wp/v2/media/:id` (cache 24 jam); **sentinel caching** — error/404/empty di-cache 20-30s agar tidak hammer upstream (konsisten P2/P3)
2. `/api/bk/video/:slug` → scrape post HTML → extract `<meta itemprop="contentURL" content="...mp4">` atau `<source type="video/mp4">` → MP4 URL langsung (tidak pakai HLS); response juga membawa `description` (meta og:description/itemprop/name description, urutan fallback), `related` (di-scrape dari `.under-video-block > .videos-list > article[id]` — satu-satunya blok di halaman, tanpa heading pembeda; thumbnail asli ada di `img[data-src]`, bukan `src`, karena lazy-loaded), dan `token` (11-char shortlink)
3. `/proxy/bk/stream/:slug` → proxy MP4 ke `vdn.bokepking.cam` dengan Range support; evict cache & retry sekali jika CDN 403/404
4. `/proxy/bk/thumb?url=` → proxy thumbnail (allowlist `vdn.bokepking.cam` only, validasi `content-type: image/*`)
5. `/bk/watch/:slug` → SPA route (sama seperti `/bk`, serve `bk.html`) — deep-link/share URL, buka watch view video tsb saat diakses

### Watch View P4 (sama seperti P2, player MP4 langsung tanpa iframe)
Full-page layout identik P2/P3 — `watch-topbar` (tombol ← Kembali `bkModalClose`), `watch-main` (elemen `<video>` MP4 langsung — bukan iframe), `watch-related` sticky sidebar. Deep-link `/bk/watch/<token>`. Mekanisme history/popstate identik P2/P3.

### CDN Allowlist P4 (isAllowedBkCdnUrl + isAllowedBkThumbUrl)
- `vdn.bokepking.cam` — CDN video & thumbnail utama (tanpa signed token, TTL 30 mnt aman)

### Kenapa Direct MP4 (bukan HLS) untuk P4
bokepking.cam menyimpan video sebagai MP4 langsung di `vdn.bokepking.cam` — tidak ada playlist `.m3u8`. Proksi dilakukan via `/proxy/bk/stream/:slug` dengan Range support supaya seek/scrubbing berfungsi.

## Cara Kerja — Platform 5 (tik.porn)
1. `/api/tp/posts` → scrape `__NEXT_DATA__` dari tik.porn; home: `initialRelatedVideos.data[]` (10 item, tidak bisa pagination); search: `initialVideoResults.data[]`
2. `/api/tp/video/:id` → scrape `__NEXT_DATA__` → ambil `firstVideo.sources[].type === 'application/x-mpegURL'` untuk HLS URL
3. `/proxy/tp/hls/:id` → proxy master m3u8, rewrite semua URL ke `/proxy/tp/seg`
4. `/proxy/tp/seg` → proxy segment/sub-manifest; `axTpGetSafe` untuk validasi redirect CDN
5. `/proxy/tp/thumb?url=` → proxy thumbnail (base64url encode)

### Feed P5 (TikTok-style)
TikTok-style vertical scroll-snap feed (`tp-feed` position:fixed, `body.tp-page { overflow:hidden }`). Tidak ada modal. IntersectionObserver threshold 0.75 play/pause. Ad slide setiap 5 video + end slide.

## Cara Kerja — Platform 6 (api.reddclips.com)
1. `/api/rc/categories` → fetch `api.reddclips.com/categories` → `data.categories[]`; cache 1 jam
2. `/api/rc/posts?categoryId=N&sort=hot&limit=25&after=cursor` → fetch `api.reddclips.com/categories/:id/posts`; filter `mediaType === 'video'`; extract hash dari `mediaUrl /video/{hash}.mp4`; cache 10 mnt
3. `/proxy/rc/stream/:hash` → proxy MP4 langsung dari `api.reddclips.com/video/:hash.mp4` dengan Range support (seeking)
4. `/proxy/rc/thumb?url=BASE64URL` → proxy thumbnail dari `external-preview.redd.it`/`preview.redd.it`/`i.redd.it`

### Feed P6 (TikTok-style dengan kategori tabs)
TikTok-style vertical scroll-snap (`rc-feed` position:fixed, `body.rc-page { overflow:hidden }`). Layout: topbar 52px → display banner 50px → cats bar 48px → feed mulai top:150px. Kategori tabs scroll horizontal. Tidak ada sort button (dihapus — fungsi tidak nyata di API sumber). Ad slide setiap 5 video + end slide. Deep-link: `/rc/video/:hash` — init parse pathname, set target hash sebelum reset URL.

### CDN Allowlist P6
- Video: `api.reddclips.com`
- Thumbnail: `external-preview.redd.it`, `preview.redd.it`, `i.redd.it`

## SEO

### Strategi
Semua halaman menggunakan **keyword bahasa Inggris** (bukan Indonesia) agar Google mengirim traffic dari Tier 1 (US/UK/EU — CPM $2–5) bukan hanya Indonesia (CPM $0.05–0.3).

### Meta tags — template wajib tiap halaman
```html
<html lang="en">
<title>Vidorey N - [English keyword title]</title>
<meta name="description" content="[English description with adult keywords]" />
<meta name="keywords" content="free porn, xxx videos, sex videos, ..." />
<meta name="robots" content="index, follow" />
<link rel="canonical" href="https://vidorey.web.app/pN" />
<meta name="theme-color" content="#121212" />
<meta property="og:locale" content="en_US" />       ← bukan id_ID
<meta name="twitter:card" content="summary_large_image" />
```

### File SEO statis (public/)
| File | Fungsi |
|---|---|
| `robots.txt` | Allow semua kecuali `/monitor` dan `/health` |
| `sitemap.xml` | 7 URL platform, `changefreq: daily` |

Setiap platform baru wajib ditambahkan ke `sitemap.xml`.

### Meta tags per platform (saat ini)
| Platform | Title keyword |
|---|---|
| index.html | "Free XXX Videos & Porn Movies \| Watch HD Sex Online" |
| rb.html | "Free Porn Videos \| New XXX Movies Updated Daily" |
| yb.html | "XXX Videos \| Free Premium Adult Streaming Online" |
| bk.html | "Free HD Sex Videos \| Adult Porn Streaming" |
| tp.html | "Free Short Porn Clips \| Scroll XXX Videos" |
| rc.html | "Free XXX Short Clips \| Adult Video Feed" |
| sb.html | "Free HD Sex Videos \| Adult Porn Streaming" |

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
| `/monitor` | Dashboard HTML real-time (SSE + virtual list) |
| `/monitor/events` | SSE stream (text/event-stream) |
| `/monitor/log?before=&limit=` | REST: ambil event lama untuk pagination (max 500/req) |
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
| `tp_video` | `/proxy/tp/hls/:id` dipanggil (P5) |
| `tp_posts` | `/api/tp/posts` dipanggil (P5) |
| `rc_video` | `/proxy/rc/stream/:hash` dipanggil (P6) |
| `rc_posts` | `/api/rc/posts` dipanggil (P6) |
| `sb_video` | `/api/sb/video/:slug` dipanggil (P7/Vidorey 5) |
| `sb_posts` | `/api/sb/posts` dipanggil (P7/Vidorey 5) |

### Implementasi Monitor
- **Ring buffer server**: `MON_BUF=50.000` event, `CDN_ALERT_MAX=500` alert
- `totalEvents` counter integer terpisah — tidak berkurang saat ring buffer trim, dipakai untuk stat akurat di dashboard
- **SSE initial load**: hanya `SSE_HISTORY=200` event terbaru dikirim ke client baru (bukan seluruh log)
- **Virtual list client**: semua event di JS array (`allEvents[]`, newest-first); hanya baris visible di viewport (~30) yang menjadi DOM node — tidak ada DOM node limit
- **REST pagination**: scroll ke bawah → auto-fetch `GET /monitor/log?before=<ts>&limit=200` untuk event lebih lama; append ke `allEvents[]` tanpa rebuild DOM
- Dashboard realtime: event baru via SSE langsung prepend ke top; koneksi SSE tetap terbuka (keepalive ping tiap 25 detik, auto-reconnect 3 detik jika putus)

## Keamanan (server.js)
- **CSP**: aktif via Helmet. `script-src` pakai `'unsafe-inline'` (wajib karena HTML masih pakai inline `<script>`) tapi **tidak pakai wildcard `https:`** — hanya domain eksplisit yang diizinkan: `cdn.jsdelivr.net` (hls.js), `pl28423230/pl28418540/pl28427857.effectivecpmnetwork.com` + `www.highperformanceformat.com` (Adsterra). `style-src` → `fonts.googleapis.com` saja. `font-src` → `fonts.gstatic.com` saja. Proteksi nyata dari `object-src 'none'`, `base-uri 'self'`, `connect-src 'self'`. **Jika menambah script/ad network baru, wajib tambahkan domainnya ke `scriptSrc` di server.js.**
- `/embed/:id` (P1) override `frame-ancestors`-nya sendiri lewat `res.setHeader` supaya bisa di-iframe dari Firebase frontend.
- **Rate limiting** (`express-rate-limit`): `/api/*` → 60 req/menit/IP (endpoint yang memicu scraping upstream), `/proxy/*` → 300 req/menit/IP (stream/segment/thumbnail, butuh limit lebih longgar). `app.set('trust proxy', 1)` wajib ada — tanpa ini semua pengunjung di belakang proxy Replit akan dianggap satu IP yang sama.
- **Monitor buffer**: ring buffer 50.000 event di server; client pakai virtual list sehingga puluhan ribu event bisa ditampilkan tanpa lag DOM.

## User Preferences
- Dark theme (Obsidian Archive design system)
- Bahasa Indonesia untuk UI
- Setiap platform harus terisolasi penuh — tidak boleh ada data/logic yang bocor antar platform
- Tidak ada nama sumber asli (xpvid.cc, ruangbokep.ws, yobokep.com) yang ditampilkan ke user di frontend
- **Platform baru wajib bebas iklan dari web sumber** — video harus di-resolve ke MP4/m3u8 langsung dan diproxy server-side; tidak boleh ada iframe/embed dari situs sumber yang di-load di browser user. Jika chain embed tidak bisa di-resolve server-side (provider IP-block server, atau SPA tanpa API terbuka), platform tersebut tidak boleh diimplementasikan.
