---
name: Platform 1 Migration xpvid.cc → vdy.to
description: Platform 1 backend diganti dari xpvid.cc (mati/domain expired) ke vdy.to. Sama CDN, struktur folder identik, tapi cara resolve video berubah dari embed.php ke JWT decode.
---

# Platform 1 — Migration xpvid.cc → vdy.to

## Status
- `xpvid.cc` → mati total (DNS tidak resolve, timeout, semua alternatif domain juga dead)
- `vdy.to` → pengganti resmi, CDN yang sama (`vidoycdn.b-cdn.net`)

## Apa yang Sama (tidak perlu diubah)
- CSS selectors folder: `folder-chip`, `thumb-link`, `drive-title`, `page-btn`, `back-btn`, `aria-label` — identik
- Root folder ID: `e2bo9hcw9pe` — sama
- CDN host: `vidoycdn.b-cdn.net` — sudah di `STREAM_HOSTS`
- Folder URL: `/f/<id>`, video URL: `/d/<id>` — sama

## Yang Berubah di lib/scrapers/p1.js

### BASE URL
```js
// Lama:
const BASE = 'https://xpvid.cc';
// Baru:
const BASE = 'https://vdy.to';
```

### THUMB_HOSTS
```js
// Lama:
const THUMB_HOSTS = new Set(['i.xpvid.cc']);
// Baru:
const THUMB_HOSTS = new Set(['i.vdy.to']);
```

### Video Resolve — BERUBAH TOTAL
xpvid.cc pakai `embed.php?bucket=vidoycdn&id=`. vdy.to pakai JWT di halaman `/d/<id>`.

```js
// vdy.to resolve flow:
// 1. GET /d/<id> → extract var embedToken = 'eyJ...'
// 2. Decode JWT part[0] (base64 → JSON) — ini FORMAT 2-PART (payload.signature), bukan 3-part
// 3. payload.rf → https://vidoycdn.b-cdn.net/<rf>
// 4. payload.im → https://i.vdy.to/image/<im> (im sudah include ekstensi .jpg)
// Fallback: GET /stream.php?bucket=vidoycdn&id=<id>&t=<embedToken>
```

**PENTING:** JWT-nya 2-part (bukan 3-part standar). `split('.')[0]` = payload, `split('.')[1]` = signature biner (bukan base64 JSON).

### Thumbnail URL
```
https://i.vdy.to/image/<payload.im>
// payload.im sudah include ekstensi: "RD7qf5A7S7.jpg"
// Jadi URL langsung: https://i.vdy.to/image/RD7qf5A7S7.jpg
```

## Kenapa stream.php sebagai fallback?
`stream.php?bucket=vidoycdn&id=&t=` lebih reliable jika CDN path berubah format. Tapi JWT decode lebih cepat (1 HTTP request vs 2). Implementasi coba JWT dulu, fallback ke stream.php jika gagal.

**Why:** Token TTL dari JWT field `exp` ~1 tahun — tidak perlu self-healing agresif seperti P2.
