---
name: Vidorey full audit findings (2026-07-28)
description: Known-broken upstream embed providers on P3 (yb) and P6/P7 (sb); and minor code issues found and resolved during audit.
---

## P3 (yobokep.com / yb.js) — playmogo.com provider unresolvable
yobokep.com started serving some posts via a third embed provider, `playmogo.com/e/{code}`
(previously only `bysezejataos.com` and `streamhls.to` were handled). `isEmbedUrl()` in
`fetchYbEmbedInfo` doesn't recognize it, so `embedUrl` comes back empty → "Player tidak
ditemukan di halaman ini" → video di-dead-cache 6 jam lalu difilter dari listing.

**Status: handled gracefully.** `DEAD_VIDEO_TTL` (6 jam) + filter `_status !== 404` di
`/api/yb/posts` memastikan video playmogo tidak terus muncul di listing. Tidak perlu fix tambahan.

**Jangan tambahkan playmogo ke isEmbedUrl** tanpa verifikasi — Cloudflare-fronted, setiap
fetch (axios/cheerio) mengembalikan "resource removed or unavailable" (4/4 sample). Butuh
browser automation untuk konfirmasi, bukan patch scraper biasa.

## P6 (situsbokep.cc / sb.js) — xvideos embed migrated to native fbplay.vip player

**STATUS: ✅ FIXED (2026-08-03)** — lihat `sb-platform6-architecture.md` untuk detail lengkap.

situsbokep.cc sepenuhnya migrasi ke `db.fbplay.vip/embed/video/{hash}`. Tidak ada lagi xvideos
embedframe. Fix: tambah `extractFbplayId()` + `resolveFbplayHls()` di sb.js. CDN allowlist
diperluas ke `*.fbplay.vip` + `*.tiktokcdn.com` (segmen HLS di-serve dari TikTok CDN dengan
signed URL TTL ~1 tahun). Semua SB video sekarang resolve via fbplay dengan HLS normal.

**Catatan awal audit lama (sudah tidak berlaku):** fbplay.vip pernah di-bypass karena
dicurigai inject ad creative di segmen. Setelah dicek ulang 2026-08-03, segmen tiktokcdn.com
adalah content video asli (bukan ad), dan TTL signed URL aman (~2027). No-source-ads rule
tidak dilanggar karena semua diproxy server-side.

## Minor issues resolved (2026-07-28)
- **p1.js `deadStreamIds` cleanup**: Ditambahkan `setInterval` 10 menit untuk hapus entry
  expired dari Map → mencegah memory leak di server long-running (Koyeb).
- **tp.js `tpThumbCache` dead comment**: Dihapus komentar yang menyebut tpThumbCache sebagai
  "disertakan di module.exports" padahal variabelnya tidak ada. Hanya 2 cache aktif di P5.
- **rb.js cache count audit**: Confirmed 4 caches (m3u8, posts, freshSession, rbVideo), semua
  sudah masuk monitor stats di server.js. Tidak ada yang kurang.
- **Shortlink DB**: `ensureTable()` auto-DDL di startup — tidak perlu migrasi manual.
