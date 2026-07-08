---
name: P3 yobokep Architecture
description: yobokep.com pagination broken (WP REST API fix), thumbnail via og:image, self-healing CDN, CDN allowlist, makeCache null gotcha
---

## yobokep.com HTML Pagination Broken

yobokep.com selalu mengembalikan 24 post **yang sama** di semua `/page/N/` URLs — server-side HTML pagination tidak berjalan (butuh JS/AJAX dari browser).

**Why:** WordPress theme menggunakan AJAX-based pagination; server hanya render "latest/sticky posts" tanpa memperhatikan page parameter di URL.

**How to apply:** Gunakan WP REST API (`/wp-json/wp/v2/posts?per_page=24&page=N&_fields=slug,title`) untuk listing — paginasinya benar via `x-wp-totalpages` response header.

---

## Thumbnail Tidak Tersedia di WP REST API

`featured_media: 0`, `yoast_head_json.og_image: undefined`, `jetpack_featured_media_url: ""` — semua kosong di WP REST API.

**Why:** Theme tidak set WordPress featured image; thumbnail disimpan sebagai custom meta dan di-render lewat theme PHP saja.

**How to apply:**
- Fetch thumbnail secara **parallel** dari halaman post individual (`/${slug}/`)
- Extract `og:image` dari HTML: `html.match(/property=["']og:image["'][^>]*content=["']([^"']+)/)`
- Cache di `ybThumbCache` TTL 24 jam (`makeCache(2000, 24*60*60*1000, 'p3_thumb')`)
- Filter uncached: `.filter(p => ybThumbCache.get(p.slug) === null)` ← **null bukan undefined**

---

## makeCache.get() Returns null, NOT undefined

`makeCache.get(key)` mengembalikan **`null`** untuk key yang tidak ada (bukan `undefined`).

**Why:** Implementasi makeCache: `has(key) { return this.get(key) !== null; }`.

**How to apply:** Selalu cek `=== null` untuk cache miss, jangan `=== undefined`.

---

## Self-Healing CDN 403 (P3)

Mirror pola P2. Diimplementasi karena:
- bysezejataos CDN (`*.r66nv9ed.com`, `*.owphbf24.com`): token expire (TTL) → perlu re-resolve
- streamhls.to CDN (`*.savefiles.com`): token `i=` dikunci ke IP → re-resolve kalau IP drift

**Fungsi-fungsi:**

```js
// ybFreshSessionCache: TTL 20 detik, mencegah flood re-resolve
// getYbFreshSession(slug, forceNew) — re-fetch embed + re-resolve m3u8 fresh
// reresolveYbUrl(slug, targetUrl, forceNew) — cari URL baru (cocokkan by filename)
// handleYbSeg(raw, slugHint, req, res, isRetry) — route handler yg bisa rekursi
```

**Flow:**
1. `/proxy/yb/seg` dapat CDN 403/401/5xx
2. `handleYbSeg` panggil `reresolveYbUrl(slugHint, raw, true)`
3. `reresolveYbUrl` panggil `getYbFreshSession` → re-fetch post page → re-resolve embed → fresh m3u8
4. Cocokkan `targetUrl` by filename (bukan by token) di master/sub-manifest baru
5. Retry sekali dengan URL baru (`isRetry=true`) — tidak rekursi lagi

**Sama dipakai oleh `/proxy/yb/hls/:slug`** (manifest proxy) via `getYbFreshSession`.

---

## CDN Allowlist P3 (isAllowedYbCdnUrl)

SprintCDN (bysezejataos.com) pakai dua domain grup:
- `*.r66nv9ed.com` — domain utama
- `*.owphbf24.com` — edge nodes geografis (moscow, frankfurt, dll)

savefiles.com (streamhls.to):
- `*.savefiles.com`
- `savefiles.com`

Keempat grup harus ada di `isAllowedYbCdnUrl`. Kalau ada `[cdn-alert]` dengan domain baru di log → tambahkan ke allowlist jika legitimate.

---

## Thumbnail Proxy (/proxy/yb/thumb)

- Validasi allowlist: `YB_THUMB_HOSTS = new Set(['yobokep.com', 'img-place.com', 'img.savefiles.com'])`
- Validasi content-type: `ct.startsWith('image/')` → 415 jika bukan gambar
- Pakai `stream.pipeline()` (bukan `.pipe()`) untuk cleanup otomatis saat client disconnect
