---
name: Platform 6 RC (ReddClips) Architecture
description: Arsitektur Platform 6 Vidorey TikTok 2 — api.reddclips.com, MP4 langsung, kategori tabs, deep-link pattern.
---

# Platform 6 — "Vidorey TikTok 2" (/rc)

## API
- Source: `api.reddclips.com` (undocumented — monitor perubahan struktur)
- `/categories` → field `data.categories[]` (type: nsfw/sfw, id, name, icon)
- `/categories/:id/posts?sort=hot&limit=25&after=cursor` → field `data.posts[]`, `data.cursors.after`
- Video: `api.reddclips.com/video/:hash.mp4` — direct MP4, stabil ~24 jam (max-age=86400)
- Thumbnail: `external-preview.redd.it` / `preview.redd.it` / `i.redd.it` — kadang 403, normal

## Layout (penting — ada 3 lapis fixed di atas)
```
topbar        52px   (z-index 120, position fixed, top:0)
display-top   50px   (z-index 119, position fixed, top:52px) ← display banner 320×50
cats-bar      48px   (z-index 119, position fixed, top:102px)
rc-feed              (position fixed, top:150px, bottom:0)
rc-slide             height: calc(100dvh - 150px)
```
Jika mengubah tinggi salah satu layer, update SEMUA nilai top/height di bawahnya sekaligus.

## Sort UI — TIDAK ADA
Sort buttons (🔥✨🏆📈) sudah **dihapus seluruhnya** dari rc.html dan rc.js. Default sort adalah `hot`. Alasan: sort lain tidak menghasilkan perbedaan nyata di API reddclips.com.

**Why:** User meminta penghapusan karena tombol tidak terasa berpengaruh.

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
- Native banner sticky bottom (`.rc-native-ad` fixed-position z-index 130)

## Iklan di RC (identik dengan TP)
1. `#rcDisplayTop .rc-display-top` — display banner 320×50 fixed bawah topbar (z-index 119, key `d37e31d713d11b2ddde7d3efca199c9d`)
2. `#rcNativeAd .rc-native-ad` — native sticky bottom (fixed, z-index 130, key `761a1a8645cd2263043bfeb6f2e87eea`)
3. `rc.js createAdSlide()` — display banner 300×250 full-screen slide setiap 5 video (key `d50b941ac6d9bd5749dcdb0b417bf348`)
4. `rc.js appendEndSlide()` — display banner 300×250 di end slide
5. Popunder & Social Bar script (pl28418540, pl28427857 — identik semua platform)

## Caches
- `rcCategoriesCache` — 10 entry, 1 jam TTL (key: `'all'`)
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
