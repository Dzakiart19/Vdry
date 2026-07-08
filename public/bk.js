/* ═══════════════════════════════════════
   Vidorey 4 — Platform 4 (BokepKing)
   WP REST listing · Direct MP4 stream proxy
   Tidak ada HLS — video selalu MP4 dari vdn.bokepking.cam
═══════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Config ── */
  const API = (typeof BACKEND_URL !== 'undefined' ? BACKEND_URL : '');

  /* ── State ── */
  const state = {
    page:        1,
    totalPages:  1,
    loading:     false,
    searchQuery: '',   // '' = homepage listing
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
    videoTitle:    $('bkVideoTitle'),
    videoSub:      $('bkVideoSub'),
    videoEl:       $('bkVideoEl'),
    playerLoading: $('bkPlayerLoading'),
    retryBtn:      $('bkRetryBtn'),
    toast:         $('toast'),
  };

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

  /* ── Search heading ── */
  function updateSearchHeading() {
    const q = state.searchQuery;
    if (!q) {
      els.searchHeading.classList.remove('visible');
      els.searchHeading.innerHTML = '';
      return;
    }
    els.searchHeading.classList.add('visible');
    els.searchHeading.innerHTML =
      `Hasil pencarian untuk <strong>"${escHtml(q)}"</strong>` +
      `<button class="rb-search-clear" id="bkSearchClear">✕ Hapus</button>`;
    document.getElementById('bkSearchClear').addEventListener('click', () => {
      state.searchQuery = '';
      state.page = 1;
      els.searchInput.value = '';
      updateSearchHeading();
      loadPosts(true);
    });
  }

  /* ── History helpers ── */
  function saveNav(push) {
    const s = { bkPage: state.page, bkQ: state.searchQuery };
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
      els.errorMsg.textContent = 'Gagal memuat konten. Periksa koneksi internet atau coba lagi.';
      showState('error');
    } finally {
      state.loading = false;
    }
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

  /* ── Open player modal ── */
  async function openPlayer(slug) {
    const session = ++playerSession;

    els.videoTitle.textContent = 'Memuat…';
    els.videoSub.textContent   = 'Vidorey 4';
    els.playerLoading.classList.remove('hidden');
    destroyPlayer();
    openModal();

    try {
      const data = await apiFetch(`/api/bk/video/${encodeURIComponent(slug)}`);
      if (session !== playerSession) return;

      els.videoTitle.textContent = data.title || slug;
      playMp4(`${API}${data.mp4Url}`, session);
    } catch (e) {
      if (session !== playerSession) return;
      console.error('openPlayer:', e.message);
      els.playerLoading.classList.add('hidden');
      els.videoTitle.textContent = 'Gagal memuat video';
      showToast('Gagal memuat video. Periksa koneksi internet atau coba lagi.');
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
      video.play().catch(() => {});
    };

    const onError = () => {
      if (session !== playerSession) return;
      destroyPlayer();
      els.playerLoading.classList.add('hidden');
      showToast('Gagal memuat video. Periksa koneksi internet atau coba lagi.');
    };

    video.addEventListener('loadedmetadata', onReady, { once: true });
    video.addEventListener('error',          onError, { once: true });

    video.src = proxyUrl;
    video.load();
  }

  /* ── Modal controls ── */
  let modalHistoryPushed = false;

  function openModal() {
    els.modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    // Push state /bk#player supaya Back HP menutup modal, bukan keluar halaman.
    // Pola identik dengan rb.js dan yb.js.
    history.pushState({ bkModal: true }, '', '/bk#player');
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
    if (modalHistoryPushed) {
      modalHistoryPushed = false;
      // replaceState (BUKAN history.back()) — ganti entry modal dengan /bk bersih.
      history.replaceState(null, '', '/bk');
    }
  }

  // Tangkap tombol Back/Forward browser
  window.addEventListener('popstate', e => {
    if (!els.modal.classList.contains('hidden')) {
      modalHistoryPushed = false;
      _doCloseModal();
      history.replaceState(e.state || null, '', '/bk');
      return;
    }

    const s = e.state;
    if (s && typeof s.bkPage !== 'undefined') {
      state.page        = s.bkPage || 1;
      state.searchQuery = s.bkQ    || '';
      els.searchInput.value = state.searchQuery;
      loadPosts(false);
    }
  });

  els.modalClose.addEventListener('click', closeModal);
  els.modalBackdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !els.modal.classList.contains('hidden')) closeModal();
  });

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
  loadPosts(false);

})();
