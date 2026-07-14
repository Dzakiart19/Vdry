---
name: Platform 6 SB Architecture
description: situsbokep.cc (Vidorey 5 di UI) — scraping, proxy, search fix, dan keputusan arsitektur.
---

## Identitas
- **Internal code**: Platform 6 (P6), file `lib/scrapers/sb.js` + `public/sb.html` + `public/sb.js`
- **Nama UI (nav drawer)**: **Vidorey 5** — bukan "Vidorey 6"; TikTok (TP/P5) tidak dihitung dalam urutan numerik listing karena masuk "Fitur Lain"
- **URL**: `/sb`
- **Sumber**: situsbokep.cc (WP-based, xvideos embedframe)

## Chain video
`situsbokep.cc/view/[slug]` → `itemprop="embedURL"` → `www.xvideos.com/embedframe/[xv_id]` → `html5player.setVideoHLS(...)` → `*.xvideos-cdn.com` m3u8

## Scraping detail
- Listing HTML: `article.thumb-block, article.loop-video` (cheerio)
- Link video: `a[href*="/view/"]` (bukan `/watch/`)
- Thumbnail: `img[data-src]` (lazy-load), fallback `img[src]`, filter `loading.gif` + `data:image`
- Absolute URL pagination: `href.match(/\/page\/(\d+)\/?(?:[?#]|$)/)` — href bisa berupa absolute URL penuh
- Video slug dari href: `/view/([^/?#]+)` dengan `decodeURIComponent`

## Search fix — WP REST API (PENTING)
WordPress di situsbokep.cc tidak mendukung server-side search pagination via URL `/page/N/?s=query` — selalu return halaman 1 yang sama. **Fix**: search mode pakai WP REST API:

```
GET /wp-json/wp/v2/posts?search=QUERY&page=N&per_page=24&_embed=wp:featuredmedia&_fields=slug,title,_embedded,_links
```

- Pagination akurat via header `X-WP-TotalPages`
- Thumbnail dari `_embedded['wp:featuredmedia'][0].source_url`
- HTML entity decode manual (replace `&#N;`, `&amp;`, `&quot;`, `&#039;`) karena `title.rendered` bisa mengandung encoded chars
- Browse normal (tanpa search) + kategori tetap pakai HTML scrape (lebih lengkap thumbnailnya)

**Why:** HTML scrape endpoint `/page/2/?s=query` di WordPress ini tidak berjalan server-side — identik hasilnya dengan page 1. Pola yang sama terjadi di P3 (YB) dan sudah difix lebih dulu dengan WP REST API.

**How to apply:** Cek setiap kali platform WordPress baru ditambah — kalau HTML pagination listing tidak berubah antar halaman untuk search, gunakan WP REST API untuk search mode.

## CDN allowlist (isAllowedSbCdnUrl)
- `*.xvideos-cdn.com`, `xvideos-cdn.com`
- `*.xnxx-cdn.com`, `xnxx-cdn.com`
- Extension allowed: `.ts`, `.m3u8`, `.m3u`, `.aac`, `.mp4`, `.m4s`, `.key`, `.init`

## Thumbnail allowlist (isAllowedSbThumb)
- `situsbokep.cc`, `*.situsbokep.cc`
- `*.imserverx1.online`, `*.imserverx2.online`
- `*.lotnok.com`
- `*.xvideos-cdn.com`

## Caches
| Cache | TTL | Slot | Nama |
|---|---|---|---|
| `sbPostsCache` | 3 mnt | 200 | `p7_posts` |
| `sbCategoriesCache` | 60 mnt | 1 | `p7_categories` |
| `sbM3u8Cache` | 8 jam | 500 | `p7_m3u8` |
| `sbVideoCache` | 4 jam | 300 | `p7_video` |
| `sbFreshCache` | 60 detik | 100 | `p7_fresh` |

Token xvideos TTL ~1 tahun → 8 jam cache aman. `sbFreshCache` dipakai untuk self-healing re-resolve xvId tanpa hit situsbokep lagi.

## Token xvideos — self-healing
Jika stream 403/gagal, `freshResolveM3u8(slug)` re-fetch xvideos embedframe langsung (lewati situsbokep page) menggunakan `_xvId` tersimpan di `sbVideoCache`.

## Watch view (P6)
Full-page layout identik P2/P3/P4: `watch-topbar` + `watch-main` + `watch-related` sticky sidebar. Deep-link `/sb/watch/<token>` (11-char shortlink). HLS via hls.js. Related di-scrape dari `article.thumb-block, article.loop-video` di halaman video.

## Kategori
- API: `GET /wp-json/wp/v2/categories?per_page=100&_fields=id,name,slug,count&orderby=count&order=desc`
- Filter: `c.slug !== 'uncategorized' && c.count > 0`
- Cache 60 mnt

## SPA routes (WAJIB di sb.js)
```js
router.get('/sb',   (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'sb.html')));
router.get('/sb/*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'sb.html')));
```

## Nav drawer
Vidorey 5 masuk **seksi atas** (listing biasa, sebelum `<hr class="nav-section-divider">`). Bukan "Fitur Lain" — itu hanya untuk TikTok-style.
