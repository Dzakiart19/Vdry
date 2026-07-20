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
- `https://turbulentrefreshments.com` — ⚠️ JANGAN PAKAI sebagai pengganti popunder — domain baru diblokir browser built-in popup blocker, popunder tidak jalan sama sekali
- `https://pl28427857.effectivecpmnetwork.com` — Adsterra social bar
- `https://www.highperformanceformat.com` — Adsterra display ad (300×250, 728×90, 468×60, 160×600, 160×300, 320×50)
- `https://pl26548697.profitableratecpm.com` — Adsterra (Platform 5 tp.html)
- `https://pl26548687.profitableratecpm.com` — Adsterra (Platform 5 tp.html)
- `https://s10.histats.com` — Histats visitor counter JS (/monitor page)

## How to Apply
Setiap kali menambahkan tag `<script src="https://...">` baru ke salah satu HTML (index/rb/yb/bk/tp), tambahkan domainnya ke array `scriptSrc` di `server.js` **sebelum** deploy. Tanpa ini, script diblokir browser secara diam-diam (tidak ada error di server, hanya di browser console).

Sama berlaku untuk `style-src` (`fonts.googleapis.com`) dan `font-src` (`fonts.gstatic.com`) — jika font/CSS provider berubah, update kedua array itu.

## connect-src juga wajib di-allowlist (bukan cuma script-src)
`connectSrc` default cuma `'self'` — ini diam-diam memblokir beacon `fetch`/`sendBeacon` GA4 (dikirim via GTM) meski GTM script-nya sendiri sudah di-allowlist di `scriptSrc`. GA4 mengirim ke `www.google-analytics.com`, `*.google-analytics.com`, `analytics.google.com`, dan kadang `www.google.com` (consent-mode fallback) — keempatnya wajib ada di `connectSrc` atau analytics tidak pernah dapat data sama sekali, tanpa error di server (hanya keliatan di browser console sebagai CSP violation).

## connect-src saat ini (server.js → connectSrc)
- `'self'`
- `https://www.google-analytics.com`
- `https://*.google-analytics.com`
- `https://analytics.google.com`
- `https://www.googletagmanager.com`
- `https://www.google.com`
- `https://s10.histats.com` — Histats script CDN
- `https://sstatic1.histats.com` — Histats counter image CDN
- `https://histats.com` — Histats API
- `https://www.histats.com` — Histats stats API (dibutuhkan oleh js15_as.js untuk fetch data counter)

## imgSrc saat ini (server.js → imgSrc)
- `'self'`, `data:`, `https:` (wildcard HTTPS images — aman karena ini hanya gambar)
- `http://sstatic1.histats.com` — Histats counter image via HTTP fallback

## Catatan Histats
Histats JS (`js15_as.js`) melakukan koneksi ke beberapa subdomain:
- `s10.histats.com` — load script utama (wajib di scriptSrc)
- `sstatic1.histats.com` — fetch counter image (wajib di imgSrc + connectSrc)
- `www.histats.com` — API data counter (wajib di connectSrc, jika absen counter tidak render)

Counter widget JS Histats **hanya render di domain yang terdaftar** di akun Histats (biasanya `vidorey.web.app`). Di URL dev Replit (`*.pike.replit.dev`), counter JS tidak muncul — ini perilaku normal Histats, bukan bug CSP.
