'use strict';
/* ── Vidorey Ads Manager ───────────────────────────────────────────────
   Dua masalah utama pendapatan rendah yang di-fix di sini:

   1. MODAL ADS — script iklan di modal dimuat saat div TERSEMBUNYI
      (display:none). Ini menyebabkan iklan tidak punya dimensi saat
      dibuat, viewability 0%, dan kesan tidak dihitung oleh ad network.
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
      src: 'https://turbulentrefreshments.com/d37e31d713d11b2ddde7d3efca199c9d/invoke.js'
    },
    'box-300':  {
      key: 'd50b941ac6d9bd5749dcdb0b417bf348', w: 300, h: 250,
      src: 'https://turbulentrefreshments.com/d50b941ac6d9bd5749dcdb0b417bf348/invoke.js'
    },
    'sky-160':  {
      key: 'e0fc9f770eacb77e8afcfde28d8a06a8', w: 160, h: 600,
      src: 'https://turbulentrefreshments.com/e0fc9f770eacb77e8afcfde28d8a06a8/invoke.js'
    },
    'half-160': {
      key: 'd7a21e9839cad22a65ed9e21e6a33272', w: 160, h: 300,
      src: 'https://turbulentrefreshments.com/d7a21e9839cad22a65ed9e21e6a33272/invoke.js'
    },
    'banner-468': {
      key: 'f517b5d3c983922d55c67370c8bd95fc', w: 468, h: 60,
      src: 'https://turbulentrefreshments.com/f517b5d3c983922d55c67370c8bd95fc/invoke.js'
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
    container.style.display = '';   // restore kalau sebelumnya disembunyikan
    container.innerHTML = '';
    var optEl = document.createElement('script');
    optEl.text = 'window.atOptions={"key":"' + z.key +
      '","format":"iframe","height":' + z.h +
      ',"width":' + z.w + ',"params":{}};';
    container.appendChild(optEl);
    var invEl = document.createElement('script');
    invEl.src = z.src + '?_t=' + Date.now();
    container.appendChild(invEl);

    // Slot sticky/fixed jangan pernah disembunyikan
    // — mereka selalu terlihat di layar dan harus tetap ada walau belum terisi.
    var isSticky = container.classList.contains('vd-sticky-top-lb') ||
                   container.classList.contains('vd-sticky-top-mb') ||
                   container.classList.contains('vd-sticky-bottom-lb') ||
                   container.classList.contains('tp-display-top');
    if (isSticky) return;

    // Untuk slot non-sticky: sembunyikan jika tidak ada iframe setelah 6 detik.
    var hideCheck = setTimeout(function () {
      if (!container.querySelector('iframe')) {
        container.style.display = 'none';
      }
    }, 6000);

    // Batalkan hide jika iframe muncul sebelum 6 detik
    var obs = window.MutationObserver
      ? new MutationObserver(function () {
          if (container.querySelector('iframe')) {
            clearTimeout(hideCheck);
            obs.disconnect();
          }
        })
      : null;
    if (obs) obs.observe(container, { childList: true, subtree: true });
  }

  /**
   * Panggil tepat setelah modal.classList.remove('hidden').
   * Menemukan semua [data-ad-zone] di dalam modal dan meng-inject
   * script iklan segar dengan stagger kecil supaya tidak flood.
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

  // ── Listing Page Ads (banner di halaman grid, bukan modal) ───────────
  /**
   * Inject + auto-refresh semua banner iklan di halaman listing
   * (di luar modal watch). Target: elemen dengan data-ad-zone pada
   * class .ad-display-slot, .tp-display-top (tp.html fixed top banner),
   * dan semua slot sticky (.vd-sticky-top-lb/mb, .vd-sticky-bottom-lb).
   * Auto-refresh setiap 90 detik untuk menambah impresi saat user browse.
   */
  var LISTING_SELECTORS = [
    '.ad-display-slot',
    '.tp-display-top',
    '.vd-sticky-top-lb', '.vd-sticky-top-mb',
    '.vd-sticky-bottom-lb'
  ];

  function initListingAds() {
    var slots = [];
    LISTING_SELECTORS.forEach(function (sel) {
      var els = document.querySelectorAll(sel + '[data-ad-zone]');
      Array.prototype.forEach.call(els, function (el) { slots.push(el); });
    });
    if (!slots.length) return;

    function doInject() {
      slots.forEach(function (slot, i) {
        var zone = slot.getAttribute('data-ad-zone');
        setTimeout(function () { injectAd(slot, zone); }, i * 300);
      });
    }

    doInject(); // inject saat halaman pertama kali load
    setInterval(doInject, 90000); // auto-refresh tiap 90 detik
  }

  // Auto-call saat DOM siap — berlaku di semua halaman tanpa perlu
  // panggilan manual di tiap HTML.
  document.addEventListener('DOMContentLoaded', initListingAds);

  // ── Popunder / Tab-under ─────────────────────────────────────────────
  var POP_URL         = 'https://turbulentrefreshments.com/z6ec2ixj7?key=bafa7c785c7d84482705d8749d9b28de';
  // Smartlink — dipakai sebagai tujuan klik langsung di overlay bar video
  // (berbeda dari popunder yg buka tab background saat modal pertama dibuka)
  var SMARTLINK_URL   = 'https://turbulentrefreshments.com/z6ec2ixj7?key=bafa7c785c7d84482705d8749d9b28de';
  var POP_COOLDOWN_MS  = 30000;  // maks 1x per 30 detik agar tidak diblokir browser
  var _lastPop         = 0;
  var DL_COOLDOWN_MS   = 5000;   // directlink (download) cooldown terpisah — lebih pendek
  var _lastDirectlink  = 0;

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
    /* Dihapus — overlay bar tidak dipakai (zone conflict + tidak ada unit Adsterra yang cocok) */
    return;
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

  // ── Social Bar / Fixed Ad Suppressor ─────────────────────────────────
  // Ketika watch modal dibuka (body.modal-open), semua elemen position:fixed
  // di luar modal disembunyikan agar tidak muncul di atas modal.
  // Ini mencegah Social Bar & sticky ad bertumpuk di atas konten watch.
  (function () {
    var _suppressed = [];

    function suppressFixed() {
      _suppressed = [];
      var children = document.body.children;
      for (var i = 0; i < children.length; i++) {
        var el = children[i];
        // Lewati modal, script, style, toast, dan adblock banner
        if (!el || !el.tagName) continue;
        if (/^(SCRIPT|STYLE|LINK|NOSCRIPT)$/.test(el.tagName)) continue;
        if (el.classList && el.classList.contains('modal')) continue;
        if (el.id === 'toast' || el.id === 'vdry-adb-banner') continue;
        var pos = window.getComputedStyle(el).position;
        if (pos === 'fixed' || pos === 'sticky') {
          var saved = el.style.display;
          _suppressed.push({ el: el, display: saved });
          el.style.setProperty('display', 'none', 'important');
        }
      }
    }

    function restoreFixed() {
      for (var j = 0; j < _suppressed.length; j++) {
        _suppressed[j].el.style.display = _suppressed[j].display;
      }
      _suppressed = [];
    }

    // Tangkap elemen fixed yang di-inject SETELAH modal terbuka (mis. Social Bar)
    var _newNodeObs = null;
    function watchNewFixed() {
      if (_newNodeObs || !window.MutationObserver) return;
      _newNodeObs = new MutationObserver(function (mutations) {
        if (!document.body.classList.contains('modal-open')) return;
        for (var mi = 0; mi < mutations.length; mi++) {
          var added = mutations[mi].addedNodes;
          for (var ni = 0; ni < added.length; ni++) {
            var node = added[ni];
            if (!node || node.nodeType !== 1) continue;
            if (/^(SCRIPT|STYLE|LINK|NOSCRIPT)$/.test(node.tagName)) continue;
            if (node.classList && node.classList.contains('modal')) continue;
            if (node.id === 'toast' || node.id === 'vdry-adb-banner') continue;
            var npos = window.getComputedStyle(node).position;
            if (npos === 'fixed' || npos === 'sticky') {
              var nsaved = node.style.display;
              _suppressed.push({ el: node, display: nsaved });
              node.style.setProperty('display', 'none', 'important');
            }
          }
        }
      });
      _newNodeObs.observe(document.body, { childList: true });
    }

    if (window.MutationObserver) {
      var classObs = new MutationObserver(function () {
        if (document.body.classList.contains('modal-open')) {
          suppressFixed();
          watchNewFixed();
        } else {
          restoreFixed();
          if (_newNodeObs) { _newNodeObs.disconnect(); _newNodeObs = null; }
        }
      });
      classObs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }
  })();

  /**
   * Buka directlink di tab baru di DEPAN (foreground).
   * Dipakai untuk tombol Download dan aksi eksplisit user
   * di mana tab baru memang diharapkan tampil langsung.
   * Cooldown TERPISAH dari triggerPopunder agar klik Download tidak kena
   * block oleh popunder yang baru saja ter-trigger saat modal dibuka.
   */
  function triggerDirectlink() {
    var now = Date.now();
    if (now - _lastDirectlink < DL_COOLDOWN_MS) return;
    _lastDirectlink = now;
    try {
      window.open(SMARTLINK_URL, '_blank', 'noopener,noreferrer');
    } catch (e) {}
  }

  window.VdryAds = {
    reloadModalAds:   reloadModalAds,
    initVideoOverlay: initVideoOverlay,
    initVideoTap:     initVideoTap,
    initTpFeed:       initTpFeed,
    initListingAds:   initListingAds,
    triggerPopunder:  triggerPopunder,
    triggerDirectlink: triggerDirectlink,
    injectAd:         injectAd,
    ZONES:            ZONES,
  };

})();
