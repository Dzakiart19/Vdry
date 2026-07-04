/* ═══════════════════════════════════════
   Vidorey 2 — Platform 2
   No sidebar · No categories · With search
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
    videoTitle:    $('rbVideoTitle'),
    videoSub:      $('rbVideoSub'),
    videoEl:       $('rbVideoEl'),
    videoFrame:    $('rbVideoFrame'),
    playerLoading: $('rbPlayerLoading'),
    retryBtn:      $('rbRetryBtn'),
    toast:         $('toast'),
  };

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
      `<button class="rb-search-clear" id="rbSearchClear">✕ Hapus</button>`;
    document.getElementById('rbSearchClear').addEventListener('click', () => {
      state.searchQuery = '';
      state.page = 1;
      els.searchInput.value = '';
      updateSearchHeading();
      loadPosts(true); // push → Back bisa kembali ke hasil sebelum clear
    });
  }

  /* ── History helpers untuk pagination & search ── */
  // pushNav = true  → user action (pagination/search) → push ke history stack
  // pushNav = false → restore from popstate / init → tidak push (hindari duplikasi)
  function saveNav(push) {
    const s = { rbPage: state.page, rbQ: state.searchQuery };
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
      els.errorMsg.textContent = e.message || 'Gagal memuat konten.';
      showState('error');
    } finally {
      state.loading = false;
    }
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

  /* ── Open player modal ── */
  async function openPlayer(slug) {
    const session = ++playerSession;

    els.videoTitle.textContent = 'Memuat…';
    els.videoSub.textContent   = 'Vidorey 2';
    els.playerLoading.classList.remove('hidden');
    destroyHls();
    openModal();

    try {
      const data = await apiFetch(`/api/rb/video/${encodeURIComponent(slug)}`);
      if (session !== playerSession) return;

      els.videoTitle.textContent = data.title || slug;

      if (data.m3u8Url) {
        playHls(data.m3u8Url, slug);
      } else if (data.embedUrl) {
        els.videoFrame.onload = () => {
          els.playerLoading.classList.add('hidden');
          els.videoFrame.classList.remove('hidden');
        };
        els.videoFrame.src = data.embedUrl;
      } else {
        throw new Error('Sumber video tidak ditemukan');
      }
    } catch (e) {
      if (session !== playerSession) return;
      console.error('openPlayer:', e.message);
      els.playerLoading.classList.add('hidden');
      els.videoTitle.textContent = 'Gagal memuat video';
      showToast(e.message || 'Gagal memuat video');
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
      // video sudah visible dari awal — langsung play
      video.play().catch(() => {});
    };

    const onFatalError = () => {
      if (session !== playerSession) return;
      destroyHls(); // destroyHls sudah tambahkan .hidden ke video
      els.playerLoading.classList.add('hidden');
      showToast('Stream expired — klik video lagi untuk reload');
    };

    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: false, startLevel: -1 });
      hlsInstance = hls;
      hls.loadSource(m3u8Url);
      hls.attachMedia(video); // video sudah visible → GPU surface dialokasikan
      hls.on(Hls.Events.MANIFEST_PARSED, onReady);
      hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) onFatalError(); });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari / iOS)
      video.src = m3u8Url;
      video.addEventListener('loadedmetadata', onReady,      { once: true });
      video.addEventListener('error',          onFatalError, { once: true });
    } else {
      video.classList.add('hidden');
      els.playerLoading.classList.add('hidden');
      showToast('Browser tidak mendukung HLS playback');
    }
  }

  /* ── Modal controls ── */
  // Flag: apakah kita sudah push history state untuk modal ini
  let modalHistoryPushed = false;

  function openModal() {
    els.modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    // Push state BERBEDA (/rb#player) supaya browser bisa membedakannya dari /rb biasa.
    // Ini penting karena history.back() dari dua URL /rb yang identik bisa melewati
    // keduanya sekaligus dan mendarat di P1 (/) — masalah Chrome/Safari.
    history.pushState({ rbModal: true }, '', '/rb#player');
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
    if (!els.modal.classList.contains('hidden')) {
      // User menekan Back saat modal terbuka → tutup modal saja, tetap di /rb
      modalHistoryPushed = false;
      _doCloseModal();
      history.replaceState(e.state || null, '', '/rb');
      return;
    }

    // Modal tertutup: restore halaman/search dari history state
    const s = e.state;
    if (s && typeof s.rbPage !== 'undefined') {
      // Ada state Vidorey 2 → muat ulang halaman/search yang disimpan
      state.page        = s.rbPage  || 1;
      state.searchQuery = s.rbQ     || '';
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
  // replaceState (bukan push) agar entry pertama punya state yang bisa di-restore
  loadPosts(false);

})();
