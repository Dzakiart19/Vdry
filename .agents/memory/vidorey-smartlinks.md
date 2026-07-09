---
name: Vidorey Smartlinks
description: smartlinks.js — 5 trigger monetisasi, rotasi 4 link (3 Smartlink + 1 Direct Link), dedup 200ms.
---

## File: public/smartlinks.js

## IIFE, tidak ada export/global — diload via `<script src="/smartlinks.js">` di semua 5 HTML.

## 5 Trigger aktif

| # | Trigger | Selector/Event | Catatan |
|---|---|---|---|
| 1 | First click | `document click` (one-time, self-removes) | Buka tab baru pertama kali user klik di manapun |
| 2 | Video card click | `.video-card, .rb-card, .folder-card, .tp-slide` | Setiap klik thumbnail/card |
| 3 | Platform nav click | `.nav-plat-item` | Klik item di nav drawer (semua 5 platform) |
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

## Diload di semua platform
index.html, rb.html, yb.html, bk.html, tp.html — semua sudah punya `<script src="/smartlinks.js">` sebelum `</body>`.
