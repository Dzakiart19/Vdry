---
name: Vidorey Nav Drawer (Platform Switcher)
description: Platform switcher adalah hamburger sidebar drawer. Dua seksi berbeda — listing platform di atas divider, TikTok-style di bawah. 6 platform, 6 HTML files.
---

## The Rule
Platform navigation adalah **sidebar drawer** (hamburger ≡ button), BUKAN dropdown. Nama platform di UI **tidak boleh menyebut nama web sumber** (ruangbokep, yobokep, bokepking, tik.porn, situsbokep, dst).

## Reality check (2026-07-14)
Vidorey punya **6 platform aktif**, bukan 7. Sempat ada rencana/leftover kode untuk "Platform 6 rc" (Vidorey TikTok 2, reddclips) tapi **tidak pernah dibangun** — tidak ada `rc.html` atau `lib/scrapers/rc.js` di repo. Dokumen lama (dan beberapa memory file lain) salah menyebut sb sebagai "Platform 7" dan menyisipkan rc sebagai "Platform 6" — itu keliru. Urutan yang benar: p1, rb (P2), yb (P3), bk (P4), tp (P5), sb (P6). Jika suatu saat rc benar-benar dibangun, itu akan jadi Platform 7.

## ATURAN SEKSI NAV DRAWER (WAJIB DIIKUTI)

Nav drawer dibagi dua seksi yang terpisah jelas:

### Seksi Atas — Platform Listing Biasa
Platform dengan UI listing/grid (video card + pagination + search bar + kategori). Ditempatkan di atas `<hr class="nav-section-divider">`, **tidak ada label** untuk seksi ini.

| Platform | URL | Nama UI |
|---|---|---|
| P1 | `/` | Vidorey 1 |
| P2 | `/rb` | Vidorey 2 |
| P3 | `/yb` | Vidorey 3 |
| P4 | `/bk` | Vidorey 4 |
| P6 | `/sb` | Vidorey 6 |

### Seksi Bawah — "Fitur Lain" (KHUSUS TikTok-style)
Platform dengan UI TikTok-style (vertical scroll-snap, tidak ada grid/card). Ditempatkan **di bawah** `<hr class="nav-section-divider">` + label `<div class="nav-drawer-label">Fitur Lain</div>`.

| Platform | URL | Nama UI |
|---|---|---|
| P5 | `/tp` | Vidorey TikTok 1 |

### Struktur HTML Nav Drawer (referensi)
```html
<!-- Seksi atas: listing platforms (P1, P2, P3, P4, P6) -->
<a class="nav-plat-item" href="/">...</a>
<a class="nav-plat-item" href="/rb">...</a>
<a class="nav-plat-item" href="/yb">...</a>
<a class="nav-plat-item" href="/bk">...</a>
<a class="nav-plat-item" href="/sb">...</a>

<!-- Divider — pemisah listing vs TikTok -->
<hr class="nav-section-divider">
<div class="nav-drawer-label">Fitur Lain</div>

<!-- Seksi bawah: TikTok-style ONLY (P5) -->
<a class="nav-plat-item" href="/tp">...</a>
```

**Why:** User eksplisit complaint bahwa listing platform (sb) ditaruh di "Fitur Lain" bersama TikTok. "Fitur Lain" HANYA untuk TikTok-style — platform dengan UI berbeda dari listing biasa. Listing platform apapun wajib masuk seksi atas.

**How to apply:** Platform baru listing → sisipkan sebelum `<hr class="nav-section-divider">`. Platform baru TikTok-style → sisipkan setelah `<div class="nav-drawer-label">Fitur Lain</div>`. Jangan terbalik.

## Why
Dropdown lama tidak terlihat user. Diganti hamburger ChatGPT-style. Nama sumber disembunyikan atas permintaan user eksplisit.

## Nama Platform (UI — nav drawer & topbar)
| Platform | URL | Nama UI | Deskripsi Nav | Seksi |
|---|---|---|---|---|
| P1 | `/` | Vidorey 1 | Folder video · streaming | Atas |
| P2 | `/rb` | Vidorey 2 | Video harian · cari & tonton & kategori | Atas |
| P3 | `/yb` | Vidorey 3 | Video harian · cari & tonton & kategori | Atas |
| P4 | `/bk` | Vidorey 4 | Video harian · cari & tonton & kategori | Atas |
| P6 | `/sb` | Vidorey 6 | Video harian · cari & tonton & kategori | Atas |
| P5 | `/tp` | Vidorey TikTok 1 | TikTok · scroll vertikal · tag browser | Bawah (Fitur Lain) |

## IDs dan classes — state saat ini

### HTML (aktif)
| Element | ID | Class |
|---|---|---|
| Hamburger button (P1–P4, P6) | `navBurger` | `.nav-burger` |
| Hamburger button (P5 tp.html) | `tpNavBurger` | `.nav-burger` |
| Backdrop overlay | `navOverlay` | `.nav-overlay` |
| Drawer panel | `navDrawer` | `.nav-drawer` |
| Close button | `navClose` | `.nav-drawer-close` |
| Platform items | — | `.nav-plat-item` / `.nav-plat-item.active` |

**Catatan:** P5 punya topbar custom, sehingga burger ID-nya berbeda dari P1–P4/P6. Nav drawer & overlay tetap pakai ID yang sama: `navDrawer`, `navOverlay`, `navClose`.

### Dihapus dari HTML (jangan referensikan)
- `id="platformSwitcher"` — gone
- `id="psTrigger"` — gone
- `id="psMenu"` — gone

### Avatar logo
Semua `.ps-avatar` pakai **`<img src="/logo.png" alt="Vidorey">`** — logo Vidorey yang sama untuk semua platform.

### Per-platform avatar CSS class
| Platform | Extra class | Warna |
|---|---|---|
| P1 (index) | (none / `.ps-avatar` default) | — |
| P2 (rb) | `.ps-avatar-rb` | — |
| P3 (yb) | `.ps-avatar-yb` | — |
| P4 (bk) | `.ps-avatar-bk` | — |
| P6 (sb) | `.ps-avatar-sb` | gradient hijau `#065f2e → #34d399` |
| P5 (tp) | `.ps-avatar-tp` | — |

### CSS dead code di style.css (tidak berbahaya, tidak dipakai)
`.ps-trigger`, `.ps-menu`, `.ps-chevron`, `@keyframes psIn` — masih di CSS tapi tidak ada HTML yang pakai.

## Z-index hierarchy
| Layer | z-index |
|---|---|
| `.topbar` (P1–P4, P6) | 100 |
| `.nav-overlay` | 149 |
| `.nav-drawer` | 150 |
| `.modal` (video player) | 500 |

## Active item per halaman
- `index.html` → Vidorey 1 `.active` + `aria-current="page"`
- `rb.html` → Vidorey 2 `.active` + `aria-current="page"`
- `yb.html` → Vidorey 3 `.active` + `aria-current="page"`
- `bk.html` → Vidorey 4 `.active` + `aria-current="page"`
- `sb.html` → Vidorey 6 `.active` + `aria-current="page"`
- `tp.html` → Vidorey TikTok 1 `.active` + `aria-current="page"`

## SPA Route — WAJIB di setiap scraper

Setiap `lib/scrapers/pN.js` **wajib** punya dua route SPA:
```js
const path = require('path');
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
router.get('/pN',   (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'pN.html')));
router.get('/pN/*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'pN.html')));
```
Tanpa ini, `/pN` dan `/pN/watch/<token>` akan jatuh ke SPA fallback di `server.js` yang serve `index.html` (Platform 1) — klik dari nav drawer selalu ke Platform 1, deep-link tidak bekerja.

**Bug ini sudah terjadi pada Platform 6 (SB) pertama kali — sudah fix, jangan ulangi.**

## How to Apply
Saat menambah platform baru:
1. Update SEMUA HTML files (index, rb, yb, bk, sb, tp, + platform baru)
2. Listing biasa → masukkan SEBELUM `<hr class="nav-section-divider">` (seksi atas)
3. TikTok-style → masukkan SETELAH label "Fitur Lain" (seksi bawah)
4. Gunakan burger ID yang sesuai dengan topbar masing-masing
5. Nama platform di UI tidak boleh menyebut nama web sumber
6. Tambah avatar CSS class `.ps-avatar-pN` di `style.css` dengan gradient background unik
7. Tambah SPA route di scraper (lihat bagian SPA Route di atas)

**Full checklist:** lihat `new-platform-checklist.md` untuk format HTML nav entry yang tepat.
