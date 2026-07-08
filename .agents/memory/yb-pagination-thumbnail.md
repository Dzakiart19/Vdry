---
name: P3 yobokep Pagination & Thumbnail
description: yobokep.com HTML pagination broken; thumbnail strategy via og:image + makeCache null vs undefined
---

## yobokep.com HTML pagination broken

yobokep.com selalu mengembalikan 24 post **yang sama** di semua `/page/N/` URLs — server-side HTML pagination tidak berjalan (butuh JS/AJAX dari browser). Jangan pakai HTML scraping untuk listing pagination.

**Why:** WordPress theme yobokep.com menggunakan AJAX-based pagination; server hanya render "latest sticky posts" tanpa memperhatikan page parameter.

**How to apply:** Gunakan WP REST API (`/wp-json/wp/v2/posts?per_page=24&page=N`) untuk listing — paginasinya benar via `x-wp-totalpages` header.

## Thumbnail tidak tersedia di WP REST API

`featured_media: 0`, `yoast_head_json.og_image: undefined`, `jetpack_featured_media_url: ""` — semua kosong. Thumbnail hanya tersedia via `og:image` di halaman HTML individual post.

**Why:** Theme tidak set WordPress featured image; thumbnail disimpan sebagai custom meta dan hanya di-render via theme PHP di `data-main-thumb`.

**How to apply:** Fetch thumbnail secara parallel dari `/slug/` halaman individual, extract `og:image`. Cache di `ybThumbCache` dengan TTL 24 jam (`makeCache(2000, 24*60*60*1000, 'p3_thumb')`).

## makeCache.get() returns null, NOT undefined

`makeCache.get(key)` mengembalikan **`null`** untuk key yang tidak ada (bukan `undefined`). Check untuk uncached key harus pakai `=== null`, bukan `=== undefined`.

**Why:** Implementasi makeCache menggunakan `null` sebagai sentinel value untuk cache miss (lihat `has(key) { return this.get(key) !== null; }`).

**How to apply:** Filter uncached slugs: `.filter(p => ybThumbCache.get(p.slug) === null)`.

## owphbf24.com CDN allowlist

SprintCDN yang dipakai bysezejataos.com menggunakan dua domain grup:
- `*.r66nv9ed.com` — original
- `*.owphbf24.com` — edge nodes geografis (moscow, frankfurt, dll)

Keduanya harus ada di `isAllowedYbCdnUrl` allowlist.
