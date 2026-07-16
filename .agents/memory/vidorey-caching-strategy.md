---
name: Vidorey Caching Strategy
description: makeCache helper, semua cache per platform + TTL, sentinel values, conventions. 7 platform.
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
| `rcCategoriesCache` | P6 | 1 jam | 10 | Daftar kategori (sedikit entry) |
| `rcPostsCache` | P6 | 10 mnt | 300 | Listing per categoryId+sort+cursor |
| `rcThumbCache` | P6 | 5 mnt | 100 | Boolean flag = URL pernah sukses |
| `sbPostsCache` | P6 | 3 mnt | 200 | HTML listing / REST API search per page:cat:query |
| `sbM3u8Cache` | P6 | 8 jam | 500 | M3U8 URL per slug (token xvideos TTL ~1 tahun) |
| `sbVideoCache` | P6 | 4 jam | 300 | Full video payload + `_xvId` untuk self-heal |
| `sbFreshCache` | P6 | 1 mnt | 100 | Anti-stampede fresh resolve per slug |
| `xnPostsCache` (`p8_posts`) | P8 | 3 mnt | 300 | Listing + search results |
| `xnM3u8Cache` (`p8_m3u8`) | P8 | 60 mnt | 500 | M3U8 URL per vId (token TTL ~1.5j) |
| `xnVideoCache` (`p8_video`) | P8 | 2 jam | 500 | Full video payload + related |
| `xnFreshCache` (`p8_fresh`) | P8 | 90 detik | 200 | Self-healing anti-stampede |

**P5 tidak punya tpThumbCache** — URL thumbnail sudah ada di dalam payload `tpVideoCache` (field `thumbnailSm`/`thumbnailMd`).

**P6 rcThumbCache** — tidak menyimpan binary, hanya `true` sebagai flag "URL ini valid". Fetch ulang tiap request tapi skip validasi content-type lebih awal.

**P6 sbM3u8Cache TTL 8 jam** — token xvideos CDN valid ~1 tahun (timestamp embedded `,...,1783946866,...`), jadi TTL bisa panjang. `sbFreshCache` (1 mnt) cegah concurrent self-healing stampede.

## Sentinel Values
Untuk mencegah upstream hammering saat error, semua video-level cache menyimpan sentinel:
- `{ _error: true }` — error 502, TTL pendek (20 detik)
- `{ _status: 404, _msg: '...' }` — not found, TTL 60 detik

Callers check di awal: `if (cached._error) return 502; if (cached._status === 404) return 404;`

## getCacheStats Order (server.js)
```
p1.caches[0]                           // videoUrlCache
rb.caches[0..3]                        // m3u8, posts, freshSession, rbVideoCache
yb.caches[0..3]                        // m3u8, posts, ybVideoCache, ybThumbCache
// yb.caches[4] = ybFreshSessionCache  ← SENGAJA tidak dimasukkan (konvensi lama)
bk.caches[0..2]                        // posts, videoUrl, thumb
tp.caches[0..1]                        // posts, video
rc.caches[0..2]                        // categories, posts, thumb
sb.caches[0..3]                        // sbPostsCache, sbM3u8Cache, sbVideoCache, sbFreshCache
```

## Monitor Buffer
Ring buffer 50k events di monitor.js — `Array.shift()` O(n). Acceptable untuk traffic moderate Replit; jika traffic tinggi bisa jadi bottleneck.
