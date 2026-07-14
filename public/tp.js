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
  var cachedTrends     = []; // trending searches dari home mode, untuk end slide
  var totalSlidesAdded = 0;  // counter global untuk sisipkan ad slide setiap 5 video

  /* ── Kategori (tag) browser — tp tidak punya endpoint daftar tag global,
     jadi kita akumulasi tag unik dari video yang sudah termuat di feed. ── */
  var seenTags = new Map(); // slug → name
  function renderTagPanel() {
    var panel = document.getElementById('tpCatPanel');
    if (!panel) return;
    if (!seenTags.size) {
      panel.innerHTML = '<div class="vdry-cat-panel-empty">Kategori akan muncul setelah video dimuat.</div>';
      return;
    }
    var chips = ['<button type="button" class="vdry-cat-chip' + (currentTag ? '' : ' active') + '" data-slug="">Semua</button>'];
    seenTags.forEach(function (name, slug) {
      chips.push('<button type="button" class="vdry-cat-chip' + (currentTag === slug ? ' active' : '') + '" data-slug="' +
        escHtml(slug) + '">' + escHtml(name) + '</button>');
    });
    panel.innerHTML = chips.join('');
    panel.querySelectorAll('.vdry-cat-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var slug = chip.getAttribute('data-slug');
        var btn = document.getElementById('tpCatBtn');
        if (btn) btn.classList.remove('open');
        panel.classList.remove('open');
        var input = document.getElementById('tpSearchInput');
        if (input) input.value = '';
        resetFeed();
        currentQuery = '';
        currentTag   = slug;
        if (!slug) tpNav(true, 'home', '', '');
        else       tpNav(true, 'tag', '', slug);
        loadPosts();
      });
    });
  }


  /* ── History helper: push/replace state + sinkronisasi URL ────── */
  function tpNav(push, mode, q, tag) {
    var url = '/tp';
    if (mode === 'search' && q)   url += '?q='   + encodeURIComponent(q);
    else if (mode === 'tag' && tag) url += '?tag=' + encodeURIComponent(tag);
    var state = { tpMode: mode, q: q || '', tag: tag || '' };
    try {
      if (push) history.pushState(state, '', url);
      else       history.replaceState(state, '', url);
    } catch (_) {}
  }

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
    const captionRaw = (video.caption || '')
      .replace(/#\{\{tag:\d+\}\}/g, '')
      .replace(/@\{\{[a-z]+:\d+\}\}/g, '')
      .replace(/\*\(/g, '').replace(/\)\*/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
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
          '<div class="tp-stat">',
            '<svg class="tp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">',
              '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
            '</svg> ' + (video.likes  || 0).toLocaleString('id-ID'),
          '</div>',
          '<div class="tp-stat">',
            '<svg class="tp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">',
              '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>',
              '<circle cx="12" cy="12" r="3"/>',
            '</svg> ' + (video.views  || 0).toLocaleString('id-ID'),
          '</div>',
          '<div class="tp-duration">' + formatDuration(video.duration) + '</div>',
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
        currentQuery = '';
        document.getElementById('tpSearchInput').value = '';
        tpNav(true, 'tag', '', slug);
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
    if (typeof clearVideoJsonLd === 'function') clearVideoJsonLd();
    if (typeof clearVideoMeta === 'function') clearVideoMeta();
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

      /* Update address bar — sertakan mode saat ini agar popstate bisa restore */
      history.replaceState(
        { tpMode: currentQuery ? 'search' : currentTag ? 'tag' : 'home',
          q: currentQuery || '', tag: currentTag || '' },
        '', '/tp/video/' + (data.token || id)
      );

      var thumbForSchema = data.thumbnailMd
        ? (API + '/proxy/tp/thumb?url=' + b64urlEncode(data.thumbnailMd))
        : null;
      if (typeof setVideoJsonLd === 'function') {
        setVideoJsonLd(data.title || ('Video ' + id), window.location.href, thumbForSchema, data.caption || '');
      }
      if (typeof setVideoMeta === 'function') {
        setVideoMeta(data.title || ('Video ' + id), window.location.href, thumbForSchema, data.caption || '');
      }

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

  /* ── Ad slide — full-screen slide dengan display banner 300×250 ────────
     Disisipkan setiap 5 video. Tidak di-observe ioPlay (tidak ada video).
     Setiap instance inject atOptions baru agar tidak konflik antar slide.
  ── */
  function createAdSlide() {
    var slide = document.createElement('div');
    slide.className = 'tp-slide tp-slide-ad';
    slide.setAttribute('aria-hidden', 'true');

    var body = document.createElement('div');
    body.className = 'tp-ad-body';

    var label = document.createElement('p');
    label.className = 'tp-ad-label';
    label.textContent = 'Iklan';

    var adSlot = document.createElement('div');
    adSlot.className = 'tp-ad-display';

    body.appendChild(label);
    body.appendChild(adSlot);
    slide.appendChild(body);

    /* Inject display banner (300×250) secara programatik */
    var scOpt = document.createElement('script');
    scOpt.textContent = "atOptions={'key':'d50b941ac6d9bd5749dcdb0b417bf348','format':'iframe','height':250,'width':300,'params':{}};";
    adSlot.appendChild(scOpt);
    var scInv = document.createElement('script');
    scInv.src = 'https://www.highperformanceformat.com/d50b941ac6d9bd5749dcdb0b417bf348/invoke.js';
    adSlot.appendChild(scInv);

    return slide;
  }

  /* ── "End slide" — slide penutup yang bisa di-scroll secara natural ── */
  function appendEndSlide(mode, query, trends) {
    var feed = document.getElementById('tpFeed');
    /* Jangan duplikat jika sudah ada */
    if (feed.querySelector('.tp-slide-end')) return;

    var msg = (mode === 'search' && query)
      ? 'Semua hasil untuk \u201c' + escHtml(query) + '\u201d sudah ditampilkan.'
      : 'Semua video ditampilkan. Coba kata kunci di bawah:';

    /* Chip trending searches (hanya ada di home mode) */
    var trendsHtml = '';
    if (trends && trends.length) {
      var chips = trends.map(function (r) {
        return '<button class="tp-trend-chip" data-qs="' + escHtml(r.qs) + '">' + escHtml(r.term) + '</button>';
      }).join('');
      trendsHtml = '<div class="tp-end-trends">' + chips + '</div>';
    }

    var slide = document.createElement('div');
    slide.className = 'tp-slide tp-slide-end';
    /* Bangun struktur tanpa script dulu — innerHTML tidak execute <script> */
    slide.innerHTML = [
      '<div class="tp-end-body">',
        '<div class="tp-end-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="17" y1="17" x2="22" y2="22"/></svg></div>',
        '<p class="tp-end-msg">' + msg + '</p>',
        trendsHtml,
        '<button class="tp-end-search-btn" id="tpEndSearchBtn">Atau ketik kata kunci</button>',
        /* Display banner 300×250 — native banner dipakai di sticky bottom (satu instance per halaman) */
        '<div class="tp-end-ad" id="tpEndAdSlot"></div>',
      '</div>',
    ].join('');

    feed.appendChild(slide);

    /* Inject display banner (300×250) secara programatik agar bisa execute.
       Native banner tidak dipakai di sini karena sudah ada di #tpNativeAd (sticky bottom)
       — key yang sama tidak boleh duplikat dalam satu halaman. */
    var adSlot = slide.querySelector('#tpEndAdSlot');
    if (adSlot) {
      var scOpt = document.createElement('script');
      scOpt.textContent = "atOptions={'key':'d50b941ac6d9bd5749dcdb0b417bf348','format':'iframe','height':250,'width':300,'params':{}};";
      adSlot.appendChild(scOpt);
      var scInv = document.createElement('script');
      scInv.src = 'https://www.highperformanceformat.com/d50b941ac6d9bd5749dcdb0b417bf348/invoke.js';
      adSlot.appendChild(scInv);
    }

    /* Klik chip trending search → langsung search */
    slide.querySelectorAll('.tp-trend-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var params = new URLSearchParams(chip.dataset.qs || '');
        var q = params.get('s') || '';
        if (!q) return;
        var inp = document.getElementById('tpSearchInput');
        if (inp) inp.value = q;
        resetFeed();
        currentQuery = q;
        currentTag   = '';
        tpNav(true, 'search', q, '');
        loadPosts();
      });
    });

    /* Klik tombol → fokus search input di topbar */
    var btn = slide.querySelector('#tpEndSearchBtn');
    if (btn) {
      btn.addEventListener('click', function () {
        var inp = document.getElementById('tpSearchInput');
        if (inp) { inp.focus(); inp.select(); }
        slide.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setTimeout(function () {
          feed.scrollTo({ top: 0, behavior: 'smooth' });
        }, 300);
      });
    }
  }

  /* ── Reset feed state (untuk search baru) ────────────────────── */
  function resetFeed() {
    stopActive();
    var feed = document.getElementById('tpFeed');
    /* Unobserve semua slide sebelum bersihkan DOM */
    Array.from(feed.children).forEach(function (s) {
      ioPlay.unobserve(s);
    });
    if (lastSlide) { ioEnd.unobserve(lastSlide); }
    feed.innerHTML   = '';
    currentPage      = 1;
    hasMore          = true;
    lastSlide        = null;
    totalSlidesAdded = 0;
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

      var mode = data.mode || (currentQuery ? 'search' : currentTag ? 'tag' : 'home');

      if (videos.length === 0 && feed.children.length === 0) {
        appendEndSlide(mode, currentQuery);
        return;
      }

      /* Simpan trending searches dari home mode untuk end slide */
      if (data.relatedSearches && data.relatedSearches.length) {
        cachedTrends = data.relatedSearches;
      }

      videos.forEach(function (video) {
        (video.tags || []).forEach(function (t) {
          if (t && t.slug && !seenTags.has(t.slug)) {
            seenTags.set(t.slug, t.name || t.slug);
            renderTagPanel();
          }
        });
        var slide = buildSlide(video);

        /* Unobserve lastSlide dari ioEnd sebelum diganti */
        if (lastSlide) ioEnd.unobserve(lastSlide);

        feed.appendChild(slide);
        ioPlay.observe(slide);  // Ad slide TIDAK di-observe ioPlay — hanya video slide
        lastSlide = slide;
        totalSlidesAdded++;

        /* Scroll ke slide deep-link jika ada di batch ini */
        if (deepLinkId && String(video.id) === String(deepLinkId)) {
          deepLinkId = null;
          setTimeout(function () {
            slide.scrollIntoView({ behavior: 'instant', block: 'start' });
          }, 50);
        }

        /* Sisipkan ad slide setiap 5 video — natural seperti iklan TikTok */
        if (totalSlidesAdded % 5 === 0) {
          if (lastSlide) ioEnd.unobserve(lastSlide);
          var adSlide = createAdSlide();
          feed.appendChild(adSlide);
          lastSlide = adSlide;
          // Tidak di-observe ioPlay — tidak ada video. Observe ioEnd di luar loop.
        }
      });

      /* Observe lastSlide (video atau ad slide terakhir) untuk infinite scroll */
      if (lastSlide) ioEnd.observe(lastSlide);

      if (!hasMore) {
        appendEndSlide(mode, currentQuery, cachedTrends);
      }

    } catch (err) {
      console.error('[tp] loadPosts error:', err.message);
      showToast('Gagal memuat video. Periksa koneksi internet.');
    } finally {
      isLoading = false;
      document.getElementById('tpLoader').classList.add('hidden');
    }
  }

  /* ── Kategori (tag) picker toggle ──────────────────────────────── */
  (function initTagPicker() {
    var btn   = document.getElementById('tpCatBtn');
    var panel = document.getElementById('tpCatPanel');
    if (!btn || !panel) return;
    renderTagPanel();
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var willOpen = !panel.classList.contains('open');
      btn.classList.toggle('open', willOpen);
      panel.classList.toggle('open', willOpen);
      if (willOpen) renderTagPanel();
    });
    document.addEventListener('click', function (e) {
      if (!panel.contains(e.target) && e.target !== btn) {
        btn.classList.remove('open');
        panel.classList.remove('open');
      }
    });
  })();

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
    tpNav(true, q ? 'search' : 'home', q, '');
    loadPosts();
  });

  /* Clear search → kembali ke homepage feed */
  searchInput.addEventListener('search', function () {
    if (searchInput.value === '' && currentQuery) {
      resetFeed();
      currentQuery = '';
      currentTag   = '';
      tpNav(false, 'home', '', '');
      loadPosts();
    }
  });

  /* ── Popstate: back/forward HP dalam Platform 5 ─────────────── */
  window.addEventListener('popstate', function (e) {
    var s = e.state;
    if (!s || !s.tpMode) return;
    var q   = s.q   || '';
    var tag = s.tag || '';
    searchInput.value = q;
    resetFeed();
    currentQuery = q;
    currentTag   = tag;
    loadPosts();
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

  /* ── Init: deep-link detection + initial history state ─────── */
  (function init() {
    /* Parse query-string untuk state awal (mis. shared link /tp?q=...) */
    var urlParams = new URLSearchParams(location.search);
    var initQ   = urlParams.get('q')   || '';
    var initTag = urlParams.get('tag') || '';
    if (initQ)   { currentQuery = initQ;   searchInput.value = initQ; }
    if (initTag) { currentTag   = initTag; }

    /* Set initial history entry — replaceState supaya back keluar platform saat di home */
    tpNav(false, initQ ? 'search' : initTag ? 'tag' : 'home', initQ, initTag);

    /* Deep-link: /tp/video/:id */
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
