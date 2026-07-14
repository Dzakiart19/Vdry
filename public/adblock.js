'use strict';
/* ── Vidorey — Ad-blocker detection ─────────────────────────────
   Deteksi ad-blocker via bait element (class/id yang lazim masuk
   filter list EasyList/EasyPrivacy) + fallback cek gagal load
   invoke.js Adsterra. Kalau terdeteksi, tampilkan banner non-blocking
   yang minta user whitelist situs (revenue iklan = satu-satunya
   sumber pendapatan Vidorey).

   Ditampilkan maksimal 1x per 24 jam (localStorage) supaya tidak
   mengganggu pengguna yang berulang kali berkunjung.
─────────────────────────────────────────────────────────────── */
(function () {
  var STORAGE_KEY = 'vdry_adb_dismiss_until';

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
    });
  }

  function detect() {
    if (alreadyDismissedRecently()) return;

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

      if (blocked) showBanner();
    }, 300);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', detect);
  } else {
    detect();
  }
})();
