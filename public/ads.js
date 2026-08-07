'use strict';
/* ── Vidorey Ads Manager ───────────────────────────────────────────────
   Fix utama:
   1. INJECTION QUEUE — serialisasi satu per satu: set atOptions →
      tunggu invoke.js selesai load → baru inject berikutnya.
      Mencegah race condition di mana invoke.js unit A membaca
      atOptions yang sudah di-overwrite unit B.
   2. NO CACHE BUSTER — ?_t= dihapus dari URL invoke.js; beberapa
      CDN tidak mengenali path dengan query param → gagal serve.
   3. atOptions = {} tanpa window. — sesuai format resmi Adsterra.
   4. MODAL ADS — inject ulang saat modal terbuka (bukan saat hidden).
   5. AUTO-REFRESH — listing: 90s, modal: 60s.
────────────────────────────────────────────────────────────────────── */
(function () {

  // ── Zone registry (key + dimensi + URL invoke) ─────────────────────
  var ZONES = {
    'lb-728':     { key: 'ad23cecb6cc7205a344717b0998c822d', w: 728, h: 90,
                    src: 'https://turbulentrefreshments.com/ad23cecb6cc7205a344717b0998c822d/invoke.js' },
    'mb-320':     { key: 'd37e31d713d11b2ddde7d3efca199c9d', w: 320, h: 50,
                    src: 'https://turbulentrefreshments.com/d37e31d713d11b2ddde7d3efca199c9d/invoke.js' },
    'box-300':    { key: 'd50b941ac6d9bd5749dcdb0b417bf348', w: 300, h: 250,
                    src: 'https://turbulentrefreshments.com/d50b941ac6d9bd5749dcdb0b417bf348/invoke.js' },
    'sky-160':    { key: 'e0fc9f770eacb77e8afcfde28d8a06a8', w: 160, h: 600,
                    src: 'https://turbulentrefreshments.com/e0fc9f770eacb77e8afcfde28d8a06a8/invoke.js' },
    'half-160':   { key: 'd7a21e9839cad22a65ed9e21e6a33272', w: 160, h: 300,
                    src: 'https://turbulentrefreshments.com/d7a21e9839cad22a65ed9e21e6a33272/invoke.js' },
    'banner-468': { key: 'f517b5d3c983922d55c67370c8bd95fc', w: 468, h: 60,
                    src: 'https://turbulentrefreshments.com/f517b5d3c983922d55c67370c8bd95fc/invoke.js' },
  };

  // ── Injection queue — serialisasi agar atOptions tidak tertimpa ─────
  var _iq = [];       // [{container, zoneName}]
  var _iqBusy = false;

  function _iqFlush() {
    if (_iqBusy || !_iq.length) return;
    _iqBusy = true;
    var item = _iq.shift();
    _iqRun(item.container, item.zoneName);
  }

  function _iqRun(container, zoneName) {
    var z = ZONES[zoneName];
    if (!z || !container) { _iqDone(); return; }

    container.style.display = '';
    container.innerHTML = '';

    var isSticky = container.classList.contains('vd-sticky-top-lb') ||
                   container.classList.contains('vd-sticky-top-mb') ||
                   container.classList.contains('vd-sticky-bottom-lb') ||
                   container.classList.contains('tp-display-top');

    var finished = false;
    function finish(delay) {
      if (finished) return;
      // Tunggu sebentar setelah invoke.js load agar iframe sempat ter-render
      setTimeout(function () {
        if (finished) return;
        finished = true;
        if (!isSticky && !container.querySelector('iframe')) {
          container.style.display = 'none';
        }
        _iqDone();
      }, delay || 0);
    }

    // 1. Set atOptions (inline script, eksekusi sinkron saat di-append)
    var optEl = document.createElement('script');
    optEl.textContent = 'atOptions={"key":"' + z.key +
      '","format":"iframe","height":' + z.h +
      ',"width":' + z.w + ',"params":{}};';
    container.appendChild(optEl);

    // 2. Load invoke.js (tanpa cache buster — beberapa CDN tidak support query param)
    var invEl = document.createElement('script');
    invEl.onload  = function () { finish(600); }; // tunggu 600ms untuk iframe render
    invEl.onerror = function () { finish(0); };
    setTimeout(function () { finish(0); }, 5000); // hard timeout 5 detik
    invEl.src = z.src;
    container.appendChild(invEl);
  }

  function _iqDone() {
    _iqBusy = false;
    _iqFlush();
  }

  /**
   * Tambahkan slot ke antrian injeksi.
   * Thread-safe: slot berikutnya hanya mulai setelah invoke.js sebelumnya load.
   */
  function injectAd(container, zoneName) {
    if (!ZONES[zoneName] || !container) return;
    _iq.push({ container: container, zoneName: zoneName });
    _iqFlush();
  }

  // ── Modal Ads ────────────────────────────────────────────────────────
  /**
   * Panggil tepat setelah modal.classList.remove('hidden').
   * Inject semua [data-ad-zone] di dalam modal.
   * Auto-refresh setiap 60 detik selama modal terbuka.
   */
  var _modalRefreshMap = [];

  function reloadModalAds(modalEl) {
    if (!modalEl) return;

    _modalRefreshMap = _modalRefreshMap.filter(function (item) {
      if (item.modalEl === modalEl) { clearInterval(item.tid); return false; }
      return true;
    });

    var slots = Array.prototype.slice.call(modalEl.querySelectorAll('[data-ad-zone]'));

    function doInject() {
      if (modalEl.classList.contains('hidden')) return;
      slots.forEach(function (slot) {
        var zone = slot.getAttribute('data-ad-zone');
        injectAd(slot, zone); // queue handles serialization
      });
    }

    doInject();
    var tid = setInterval(doInject, 60000);
    _modalRefreshMap.push({ modalEl: modalEl, tid: tid });
  }

  // ── Listing Page Ads ─────────────────────────────────────────────────
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
      slots.forEach(function (slot) {
        var zone = slot.getAttribute('data-ad-zone');
        injectAd(slot, zone);
      });
    }

    doInject();
    setInterval(doInject, 90000);
  }

  document.addEventListener('DOMContentLoaded', initListingAds);

  // ── Popunder / Smartlink ─────────────────────────────────────────────
  var POP_URL        = 'https://rm358.com/4/11490160';
  var SMARTLINK_URL  = 'https://turbulentrefreshments.com/khj65tru?key=188aaea14e197cc95790b8dca5bbbdfd';
  var POP_COOLDOWN_MS = 30000;
  var _lastPop        = 0;
  var DL_COOLDOWN_MS  = 5000;
  var _lastDirectlink = 0;

  function triggerPopunder() {
    var now = Date.now();
    if (now - _lastPop < POP_COOLDOWN_MS) return;
    _lastPop = now;
    try {
      var w = window.open(POP_URL, '_blank', 'noopener,noreferrer');
      if (w) { w.blur(); window.focus(); }
    } catch (e) {}
  }

  // ── Video Overlay (dinonaktifkan) ────────────────────────────────────
  function initVideoOverlay(prefix) {
    /* Dihapus — overlay bar tidak dipakai */
    return;
  }

  // ── Video Tap Zone ───────────────────────────────────────────────────
  function initVideoTap(prefix) {
    var tapZone = document.getElementById(prefix + 'VideoTapZone');
    var videoEl = document.getElementById(prefix + 'VideoEl');
    if (!tapZone) return;

    tapZone.addEventListener('click', function () {
      triggerPopunder();
      var iframeMode = videoEl && videoEl.classList.contains('hidden');
      if (iframeMode) {
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
  var SHOW_DELAY_MS = 5000;
  var RESHOW_SECS   = 120;

  function initTpFeed() {
    var feed = document.getElementById('tpFeed');
    if (!feed) return;

    feed.addEventListener('click', function (e) {
      var slide = e.target.closest ? e.target.closest('.tp-slide') : null;
      if (!slide) return;
      if (slide.classList.contains('tp-slide-ad') ||
          slide.classList.contains('tp-slide-end')) return;
      triggerPopunder();
    });

    var bar = document.createElement('div');
    bar.id        = 'tpAdBar';
    bar.className = 'tp-ad-bar';
    bar.setAttribute('role', 'button');
    bar.innerHTML =
      '<span class="tp-ad-bar-label">🎁 <strong>Penawaran Eksklusif</strong> — Ketuk untuk melihat</span>' +
      '<button class="tp-ad-bar-close" type="button" aria-label="Tutup">✕</button>';
    document.body.appendChild(bar);
    bar.style.display = 'none';

    var tpCloseBtn    = bar.querySelector('.tp-ad-bar-close');
    var tpReshowTimer = null;

    function hideTpBar() {
      bar.style.display = 'none';
      clearTimeout(tpReshowTimer);
      tpReshowTimer = setTimeout(showTpBar, RESHOW_SECS * 1000);
    }
    function showTpBar() { bar.style.display = 'flex'; }

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
  // Saat modal terbuka (body.modal-open), semua elemen position:fixed
  // di luar modal disembunyikan agar tidak overlap konten watch.
  (function () {
    var _suppressed = [];

    function suppressFixed() {
      _suppressed = [];
      var children = document.body.children;
      for (var i = 0; i < children.length; i++) {
        var el = children[i];
        if (!el || !el.tagName) continue;
        if (/^(SCRIPT|STYLE|LINK|NOSCRIPT)$/.test(el.tagName)) continue;
        if (el.classList && el.classList.contains('modal')) continue;
        if (el.id === 'toast' || el.id === 'vdry-adb-banner' || el.id === 'tpAdBar') continue;
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
            if (node.id === 'toast' || node.id === 'vdry-adb-banner' || node.id === 'tpAdBar') continue;
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

  // ── Directlink ───────────────────────────────────────────────────────
  function triggerDirectlink() {
    var now = Date.now();
    if (now - _lastDirectlink < DL_COOLDOWN_MS) return;
    _lastDirectlink = now;
    try {
      window.open(SMARTLINK_URL, '_blank', 'noopener,noreferrer');
    } catch (e) {}
  }

  window.VdryAds = {
    reloadModalAds:    reloadModalAds,
    initVideoOverlay:  initVideoOverlay,
    initVideoTap:      initVideoTap,
    initTpFeed:        initTpFeed,
    initListingAds:    initListingAds,
    triggerPopunder:   triggerPopunder,
    triggerDirectlink: triggerDirectlink,
    injectAd:          injectAd,
    ZONES:             ZONES,
  };

})();
