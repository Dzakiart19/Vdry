---
name: Vidorey Ad Optimization
description: Arsitektur iklan Adsterra lengkap — ads.js, zone registry, sticky system, setup per platform, aturan zona, dan pola init. Status: sudah dioptimasi Juli 2026.
---

# Vidorey Ad Optimization

## Konteks: Mengapa setup ini

Traffic mayoritas Indonesia = Tier-3, CPM rendah. Adsterra AI Support merekomendasikan:
**Popunder + Social Bar + Native Banner** sebagai kombinasi terbaik untuk traffic ID.
Banner biasa hanya pelengkap — jangan berlebihan karena zone key duplikat di halaman yang sama justru menurunkan CPM.

---

## Root cause awal (sudah diperbaiki)

1. **Modal ads loaded saat `display:none`** — inline `<script>atOptions...</script>` di dalam modal run saat page load ketika container hidden. Ad network buat iframe 0×0, viewability 0%. Fix: ganti semua ke `data-ad-zone` attribute, inject ulang dinamis saat modal dibuka via `VdryAds.reloadModalAds(modalEl)`.

2. **Zone key duplikat di halaman yang sama** — `box-300` muncul 2× di listing dan 2× di modal; `lb-728`/`mb-320`/`banner-468` muncul di inline listing sekaligus di sticky. Ad network hanya serve 1 instance per zone key per halaman → impresi kanibal. Fix: hapus semua duplikat, 1 zone key per posisi per halaman.

---

## Domain mirror ad network

`effectivecpmnetwork.com`, `turbulentrefreshments.com`, `highperformanceformat.com` adalah **CDN mirror dari jaringan Adsterra yang sama** — hash key identik, domain berbeda. Jangan anggap provider berbeda.

---

## ads.js — shared utility (public/ads.js)

Wajib di-load di semua platform HTML **sebelum** platform JS.

### Zone registry (ZONES)

| Key | Dimensi | CDN | Key Hash |
|-----|---------|-----|----------|
| `lb-728`     | 728×90  | turbulentrefreshments.com  | `ad23cecb6cc7205a344717b0998c822d` |
| `mb-320`     | 320×50  | highperformanceformat.com  | `d37e31d713d11b2ddde7d3efca199c9d` |
| `box-300`    | 300×250 | highperformanceformat.com  | `d50b941ac6d9bd5749dcdb0b417bf348` |
| `half-160`   | 160×300 | turbulentrefreshments.com  | `d7a21e9839cad22a65ed9e21e6a33272` |
| `banner-468` | 468×60  | turbulentrefreshments.com  | `f517b5d3c983922d55c67370c8bd95fc` |

> `sky-160` (160×600) sudah dihapus dari ZONES — tidak ada di HTML manapun. Jangan tambah kembali.

### URL khusus (bukan iframe zone)

| Nama | URL |
|------|-----|
| `POP_URL`      | `turbulentrefreshments.com/khj65tru?key=188aaea14e197cc95790b8dca5bbbdfd` |
| `SMARTLINK_URL`| `turbulentrefreshments.com/z6ec2ixj7?key=bafa7c785c7d84482705d8749d9b28de` |

### Script static di semua HTML (bukan via ZONES)

| Format | Script Hash | CDN |
|--------|-------------|-----|
| Native Banner | `761a1a8645cd2263043bfeb6f2e87eea` | pl28423230.effectivecpmnetwork.com |
| Popunder      | `e223516a3660ad6a4214cb47e436c599` | pl28418540.effectivecpmnetwork.com |
| Social Bar    | `96e9ff95727320b49c1ea1aa80add9b6` | pl28427857.effectivecpmnetwork.com |

Native Banner butuh container: `<div id="container-761a1a8645cd2263043bfeb6f2e87eea"></div>`.

---

## VdryAds API

### `reloadModalAds(modalEl)`
- Panggil tepat setelah `modal.classList.remove('hidden')`
- Find semua `[data-ad-zone]` di dalam modal, inject fresh scripts + cache-buster `?_t=Date.now()`, stagger 250ms per slot
- **Auto-refresh 60 detik** selama modal visible
- Interval di-cancel dan di-reset saat dipanggil ulang

### `initListingAds()`
- Auto-dipanggil via `DOMContentLoaded` — tidak perlu panggil manual
- Inject semua `[data-ad-zone]` yang match `LISTING_SELECTORS` di luar modal
- **Auto-refresh 90 detik**
- Jika iframe tidak muncul setelah 6s → container disembunyikan (mencegah kotak kosong)
- Sticky/fixed slots tidak pernah di-hide (cek via `isSticky` class check)

**`LISTING_SELECTORS` saat ini:**
```js
['.ad-display-slot', '.tp-display-top',
 '.vd-sticky-top-lb', '.vd-sticky-top-mb', '.vd-sticky-bottom-lb']
```

**`isSticky` class list** (slot yang tidak boleh di-hide jika unfilled):
```js
'vd-sticky-top-lb', 'vd-sticky-top-mb', 'vd-sticky-bottom-lb', 'tp-display-top'
```

### `injectAd(container, zoneName)`
- Low-level: clear container, buat `atOptions` + invoke script baru dengan cache-buster
- Restore `display:''` sebelum inject (undo hide dari inject sebelumnya)
- **Hide-if-unfilled:** setTimeout 6s → jika tidak ada `<iframe>` → `display:none`
- MutationObserver cancel hide jika iframe muncul sebelum 6s

### `initVideoOverlay(prefix)`
- **DIHAPUS / NO-OP** — fungsi masih ada tapi langsung `return`. Overlay bar dihapus karena semua zone key Adsterra sudah terpakai di posisi lain (zone conflict) sehingga konten ad tidak pernah muncul.
- CSS: `.video-ad-overlay { display: none !important }` — force hide agar tidak tampil bahkan dengan cached JS.
- **Jangan restore overlay ini** kecuali ada zone Adsterra baru yang belum dipakai.

### `initVideoTap(prefix)`
- Transparent div `#PREFIXVideoTapZone` menutup area video
- Tap → `triggerPopunder()` + toggle play/pause
- Iframe-mode (rb/yb): `pointer-events:none` 250ms agar kontrol iframe tetap bisa dijangkau

### `initTpFeed()`
- Khusus tp.html — tap delegation di `#tpFeed` → `triggerPopunder()`
- Fixed overlay bar `#tpAdBar` muncul 5s setelah load, reshow 120s

### `triggerPopunder()`
- `window.open(POP_URL, '_blank')` + `w.blur(); window.focus()`
- Rate-limit: 1× per 30 detik global (`_lastPop`, `POP_COOLDOWN_MS = 30000`)

### `triggerDirectlink()`
- `window.open(SMARTLINK_URL, '_blank')` — tab depan (foreground), bukan background
- **Cooldown TERPISAH** dari `triggerPopunder()` — pakai `_lastDirectlink` + `DL_COOLDOWN_MS = 5000`
- ⚠️ Sebelumnya share `_lastPop` sama dengan popunder → klik Download dalam 30 detik setelah buka modal tidak trigger. Fix: pisah variabel.
- Dipakai di download button semua platform MP4 (P1/BK/VD/ZG)

---

## Sticky Banner System

### `.vd-sticky-top` — fixed bawah topbar
```html
<div class="vd-sticky-top" aria-label="Advertisement">
  <div class="vd-sticky-top-lb" data-ad-zone="lb-728"></div>   <!-- desktop -->
  <div class="vd-sticky-top-mb" data-ad-zone="mb-320"></div>   <!-- mobile -->
</div>
```
- `position: fixed; top: var(--topbar-h); z-index: 98`
- Desktop (≥769px): `lb-728` (728×90) tampil, `mb-320` hidden
- Mobile (<769px): `mb-320` (320×50) tampil, `lb-728` hidden

### `.vd-sticky-bottom` — fixed footer
```html
<div class="vd-sticky-bottom" aria-label="Advertisement">
  <div class="vd-sticky-bottom-lb" data-ad-zone="banner-468"></div>
</div>
```
- `position: fixed; bottom: 0; z-index: 150`
- **Desktop only** — `display: none` di mobile
- Pakai `banner-468` bukan `lb-728` — **zone conflict rule** (lihat bawah)

### ⚠️ Zone Conflict Rule — WAJIB DIPATUHI
Ad network hanya serve **1 instance per zone key per halaman**.
Sticky top pakai `lb-728`/`mb-320`; sticky bottom wajib pakai `banner-468`.
Jangan pernah pasang zone key yang sama di dua slot berbeda dalam satu halaman.

### CSS Variables (style.css :root)
```css
--sticky-top-h:    54px;   /* mobile: mb-320 (50px) + 4px */
--sticky-bottom-h: 0px;    /* mobile: no bottom banner */

@media (min-width: 769px) {
  --sticky-top-h:    94px; /* desktop: lb-728 (90px) + 4px */
  --sticky-bottom-h: 64px; /* desktop: banner-468 (60px) + 4px */
}
```
`.shell` pakai `padding-top/bottom` dari var ini agar konten tidak tertutup.
`.modal-fullpage .modal-body` juga pakai `padding-bottom: var(--sticky-bottom-h)`.

---

## Layout iklan per platform

### P1–P4, P6–P9 (listing + watch modal)

**Listing page:**
```
[Popunder saat klik pertama] [Social Bar auto]
[Native Banner] ← .ad-native-slot (static script, 1×)
[box-300] ← .ad-display-slot (1×, auto-refresh 90s)
[box-300 di card ke-8, ke-16, ke-24] ← .ad-inline-grid via createInlineAd() — SEMUA P1–P9 kecuali P5
[Sticky Top: lb-728 desktop / mb-320 mobile]
[Sticky Bottom: banner-468 desktop only]
```

**Watch modal:**
```
[lb-728 / mb-320 atas player]
[video player + tap zone → popunder]   ← overlay bar DIHAPUS
[box-300 bawah player]
[half-160 bawah judul — mobile only]
[Download button → triggerDirectlink (cooldown 5s) + 800ms delay → download]
[Share button → navigator.share / clipboard]
[related videos grid]
```

### P5 — tp.html (TikTok feed, tanpa modal)
```
[mb-320 fixed bawah topbar] ← #tpDisplayTop, data-ad-zone="mb-320", dikelola ads.js
[TikTok feed — tap video → popunder]
[#tpAdBar overlay bar — 5s delay, reshow 120s → popunder]
[#tpNativeAd fixed bottom — native banner static script]
[Sticky Top: lb-728 desktop / mb-320 mobile]
[Sticky Bottom: banner-468 desktop only]
[Social Bar auto]
```
> ⚠️ mb-320 muncul 2× di tp.html (tp-display-top + vd-sticky-top-mb) — keduanya pakai zone key sama tapi **tidak konflik** karena vd-sticky-top-mb di-hide via CSS saat mobile (`display:none` ketika .vd-sticky-top-mb aktif), dan tp-display-top pakai posisi berbeda (fixed top, bukan sticky top bar).

### Status per platform

| Platform | Social Bar | Native | Popunder | Sticky Top | Sticky Bottom | Modal Ads | Video Overlay | Download Btn | createInlineAd |
|----------|-----------|--------|----------|------------|---------------|-----------|---------------|--------------|----------------|
| index (P1) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ dihapus | ✅ MP4 fungsional | ✅ pos 8+16+24 |
| rb (P2)    | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ dihapus | ⚠️ HLS — disabled+toast | ✅ pos 8+16+24 |
| yb (P3)    | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ dihapus | ⚠️ HLS — disabled+toast | ✅ pos 8+16+24 |
| bk (P4)    | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ dihapus | ✅ MP4 fungsional | ✅ pos 8+16+24 |
| tp (P5)    | ✅ | ✅ | ✅ | ✅ | ✅ | — | — (initTpFeed) | — (TikTok, tidak ada modal) | — |
| sb (P6)    | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ dihapus | ⚠️ HLS — disabled+toast | ✅ pos 8+16+24 |
| vd (P7)    | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ dihapus | ✅ MP4 fungsional | ✅ pos 8+16+24 |
| xn (P8)    | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ dihapus | ⚠️ HLS — disabled+toast | ✅ pos 8+16+24 |
| zg (P9)    | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ dihapus | ✅ MP4 fungsional | ✅ pos 8+16+24 |

---

## Pola JS init (platform baru)

```js
// Di openModal() / openPlayer():
if (window.VdryAds) VdryAds.triggerPopunder();
if (window.VdryAds) VdryAds.reloadModalAds(els.modal);

// Di DOMContentLoaded (sekali saja):
// initVideoOverlay tidak dipakai lagi — no-op, jangan tambahkan untuk platform baru
if (window.VdryAds) VdryAds.initVideoTap('PREFIX');

// Khusus tp.html:
if (window.VdryAds) VdryAds.initTpFeed();
```

## Download button (MP4 platform)

Platform yang deliver MP4 langsung (P1, P4/BK, P7/VD, P9/ZG) wajib punya download button:

```js
// State:
let currentDownloadUrl = null;

// Set saat video resolve:
currentDownloadUrl = `${API}${data.mp4Url}`;  // atau URL proxy stream
if (els.dlBtn) els.dlBtn.disabled = false;

// Handler (triggerDirectlink TERPISAH dari popunder cooldown):
if (els.dlBtn) {
  els.dlBtn.disabled = true;
  els.dlBtn.addEventListener('click', () => {
    if (!currentDownloadUrl) return;
    if (window.VdryAds) VdryAds.triggerDirectlink();  // buka smartlink dulu
    const url   = currentDownloadUrl;
    const title = (els.videoTitle.textContent || 'video').replace(/[/\\?%*:|"<>]/g, '-');
    setTimeout(() => {                                 // 800ms delay lalu download
      const a = document.createElement('a');
      a.href = url; a.download = title + '.mp4'; a.target = '_blank';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }, 800);
  });
}
```

Platform HLS (P2/RB, P3/YB, P6/SB, P8/XN): button ada tapi `disabled` di HTML + click handler showToast saja.

Semua wrapped `if (window.VdryAds)` — graceful degradation jika ads.js gagal load.

---

## CSS yang wajib ada (style.css)

```css
.video-stage { position: relative; }
.video-ad-overlay { display: none !important; }  /* dihapus — force hide */
.video-tap-zone { position: absolute; top: 0; bottom: 64px; z-index: 25; }
.tp-ad-bar { position: fixed; bottom: 0; z-index: 200; }
.watch-ad-slot:empty { display: none; }
.vd-sticky-top  { position: fixed; top: var(--topbar-h); z-index: 98; }
.vd-sticky-bottom { position: fixed; bottom: 0; z-index: 150; }
.modal-fullpage .modal-body { padding-bottom: var(--sticky-bottom-h); }

/* Download + Share button */
.watch-share-btn, .watch-dl-btn { /* pill button — shared style */ }
.watch-dl-btn:disabled { opacity: .38; cursor: not-allowed; }
.watch-share-btn svg, .watch-dl-btn svg { width: 15px; height: 15px; } /* explicit size wajib — CSS alone tidak reliable di mobile Chrome */
```

---

## Download Button — Status per Platform

| Platform | Format | Download |
|----------|--------|----------|
| P1 (index) | MP4 | ✅ triggerDirectlink + 800ms delay + anchor download |
| P2 (rb) | HLS m3u8 | ❌ disabled HTML + toast |
| P3 (yb) | HLS m3u8 | ❌ disabled HTML + toast |
| P4 (bk) | MP4 | ✅ triggerDirectlink + 800ms delay + anchor download |
| P5 (tp) | HLS | — tidak ada download button (TikTok feed) |
| P6 (sb) | HLS m3u8 | ❌ disabled HTML + toast |
| P7 (vd) | MP4 | ✅ triggerDirectlink + 800ms delay + anchor download |
| P8 (xn) | HLS m3u8 | ❌ disabled HTML + toast |
| P9 (zg) | MP4 | ✅ triggerDirectlink + 800ms delay + anchor download |

HTML button (MP4): `<button id="pNDlBtn" class="watch-dl-btn">`
HTML button (HLS): `<button id="pNDlBtn" class="watch-dl-btn" disabled title="Download tidak tersedia...">`
SVG wajib punya `width="15" height="15"` — **wajib di attribute, TIDAK cukup CSS saja di mobile Chrome**.

---

## Bug history

- **Video overlay selalu blank (garis doang)** — semua 10 Adsterra zone sudah dipakai di posisi lain; zone 300×250 yang di-inject ke overlay adalah duplikat dari `createInlineAd()`. Ad network tidak render zone yang sama 2×. Fix: hapus overlay sepenuhnya (`initVideoOverlay` = no-op, CSS `display:none !important`).
- **triggerDirectlink tidak fire saat klik Download** — `triggerDirectlink()` share `_lastPop` dengan `triggerPopunder()` (cooldown 30 detik). Saat modal buka → popunder set `_lastPop` → klik Download dalam 30 detik → directlink blocked. Fix: pisah variabel `_lastDirectlink` + `DL_COOLDOWN_MS = 5000`.
- **Download button — download langsung tanpa iklan dulu** — `a.click()` dipanggil langsung setelah `triggerDirectlink()` (yang buka tab baru). Fix: tambah `setTimeout 800ms` sebelum `a.click()` agar tab iklan keburu terbuka.

- **Sticky bottom selalu blank** — top dan bottom pakai zone `lb-728` yang sama. Fix: bottom pakai `banner-468`.
- **vd.html + zg.html Social Bar zone salah** (`ba0fd8e8...` dari website lain). Fix: ganti ke `96e9ff95...`.
- **`:empty` tidak bekerja setelah script inject** — CSS `:empty` tidak match setelah `<script>` ditambah ke container. Fix: JS hide-if-no-iframe 6s di `injectAd()`.
- **Zone key duplikat di listing + modal** (box-300, lb-728, mb-320, banner-468 muncul 2×) — CPM turun. Fix (Juli 2026): hapus semua duplikat, 1 zone key per posisi per halaman.
- **tp.html hardcoded inline atOptions** untuk fixed top banner — bypass refresh cycle ads.js. Fix: konversi ke `data-ad-zone="mb-320"`, tambah `.tp-display-top` ke LISTING_SELECTORS.
- **Orphaned CSS** `.tp-footer-banner-wrap` masih ada di style.css setelah HTML-nya dihapus. Fix: hapus dari style.css.
