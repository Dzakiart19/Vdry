---
name: Download Button + Directlink Fix
description: Arsitektur download button per platform, fix cooldown triggerDirectlink terpisah dari popunder, dan penghapusan video overlay.
---

# Download Button + Directlink Fix

## Download Button — Status per Platform

| Platform | Format | Status |
|----------|--------|--------|
| P1 (index/app.js) | MP4 | ✅ Fungsional |
| P2 (rb) | HLS | ❌ `disabled` di HTML + toast handler |
| P3 (yb) | HLS | ❌ `disabled` di HTML + toast handler |
| P4 (bk) | MP4 | ✅ Fungsional |
| P5 (tp) | HLS | — Tidak ada (TikTok feed) |
| P6 (sb) | HLS | ❌ `disabled` di HTML + toast handler |
| P7 (vd) | MP4 | ✅ Fungsional |
| P8 (xn) | HLS | ❌ `disabled` di HTML + toast handler |
| P9 (zg) | MP4 | ✅ Fungsional |

## Pola Download Handler (MP4 platform)

```js
let currentDownloadUrl = null;

// Set saat video resolve:
currentDownloadUrl = `${API}${data.mp4Url}`;
if (els.dlBtn) els.dlBtn.disabled = false;

// Reset saat modal tutup:
currentDownloadUrl = null;
if (els.dlBtn) els.dlBtn.disabled = true;

// Click handler:
if (els.dlBtn) {
  els.dlBtn.disabled = true;
  els.dlBtn.addEventListener('click', () => {
    if (!currentDownloadUrl) return;
    if (window.VdryAds) VdryAds.triggerDirectlink(); // buka iklan dulu
    const url   = currentDownloadUrl;
    const title = (els.videoTitle.textContent || 'video').replace(/[/\\?%*:|"<>]/g, '-');
    setTimeout(() => {                               // 800ms delay lalu download
      const a = document.createElement('a');
      a.href = url; a.download = title + '.mp4'; a.target = '_blank';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }, 800);
  });
}
```

## Pola Download Handler (HLS platform — disabled)

```js
// HTML: <button ... class="watch-dl-btn" disabled title="Download tidak tersedia...">
if (els.dlBtn) {
  els.dlBtn.addEventListener('click', () => {
    showToast('Download tidak tersedia untuk format stream ini');
  });
}
```

## Bug: triggerDirectlink tidak fire setelah popunder

**Root cause:** `triggerDirectlink()` dan `triggerPopunder()` share variable `_lastPop` (cooldown 30 detik). Saat modal dibuka → `triggerPopunder()` set `_lastPop` → klik Download dalam 30 detik → `triggerDirectlink()` kena rate-limit dan return early.

**Fix:** Pisah cooldown:
```js
var POP_COOLDOWN_MS  = 30000;
var _lastPop         = 0;
var DL_COOLDOWN_MS   = 5000;   // terpisah, lebih pendek
var _lastDirectlink  = 0;

function triggerDirectlink() {
  var now = Date.now();
  if (now - _lastDirectlink < DL_COOLDOWN_MS) return;
  _lastDirectlink = now;
  window.open(SMARTLINK_URL, '_blank', 'noopener,noreferrer');
}
```

## Video Overlay — Dihapus

**Why:** Semua zone sudah dipakai di posisi lain. Zone 300×250 yang di-inject ke overlay = duplikat `createInlineAd()` di grid. Ad network tidak render zone yang sama 2× → overlay selalu blank (cuma garis bar).

**Fix:**
- `initVideoOverlay(prefix)` → no-op (langsung `return`)
- CSS: `.video-ad-overlay { display: none !important }` — force hide meskipun browser cache JS lama

**Jangan restore overlay** kecuali ada zone baru yang belum dipakai di posisi manapun.

## SVG Width/Height — Wajib di Attribute

Semua SVG di download button dan share button wajib ada `width="15" height="15"` sebagai HTML attribute, bukan cuma CSS.

**Why:** Mobile Chrome kadang tidak override intrinsic size SVG via CSS — SVG tanpa attribute bisa render 300×300px default.

```html
<!-- Benar -->
<svg width="15" height="15" viewBox="0 0 24 24" ...>

<!-- Salah — CSS saja tidak cukup di mobile -->
<svg viewBox="0 0 24 24" ...>
```
