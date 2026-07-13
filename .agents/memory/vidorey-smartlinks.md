---
name: Vidorey Smartlinks
description: smartlinks.js — 5 trigger monetisasi, rotasi 4 link (3 Smartlink + 1 Direct Link), dedup 200ms. Diload di semua 7 HTML.
---

## File: public/smartlinks.js

## IIFE, tidak ada export/global — diload via `<script src="/smartlinks.js">` di semua 7 HTML.

## CARD_SEL (saat ini)
```js
var CARD_SEL = '.video-card, .rb-card, .folder-card, .tp-slide, .rc-slide, .sb-card';
```

| Class | Platform | Tipe |
|---|---|---|
| `.video-card` | P1 (index) | Listing grid card |
| `.rb-card` | P2 (rb), P3 (yb), P4 (bk), P7 (sb) | Listing grid card — dipakai oleh semua listing platform yang copy rb.html template |
| `.sb-card` | P7 (sb) | Listing grid card SB — **punya class `.rb-card.sb-card` dua-duanya** |
| `.folder-card` | P1 (index) | Folder card |
| `.tp-slide` | P5 (tp) | TikTok slide |
| `.rc-slide` | P6 (rc) | TikTok slide |

**Catatan P7:** Card P7 pakai `class="rb-card sb-card"` (dua class). `.rb-card` sudah ada di CARD_SEL sehingga trigger card click sudah aktif tanpa perlu `.sb-card` — tapi `.sb-card` tetap ditambahkan untuk explicitness dan future-proof jika template diubah.

## 5 Trigger aktif

| # | Trigger | Selector/Event | Catatan |
|---|---|---|---|
| 1 | First click | `document click` (one-time, self-removes) | Buka tab baru pertama kali user klik di manapun |
| 2 | Video card click | `CARD_SEL` (lihat atas) | Setiap klik thumbnail/card/slide |
| 3 | Platform nav click | `.nav-plat-item` | Klik item di nav drawer (semua 7 platform) |
| 4 | Timer 5 detik | `setTimeout(tryFire, 5000)` | Otomatis setelah 5s halaman dibuka |
| 5 | Exit intent | `mouseleave` (clientY≤0 desktop) + `pagehide` (mobile) | Satu kali per sesi (`exitFired` flag) |

## Rotasi link — 4 link
- 3 Smartlink Adsterra/EffectiveCPM
- 1 Direct Link (Tautan Pintar) Adsterra
- `idx++` mod 4 → bergantian
- Dedup 200ms: `if (now - lastFireMs < 200) return` — cegah double-fire

## Guard keamanan
- `if (!(e.target instanceof Element)) return` — tidak crash jika target bukan DOM element
- `try { window.open(...) } catch(e) {}` — tidak crash jika popup diblokir browser
- `exitFired` flag — exit intent hanya satu kali per page load

## Diload di semua platform (7 HTML)
index.html, rb.html, yb.html, bk.html, **sb.html**, tp.html, rc.html — semua sudah punya `<script src="/smartlinks.js">` sebelum `</body>`.

## Saat tambah platform baru
Tambah class card-nya ke `CARD_SEL`:
- Listing platform (grid card): tambah `.pN-card` — atau cek apakah sudah dapat `.rb-card` dari template
- TikTok-style: tambah `.pN-slide`
