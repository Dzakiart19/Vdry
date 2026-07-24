# Vidorey — Multi-Platform Video Browser

Web app untuk browse dan nonton video dari sembilan platform terpisah.

## Cara Menjalankan (Replit)
- Workflow **Start application** menjalankan `node server.js`, serve di port 5000.
- Dependencies via `npm install` (sudah termasuk di package.json: express, axios, cheerio, helmet, cors, compression, express-rate-limit).
- Secret `SESSION_SECRET` dipakai sebagai `MONITOR_KEY` (lib/monitor.js) untuk proteksi route `/monitor`, `/monitor/events`, dll — sudah dikonfigurasi.
- Tidak ada database eksternal; semua cache in-memory (lib/cache.js).

## Stack
- **Backend**: Node.js + Express (proxy + HTML scraper), modular — lihat struktur di bawah
- **Frontend**: Vanilla JS SPA (no framework), sembilan halaman terpisah
- **Port**: 5000

## Struktur Backend
`server.js` (composition root) hanya merakit: security middleware (Helmet + CSP, CORS, rate limit) → static → monitor tracking → mount 9 router platform → monitor/health routes → SPA fallback.

```
server.js                 ← composition root (helmet/CSP, CORS, rate limit, mount routers, /api/s/:platform/:token shortlink resolver, listen)
lib/
  cache.js                ← makeCache() factory generik (dipakai semua platform, instance terpisah per platform)
  proxy.js                ← UA string, apiError(), axios instances (ax/axNoRedirect), resolveUrl(), basenameNoQuery()
  monitor.js              ← MONITOR_KEY, monitorLog, cdnAlerts, trackRequest, checkMonitorKey, registerMonitorRoutes (/health, /health/detail, /monitor, /monitor/events)
  shortlink.js            ← token ↔ slug registry (in-memory, 48h TTL, 20k slots); registerSlug(platform,slug)→token; resolveToken(platform,token)→slug
  scrapers/
    p1.js                 ← vdy.to: folder/video API, stream+thumb proxy via JWT decode, /embed/:id
    rb.js                 ← ruangbokep.ws: PackerJS decode, self-healing CDN token, HLS proxy, /rb SPA route
    yb.js                 ← yobokep.com: dual embed provider (bysezejataos AES-256-GCM + streamhls.to), HLS proxy, /yb SPA route
    bk.js                 ← bokepking.cam: WP REST API listing, direct MP4 proxy, /bk SPA route
    tp.js                 ← tik.porn: __NEXT_DATA__ scrape, HLS via hls.js, TikTok-style feed, /tp SPA route
    sb.js                 ← situsbokep.cc: WP HTML scrape (cheerio), xvideos embedframe → HLS, /sb SPA route
    xn.js                 ← xchina.tube: POST REST API + AES-CBC decrypt key "xxx", HLS token TTL ~1.5h, self-healing, /xn SPA route
    vd.js                 ← videy.design: PHP HTML scrape, direct MP4 proxy (no HLS, no tokens), /vd SPA route
    zg.js                 ← zoig.com: HTML scrape + X-Forwarded-For bypass, signed MP4 self-heal (8-min cache), /zg SPA route
```

Tiap modul `lib/scrapers/*.js` export `{ router, caches }` — `caches` dipakai `server.js` untuk agregasi `getCacheStats()` di `/health/detail`. **Tidak ada cross-import antar scraper files** — hanya `lib/cache.js` dan `lib/proxy.js` yang generik/stateless di-share.

## Sembilan Platform (Completely Isolated)

| Platform | URL | Source | HTML | JS | Nama UI |
|---|---|---|---|---|---|
| Platform 1 | `/` | vdy.to | `index.html` | `app.js` | Vidorey 1 |
| Platform 2 | `/rb` | ruangbokep.ws | `rb.html` | `rb.js` | Vidorey 2 |
| Platform 3 | `/yb` | yobokep.com | `yb.html` | `yb.js` | Vidorey 3 |
| Platform 4 | `/bk` | bokepking.cam | `bk.html` | `bk.js` | Vidorey 4 |
| Platform 5 | `/tp` | tik.porn | `tp.html` | `tp.js` | Vidorey TikTok 1 |
| Platform 6 | `/sb` | situsbokep.cc | `sb.html` | `sb.js` | Vidorey 5 |
| Platform 7 | `/vd` | videy.design | `vd.html` | `vd.js` | Vidorey 7 |
| Platform 8 | `/xn` | xchina.tube | `xn.html` | `xn.js` | Vidorey 6 |
| Platform 9 | `/zg` | zoig.com | `zg.html` | `zg.js` | Vidorey 8 |

**Nama UI tidak menyebut nama web sumber** — user hanya melihat "Vidorey 1", "Vidorey 2", dst.

Navigasi antar platform via **sidebar drawer** — tombol hamburger ≡ di kiri topbar membuka panel geser dari kiri (seperti ChatGPT). Menampilkan dua seksi terpisah: **seksi atas** (listing biasa: Vidorey 1–8) dan **seksi bawah "Fitur Lain"** (khusus TikTok-style: Vidorey TikTok 1). Highlight platform aktif. Tutup dengan tombol ✕, klik backdrop, atau Esc.

## Iklan (Adsterra)
Empat jenis slot iklan aktif, posisi strategis per halaman:

Iklan hanya dari **Adsterra**. ExoClick telah dihapus sepenuhnya.

| Slot | Ukuran | Class CSS | Key | Posisi |
|---|---|---|---|---|
| Display banner | 300×250 | `.ad-display-slot` | `d50b941ac6d9bd5749dcdb0b417bf348` | Atas grid + bawah native (2× per listing page) |
| Inline grid banner | 300×250 | `.ad-inline-grid` | `d50b941ac6d9bd5749dcdb0b417bf348` | Di antara card video (setelah card ke-8 dan ke-16), diinjeksi JS via `createInlineAd()` di rb/yb/bk/sb.js |
| Native banner | — | `.ad-native-slot` | `761a1a8645cd2263043bfeb6f2e87eea` | Tengah listing (antara 2 display slot) |
| Mobile banner | 320×50 | `.ad-mobile-banner-slot` | `d37e31d713d11b2ddde7d3efca199c9d` | **Sticky fixed bottom** di mobile (≤767px); static di desktop |
| Popunder + Social Bar | — | *(inline script)* | `pl28418540` + `pl28427857` | Akhir `<body>`, sekali per halaman |

**Watch view (P2/P3/P4/P6):** dua slot 300×250 — satu di bawah player (`watch-ad-below-player`, tepat setelah video-stage), satu lagi di bawah grid related di sidebar kanan (`watch-ad-slot`). Tidak ada popunder/social bar di watch view karena mengganggu nonton.

**Aturan penting:**
- Native banner punya `id` container tetap (`container-761a1a8645cd2263043bfeb6f2e87eea`) — **jangan duplikat** di halaman yang sama.
- Display banner 300×250 **aman diduplikat** — `atOptions` di-reset sebelum tiap `invoke.js`.
- **Unit yang sudah dihapus dan tidak boleh dipasang lagi:** 728×90 Leaderboard, 468×60 Banner, 160×300 Half-page, 160×600 Skyscraper, Smartlinks (`smartlinks.js` sudah dihapus dari repo). ExoClick (semua unit) dihapus — hanya Adsterra yang aktif.
- Kalau nambah jaringan iklan baru, domain barunya wajib ditambah ke `scriptSrc` di `server.js` (CSP tidak pakai wildcard `https:`).

### Struktur Nav Drawer (sama di semua HTML)
- `.nav-burger` (id `navBurger`) — tombol hamburger di dalam `.brand` di topbar (listing platform P1–P4, P6/Vidorey 5); `tpNavBurger` untuk P5 yang punya topbar custom
- `div.nav-overlay` (id `navOverlay`) — backdrop gelap, z-index 149
- `nav.nav-drawer` (id `navDrawer`) — panel slide-in, z-index 150
- `.nav-drawer-head` + `.nav-drawer-close` (id `navClose`) — header drawer
- `.nav-plat-item` + `.nav-plat-item.active` — item platform; avatar selalu `<img src="/logo.png">` (logo Vidorey sama untuk semua platform, konsisten dengan topbar)

**Dua seksi nav drawer:**
- **Seksi atas** (tanpa label) — listing platform biasa: P1 `/` (Vidorey 1), P2 `/rb` (Vidorey 2), P3 `/yb` (Vidorey 3), P4 `/bk` (Vidorey 4), P6 `/sb` (Vidorey 5), P8 `/xn` (Vidorey 6), P7 `/vd` (Vidorey 7), P9 `/zg` (Vidorey 8)
- `<hr class="nav-section-divider">` — pemisah visual
- **"Fitur Lain"** — KHUSUS TikTok-style (vertical scroll-snap): P5 `/tp`

⚠️ Platform listing baru WAJIB masuk seksi atas (sebelum `<hr>`). Platform TikTok-style WAJIB masuk di bawah label "Fitur Lain". Jangan campur.

**ID lama yang sudah dihapus:** `platformSwitcher`, `psTrigger`, `psMenu` — tidak ada lagi di HTML manapun. CSS `.ps-trigger`, `.ps-menu`, `.ps-chevron`, `@keyframes psIn`, `.ps-item` sudah dibersihkan dari style.css.

## Cara Kerja — Platform 1 (vdy.to)
1. `/api/folder/:id` → scrape subfolder & video list dari vdy.to/f/:id (selector identik dengan xpvid.cc lama: folder-chip, thumb-link, drive-title)
2. `/api/video/:id` → scrape vdy.to/d/:id → ekstrak `var embedToken` → decode JWT 2-part (part[0]=payload base64 JSON) → field `rf` = CDN path; fallback ke stream.php jika JWT gagal
3. `/proxy/stream/:id` → stream video dengan Range support; MP4 di `vidoycdn.b-cdn.net/<rf>`
4. `/proxy/thumb?url=` → proxy thumbnail dari `i.vdy.to` (allowlist only); URL thumbnail dari field `im` di JWT payload (sudah include ekstensi, contoh: `RD7qf5A7S7.jpg`)
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

**URL scheme — shortlink 11 karakter (bukan slug):** Address bar dan share link memakai token 11-char acak (`/rb/watch/m4k9zqr2xab`) yang tidak mengandung judul video. Flow: (1) `openModal(slug)` push URL ke `/rb/watch/<base64url(slug)>` sementara; (2) setelah API `/api/rb/video/:slug` return, server menyertakan field `token` (dihasilkan `registerSlug('rb', slug)` dari `lib/shortlink.js`); (3) client langsung `history.replaceState` ke `/rb/watch/<token>` dan simpan ke `currentToken`; (4) tombol Share pakai `currentToken || encodeSlug(currentSlug)`. Deep-link saat load: jika segment URL 11-char `[a-z0-9]` → resolve via `/api/s/rb/<token>`; jika base64url panjang → `decodeSlug()` (backward compat link lama). Token berlaku 48 jam (in-memory, hilang saat server restart). Mekanisme back/forward via popstate: state selalu menyimpan slug asli (bukan token), jadi Forward tidak perlu resolve ulang. Lihat `openModal()`/`openPlayer()`/popstate handler di `rb.js`. Pola ini identik di P3/P4/P6.

Di bawah grid "Video Lainnya" (paling bawah sidebar) ada satu slot iklan kecil (`.watch-ad-slot`, banner iframe 300×250 dari `highperformanceformat.com`). Identik di P2/P3/P4/P6.

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

## Cara Kerja — Platform 5 / Vidorey TikTok 1 (tik.porn)

> ⚠️ **Bukan Vidorey 5.** P5 adalah platform TikTok-style yang masuk seksi **"Fitur Lain"** di nav drawer — terpisah dari urutan numerik listing (Vidorey 1–5). Vidorey 5 = P6 (situsbokep.cc/sb).

1. `/api/tp/posts` → scrape `__NEXT_DATA__` dari tik.porn; home: `initialRelatedVideos.data[]` (10 item, tidak bisa pagination); search: `initialVideoResults.data[]`
2. `/api/tp/video/:id` → scrape `__NEXT_DATA__` → ambil `firstVideo.sources[].type === 'application/x-mpegURL'` untuk HLS URL
3. `/proxy/tp/hls/:id` → proxy master m3u8, rewrite semua URL ke `/proxy/tp/seg`
4. `/proxy/tp/seg` → proxy segment/sub-manifest; `axTpGetSafe` untuk validasi redirect CDN
5. `/proxy/tp/thumb?url=` → proxy thumbnail (base64url encode)

### Search dedup (tp.js client)
tik.porn SSR search tidak mendukung pagination — `/page/N/?s=query` selalu return halaman 1 yang sama. Client-side fix: `seenVideoIds` (Set) mencatat semua ID yang sudah tampil di feed; batch baru difilter, jika semua duplikat `hasMore=false` dan end slide muncul.

### Feed P5 (TikTok-style)
TikTok-style vertical scroll-snap feed (`tp-feed` position:fixed, `body.tp-page { overflow:hidden }`). Tidak ada modal. IntersectionObserver threshold 0.75 play/pause. Ad slide setiap 5 video + end slide.

## Cara Kerja — Platform 6 / Vidorey 5 (situsbokep.cc)

> ⚠️ **Nama UI = Vidorey 5** (bukan Vidorey 6) karena P5/TikTok tidak dihitung dalam urutan numerik listing.

1. `/api/sb/posts?p=N&q=query&cat=slug` → dua mode:
   - **Search** (`q` ada): WP REST API `/wp-json/wp/v2/posts?search=...&page=N&per_page=24&_embed=wp:featuredmedia` — pagination akurat via header `X-WP-TotalPages`. HTML scrape `/page/N/?s=query` tidak bekerja di WordPress ini (selalu return halaman 1).
   - **Browse/kategori** (tanpa `q`): HTML scrape + cheerio (`article.thumb-block, article.loop-video`); pagination dari link `href.match(/\/page\/(\d+)/)`.
2. `/api/sb/categories` → WP REST API kategori
3. `/api/sb/video/:slug` → scrape `situsbokep.cc/view/[slug]` → `itemprop="embedURL"` → `xvideos.com/embedframe/[xv_id]` → `html5player.setVideoHLS(...)` → HLS URL
4. `/proxy/sb/hls/:slug` → proxy master m3u8, rewrite ke `/proxy/sb/seg`
5. `/proxy/sb/seg` → proxy segment CDN (xvideos-cdn.com / xnxx-cdn.com)
6. `/proxy/sb/thumb?url=` → proxy thumbnail (allowlist: situsbokep.cc + CDN thumb domains)
7. `/sb/watch/:token` → SPA route deep-link (serve `sb.html`)

### Watch View P6 (sama seperti P2/P3/P4)
Full-page layout: `watch-topbar` (← Kembali) + `watch-main` (hls.js player + judul + deskripsi) + `watch-related` sticky sidebar. Deep-link `/sb/watch/<token>` (11-char shortlink).

## Cara Kerja — Platform 7 / Vidorey 7 (videy.design)

1. `/api/vd/posts?p=N` → HTML scrape `/?page=N&sort=terbaru` → parse `.video-card` grid; title diambil dari `.video-title` di sibling `.video-info` (BUKAN di dalam `<a>`); thumbnail dari `<img>` dalam link; tidak ada search/kategori
2. `/api/vd/video/:id` → scrape `/watch.php?id=N` → `<source type="video/mp4">` / `video#videoPlayer` attr `src` → MP4 URL langsung; thumb dari `poster` attr; related dari `a.related-video-link`; response menyertakan `token` (11-char shortlink)
3. `/proxy/vd/stream/:id` → proxy MP4 ke `videy.design` dengan Range support; self-heal evict+retry sekali jika CDN 403/404
4. `/proxy/vd/thumb?url=` → proxy thumbnail (allowlist domain videy.design)
5. `/vd/watch/:token` → SPA route deep-link (serve `vd.html`)

### Kenapa Direct MP4 (bukan HLS) untuk P7
videy.design menyimpan video sebagai MP4 langsung — tidak ada playlist `.m3u8` dan tidak ada signed token CDN. Proksi via `/proxy/vd/stream/:id` dengan Range support agar seek/scrubbing berfungsi. Tidak ada search atau filter kategori.

### CDN P7
- `videy.design` — CDN origin langsung, no hotlink protection, no signed token, Range OK

## Cara Kerja — Platform 9 / Vidorey 8 (zoig.com)

1. `/api/zg/categories` → scrape `/categories` → list `{ slug, name, thumb, count }` (cache 1 jam)
2. `/api/zg/posts?p=N[&cat=slug]` → HTML scrape; listing umum: `/amateur-videos1.html` (N=1) / `/amateur-videos/tr-week-{N}` (N>1); per-kategori: `/category/{slug}/amateur-videos{N}.html`; card via `a.thumbnailz[href*="/play/"]`
3. `/api/zg/video/:id` → scrape `/play/{id}` → `<source type="video/mp4">` → signed MP4 URL; `poster` attr untuk thumbnail; related via `ul.browse.related`; response menyertakan `token` (11-char shortlink)
4. `/proxy/zg/stream/:id` → proxy signed MP4 ke `zoigvids.zoigg.com` dengan Range support; self-heal evict+re-resolve jika CDN 403/404 (token berubah tiap request)
5. `/proxy/zg/thumb?url=` → proxy thumbnail dari `cdn-o9.zoig1.com`
6. `/zg/watch/:token` → SPA route deep-link (serve `zg.html`)

### Bypass IP-block P9
zoig.com memblokir datacenter IP. Solusi: inject header `X-Forwarded-For: 98.139.180.149` (residential IP) — zoig.com mempercayai header ini tanpa verifikasi.

### CDN P9
- `zoigvids.zoigg.com` — signed token TTL sangat pendek (berubah tiap request) → cache MP4 URL hanya 8 menit; self-heal wajib
- `cdn-o9.zoig1.com` — thumbnail stabil, no hotlink restriction (cache 24 jam)

### Watch View P9 (sama seperti P2/P3/P4/P6)
Full-page layout: `watch-topbar` (← Kembali) + `watch-main` (`<video>` MP4 langsung) + `watch-related` sticky sidebar. Deep-link `/zg/watch/<token>` (11-char shortlink).

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
| `sitemap.xml` | 9 URL platform, `changefreq: daily` |

Setiap platform baru wajib ditambahkan ke `sitemap.xml`.

### Meta tags per platform (saat ini)
| Platform | Title keyword |
|---|---|
| index.html | "Free XXX Videos & Porn Movies \| Watch HD Sex Online" |
| rb.html | "Free Porn Videos \| New XXX Movies Updated Daily" |
| yb.html | "XXX Videos \| Free Premium Adult Streaming Online" |
| bk.html | "Free HD Sex Videos \| Adult Porn Streaming" |
| tp.html | "Free Short Porn Clips \| Scroll XXX Videos" |
| sb.html | "Free HD Sex Videos \| Adult Porn Streaming" |
| xn.html | "Free Chinese XXX Videos \| HD Asian Porn Streaming" |
| vd.html | "Vidorey 7 - Free Amateur Sex Videos \| Indonesian Porn Streaming" |
| zg.html | "Vidorey 8 - Free Homemade Amateur Porn Videos \| Real People Sex" |

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
| `sb_video` | `/proxy/sb/hls/:slug` dipanggil (P6 / Vidorey 5) |
| `sb_posts` | `/api/sb/posts` dipanggil (P6 / Vidorey 5) |
| `xn_video` | `/api/xn/video/:vId` dipanggil (P8 / Vidorey 6) |
| `xn_posts` | `/api/xn/posts` dipanggil (P8 / Vidorey 6) |
| `vd_video` | `/api/vd/video/:id` dipanggil (P7 / Vidorey 7) |
| `vd_posts` | `/api/vd/posts` dipanggil (P7 / Vidorey 7) |
| `zg_video` | `/api/zg/video/:id` dipanggil (P9 / Vidorey 8) |
| `zg_posts` | `/api/zg/posts` dipanggil (P9 / Vidorey 8) |

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
- **Kompresi**: `compression` middleware aktif sebelum Helmet — gzip semua response teks (HTML/JS/CSS/JSON) secara otomatis. `Content-Encoding: gzip` dikirim ke browser yang mendukung.
- **Cache-Control static**: `express.static` dikonfigurasi `maxAge: 2h, etag: true` — browser cache CSS/JS/gambar 2 jam untuk performa repeat visit. Firebase CDN berlaku independent di production.
- **CSP connect-src untuk GA4**: `connectSrc` wajib mengizinkan `www.google-analytics.com`, `*.google-analytics.com`, `analytics.google.com`, `googletagmanager.com`, `www.google.com` — tanpa ini beacon GA4 (dikirim via GTM) diblokir CSP dan analytics tidak pernah dapat data sama sekali walau GTM/GA4 sudah terpasang di HTML.

### VideoObject JSON-LD — status per platform
`public/utils.js` expose `window.setVideoJsonLd()` / `window.clearVideoJsonLd()`. Wajib dipanggil saat video mulai diputar (set) dan saat player ditutup/ganti video (clear) — kalau tidak, schema lama nyangkut di halaman. Sudah terpasang lengkap di app.js (P1), rb.js (P2), yb.js (P3), bk.js (P4), sb.js (P6/Vidorey 5), tp.js (P5/Vidorey TikTok 1).

### Ad-blocker detection
`public/adblock.js` (dimuat di semua HTML setelah `utils.js`) mendeteksi ad-blocker via bait element (`class="ads ad-banner adsbox ad-placement pub_300x250 text-ad textAd"`, cek `offsetParent`/`display`/`visibility` setelah 300ms). Kalau terdeteksi, tampilkan banner non-blocking di pojok bawah (`#vdry-adb-banner`, style di `style.css`) minta user whitelist — dismiss disimpan 24 jam di `localStorage` (`vdry_adb_dismiss_until`) supaya tidak nge-spam user yang sama.

## User Preferences
- Dark theme (Obsidian Archive design system)
- Bahasa Indonesia untuk UI
- Setiap platform harus terisolasi penuh — tidak boleh ada data/logic yang bocor antar platform
- Tidak ada nama sumber asli (vdy.to, ruangbokep.ws, yobokep.com, dst.) yang ditampilkan ke user di frontend
- **Platform baru wajib bebas iklan dari web sumber** — video harus di-resolve ke MP4/m3u8 langsung dan diproxy server-side; tidak boleh ada iframe/embed dari situs sumber yang di-load di browser user. Jika chain embed tidak bisa di-resolve server-side (provider IP-block server, atau SPA tanpa API terbuka), platform tersebut tidak boleh diimplementasikan.
