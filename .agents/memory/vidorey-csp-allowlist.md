---
name: Vidorey CSP Allowlist
description: script-src tidak pakai https: wildcard — domain eksplisit wajib ditambah setiap kali ada script/ad network baru ditambahkan ke HTML.
---

## The Rule
`script-src` di CSP Helmet **tidak menggunakan wildcard `https:`**. Setiap domain script eksternal harus didaftarkan eksplisit di `server.js`.

## Why
Wildcard `https:` pada praktiknya menghilangkan proteksi allowlist — browser akan izinkan script dari domain manapun selama HTTPS. Ini memperluas blast radius jika ada HTML injection dari surface iklan/third-party.

## Domain yang Diizinkan Saat Ini (server.js → scriptSrc)
- `'self'` + `'unsafe-inline'` — wajib karena HTML masih pakai inline `<script>`
- `https://cdn.jsdelivr.net` — hls.js (rb.html + yb.html)
- `https://www.googletagmanager.com` — GTM (semua halaman)
- `https://pl28423230.effectivecpmnetwork.com` — Adsterra native banner
- `https://pl28418540.effectivecpmnetwork.com` — Adsterra popunder
- `https://pl28427857.effectivecpmnetwork.com` — Adsterra social bar
- `https://www.highperformanceformat.com` — Adsterra display ad (300×250, 728×90, 468×60, 160×600, 160×300, 320×50)
- `https://pl26548697.profitableratecpm.com` — Adsterra (Platform 5 tp.html)
- `https://pl26548687.profitableratecpm.com` — Adsterra (Platform 5 tp.html)
- `https://turbulentrefreshments.com` — Adsterra direct tag (semua platform)
## How to Apply
Setiap kali menambahkan tag `<script src="https://...">` baru ke salah satu HTML (index/rb/yb/bk/tp), tambahkan domainnya ke array `scriptSrc` di `server.js` **sebelum** deploy. Tanpa ini, script diblokir browser secara diam-diam (tidak ada error di server, hanya di browser console).

Sama berlaku untuk `style-src` (`fonts.googleapis.com`) dan `font-src` (`fonts.gstatic.com`) — jika font/CSS provider berubah, update kedua array itu.

## connect-src juga wajib di-allowlist (bukan cuma script-src)
`connectSrc` default cuma `'self'` — ini diam-diam memblokir beacon `fetch`/`sendBeacon` GA4 (dikirim via GTM) meski GTM script-nya sendiri sudah di-allowlist di `scriptSrc`. GA4 mengirim ke `www.google-analytics.com`, `*.google-analytics.com`, `analytics.google.com`, dan kadang `www.google.com` (consent-mode fallback) — keempatnya wajib ada di `connectSrc` atau analytics tidak pernah dapat data sama sekali, tanpa error di server (hanya keliatan di browser console sebagai CSP violation).
