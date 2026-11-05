---
name: XN Platform 8 Architecture (xchina.tube)
description: Arsitektur Platform 8 — Angular SPA, POST REST API, AES-CBC decrypt, HLS proxy, self-healing token, tidak ada iframe sumber.
---

## Overview
xchina.tube adalah Angular SPA tanpa SSR. Data di-fetch via POST REST API ke server pool (dari httpNames di bundle JS) yang mengembalikan response AES-CBC terenkripsi.

## API Servers (httpNames)
```
https://v2.tianmtv.com  (primary, confirmed fastest)
https://v2.madou.ws
https://v2.luchu.org
https://v2.papapa.biz
https://v2.randoms.site
https://v2.kekecdn.net
https://v2.xiaoshuo.info
https://v2.xiaoshuo.la
```
Semua server return format sama. xn.js mencoba server satu per satu, berhenti saat dapat 4xx (error definitif), lanjut ke server berikutnya saat timeout/network error.

## AES Decrypt
- Format: CryptoJS OpenSSL (prefix `Salted__` + 8-byte salt + ciphertext)
- Key: `"xxx"` (ada di bundle JS publik — bukan security, hanya obfuscation)
- KDF: MD5-based (CryptoJS default) → key 32 bytes + IV 16 bytes
- Algoritma: AES-256-CBC
- Implementasi Node.js: pakai `crypto` module standar (tidak perlu npm package)

## Endpoints
```
POST /sevenVideos?page=N          — listing, body: {}
POST /searchSevenVideos            — search, body: {keyword, page}
POST /sevenVideos/{vId}            — single video (includes m3u8s + thumbnails)
POST /relatedSevenVideos?v={vId}   — related videos (returns array 24)
```

## Video Object (dari API)
```json
{
  "vId": "5uH3ZsD6Y",
  "title": "...",
  "title_en": "...",   ← diutamakan untuk UI/SEO
  "durationStr": "12:34",
  "thumbNails": ["https://tp.helloye.com/{vId}.jpg"],  ← listing
  "thumbnails":  ["https://tp.helloye.com/{vId}.jpg"], ← single video
  "m3u8s": ["https://tm.helloye.com/TOKEN,TIMESTAMP/ID/index.m3u8"],
  "vip": false,
  "videoType": "cvideo"  // atau "tvideo" (short)
}
```

## CDN
- HLS host: `tm.helloye.com` (CDN77-Turbo) — token TTL ~1.5 jam
- Thumb host: `tp.helloye.com` (Wasabi S3) — tidak perlu signed token, akses langsung OK
- Segment path: relative (`000.ts`, `001.ts`...) → resolve dari m3u8 base URL
- Rewrite: `resolveUrl(segment, baseUrl)` → `/proxy/xn/seg?url=...&_v=vId`

## Token & Self-Healing
- M3U8 URL format: `https://tm.helloye.com/TOKEN,UNIXTS/VIDEOID/index.m3u8`
- Token expires setelah ~1.5 jam (UNIXTS embedded)
- Self-healing: 403 di HLS proxy atau seg proxy → `reresolveXnM3u8(vId)` → POST API ulang → cache fresh token
- Anti-stampede: `xnFreshCache` (90 detik) → satu re-resolve per vId per 90 detik
- Segment self-heal: extract filename dari URL lama, prepend fresh base URL

## Caches
| Cache | TTL | Kapasitas | Notes |
|---|---|---|---|
| `xnPostsCache` (`p8_posts`) | 3 mnt | 300 | Listing + search results |
| `xnM3u8Cache` (`p8_m3u8`) | 60 mnt | 500 | M3U8 URL per vId (lebih pendek dari TTL token 1.5j) |
| `xnVideoCache` (`p8_video`) | 2 jam | 500 | Full video payload + related |
| `xnFreshCache` (`p8_fresh`) | 90 detik | 200 | Self-healing anti-stampede |

## Routes
- `GET /api/xn/posts?p=N&q=query` — listing/search
- `GET /api/xn/video/:vId` — single video payload
- `GET /proxy/xn/hls/:vId` — HLS manifest (di-rewrite ke seg proxy)
- `GET /proxy/xn/seg?url=...&_v=vId` — TS segment proxy (self-healing)
- `GET /proxy/xn/thumb?url=...` — thumbnail proxy (tp.helloye.com)
- `GET /xn` + `GET /xn/*` — SPA routes

## Platform Info
- Code: `xn`
- Route: `/xn`
- UI name: "Vidorey 6"
- HTML: `public/xn.html` (class `body.rb-page` — shares listing CSS)
- JS: `public/xn.js`
- Avatar CSS: `.ps-avatar-xn` (orange gradient `#7c2d00 → #fb923c`)
- Monitor badges: `xn_video` / `xn_posts` (orange `#3a1c0a / #fb923c`)
- Shortlink: platform `'xn'` → `/api/s/xn/:token`

## Slug
vId dari API (9–12 char alphanumeric) langsung dipakai sebagai slug. Tidak perlu transformasi.

## Known Limitations
- API tidak return totalPages → estimasi: 24 hasil = ada halaman berikutnya, <24 = halaman terakhir. `totalPages` di response = 999 jika ada lebih, atau `page` jika sudah terakhir.
- `vip: true` video masih punya m3u8s[] publik — tidak ada paywall blocking yang terdeteksi.
- `videoType: "tvideo"` = video pendek (short), `"cvideo"` = video panjang — keduanya diinclude dalam listing.
