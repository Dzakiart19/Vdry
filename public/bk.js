/* ═══════════════════════════════════════
   Vidorey 4 — Platform 4 (BokepKing)
   WP REST listing · Direct MP4 stream proxy
   Tidak ada HLS — video selalu MP4 dari vdn.bokepking.cam
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
    catId:       '',   // '' = semua kategori (numeric WP category id)
    catName:     '',
  };

  /* ── DOM refs ── */
  const $ = id => document.getElementById(id);
  const els = {
    searchForm:    $('bkSearchForm'),
    searchInput:   $('bkSearchInput'),
    searchHeading: $('bkSearchHeading'),
    grid:          $('bkGrid'),
    pagination:    $('bkPagination'),
    loading:       $('bkLoadingState'),
    error:         $('bkErrorState'),
    errorMsg:      $('bkErrorMsg'),
    empty:         $('bkEmptyState'),
    modal:         $('bkPlayerModal'),
    modalBackdrop: $('bkModalBackdrop'),
    modalClose:    $('bkModalClose'),
    modalBody:     $('bkModalBody'),
    videoTitle:    $('bkVideoTitle'),
    videoSub:      $('bkVideoSub'),
    videoEl:       $('bkVideoEl'),
    playerLoading: $('bkPlayerLoading'),
    retryBtn:      $('bkRetryBtn'),
    toast:         $('toast'),
    watchDesc:     $('bkWatchDesc'),
    watchDescText: $('bkWatchDescText'),
    relatedSection:    $('bkRelatedSection'),
    relatedGrid:       $('bkRelatedGrid'),
    relatedPagination: $('bkRelatedPagination'),
    shareBtn:      $('bkShareBtn'),
  };

  /* ── Slug video yang sedang tampil di watch view (untuk share link) ── */
  let currentSlug  = null;
  let currentToken = null;

  /* ── Player session tracking ── */
  let playerSession = 0;

  function destroyPlayer() {
    const video = els.videoEl;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.classList.add('hidden');
    }
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
    ['loading', 'error', 'empty'].forEach(k => {
      els[k].classList.toggle('hidden', k !== which);
    });
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
        `<button class="rb-search-clear" id="bkSearchClear">${_t('heading.clearSearch')}</button>`
      : `${_t('heading.cat')}: <strong>${escHtml(cat)}</strong>` +
        `<button class="rb-search-clear" id="bkSearchClear">${_t('heading.clearSearch')}</button>`;
    document.getElementById('bkSearchClear').addEventListener('click', () => {
      state.searchQuery = '';
      state.catId = '';
      state.catName = '';
      state.page = 1;
      els.searchInput.value = '';
      updateSearchHeading();
      loadPosts(true);
    });
  }

  /* ── Kategori picker ── */
  if (window.initVdryCategoryPicker && document.getElementById('bkCatBtn')) {
    initVdryCategoryPicker({
      button:      document.getElementById('bkCatBtn'),
      panel:       document.getElementById('bkCatPanel'),
      apiPath:     `${API}/api/bk/categories`,
      getActiveId: () => state.catId,
      onSelect: (item) => {
        state.searchQuery = '';
        els.searchInput.value = '';
        state.catId   = item ? String(item.id) : '';
        state.catName = item ? item.name : '';
        state.page = 1;
        loadPosts(true);
      },
    });
  }

  /* ── History helpers ── */
  function saveNav(push) {
    const s = { bkPage: state.page, bkQ: state.searchQuery, bkCat: state.catId, bkCatName: state.catName };
    if (push) {
      history.pushState(s, '', '/bk');
    } else {
      history.replaceState(s, '', '/bk');
    }
  }

  /* ── Load posts ── */
  async function loadPosts(pushNav = false) {
    if (state.loading) return;
    state.loading = true;
    showState('loading');
    updateSearchHeading();
    saveNav(pushNav);

    const q    = state.searchQuery;
    const page = state.page;
    let qs = `p=${page}`;
    if (q) qs += `&q=${encodeURIComponent(q)}`;
    else if (state.catId) qs += `&cat=${encodeURIComponent(state.catId)}`;

    try {
      const data = await apiFetch(`/api/bk/posts?${qs}`);
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
      const thumb = rawThumb
        ? `${API}/proxy/bk/thumb?url=${encodeURIComponent(rawThumb)}`
        : '';
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
    [8, 16].forEach(pos => {
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
          loadPosts(true);
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
    loadPosts(true);
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
      const thumb = rawThumb ? `${API}/proxy/bk/thumb?url=${encodeURIComponent(rawThumb)}` : '';
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
     bkModal) — entry history-nya SUDAH ada, jangan push/replace lagi. */
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
    destroyPlayer();
    if (opts.fromHistory) {
      els.modal.classList.remove('hidden');
      document.body.classList.add('modal-open');
    } else {
      openModal(slug);
    }
    if (els.modalBody) els.modalBody.scrollTop = 0;

    try {
      const data = await apiFetch(`/api/bk/video/${encodeURIComponent(slug)}`);
      if (session !== playerSession) return;

      if (data.token) {
        currentToken = data.token;
        history.replaceState({ bkModal: true, bkSlug: slug }, '', `/bk/watch/${data.token}`);
      }
      els.videoTitle.textContent = data.title || slug;
      if (typeof setVideoJsonLd === 'function') setVideoJsonLd(data.title || slug, window.location.href, null, data.description || '');
      if (typeof setVideoMeta === 'function') setVideoMeta(data.title || slug, window.location.href, null, data.description || '');
      renderWatchDesc(data.description || '');
      renderRelated(data.related || []);
      playMp4(`${API}${data.mp4Url}`, session);
    } catch (e) {
      if (session !== playerSession) return;
      console.error('openPlayer:', e.message);
      els.playerLoading.classList.add('hidden');
      els.videoTitle.textContent = _t('err.video.title');
      showToast(_t('err.video'));
    }
  }

  /* ── MP4 playback (direct, tanpa HLS) ── */
  function playMp4(proxyUrl, session) {
    const video = els.videoEl;

    // ⚠️ MOBILE FIX: tampilkan <video> SEBELUM set src.
    // Kalau video masih display:none saat src di-set, Android Chrome tidak
    // mengalokasikan GPU surface → audio jalan tapi video hitam.
    // bk-player-loader (z-index:2, background solid) tetap menutupinya selama buffering.
    video.classList.remove('hidden');

    const onReady = () => {
      if (session !== playerSession) return;
      els.playerLoading.classList.add('hidden');
      if (session === playerSession) video.play().catch(() => {});
    };

    const onError = () => {
      if (session !== playerSession) return;
      destroyPlayer();
      els.playerLoading.classList.add('hidden');
      showToast(_t('err.video'));
    };

    video.addEventListener('loadedmetadata', onReady, { once: true });
    video.addEventListener('error',          onError, { once: true });

    video.src = proxyUrl;
    video.load();
  }

  /* ── Modal controls ── */
  // Flag: apakah kita sudah push history state untuk modal ini
  let modalHistoryPushed = false;

  function openModal(slug) {
    // URL /bk/watch/<slug> — supaya address bar jadi link yang bisa langsung
    // dibagikan (tombol Share) dan membuka video yang sama saat diakses ulang.
    const url = slug ? `/bk/watch/${encodeSlug(slug)}` : '/bk/watch';

    if (!els.modal.classList.contains('hidden')) {
      // Modal SUDAH terbuka (mis. klik video related di dalam watch view) —
      // jangan push history entry baru, cukup ganti URL entry yang sama
      // supaya link di address bar tetap ikut video yang sedang tampil.
      if (modalHistoryPushed) history.replaceState({ bkModal: true, bkSlug: slug }, '', url);
      return;
    }

    els.modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    // Push state BERBEDA (/bk/watch/<slug>) supaya browser bisa membedakannya dari /bk biasa.
    // Ini penting karena history.back() dari dua URL /bk yang identik bisa melewati
    // keduanya sekaligus dan mendarat di P1 (/) — masalah Chrome/Safari.
    history.pushState({ bkModal: true, bkSlug: slug }, '', url);
    modalHistoryPushed = true;
  }

  function _doCloseModal() {
    destroyPlayer();
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
      // replaceState (BUKAN history.back()) — ganti entry modal dengan /bk bersih.
      history.replaceState(null, '', '/bk');
    }
  }

  // Tangkap tombol Back/Forward browser
  window.addEventListener('popstate', e => {
    const s = e.state;

    if (!els.modal.classList.contains('hidden')) {
      // User menekan Back saat modal terbuka → tutup modal saja, tetap di /bk
      modalHistoryPushed = false;
      currentSlug  = null;
      currentToken = null;
      _doCloseModal();
      history.replaceState(s || null, '', '/bk');
      return;
    }

    // User menekan Forward ke entry watch-view (mis. setelah Back dari modal) →
    // buka lagi modal untuk slug itu, JANGAN push entry baru (sudah ada di history).
    if (s && s.bkModal && s.bkSlug) {
      modalHistoryPushed = true; // entry-nya sudah ada di history, tidak perlu push lagi
      openPlayer(s.bkSlug, { fromHistory: true });
      return;
    }

    // Modal tertutup: restore halaman/search dari history state
    if (s && typeof s.bkPage !== 'undefined') {
      state.page        = s.bkPage || 1;
      state.searchQuery = s.bkQ    || '';
      state.catId        = s.bkCat     || '';
      state.catName      = s.bkCatName || '';
      els.searchInput.value = state.searchQuery;
      loadPosts(false); // false = jangan push lagi (sudah ada di history)
    }
  });

  els.modalClose.addEventListener('click', closeModal);
  els.modalBackdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !els.modal.classList.contains('hidden')) closeModal();
  });

  /* ── Share ── */
  if (els.shareBtn) {
    els.shareBtn.addEventListener('click', async () => {
      if (!currentSlug) return;
      const shareUrl   = `${location.origin}/bk/watch/${currentToken || encodeSlug(currentSlug)}`;
      const shareTitle = els.videoTitle.textContent || 'Vidorey';

      if (navigator.share) {
        try {
          await navigator.share({ title: shareTitle, url: shareUrl });
        } catch (e) {
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
  // saveNav() yang langsung replaceState() ke '/bk', jadi location.pathname
  // sudah berubah kalau dibaca SESUDAH loadPosts() jalan.
  const deepLinkMatch = location.pathname.match(/^\/bk\/watch\/([^/]+)\/?$/);

  loadPosts(false);

  // Deep-link: kalau URL-nya /bk/watch/<slug> (dari link Share), langsung
  // buka watch view video itu di atas listing yang baru saja dimuat.
  if (deepLinkMatch) {
    const segment = deepLinkMatch[1];
    if (/^[a-z0-9]{11}$/.test(segment)) {
      // Short token (11 char) — resolve server-side
      apiFetch(`/api/s/bk/${segment}`)
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
