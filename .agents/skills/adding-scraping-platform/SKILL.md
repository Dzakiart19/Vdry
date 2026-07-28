---
name: adding-scraping-platform
description: Add a new scraping platform (Platform N) to Vidorey. Covers BOTH layout types — standard listing (grid/card + pagination + search + categories + watch modal) and TikTok-style vertical feed — with every file that must be touched, exact code patterns, ads, i18n, SEO, shortlinks, monitor, and verify steps. Use when the user asks to add a new video source/platform, integrate a new site, or wants a new platform to behave reliably like the existing ones.
---

# Adding a New Scraping Platform to Vidorey

## Platform Registry (current — 9 platforms)

| Platform | Route | Source site | Delivery | Scraper | HTML | JS | UI Name | UI Type |
|---|---|---|---|---|---|---|---|---|
| P1  | `/`   | vdy.to          | MP4 direct | `lib/scrapers/p1.js`  | `index.html` | `app.js`  | Vidorey 1        | Listing |
| P2  | `/rb` | ruangbokep.ws   | HLS m3u8   | `lib/scrapers/rb.js`  | `rb.html`    | `rb.js`   | Vidorey 2        | Listing |
| P3  | `/yb` | yobokep.com     | HLS m3u8   | `lib/scrapers/yb.js`  | `yb.html`    | `yb.js`   | Vidorey 3        | Listing |
| P4  | `/bk` | bokepking.cam   | MP4 direct | `lib/scrapers/bk.js`  | `bk.html`    | `bk.js`   | Vidorey 4        | Listing |
| P5  | `/tp` | tik.porn        | HLS m3u8   | `lib/scrapers/tp.js`  | `tp.html`    | `tp.js`   | Vidorey TikTok 1 | TikTok  |
| P6  | `/sb` | situsbokep.cc   | HLS m3u8   | `lib/scrapers/sb.js`  | `sb.html`    | `sb.js`   | Vidorey 5        | Listing |
| P7  | `/vd` | videy.design    | MP4 direct | `lib/scrapers/vd.js`  | `vd.html`    | `vd.js`   | Vidorey 7        | Listing |
| P8  | `/xn` | xchina.tube     | HLS m3u8   | `lib/scrapers/xn.js`  | `xn.html`    | `xn.js`   | Vidorey 6        | Listing |
| P9  | `/zg` | zoig.com        | MP4 direct | `lib/scrapers/zg.js`  | `zg.html`    | `zg.js`   | Vidorey 8        | Listing |

**⚠️ Aturan naming:** Nama UI (Vidorey N) **tidak boleh menyebut nama web sumber** (ruangbokep, tik.porn, dsb.).

---

## Dua tipe UI — pilih sebelum mulai

| | **Listing** | **TikTok-style** |
|---|---|---|
| Referensi implementasi | `rb.js` + `rb.html` (HLS) atau `bk.js` + `bk.html` (MP4) | `tp.js` + `tp.html` |
| Layout | Grid card + pagination + search bar + kategori + watch modal | Vertical scroll-snap full-screen |
| Watch | Modal di atas listing | Inline di setiap slide |
| Ads pattern | createInlineAd + modal ads + video overlay + tap zone | createAdSlide (tiap 5 video) |
| Nav drawer | Seksi ATAS (sebelum divider) | Seksi BAWAH "Fitur Lain" |

---

## Kenapa isolation + proxy pattern wajib

Browser tidak boleh melihat URL CDN asli — token CDN punya TTL pendek. Jika URL CDN dikirim ke frontend:
1. Token kadaluarsa → user lihat "stream expired" atau video blank
2. Tidak ada cara self-heal tanpa reload

Pola yang benar:
- Browser hanya request `/proxy/pN/stream/:slug` atau `/proxy/pN/hls` dari backend kita
- Backend resolve URL CDN server-side, stream bytes melalui dirinya sendiri
- Jika CDN reject (403/404 = token expired) → evict cache → re-resolve → retry 1x otomatis

---

## MASTER CHECKLIST — Platform Listing Baru

Setiap item wajib diselesaikan. Urutan penting — jangan skip.

---

### STEP 1 — Validasi Feasibility (sebelum mulai coding)

```bash
# Curl setiap lapisan chain dari server (bukan browser):
curl -sI "https://source-site.com/video/SAMPLE"
curl -sI "https://embed-or-cdn.com/path/to/stream"
```

- Chain harus resolve ke MP4 atau m3u8 tanpa JS-rendering
- Jika ada layer return 403 / SPA <2KB / butuh JS → **platform tidak feasible, stop**
- Tidak boleh ada iframe/embed sumber yang muncul di browser user (no-source-ads rule)

---

### STEP 2 — `lib/scrapers/pN.js` (backend module)

Buat file baru. Copy dari referensi terdekat, ganti semua prefix.

**Struktur wajib:**

```js
'use strict';
const express  = require('express');
const cheerio  = require('cheerio');
const axios    = require('axios');
const https    = require('https');
const stream   = require('stream');
const path     = require('path');

const { makeCache }    = require('../cache');
const { UA, apiError } = require('../proxy');
const { logCdnAlert }  = require('../monitor');
const { registerSlug } = require('../shortlink');

const router     = express.Router();
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

/* ── Constants ── */
const PN_BASE = 'https://source-site.com';
const PN_CDN  = 'cdn.source-site.com';   // hostname CDN (untuk allowlist)

/* ── Axios instance ── */
const ipv4Agent = new https.Agent({ family: 4 });
const axPn = axios.create({ timeout: 25000, maxRedirects: 5, httpsAgent: ipv4Agent,
  headers: { 'User-Agent': UA, 'Accept': 'text/html,...' } });

/* ── Retry wrapper (2 retries, backoff 900ms) ── */
async function axPnGet(url, config = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try { return await axPn.get(url, config); }
    catch (err) {
      lastErr = err;
      if (err.response?.status >= 400 && err.response?.status < 500) throw err;
      if (i < retries) await new Promise(r => setTimeout(r, 900 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ── CDN allowlist — jangan proxy domain lain ── */
function isAllowedPnUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    if (u.hostname === PN_CDN) return true;
    logCdnAlert(`[cdn-alert] PN domain baru: "${u.hostname}"`);
    return false;
  } catch { return false; }
}

/* ── Caches ── */
const pnPostsCache = makeCache(200,  5 * 60 * 1000, 'pn_posts');
const pnVideoCache = makeCache(500,  4 * 60 * 60 * 1000, 'pn_video');
// Tambah cache lain sesuai kebutuhan (kategori, thumbnail, dsb.)

/* ════════════════════════════════════════════════════════════
   CATEGORIES (jika platform punya kategori)
════════════════════════════════════════════════════════════ */
router.get('/api/pN/categories', async (req, res) => {
  try {
    const cached = pnPostsCache.get('categories');
    if (cached) return res.json(cached);
    // ... scrape kategori ...
    pnPostsCache.set('categories', data, 60 * 60 * 1000); // 1 jam
    res.json(data);
  } catch (err) { apiError(res, 502, err.message); }
});

/* ════════════════════════════════════════════════════════════
   LISTING / POSTS
════════════════════════════════════════════════════════════ */
router.get('/api/pN/posts', async (req, res) => {
  const { page = 1, q = '', cat = '' } = req.query;
  const cacheKey = `posts:${page}:${q}:${cat}`;
  const cached = pnPostsCache.get(cacheKey);
  if (cached) return res.json(cached);
  try {
    // ... scrape posts ...
    const result = { posts, totalPages, page: +page };
    pnPostsCache.set(cacheKey, result);
    res.json(result);
  } catch (err) { apiError(res, 502, err.message); }
});

/* ════════════════════════════════════════════════════════════
   VIDEO RESOLVE — wajib panggil registerSlug
════════════════════════════════════════════════════════════ */
router.get('/api/pN/video/:slug', async (req, res) => {
  const { slug } = req.params;
  const cached = pnVideoCache.get(slug);
  if (cached) {
    // Wajib sertakan token di cache-hit juga
    return res.json({ ...cached, token: registerSlug('pN', slug) });
  }
  try {
    // ... resolve video URL ...
    const result = { slug, title, thumb, description, related, streamUrl };
    pnVideoCache.set(slug, result);
    res.json({ ...result, token: registerSlug('pN', slug) });
  } catch (err) { apiError(res, 502, err.message); }
});

/* ════════════════════════════════════════════════════════════
   STREAM PROXY — browser tidak boleh lihat URL CDN asli
════════════════════════════════════════════════════════════ */
router.get('/proxy/pN/stream/:slug', async (req, res) => {
  const { slug } = req.params;
  // Decode slug → resolve streamUrl → proxy ke browser
  // Jika 403/404: evict cache → re-resolve → retry sekali
  // ...
});

/* ── SPA routes — WAJIB ada di sini (bukan server.js) ── */
// Tanpa ini: /pN dan /pN/watch/<token> serve index.html (P1). Bug ini sudah terjadi.
router.get('/pN',   (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'pN.html')));
router.get('/pN/*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'pN.html')));

module.exports = { router, caches: [pnPostsCache, pnVideoCache] };
```

**Self-healing wajib (untuk HLS m3u8):** jika segment return 403/404 → evict `pnVideoCache.del(slug)` → re-resolve → retry. Lihat pola `reresolveUrl` + `handleRbSeg` di `rb.js` sebagai referensi.

---

### STEP 3 — `server.js` (4 lokasi wajib)

**3a. Require + mount:**
```js
const pN = require('./lib/scrapers/pN');
// ...
app.use(pN.router);
```

**3b. Health detail — tambah caches:**
```js
const allCaches = [
  ...p1.caches, ...rb.caches, ...yb.caches, ...bk.caches,
  ...tp.caches, ...sb.caches, ...vd.caches, ...xn.caches, ...zg.caches,
  ...pN.caches,  // ← TAMBAH INI
];
```

**3c. CSP — tambah domain CDN baru jika ada:**
```js
// Di Helmet scriptSrc array:
'https://cdn-baru.com',       // jika platform butuh script dari domain baru

// Di connectSrc array (untuk fetch/XHR):
'https://api-baru.com',       // jika scraper atau frontend hit domain baru
```
CSP **tidak pakai wildcard** — setiap domain harus eksplisit. Lihat `vidorey-csp-allowlist.md`.

**3d. Shortlink whitelist — tambah 'pN':**
```js
// Di route /api/s/:platform/:token:
if (!['rb','yb','bk','tp','sb','vd','xn','zg','pN'].includes(platform))
  return res.status(404).json({ error: 'not found' });
```

---

### STEP 4 — `lib/monitor.js` (2 lokasi)

**4a. trackRequest — tambah di blok if/else if sebelum `else` terakhir:**
```js
else if (p.startsWith('/api/pN/video/'))  pushMonitorEvent('pN_video', { id: p.split('/')[4] || '?', ip, ua });
else if (p.startsWith('/api/pN/posts'))   pushMonitorEvent('pN_posts', { ip, ua });
// Jika juga ada proxy stream:
else if (p.startsWith('/proxy/pN/stream/')) pushMonitorEvent('pN_video', { id: p.split('/')[4] || '?', ip, ua });
```

**4b. Badge CSS — tambah di `monitorDashboardHtml` (blok CSS badge):**
```css
.b-pN_video{background:#PILIH_BG;color:#PILIH_TEXT}
.b-pN_posts{background:#PILIH_BG;color:#PILIH_TEXT}
```
Warna yang sudah terpakai (jangan duplikat):
- rb: `#3b1d5a`/`#c084fc`, yb: `#14532d`/`#4ade80`, bk: `#1c2a3a`/`#38bdf8`
- tp: `#3a0a1a`/`#e91e8c`, sb: `#0a2e18`/`#34d399`, xn: `#3a1c0a`/`#fb923c`
- vd: `#0a1e3a`/`#38bdf8`, zg: `#2d0a1e`/`#f472b6`

---

### STEP 5 — `public/pN.html`

Copy dari `bk.html` (MP4) atau `rb.html` (HLS). Ganti semua prefix `bk`→`pN`, `Vidorey 4`→`Vidorey N`.

#### 5a. `<head>` — wajib lengkap

```html
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />

  <!-- GTM — PERTAMA sebelum </head> -->
  <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
  new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
  j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
  'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
  })(window,document,'script','dataLayer','GTM-NWZSVQT9');</script>

  <title>Vidorey N - [English adult keyword title, specific to niche]</title>
  <meta name="description" content="[English, adult keywords, max 160 char]" />
  <meta name="keywords" content="free porn, xxx videos, [platform niche keywords]" />
  <meta name="google-site-verification" content="Vl8CnSoQmgdUxFfXGw4k7nzAPRZBgImHr2OrBPnmaAI" />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="https://vidorey.web.app/pN" />
  <meta name="theme-color" content="#121212" />

  <!-- Open Graph — WAJIB en_US bukan id_ID (menentukan traffic Tier 1) -->
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Vidorey" />
  <meta property="og:title" content="[shorter title]" />
  <meta property="og:description" content="[same as meta description]" />
  <meta property="og:url" content="https://vidorey.web.app/pN" />
  <meta property="og:image" content="https://vidorey.web.app/og-image.jpg" />
  <meta property="og:locale" content="en_US" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="[same as og:title]" />
  <meta name="twitter:description" content="[same as og:description]" />
  <meta name="twitter:image" content="https://vidorey.web.app/og-image.jpg" />

  <!-- Schema.org — WAJIB array [WebSite, WebPage] -->
  <script type="application/ld+json">
  [
    {
      "@context": "https://schema.org", "@type": "WebSite",
      "name": "Vidorey", "url": "https://vidorey.web.app/",
      "description": "Watch free XXX videos and porn movies online. Thousands of HD sex videos updated daily.",
      "potentialAction": {
        "@type": "SearchAction",
        "target": "https://vidorey.web.app/?q={search_term_string}",
        "query-input": "required name=search_term_string"
      }
    },
    {
      "@context": "https://schema.org", "@type": "WebPage",
      "name": "Vidorey N - [title]",
      "url": "https://vidorey.web.app/pN",
      "description": "[same as meta description]",
      "isPartOf": { "@type": "WebSite", "url": "https://vidorey.web.app/" }
    }
  ]
  </script>

  <link rel="stylesheet" href="/style.css" />
  <link rel="icon" type="image/png" href="/logo.png" />
</head>
```

#### 5b. `<body>` — GTM noscript TEPAT setelah `<body>`

```html
<body class="pN-page">
  <!-- Google Tag Manager (noscript) -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-NWZSVQT9"
  height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
```

#### 5c. Topbar standar

```html
<header class="topbar" id="pNTopbar">
  <button class="nav-burger" id="navBurger" aria-label="Menu platform" aria-expanded="false">
    <span></span><span></span><span></span>
  </button>
  <div class="brand">
    <img src="/logo.png" class="logo" alt="Vidorey" />
    <span class="brand-name">Vidorey N</span>
  </div>
  <button id="langToggle" class="lang-toggle-btn">EN</button>
</header>
```

#### 5d. Nav Drawer — update SEMUA 9 HTML yang ada

**ATURAN PENEMPATAN (kritis — bug sudah terjadi):**
- Platform **listing** → SEBELUM `<hr class="nav-section-divider">` (seksi atas)
- Platform **TikTok-style** → SETELAH `<div class="nav-drawer-label">Fitur Lain</div>` (seksi bawah)

Template satu item (untuk semua 9 HTML + pN.html baru):
```html
<!-- Di pN.html: tambah class="active" aria-current="page" -->
<!-- Di HTML lain: tanpa active -->
<a class="nav-plat-item [active]" href="/pN" [aria-current="page"]>
  <div class="ps-avatar ps-avatar-pN"><img src="/logo.png" alt="Vidorey"></div>
  <div class="ps-info">
    <span class="ps-name">Vidorey N</span>
    <span class="ps-desc" data-i18n="nav.pN">[deskripsi singkat · niche platform]</span>
  </div>
</a>
```

File yang harus diupdate: `index.html`, `rb.html`, `yb.html`, `bk.html`, `tp.html`, `sb.html`, `vd.html`, `xn.html`, `zg.html`, dan `pN.html` baru.

#### 5e. Layout utama + H1 SEO

```html
<div class="overlay" id="pNOverlay"></div>

<!-- nav drawer HTML di sini (copy dari platform lain, sesuaikan active) -->

<main class="shell" id="pNShell">
  <!-- H1 wajib ada (sr-only = tersembunyi visual, tapi Google baca) -->
  <h1 class="sr-only">[Main keyword phrase — English, specific, adult]</h1>

  <!-- Search bar (jika platform punya search) -->
  <div class="pN-searchbar" id="pNSearchbar">
    <input type="search" id="pNSearchInput" class="search-input"
           data-i18n-placeholder="search.ph" placeholder="Cari video…" />
    <button class="search-btn" id="pNSearchBtn">
      <span data-i18n="search.btn">Cari</span>
    </button>
    <!-- Tombol kategori (jika platform punya) -->
    <button class="cat-btn" id="pNCatBtn" style="display:none">
      <span data-i18n="cat.btn">Kategori</span>
    </button>
  </div>

  <!-- Category panel (render oleh initVdryCategoryPicker) -->
  <div class="vdry-cat-panel" id="pNCatPanel" aria-label="Kategori"></div>

  <!-- State views -->
  <div class="state-view" id="pNStateView">
    <div class="state-loading" id="pNStateLoading">
      <div class="spinner"></div>
      <p data-i18n="state.loading">Memuat…</p>
    </div>
    <div class="state-error hidden" id="pNStateError">
      <p data-i18n="state.error">Gagal memuat konten.</p>
      <button class="btn-retry" id="pNRetryBtn" data-i18n="state.retry">Coba lagi</button>
    </div>
    <div class="state-empty hidden" id="pNStateEmpty">
      <p data-i18n="state.empty">Tidak ada video ditemukan.</p>
    </div>
  </div>

  <!-- Search/category heading -->
  <div class="search-heading hidden" id="pNSearchHeading"></div>

  <!-- Listing inline ad (satu box-300 di atas grid) -->
  <div class="ad-display-slot" data-ad-zone="box-300"></div>

  <!-- Video grid -->
  <div class="rb-grid" id="pNGrid"></div>

  <!-- Pagination -->
  <div class="pagination" id="pNPagination"></div>
</main>
```

#### 5f. Watch Modal (listing platform) — SEMUA ad slot wajib ada

```html
<div class="modal hidden" id="pNPlayerModal">
  <div class="modal-panel modal-panel-watch modal-fullpage">
    <div class="modal-header">
      <button class="modal-back-btn" id="pNModalBack">
        <svg>…</svg><span data-i18n="player.back">Kembali</span>
      </button>
    </div>

    <div class="modal-body">
      <!-- Ad: ATAS player (muncul di dalam modal) -->
      <div class="watch-lb-top" data-ad-zone="lb-728"></div>
      <div class="watch-mb-top" data-ad-zone="mb-320"></div>

      <!-- Video stage -->
      <div class="video-stage">
        <!-- Untuk MP4 langsung: -->
        <video id="pNVideoEl" class="watch-video" controls playsinline preload="none"></video>
        <!-- Untuk HLS iframe: -->
        <!-- <iframe id="pNIframeEl" class="watch-iframe hidden" allowfullscreen></iframe> -->

        <!-- Video overlay ad (muncul 5s setelah play, bisa ditutup 5s kemudian) -->
        <div id="pNVideoAdOverlay" class="video-ad-overlay" style="display:none" aria-hidden="true">
          <div class="video-ad-bar">
            <span class="video-ad-label"></span>
            <button id="pNVideoAdClose" class="video-ad-close-btn" disabled>
              Lewati <span id="pNVideoAdTimer">5</span>s
            </button>
          </div>
          <div id="pNVideoAdContent" class="video-ad-content"></div>
        </div>

        <!-- Transparent tap zone (klik video → popunder) -->
        <div id="pNVideoTapZone" class="video-tap-zone" role="button" aria-label="Video area"></div>
      </div>

      <!-- Ad: BAWAH player -->
      <div class="watch-ad-slot watch-ad-below-player" data-ad-zone="box-300"></div>

      <!-- Video info + share -->
      <div class="watch-info">
        <h2 class="watch-title" id="pNWatchTitle"></h2>
        <div class="watch-actions">
          <button class="share-btn" id="pNShareBtn">
            <svg>…</svg><span data-i18n="player.share">Bagikan</span>
          </button>
        </div>
        <p class="watch-desc" id="pNWatchDesc"></p>

        <!-- Ad: samping/bawah info (half-160 = 160×300) -->
        <div class="watch-info-ad-slot" data-ad-zone="half-160"></div>
      </div>

      <!-- Related videos -->
      <div class="watch-related">
        <h3 data-i18n="player.related">Video Lainnya</h3>
        <div class="rb-grid rb-grid-related" id="pNRelatedGrid"></div>
        <div class="pagination related-pagination" id="pNRelatedPagination"></div>
      </div>
    </div><!-- /.modal-body -->
  </div>
</div>
```

#### 5g. Sticky banners + static ad scripts (sebelum `</body>`)

```html
<!-- Sticky top banner -->
<div class="vd-sticky-top" aria-label="Advertisement">
  <div class="vd-sticky-top-lb" data-ad-zone="lb-728"></div>
  <div class="vd-sticky-top-mb" data-ad-zone="mb-320"></div>
</div>

<!-- Sticky bottom banner (desktop only, pakai banner-468 — BUKAN lb-728) -->
<div class="vd-sticky-bottom" aria-label="Advertisement">
  <div class="vd-sticky-bottom-lb" data-ad-zone="banner-468"></div>
</div>

<!-- ⚠️ ZONE CONFLICT RULE: sticky top pakai lb-728/mb-320,
     sticky bottom WAJIB pakai banner-468. Satu zone key per halaman. -->

<!-- Native Banner (static inject — bukan via ads.js) -->
<script async="async" data-cfasync="false"
  src="https://pl28423230.effectivecpmnetwork.com/761a1a8645cd2263043bfeb6f2e87eea/invoke.js">
</script>
<div id="container-761a1a8645cd2263043bfeb6f2e87eea"></div>

<!-- Script stack — URUTAN INI WAJIB DIJAGA -->
<script src="/i18n.js"></script>      <!-- 1. PERTAMA — _t() dibutuhkan semua yang lain -->
<script src="/config.js"></script>    <!-- 2. BACKEND_URL -->
<script src="/utils.js"></script>     <!-- 3. setVideoJsonLd, setVideoMeta, initVdryCategoryPicker, smartlink trigger -->
<script src="/adblock.js"></script>   <!-- 4. Ad-blocker detection -->
<script src="/ads.js"></script>       <!-- 5. VdryAds API — SEBELUM platform JS -->
<script src="/pN.js"></script>        <!-- 6. App logic platform -->

<!-- Histats (analytics) -->
<script type="text/javascript">
var _Hasync=_Hasync||[];
_Hasync.push(['Histats.start','1,5040431,4,5,172,25,00011111']);
_Hasync.push(['Histats.fasi','1']);
_Hasync.push(['Histats.track_hits','']);
(function(){var hs=document.createElement('script');hs.type='text/javascript';hs.async=true;
hs.src=(document.location.protocol=='https:' ? 'https://' : 'http://')+'s10.histats.com/js15_as.js';
(document.getElementsByTagName('head')[0]||document.getElementsByTagName('body')[0]).appendChild(hs);})();
</script>

<!-- Popunder script -->
<script src="https://pl28418540.effectivecpmnetwork.com/e2/23/51/e223516a3660ad6a4214cb47e436c599.js"></script>

<!-- Social Bar -->
<script src="https://pl28427857.effectivecpmnetwork.com/96/e9/ff/96e9ff95727320b49c1ea1aa80add9b6.js"></script>

</body>
```

---

### STEP 6 — `public/pN.js` (app logic)

Copy dari `bk.js` atau `rb.js`. Ganti prefix. Struktur wajib:

#### 6a. State + element refs

```js
'use strict';
(function () {

  const PLATFORM = 'pN';

  // ── State ──
  let page        = 1;
  let totalPages  = 1;
  let searchQuery = '';
  let catId       = null;
  let catSlug     = null;
  let currentSlug = null;
  let currentToken = null;
  let modalHistoryPushed = false;

  // ── Element refs ──
  function $  (id) { return document.getElementById(id); }
  const els = {
    grid:          $('pNGrid'),
    pagination:    $('pNPagination'),
    searchInput:   $('pNSearchInput'),
    searchBtn:     $('pNSearchBtn'),
    catBtn:        $('pNCatBtn'),
    catPanel:      $('pNCatPanel'),
    modal:         $('pNPlayerModal'),
    videoEl:       $('pNVideoEl'),
    watchTitle:    $('pNWatchTitle'),
    watchDesc:     $('pNWatchDesc'),
    shareBtn:      $('pNShareBtn'),
    relatedGrid:   $('pNRelatedGrid'),
    relPagination: $('pNRelatedPagination'),
    stateView:     $('pNStateView'),
    searchHeading: $('pNSearchHeading'),
  };
```

#### 6b. i18n helpers

```js
  // Semua string user-facing wajib pakai _t() — TIDAK boleh hardcode teks
  function updateSearchHeading() {
    if (!els.searchHeading) return;
    if (searchQuery) {
      els.searchHeading.textContent = _t('heading.search') + ': "' + searchQuery + '"';
      els.searchHeading.classList.remove('hidden');
    } else if (catSlug) {
      els.searchHeading.textContent = _t('heading.cat') + ': ' + catSlug;
      els.searchHeading.classList.remove('hidden');
    } else {
      els.searchHeading.classList.add('hidden');
    }
  }

  // Re-render heading saat user ganti bahasa
  window.addEventListener('langchange', updateSearchHeading);
```

#### 6c. Inline grid ads — wajib di setiap platform listing

```js
  /* ── Inline 300×250 ad di tengah grid (pos card ke-8, 16, 24) ── */
  function createInlineAd() {
    const wrap = document.createElement('div');
    wrap.className = 'ad-inline-grid';
    const s1 = document.createElement('script');
    s1.text = "atOptions={'key':'d50b941ac6d9bd5749dcdb0b417bf348','format':'iframe','height':250,'width':300,'params':{}};";
    const s2 = document.createElement('script');
    s2.src = 'https://www.highperformanceformat.com/d50b941ac6d9bd5749dcdb0b417bf348/invoke.js';
    wrap.appendChild(s1);
    wrap.appendChild(s2);
    return wrap;
  }
```

#### 6d. Render grid + inject inline ads

```js
  function renderPosts(posts) {
    els.grid.innerHTML = posts.map(p => {
      const slug  = escHtml(p.slug || p.id || '');
      const title = escHtml(p.title || '');
      const thumb = escHtml(p.thumb || '');
      return `<div class="rb-card pN-card" data-slug="${slug}" tabindex="0" role="button" aria-label="${title}">
        <div class="rb-card-thumb">
          <img src="${thumb}" alt="${title}" loading="lazy" />
          <div class="rb-card-overlay"><svg>…play icon…</svg></div>
        </div>
        <div class="rb-card-info">
          <p class="rb-card-title" title="${title}">${title}</p>
        </div>
      </div>`;
    }).join('');

    // Event listeners
    els.grid.querySelectorAll('.pN-card').forEach(card => {
      card.addEventListener('click', () => openPlayer(card.dataset.slug));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') openPlayer(card.dataset.slug);
      });
    });

    // Inject inline ads setelah card ke-8, 16, 24
    const cardEls = [...els.grid.querySelectorAll('.pN-card')];
    [8, 16, 24].forEach(pos => {
      if (cardEls[pos - 1]) cardEls[pos - 1].insertAdjacentElement('afterend', createInlineAd());
    });
  }
```

#### 6e. Shortlink / watch URL helpers (copy verbatim dari rb.js)

```js
  function encodeSlug(s) {
    try {
      const bytes = new TextEncoder().encode(s);
      let bin = '';
      bytes.forEach(b => { bin += String.fromCharCode(b); });
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch { return encodeURIComponent(s); }
  }
  function decodeSlug(t) {
    try {
      const pad = t.length % 4;
      const bin = atob((pad ? t + '='.repeat(4 - pad) : t).replace(/-/g, '+').replace(/_/g, '/'));
      return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))) || null;
    } catch { return null; }
  }
```

#### 6f. openPlayer — wajib semua VdryAds hooks + token

```js
  async function openPlayer(slug, opts = {}) {
    if (!slug) return;

    // Wajib trigger popunder SAAT user gesture (klik card)
    if (window.VdryAds) VdryAds.triggerPopunder();

    currentSlug  = slug;
    currentToken = null;

    document.body.classList.add('modal-open');
    els.modal.classList.remove('hidden');

    // Reload ads saat modal buka (viewability fix — lihat vidorey-ad-optimization.md)
    if (window.VdryAds) VdryAds.reloadModalAds(els.modal);

    try {
      const data = await apiFetch(`/api/pN/video/${encodeURIComponent(slug)}`);

      // Update URL ke shortlink token
      if (data.token) {
        currentToken = data.token;
        if (!opts.fromHistory) {
          history.pushState({ pNModal: true, pNSlug: slug }, '', `/pN/watch/${data.token}`);
          modalHistoryPushed = true;
        }
      }

      // Update meta tags untuk share preview
      if (window.setVideoMeta) {
        setVideoMeta(data.title, window.location.href, data.thumb, data.description);
      }
      if (window.setVideoJsonLd) {
        setVideoJsonLd(data.title, `/proxy/pN/stream/${encodeURIComponent(slug)}`, data.thumb, data.description);
      }

      // Render video
      els.videoEl.src = `/proxy/pN/stream/${encodeURIComponent(slug)}`;
      els.watchTitle.textContent = data.title || '';
      els.watchDesc.textContent  = data.description || '';

      // Render related
      if (data.related?.length) renderRelated(data.related);

    } catch (err) {
      console.error('[pN] openPlayer error:', err);
    }
  }
```

#### 6g. closeModal — bersihkan semua state

```js
  function closeModal() {
    document.body.classList.remove('modal-open');
    els.modal.classList.add('hidden');

    if (els.videoEl) {
      els.videoEl.pause();
      els.videoEl.removeAttribute('src');
      els.videoEl.load();
    }

    currentSlug  = null;
    currentToken = null;

    if (window.clearVideoMeta) clearVideoMeta();
    if (window.clearVideoJsonLd) clearVideoJsonLd();

    if (modalHistoryPushed) {
      history.back();
      modalHistoryPushed = false;
    } else {
      history.replaceState(null, '', '/pN');
    }
  }
```

#### 6h. Deep-link on page load — baca pathname SEBELUM loadPosts

```js
  // Deep-link: baca SEBELUM loadPosts replaceState-kan URL ke /pN
  const deepLinkMatch = location.pathname.match(/^\/pN\/watch\/([^/]+)\/?$/);

  loadPosts();  // ini akan replaceState('/pN')

  if (deepLinkMatch) {
    const segment = deepLinkMatch[1];
    if (/^[a-z0-9]{11}$/.test(segment)) {
      // Token shortlink → resolve slug dulu
      apiFetch(`/api/s/pN/${segment}`)
        .then(d => { if (d?.slug) { modalHistoryPushed = false; openPlayer(d.slug, { fromHistory: true }); } })
        .catch(() => {});
    } else {
      // Legacy base64 slug
      const slug = decodeSlug(segment);
      if (slug) { modalHistoryPushed = false; openPlayer(slug, { fromHistory: true }); }
    }
  }
```

#### 6i. Popstate handler

```js
  window.addEventListener('popstate', (e) => {
    if (e.state?.pNModal) {
      // Navigasi maju ke modal yang sudah ada history-nya
      openPlayer(e.state.pNSlug, { fromHistory: true });
    } else if (!els.modal.classList.contains('hidden')) {
      // Tombol back browser saat modal terbuka
      els.modal.classList.add('hidden');
      document.body.classList.remove('modal-open');
      currentSlug  = null;
      currentToken = null;
      if (window.clearVideoMeta) clearVideoMeta();
    }
  });
```

#### 6j. Share button

```js
  if (els.shareBtn) {
    els.shareBtn.addEventListener('click', () => {
      const shareUrl = `${location.origin}/pN/watch/${currentToken || encodeSlug(currentSlug)}`;
      navigator.clipboard.writeText(shareUrl).then(() => {
        showToast(_t('toast.copied') || 'URL disalin!');
      }).catch(() => {});
    });
  }
```

#### 6k. VdryAds init di DOMContentLoaded

```js
  document.addEventListener('DOMContentLoaded', () => {
    if (window.VdryAds) VdryAds.initVideoOverlay('pN');
    if (window.VdryAds) VdryAds.initVideoTap('pN');

    // Kategori (jika platform punya)
    if (window.initVdryCategoryPicker && els.catPanel) {
      initVdryCategoryPicker({
        panel:    els.catPanel,
        btn:      els.catBtn,
        apiPath:  '/api/pN/categories',
        onSelect: (item) => {
          catId   = item ? item.id   : null;
          catSlug = item ? item.name : null;
          page    = 1;
          updateSearchHeading();
          loadPosts();
        }
      });
      if (els.catBtn) els.catBtn.style.display = '';
    }
  });

})(); // end IIFE
```

---

### STEP 7 — `public/i18n.js`

Tambah key baru di KEDUA objek `id` dan `en`:

```js
// Di objek id:
'nav.pN': '[deskripsi singkat · niche platform]',

// Di objek en:
'nav.pN': '[short description · platform niche]',
```

Key-key shared yang sudah ada (tidak perlu tambah):
`nav.select`, `nav.other`, `state.loading`, `state.error`, `state.empty`, `state.retry`,
`player.back`, `player.share`, `player.related`, `player.loading`,
`search.ph`, `search.btn`, `cat.btn`, `cat.all`, `cat.empty`,
`heading.search`, `heading.cat`, `heading.clear`, `heading.clearSearch`,
`err.content`, `err.video`, `toast.copied`

---

### STEP 8 — `public/utils.js` — tambah card class ke smartlink trigger

Di fungsi `onFirstCardClick` di bagian bawah `utils.js`, tambah `.pN-card` ke selector string:

```js
var card = e.target.closest(
  '.rb-card,.yb-card,.bk-card,.sb-card,.xn-card,.vd-card,.zg-card,.pN-card' +
  ',.tp-slide:not(.tp-slide-ad):not(.tp-slide-end)'
);
```

⚠️ `utils.js` mengandung smartlink one-shot trigger (bukan file terpisah). Tidak ada file `smartlinks.js`.

---

### STEP 9 — `public/style.css`

Tambah di bawah blok platform terakhir. Scope semua rule ke `body.pN-page`:

```css
/* ─── Platform N ─────────────────────────────────────── */

/* Avatar warna di nav drawer */
.ps-avatar-pN { background: linear-gradient(135deg, #WARNA1, #WARNA2); }

/* Card grid — platform bisa pakai class rb-card (inherited) atau pN-card custom */
body.pN-page .pN-card { … }
```

CSS shared yang sudah ada (tidak perlu tambah ulang):
`.rb-grid`, `.rb-card`, `.rb-card-thumb`, `.rb-card-info`, `.rb-card-title`,
`.ad-inline-grid`, `.vd-sticky-top`, `.vd-sticky-bottom`,
`.video-ad-overlay`, `.video-tap-zone`, `.watch-ad-slot`,
`.modal`, `.modal-fullpage`, `.modal-body`, `.shell`, `.topbar`, `.nav-drawer`

---

### STEP 10 — `firebase.json`

Tambah **SEBELUM** catch-all `"**"`:

```json
{ "source": "/pN",    "destination": "/pN.html" },
{ "source": "/pN/**", "destination": "/pN.html" }
```

Tanpa ini: semua URL `/pN/*` di Firebase production serve `index.html` (Platform 1).

---

### STEP 11 — `public/sitemap.xml`

```xml
<url>
  <loc>https://vidorey.web.app/pN</loc>
  <changefreq>daily</changefreq>
  <priority>0.8</priority>
</url>
```

---

### STEP 12 — Update dokumentasi

| File | Update |
|------|--------|
| `adding-scraping-platform/SKILL.md` | Tambah baris Platform N ke tabel, update "9 platforms" → "10 platforms" |
| `replit.md` | Tambah ke tabel platform, scraper list, monitor events |
| `MEMORY.md` | Tambah `[Platform N Architecture](pN-architecture.md)` |
| `vidorey-modular-refactor.md` | Tambah `pN.js`, update jumlah platform |
| `vidorey-nav-drawer.md` | Tambah baris platform + avatar CSS class |
| `vidorey-caching-strategy.md` | Tambah cache baru + getCacheStats order |
| `vidorey-ad-optimization.md` | Tambah baris Platform N ke tabel status per platform |
| `vidorey-csp-allowlist.md` | Tambah domain baru jika ada |
| `vidorey-seo.md` | Tambah baris meta tags table, update jumlah halaman |
| `vidorey-i18n.md` | Tambah key `nav.pN` ke seksi key categories |

---

### STEP 13 — Verifikasi akhir

```bash
# 1. Endpoint listing
curl -s "http://localhost:5000/api/pN/posts" | jq '.posts | length'

# 2. Video resolve + token
curl -s "http://localhost:5000/api/pN/video/SAMPLE_SLUG" | jq '{title, token}'

# 3. Stream proxy
curl -I "http://localhost:5000/proxy/pN/stream/SAMPLE_SLUG"
# → Harus 200 dengan Content-Type: video/* atau application/x-mpegurl

# 4. SPA routes — KRITIS: harus 200, bukan serve index.html
curl -I "http://localhost:5000/pN"
curl -I "http://localhost:5000/pN/watch/abc12345678"
# Keduanya harus 200 dengan content pN.html

# 5. Shortlink round-trip
TOKEN=$(curl -s "http://localhost:5000/api/pN/video/SAMPLE_SLUG" | jq -r '.token')
curl -s "http://localhost:5000/api/s/pN/$TOKEN" | jq '.slug'
# → harus sama dengan SAMPLE_SLUG
```

**Checklist manual browser:**
- [ ] Video play end-to-end: listing → klik card → player → video mulai
- [ ] Address bar tunjukkan `/pN/watch/<11char-token>` setelah video load
- [ ] Share button → copy URL → paste di tab baru → video langsung terbuka (deep-link)
- [ ] Browser back dari modal → kembali ke listing (bukan tab baru)
- [ ] Nav drawer buka dengan burger button
- [ ] Platform N muncul di nav drawer **semua 9 platform lain** di posisi benar
- [ ] Klik platform N dari nav drawer platform lain → pindah ke pN (bukan Platform 1)
- [ ] Iklan muncul: sticky top banner, sticky bottom, inline grid (scroll 8+ card), popunder (klik card pertama), video overlay (tunggu 5s setelah play)
- [ ] Social Bar muncul (notifikasi floating)
- [ ] Adblock banner muncul jika ad-blocker aktif
- [ ] Klik "EN" toggle → semua teks UI beralih bahasa termasuk heading dinamis
- [ ] Reload → bahasa yang dipilih terpertahankan (localStorage)
- [ ] Console browser bersih (tidak ada CSP error, tidak ada `_t is not defined`)
- [ ] Monitor dashboard `/monitor` → event `pN_video` dan `pN_posts` muncul dengan badge warna yang benar
- [ ] Firebase: `curl -I https://vidorey.web.app/pN` → serve `pN.html` (bukan `index.html`)

---

## TikTok-style Platform — Perbedaan dari Listing

Gunakan `tp.js` + `tp.html` sebagai referensi. Perbedaan utama:

### Backend (scraper)

- Tidak ada `/api/pN/video/:slug` yang resolve URL untuk modal
- Route utama: `/api/pN/posts` return array video dengan field `{ id, title, thumb, sources: [{type:'hls',url}] }`
- Proxy stream/HLS tetap ada (tidak expose URL CDN ke browser)
- `registerSlug` tetap dipanggil untuk shortlink slide

### HTML

- Tidak ada watch modal
- Feed container: `<div id="pNFeed" class="pN-feed">` (bukan grid)
- Fixed banner bawah topbar: `<div id="pNDisplayTop" class="tp-display-top" data-ad-zone="mb-320"></div>`
- Tidak ada `.ad-display-slot`, tidak ada inline grid, tidak ada watch modal ad slots
- Topbar punya ID custom `pNNavBurger` (bukan `navBurger` standar)
- Tetap ada: sticky top/bottom, native banner, popunder script, social bar
- Nav item masuk seksi **"Fitur Lain"** (bawah divider)

### JS — IntersectionObserver pattern

```js
/* ── Play/pause berdasarkan viewport ── */
const ioPlay = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    const slide = entry.target;
    const video = slide.querySelector('.pN-video');
    if (!video) return;
    if (entry.intersectionRatio >= 0.75) {
      video.play().catch(() => {});
    } else {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  });
}, { threshold: [0, 0.75] });

/* ── Infinite scroll trigger ── */
const ioEnd = new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting) loadNextBatch();
}, { threshold: 0.1 });
```

### JS — createAdSlide (setiap 5 video, bukan createInlineAd)

```js
function createAdSlide() {
  const slide = document.createElement('div');
  slide.className = 'pN-slide pN-slide-ad';
  slide.setAttribute('aria-hidden', 'true');

  const body    = document.createElement('div');
  body.className = 'tp-ad-body';
  const label   = document.createElement('p');
  label.className = 'tp-ad-label';
  label.textContent = 'Iklan';
  const adSlot  = document.createElement('div');
  adSlot.className = 'tp-ad-display';
  body.appendChild(label);
  body.appendChild(adSlot);
  slide.appendChild(body);

  /* Inject 300×250 programatik — bukan data-ad-zone karena tidak ada ads.js refresh cycle di sini */
  const scOpt = document.createElement('script');
  scOpt.textContent = "atOptions={'key':'d50b941ac6d9bd5749dcdb0b417bf348','format':'iframe','height':250,'width':300,'params':{}};";
  adSlot.appendChild(scOpt);
  const scInv = document.createElement('script');
  scInv.src = 'https://www.highperformanceformat.com/d50b941ac6d9bd5749dcdb0b417bf348/invoke.js';
  adSlot.appendChild(scInv);

  return slide;
}

// Di appendBatch:
batch.forEach((v, i) => {
  const slide = createVideoSlide(v);
  feed.appendChild(slide);
  ioPlay.observe(slide);

  if ((totalSlides + i + 1) % 5 === 0) {
    const adSlide = createAdSlide();
    feed.appendChild(adSlide);
    // Ad slide TIDAK di-observe ioPlay
    ioEnd.observe(adSlide); // trigger scroll hanya dari ad/end slide
  }
});
```

### JS — VdryAds untuk TikTok

```js
// Tidak ada initVideoOverlay, tidak ada initVideoTap
// Gunakan initTpFeed (sudah ada di ads.js, khusus tp.html) ATAU
// buat initPNFeed sendiri dengan pola serupa:
if (window.VdryAds) VdryAds.initTpFeed();
// atau:
// Manual: tap delegation + tpAdBar overlay
```

---

## Appendix: Shared utilities di utils.js

`utils.js` di-load di semua platform. Ekspose ke `window`:

| Fungsi | Deskripsi | Kapan panggil |
|--------|-----------|---------------|
| `setVideoJsonLd(title, contentUrl, thumbUrl, desc)` | Inject VideoObject JSON-LD schema ke `<head>` saat video dibuka | Dalam `openPlayer()` setelah data fetch |
| `clearVideoJsonLd()` | Hapus JSON-LD saat player ditutup | Dalam `closeModal()` |
| `setVideoMeta(title, url, imageUrl, desc)` | Update canonical + og:url/title/desc/image + twitter tags | Dalam `openPlayer()` setelah URL token tersedia |
| `clearVideoMeta()` | Kembalikan meta ke nilai halaman listing | Dalam `closeModal()` |
| `initVdryCategoryPicker(opts)` | Render dropdown kategori (fetch lazy, chip UI, callback onSelect) | Dalam `DOMContentLoaded` jika platform punya kategori |

`opts` untuk `initVdryCategoryPicker`:
```js
{
  panel:    document.getElementById('pNCatPanel'),  // container div
  btn:      document.getElementById('pNCatBtn'),    // trigger button
  apiPath:  '/api/pN/categories',                   // endpoint array [{id, slug, name}]
  onSelect: (item) => { /* item = {id,slug,name} atau null untuk "Semua" */ }
}
```

---

## Appendix: Ringkasan semua file yang diubah

| File | Aksi |
|------|------|
| `lib/scrapers/pN.js` | **BARU** — scraper + SPA routes `/pN` + `/pN/*` WAJIB di sini |
| `server.js` | require router, caches, shortlink whitelist, CSP domain baru |
| `lib/monitor.js` | trackRequest branches + badge CSS |
| `public/pN.html` | **BARU** — GTM, SEO, OG, schema, H1, nav drawer, semua ad slots, script stack |
| `public/pN.js` | **BARU** — app logic: _t(), langchange, createInlineAd, VdryAds hooks, token/shortlink flow |
| `public/i18n.js` | tambah key `nav.pN` di id + en |
| `public/utils.js` | tambah `.pN-card` ke smartlink CARD_SEL selector |
| `public/style.css` | `.ps-avatar-pN`, `body.pN-page` rules |
| `public/index.html` | tambah pN ke nav drawer (posisi sesuai tipe) |
| `public/rb.html` | tambah pN ke nav drawer |
| `public/yb.html` | tambah pN ke nav drawer |
| `public/bk.html` | tambah pN ke nav drawer |
| `public/tp.html` | tambah pN ke nav drawer |
| `public/sb.html` | tambah pN ke nav drawer |
| `public/vd.html` | tambah pN ke nav drawer |
| `public/xn.html` | tambah pN ke nav drawer |
| `public/zg.html` | tambah pN ke nav drawer |
| `firebase.json` | dua rewrite `/pN` + `/pN/**` sebelum catch-all |
| `public/sitemap.xml` | tambah `<url>` baru |
| Memory + docs files | update MEMORY.md index + file-file topik terkait |
