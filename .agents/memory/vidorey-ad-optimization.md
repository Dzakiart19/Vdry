---
name: Vidorey Ad Optimization
description: Semua layer iklan aktif di Vidorey — arsitektur ads.js, cara kerja tiap layer, dan status per platform.
---

# Vidorey Ad Optimization

## Root cause awal: Modal ads loaded while display:none
`.modal.hidden { display: none; }` → semua inline `<script>` di dalam modal run saat page load ketika container `display:none`. Adsterra membuat iframe 0×0, viewability 0%, kesan tidak dihitung.

**Fix:** Hapus semua inline `<script>atOptions...</script>` dari modal HTML, ganti dengan `data-ad-zone="ZONE"` attribute. Inject ulang secara dinamis saat modal terbuka via `VdryAds.reloadModalAds(modalEl)`.

---

## ads.js — shared utility (public/ads.js)

Semua fungsi ad management terpusat di sini. Wajib di-load di setiap platform HTML **sebelum** platform JS.

### Zone registry
```
'lb-728'   → 728×90  turbulentrefreshments.com
'mb-320'   → 320×50  highperformanceformat.com
'box-300'  → 300×250 highperformanceformat.com
'sky-160'  → 160×600 turbulentrefreshments.com
'half-160' → 160×300 turbulentrefreshments.com
```

### VdryAds API

**`reloadModalAds(modalEl)`**
- Panggil tepat setelah `modal.classList.remove('hidden')`
- Find semua `[data-ad-zone]` di dalam modal, inject fresh scripts dengan cache-buster `?_t=Date.now()`, stagger 250ms per slot
- **Auto-refresh setiap 60 detik** selama modal visible (cek `classList.contains('hidden')` tiap interval)
- Interval dibatalkan dan di-reset saat `reloadModalAds` dipanggil ulang (modal ditutup + dibuka lagi)
- Alasan 60 detik: minimum aman industri; lebih cepat = invalid traffic; lebih lambat = kehilangan impresi sesi panjang

**`initVideoOverlay(prefix)`**
- Panggil sekali saat init platform (setelah loadPosts, sebelum scheduleRefresh)
- Persistent overlay bar di video player — muncul 5s setelah play, countdown 5s sebelum dismiss aktif, muncul lagi tiap 120s
- Ketuk bar → `triggerPopunder()` (bukan iframe, karena Adsterra tidak re-render zone duplikat)
- Elemen yang dibutuhkan di HTML: `#PREFIXVideoAdOverlay`, `#PREFIXVideoAdClose`, `#PREFIXVideoAdTimer`, `#PREFIXVideoAdContent`

**`initVideoTap(prefix)`**
- Transparent div `#PREFIXVideoTapZone` menutup area video (top 0, bottom 64px — sisakan native controls)
- Tap → `triggerPopunder()` + toggle play/pause `<video>`
- Untuk iframe-mode platforms (rb/yb): `pointer-events:none` 250ms agar tap berikutnya capai iframe controls
- Elemen: `#PREFIXVideoTapZone` (position:absolute di dalam .video-stage)

**`initTpFeed()`**
- Khusus tp.html (TikTok fullscreen scroll — tidak punya modal)
- Tap delegation di `#tpFeed`: klik `.tp-slide` (bukan `.tp-slide-ad` / `.tp-slide-end`) → `triggerPopunder()`
- Fixed overlay bar `#tpAdBar` (position:fixed, bukan absolute) — muncul 5s setelah load, ulang tiap 120s, tombol ✕ untuk sembunyikan sementara

**`triggerPopunder()`**
- `window.open(POP_URL, '_blank')` + `w.blur(); window.focus()` untuk efek tab-under
- Rate-limit: 1× per 30 detik global (satu counter shared semua platform)
- POP_URL: `https://turbulentrefreshments.com/khj65tru?key=188aaea14e197cc95790b8dca5bbbdfd`

**`injectAd(container, zoneName)`**
- Low-level: bersihkan container, buat `atOptions` script + invoke script baru

---

## Status per platform (audit Juli 2026)

| Platform | ads.js | data-ad-zone slots | reloadModalAds | initVideoOverlay | initVideoTap | triggerPopunder di openModal |
|----------|--------|--------------------|----------------|------------------|--------------|------------------------------|
| index (P1) | ✅ | 6 | ✅ app.js | ✅ | ✅ | ✅ |
| rb.html (P2) | ✅ | 7 | ✅ rb.js | ✅ | ✅ | ✅ |
| yb.html (P3) | ✅ | 7 | ✅ yb.js | ✅ | ✅ | ✅ |
| bk.html (P4) | ✅ | 7 | ✅ bk.js | ✅ | ✅ | ✅ |
| tp.html (P5) | ✅ | 0 (inline) | — no modal | — (initTpFeed) | — (initTpFeed) | — (tap delegation) |
| sb.html (P6) | ✅ | 7 | ✅ sb.js | ✅ | ✅ | ✅ |
| vd.html (P7) | ✅ | 7 | ✅ vd.js | ✅ | ✅ | ✅ |
| xn.html (P8) | ✅ | 7 | ✅ xn.js | ✅ | ✅ | ✅ |
| zg.html (P9) | ✅ | 7 | ✅ zg.js | ✅ | ✅ | ✅ |

tp.html tidak punya modal — banner ads-nya inline Adsterra scripts yang load saat page load (bukan data-ad-zone), sudah benar.

---

## Layer iklan aktif dan ranking CPM

1. **Popunder** — CPM $1–5 adult traffic, terpicu per klik thumbnail (30s cooldown). Penghasil utama.
2. **In-Page Push** — sudah aktif via Social Bar / existing Adsterra scripts, tidak perlu zone terpisah. Muncul otomatis tiap pageview.
3. **Banner modal (auto-refresh 60s)** — 1 sesi 5 menit = ~5 impresi per slot × 6–7 slot per platform.
4. **Social Bar** — berjalan terus semua halaman, CPM lebih kecil tapi stabil.
5. **Overlay bar + tap zone** — tidak unit iklan langsung, tugasnya generate popunder tambahan.

---

## CSS yang wajib ada (style.css)

```css
.video-stage { position: relative; }   /* wajib agar overlay absolute bekerja */
.video-ad-overlay { position: absolute; bottom: 52px; ... }
.video-tap-zone { position: absolute; top: 0; bottom: 64px; z-index: 25; }
.tp-ad-bar { position: fixed; bottom: 0; z-index: 200; }   /* khusus tp */
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

**Why:** Semua wrapped dalam `if (window.VdryAds)` — graceful degradation jika ads.js gagal load (adblock, network error). Tidak throw error ke platform JS.
