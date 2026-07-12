'use strict';
/* ─── ExoClick VAST Pre-roll Player ───────────────────────────────────────
   Dipanggil sebelum video utama play. Menampilkan iklan fullscreen,
   countdown skip 5 detik, lalu memanggil onComplete() agar video utama play.
   Jika VAST gagal (network error / no fill) → langsung onComplete().
──────────────────────────────────────────────────────────────────────── */
(function () {
  var ZONES  = ['5972318', '5972326'];
  var _idx   = 0;
  function nextZone() { return ZONES[_idx++ % ZONES.length]; }

  /* Fetch VAST XML via server proxy (hindari CORS browser) */
  async function fetchXml(zone) {
    try {
      var r = await fetch('/api/vast?zone=' + zone, { cache: 'no-store' });
      if (!r.ok) return null;
      return await r.text();
    } catch (e) { return null; }
  }

  /* Parse VAST XML → { mediaUrl, clickUrl } */
  function parseVast(xml) {
    try {
      var doc = new DOMParser().parseFromString(xml, 'text/xml');
      var mediaUrl = null;

      /* Cari MediaFile — preferensi MP4 */
      var mfs = doc.querySelectorAll('MediaFile');
      mfs.forEach(function (mf) {
        if (mediaUrl) return;
        var type = (mf.getAttribute('type') || '').toLowerCase();
        if (type.indexOf('mp4') !== -1 || type === '' || type.indexOf('video') !== -1) {
          var url = mf.textContent.trim();
          if (url) mediaUrl = url;
        }
      });
      /* Fallback: ambil MediaFile pertama apapun */
      if (!mediaUrl && mfs.length) {
        mediaUrl = mfs[0].textContent.trim() || null;
      }

      var clickEl  = doc.querySelector('ClickThrough');
      var clickUrl = clickEl ? clickEl.textContent.trim() : null;

      return { mediaUrl: mediaUrl, clickUrl: clickUrl };
    } catch (e) { return { mediaUrl: null, clickUrl: null }; }
  }

  /* Public: vastPreroll(onComplete)
     Tampilkan pre-roll iklan lalu panggil onComplete() */
  window.vastPreroll = async function (onComplete) {
    try {
      var zone   = nextZone();
      var xml    = await fetchXml(zone);
      if (!xml) { onComplete(); return; }

      var parsed = parseVast(xml);
      if (!parsed.mediaUrl) { onComplete(); return; }

      /* Build fullscreen overlay */
      var overlay = document.createElement('div');
      overlay.className = 'vast-overlay';
      overlay.innerHTML =
        '<video class="vast-vid" playsinline webkit-playsinline></video>' +
        '<div class="vast-ui">' +
          '<span class="vast-badge">Iklan</span>' +
          '<button class="vast-skip">Lewati 5s</button>' +
        '</div>';
      document.body.appendChild(overlay);

      var vid    = overlay.querySelector('.vast-vid');
      var skipBtn = overlay.querySelector('.vast-skip');
      var SKIP_SEC = 5;
      var remain   = SKIP_SEC;

      skipBtn.disabled = true;

      function destroy() {
        clearInterval(timer);
        try { overlay.remove(); } catch (_) {}
        onComplete();
      }

      /* Klik area overlay → buka URL advertiser */
      overlay.addEventListener('click', function (e) {
        if (e.target === skipBtn) return;
        if (parsed.clickUrl) window.open(parsed.clickUrl, '_blank');
      });

      skipBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        destroy();
      });

      vid.addEventListener('ended', destroy);
      vid.addEventListener('error', destroy);

      /* Countdown skip */
      var timer = setInterval(function () {
        remain--;
        if (remain <= 0) {
          clearInterval(timer);
          skipBtn.textContent = 'Lewati \u203a';
          skipBtn.disabled = false;
        } else {
          skipBtn.textContent = 'Lewati ' + remain + 's';
        }
      }, 1000);

      vid.src = parsed.mediaUrl;
      vid.play().catch(function () {
        /* Autoplay diblokir atau format tidak didukung → skip */
        clearInterval(timer);
        try { overlay.remove(); } catch (_) {}
        onComplete();
      });

    } catch (e) {
      onComplete();
    }
  };
})();
