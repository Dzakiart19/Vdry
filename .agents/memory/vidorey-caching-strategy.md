---
name: Vidorey Caching Strategy
description: All in-memory caches: structure, TTLs, eviction, sentinel values — P1, P2, P3
---

# Caching Strategy — server.js

## makeCache helper (generic)

```js
makeCache(maxSize, defaultTtlMs, name)
```

Returns `{ get, set, del, has, stats }`.
- `set(key, val, ttlMs?)` — optional 3rd arg overrides default TTL per-entry
- `get(key)` → returns **`null`** (not `undefined`) on cache miss
- `del(key)` — explicit eviction (dipakai untuk stale CDN URL recovery)
- `has(key)` → `this.get(key) !== null`
- `stats()` → `{ name, size, hits, misses }` — dipakai oleh `/health/detail`

**Critical:** `get()` returns `null` for missing keys. Always check `=== null`, never `=== undefined`.

---

## Platform 1 — xpvid.cc

### videoUrlCache — MP4 URLs
- Stores: `{src, title, thumb}` payload
- TTL: 5 min | Max: 300 | Name: `p1_videoUrl`
- Eviction: `/proxy/stream/:id` calls `resolveP1Mp4(evictFirst=true)` if CDN returns 403/404

---

## Platform 2 — ruangbokep.ws

### m3u8Cache — HLS URLs
- Stores: resolved m3u8 URL string
- TTL: 5 min | Max: 500 | Name: `p2_m3u8`
- Shim: `m3u8CacheSet(slug, url)` wraps `m3u8Cache.set()` untuk backward compat

### postsCache — Post listings
- Key: `"page:cat:q"`
- TTL: 3 min (normal), 30s (empty/404), 20s (_error) | Name: `p2_posts`
- Sentinel values: `{_error: true}` → 502, `{_status: 404}` → 404

### freshSessionCache — Self-healing token sessions
- Key: slug
- Stores: `{ masterUrl, masterContent: string|null, subs: Map<string,string> }`
- TTL: 20 detik | Max: 100 | Name: `p2_freshSession`
- Mencegah flood re-resolve: banyak segment gagal berurutan hanya trigger SATU re-fetch per 20s window

---

## Platform 3 — yobokep.com

### ybM3u8Cache — HLS URLs
- Stores: resolved m3u8 URL string
- TTL: 3 min | Max: 500 | Name: `p3_m3u8`

### ybPostsCache — Post listings
- Key: `"page:q"`
- TTL: 3 min (normal), 30s (empty/404), 20s (_error) | Name: `p3_posts`
- Sentinel values sama dengan postsCache P2

### ybThumbCache — Thumbnail URLs
- Key: slug
- Stores: `og:image` URL dari halaman post individual
- TTL: **24 jam** | Max: 2000 | Name: `p3_thumb`
- **Why 24 jam:** thumbnail yobokep tidak tersedia di WP REST API — harus fetch satu per satu dari halaman post; cache panjang meminimalkan request upstream

### ybFreshSessionCache — Self-healing token sessions
- Key: slug
- Stores: `{ masterUrl, masterContent: string|null, subs: Map<string,string> }`
- TTL: 20 detik | Max: 100 | Name: `p3_freshSession`
- Mirror pola P2 `freshSessionCache`; dipakai bersama oleh `/proxy/yb/hls/:slug` dan `handleYbSeg`

---

## Monitor Buffer — Unlimited

- `monitorLog[]` — **unlimited** (tidak ada trim/eviction)
- `cdnAlerts[]` — **unlimited** (tidak ada trim/eviction)
- `MAX_ROWS` di dashboard live feed — **unlimited** (semua baris ditampilkan)

---

## Sentinel Value Pattern (P2 & P3)

```js
cache.set(key, { _error: true }, 20_000);   // upstream error → 502
cache.set(key, { _status: 404 }, 30_000);   // not found → 404
cache.set(key, result, 30_000);             // empty result → throttle 30s

// Check di route handler:
if (cached._error)          return apiError(res, 502, '...');
if (cached._status === 404) return apiError(res, 404, '...');
```

**Why:** Tanpa negative cache, request ke page gagal/kosong hammer upstream terus tanpa throttle.
