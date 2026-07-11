---
name: Vidorey SEO Strategy
description: Meta tag template, keyword strategy, robots.txt, sitemap.xml — untuk naikkan CPM via Tier 1 traffic.
---

## Tujuan
Semua halaman pakai keyword bahasa **Inggris** agar Google indexing mengirim traffic Tier 1 (US/UK/EU, CPM $2–5) bukan hanya Indonesia (CPM $0.05–0.3).

## Template `<head>` lengkap tiap platform baru

```html
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
  <!-- Google Tag Manager -->
  <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
  new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
  j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
  'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
  })(window,document,'script','dataLayer','GTM-NWZSVQT9');</script>
  <!-- End Google Tag Manager -->
  <title>Vidorey [N] - [English adult keyword title]</title>
  <meta name="description" content="[English description, adult keywords, max 160 char]" />
  <meta name="keywords" content="free porn, xxx videos, sex videos, [platform-specific keywords]" />
  <meta name="google-site-verification" content="Vl8CnSoQmgdUxFfXGw4k7nzAPRZBgImHr2OrBPnmaAI" />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="https://vidorey.web.app/pN" />
  <meta name="theme-color" content="#121212" />
  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Vidorey" />
  <meta property="og:title" content="[same as title, shorter]" />
  <meta property="og:description" content="[same as description]" />
  <meta property="og:url" content="https://vidorey.web.app/pN" />
  <meta property="og:image" content="https://vidorey.web.app/logo.png" />
  <meta property="og:locale" content="en_US" />   ← WAJIB en_US, bukan id_ID
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="[same as og:title]" />
  <meta name="twitter:description" content="[same as og:description]" />
  <meta name="twitter:image" content="https://vidorey.web.app/logo.png" />
  <!-- Favicon -->
  <link rel="stylesheet" href="/style.css" />
  <link rel="icon" type="image/png" href="/logo.png" />
  <!-- Schema.org — WAJIB array [WebSite, WebPage] -->
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
<body class="pN-page">
  <!-- Google Tag Manager (noscript) -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-NWZSVQT9"
  height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
  <!-- End Google Tag Manager (noscript) -->
```

**Why:** `og:locale=id_ID` → crawler anggap konten Indonesia → traffic Tier 1 tidak dikirim, CPM rendah. `lang="en"` + `og:locale=en_US` wajib di semua halaman. GTM wajib di head (script) + tepat setelah `<body>` (noscript). google-site-verification wajib di semua halaman agar GSC tetap valid.

## File statis SEO

| File | Isi |
|---|---|
| `public/robots.txt` | `Allow: /`, `Disallow: /monitor`, `Disallow: /health`, `Sitemap:` link |
| `public/sitemap.xml` | 6 URL platform, `changefreq: daily`, priority 1.0 (index) / 0.9–0.8 (platform) |

## Favicon
`<link rel="icon" type="image/png" href="/logo.png" />` — wajib di semua HTML. tp.html & rc.html sempat ketinggalan, sudah ditambah.

## Schema.org (Structured Data)
- **Semua 6 halaman** → JSON-LD array `[WebSite, WebPage]` — keduanya selalu ada bersamaan
- `WebSite` schema: name, url, description, potentialAction (SearchAction ke `/?q={search_term_string}`)
- `WebPage` schema: name, url, description, isPartOf → WebSite utama
- Format: `<script type="application/ld+json">[ {...WebSite}, {...WebPage} ]</script>` tepat sebelum `</head>`
- Platform baru wajib pakai format array ini — jangan hanya WebPage saja

## Google Analytics / GTM
- GTM container: `GTM-NWZSVQT9` — dipasang di semua 6 HTML (head + noscript body)
- GA4 Measurement ID: `G-6MB6SQTZWK` — dikonfigurasi via GTM tag "Google Tag", trigger "Initialization - All Pages"
- CSP server.js sudah include `https://www.googletagmanager.com` di scriptSrc

## Google Search Console
- Properti: `https://vidorey.web.app` — terverifikasi via file HTML `public/googlef064cc99be6a7884.html`
- Meta verification tag: `Vl8CnSoQmgdUxFfXGw4k7nzAPRZBgImHr2OrBPnmaAI` — di semua 6 HTML
- Sitemap terdaftar, homepage sudah terindex. Jangan hapus file verifikasi.

## Bing Webmaster Tools
- **Sudah terdaftar** — diimpor langsung dari Google Search Console (12 Jul 2026)
- Properti: `https://vidorey.web.app/` — verified via GSC import, tidak perlu file verifikasi terpisah
- `public/BingSiteAuth.xml` ada di repo tapi kosong (placeholder) — tidak dipakai karena pakai GSC import

## H1 Tag (SEO — wajib tiap platform)
Setiap halaman wajib punya tag `<h1>` di dalam `<main>`. Gunakan CSS `.sr-only` agar tidak mengganggu desain.
```html
<h1 class="sr-only">[Main English keyword phrase for this platform]</h1>
```
`.sr-only` sudah ada di `style.css` — tidak perlu tambah ulang. Tanpa H1, Bing menandai "H1 tag missing" dan menurunkan ranking.

## How to apply — platform baru
Gunakan template `<head>` lengkap di atas — sudah mencakup semua item. Jangan lewati satu pun.
Lihat `new-platform-checklist.md` untuk checklist 7 fase penuh termasuk backend, nav drawer, CSP, dan verifikasi akhir.

Ringkasan checklist HTML saja:
1. Template `<head>` di atas — GTM + meta + OG (en_US) + Twitter + favicon + schema array [WebSite+WebPage]
2. GTM noscript tepat setelah `<body class="pN-page">`
3. H1 `.sr-only` di dalam `<main>` (lihat section H1 Tag di atas)
4. Nav drawer + `<script src="/smartlinks.js">` sebelum `</body>`
5. Tambah `<url>` ke `sitemap.xml`

## Keyword tiers untuk adult site (prioritas)
- **High-value (Tier 1 intent):** "free porn", "xxx videos", "porn movies", "HD sex", "adult streaming"
- **Platform-specific:** "short porn clips" (TikTok-style), "HD sex videos" (listing), "xxx movies daily" (update feed)
- **No registration angle:** "no login", "no registration", "watch instantly" — ini mendorong CTR di hasil pencarian

## Catatan
- Google indexing butuh 2–4 minggu setelah perubahan meta tags untuk kelihatan hasilnya
- Perubahan dari `id_ID` → `en_US` kemungkinan besar paling berdampak pada distribusi traffic negara
- `summary_large_image` untuk Twitter card memberikan preview lebih besar → CTR share link lebih tinggi
- Sitemap "Tidak dapat mengambil" di GSC = cache GSC, bukan error nyata — resolve sendiri dalam 24 jam
