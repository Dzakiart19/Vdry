/* ═══════════════════════════════════════════════════════════════════
   Vidorey TikTok — Platform 5 client script (tp.js)
   TikTok-style vertical scroll-snap feed.
   HLS dimainkan via hls.js. Tidak ada modal — video IS the page.
═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const API = (typeof BACKEND_URL !== 'undefined' && BACKEND_URL) ? BACKEND_URL : '';

  /* ── State ───────────────────────────────────────────────────── */
  let currentPage  = 1;
  let currentTag   = '';
  let currentQuery = '';
  let isLoading    = false;
  let hasMore      = true;
  let activeHls    = null;
  let activeVideo  = null;
  let lastSlide    = null;
  let deepLinkId   = null;  // id numerik untuk deep-link scroll
  let targetSlideId = null; // ID slide yang user INGINKAN — untuk cancel race condition
  let isMuted      = true;  // mulai muted agar autoplay bisa jalan

  /* ── Toast ─────────────────────────────────────────────────── */
  let toastTimer;
  function showToast(msg) {
    const el = document.getElementById('tpToast');
    clearTimeout(toastTimer);
    el.textContent = msg;
    el.classList.remove('hidden');
    toastTimer = setTimeout(() => el.classList.add('hidden'), 3400);
  }

  /* ── Utility ─────────────────────────────────────────────────── */
  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDuration(sec) {
    const s = Math.floor(sec || 0);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  /* ── Base64url encode untuk thumb proxy URL ─────────────────── */
  function b64urlEncode(str) {
    try {
      const bytes = new TextEncoder().encode(str);
      let bin = '';
      bytes.forEach(b => { bin += String.fromCharCode(b); });
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch { return encodeURIComponent(str); }
  }

  /* ── Short-token encode/decode (identik dengan platform lain) ── */
  function encodeSlug(s) {
    try {
      const bytes = new TextEncoder().encode(s);
      let bin = '';
      bytes.forEach(b => { bin += String.fromCharCode(b); });
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch { return encodeURIComponent(s); }
  }

  function decodeSlug(t) {
    try {
      const pad = t.length % 4;
      const s = pad ? t + '='.repeat(4 - pad) : t;
      const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
      return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))) || null;
    } catch { return null; }
  }

  /* ── Fetch helper ─────────────────────────────────────────── */
  function fetchWithTimeout(url, ms) {
    ms = ms || 15000;
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(tid));
  }

  async function apiFetch(path) {
    const r = await fetchWithTimeout(API + path);
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error || ('HTTP ' + r.status));
    }
    return r.json();
  }

  /* ── Build slide element ─────────────────────────────────────── */
  function buildSlide(video) {
    const el = document.createElement('div');
    el.className  = 'tp-slide';
    el.dataset.id = String(video.id);

    const thumbUrl = video.thumbnailSm
      ? (API + '/proxy/tp/thumb?url=' + b64urlEncode(video.thumbnailSm))
      : '';

    const userName  = video.user ? escHtml(video.user.name) : '';
    const captionRaw = (video.caption || '').replace(/#\{\{tag:\d+\}\}/g, '').trim();
    const caption    = escHtml(captionRaw.slice(0, 120));
    const tagsHtml   = (video.tags || []).slice(0, 4)
      .map(t => `<span class="tp-tag" data-tag="${escHtml(t.slug)}">#${escHtml(t.name)}</span>`)
      .join('');

    el.innerHTML = [
      '<video class="tp-video" playsinline muted preload="none"',
      thumbUrl ? (' poster="' + thumbUrl + '"') : '',
      '></video>',
      '<div class="tp-overlay">',
        '<div class="tp-meta-left">',
          userName ? ('<span class="tp-user">@' + userName + '</span>') : '',
          caption  ? ('<p class="tp-caption">'  + caption  + '</p>')   : '',
          tagsHtml ? ('<div class="tp-tags">'   + tagsHtml + '</div>')  : '',
        '</div>',
        '<div class="tp-meta-right">',
          '<div class="tp-stat"><span>❤</span> ' + (video.likes  || 0).toLocaleString('id-ID') + '</div>',
          '<div class="tp-stat"><span>👁</span> ' + (video.views  || 0).toLocaleString('id-ID') + '</div>',
          '<div class="tp-duration">'             + formatDuration(video.duration)               + '</div>',
        '</div>',
      '</div>',
    ].join('');

    /* Klik tag → search feed untuk tag tersebut */
    el.querySelectorAll('.tp-tag').forEach(tagEl => {
      tagEl.addEventListener('click', function (e) {
        e.stopPropagation();
        const slug = tagEl.dataset.tag;
        if (!slug) return;
        resetFeed();
        currentTag = slug;
        document.getElementById('tpSearchInput').value = '';
        loadPosts();
      });
    });

    return el;
  }

  /* ── Mute/unmute: sinkronisasi ikon topbar ─────────────────── */
  function applyMuteState(vid) {
    if (!vid) return;
    vid.muted = isMuted;
    document.getElementById('tpIconMute').style.display   = isMuted ? '' : 'none';
    document.getElementById('tpIconUnmute').style.display = isMuted ? 'none' : '';
    var btn = document.getElementById('tpMuteBtn');
    btn.setAttribute('aria-label', isMuted ? 'Aktifkan suara' : 'Matikan suara');
    btn.setAttribute('title',      isMuted ? 'Aktifkan suara' : 'Matikan suara');
  }

  document.getElementById('tpMuteBtn').addEventListener('click', function () {
    isMuted = !isMuted;
    applyMuteState(activeVideo);
  });

  /* ── Stop active HLS / video ──────────────────────────────── */
  function stopActive() {
    if (activeVideo) { activeVideo.pause(); activeVideo = null; }
    if (activeHls)   { activeHls.destroy(); activeHls   = null; }
  }

  /* ── Mulai play pada video yang sudah siap ─────────────────── */
  function startPlay(vid, slide, hls) {
    stopActive();
    activeVideo = vid;
    activeHls   = hls || null;
    vid.muted   = isMuted;
    vid.play().catch(() => {});
  }

  /* ── Load & play HLS dalam sebuah slide ─────────────────────────
     Race-condition fix: `targetSlideId` dicatat sebelum await.
     Jika setelah await targetSlideId sudah berubah (user scroll ke
     slide lain), request ini dibatalkan — video tidak ikut play.
  ─────────────────────────────────────────────────────────────── */
  async function loadAndPlaySlide(slide) {
    var id = slide.dataset.id;

    /* Slide sudah dimuat sebelumnya — langsung play jika masih target */
    if (slide.dataset.loaded === '1') {
      if (targetSlideId !== id) return;  // user sudah scroll ke slide lain
      var vid = slide.querySelector('.tp-video');
      if (vid) startPlay(vid, slide, slide._hlsInst || null);
      return;
    }

    /* Tandai sedang dimuat agar tidak double-fetch */
    slide.dataset.loaded = '1';

    try {
      var data = await apiFetch('/api/tp/video/' + id);

      /* Batalkan jika user sudah scroll ke slide lain selama fetch */
      if (targetSlideId !== id) {
        slide.dataset.loaded = '0'; // reset agar bisa di-load ulang nanti
        return;
      }

      var vid = slide.querySelector('.tp-video');
      if (!vid) return;

      /* Update address bar */
      history.replaceState(null, '', '/tp/video/' + (data.token || id));

      var hlsProxyUrl = API + data.hlsUrl;

      if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        var hls = new Hls({ enableWorker: false });
        hls.loadSource(hlsProxyUrl);
        hls.attachMedia(vid);

        hls.on(Hls.Events.MANIFEST_PARSED, function () {
          /* Cek lagi: mungkin user scroll saat manifest loading */
          if (targetSlideId !== id) { hls.destroy(); return; }
          startPlay(vid, slide, hls);
        });

        var mediaErrCount = 0;
        hls.on(Hls.Events.ERROR, function (_, errData) {
          if (!errData.fatal) return;
          if (errData.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else if (errData.type === Hls.ErrorTypes.MEDIA_ERROR && mediaErrCount < 2) {
            mediaErrCount++;
            hls.recoverMediaError();
          } else {
            hls.destroy();
            if (targetSlideId === id) showToast('Gagal memutar video. Geser ke video lain.');
          }
        });

        slide._hlsInst = hls;

      } else if (vid.canPlayType('application/vnd.apple.mpegurl')) {
        /* Native HLS — Safari / iOS */
        vid.src = hlsProxyUrl;
        startPlay(vid, slide, null);

      } else {
        showToast('Browser tidak mendukung format video ini.');
      }

    } catch (err) {
      console.error('[tp] loadAndPlaySlide error:', err.message);
      slide.dataset.loaded = '0';
      if (targetSlideId === id) showToast('Gagal memuat video. Coba geser ke video lain.');
    }
  }

  /* ── IntersectionObserver: play/pause berdasarkan viewport ──── */
  var ioPlay = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var slide = entry.target;
      var vid   = slide.querySelector('.tp-video');
      if (entry.intersectionRatio >= 0.75) {
        /* Slide ini sekarang dominan — set sebagai target */
        targetSlideId = slide.dataset.id;
        /* Pause video slide sebelumnya segera (tanpa destroy — biar bisa resume) */
        if (activeVideo && activeVideo !== vid) {
          activeVideo.pause();
        }
        loadAndPlaySlide(slide);
      } else {
        /* Slide keluar viewport — pause saja */
        if (vid && activeVideo === vid) {
          vid.pause();
        }
      }
    });
  }, { threshold: [0.75] });

  /* ── IntersectionObserver: trigger infinite scroll ──────────── */
  var ioEnd = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting && !isLoading && hasMore) {
        loadPosts();
      }
    });
  }, { threshold: 0.5 });

  /* ── Reset feed state (untuk search baru) ────────────────────── */
  function resetFeed() {
    stopActive();
    var feed = document.getElementById('tpFeed');
    /* Unobserve semua slide sebelum bersihkan DOM */
    Array.from(feed.children).forEach(function (s) {
      ioPlay.unobserve(s);
    });
    if (lastSlide) { ioEnd.unobserve(lastSlide); }
    feed.innerHTML = '';
    currentPage    = 1;
    hasMore        = true;
    lastSlide      = null;
    document.getElementById('tpEnd').classList.add('hidden');
  }

  /* ── Muat batch video dari API ──────────────────────────────── */
  async function loadPosts() {
    if (isLoading || !hasMore) return;
    isLoading = true;
    document.getElementById('tpLoader').classList.remove('hidden');

    var qs = 'page=' + currentPage;
    if (currentQuery) qs += '&q='  + encodeURIComponent(currentQuery);
    else if (currentTag) qs += '&tag=' + encodeURIComponent(currentTag);

    try {
      var data   = await apiFetch('/api/tp/posts?' + qs);
      var feed   = document.getElementById('tpFeed');
      var videos = data.videos || [];

      hasMore     = !!(data.pagination && data.pagination.hasMore);
      currentPage = (data.pagination && data.pagination.page ? data.pagination.page : currentPage) + 1;

      if (videos.length === 0 && feed.children.length === 0) {
        var endEl = document.getElementById('tpEnd');
        endEl.textContent = 'Tidak ada video ditemukan.';
        endEl.classList.remove('hidden');
        return;
      }

      videos.forEach(function (video) {
        var slide = buildSlide(video);

        /* Unobserve lastSlide dari ioEnd sebelum diganti */
        if (lastSlide) ioEnd.unobserve(lastSlide);

        feed.appendChild(slide);
        ioPlay.observe(slide);
        lastSlide = slide;

        /* Scroll ke slide deep-link jika ada di batch ini */
        if (deepLinkId && String(video.id) === String(deepLinkId)) {
          deepLinkId = null;
          setTimeout(function () {
            slide.scrollIntoView({ behavior: 'instant', block: 'start' });
          }, 50);
        }
      });

      /* Observe lastSlide untuk trigger load berikutnya */
      if (lastSlide) ioEnd.observe(lastSlide);

      if (!hasMore) {
        document.getElementById('tpEnd').classList.remove('hidden');
      }

    } catch (err) {
      console.error('[tp] loadPosts error:', err.message);
      showToast('Gagal memuat video. Periksa koneksi internet.');
    } finally {
      isLoading = false;
      document.getElementById('tpLoader').classList.add('hidden');
    }
  }

  /* ── Search form ────────────────────────────────────────────── */
  var searchForm  = document.getElementById('tpSearchForm');
  var searchInput = document.getElementById('tpSearchInput');

  searchForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = searchInput.value.trim();
    if (q === currentQuery && !currentTag) return;
    resetFeed();
    currentQuery = q;
    currentTag   = '';
    loadPosts();
  });

  /* Clear search → kembali ke homepage feed */
  searchInput.addEventListener('search', function () {
    if (searchInput.value === '' && currentQuery) {
      resetFeed();
      currentQuery = '';
      currentTag   = '';
      loadPosts();
    }
  });

  /* ── Nav Drawer toggle ───────────────────────────────────────── */
  (function initNavDrawer() {
    var burger  = document.getElementById('tpNavBurger');
    var drawer  = document.getElementById('navDrawer');
    var overlay = document.getElementById('navOverlay');
    var btnClose = document.getElementById('navClose');

    function openDrawer() {
      drawer.classList.add('open');
      overlay.classList.add('open');
      burger.setAttribute('aria-expanded', 'true');
    }
    function closeDrawer() {
      drawer.classList.remove('open');
      overlay.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
    }

    burger.addEventListener('click',  function (e) { e.stopPropagation(); openDrawer(); });
    overlay.addEventListener('click', closeDrawer);
    btnClose.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
  })();

  /* ── Init: deep-link detection SEBELUM loadPosts ────────────── */
  (function init() {
    var match = location.pathname.match(/^\/tp\/video\/([^/]+)\/?$/);
    if (match) {
      var seg = match[1];
      if (/^[a-z0-9]{11}$/.test(seg)) {
        /* Short token → resolve ke ID numerik */
        apiFetch('/api/s/tp/' + seg)
          .then(function (d) { if (d && d.slug) deepLinkId = d.slug; })
          .catch(function () {});
      } else if (/^\d+$/.test(seg)) {
        deepLinkId = seg;
      }
    }

    loadPosts();
  })();

})();
