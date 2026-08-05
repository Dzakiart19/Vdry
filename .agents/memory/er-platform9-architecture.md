---
name: ER Platform 10 Architecture (EroMe — Vidorey 9)
description: erome.com HTML scrape, direct MP4 proxy, search-based categories (version filters broken), no signed tokens.
---

## Platform ER — erome.com (Vidorey 9)

- **Code**: `er`
- **Route prefix**: `/er`
- **UI name**: Vidorey 9
- **Files**: `lib/scrapers/er.js`, `public/er.html`, `public/er.js`
- **Delivery**: Direct MP4 proxy (no HLS, no signed token)
- **Avatar CSS**: `.ps-avatar-er`
- **Monitor badges**: `er_video` / `er_posts` / `er_stream`
- **Shortlink**: platform `'er'`

## Source site

erome.com adalah user-submitted album site. Setiap album bisa berisi foto saja, video saja, atau campuran.
Kita hanya ambil album yang punya `span.album-videos` (album berisi video).

## Recon findings (2026-08-02)

### URL yang berfungsi
| URL | Status | Isi |
|---|---|---|
| `/explore?page=N` | ✅ 200 | HOT — up to 50 pages × ~28 video albums |
| `/explore/new?page=N` | ✅ 200 | NEW — up to 50 pages × ~30 video albums |
| `/search?q=QUERY&page=N` | ✅ 200 | Search — 50 pages per query |
| `/a/ALBUMID` | ✅ 200 | Album detail page |

### URL yang BROKEN (jangan dipakai)
- `/version/straight`, `/version/gay`, `/version/trans`, `/version/hentai`, `/version/all` → **302 redirect ke /explore**. Filter versi ini sudah mati — semua return konten yang sama dengan HOT.
- `/trending`, `/popular` → 200 tapi return "Profile page" tanpa album (butuh auth)

### CDN
- MP4: `v{N}.erome.com` (Ceph/S3, Range OK, tanpa signed token, TTL tidak ada)
- Thumb: `s{N}.erome.com` — **diproxy server-side** via `/proxy/er/thumb?url=...` (erThumbCache 24h)
- CDN validation: `isAllowedErUrl()` + `isAllowedErThumbUrl` (alias) — check `hostname.endsWith('.erome.com')`
- **Tidak perlu self-healing** — URL MP4 tidak berisi token TTL

## Categories — search-based

Version filter sudah mati → gunakan search keyword sebagai "kategori":

| catId | URL yang dipakai | Keterangan |
|---|---|---|
| `''` (default) | `/explore?page=N` | HOT browse |
| `'new'` | `/explore/new?page=N` | Album terbaru |
| `'amateur'` | `/search?q=amateur&page=N` | Search keyword |
| `'asian'` | `/search?q=asian&page=N` | Search keyword |
| `'latina'` | `/search?q=latina&page=N` | Search keyword |
| `'ebony'` | `/search?q=ebony&page=N` | Search keyword |
| `'milf'` | `/search?q=milf&page=N` | Search keyword |
| `'lesbian'` | `/search?q=lesbian&page=N` | Search keyword |
| `'teen'` | `/search?q=teen&page=N` | Search keyword |
| `'homemade'` | `/search?q=homemade&page=N` | Search keyword |
| `'big ass'` | `/search?q=big+ass&page=N` | Search keyword |
| `'blowjob'` | `/search?q=blowjob&page=N` | Search keyword |
| `'anal'` | `/search?q=anal&page=N` | Search keyword |

`buildErUrl(catId, page, q)` — logika: `q` → search, `catId=''` → /explore, `catId='new'` → /explore/new, else → /search?q=catId.

## HTML scraping selectors

### Listing page
- Album cards: `a.album-link` — filter hanya yang punya `span.album-videos` (ada isi video)
- Album ID: `href` match `/\/a\/([A-Za-z0-9]{5,12})/`
- Title: build `titleMap` dari `a.album-title` dulu, lalu lookup per albumId
- Thumbnail: `img.album-thumbnail.active` (pertama) `.attr('src')` — di dalam `a.album-link`
- Pagination: parse `ul.pagination a.page-link` teks numerik, ambil terbesar

### Album detail page (`/a/ALBUMID`)
- Title: `h1.album-title-page` atau `meta[property="og:title"]`
- Thumb: `meta[property="og:image"]`
- Description: `meta[property="og:description"]`
- MP4: `source[type="video/mp4"]` attr `src` — erome render dua player (lg + normal) dengan URL sama; kumpulkan unique, ambil pertama
- Related: sama seperti listing (`a.album-link` + `a.album-title`), filter seenRel, limit 24

## Caches

| Cache | Name | TTL | Kapasitas | Notes |
|---|---|---|---|---|
| `erPostsCache` | `er_posts` | 5 mnt | 300 | Listing/search results |
| `erVideoCache` | `er_video` | 4 jam | 500 | Album detail (MP4 URL permanen, TTL panjang aman) |
| `erThumbCache` | `er_thumb` | 24 jam | 1000 | Thumbnail buffer (arraybuffer, keyed by full CDN URL) |

Cache key posts: `${page}:${q}:${catId}` — sederhana, tidak pakai sort/version.

## Routes

- `GET /api/er/categories` — return ER_CATEGORIES array statis
- `GET /api/er/posts?p=N&q=QUERY&cat=CATID` — listing/search
- `GET /api/er/video/:albumId` — album metadata + mp4Url + related
- `GET /proxy/er/stream/:albumId` — MP4 stream proxy dengan Range support + self-heal evict
- `GET /er` + `GET /er/*` — SPA routes (di scraper sendiri)

## Frontend (er.js) key decisions

- Slug = albumId (5-12 char alphanumeric, langsung dari erome)
- Share URL: `/er/watch/${currentToken || encodeSlug(currentSlug)}`
- Deep-link: 11-char token → resolve via shortlink `/api/s/er/:token`, else base64-decode legacy
- `initVdryCategoryPicker` pattern standar (sama dengan bk.js/yb.js)
- popstate: restore `state.catId` + `state.catName` dari history state keys `erCat`/`erCatName`

## Known issues / limitations

- Thumbnail `s{N}.erome.com` menolak hotlink dari preview iframe (403) — normal, tidak perlu di-proxy karena CSP allow `https:` dan browser production dapat akses langsung
- Tidak ada total album count di site → `totalPages` diestimasi dari pagination links
- Search pagination: tiap keyword punya max 50 halaman tersendiri
