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
   * Auto-refresh setiap 60 detik selama modal tetap terbuka
   * untuk menambah jumlah impresi banner.
   */
  var _modalRefreshMap = [];   // [{modalEl, tid}] — satu entry per modal

  function reloadModalAds(modalEl) {
    if (!modalEl) return;

    // Batalkan interval lama untuk modal yang sama (jika ada)
    _modalRefreshMap = _modalRefreshMap.filter(function (item) {
      if (item.modalEl === modalEl) { clearInterval(item.tid); return false; }
      return true;
    });

    var slots = Array.prototype.slice.call(modalEl.querySelectorAll('[data-ad-zone]'));

    function doInject() {
      if (modalEl.classList.contains('hidden')) return; // modal sudah ditutup
      slots.forEach(function (slot, i) {
        var zone = slot.getAttribute('data-ad-zone');
        setTimeout(function () { injectAd(slot, zone); }, i * 250);
      });
    }

    doInject(); // inject langsung saat modal dibuka

    // Auto-refresh setiap 60 detik
    var tid = setInterval(doInject, 60000);
    _modalRefreshMap.push({ modalEl: modalEl, tid: tid });
  }

  // ── Popunder / Tab-under ─────────────────────────────────────────────
  var POP_URL         = 'https://turbulentrefreshments.com/khj65tru?key=188aaea14e197cc95790b8dca5bbbdfd';
  var POP_COOLDOWN_MS = 30000;  // maks 1x per 30 detik agar tidak diblokir browser
  var _lastPop        = 0;

  /**
   * Buka popunder di tab baru di belakang tab saat ini.
   * Dipanggil dari openModal() tiap platform — butuh user-gesture (klik)
   * agar window.open tidak diblokir browser.
   * Rate-limited: lewati jika sudah muncul dalam 30 detik terakhir.
   */
  function triggerPopunder() {
    var now = Date.now();
    if (now - _lastPop < POP_COOLDOWN_MS) return;
    _lastPop = now;
    try {
      var w = window.open(POP_URL, '_blank', 'noopener,noreferrer');
      if (w) { w.blur(); window.focus(); }
    } catch (e) {}
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

    /* Handler klik overlay — buka popunder saat user ketuk area iklan */
    function onOverlayClick(e) {
      if (closeBtn && (e.target === closeBtn || closeBtn.contains(e.target))) return;
      triggerPopunder();
    }

    function showOverlay() {
      clearTimeout(reshowTimer);

      /* Sembunyikan area konten banner (tidak pakai iframe — zone duplikat
         di halaman sama tidak dirender ulang oleh Adsterra). Overlay sendiri
         yang menjadi unit iklan: ketuk = buka popunder. */
      if (contentEl) contentEl.style.display = 'none';

      /* Teks label — terlihat seperti notifikasi sponsor */
      var labelEl = overlay.querySelector('.video-ad-label');
      if (labelEl) labelEl.textContent = '🎁 Penawaran Eksklusif — Ketuk untuk melihat';

      overlay.style.display = 'block';
      overlay.style.cursor  = 'pointer';
      overlay.setAttribute('aria-hidden', 'false');
      overlay.addEventListener('click', onOverlayClick);

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
      overlay.style.cursor  = '';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.removeEventListener('click', onOverlayClick);
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

  // ── Video Tap Zone ───────────────────────────────────────────────────
  /**
   * Pasang transparent div di atas area video.
   * Tiap tap: buka popunder + toggle play/pause pada <video> (jika aktif).
   * Untuk platform rb/yb (iframe mode): tap tetap buka popunder;
   * pointer-events dimatikan 200ms agar kontrol iframe bisa diakses.
   * prefix: 'rb', 'p1', dll. — elemen #PREFIXVideoTapZone harus ada di HTML.
   */
  function initVideoTap(prefix) {
    var tapZone = document.getElementById(prefix + 'VideoTapZone');
    var videoEl = document.getElementById(prefix + 'VideoEl');
    if (!tapZone) return;

    tapZone.addEventListener('click', function () {
      triggerPopunder();

      var iframeMode = videoEl && videoEl.classList.contains('hidden');
      if (iframeMode) {
        /* Iframe aktif — matikan pointer-events sebentar agar tap berikutnya
           bisa menjangkau kontrol di dalam iframe */
        tapZone.style.pointerEvents = 'none';
        setTimeout(function () { tapZone.style.pointerEvents = ''; }, 250);
      } else if (videoEl) {
        try {
          if (videoEl.paused) videoEl.play();
          else videoEl.pause();
        } catch (e) {}
      }
    });
  }

  // ── TikTok Feed (tp.html) ────────────────────────────────────────────
  /**
   * Panggil sekali saat tp.html load.
   * 1. Tap delegation di #tpFeed → triggerPopunder() saat user ketuk video.
   * 2. Fixed overlay bar di bawah layar — muncul setelah 5 detik, ulang tiap 120 detik.
   *    Ketuk bar → popunder. Tombol ✕ → sembunyikan + jadwal ulang.
   */
  function initTpFeed() {
    var feed = document.getElementById('tpFeed');
    if (!feed) return;

    /* — Tap delegation: klik area video slide → popunder — */
    feed.addEventListener('click', function (e) {
      var slide = e.target.closest ? e.target.closest('.tp-slide') : null;
      if (!slide) return;
      if (slide.classList.contains('tp-slide-ad') ||
          slide.classList.contains('tp-slide-end')) return;
      triggerPopunder();
    });

    /* — Fixed overlay bar — */
    var bar = document.createElement('div');
    bar.id        = 'tpAdBar';
    bar.className = 'tp-ad-bar';
    bar.setAttribute('role', 'button');
    bar.innerHTML =
      '<span class="tp-ad-bar-label">🎁 <strong>Penawaran Eksklusif</strong> — Ketuk untuk melihat</span>' +
      '<button class="tp-ad-bar-close" type="button" aria-label="Tutup">✕</button>';
    document.body.appendChild(bar);
    bar.style.display = 'none';

    var tpCloseBtn   = bar.querySelector('.tp-ad-bar-close');
    var tpReshowTimer = null;

    function hideTpBar() {
      bar.style.display = 'none';
      clearTimeout(tpReshowTimer);
      tpReshowTimer = setTimeout(showTpBar, RESHOW_SECS * 1000);
    }

    function showTpBar() {
      bar.style.display = 'flex';
    }

    bar.addEventListener('click', function (e) {
      if (tpCloseBtn && (e.target === tpCloseBtn || tpCloseBtn.contains(e.target))) {
        hideTpBar();
        return;
      }
      triggerPopunder();
    });

    setTimeout(showTpBar, SHOW_DELAY_MS);
  }

  window.VdryAds = {
    reloadModalAds:   reloadModalAds,
    initVideoOverlay: initVideoOverlay,
    initVideoTap:     initVideoTap,
    initTpFeed:       initTpFeed,
    triggerPopunder:  triggerPopunder,
    injectAd:         injectAd,
    ZONES:            ZONES,
  };

})();
