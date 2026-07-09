/* ═══════════════════════════════════════════════════════════════════
   Vidorey Reddit — Platform 6 client script (rc.js)
   TikTok-style vertical scroll-snap feed dengan category tabs.
   Direct MP4 via /proxy/rc/stream/:hash — tidak pakai hls.js.
   Kategori dari /api/rc/categories, digeser horizontal.
═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const API = (typeof BACKEND_URL !== 'undefined' && BACKEND_URL) ? BACKEND_URL : '';

  /* ── State ─────────────────────────────────────────────────────── */
  var currentCategoryId = 6;   // default: NSFW Heterosexual
  var currentCursor     = null;
  var currentSort       = 'hot';
  var isLoading         = false;
  var hasMore           = true;
  var activeVideo       = null;
  var lastSlide         = null;
  var targetSlideHash   = null;
  var isMuted           = true;
  var totalSlidesAdded  = 0;

  /* ── Toast ──────────────────────────────────────────────────── */
  var toastTimer;
  function showToast(msg) {
    var el = document.getElementById('rcToast');
    clearTimeout(toastTimer);
    el.textContent = msg;
    el.classList.remove('hidden');
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 3400);
  }

  /* ── Utility ──────────────────────────────────────────────── */
  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function b64urlEncode(str) {
    try {
      var bytes = new TextEncoder().encode(str);
      var bin = '';
      bytes.forEach(function (b) { bin += String.fromCharCode(b); });
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch { return encodeURIComponent(str); }
  }

  function fmtNum(n) {
    n = parseInt(n) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'jt';
    if (n >= 1000)    return (n / 1000).toFixed(1) + 'rb';
    return n.toLocaleString('id-ID');
  }

  /* ── Fetch helpers ──────────────────────────────────────────── */
  function fetchWithTimeout(url, ms) {
    ms = ms || 15000;
    var ctrl = new AbortController();
    var tid  = setTimeout(function () { ctrl.abort(); }, ms);
    return fetch(url, { signal: ctrl.signal }).finally(function () { clearTimeout(tid); });
  }

  function apiFetch(path) {
    return fetchWithTimeout(API + path).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (b) {
        throw new Error(b.error || ('HTTP ' + r.status));
      });
      return r.json();
    });
  }

  /* ── Mute/unmute ────────────────────────────────────────────── */
  function applyMuteState(vid) {
    if (!vid) return;
    vid.muted = isMuted;
    document.getElementById('rcIconMute').style.display   = isMuted ? '' : 'none';
    document.getElementById('rcIconUnmute').style.display = isMuted ? 'none' : '';
    var btn = document.getElementById('rcMuteBtn');
    btn.setAttribute('aria-label', isMuted ? 'Aktifkan suara' : 'Matikan suara');
    btn.setAttribute('title',      isMuted ? 'Aktifkan suara' : 'Matikan suara');
  }

  document.getElementById('rcMuteBtn').addEventListener('click', function () {
    isMuted = !isMuted;
    applyMuteState(activeVideo);
  });

  /* ── Stop active video ──────────────────────────────────────── */
  function stopActive() {
    if (activeVideo) {
      activeVideo.pause();
      /* Hapus src untuk bebaskan memori (MP4 besar 20–40MB per video) */
      activeVideo.removeAttribute('src');
      activeVideo.load();
      activeVideo = null;
    }
  }

  /* ── Build slide element ──────────────────────────────────────
     Setiap slide: <video> fullscreen + overlay meta (subreddit, title, upvotes)
  ── */
  function buildSlide(video) {
    var slide = document.createElement('div');
    slide.className       = 'rc-slide';
    slide.dataset.hash    = video.hash;
    slide.dataset.loaded  = '0';

    var thumbUrl = video.thumbnail
      ? (API + '/proxy/rc/thumb?url=' + b64urlEncode(video.thumbnail))
      : '';

    var subLabel = video.subreddit ? 'r/' + escHtml(video.subreddit) : '';
    var title    = escHtml((video.title || '').slice(0, 120));
    var upvotes  = fmtNum(video.upvotes);

    slide.innerHTML = [
      '<video class="rc-video" playsinline preload="none"',
      thumbUrl ? (' poster="' + thumbUrl + '"') : '',
      '></video>',
      '<div class="rc-overlay">',
        '<div class="rc-meta-left">',
          subLabel ? ('<span class="rc-subreddit">' + subLabel + '</span>') : '',
          title    ? ('<p class="rc-title">' + title + '</p>')              : '',
        '</div>',
        '<div class="rc-meta-right">',
          '<div class="rc-stat">',
            /* Upvote icon */
            '<svg class="rc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">',
              '<path d="M12 19V5M5 12l7-7 7 7"/>',
            '</svg>',
            upvotes,
          '</div>',
        '</div>',
      '</div>',
    ].join('');

    return slide;
  }

  /* ── Load & play video dalam sebuah slide ───────────────────── */
  function loadAndPlaySlide(slide) {
    var hash = slide.dataset.hash;
    if (targetSlideHash !== hash) return; // user sudah scroll ke slide lain

    var vid = slide.querySelector('.rc-video');
    if (!vid) return;

    /* Jika src belum diset, set sekarang — browser mulai buffer */
    if (!vid.src || !vid.src.includes('/proxy/rc/stream/')) {
      vid.src   = API + '/proxy/rc/stream/' + hash;
      vid.muted = isMuted;
    }

    activeVideo = vid;

    var playPromise = vid.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(function (err) {
        /* Autoplay diblokir browser — user perlu tap */
        if (err.name !== 'AbortError') {
          console.warn('[rc] autoplay blocked:', err.message);
        }
      });
    }
  }

  /* ── IntersectionObserver: play/pause berdasarkan viewport ─── */
  var ioPlay = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var slide = entry.target;
      var vid   = slide.querySelector('.rc-video');
      if (entry.intersectionRatio >= 0.75) {
        /* Slide ini sekarang dominan */
        if (targetSlideHash !== slide.dataset.hash) {
          /* Pause video slide sebelumnya segera */
          if (activeVideo && vid && activeVideo !== vid) {
            activeVideo.pause();
          }
          targetSlideHash = slide.dataset.hash;
          loadAndPlaySlide(slide);

          /* Update address bar */
          try {
            history.replaceState(null, '', '/rc/video/' + slide.dataset.hash);
          } catch (_) {}
        }
      } else {
        /* Slide keluar viewport — pause dan bebaskan memori */
        if (vid && activeVideo === vid) {
          vid.pause();
          activeVideo = null;
        }
        /* Hapus src jika slide sudah jauh dari viewport */
        if (vid && vid.src && entry.intersectionRatio === 0) {
          vid.removeAttribute('src');
          vid.load();
        }
      }
    });
  }, { threshold: [0, 0.75] });

  /* ── IntersectionObserver: infinite scroll trigger ──────────── */
  var ioEnd = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting && !isLoading && hasMore) {
        loadPosts();
      }
    });
  }, { threshold: 0.5 });

  /* ── Ad slide — full-screen slide dengan display banner ─────── */
  function createAdSlide() {
    var slide = document.createElement('div');
    slide.className = 'rc-slide rc-slide-ad';
    slide.setAttribute('aria-hidden', 'true');

    var body = document.createElement('div');
    body.className = 'rc-ad-body';

    var label = document.createElement('p');
    label.className = 'rc-ad-label';
    label.textContent = 'Iklan';

    var adSlot = document.createElement('div');
    adSlot.className = 'rc-ad-display';

    body.appendChild(label);
    body.appendChild(adSlot);
    slide.appendChild(body);

    /* Inject display banner (300×250) programatik */
    var scOpt = document.createElement('script');
    scOpt.textContent = "atOptions={'key':'d50b941ac6d9bd5749dcdb0b417bf348','format':'iframe','height':250,'width':300,'params':{}};";
    adSlot.appendChild(scOpt);
    var scInv = document.createElement('script');
    scInv.src = 'https://www.highperformanceformat.com/d50b941ac6d9bd5749dcdb0b417bf348/invoke.js';
    adSlot.appendChild(scInv);

    return slide;
  }

  /* ── End slide ──────────────────────────────────────────────── */
  function appendEndSlide() {
    var feed = document.getElementById('rcFeed');
    if (feed.querySelector('.rc-slide-end')) return;

    var slide = document.createElement('div');
    slide.className = 'rc-slide rc-slide-end';
    slide.innerHTML = [
      '<div class="rc-end-body">',
        '<div class="rc-end-icon">',
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">',
            '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>',
            '<polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
          '</svg>',
        '</div>',
        '<p class="rc-end-msg">Semua video dalam kategori ini sudah ditampilkan.</p>',
        '<button class="rc-end-back-btn" id="rcEndBackBtn">Pilih kategori lain</button>',
        '<div class="rc-end-ad" id="rcEndAdSlot"></div>',
      '</div>',
    ].join('');

    feed.appendChild(slide);

    /* Inject display banner */
    var adSlot = slide.querySelector('#rcEndAdSlot');
    if (adSlot) {
      var scOpt = document.createElement('script');
      scOpt.textContent = "atOptions={'key':'d50b941ac6d9bd5749dcdb0b417bf348','format':'iframe','height':250,'width':300,'params':{}};";
      adSlot.appendChild(scOpt);
      var scInv = document.createElement('script');
      scInv.src = 'https://www.highperformanceformat.com/d50b941ac6d9bd5749dcdb0b417bf348/invoke.js';
      adSlot.appendChild(scInv);
    }

    /* Tombol → scroll cats bar ke top + fokus ke tab pertama */
    var btn = slide.querySelector('#rcEndBackBtn');
    if (btn) {
      btn.addEventListener('click', function () {
        feed.scrollTo({ top: 0, behavior: 'smooth' });
        var catsBar = document.getElementById('rcCatsBar');
        if (catsBar) catsBar.scrollTo({ left: 0, behavior: 'smooth' });
      });
    }
  }

  /* ── Reset feed state ───────────────────────────────────────── */
  function resetFeed() {
    stopActive();
    targetSlideHash = null;
    var feed = document.getElementById('rcFeed');
    Array.from(feed.children).forEach(function (s) { ioPlay.unobserve(s); });
    if (lastSlide) { ioEnd.unobserve(lastSlide); }
    feed.innerHTML   = '';
    currentCursor    = null;
    hasMore          = true;
    lastSlide        = null;
    totalSlidesAdded = 0;
  }

  /* ── Muat batch video dari API ──────────────────────────────── */
  function loadPosts() {
    if (isLoading || !hasMore) return;
    isLoading = true;
    document.getElementById('rcLoader').classList.remove('hidden');

    var qs = 'categoryId=' + currentCategoryId + '&sort=' + currentSort + '&limit=25';
    if (currentCursor) qs += '&after=' + encodeURIComponent(currentCursor);

    apiFetch('/api/rc/posts?' + qs).then(function (data) {
      var feed   = document.getElementById('rcFeed');
      var videos = data.videos || [];

      currentCursor = data.cursor || null;
      hasMore       = !!data.hasMore;

      if (videos.length === 0 && feed.children.length === 0) {
        appendEndSlide();
        return;
      }

      videos.forEach(function (video) {
        var slide = buildSlide(video);

        if (lastSlide) ioEnd.unobserve(lastSlide);
        feed.appendChild(slide);
        ioPlay.observe(slide);
        lastSlide = slide;
        totalSlidesAdded++;

        /* Sisipkan ad slide setiap 5 video */
        if (totalSlidesAdded % 5 === 0) {
          if (lastSlide) ioEnd.unobserve(lastSlide);
          var adSlide = createAdSlide();
          feed.appendChild(adSlide);
          lastSlide = adSlide;
        }
      });

      if (lastSlide) ioEnd.observe(lastSlide);
      if (!hasMore)  appendEndSlide();

    }).catch(function (err) {
      console.error('[rc] loadPosts error:', err.message);
      showToast('Gagal memuat video. Periksa koneksi internet.');
    }).finally(function () {
      isLoading = false;
      document.getElementById('rcLoader').classList.add('hidden');
    });
  }

  /* ── Render category tabs ───────────────────────────────────── */
  function renderCategoryTabs(categories) {
    var bar = document.getElementById('rcCatsBar');
    bar.innerHTML = '';

    /* Filter: tampilkan NSFW categories di atas, SFW di bawah */
    var nsfw = categories.filter(function (c) { return c.type === 'nsfw'; });
    var sfw  = categories.filter(function (c) { return c.type === 'sfw';  });
    var sorted = nsfw.concat(sfw);

    sorted.forEach(function (cat) {
      var btn = document.createElement('button');
      btn.className    = 'rc-cat-tab' + (cat.id === currentCategoryId ? ' active' : '');
      btn.dataset.catId = String(cat.id);
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', cat.id === currentCategoryId ? 'true' : 'false');
      /* Nama pendek: potong "NSFW " prefix dan "&" entity */
      var shortName = cat.name
        .replace(/^NSFW\s+/i, '')
        .replace(/&amp;/g, '&')
        .replace(/\s*&\s*Fetish/, '')
        .replace(/\s*&\s*Mature/, '');
      btn.textContent = (cat.icon || '') + ' ' + shortName;

      btn.addEventListener('click', function () {
        if (parseInt(btn.dataset.catId) === currentCategoryId) return;
        /* Update active state */
        bar.querySelectorAll('.rc-cat-tab').forEach(function (b) {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        /* Scroll tab ke dalam view */
        btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

        currentCategoryId = parseInt(btn.dataset.catId);
        resetFeed();
        loadPosts();
      });

      bar.appendChild(btn);
    });

    /* Scroll tab aktif ke tengah pada awal */
    var activeTab = bar.querySelector('.rc-cat-tab.active');
    if (activeTab) {
      setTimeout(function () {
        activeTab.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
      }, 50);
    }
  }

  /* ── Load categories dari API ───────────────────────────────── */
  function loadCategories() {
    return apiFetch('/api/rc/categories').then(function (data) {
      var cats = data.categories || [];
      if (!cats.length) {
        showToast('Gagal memuat kategori.');
        return;
      }
      /* Set default category: pertama dari NSFW, atau id=6 jika ada */
      var preferred = cats.find(function (c) { return c.id === 6; }) ||
                      cats.find(function (c) { return c.type === 'nsfw'; }) ||
                      cats[0];
      currentCategoryId = preferred ? preferred.id : 6;
      renderCategoryTabs(cats);
    }).catch(function (err) {
      console.error('[rc] loadCategories error:', err.message);
      document.getElementById('rcCatsBar').innerHTML =
        '<div class="rc-cats-loading" style="color:rgba(255,255,255,.4)">Gagal memuat kategori</div>';
    });
  }

  /* ── Sort buttons ───────────────────────────────────────────── */
  document.getElementById('rcSortGroup').addEventListener('click', function (e) {
    var btn = e.target.closest('.rc-sort-btn');
    if (!btn) return;
    var sort = btn.dataset.sort;
    if (sort === currentSort) return;
    document.querySelectorAll('.rc-sort-btn').forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
    currentSort = sort;
    resetFeed();
    loadPosts();
  });

  /* ── Nav Drawer toggle ──────────────────────────────────────── */
  (function initNavDrawer() {
    var burger  = document.getElementById('rcNavBurger');
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

  /* ── Popstate: back button ──────────────────────────────────── */
  window.addEventListener('popstate', function () {
    /* Navigasi balik → address bar sudah berubah, tidak ada state tambahan untuk restore */
  });

  /* ── Init ───────────────────────────────────────────────────── */
  (function init() {
    /* Set initial history entry */
    try { history.replaceState(null, '', '/rc'); } catch (_) {}
    /* Load categories terlebih dahulu, baru load posts */
    loadCategories().then(function () { loadPosts(); });
  })();

})();
