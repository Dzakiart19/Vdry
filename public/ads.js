'use strict';
/* ── Vidorey Ads Manager — Phase 2 overhaul ───────────────────────────
   Revenue-first updates:
   1. INJECTION QUEUE — serialize atOptions + invoke.js to prevent race
   2. PRE-ROLL OVERLAY (re-enabled) — 5s countdown, skippable, uses box-300.
      Triggered when modal opens. User must wait 5s before skip.
   3. MID-ROLL OVERLAY — every 5 min of playback, 5s banner at bottom.
   4. NATIVE LISTING ADS — inject an ad card every 12 grid items
      (positions 6, 18, 30, …). Removes 0-revenue "dead" slots between grid.
   5. AUTO-REFRESH — listing: 90s, modal: 60s, mid-roll: 8 min.
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
   * Pre-roll: bungkus video stage 5 detik dengan overlay iklan box-300.
   * Auto-refresh setiap 60 detik selama modal terbuka.
   */
  var _modalRefreshMap = [];

  function reloadModalAds(modalEl) {
    if (!modalEl) return;

    _modalRefreshMap = _modalRefreshMap.filter(function (item) {
      if (item.modalEl === modalEl) { clearInterval(item.tid); clearInterval(item.mid); return false; }
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
    _modalRefreshMap.push({ modalEl: modalEl, tid: tid, mid: null });

    // ── Pre-roll overlay activation ──
    startPreRoll(modalEl);
    // ── Mid-roll timer (5-min interval) ──
    startMidRoll(modalEl);
  }

  // ── Pre-roll overlay ──────────────────────────────────────────────
  //    Shows a 300x250 ad over the video stage for 5 seconds when the
  //    modal opens. Skip button disabled until countdown finishes.
  var _preRollTimers = [];
  function clearPreRollTimers() {
    _preRollTimers.forEach(clearTimeout);
    _preRollTimers = [];
  }

  function startPreRoll(modalEl) {
    if (!modalEl) return;
    var overlay = modalEl.querySelector('.video-ad-overlay');
    var content = modalEl.querySelector('.video-ad-content');
    var timerEl = modalEl.querySelector('[id$="VideoAdTimer"]');
    var closeBtn = modalEl.querySelector('[id$="VideoAdClose"]');
    if (!overlay || !content || !timerEl || !closeBtn) return;

    // Reset state
    content.innerHTML = '';
    closeBtn.disabled = true;
    timerEl.textContent = '5';
    overlay.style.display = '';
    overlay.setAttribute('aria-hidden', 'false');

    // Inject box-300 ad into overlay
    var adSlot = document.createElement('div');
    adSlot.setAttribute('data-ad-zone', 'box-300');
    adSlot.style.margin = '0 auto';
    content.appendChild(adSlot);
    injectAd(adSlot, 'box-300');

    var remaining = 5;
    var intervalId = setInterval(function () {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(intervalId);
        timerEl.textContent = '0';
        closeBtn.disabled = false;
        // Auto-hide after 1s delay post-countdown (lets user click skip)
        var t = setTimeout(function () {
          overlay.style.display = 'none';
          overlay.setAttribute('aria-hidden', 'true');
        }, 1000);
        _preRollTimers.push(t);
      } else {
        timerEl.textContent = String(remaining);
      }
    }, 1000);
    _preRollTimers.push(intervalId);

    // Skip button handler
    closeBtn.onclick = function () {
      if (closeBtn.disabled) return;
      clearInterval(intervalId);
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
    };
  }

  // ── Mid-roll overlay ──────────────────────────────────────────────
  //    Every 5 minutes of playback, show a 5s banner at bottom of video.
  //    Banner uses box-300. Can be dismissed early.
  var _midRollTimers = [];
  function clearMidRollTimers() {
    _midRollTimers.forEach(clearInterval);
    _midRollTimers = [];
  }

  function startMidRoll(modalEl) {
    if (!modalEl) return;
    var videoEl = modalEl.querySelector('video');
    if (!videoEl) return;

    clearMidRollTimers();

    var lastShowAt = 0;
    var MID_ROLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

    function checkMidRoll() {
      if (modalEl.classList.contains('hidden')) {
        clearMidRollTimers();
        return;
      }
      if (videoEl.paused || videoEl.ended) return;
      var now = Date.now();
      if (now - lastShowAt < MID_ROLL_INTERVAL_MS) return;

      lastShowAt = now;
      showMidRollBanner(modalEl);
    }

    var intervalId = setInterval(checkMidRoll, 5000); // check every 5s
    _midRollTimers.push(intervalId);
    _modalRefreshMap[_modalRefreshMap.length - 1].mid = intervalId;
  }

  function showMidRollBanner(modalEl) {
    // Reuse the pre-roll overlay, but with a different label
    var overlay = modalEl.querySelector('.video-ad-overlay');
    var label = modalEl.querySelector('.video-ad-label');
    var content = modalEl.querySelector('.video-ad-content');
    if (!overlay || !content) return;

    content.innerHTML = '';
    if (label) label.textContent = 'Iklan (5s)';

    var adSlot = document.createElement('div');
    adSlot.setAttribute('data-ad-zone', 'box-300');
    adSlot.style.margin = '0 auto';
    content.appendChild(adSlot);
    injectAd(adSlot, 'box-300');

    overlay.style.display = '';
    overlay.setAttribute('aria-hidden', 'false');

    var remaining = 5;
    var intervalId = setInterval(function () {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(intervalId);
        overlay.style.display = 'none';
        overlay.setAttribute('aria-hidden', 'true');
      }
    }, 1000);
    _midRollTimers.push(intervalId);
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

  // ── Native listing injection ────────────────────────────────────────
  //    Inject an ad card (box-300) between grid items at position 6, 18, 30, …
  //    Works with any platform grid that uses .rb-grid > .rb-card or .grid-item.
  function injectNativeListingAds(gridEl) {
    if (!gridEl) return;
    var cards = gridEl.querySelectorAll(':scope > .rb-card, :scope > .grid-item, :scope > [data-card]');
    if (cards.length < 6) return;

    // Position 6 (index 5), then every 12 cards after that
    var injectPositions = [];
    for (var pos = 6; pos < cards.length; pos += 12) {
      injectPositions.push(pos - 1); // 0-indexed insertion BEFORE this card
    }

    injectPositions.forEach(function (idx) {
      var card = cards[idx];
      if (!card) return;
      // Skip if an ad already exists right before this card
      if (card.previousElementSibling && card.previousElementSibling.classList.contains('vd-native-ad-card')) return;

      var adCard = document.createElement('div');
      adCard.className = 'vd-native-ad-card rb-card';
      adCard.setAttribute('data-ad-zone', 'box-300');
      adCard.style.cssText = 'display:flex;align-items:center;justify-content:center;min-height:250px;background:rgba(255,255,255,0.02);border:1px dashed rgba(255,255,255,0.05);';
      gridEl.insertBefore(adCard, card);
      injectAd(adCard, 'box-300');
    });
  }

  document.addEventListener('DOMContentLoaded', initListingAds);

  // ── Directlink jaringan iklan ───────────────────────────────────────
  // Popunder dikelola oleh script jaringan iklan yang dimuat di setiap halaman.
  // Jangan buka URL popunder custom dari sini.
  var SMARTLINK_URL  = 'https://turbulentrefreshments.com/khj65tru?key=188aaea14e197cc95790b8dca5bbbdfd';
  var DL_COOLDOWN_MS  = 5000;
  var _lastDirectlink = 0;

  function triggerPopunder() {
    // Compatibility no-op: existing platform handlers may still call this.
    // The active popunder is the network script included in each HTML page.
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

  // Compatibility shim — old callers may still call initVideoOverlay
  function initVideoOverlay(prefix) {
    // No-op shim; pre-roll is now driven by reloadModalAds()
    return;
  }

  window.VdryAds = {
    reloadModalAds:    reloadModalAds,
    initVideoOverlay:  initVideoOverlay,
    initVideoTap:      initVideoTap,
    initTpFeed:        initTpFeed,
    initListingAds:    initListingAds,
    injectNativeListingAds: injectNativeListingAds,
    triggerPopunder:   triggerPopunder,
    triggerDirectlink: triggerDirectlink,
    injectAd:          injectAd,
    ZONES:             ZONES,
  };

})();
