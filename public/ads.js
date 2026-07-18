'use strict';
/* ── Vidorey Ads Manager ───────────────────────────────────────────────
   Dua masalah utama pendapatan rendah yang di-fix di sini:

   1. MODAL ADS — script iklan di modal dimuat saat div TERSEMBUNYI
      (display:none). Ini menyebabkan iklan tidak punya dimensi saat
      dibuat, viewability 0%, dan kesan tidak dihitung oleh Adsterra.
      Fix: inject ulang script secara dinamis saat modal BARU terbuka.

   2. VIDEO OVERLAY — tidak ada iklan yang muncul di layar video.
      Fix: banner permanen muncul di pojok bawah player saat video
      mulai diputar. Bisa ditutup setelah 5 detik, muncul lagi tiap
      2 menit selama video masih berjalan.
────────────────────────────────────────────────────────────────────── */
(function () {

  // ── Zone registry (key + dimensi + URL invoke) ─────────────────────
  var ZONES = {
    'lb-728':   {
      key: 'ad23cecb6cc7205a344717b0998c822d', w: 728, h: 90,
      src: 'https://turbulentrefreshments.com/ad23cecb6cc7205a344717b0998c822d/invoke.js'
    },
    'mb-320':   {
      key: 'd37e31d713d11b2ddde7d3efca199c9d', w: 320, h: 50,
      src: 'https://www.highperformanceformat.com/d37e31d713d11b2ddde7d3efca199c9d/invoke.js'
    },
    'box-300':  {
      key: 'd50b941ac6d9bd5749dcdb0b417bf348', w: 300, h: 250,
      src: 'https://www.highperformanceformat.com/d50b941ac6d9bd5749dcdb0b417bf348/invoke.js'
    },
    'sky-160':  {
      key: 'e0fc9f770eacb77e8afcfde28d8a06a8', w: 160, h: 600,
      src: 'https://turbulentrefreshments.com/e0fc9f770eacb77e8afcfde28d8a06a8/invoke.js'
    },
    'half-160': {
      key: 'd7a21e9839cad22a65ed9e21e6a33272', w: 160, h: 300,
      src: 'https://turbulentrefreshments.com/d7a21e9839cad22a65ed9e21e6a33272/invoke.js'
    },
  };

  /**
   * Inject iklan segar ke dalam container.
   * Bersihkan dulu isi lama, lalu buat script atOptions + invoke baru
   * dengan cache-buster sehingga browser benar-benar me-request ulang.
   */
  function injectAd(container, zoneName) {
    var z = ZONES[zoneName];
    if (!z || !container) return;
    container.innerHTML = '';
    var optEl = document.createElement('script');
    optEl.text = 'window.atOptions={"key":"' + z.key +
      '","format":"iframe","height":' + z.h +
      ',"width":' + z.w + ',"params":{}};';
    container.appendChild(optEl);
    var invEl = document.createElement('script');
    invEl.src = z.src + '?_t=' + Date.now();
    container.appendChild(invEl);
  }

  /**
   * Panggil tepat setelah modal.classList.remove('hidden').
   * Menemukan semua [data-ad-zone] di dalam modal dan meng-inject
   * script Adsterra segar dengan stagger kecil supaya tidak flood.
   */
  function reloadModalAds(modalEl) {
    if (!modalEl) return;
    var slots = Array.prototype.slice.call(modalEl.querySelectorAll('[data-ad-zone]'));
    slots.forEach(function (slot, i) {
      var zone = slot.getAttribute('data-ad-zone');
      setTimeout(function () { injectAd(slot, zone); }, i * 250);
    });
  }

  // ── Video Overlay ────────────────────────────────────────────────────
  var SHOW_DELAY_MS  = 5000;   // tunggu N ms setelah play sebelum muncul
  var SKIP_SECS      = 5;      // detik countdown sebelum tombol aktif
  var RESHOW_SECS    = 120;    // muncul kembali tiap N detik

  /**
   * Panggil sekali saat halaman load per platform.
   * prefix: 'rb', 'yb', 'p1', dll.
   * Elemen yang dibutuhkan di HTML:
   *   #PREFIXVideoEl         — <video>
   *   #PREFIXVideoAdOverlay  — container overlay
   *   #PREFIXVideoAdClose    — tombol tutup
   *   #PREFIXVideoAdTimer    — <span> hitungan mundur
   *   #PREFIXVideoAdContent  — slot iklan (akan di-inject ke sini)
   */
  function initVideoOverlay(prefix) {
    var videoEl   = document.getElementById(prefix + 'VideoEl');
    var overlay   = document.getElementById(prefix + 'VideoAdOverlay');
    var closeBtn  = document.getElementById(prefix + 'VideoAdClose');
    var timerEl   = document.getElementById(prefix + 'VideoAdTimer');
    var contentEl = document.getElementById(prefix + 'VideoAdContent');
    if (!videoEl || !overlay) return;

    var showTimer   = null;
    var reshowTimer = null;
    var countdown   = null;

    function showOverlay() {
      clearTimeout(reshowTimer);
      var zone = window.innerWidth < 600 ? 'mb-320' : 'box-300';
      if (contentEl) injectAd(contentEl, zone);
      overlay.style.display = 'block';
      overlay.setAttribute('aria-hidden', 'false');

      var secs = SKIP_SECS;
      if (timerEl) timerEl.textContent = secs;
      if (closeBtn) { closeBtn.disabled = true; }
      clearInterval(countdown);
      countdown = setInterval(function () {
        secs--;
        if (timerEl) timerEl.textContent = Math.max(0, secs);
        if (secs <= 0) {
          clearInterval(countdown);
          if (closeBtn) { closeBtn.disabled = false; }
        }
      }, 1000);
    }

    function hideOverlay() {
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
      clearInterval(countdown);
      clearTimeout(reshowTimer);
      reshowTimer = setTimeout(function () {
        if (!videoEl.paused && !videoEl.ended) showOverlay();
      }, RESHOW_SECS * 1000);
    }

    if (closeBtn) closeBtn.addEventListener('click', hideOverlay);

    videoEl.addEventListener('play', function () {
      clearTimeout(showTimer);
      if (overlay.style.display === 'block') return;
      showTimer = setTimeout(function () {
        if (!videoEl.paused && !videoEl.ended) showOverlay();
      }, SHOW_DELAY_MS);
    });

    videoEl.addEventListener('pause', function () {
      clearTimeout(showTimer);
    });

    videoEl.addEventListener('ended', function () {
      clearTimeout(showTimer);
      clearTimeout(reshowTimer);
      clearInterval(countdown);
      overlay.style.display = 'none';
    });
  }

  window.VdryAds = {
    reloadModalAds:   reloadModalAds,
    initVideoOverlay: initVideoOverlay,
    injectAd:         injectAd,
    ZONES:            ZONES,
  };

})();
