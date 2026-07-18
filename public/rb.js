/* ═══════════════════════════════════════
   Vidorey 2 — Platform 2
   No sidebar · No categories · With search
═══════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Slug encode/decode (acak URL, judul tidak terlihat di address bar) ── */
  // UTF-8-safe base64url: TextEncoder → binary → btoa, kebalikannya saat decode.
  function encodeSlug(s) {
    try {
      const bytes = new TextEncoder().encode(s);
      let bin = '';
      bytes.forEach(b => { bin += String.fromCharCode(b); });
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch { return encodeURIComponent(s); } // fallback graceful
  }
  function decodeSlug(t) {
    try {
      const pad = t.length % 4;
      const bin = atob((pad ? t + '='.repeat(4 - pad) : t).replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      return new TextDecoder().decode(bytes) || null;
    } catch { return null; }
  }

  /* ── Config ── */
  const API = (typeof BACKEND_URL !== 'undefined' ? BACKEND_URL : '');

  /* ── State ── */
  const state = {
    page:        1,
    totalPages:  1,
    loading:     false,
    searchQuery: '',   // '' = homepage listing
    catId:       '',   // '' = semua kategori
    catName:     '',
  };

  /* ── DOM refs ── */
  const $ = id => document.getElementById(id);
  const els = {
    searchForm:    $('rbSearchForm'),
    searchInput:   $('rbSearchInput'),
    searchHeading: $('rbSearchHeading'),
    grid:          $('rbGrid'),
    pagination:    $('rbPagination'),
    loading:       $('rbLoadingState'),
    error:         $('rbErrorState'),
    errorMsg:      $('rbErrorMsg'),
    empty:         $('rbEmptyState'),
    modal:         $('rbPlayerModal'),
    modalBackdrop: $('rbModalBackdrop'),
    modalClose:    $('rbModalClose'),
    modalBody:     $('rbModalBody'),
    videoTitle:    $('rbVideoTitle'),
    videoSub:      $('rbVideoSub'),
    videoEl:       $('rbVideoEl'),
    videoFrame:    $('rbVideoFrame'),
    playerLoading: $('rbPlayerLoading'),
    retryBtn:      $('rbRetryBtn'),
    toast:         $('toast'),
    watchDesc:     $('rbWatchDesc'),
    watchDescText: $('rbWatchDescText'),
    relatedSection:    $('rbRelatedSection'),
    relatedGrid:       $('rbRelatedGrid'),
    relatedPagination: $('rbRelatedPagination'),
    shareBtn:      $('rbShareBtn'),
  };

  /* ── Slug video yang sedang tampil di watch view (untuk share link) ── */
  let currentSlug  = null;
  let currentToken = null;

  /* ── Player session tracking ── */
  let hlsInstance   = null;
  let playerSession = 0;

  function destroyHls() {
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    if (els.videoEl) {
      els.videoEl.pause();
      els.videoEl.removeAttribute('src');
      els.videoEl.load();
      els.videoEl.classList.add('hidden');
    }
    els.videoFrame.src = '';
    els.videoFrame.classList.add('hidden');
  }

  /* ── Toast ── */
  let toastTimer;
  function showToast(msg) {
    clearTimeout(toastTimer);
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3200);
  }

  /* ── State views ── */
  function showState(which) {
    ['loading','error','empty'].forEach(k => {
      els[k].classList.toggle('hidden', k !== which);
    });
    // Only clear grid when starting a fresh load — not on error/empty
    if (which === 'loading') els.grid.innerHTML = '';
    if (which !== 'error')   els.pagination.classList.add('hidden');
  }

  function hideStates() {
    els.loading.classList.add('hidden');
    els.error.classList.add('hidden');
    els.empty.classList.add('hidden');
  }

  /* ── fetch() dengan timeout 15 detik ── */
  function fetchWithTimeout(url, ms = 15000) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(tid));
  }

  /* ── Fetch helper ── */
  async function apiFetch(path) {
    const r = await fetchWithTimeout(`${API}${path}`);
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${r.status}`);
    }
    return r.json();
  }

  /* ── Search / kategori heading ── */
  function updateSearchHeading() {
    const q = state.searchQuery;
    const cat = state.catName;
    if (!q && !cat) {
      els.searchHeading.classList.remove('visible');
      els.searchHeading.innerHTML = '';
      return;
    }
    els.searchHeading.classList.add('visible');
    els.searchHeading.innerHTML = q
      ? `${_t('heading.search')}: <strong>"${escHtml(q)}"</strong>` +
        `<button class="rb-search-clear" id="rbSearchClear">${_t('heading.clearSearch')}</button>`
      : `${_t('heading.cat')}: <strong>${escHtml(cat)}</strong>` +
        `<button class="rb-search-clear" id="rbSearchClear">${_t('heading.clearSearch')}</button>`;
    document.getElementById('rbSearchClear').addEventListener('click', () => {
      state.searchQuery = '';
      state.catId = '';
      state.catName = '';
      state.page = 1;
      els.searchInput.value = '';
      updateSearchHeading();
      loadPosts(true); // push → Back bisa kembali ke hasil sebelum clear
    });
  }

  /* ── Kategori picker ── */
  if (window.initVdryCategoryPicker && document.getElementById('rbCatBtn')) {
    initVdryCategoryPicker({
      button:      document.getElementById('rbCatBtn'),
      panel:       document.getElementById('rbCatPanel'),
      apiPath:     `${API}/api/rb/categories`,
      getActiveId: () => state.catId,
      onSelect: (item) => {
        state.searchQuery = '';
        els.searchInput.value = '';
        state.catId   = item ? item.slug : '';
        state.catName = item ? item.name : '';
        state.page = 1;
        loadPosts(true);
      },
    });
  }

  /* ── History helpers untuk pagination & search ── */
  // pushNav = true  → user action (pagination/search) → push ke history stack
  // pushNav = false → restore from popstate / init → tidak push (hindari duplikasi)
  function saveNav(push) {
    const s = { rbPage: state.page, rbQ: state.searchQuery, rbCat: state.catId, rbCatName: state.catName };
    if (push) {
      history.pushState(s, '', '/rb');
    } else {
      history.replaceState(s, '', '/rb');
    }
  }

  /* ── Load posts ── */
  async function loadPosts(pushNav = false) {
    if (state.loading) return;
    state.loading = true;
    showState('loading');
    updateSearchHeading();
    saveNav(pushNav); // simpan state ke history SEBELUM fetch

    const q    = state.searchQuery;
    const page = state.page;
    let qs = `p=${page}`;
    if (q) qs += `&q=${encodeURIComponent(q)}`;
    else if (state.catId) qs += `&cat=${encodeURIComponent(state.catId)}`;

    try {
      const data = await apiFetch(`/api/rb/posts?${qs}`);
      state.totalPages = data.totalPages || 1;

      hideStates();

      if (!data.posts || !data.posts.length) {
        showState('empty');
        return;
      }

      renderPosts(data.posts);
      renderPagination();
    } catch (e) {
      console.error('loadPosts:', e.message);
      els.errorMsg.textContent = _t('err.content');
      showState('error');
    } finally {
      state.loading = false;
    }
  }

  /* ── Helper: inline 300×250 ad di tengah grid ── */
  function createInlineAd() {
    const wrap = document.createElement('div');
    wrap.className = 'ad-inline-grid';
    const s1 = document.createElement('script');
    s1.text = "atOptions={'key':'d50b941ac6d9bd5749dcdb0b417bf348','format':'iframe','height':250,'width':300,'params':{}};";
    const s2 = document.createElement('script');
    s2.src = 'https://www.highperformanceformat.com/d50b941ac6d9bd5749dcdb0b417bf348/invoke.js';
    wrap.appendChild(s1);
    wrap.appendChild(s2);
    return wrap;
  }

  /* ── Render post grid ── */
  function renderPosts(posts) {
    els.grid.innerHTML = posts.map(p => {
      const rawThumb = p.thumb || '';
      const thumb = rawThumb ? `${API}/proxy/rb/thumb?url=${encodeURIComponent(rawThumb)}` : '';
      const title = escHtml(p.title);
      const slug  = escHtml(p.slug);

      return `<div class="rb-card" data-slug="${slug}" tabindex="0" role="button" aria-label="${title}">
        <div class="rb-card-thumb">
          ${thumb
            ? `<img src="${thumb}" alt="${title}" loading="lazy" decoding="async" onerror="this.parentElement.classList.add('rb-thumb-err')" />`
            : ''}
          <div class="rb-card-overlay">
            <svg class="rb-play-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
        </div>
        <div class="rb-card-info">
          <p class="rb-card-title" title="${title}">${title}</p>
        </div>
      </div>`;
    }).join('');

    els.grid.querySelectorAll('.rb-card').forEach(card => {
      card.addEventListener('click', () => openPlayer(card.dataset.slug));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') openPlayer(card.dataset.slug);
      });
    });

    const cardEls = [...els.grid.querySelectorAll('.rb-card')];
    [8, 16, 24].forEach(pos => {
      if (cardEls[pos - 1]) cardEls[pos - 1].insertAdjacentElement('afterend', createInlineAd());
    });
  }

  /* ── Pagination ── */
  function renderPagination() {
    const total = state.totalPages;
    const cur   = state.page;

    if (total <= 1) { els.pagination.classList.add('hidden'); return; }

    const pages = buildPageList(cur, total);
    let html = '';

    if (cur > 1) {
      html += `<button type="button" class="page-btn page-prev" data-page="${cur - 1}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>`;
    }

    pages.forEach(p => {
      if (p === '…') {
        html += `<span class="page-ellipsis">…</span>`;
      } else {
        html += `<button type="button" class="page-btn ${p === cur ? 'active' : ''}" data-page="${p}">${p}</button>`;
      }
    });

    if (cur < total) {
      html += `<button type="button" class="page-btn page-next" data-page="${cur + 1}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>`;
    }

    // Last button (jika tidak ada di buildPageList)
    if (cur < total - 1 && pages[pages.length - 1] !== total) {
      html += `<button type="button" class="page-btn" data-page="${total}">Last</button>`;
    }

    els.pagination.innerHTML = html;
    els.pagination.classList.remove('hidden');

    els.pagination.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.page);
        if (p !== state.page) {
          state.page = p;
          loadPosts(true); // push ke history → Back HP kembali ke halaman sebelumnya
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  }

  function buildPageList(cur, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = new Set([1, 2, cur - 1, cur, cur + 1, total - 1, total].filter(p => p >= 1 && p <= total));
    const sorted = [...pages].sort((a, b) => a - b);
    const result = [];
    sorted.forEach((p, i) => {
      if (i > 0 && p - sorted[i - 1] > 1) result.push('…');
      result.push(p);
    });
    return result;
  }

  /* ── Search form ── */
  els.searchForm.addEventListener('submit', e => {
    e.preventDefault();
    const q = els.searchInput.value.trim();
    if (q === state.searchQuery) return;
    state.searchQuery = q;
    state.page = 1;
    loadPosts(true); // push → Back bisa kembali ke hasil sebelum search
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* ── Related videos (gaya XNXX: grid + pagination client-side) ── */
  const RELATED_PAGE_SIZE = 8;
  let relatedState = { items: [], page: 1 };

  function renderWatchDesc(description) {
    if (!description) {
      els.watchDesc.classList.add('hidden');
      els.watchDescText.textContent = '';
      return;
    }
    els.watchDescText.textContent = description;
    els.watchDesc.classList.remove('hidden');
  }

  function renderRelated(items) {
    relatedState = { items: items || [], page: 1 };
    if (!relatedState.items.length) {
      els.relatedGrid.innerHTML = '';
      els.relatedPagination.classList.add('hidden');
      els.relatedSection.classList.add('hidden');
      return;
    }
    els.relatedSection.classList.remove('hidden');
    renderRelatedPage();
  }

  function renderRelatedPage() {
    const { items, page } = relatedState;
    const totalPages = Math.max(1, Math.ceil(items.length / RELATED_PAGE_SIZE));
    const start = (page - 1) * RELATED_PAGE_SIZE;
    const pageItems = items.slice(start, start + RELATED_PAGE_SIZE);

    els.relatedGrid.innerHTML = pageItems.map(p => {
      const rawThumb = p.thumb || '';
      const thumb = rawThumb ? `${API}/proxy/rb/thumb?url=${encodeURIComponent(rawThumb)}` : '';
      const title = escHtml(p.title);
      const slug  = escHtml(p.slug);
      const duration = p.duration ? `<span class="rb-card-duration">${escHtml(p.duration)}</span>` : '';

      return `<div class="rb-card" data-slug="${slug}" tabindex="0" role="button" aria-label="${title}">
        <div class="rb-card-thumb">
          ${thumb
            ? `<img src="${thumb}" alt="${title}" loading="lazy" decoding="async" onerror="this.parentElement.classList.add('rb-thumb-err')" />`
            : ''}
          ${duration}
          <div class="rb-card-overlay">
            <svg class="rb-play-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
        </div>
        <div class="rb-card-info">
          <p class="rb-card-title" title="${title}">${title}</p>
        </div>
      </div>`;
    }).join('');

    els.relatedGrid.querySelectorAll('.rb-card').forEach(card => {
      card.addEventListener('click', () => openPlayer(card.dataset.slug));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') openPlayer(card.dataset.slug);
      });
    });

    renderRelatedPagination(page, totalPages);
  }

  function renderRelatedPagination(cur, total) {
    if (total <= 1) { els.relatedPagination.classList.add('hidden'); return; }

    const pages = buildPageList(cur, total);
    let html = '';

    if (cur > 1) html += `<button type="button" class="page-btn page-prev" data-page="${cur - 1}">‹</button>`;
    pages.forEach(p => {
      html += p === '…'
        ? `<span class="page-ellipsis">…</span>`
        : `<button type="button" class="page-btn ${p === cur ? 'active' : ''}" data-page="${p}">${p}</button>`;
    });
    if (cur < total) html += `<button type="button" class="page-btn page-next" data-page="${cur + 1}">›</button>`;

    els.relatedPagination.innerHTML = html;
    els.relatedPagination.classList.remove('hidden');

    els.relatedPagination.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.page);
        if (p !== relatedState.page) {
          relatedState.page = p;
          renderRelatedPage();
          els.relatedSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  /* ── Open player modal (watch view: player + info + related) ──
     opts.fromHistory = true → dipanggil dari popstate (Forward ke entry
     rbModal) — entry history-nya SUDAH ada, jangan push/replace lagi. */
  async function openPlayer(slug, opts = {}) {
    const session = ++playerSession;
    currentSlug  = slug;
    currentToken = null;

    els.videoTitle.textContent = 'Memuat…';
    els.playerLoading.classList.remove('hidden');
    if (typeof clearVideoJsonLd === 'function') clearVideoJsonLd();
    if (typeof clearVideoMeta === 'function') clearVideoMeta();
    renderWatchDesc('');
    renderRelated([]);
    destroyHls();
    if (opts.fromHistory) {
      els.modal.classList.remove('hidden');
      document.body.classList.add('modal-open');
    } else {
      openModal(slug);
    }
    if (els.modalBody) els.modalBody.scrollTop = 0;

    try {
      const data = await apiFetch(`/api/rb/video/${encodeURIComponent(slug)}`);
      if (session !== playerSession) return;

      if (data.token) {
        currentToken = data.token;
        history.replaceState({ rbModal: true, rbSlug: slug }, '', `/rb/watch/${data.token}`);
      }
      els.videoTitle.textContent = data.title || slug;
      if (typeof setVideoJsonLd === 'function') setVideoJsonLd(data.title || slug, window.location.href, null, data.description || '');
      if (typeof setVideoMeta === 'function') setVideoMeta(data.title || slug, window.location.href, null, data.description || '');
      renderWatchDesc(data.description || '');
      renderRelated(data.related || []);

      if (data.m3u8Url) {
        playHls(API + data.m3u8Url, slug);
      } else {
        throw new Error('Sumber video tidak ditemukan');
      }
    } catch (e) {
      if (session !== playerSession) return;
      console.error('openPlayer:', e.message);
      els.playerLoading.classList.add('hidden');
      els.videoTitle.textContent = _t('err.video.title');
      showToast(_t('err.video'));
    }
  }

  /* ── HLS playback ── */
  function playHls(m3u8Url, slug) {
    const video   = els.videoEl;
    const session = playerSession;

    // ⚠️ MOBILE FIX: tampilkan <video> SEBELUM attachMedia.
    // Kalau video masih display:none saat HLS attach, Android Chrome tidak
    // mengalokasikan GPU surface → audio jalan tapi video hitam.
    // rb-player-loader (z-index:2, background solid) tetap menutupinya selama buffering.
    video.classList.remove('hidden');

    const onReady = () => {
      if (session !== playerSession) return;
      els.playerLoading.classList.add('hidden');
      if (session === playerSession) video.play().catch(() => {});
    };

    const onFatalError = () => {
      if (session !== playerSession) return;
      destroyHls(); // destroyHls sudah tambahkan .hidden ke video
      els.playerLoading.classList.add('hidden');
      showToast(_t('err.stream'));
    };

    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: false, startLevel: -1 });
      hlsInstance = hls;
      hls.loadSource(m3u8Url);
      hls.attachMedia(video); // video sudah visible → GPU surface dialokasikan
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        netRetries = 0;
        mediaRetries = 0;
        onReady();
      });

      // Error transient (network hiccup / buffer stall) jangan langsung nyerah —
      // coba recovery standar hls.js dulu sebelum benar-benar fatal ke user.
      let netRetries = 0;
      let mediaRetries = 0;
      const MAX_RETRIES = 3;
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (session !== playerSession) return;
        if (!d.fatal) return;
        switch (d.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            if (netRetries < MAX_RETRIES) {
              netRetries++;
              setTimeout(() => { if (session === playerSession) hls.startLoad(); }, 500 * netRetries);
            } else {
              onFatalError();
            }
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            if (mediaRetries < MAX_RETRIES) {
              mediaRetries++;
              hls.recoverMediaError();
            } else {
              onFatalError();
            }
            break;
          default:
            onFatalError();
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari / iOS)
      video.src = m3u8Url;
      video.addEventListener('loadedmetadata', onReady,      { once: true });
      video.addEventListener('error',          onFatalError, { once: true });
    } else {
      video.classList.add('hidden');
      els.playerLoading.classList.add('hidden');
      showToast(_t('err.hls'));
    }
  }

  /* ── Modal controls ── */
  // Flag: apakah kita sudah push history state untuk modal ini
  let modalHistoryPushed = false;

  function openModal(slug) {
    // URL /rb/watch/<slug> — supaya address bar jadi link yang bisa langsung
    // dibagikan (tombol Share) dan membuka video yang sama saat diakses ulang.
    const url = slug ? `/rb/watch/${encodeSlug(slug)}` : '/rb/watch';

    if (!els.modal.classList.contains('hidden')) {
      // Modal SUDAH terbuka (mis. klik video related di dalam watch view) —
      // jangan push history entry baru, cukup ganti URL entry yang sama
      // supaya link di address bar tetap ikut video yang sedang tampil.
      if (modalHistoryPushed) history.replaceState({ rbModal: true, rbSlug: slug }, '', url);
      return;
    }

    if (window.VdryAds) VdryAds.triggerPopunder();
    els.modal.classList.remove('hidden');
    if (window.VdryAds) VdryAds.reloadModalAds(els.modal);
    document.body.classList.add('modal-open');
    // Push state BERBEDA (/rb/watch/<slug>) supaya browser bisa membedakannya dari /rb biasa.
    // Ini penting karena history.back() dari dua URL /rb yang identik bisa melewati
    // keduanya sekaligus dan mendarat di P1 (/) — masalah Chrome/Safari.
    history.pushState({ rbModal: true, rbSlug: slug }, '', url);
    modalHistoryPushed = true;
  }

  function _doCloseModal() {
    destroyHls();
    els.playerLoading.classList.remove('hidden');
    els.modal.classList.add('hidden');
    document.body.classList.remove('modal-open');
  }

  function closeModal() {
    _doCloseModal();
    currentSlug  = null;
    currentToken = null;

    if (modalHistoryPushed) {
      modalHistoryPushed = false;
      // replaceState (BUKAN history.back()) — ganti entry modal dengan /rb bersih.
      // history.back() berbahaya: jika browser menggabungkan dua entry /rb yang sama,
      // back() langsung ke / (Platform 1). replaceState tidak memicu navigasi sama sekali.
      history.replaceState(null, '', '/rb');
    }
  }

  // Tangkap tombol Back/Forward browser
  window.addEventListener('popstate', e => {
    const s = e.state;

    if (!els.modal.classList.contains('hidden')) {
      // User menekan Back saat modal terbuka → tutup modal saja, tetap di /rb
      modalHistoryPushed = false;
      currentSlug  = null;
      currentToken = null;
      _doCloseModal();
      history.replaceState(s || null, '', '/rb');
      return;
    }

    // User menekan Forward ke entry watch-view (mis. setelah Back dari modal) →
    // buka lagi modal untuk slug itu, JANGAN push entry baru (sudah ada di history).
    if (s && s.rbModal && s.rbSlug) {
      modalHistoryPushed = true; // entry-nya sudah ada di history, tidak perlu push lagi
      openPlayer(s.rbSlug, { fromHistory: true });
      return;
    }

    // Modal tertutup: restore halaman/search dari history state
    if (s && typeof s.rbPage !== 'undefined') {
      // Ada state Vidorey 2 → muat ulang halaman/search yang disimpan
      state.page        = s.rbPage  || 1;
      state.searchQuery = s.rbQ     || '';
      state.catId        = s.rbCat     || '';
      state.catName      = s.rbCatName || '';
      els.searchInput.value = state.searchQuery;
      loadPosts(false); // false = jangan push lagi (sudah ada di history)
    }
    // Jika tidak ada state rbPage sama sekali (misal entry paling awal), biarkan
    // browser melanjutkan navigasinya secara alami ke halaman sebelumnya.
  });

  els.modalClose.addEventListener('click', closeModal);
  els.modalBackdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !els.modal.classList.contains('hidden')) closeModal();
  });

  /* ── Share ── */
  // navigator.share() (mobile Chrome/Safari) kalau tersedia, kalau tidak
  // fallback ke copy-to-clipboard. Link-nya /rb/watch/<slug> — link ini
  // sendiri yang di-deep-link balik oleh init() di bawah.
  if (els.shareBtn) {
    els.shareBtn.addEventListener('click', async () => {
      if (!currentSlug) return;
      const shareUrl   = `${location.origin}/rb/watch/${currentToken || encodeSlug(currentSlug)}`;
      const shareTitle = els.videoTitle.textContent || 'Vidorey';

      if (navigator.share) {
        try {
          await navigator.share({ title: shareTitle, url: shareUrl });
        } catch (e) {
          // AbortError = user membatalkan share sheet — bukan error, diamkan saja
          if (e.name !== 'AbortError') showToast(_t('toast.noShare'));
        }
        return;
      }

      try {
        await navigator.clipboard.writeText(shareUrl);
        showToast(_t('toast.copied'));
      } catch {
        showToast(shareUrl);
      }
    });
  }

  /* ── Retry ── */
  els.retryBtn.addEventListener('click', () => loadPosts(false));

  /* ── Escape helper ── */
  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ── Init ── */
  // Tangkap path SEBELUM loadPosts() dipanggil — loadPosts() memanggil
  // saveNav() yang langsung replaceState() ke '/rb', jadi location.pathname
  // sudah berubah kalau dibaca SESUDAH loadPosts() jalan.
  const deepLinkMatch = location.pathname.match(/^\/rb\/watch\/([^/]+)\/?$/);

  // replaceState (bukan push) agar entry pertama punya state yang bisa di-restore
  loadPosts(false);
  if (window.VdryAds) VdryAds.initVideoOverlay('rb');
  if (window.VdryAds) VdryAds.initVideoTap('rb');

  // Deep-link: kalau URL-nya /rb/watch/<slug> (dari link Share), langsung
  // buka watch view video itu di atas listing yang baru saja dimuat.
  if (deepLinkMatch) {
    const segment = deepLinkMatch[1];
    if (/^[a-z0-9]{11}$/.test(segment)) {
      // Short token (11 char) — resolve server-side
      apiFetch(`/api/s/rb/${segment}`)
        .then(d => { if (d?.slug) { modalHistoryPushed = false; openPlayer(d.slug); } })
        .catch(() => {/* token expired / tidak ditemukan — abaikan deep-link */});
    } else {
      // Legacy: base64-encoded slug (link lama)
      const slug = decodeSlug(segment);
      if (slug) { modalHistoryPushed = false; openPlayer(slug); }
    }
  }

  /* ── Language change: re-render dynamic text ── */
  window.addEventListener('langchange', function () {
    updateSearchHeading();
  });

})();
