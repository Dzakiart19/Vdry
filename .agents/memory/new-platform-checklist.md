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
- [ ] Register router di `server.js`: `app.use(pN.router)` + tambah `pN.caches` ke health/detail
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
  {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "Vidorey [N] - [title]",
    "url": "https://vidorey.web.app/pN",
    "description": "[same as meta description]",
    "isPartOf": { "@type": "WebSite", "url": "https://vidorey.web.app/" }
  }
  </script>
</head>
```

### 3f. Body — GTM noscript (TEPAT SETELAH `<body ...>`)
```html
<body class="pN-page">
  <!-- Google Tag Manager (noscript) -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-NWZSVQT9"
  height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
  <!-- End Google Tag Manager (noscript) -->
```

### 3g. Body — Nav Drawer (copy dari HTML lain, ganti active item)
- Copy blok `<!-- NAV DRAWER -->` dari platform terdekat
- Ubah `class="nav-plat-item active" aria-current="page"` → hanya ke item platform baru
- Hapus `.active` dari item lain
- Hamburger ID: gunakan `pNNavBurger` jika topbar custom, `navBurger` jika topbar standar
- Nama UI di drawer: **TIDAK BOLEH sebut nama web sumber** (ruangbokep, tik.porn, dst.)

### 3h. Body — H1 SEO (di dalam `<main>`)
```html
<main id="pNFeed" class="pN-feed">
  <h1 class="sr-only">[Main keyword phrase - English, adult, specific to platform]</h1>
  ...
</main>
```
`.sr-only` sudah ada di `style.css` — tidak perlu tambah ulang.

### 3i. Body — Iklan Adsterra
- Copy slot iklan dari platform yang paling mirip (listing → dari rb/yb/bk, feed → dari tp/rc)
- Jika pakai ad script domain baru → **wajib tambah ke CSP dulu** (lihat Fase 4)

### 3j. Body — Script sebelum `</body>`
```html
<script src="/config.js"></script>
<script src="/pN.js"></script>   <!-- app logic platform -->
<script src="/smartlinks.js"></script>  <!-- WAJIB ada -->
```

---

## FASE 4 — CSP (`server.js`)

- [ ] Cek setiap `<script src="https://...">` baru di pN.html
- [ ] Tambah domainnya ke array `scriptSrc` di Helmet CSP di `server.js`
- [ ] **Tanpa ini, script diblokir browser diam-diam** (tidak ada error di server, hanya browser console)
- [ ] Lihat `vidorey-csp-allowlist.md` untuk daftar domain yang sudah ada

---

## FASE 5 — Update Semua 6 HTML yang Ada

- [ ] **Tambah platform baru ke nav drawer di SEMUA 6 HTML**: `index, rb, yb, bk, tp, rc`
- [ ] Format entry nav drawer baru:
```html
<a class="nav-plat-item" href="/pN">
  <div class="ps-avatar ps-avatar-pN"><img src="/logo.png" alt="Vidorey"></div>
  <div class="ps-info">
    <span class="ps-name">Vidorey [N]</span>
    <span class="ps-desc">[deskripsi singkat · tema]</span>
  </div>
</a>
```
- [ ] Tambah avatar CSS class `.ps-avatar-pN` di `style.css` (gradient background)
- [ ] Update `vidorey-nav-drawer.md` — tambah baris di tabel nama platform

---

## FASE 6 — SEO Static Files

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
- [ ] Buka `https://vidorey.web.app/pN` di browser → halaman muncul, nav drawer ada platform baru
- [ ] Cek browser console → tidak ada CSP error
- [ ] Cek GTM Preview mode → tag GA4 terfiring di pN page
- [ ] Google Search Console → "URL Inspection" → test live URL → harus lulus
- [ ] Bing Webmaster Tools → "Live URL" → H1 tidak boleh missing

---

## Ringkasan File yang Diubah (template)

| File | Aksi |
|------|------|
| `lib/scrapers/pN.js` | BARU |
| `server.js` | register router, health caches, CSP domain |
| `lib/monitor.js` | trackRequest branches + badge CSS |
| `public/pN.html` | BARU (GTM, meta, OG, schema, H1, nav drawer, ads, smartlinks) |
| `public/pN.js` | BARU (app logic) |
| `public/style.css` | tambah `.ps-avatar-pN`, `.pN-page` rules |
| `public/index.html` | tambah platform baru ke nav drawer |
| `public/rb.html` | tambah platform baru ke nav drawer |
| `public/yb.html` | tambah platform baru ke nav drawer |
| `public/bk.html` | tambah platform baru ke nav drawer |
| `public/tp.html` | tambah platform baru ke nav drawer |
| `public/rc.html` | tambah platform baru ke nav drawer |
| `public/sitemap.xml` | tambah `<url>` baru |

---

## Memory files yang perlu diupdate setelah platform baru selesai

- `MEMORY.md` — tambah entri baru `[Platform N Architecture](pN-architecture.md)`
- `vidorey-nav-drawer.md` — tambah baris di tabel nama platform + avatar CSS class
- `vidorey-csp-allowlist.md` — tambah domain ad baru
- `vidorey-seo.md` — tidak perlu update (template sudah general)
