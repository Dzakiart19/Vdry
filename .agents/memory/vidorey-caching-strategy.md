---
name: Vidorey Caching Strategy
description: makeCache helper, semua cache per platform + TTL, sentinel values, conventions. 10 scrapers (2026-08-02).
---

## makeCache helper
`makeCache(maxSize, defaultTtlMs, name)` — returns object dengan `.get(key)→null|value`, `.set(key, val, ttlMs?)`, `.stats()`.
- **Selalu return `null` saat miss** — bukan `undefined`, bukan `false`. Semua callers harus check `!== null`.
- FIFO eviction setelah expired-entry scan.

**Why:** Kode yang check `if (cached)` (falsy) akan salah handle value cache yang falsy (0, '', false). Pattern eksplisit `!== null` wajib dipakai.

## Cache per Platform

| Cache | Platform | TTL | Kapasitas | Notes |
|---|---|---|---|---|
| `videoUrlCache` | P1 | 4 jam | 500 | Direct MP4 URL |
| `m3u8Cache` / `ybM3u8Cache` | P2/P3 | 3 mnt | 500 | M3U8 URL — token CDN cepat expire |
| `postsCache` / `ybPostsCache` | P2/P3 | 3 mnt | 200 | Listing page result |
| `freshSessionCache` / `ybFreshSessionCache` | P2/P3 | 20 detik | 100 | Self-healing CDN token |
| `rbVideoCache` | P2 | 30 mnt | 300 | Full video payload (slug→response) |
| `ybVideoCache` | P3 | 30 mnt | 300 | Full video payload — sama seperti P2 |
| `ybThumbCache` | P3 | 24 jam | 2000 | Thumbnail URL per slug |
| `bkPostsCache` | P4 | 1 jam | 100 | WP REST listing |
| `bkVideoUrlCache` | P4 | 4 jam | 500 | Direct MP4 URL |
| `bkThumbCache` | P4 | 24 jam | 2000 | Thumbnail URL per ID |
| `tpPostsCache` | P5 | 10 mnt | 500 | Feed listing |
| `tpVideoCache` | P5 | 24 jam | 1000 | Full video payload (token TTL ~1yr) |
| `sbPostsCache` | P6/sb | 3 mnt | 200 | HTML listing / REST API search per page:cat:query |
| `sbM3u8Cache` | P6/sb | 8 jam | 500 | M3U8 URL per slug (token xvideos TTL ~1 tahun) |
| `sbVideoCache` | P6/sb | 4 jam | 300 | Full video payload + `_xvId` untuk self-heal |
| `sbFreshCache` | P6/sb | 1 mnt | 100 | Anti-stampede fresh resolve per slug |
| `sbCategoriesCache` | P6/sb | jam | — | Kategori sb |
| `vdPostsCache` (`vd_posts`) | P7/vd | 3 mnt | 200 | Listing per page |
| `vdVideoCache` (`vd_video`) | P7/vd | 2 jam | 500 | MP4 URL permanen, tidak ada token expiry |
| `vdThumbCache` (`vd_thumb`) | P7/vd | 24 jam | 500 | Thumbnail URL tidak berubah |
| `xnPostsCache` (`p8_posts`) | P8/xn | 3 mnt | 300 | Listing + search results |
| `xnM3u8Cache` (`p8_m3u8`) | P8/xn | 60 mnt | 500 | M3U8 URL per vId (token TTL ~1.5j) |
| `xnVideoCache` (`p8_video`) | P8/xn | 2 jam | 500 | Full video payload + related |
| `xnFreshCache` (`p8_fresh`) | P8/xn | 90 detik | 200 | Self-healing anti-stampede |
| `xnCategoriesCache` | P8/xn | — | — | Kategori xn |
| `zgPostsCache` (`zg_posts`) | P9/zg | 5 mnt | 200 | Listing per page:cat |
| `zgCategoriesCache` (`zg_categories`) | P9/zg | 1 jam | 1 | Daftar kategori (scrape zoig.com/categories) |
| `zgVideoCache` (`zg_video`) | P9/zg | 8 mnt | 300 | Signed MP4 token (short TTL karena token per-request) |
| `zgThumbCache` (`zg_thumb`) | P9/zg | 24 jam | 500 | Thumbnail URL stabil |
| `erPostsCache` (`er_posts`) | P10/er | 5 mnt | 300 | Listing/search results (key: page:q:catId) |
| `erVideoCache` (`er_video`) | P10/er | 4 jam | 500 | Album metadata + MP4 URL (URL permanen, TTL panjang aman) |

**P5 tidak punya tpThumbCache** — URL thumbnail sudah ada di dalam payload `tpVideoCache` (field `thumbnailSm`/`thumbnailMd`).

**P6 sbM3u8Cache TTL 8 jam** — token xvideos CDN valid ~1 tahun (timestamp embedded `,...,1783946866,...`), jadi TTL bisa panjang. `sbFreshCache` (1 mnt) cegah concurrent self-healing stampede.

**P9/zg `zgVideoCache` TTL 8 mnt** — signed MP4 URL berubah tiap request ke zoig.com; 8 mnt adalah balance antara avoid re-scrape dan keep token fresh. Stream proxy self-heal transparently.

**rc (reddclips) tidak pernah dibangun** — hapus semua referensi ke rcCategoriesCache/rcPostsCache/rcThumbCache. Tidak ada file rc.js atau rc.html.

## Sentinel Values
Untuk mencegah upstream hammering saat error, semua video-level cache menyimpan sentinel:
- `{ _error: true }` — error 502, TTL pendek (20 detik)
- `{ _status: 404, _msg: '...' }` — not found, TTL 60 detik

Callers check di awal: `if (cached._error) return 502; if (cached._status === 404) return 404;`

## getCacheStats Order (server.js) — actual as of 2026-08-02
```js
p1.caches[0]                                     // videoUrlCache
rb.caches[0..3]                                  // m3u8Cache, postsCache, freshSessionCache, rbVideoCache
yb.caches[0..5]                                  // m3u8, posts, video, thumb, freshSession, categories
bk.caches[0..3]                                  // posts, videoUrl, thumb, categories
tp.caches[0..1]                                  // tpPostsCache, tpVideoCache
sb.caches[0..4]                                  // posts, m3u8, video, fresh, categories
xn.caches[0..4]                                  // posts, m3u8, video, fresh, categories
vd.caches[0..2]                                  // posts, video, thumb
zg.caches[0..3]                                  // posts, categories, video, thumb
er.caches[0..1]                                  // posts, video
```
Note: "rc" tidak ada — platform reddclips tidak pernah dibangun.

## Monitor Buffer
Ring buffer 50k events di monitor.js — `Array.shift()` O(n). Acceptable untuk traffic moderate Replit; jika traffic tinggi bisa jadi bottleneck.
