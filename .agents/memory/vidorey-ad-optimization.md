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

| Key | Dimensi | CDN | Adsterra Zone ID |
|-----|---------|-----|-----------------|
| `lb-728`   | 728×90  | turbulentrefreshments.com | 30167643 |
| `mb-320`   | 320×50  | highperformanceformat.com | 30167471 |
| `box-300`  | 300×250 | highperformanceformat.com | 30152679 |
| `sky-160`  | 160×600 | turbulentrefreshments.com | 30167387 |
| `half-160` | 160×300 | turbulentrefreshments.com | 30167180 |
| `banner-468` | 468×60 | turbulentrefreshments.com | 28322765 |

### URL khusus (bukan iframe zone)

| Nama | URL | Zone ID |
|------|-----|---------|
| `POP_URL` | `turbulentrefreshments.com/khj65tru?key=188aaea14e197cc95790b8dca5bbbdfd` | 28318041 (Popunder) |
| `SMARTLINK_URL` | `turbulentrefreshments.com/z6ec2ixj7?key=bafa7c785c7d84482705d8749d9b28de` | 28322880 (Smartlink) |

### Script static di semua HTML (bukan via ZONES)

| Format | Script hash | Adsterra Zone ID | CDN |
|--------|-------------|-----------------|-----|
| Native Banner | `761a1a8645cd2263043bfeb6f2e87eea` | 28322731 | pl28423230.effectivecpmnetwork.com |
| Social Bar | `96e9ff95727320b49c1ea1aa80add9b6` | 28327358 | pl28427857.effectivecpmnetwork.com |
| (format lain) | `e223516a3660ad6a4214cb47e436c599` | — | pl28418540.effectivecpmnetwork.com |

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
- Jika iframe tidak muncul setelah 4 detik → container disembunyikan (mencegah kotak kosong)

**`injectAd(container, zoneName)`**
- Low-level: bersihkan container, buat `atOptions` script + invoke script baru dengan cache-buster
- **Hide-if-unfilled**: setTimeout 4s → jika tidak ada `<iframe>` → `container.style.display='none'`
- MutationObserver membatalkan hide jika iframe muncul sebelum 4s
- Saat re-inject: `container.style.display=''` (restore dulu)

**`initVideoOverlay(prefix)`**
- Persistent overlay bar di video player — muncul 5s setelah play, countdown 5s, muncul lagi tiap 120s
- **Ketuk bar → buka `SMARTLINK_URL` di tab baru** (bukan triggerPopunder — karena Adsterra tidak re-render zone duplikat)
- Elemen yang dibutuhkan: `#PREFIXVideoAdOverlay`, `#PREFIXVideoAdClose`, `#PREFIXVideoAdTimer`, `#PREFIXVideoAdContent`

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

## Status per platform (audit Juli 2026)

| Platform | ads.js | data-ad-zone slots | Social Bar | Native Banner | reloadModalAds | initVideoOverlay | initVideoTap |
|----------|--------|--------------------|------------|---------------|----------------|------------------|--------------|
| index (P1) | ✅ | 12 | ✅ | ✅ | ✅ app.js | ✅ | ✅ |
| rb.html (P2) | ✅ | 12 | ✅ | ✅ | ✅ rb.js | ✅ | ✅ |
| yb.html (P3) | ✅ | 12 | ✅ | ✅ | ✅ yb.js | ✅ | ✅ |
| bk.html (P4) | ✅ | 12 | ✅ | ✅ | ✅ bk.js | ✅ | ✅ |
| tp.html (P5) | ✅ | 2 (footer only) | ✅ | ✅ | — no modal | — (initTpFeed) | — (initTpFeed) |
| sb.html (P6) | ✅ | 12 | ✅ | ✅ | ✅ sb.js | ✅ | ✅ |
| vd.html (P7) | ✅ | 12 | ✅ | ✅ | ✅ vd.js | ✅ | ✅ |
| xn.html (P8) | ✅ | 12 | ✅ | ✅ | ✅ xn.js | ✅ | ✅ |
| zg.html (P9) | ✅ | 12 | ✅ | ✅ | ✅ zg.js | ✅ | ✅ |

tp.html: 2 zone slot = footer (lb-728 + mb-320). Banner lain inline static (normal untuk format tanpa modal).

---

## Layer iklan aktif dan revenue flow

| Layer | Trigger | Zone | CPM Est. |
|-------|---------|------|----------|
| Popunder | Klik thumbnail (openModal) | 28318041 | $1–5 adult |
| Smartlink | Ketuk overlay bar video | 28322880 | $0.5–2 |
| Social Bar | Auto per pageview | 28327358 | Stabil rendah |
| Native Banner | Auto per pageview | 28322731 | Medium |
| Banner modal (6-7 slot × auto-refresh 60s) | Modal buka | 30152679 dll | $0.3–1 |
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
- **`:empty` tidak bekerja setelah script inject** — CSS `:empty` tidak match setelah `<script>` ditambah ke container. Fix: JS hide-if-no-iframe setelah 4s di `injectAd()`.
- **tp.html footer banner zone salah** — `.tp-footer-lb` dan `.tp-footer-mobile` awalnya pakai key box-300 (300×250). Fix: ganti ke `lb-728` dan `mb-320`.
- **index.html modal kurang 1 slot** — `watch-info-ad-slot` (half-160) hilang. Fix: tambah setelah `.watch-title-row`.
