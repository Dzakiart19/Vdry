---
name: Vidorey SEO Strategy
description: Meta tag template, keyword strategy, robots.txt, sitemap.xml — untuk naikkan CPM via Tier 1 traffic.
---

## Tujuan
Semua halaman pakai keyword bahasa **Inggris** agar Google indexing mengirim traffic Tier 1 (US/UK/EU, CPM $2–5) bukan hanya Indonesia (CPM $0.05–0.3).

## Template meta tags wajib tiap platform baru

```html
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="..." />
  <title>Vidorey N - [English adult keyword title]</title>
  <meta name="description" content="[English description, adult keywords]" />
  <meta name="keywords" content="free porn, xxx videos, sex videos, [platform-specific keywords]" />
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
```

**Why:** `og:locale=id_ID` memberitahu Facebook/Twitter bahwa konten Indonesia → share ke audiens Indonesia → CPM rendah. `lang="en"` + `og:locale=en_US` memberitahu Google/crawler bahwa ini konten Inggris.

## File statis SEO

| File | Isi |
|---|---|
| `public/robots.txt` | `Allow: /`, `Disallow: /monitor`, `Disallow: /health`, `Sitemap:` link |
| `public/sitemap.xml` | 6 URL platform, `changefreq: daily`, priority 1.0 (index) / 0.9–0.8 (platform) |

## How to apply — platform baru
1. Tambah meta tags sesuai template di atas ke `pN.html` (lang="en", keywords Inggris, og:locale=en_US)
2. Tambah `<url>` baru ke `sitemap.xml`
3. Tidak perlu ubah `robots.txt` (sudah allow semua path kecuali /monitor dan /health)

## Keyword tiers untuk adult site (prioritas)
- **High-value (Tier 1 intent):** "free porn", "xxx videos", "porn movies", "HD sex", "adult streaming"
- **Platform-specific:** "short porn clips" (TikTok-style), "HD sex videos" (listing), "xxx movies daily" (update feed)
- **No registration angle:** "no login", "no registration", "watch instantly" — ini mendorong CTR di hasil pencarian

## Catatan
- Google indexing butuh 2–4 minggu setelah perubahan meta tags untuk kelihatan hasilnya
- Perubahan dari `id_ID` → `en_US` kemungkinan besar paling berdampak pada distribusi traffic negara
- `summary_large_image` untuk Twitter card memberikan preview lebih besar → CTR share link lebih tinggi
