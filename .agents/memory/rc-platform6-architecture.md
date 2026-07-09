---
name: Platform 6 RC (ReddClips) Architecture
description: Arsitektur Platform 6 Vidorey Reddit — api.reddclips.com, MP4 langsung, kategori tabs, deep-link pattern.
---

# Platform 6 — ReddClips (RC) "Vidorey Reddit"

## API
- Source: `api.reddclips.com` (undocumented — monitor perubahan struktur)
- `/categories` → field `data.categories[]` (type: nsfw/sfw, id, name, icon)
- `/categories/:id/posts?sort=hot&limit=25&after=cursor` → field `data.posts[]`, `data.cursors.after`
- Video: `api.reddclips.com/video/:hash.mp4` — direct MP4, stabil ~24 jam (max-age=86400)
- Thumbnail: `external-preview.redd.it` / `preview.redd.it` / `i.redd.it` — kadang 403, normal

## Deep-link pattern (berbeda dari P2–P5)
- RC tidak pakai shortlink token registry (hash sudah pendek & URL-safe)
- URL format: `/rc/video/:hash` (8–20 hex chars)
- Init: parse `window.location.pathname` untuk `/rc/video/:hash`, set `deepLinkHash` + `targetSlideHash`
- Setelah batch pertama render: `tryScrollToDeepLink()` scroll ke slide target
- IntersectionObserver langsung play karena `targetSlideHash` sudah di-set

**Why:** Hash RC adalah hex 8–20 char, sudah URL-safe dan pendek — tidak perlu 11-char shortlink token seperti RB/YB/BK yang punya slug panjang.

## Feed architecture
- TikTok-style vertical scroll-snap (sama seperti P5/TP)
- IntersectionObserver threshold 0.75 untuk play/pause
- Memori: `removeAttribute('src')` + `load()` saat slide keluar viewport (MP4 besar)
- Ad slide setiap 5 video (display banner 300×250 programatik)
- Native banner sticky bottom (`.rc-native-ad` fixed-position)

## Caches
- `rcCategoriesCache` — 10 entry, 1 jam TTL
- `rcPostsCache` — 300 entry, 10 mnt TTL (key: `posts:${categoryId}:${sort}:${after}`)
- `rcThumbCache` — 100 entry, 5 mnt (simpan boolean true = pernah sukses)

## Allowlist CDN
- Video: `api.reddclips.com`
- Thumb: `external-preview.redd.it`, `preview.redd.it`, `i.redd.it`
- logCdnAlert jika domain baru muncul

## Monitor tracking
- `rc_video` event saat `/proxy/rc/stream/:hash`
- `rc_posts` event saat `/api/rc/posts`
- Monitor badges: `.b-rc_video`, `.b-rc_posts` (warna #ff6633 pada background #1a0800)

## Scraper-alert triggers
- `/categories` response tidak punya field `categories` (array)
- `/categories/:id/posts` response tidak punya field `posts` (array)
- Domain video/thumbnail baru di luar allowlist
