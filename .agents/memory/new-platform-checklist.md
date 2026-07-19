---
name: New Platform Checklist
description: Checklist lengkap & berurutan saat menambah Platform N ke Vidorey — tidak ada yang boleh terlewat.
---

# Checklist Platform Baru Vidorey

Ikuti urutan ini dari atas ke bawah. Tandai selesai sebelum lanjut ke item berikutnya.

---

## FASE 1 — Validasi Feasibility (WAJIB sebelum mulai)

- [ ] Curl setiap lapisan chain video dari **server** (bukan browser)
- [ ] Chain harus resolve sampai ke MP4 atau m3u8 tanpa JS-rendering
- [ ] Jika ada layer yang return 403 / SPA <2KB / butuh JS → **stop, platform tidak feasible**
- [ ] Tidak boleh ada iframe/embed sumber yang muncul di browser user (lihat `no-source-ads.md`)

---

## FASE 2 — Backend (`lib/scrapers/pN.js`)

- [ ] Buat file `lib/scrapers/pN.js` — export `{ router, caches }`
- [ ] Tidak ada import dari sibling scraper files (isolasi penuh)
- [ ] Path `public/` dari scraper: `path.join(__dirname, '..', '..', 'public', ...)`
- [ ] **WAJIB: tambah SPA routes di scraper ini sendiri:**
  ```js
  const path = require('path');
  const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
  router.get('/pN',   (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'pN.html')));
  router.get('/pN/*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'pN.html')));
  ```
  ⚠️ Tanpa ini, klik di nav drawer dan deep-link `/pN/watch/<token>` akan serve `index.html` (Platform 1). Bug ini sudah terjadi pada P6 (SB).
- [ ] Register router di `server.js`: `app.use(pN.router)` + tambah `pN.caches` ke health/detail
- [ ] Tambah shortlink platform list di `server.js`: tambah `'pN'` ke array whitelist di `/api/s/:platform/:token`
- [ ] Tambah trackRequest branches di `lib/monitor.js`:
  - `pN_video` (untuk request stream/video)
  - `pN_posts` (untuk request listing/feed)
- [ ] Tambah badge CSS di `monitorDashboardHtml` (di monitor.js) untuk platform baru
- [ ] Test endpoint dari shell: `curl http://localhost:5000/api/pN/...`

---

## FASE 3 — HTML Baru (`public/pN.html`)

### 3a. Head — meta tags wajib
```html
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
  <title>Vidorey [N] - [English adult keyword title]</title>
  <meta name="description" content="[English, adult keywords, max 160 char]" />
  <meta name="keywords" content="free porn, xxx videos, sex videos, [platform-specific keywords]" />
  <meta name="google-site-verification" content="Vl8CnSoQmgdUxFfXGw4k7nzAPRZBgImHr2OrBPnmaAI" />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="https://vidorey.web.app/pN" />
  <meta name="theme-color" content="#121212" />
```

### 3b. Head — GTM snippet (SEBELUM </head>)
```html
  <!-- Google Tag Manager -->
  <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
  new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
  j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
  'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
  })(window,document,'script','dataLayer','GTM-NWZSVQT9');</script>
  <!-- End Google Tag Manager -->
```

### 3c. Head — Open Graph
```html
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Vidorey" />
  <meta property="og:title" content="[shorter title]" />
  <meta property="og:description" content="[same as description]" />
  <meta property="og:url" content="https://vidorey.web.app/pN" />
  <meta property="og:image" content="https://vidorey.web.app/logo.png" />
  <meta property="og:locale" content="en_US" />
```
**WAJIB `en_US` bukan `id_ID`** — ini tentukan apakah crawler kirim traffic Tier 1.

### 3d. Head — Twitter Card
```html
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="[same as og:title]" />
  <meta name="twitter:description" content="[same as og:description]" />
  <meta name="twitter:image" content="https://vidorey.web.app/logo.png" />
```

### 3e. Head — CSS, Favicon, Schema.org
```html
  <link rel="stylesheet" href="/style.css" />
  <link rel="icon" type="image/png" href="/logo.png" />
  <script type="application/ld+json">
  [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "name": "Vidorey",
      "url": "https://vidorey.web.app/",
      "description": "Watch free XXX videos and porn movies online. Thousands of HD sex videos updated daily. No registration needed.",
      "potentialAction": {
        "@type": "SearchAction",
        "target": "https://vidorey.web.app/?q={search_term_string}",
        "query-input": "required name=search_term_string"
      }
    },
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "name": "Vidorey [N] - [title]",
      "url": "https://vidorey.web.app/pN",
      "description": "[same as meta description]",
      "isPartOf": { "@type": "WebSite", "url": "https://vidorey.web.app/" }
    }
  ]
  </script>
</head>
```
**WAJIB array `[WebSite, WebPage]`** — bukan hanya WebPage saja. Semua 7 halaman existing sudah pakai format ini.

### 3f. Body — GTM noscript (TEPAT SETELAH `<body ...>`)
```html
<body class="pN-page">
  <!-- Google Tag Manager (noscript) -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-NWZSVQT9"
  height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
  <!-- End Google Tag Manager (noscript) -->
```

### 3g. Body — Nav Drawer

#### ATURAN PENEMPATAN NAV ITEM (KRITIS)

Nav drawer dibagi dua seksi:

**Seksi Atas** — Platform listing biasa (grid/card + pagination + search). Ditempatkan SEBELUM `<hr class="nav-section-divider">`:
- P1 `/` Vidorey 1
- P2 `/rb` Vidorey 2
- P3 `/yb` Vidorey 3
- P4 `/bk` Vidorey 4
- P6 `/sb` Vidorey 5
- ← **Platform listing baru masuk di sini**

`<hr class="nav-section-divider">`
`<div class="nav-drawer-label">Fitur Lain</div>`

**Seksi Bawah "Fitur Lain"** — KHUSUS platform TikTok-style (vertical scroll-snap, tidak ada grid/card):
- P5 `/tp` Vidorey TikTok 1
- P6 `/rc` Vidorey TikTok 2
- ← **Platform TikTok-style baru masuk di sini**

**⚠️ Bug yang sudah terjadi:** P6 (SB/Vidorey 5) awalnya ditaruh di seksi "Fitur Lain" → user complaint. Listing platform wajib di atas divider, TikTok wajib di bawah.

Langkah untuk update nav drawer:
- Copy blok `<!-- NAV DRAWER -->` dari platform terdekat
- Ubah `class="nav-plat-item active" aria-current="page"` → hanya ke item platform baru
- Hapus `.active` dari item lain
- Hamburger ID: gunakan `pNNavBurger` jika topbar custom (TikTok), `navBurger` jika topbar standar (listing)
- Nama UI di drawer: **TIDAK BOLEH sebut nama web sumber** (ruangbokep, tik.porn, situsbokep, dst.)

### 3h. Body — H1 SEO (di dalam `<main>`)
```html
<main id="pNFeed" class="pN-feed">
  <h1 class="sr-only">[Main keyword phrase - English, adult, specific to platform]</h1>
  ...
</main>
```
`.sr-only` sudah ada di `style.css` — tidak perlu tambah ulang.

### 3i. Body — Iklan Adsterra
- Copy slot iklan dari platform yang paling mirip (listing → dari rb/yb/bk/sb, feed → dari tp/rc)
- Jika pakai ad script domain baru → **wajib tambah ke CSP dulu** (lihat Fase 4)
- **Untuk platform dengan modal:** ganti semua `<script>atOptions...</script>` di dalam modal dengan `<div data-ad-zone="ZONE_NAME"></div>`. Jangan inline script di dalam modal — lihat `vidorey-ad-optimization.md`.
- **Tambah video overlay dan tap zone div** di dalam `.video-stage`:
  ```html
  <!-- Video overlay bar (muncul saat video play) -->
  <div id="pNVideoAdOverlay" class="video-ad-overlay" style="display:none" aria-hidden="true">
    <div class="video-ad-bar">
      <span class="video-ad-label"></span>
      <button id="pNVideoAdClose" class="video-ad-close-btn" disabled>Lewati <span id="pNVideoAdTimer">5</span>s</button>
    </div>
    <div id="pNVideoAdContent" class="video-ad-content"></div>
  </div>
  <!-- Transparent tap zone -->
  <div id="pNVideoTapZone" class="video-tap-zone" role="button" aria-label="Video area"></div>
  ```

### 3j. Body — Script sebelum `</body>`
```html
<script src="/i18n.js"></script>   <!-- WAJIB: harus PERTAMA, sebelum config.js -->
<script src="/config.js"></script>
<script src="/utils.js"></script>
<script src="/adblock.js"></script>
<script src="/ads.js"></script>    <!-- WAJIB: sebelum platform JS -->
<script src="/pN.js"></script>     <!-- app logic platform -->
<script src="/smartlinks.js"></script>  <!-- WAJIB ada -->
```
⚠️ **`i18n.js` HARUS urutan pertama** — `config.js` dan `pN.js` bergantung pada `window._t()` yang di-export `i18n.js`. Jika urutan terbalik, `_t is not defined` error.
⚠️ **`ads.js` HARUS sebelum platform JS** — platform JS memanggil `VdryAds.*` saat init.

---

### 3k. i18n — WAJIB (semua string user-facing harus bilingual)

Vidorey mendukung toggle EN/ID. Setiap platform baru **wajib** mengimplementasikan i18n penuh. Lihat `vidorey-i18n.md` untuk daftar key lengkap.

#### Topbar — lang toggle button
Tambahkan `<button id="langToggle" class="lang-toggle-btn">EN</button>` di topbar:
- **Platform listing (topbar standar):** Letakkan setelah div `.brand`, sebelum elemen lain
- **Platform TikTok-style:** Letakkan di dalam `.tp-topbar` dengan `style="margin-left:auto"`

#### Nav Drawer — data-i18n wajib
```html
<!-- Label seksi nav -->
<div class="nav-drawer-label" data-i18n="nav.select">Platform Lain</div>
<div class="nav-drawer-label" data-i18n="nav.other">Fitur Lain</div>

<!-- Deskripsi platform baru (ps-desc span) -->
<span class="ps-desc" data-i18n="nav.pN">[deskripsi ID di sini]</span>
```
**WAJIB tambah key `nav.pN`** (ID + EN) ke `public/i18n.js` di dictionary kedua bahasa.

#### HTML state views — data-i18n wajib
```html
<p data-i18n="state.loading">Memuat…</p>
<p data-i18n="state.empty">Tidak ada video ditemukan.</p>
<button class="btn-retry" data-i18n="state.retry">Coba lagi</button>
```

#### HTML player modal — data-i18n wajib
```html
<span data-i18n="player.back">Kembali</span>       <!-- tombol back -->
<span data-i18n="player.share">Bagikan</span>      <!-- tombol share -->
<h3 data-i18n="player.related">Video Lainnya</h3>  <!-- heading related -->
<p data-i18n="player.loading">Memuat video…</p>    <!-- loading state -->
```

#### HTML search bar (jika platform punya search)
```html
<input ... data-i18n-placeholder="search.ph" placeholder="Cari video…">
<button ...><span data-i18n="search.btn">Cari</span></button>
```

#### HTML category button (jika platform punya kategori)
```html
<button ...><span data-i18n="cat.btn">Kategori</span></button>
```

#### JS — pN.js: ganti semua string hardcoded dengan `_t()`
- Heading dinamis (search/kategori): `_t('heading.search')`, `_t('heading.cat')`, `_t('heading.clear')`, `_t('heading.clearSearch')`
- Semua pesan error/toast: `_t('err.content')`, `_t('err.video')`, `_t('toast.copied')`, dll.
- Tambah **langchange listener** sebelum penutup IIFE:
  ```js
  window.addEventListener('langchange', function () {
    updateSearchHeading(); // atau nama fungsi heading builder di platform ini
  });
  ```
  ⚠️ Tanpa listener ini, heading tidak ter-update saat user toggle bahasa tanpa reload.

#### Jika butuh key baru (string platform-specific)
- Tambah key baru ke `public/i18n.js` di KEDUA objek `id` dan `en`
- Konvensi penamaan: `pN.namaKey` (prefix platform) untuk string yang unik ke platform ini

---

## FASE 4 — CSP (`server.js`)

- [ ] Cek setiap `<script src="https://...">` baru di pN.html
- [ ] Tambah domainnya ke array `scriptSrc` di Helmet CSP di `server.js`
- [ ] **Tanpa ini, script diblokir browser diam-diam** (tidak ada error di server, hanya browser console)
- [ ] Lihat `vidorey-csp-allowlist.md` untuk daftar domain yang sudah ada

---

## FASE 5 — Update Semua 7 HTML yang Ada

- [ ] **Tambah platform baru ke nav drawer di SEMUA HTML yang ada**: `index, rb, yb, bk, sb, tp` + platform baru `pN.html` itu sendiri
- [ ] Format entry nav drawer baru — **`data-i18n` pada `ps-desc` WAJIB**:
```html
<a class="nav-plat-item" href="/pN">
  <div class="ps-avatar ps-avatar-pN"><img src="/logo.png" alt="Vidorey"></div>
  <div class="ps-info">
    <span class="ps-name">Vidorey [N]</span>
    <span class="ps-desc" data-i18n="nav.pN">[deskripsi singkat · tema dalam ID]</span>
  </div>
</a>
```
- [ ] **Listing platform → sisipkan SEBELUM `<hr class="nav-section-divider">`** (seksi atas)
- [ ] **TikTok-style → sisipkan SETELAH `<div class="nav-drawer-label">Fitur Lain</div>`** (seksi bawah)
- [ ] Tambah avatar CSS class `.ps-avatar-pN` di `style.css` (gradient background)
- [ ] Update `vidorey-nav-drawer.md` — tambah baris di tabel nama platform
- [ ] Update `vidorey-smartlinks.md` — tambah card class ke CARD_SEL

---

## FASE 6 — firebase.json + SEO Static Files

- [ ] **`firebase.json` — WAJIB** tambah dua rewrite SEBELUM catch-all `"**"`:
  ```json
  { "source": "/pN",    "destination": "/pN.html" },
  { "source": "/pN/**", "destination": "/pN.html" },
  ```
  Tanpa ini, `/pN/*` di Firebase production serve `index.html` (Platform 1).

- [ ] Tambah `<url>` baru ke `public/sitemap.xml`:
```xml
<url>
  <loc>https://vidorey.web.app/pN</loc>
  <changefreq>daily</changefreq>
  <priority>0.8</priority>
</url>
```
- [ ] `robots.txt` — tidak perlu ubah (sudah allow semua kecuali /monitor dan /health)

---

## FASE 7 — Verifikasi Akhir

- [ ] Restart workflow → cek log tidak ada error
- [ ] Curl endpoint video dari shell → stream berjalan
- [ ] `curl -I http://localhost:5000/pN` → **wajib HTTP 200** (bukan 200 serve index.html)
- [ ] `curl -I http://localhost:5000/pN/watch/abc123` → HTTP 200 (SPA route)
- [ ] Buka `/pN` di browser → halaman muncul, nav drawer ada platform baru di posisi benar
- [ ] Verifikasi nav drawer seksi: listing platform di atas divider, TikTok di bawah "Fitur Lain"
- [ ] Klik platform baru di nav drawer dari semua platform lain → pindah ke platform baru (bukan Platform 1)
- [ ] **i18n — klik tombol "EN" di topbar** → semua teks UI beralih ke Inggris (placeholder, button, heading, nav drawer)
- [ ] **i18n — klik "ID"** → kembali ke Indonesia, heading dinamis (search/kategori) juga berubah
- [ ] **i18n — reload halaman** → bahasa yang dipilih terpertahankan (localStorage)
- [ ] Cek browser console → tidak ada CSP error, tidak ada `_t is not defined`
- [ ] Cek GTM Preview mode → tag GA4 terfiring di pN page
- [ ] Google Search Console → "URL Inspection" → test live URL → harus lulus
- [ ] Bing Webmaster Tools → "Live URL" → H1 tidak boleh missing

---

## Ringkasan File yang Diubah (template)

| File | Aksi |
|------|------|
| `lib/scrapers/pN.js` | BARU — **include SPA routes `/pN` + `/pN/*`** |
| `server.js` | require router, health caches, shortlink whitelist, CSP domain |
| `lib/monitor.js` | trackRequest branches + badge CSS |
| `public/pN.html` | BARU (GTM, meta, OG, schema, H1, nav drawer di posisi benar, ads, **i18n.js script pertama, langToggle button, data-i18n attrs**, smartlinks) |
| `public/pN.js` | BARU (app logic — **semua string pakai `_t()`, langchange listener wajib**, VdryAds hooks di openModal + init) |
| `public/i18n.js` | Tambah key `nav.pN` (ID + EN) + key platform-specific lainnya jika diperlukan |
| `public/style.css` | tambah `.ps-avatar-pN`, `.pN-page` rules |
| `public/index.html` | tambah platform baru ke nav drawer (posisi sesuai tipe) |
| `public/rb.html` | tambah platform baru ke nav drawer |
| `public/yb.html` | tambah platform baru ke nav drawer |
| `public/bk.html` | tambah platform baru ke nav drawer |
| `public/sb.html` | tambah platform baru ke nav drawer |
| `public/tp.html` | tambah platform baru ke nav drawer |
| `public/smartlinks.js` | tambah card selector ke `CARD_SEL` |
| `public/sitemap.xml` | tambah `<url>` baru |
| `firebase.json` | tambah dua rewrite `/pN` + `/pN/**` |

---

## Memory files yang perlu diupdate setelah platform baru selesai

- `MEMORY.md` — tambah entri baru `[Platform N Architecture](pN-architecture.md)`
- `vidorey-nav-drawer.md` — tambah baris di tabel nama platform + avatar CSS class
- `vidorey-caching-strategy.md` — tambah cache baru Platform N ke tabel + update getCacheStats Order
- `vidorey-csp-allowlist.md` — tambah domain ad baru jika ada
- `vidorey-smartlinks.md` — update CARD_SEL + daftar halaman
- `vidorey-modular-refactor.md` — update platform count + scraper list
- `vidorey-seo.md` — update jumlah halaman + tambah baris di tabel meta tags
- `vidorey-i18n.md` — tambah key baru platform N ke seksi "Key translation categories" + update "File coverage"
- `replit.md` — update platform table, scraper list, monitor events, iklan section
- `adding-scraping-platform/SKILL.md` — update platform table + count + nav drawer rule
