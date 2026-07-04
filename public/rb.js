/* ═══════════════════════════════════════
   Vidorey — Platform 2 (RuangBokep)
   Completely isolated from Platform 1
═══════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Config ── */
  const API = (typeof BACKEND_URL !== 'undefined' ? BACKEND_URL : '');

  /* ── State ── */
  const state = {
    categories:   [],
    activeSlug:   null,
    page:         1,
    totalPages:   1,
    loading:      false,
    lastSlug:     null,
    lastPage:     null,
  };

  /* ── DOM refs ── */
  const $ = id => document.getElementById(id);
  const els = {
    catList:      $('rbCategoryList'),
    mobileCats:   $('rbMobileCats'),
    grid:         $('rbGrid'),
    pagination:   $('rbPagination'),
    loading:      $('rbLoadingState'),
    error:        $('rbErrorState'),
    errorMsg:     $('rbErrorMsg'),
    empty:        $('rbEmptyState'),
    modal:        $('rbPlayerModal'),
    modalBackdrop:$('rbModalBackdrop'),
    modalClose:   $('rbModalClose'),
    videoTitle:   $('rbVideoTitle'),
    videoSub:     $('rbVideoSub'),
    videoEl:      $('rbVideoEl'),      // native <video> — tanpa iklan
    videoFrame:   $('rbVideoFrame'),   // fallback iframe
    playerLoading:$('rbPlayerLoading'),
    retryBtn:     $('rbRetryBtn'),
    toast:        $('toast'),
  };

  /* ── Player session tracking (prevents stale responses after modal close) ── */
  let hlsInstance  = null;
  let playerSession = 0; // incremented on each openPlayer call

  function destroyHls() {
    if (hlsInstance) {
      hlsInstance.destroy();
      hlsInstance = null;
    }
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
    if (which !== 'loading') els.grid.innerHTML = '';
    if (which !== 'error')   els.pagination.classList.add('hidden');
  }

  function hideStates() {
    els.loading.classList.add('hidden');
    els.error.classList.add('hidden');
    els.empty.classList.add('hidden');
  }

  /* ── Fetch helpers ── */
  async function apiFetch(path) {
    const r = await fetch(`${API}${path}`);
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${r.status}`);
    }
    return r.json();
  }

  /* ── Load categories ── */
  async function loadCategories() {
    try {
      const data = await apiFetch('/api/rb/categories');
      state.categories = data;
      renderCategories(data);
    } catch (e) {
      console.error('loadCategories:', e.message);
      els.catList.innerHTML = '<p class="rb-cat-error">Gagal memuat kategori</p>';
    }
  }

  /* ── Render categories sidebar (desktop) + mobile bar ── */
  function renderCategories(cats) {
    if (!cats.length) { els.catList.innerHTML = ''; return; }

    // Desktop sidebar
    let html = `<div class="rb-cat-item ${!state.activeSlug ? 'active' : ''}"
                     data-slug="" tabindex="0">
                  <span class="rb-cat-dot"></span>
                  <span class="rb-cat-name">Terbaru</span>
                </div>`;

    cats.forEach(c => {
      const active = state.activeSlug === c.slug;
      const count  = c.count > 999 ? Math.floor(c.count / 1000) + 'k' : c.count;
      html += `<div class="rb-cat-item ${active ? 'active' : ''}"
                    data-slug="${escHtml(c.slug)}" tabindex="0">
                 <span class="rb-cat-dot"></span>
                 <span class="rb-cat-name">${escHtml(c.name)}</span>
                 <span class="rb-cat-count">${count}</span>
               </div>`;
    });

    els.catList.innerHTML = html;

    els.catList.querySelectorAll('.rb-cat-item').forEach(el => {
      el.addEventListener('click', () => selectCategory(el.dataset.slug || null));
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click();
      });
    });

    // Mobile horizontal bar
    renderMobileCats(cats);
  }

  function renderMobileCats(cats) {
    if (!els.mobileCats) return;
    let html = `<button class="rb-mobile-cat-btn ${!state.activeSlug ? 'active' : ''}" data-slug="">Terbaru</button>`;
    cats.forEach(c => {
      html += `<button class="rb-mobile-cat-btn ${state.activeSlug === c.slug ? 'active' : ''}"
                       data-slug="${escHtml(c.slug)}">${escHtml(c.name)}</button>`;
    });
    els.mobileCats.innerHTML = html;
    els.mobileCats.querySelectorAll('.rb-mobile-cat-btn').forEach(btn => {
      btn.addEventListener('click', () => selectCategory(btn.dataset.slug || null));
    });
  }

  function selectCategory(slug) {
    if (slug === state.activeSlug) return;
    state.activeSlug = slug || null;
    state.page       = 1;
    updateCategoryActive();
    loadPosts();
  }

  function updateCategoryActive() {
    const cur = state.activeSlug || '';
    els.catList.querySelectorAll('.rb-cat-item').forEach(el => {
      el.classList.toggle('active', el.dataset.slug === cur);
    });
    if (els.mobileCats) {
      els.mobileCats.querySelectorAll('.rb-mobile-cat-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.slug === cur);
      });
    }
  }

  /* ── Load posts ── */
  async function loadPosts() {
    if (state.loading) return;
    state.loading = true;
    showState('loading');

    const cat  = state.activeSlug || '';
    const page = state.page;

    try {
      const data = await apiFetch(`/api/rb/posts?p=${page}${cat ? `&cat=${encodeURIComponent(cat)}` : ''}`);

      state.totalPages = data.totalPages || 1;
      state.lastSlug   = cat;
      state.lastPage   = page;

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
      const thumb = rawThumb ? `/proxy/rb/thumb?url=${encodeURIComponent(rawThumb)}` : '';
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

    if (total <= 1) {
      els.pagination.classList.add('hidden');
      return;
    }

    const pages = buildPageList(cur, total);
    let html = '';

    if (cur > 1) {
      html += `<button class="page-btn page-prev" data-page="${cur - 1}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>`;
    }

    pages.forEach(p => {
      if (p === '…') {
        html += `<span class="page-ellipsis">…</span>`;
      } else {
        html += `<button class="page-btn ${p === cur ? 'active' : ''}" data-page="${p}">${p}</button>`;
      }
    });

    if (cur < total) {
      html += `<button class="page-btn page-next" data-page="${cur + 1}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>`;
    }

    els.pagination.innerHTML  = html;
    els.pagination.classList.remove('hidden');

    els.pagination.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.page);
        if (p !== state.page) {
          state.page = p;
          loadPosts();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });
  }

  function buildPageList(cur, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = new Set([1, total, cur, cur - 1, cur + 1].filter(p => p >= 1 && p <= total));
    const sorted = [...pages].sort((a, b) => a - b);
    const result = [];
    sorted.forEach((p, i) => {
      if (i > 0 && p - sorted[i - 1] > 1) result.push('…');
      result.push(p);
    });
    return result;
  }

  /* ── Open player modal ── */
  async function openPlayer(slug) {
    const session = ++playerSession; // guard against stale async responses

    els.videoTitle.textContent = 'Memuat…';
    els.videoSub.textContent   = 'Platform 2 — RuangBokep';
    els.playerLoading.classList.remove('hidden');
    destroyHls();
    openModal();

    try {
      const data = await apiFetch(`/api/rb/video/${encodeURIComponent(slug)}`);

      // Modal sudah ditutup sebelum response datang — buang hasilnya
      if (session !== playerSession) return;

      els.videoTitle.textContent = data.title || slug;

      if (data.m3u8Url) {
        // ── Native HLS — tanpa iklan, tanpa iframe ──
        playHls(data.m3u8Url, slug);
      } else if (data.embedUrl) {
        // ── Fallback iframe (hanya jika m3u8 gagal di-resolve) ──
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

  /* ── HLS playback — uses HLS.js (all browsers) or native (Safari) ── */
  function playHls(m3u8Url, slug) {
    const video   = els.videoEl;
    const session = playerSession; // capture current session

    const onReady = () => {
      if (session !== playerSession) return; // stale
      els.playerLoading.classList.add('hidden');
      video.classList.remove('hidden');
      video.play().catch(() => {});
    };

    const onFatalError = () => {
      if (session !== playerSession) return;
      destroyHls();
      els.playerLoading.classList.add('hidden');
      showToast('Stream expired — klik video lagi untuk reload');
    };

    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: false, startLevel: -1 });
      hlsInstance = hls;
      hls.loadSource(m3u8Url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, onReady);
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (d.fatal) onFatalError();
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS — Safari / iOS
      video.src = m3u8Url;
      video.addEventListener('loadedmetadata', onReady,       { once: true });
      video.addEventListener('error',          onFatalError,  { once: true });
    } else {
      els.playerLoading.classList.add('hidden');
      showToast('Browser tidak mendukung HLS playback');
    }
  }

  /* ── Modal controls ── */
  function openModal() {
    els.modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    destroyHls();
    els.playerLoading.classList.remove('hidden');
    els.modal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  els.modalClose.addEventListener('click', closeModal);
  els.modalBackdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !els.modal.classList.contains('hidden')) closeModal();
  });

  /* ── Retry ── */
  els.retryBtn.addEventListener('click', loadPosts);

  /* Brand click digantikan platform switcher dropdown di topbar */

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
  async function init() {
    await loadCategories();
    await loadPosts();
  }

  init();

})();
