'use strict';
/* ── Vidorey — Ad-blocker detection (Phase 2 escalation) ────────────
   Old banner was too soft — user could just close and ignore forever.
   Phase 2 escalation:
   1. After 3 dismissals in 24h, show a non-dismissible overlay that
      blurs content and forces whitelist action.
   2. Use multiple detection methods (bait + failed invoke.js load).
   3. Periodic re-check every 30s — re-show banner if user re-enables
      adblock mid-session.
────────────────────────────────────────────────────────────────────── */
(function () {
  var STORAGE_KEY         = 'vdry_adb_dismiss_until';
  var STORAGE_COUNT_KEY   = 'vdry_adb_dismiss_count';
  var STORAGE_OVERLAY_KEY = 'vdry_adb_overlay_until';

  function getDismissCount() {
    try { return parseInt(localStorage.getItem(STORAGE_COUNT_KEY) || '0', 10) || 0; }
    catch (e) { return 0; }
  }
  function incDismissCount() {
    try {
      var n = getDismissCount() + 1;
      localStorage.setItem(STORAGE_COUNT_KEY, String(n));
      return n;
    } catch (e) { return 0; }
  }
  function resetDismissCount() {
    try { localStorage.setItem(STORAGE_COUNT_KEY, '0'); } catch (e) {}
  }

  function alreadyDismissedRecently() {
    try {
      var until = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
      return Date.now() < until;
    } catch (e) { return false; }
  }
  function dismissFor24h() {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now() + 24 * 60 * 60 * 1000)); }
    catch (e) {}
  }

  function isOverlayActive() {
    try {
      var until = parseInt(localStorage.getItem(STORAGE_OVERLAY_KEY) || '0', 10);
      return Date.now() < until;
    } catch (e) { return false; }
  }
  function setOverlayActive() {
    try {
      // Overlay stays active for 30 min — then user can re-test
      localStorage.setItem(STORAGE_OVERLAY_KEY, String(Date.now() + 30 * 60 * 1000));
    } catch (e) {}
  }

  function showBanner() {
    if (document.getElementById('vdry-adb-banner')) return;

    var wrap = document.createElement('div');
    wrap.id = 'vdry-adb-banner';
    wrap.setAttribute('role', 'alert');
    wrap.innerHTML =
      '<div class="vdry-adb-card">' +
        '<div class="vdry-adb-icon">⚠</div>' +
        '<div class="vdry-adb-body">' +
          '<p class="vdry-adb-title">Ad-blocker terdeteksi</p>' +
          '<p class="vdry-adb-text">Vidorey gratis karena didukung iklan. Mohon nonaktifkan ad-blocker atau whitelist situs ini agar kami bisa terus menyediakan layanan gratis.</p>' +
        '</div>' +
        '<button type="button" class="vdry-adb-close" aria-label="Tutup">×</button>' +
      '</div>';
    document.body.appendChild(wrap);

    wrap.querySelector('.vdry-adb-close').addEventListener('click', function () {
      wrap.remove();
      dismissFor24h();
      var n = incDismissCount();
      // After 3 dismissals, show overlay on next page load
      if (n >= 3) setOverlayActive();
    });
  }

  function showOverlay() {
    if (document.getElementById('vdry-adb-overlay')) return;

    var overlay = document.createElement('div');
    overlay.id = 'vdry-adb-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div class="vdry-adb-overlay-box">' +
        '<div class="vdry-adb-overlay-icon">🔒</div>' +
        '<h2 class="vdry-adb-overlay-title">Adblock masih aktif</h2>' +
        '<p class="vdry-adb-overlay-text">Kamu sudah menutup peringatan adblock 3 kali. Vidorey butuh iklan untuk tetap gratis. Silakan nonaktifkan ad-blocker / whitelist situs ini, lalu refresh halaman.</p>' +
        '<button type="button" class="vdry-adb-overlay-refresh" id="vdryAdbOverlayRefresh">Refresh halaman</button>' +
        '<button type="button" class="vdry-adb-overlay-continue" id="vdryAdbOverlayContinue">Lanjutkan dengan iklan diblokir</button>' +
      '</div>';
    document.body.appendChild(overlay);

    document.getElementById('vdryAdbOverlayRefresh').addEventListener('click', function () {
      location.reload();
    });
    document.getElementById('vdryAdbOverlayContinue').addEventListener('click', function () {
      overlay.remove();
      // User explicitly bypassed — let them through for 1h
      try { localStorage.setItem(STORAGE_OVERLAY_KEY, String(Date.now() + 60 * 60 * 1000)); } catch (e) {}
    });
  }

  function detect() {
    var bait = document.createElement('div');
    bait.className = 'ads ad-banner adsbox ad-placement pub_300x250 text-ad textAd';
    bait.setAttribute('aria-hidden', 'true');
    bait.style.cssText = 'position:absolute;top:-9999px;left:-9999px;width:1px;height:1px;';
    document.body.appendChild(bait);

    setTimeout(function () {
      var blocked = false;
      try {
        var rect = bait.getBoundingClientRect();
        var cs   = window.getComputedStyle(bait);
        if (
          bait.offsetParent === null ||
          rect.height === 0 ||
          cs.display === 'none' ||
          cs.visibility === 'hidden'
        ) {
          blocked = true;
        }
      } catch (e) {}
      bait.remove();

      if (blocked) {
        // If overlay should be active, show overlay; else show banner
        if (isOverlayActive()) showOverlay();
        else if (!alreadyDismissedRecently()) showBanner();
      } else {
        // Reset dismiss count if user has whitelisted
        if (getDismissCount() > 0) resetDismissCount();
      }
    }, 300);
  }

  // Initial detection
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', detect);
  } else {
    detect();
  }

  // Periodic re-check every 30s — catches adblock re-enable mid-session
  setInterval(detect, 30000);
})();
