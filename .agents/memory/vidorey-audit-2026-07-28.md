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

## P6/P7 (situsbokep.cc / sb.js) — xvideos embed migrated to native fbplay.vip player
situsbokep.cc embed terbaru memakai `db.fbplay.vip/embed/video/{hash}` — tanpa substring
`xvideos.com`, sehingga `extractXvId()` mengembalikan null → "Sumber video tidak didukung"
→ dead-cache. Hanya post lama (yang masih pakai xvideos embedframe) yang bisa diputar.

**Status: handled gracefully.** Kode sudah benar: fbplay.vip di-bypass total (extractXvId
ekstrak xv_id, lalu server langsung hit xvideos.com/embedframe — fbplay.vip tidak pernah
di-fetch). Post yang tidak punya xvId langsung dead-cache.

**Jangan wire native fbplay.vip:** manifest-nya menyisipkan ad creative (tiktokcdn.com .ts
segment) dan sebagian video masih "processing". Melanggar no-source-ads rule. Butuh
sign-off eksplisit sebelum diimplementasikan.

**Why this matters:** P6/P7 degradasi seiring migrasi post baru ke fbplay.vip — ini source-side
change, bukan bug proxy/token.

## Minor issues resolved (2026-07-28)
- **p1.js `deadStreamIds` cleanup**: Ditambahkan `setInterval` 10 menit untuk hapus entry
  expired dari Map → mencegah memory leak di server long-running (Koyeb).
- **tp.js `tpThumbCache` dead comment**: Dihapus komentar yang menyebut tpThumbCache sebagai
  "disertakan di module.exports" padahal variabelnya tidak ada. Hanya 2 cache aktif di P5.
- **rb.js cache count audit**: Confirmed 4 caches (m3u8, posts, freshSession, rbVideo), semua
  sudah masuk monitor stats di server.js. Tidak ada yang kurang.
- **Shortlink DB**: `ensureTable()` auto-DDL di startup — tidak perlu migrasi manual.
