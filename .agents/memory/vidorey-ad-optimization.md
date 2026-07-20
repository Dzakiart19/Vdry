---
name: Vidorey Ad Optimization
description: Semua layer iklan aktif di Vidorey — arsitektur ads.js, cara kerja tiap layer, status per platform, dan hasil audit lengkap.
---

# Vidorey Ad Optimization

## Root cause awal: Modal ads loaded while display:none
`.modal.hidden { display: none; }` → semua inline `<script>` di dalam modal run saat page load ketika container `display:none`. Adsterra membuat iframe 0×0, viewability 0%, kesan tidak dihitung.

**Fix:** Hapus semua inline `<script>atOptions...</script>` dari modal HTML, ganti dengan `data-ad-zone="ZONE"` attribute. Inject ulang secara dinamis saat modal terbuka via `VdryAds.reloadModalAds(modalEl)`.

---

## Domain mirror Adsterra
`effectivecpmnetwork.com`, `turbulentrefreshments.com`, dan `highperformanceformat.com` adalah **CDN mirror Adsterra** — hash key identik, domain pengiriman berbeda. Jangan dianggap provider berbeda.

---

## ads.js — shared utility (public/ads.js)

Semua fungsi ad management terpusat di sini. Wajib di-load di setiap platform HTML **sebelum** platform JS.

### Zone registry (ZONES)

| Key | Dimensi | CDN | Key Hash |
|-----|---------|-----|----------|
| `lb-728`     | 728×90  | turbulentrefreshments.com  | `ad23cecb6cc7205a344717b0998c822d` |
| `mb-320`     | 320×50  | highperformanceformat.com  | `d37e31d713d11b2ddde7d3efca199c9d` |
| `box-300`    | 300×250 | highperformanceformat.com  | `d50b941ac6d9bd5749dcdb0b417bf348` |
| `sky-160`    | 160×600 | turbulentrefreshments.com  | `e0fc9f770eacb77e8afcfde28d8a06a8` |
| `half-160`   | 160×300 | turbulentrefreshments.com  | `d7a21e9839cad22a65ed9e21e6a33272` |
| `banner-468` | 468×60  | turbulentrefreshments.com  | `f517b5d3c983922d55c67370c8bd95fc` |

### URL khusus (bukan iframe zone)

| Nama | URL | Zone ID |
|------|-----|---------|
| `POP_URL` | `turbulentrefreshments.com/khj65tru?key=188aaea14e197cc95790b8dca5bbbdfd` | 28318041 (Popunder) |
| `SMARTLINK_URL` | `turbulentrefreshments.com/z6ec2ixj7?key=bafa7c785c7d84482705d8749d9b28de` | 28322880 (Smartlink) |

### Script static di semua HTML (bukan via ZONES)

| Format | Script hash | CDN |
|--------|-------------|-----|
| Native Banner | `761a1a8645cd2263043bfeb6f2e87eea` | pl28423230.effectivecpmnetwork.com |
| Social Bar | `96e9ff95727320b49c1ea1aa80add9b6` | pl28427857.effectivecpmnetwork.com |
| (format lain) | `e223516a3660ad6a4214cb47e436c599` | pl28418540.effectivecpmnetwork.com |

**Native Banner** butuh container div: `<div id="container-761a1a8645cd2263043bfeb6f2e87eea"></div>`.

---

### VdryAds API

**`reloadModalAds(modalEl)`**
- Panggil tepat setelah `modal.classList.remove('hidden')`
- Find semua `[data-ad-zone]` di dalam modal, inject fresh scripts dengan cache-buster `?_t=Date.now()`, stagger 250ms per slot
- **Auto-refresh setiap 60 detik** selama modal visible
- Interval dibatalkan dan di-reset saat `reloadModalAds` dipanggil ulang

**`initListingAds()`**
- Auto-dipanggil via `DOMContentLoaded` — tidak perlu panggil manual
- Inject semua `[data-ad-zone]` di luar modal (listing/grid page)
- **Auto-refresh setiap 90 detik**
- Jika iframe tidak muncul setelah 6 detik → container disembunyikan (mencegah kotak kosong)

**`injectAd(container, zoneName)`**
- Low-level: bersihkan container, buat `atOptions` script + invoke script baru dengan cache-buster
- **Hide-if-unfilled**: setTimeout 6s → jika tidak ada `<iframe>` → `container.style.display='none'`
- MutationObserver membatalkan hide jika iframe muncul sebelum 6s
- Saat re-inject: `container.style.display=''` (restore dulu)
- **Sticky slots tidak pernah di-hide** — cek `isSticky` via class check

**`initVideoOverlay(prefix)`**
- Persistent overlay bar di video player — muncul 5s setelah play, countdown 5s, muncul lagi tiap 120s
- **Ketuk bar → buka `SMARTLINK_URL` di tab baru** (bukan triggerPopunder — karena Adsterra tidak re-render zone duplikat)
- Elemen yang dibutuhkan: `#PREFIXVideoEl`, `#PREFIXVideoAdOverlay`, `#PREFIXVideoAdClose`, `#PREFIXVideoAdTimer`, `#PREFIXVideoAdContent`

**`initVideoTap(prefix)`**
- Transparent div `#PREFIXVideoTapZone` menutup area video (top 0, bottom 64px)
- Tap → `triggerPopunder()` + toggle play/pause `<video>`
- Untuk iframe-mode platforms (rb/yb): `pointer-events:none` 250ms

**`initTpFeed()`**
- Khusus tp.html — tap delegation di `#tpFeed` → `triggerPopunder()`
- Fixed overlay bar `#tpAdBar` (position:fixed)

**`triggerPopunder()`**
- `window.open(POP_URL, '_blank')` + `w.blur(); window.focus()`
- Rate-limit: 1× per 30 detik global

---

## Sticky Banner System (Juli 2026)

Setiap halaman punya dua sticky banner yang berjalan sepanjang scroll:

### `.vd-sticky-top` — below topbar
```html
<div class="vd-sticky-top" aria-label="Advertisement">
  <div class="vd-sticky-top-lb" data-ad-zone="lb-728"></div>   <!-- desktop -->
  <div class="vd-sticky-top-mb" data-ad-zone="mb-320"></div>   <!-- mobile -->
</div>
```
- `position: fixed; top: var(--topbar-h); z-index: 90`
- Desktop: lb-728 (728×90) tampil, mb-320 disembunyikan
- Mobile: mb-320 (320×50) tampil, lb-728 disembunyikan

### `.vd-sticky-bottom` — footer
```html
<div class="vd-sticky-bottom" aria-label="Advertisement">
  <div class="vd-sticky-bottom-lb" data-ad-zone="banner-468"></div>  <!-- desktop only -->
</div>
```
- `position: fixed; bottom: 0; z-index: 90`
- **Desktop only** — `display: none` di mobile (`max-width: 768px`)
- Pakai `banner-468` (468×60) bukan `lb-728` — **zone conflict rule** (lihat bawah)

### ⚠️ Zone Conflict Rule — WAJIB DIPATUHI
**Adsterra hanya serve 1 instance per zone key per halaman.**
Jika top dan bottom pakai zone key yang sama (`lb-728`), bottom selalu blank.

**Solusi:** Top = `lb-728` / `mb-320`; Bottom = **`banner-468`** (key berbeda).
Jangan pernah pakai zone key yang sama di dua slot berbeda dalam satu halaman.

### CSS Variables (style.css :root)
```css
--sticky-top-h:    54px;   /* mobile: mb-320 (50px) + 4px */
--sticky-bottom-h: 0px;    /* mobile: no bottom banner */

@media (min-width: 769px) {
  --sticky-top-h:    94px; /* desktop: lb-728 (90px) + 4px */
  --sticky-bottom-h: 64px; /* desktop: banner-468 (60px) + 4px */
}
```

`.shell` padding-top/bottom menggunakan var ini agar konten tidak tertutup banner.
`body.rb-page .shell` dan `.rb-searchbar` juga ikut disesuaikan.

### Status per halaman
Semua 9 HTML (index, rb, yb, bk, tp, sb, xn, vd, zg) sudah punya kedua div sticky di atas `</body>`.

---

## Status per platform (audit Juli 2026)

| Platform | ads.js | data-ad-zone slots | Social Bar | Native Banner | reloadModalAds | initVideoOverlay | initVideoTap | Sticky Top | Sticky Bottom |
|----------|--------|--------------------|------------|---------------|----------------|------------------|--------------|------------|---------------|
| index (P1) | ✅ | 12 | ✅ | ✅ | ✅ app.js | ✅ | ✅ | ✅ lb-728/mb-320 | ✅ banner-468 |
| rb.html (P2) | ✅ | 12 | ✅ | ✅ | ✅ rb.js | ✅ | ✅ | ✅ lb-728/mb-320 | ✅ banner-468 |
| yb.html (P3) | ✅ | 12 | ✅ | ✅ | ✅ yb.js | ✅ | ✅ | ✅ lb-728/mb-320 | ✅ banner-468 |
| bk.html (P4) | ✅ | 12 | ✅ | ✅ | ✅ bk.js | ✅ | ✅ | ✅ lb-728/mb-320 | ✅ banner-468 |
| tp.html (P5) | ✅ | 2 (footer only) | ✅ | ✅ | — no modal | — (initTpFeed) | — (initTpFeed) | ✅ lb-728/mb-320 | ✅ banner-468 |
| sb.html (P6) | ✅ | 12 | ✅ | ✅ | ✅ sb.js | ✅ | ✅ | ✅ lb-728/mb-320 | ✅ banner-468 |
| vd.html (P7) | ✅ | 12 | ✅ | ✅ | ✅ vd.js | ✅ | ✅ | ✅ lb-728/mb-320 | ✅ banner-468 |
| xn.html (P8) | ✅ | 12 | ✅ | ✅ | ✅ xn.js | ✅ | ✅ | ✅ lb-728/mb-320 | ✅ banner-468 |
| zg.html (P9) | ✅ | 12 | ✅ | ✅ | ✅ zg.js | ✅ | ✅ | ✅ lb-728/mb-320 | ✅ banner-468 |

---

## Layer iklan aktif dan revenue flow

| Layer | Trigger | Zone | CPM Est. |
|-------|---------|------|----------|
| Popunder | Klik thumbnail (openModal) | 28318041 | $1–5 adult |
| Smartlink | Ketuk overlay bar video | 28322880 | $0.5–2 |
| Social Bar | Auto per pageview | 28327358 | Stabil rendah |
| Native Banner | Auto per pageview | 28322731 | Medium |
| Sticky Top Banner (desktop lb-728 / mobile mb-320) | Scroll sepanjang halaman | lb-728 / mb-320 | $0.3–1 |
| Sticky Bottom Banner (desktop banner-468 only) | Scroll sepanjang halaman | banner-468 | $0.2–0.6 |
| Banner modal (6-7 slot × auto-refresh 60s) | Modal buka | box-300 dll | $0.3–1 |
| Banner listing (auto-refresh 90s) | Page load | semua ZONES | $0.2–0.8 |
| Video overlay bar | Play video +5s | → Smartlink | via Smartlink |
| Video tap zone | Tap area video | → Popunder | via Popunder |

---

## CSS yang wajib ada (style.css)

```css
.video-stage { position: relative; }   /* wajib agar overlay absolute bekerja */
.video-ad-overlay { position: absolute; bottom: 52px; }
.video-tap-zone { position: absolute; top: 0; bottom: 64px; z-index: 25; }
.tp-ad-bar { position: fixed; bottom: 0; z-index: 200; }   /* khusus tp */
.watch-ad-slot:empty { display: none; }   /* `:empty` untuk pre-inject; JS hide-if-unfilled untuk post-inject */
.vd-sticky-top  { position: fixed; top: var(--topbar-h); left: 0; right: 0; z-index: 90; }
.vd-sticky-bottom { position: fixed; bottom: 0; left: 0; right: 0; z-index: 90; }
```

---

## Pola JS init (tiap platform baru)

```js
// Di openModal() / openPlayer():
if (window.VdryAds) VdryAds.triggerPopunder();
if (window.VdryAds) VdryAds.reloadModalAds(els.modal);

// Di init / DOMContentLoaded (sekali saja):
if (window.VdryAds) VdryAds.initVideoOverlay('PREFIX');
if (window.VdryAds) VdryAds.initVideoTap('PREFIX');
// Khusus tp:
if (window.VdryAds) VdryAds.initTpFeed();
```

**Why:** Semua wrapped dalam `if (window.VdryAds)` — graceful degradation jika ads.js gagal load.

---

## Bug yang pernah terjadi

- **vd.html + zg.html Social Bar salah zone** (`ba0fd8e8...` dari website lain). Fix: ganti ke `96e9ff95727320b49c1ea1aa80add9b6` (zone 28327358 vidorey.web.app).
- **`:empty` tidak bekerja setelah script inject** — CSS `:empty` tidak match setelah `<script>` ditambah ke container. Fix: JS hide-if-no-iframe setelah 6s di `injectAd()`.
- **tp.html footer banner zone salah** — `.tp-footer-lb` dan `.tp-footer-mobile` awalnya pakai key box-300 (300×250). Fix: ganti ke `lb-728` dan `mb-320`.
- **index.html modal kurang 1 slot** — `watch-info-ad-slot` (half-160) hilang. Fix: tambah setelah `.watch-title-row`.
- **Sticky bottom blank** — top dan bottom pakai zone `lb-728` yang sama. Adsterra hanya serve 1 instance per zone key per halaman → bottom selalu kosong. Fix: bottom pakai `banner-468` (key berbeda).
