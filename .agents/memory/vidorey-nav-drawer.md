---
name: Vidorey Nav Drawer (Platform Switcher)
description: Platform switcher adalah hamburger sidebar drawer. Nama platform tidak menyebut sumber asli. 6 platform, 6 HTML files.
---

## The Rule
Platform navigation adalah **sidebar drawer** (hamburger ≡ button), BUKAN dropdown. Nama platform di UI **tidak boleh menyebut nama web sumber** (ruangbokep, yobokep, bokepsex, reddclips, tik.porn, dst).

## Why
Dropdown lama tidak terlihat user. Diganti hamburger ChatGPT-style. Nama sumber disembunyikan atas permintaan user eksplisit.

## Nama Platform (UI — nav drawer & topbar)
| Platform | URL | Nama UI | Deskripsi Nav |
|---|---|---|---|
| P1 | `/` | Vidorey 1 | Platform 1 · pencarian video |
| P2 | `/rb` | Vidorey 2 | Platform 2 · streaming video |
| P3 | `/yb` | Vidorey 3 | Platform 3 · video premium |
| P4 | `/bk` | Vidorey 4 | Platform 4 · video dewasa |
| P5 | `/tp` | Vidorey TikTok 1 | TikTok 1 · scroll vertikal |
| P6 | `/rc` | Vidorey TikTok 2 | TikTok 2 · per kategori |

## IDs dan classes — state saat ini

### HTML (aktif)
| Element | ID | Class |
|---|---|---|
| Hamburger button (P1–P4) | `navBurger` | `.nav-burger` |
| Hamburger button (P5 tp.html) | `tpNavBurger` | `.nav-burger` |
| Hamburger button (P6 rc.html) | `rcNavBurger` | `.nav-burger` |
| Backdrop overlay | `navOverlay` | `.nav-overlay` |
| Drawer panel | `navDrawer` | `.nav-drawer` |
| Close button | `navClose` | `.nav-drawer-close` |
| Platform items | — | `.nav-plat-item` / `.nav-plat-item.active` |

**Catatan:** P5 dan P6 punya topbar custom, sehingga burger ID-nya berbeda dari P1–P4. Nav drawer & overlay tetap pakai ID yang sama: `navDrawer`, `navOverlay`, `navClose`.

### Dihapus dari HTML (jangan referensikan)
- `id="platformSwitcher"` — gone
- `id="psTrigger"` — gone
- `id="psMenu"` — gone

### Avatar logo
Semua `.ps-avatar` pakai **`<img src="/logo.png" alt="Vidorey">`** — logo Vidorey yang sama untuk semua platform.

### Per-platform avatar CSS class
| Platform | Extra class |
|---|---|
| P1 (index) | `.ps-avatar-p1` |
| P2 (rb) | `.ps-avatar-rb` |
| P3 (yb) | `.ps-avatar-yb` |
| P4 (bk) | `.ps-avatar-bk` |
| P5 (tp) | `.ps-avatar-tp` |
| P6 (rc) | `.ps-avatar-rc` (gradient merah-oranye) |

### CSS dead code di style.css (tidak berbahaya, tidak dipakai)
`.ps-trigger`, `.ps-menu`, `.ps-chevron`, `@keyframes psIn` — masih di CSS tapi tidak ada HTML yang pakai.

## Z-index hierarchy
| Layer | z-index |
|---|---|
| `.topbar` (P1–P4) | 100 |
| `body.rc-page .nav-overlay` | 149 |
| `body.rc-page .nav-drawer` | 150 |
| `.nav-overlay` (umum) | 149 |
| `.nav-drawer` | 150 |
| `.modal` (video player) | 500 |

## Active item per halaman
- `index.html` → Vidorey 1 `.active` + `aria-current="page"`
- `rb.html` → Vidorey 2 `.active` + `aria-current="page"`
- `yb.html` → Vidorey 3 `.active` + `aria-current="page"`
- `bk.html` → Vidorey 4 `.active` + `aria-current="page"`
- `tp.html` → Vidorey TikTok 1 `.active` + `aria-current="page"`
- `rc.html` → Vidorey TikTok 2 `.active` + `aria-current="page"`

## How to Apply
Saat menambah platform baru: update SEMUA 6 HTML files (index, rb, yb, bk, tp, rc). Gunakan burger ID yang sesuai dengan topbar masing-masing (custom topbar → ID custom). Nama platform di UI tidak boleh menyebut nama web sumber.

Tambah juga avatar CSS class `.ps-avatar-pN` di `style.css` dengan gradient background unik.

**Full checklist:** lihat `new-platform-checklist.md` Fase 5 untuk format HTML nav entry yang tepat.
