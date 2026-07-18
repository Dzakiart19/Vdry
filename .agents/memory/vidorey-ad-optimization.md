---
name: Vidorey Ad Optimization
description: Penyebab pendapatan rendah dan fix yang diterapkan — modal ads tidak render + video overlay baru.
---

# Vidorey Ad Optimization

## Root cause: Modal ads loaded while display:none
`.modal.hidden { display: none; }` → semua inline `<script>` di dalam modal run saat page load ketika container `display:none`. Adsterra membuat iframe 0×0, viewability 0%, kesan tidak dihitung → revenue ~0 dari modal ads.

**Fix:** Hapus semua inline `<script>atOptions...</script>` dari modal HTML, ganti dengan `data-ad-zone="ZONE"` attribute. Inject ulang secara dinamis saat modal terbuka via `VdryAds.reloadModalAds(modalEl)`.

## ads.js — shared utility (public/ads.js)
- `VdryAds.reloadModalAds(modalEl)` — find all `[data-ad-zone]` inside modal, inject fresh scripts with cache-buster `?_t=Date.now()`. Stagger 250ms per slot.
- `VdryAds.initVideoOverlay(prefix)` — persistent banner overlay di pojok bawah video player. Muncul 5s setelah `play`, hitung mundur 5s sebelum dismiss aktif, muncul kembali tiap 120s.
- `VdryAds.injectAd(container, zoneName)` — low-level injector.
- Zone registry: `lb-728`, `mb-320`, `box-300`, `sky-160`, `half-160`.

## HTML changes (semua 8 modal-based platforms)
- Modal ad slots: `<div class="CLASS" data-ad-zone="ZONE"></div>` (no inline scripts)
- Video overlay div added inside `.video-stage`: `#PREFIXVideoAdOverlay`, `#PREFIXVideoAdClose`, `#PREFIXVideoAdTimer`, `#PREFIXVideoAdContent`
- `<script src="/ads.js"></script>` added before platform JS

## JS changes (semua 8 JS files + app.js)
- `openModal()`: call `VdryAds.reloadModalAds(els.modal)` immediately after `classList.remove('hidden')`
- Init section: call `VdryAds.initVideoOverlay('PREFIX')` after `loadPosts(false)` / before `scheduleRefresh()`

## CSS (style.css)
- `.video-stage { position: relative; }` — wajib agar overlay `position:absolute` bekerja
- `.video-ad-overlay` styles — bottom-right corner, mobile full-width bottom

## Pattern: JS init for different platforms
- rb/yb/bk: `loadPosts(false);\n\n  // Deep-link:` → insert initVideoOverlay after loadPosts
- sb/xn/vd/zg: `loadPosts(false);\n\n  if (deepLinkMatch)` → same, different comment
- p1 (app.js): uses `scheduleRefresh()` not loadPosts → insert before scheduleRefresh

**Why:** Modal ads inside display:none = 0 viewability = 0 CPM. Fixing this alone should significantly increase ad revenue even before video overlay.
