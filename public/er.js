/* ═══════════════════════════════════════
   Vidorey 9 — Platform 10 (EroMe)
   HTML listing · Direct MP4 stream proxy
   AlbumId = slug; thumb exposed langsung dari CDN (imgSrc CSP: https:)
═══════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Slug encode/decode (URL aman, albumId tidak terlihat di address bar) ── */
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
    searchQuery: '',
    catId:       '',
    catName:     '',
  };

  /* ── DOM refs ── */
  const $ = id => document.getElementById(id);
  const els = {
    searchForm:    $('erSearchForm'),
    searchInput:   $('erSearchInput'),
    searchHeading: $('erSearchHeading'),
    catBtn:        $('erCatBtn'),
    catPanel:      $('erCatPanel'),
    grid:          $('erGrid'),
    pagination:    $('erPagination'),
    loading:       $('erLoadingState'),
    error:         $('erErrorState'),
    errorMsg:      $('erErrorMsg'),
    empty:         $('erEmptyState'),
    modal:         $('erPlayerModal'),
    modalBackdrop: $('erModalBackdrop'),
    modalClose:    $('erModalClose'),
    modalBody:     $('erModalBody'),
    videoTitle:    $('erVideoTitle'),
    videoSub:      $('erVideoSub'),
    videoEl:       $('erVideoEl'),
    playerLoading: $('erPlayerLoading'),
    retryBtn:      $('erRetryBtn'),
    toast:         $('toast'),
    watchDesc:     $('erWatchDesc'),
    watchDescText: $('erWatchDescText'),
    relatedSection:    $('erRelatedSection'),
    relatedGrid:       $('erRelatedGrid'),
    relatedPagination: $('erRelatedPagination'),
    shareBtn:      $('erShareBtn'),
    dlBtn:         $('erDlBtn'),
  };

  let currentSlug        = null;
  let currentToken       = null;
  let currentDownloadUrl = null;
  let playerSession      = 0;

  /* ── Destroy player ── */
  function destroyPlayer() {
    const video = els.videoEl;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.classList.add('hidden');
    }
    currentDownloadUrl = null;
    if (els.dlBtn) els.dlBtn.disabled = true;
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

  /* ── Fetch helper ── */
  function fetchWithTimeout(url, ms = 15000) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(tid));
  }
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
    const q   = state.searchQuery;
    const cat = state.catName;
    if (!q && !cat) {
      els.searchHeading.classList.remove('visible');
      els.searchHeading.innerHTML = '';
      return;
    }
    els.searchHeading.classList.add('visible');
    if (q) {
      els.searchHeading.innerHTML =
        `${_t('heading.search')}: <strong>"${escHtml(q)}"</strong>` +
        `<button class="rb-search-clear" id="erSearchClear">${_t('heading.clearSearch')}</button>`;
      document.getElementById('erSearchClear').addEventListener('click', () => {
        state.searchQuery = '';
        state.page = 1;
        els.searchInput.value = '';
        updateSearchHeading();
        loadPosts(true);
      });
    } else {
      els.searchHeading.innerHTML =
        `${_t('heading.cat')}: <strong>${escHtml(cat)}</strong>` +
        `<button class="rb-search-clear" id="erSearchClear">${_t('heading.clearSearch')}</button>`;
      document.getElementById('erSearchClear').addEventListener('click', () => {
        state.catId   = '';
        state.catName = '';
        state.page    = 1;
        updateSearchHeading();
        loadPosts(true);
      });
    }
  }

  /* ── History helpers ── */
  function saveNav(push) {
    const s = { erPage: state.page, erQ: state.searchQuery, erCat: state.catId, erCatName: state.catName };
    if (push) history.pushState(s, '', '/er');
    else      history.replaceState(s, '', '/er');
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
    if (q)           qs += `&q=${encodeURIComponent(q)}`;
    else if (state.catId) qs += `&cat=${encodeURIComponent(state.catId)}`;

    try {
      const data = await apiFetch(`/api/er/posts?${qs}`);
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

  /* ── Inline 300×250 ad ── */
  function createInlineAd() {
    const wrap = document.createElement('div');
    wrap.className = 'ad-inline-grid';
    if (window.VdryAds && window.VdryAds.injectAd) {
      window.VdryAds.injectAd(wrap, 'box-300');
    } else {
      const s1 = document.createElement('script');
      s1.textContent = 'atOptions={"key":"d50b941ac6d9bd5749dcdb0b417bf348","format":"iframe","height":250,"width":300,"params":{}};';
      const s2 = document.createElement('script');
      s2.src = 'https://turbulentrefreshments.com/d50b941ac6d9bd5749dcdb0b417bf348/invoke.js';
      wrap.appendChild(s1);
      wrap.appendChild(s2);
    }
    return wrap;
  }

  /* ── Render post grid ── */
  function renderPosts(posts) {
    els.grid.innerHTML = posts.map(p => {
      // erome thumb CDN (s{N}.erome.com) exposed langsung — imgSrc CSP sudah allow https:
      const thumb = escHtml(p.thumb || '');
      const title = escHtml(p.title || '');
      const slug  = escHtml(p.slug  || '');
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
      card.addEventListener('click',   () => openPlayer(card.dataset.slug));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') openPlayer(card.dataset.slug);
      });
    });

    // Inject inline ad setelah card ke-8, 16, 24
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
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
      </button>`;
    }
    pages.forEach(p => {
      html += p === '…'
        ? `<span class="page-ellipsis">…</span>`
        : `<button type="button" class="page-btn ${p === cur ? 'active' : ''}" data-page="${p}">${p}</button>`;
    });
    if (cur < total) {
      html += `<button type="button" class="page-btn page-next" data-page="${cur + 1}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </button>`;
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
  if (els.searchForm) {
    els.searchForm.addEventListener('submit', e => {
      e.preventDefault();
      const q = els.searchInput.value.trim();
      if (q === state.searchQuery) return;
      state.searchQuery = q;
      state.page = 1;
      loadPosts(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ── Watch desc ── */
  function renderWatchDesc(description) {
    if (!description) {
      els.watchDesc.classList.add('hidden');
      els.watchDescText.textContent = '';
      return;
    }
    els.watchDescText.textContent = description;
    els.watchDesc.classList.remove('hidden');
  }

  /* ── Related (client-side pagination) ── */
  const RELATED_PAGE_SIZE = 8;
  let relatedState = { items: [], page: 1 };

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
    const start      = (page - 1) * RELATED_PAGE_SIZE;
    const pageItems  = items.slice(start, start + RELATED_PAGE_SIZE);

    els.relatedGrid.innerHTML = pageItems.map(p => {
      const thumb = escHtml(p.thumb || '');
      const title = escHtml(p.title || '');
      const slug  = escHtml(p.slug  || '');
      return `<div class="rb-card" data-slug="${slug}" tabindex="0" role="button" aria-label="${title}">
        <div class="rb-card-thumb">
          ${thumb
            ? `<img src="${thumb}" alt="${title}" loading="lazy" decoding="async" onerror="this.parentElement.classList.add('rb-thumb-err')" />`
            : ''}
          <div class="rb-card-overlay">
            <svg class="rb-play-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
        <div class="rb-card-info">
          <p class="rb-card-title" title="${title}">${title}</p>
        </div>
      </div>`;
    }).join('');

    els.relatedGrid.querySelectorAll('.rb-card').forEach(card => {
      card.addEventListener('click',   () => openPlayer(card.dataset.slug));
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

  /* ── Open player modal ── */
  let modalHistoryPushed = false;

  async function openPlayer(slug, opts = {}) {
    const session = ++playerSession;
    currentSlug  = slug;
    currentToken = null;

    els.videoTitle.textContent = 'Memuat…';
    els.playerLoading.classList.remove('hidden');
    if (typeof clearVideoJsonLd === 'function') clearVideoJsonLd();
    if (typeof clearVideoMeta   === 'function') clearVideoMeta();
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
      const data = await apiFetch(`/api/er/video/${encodeURIComponent(slug)}`);
      if (session !== playerSession) return;

      if (data.token) {
        currentToken = data.token;
        history.replaceState({ erModal: true, erSlug: slug }, '', `/er/watch/${data.token}`);
      }

      els.videoTitle.textContent = data.title || slug;
      if (typeof setVideoJsonLd === 'function') setVideoJsonLd(data.title || slug, window.location.href, null, data.description || '');
      if (typeof setVideoMeta   === 'function') setVideoMeta(data.title || slug, window.location.href, null, data.description || '');
      renderWatchDesc(data.description || '');
      renderRelated(data.related || []);
      currentDownloadUrl = `${API}${data.mp4Url}`;
      if (els.dlBtn) els.dlBtn.disabled = false;
      playMp4(`${API}${data.mp4Url}`, session);
    } catch (e) {
      if (session !== playerSession) return;
      console.error('openPlayer:', e.message);
      els.playerLoading.classList.add('hidden');
      els.videoTitle.textContent = _t('err.video.title');
      showToast(_t('err.video'));
    }
  }

  /* ── MP4 playback ── */
  function playMp4(proxyUrl, session) {
    const video = els.videoEl;
    // Mobile fix: show element before setting src (GPU surface allocation)
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
      showToast(_t('err.video'));
    };
    video.addEventListener('loadedmetadata', onReady, { once: true });
    video.addEventListener('error',          onError, { once: true });
    video.src = proxyUrl;
    video.load();
  }

  /* ── Modal open/close ── */
  function openModal(slug) {
    const url = slug ? `/er/watch/${encodeSlug(slug)}` : '/er/watch';
    if (!els.modal.classList.contains('hidden')) {
      if (modalHistoryPushed) history.replaceState({ erModal: true, erSlug: slug }, '', url);
      return;
    }
    if (window.VdryAds) VdryAds.triggerPopunder();
    els.modal.classList.remove('hidden');
    if (window.VdryAds) VdryAds.reloadModalAds(els.modal);
    document.body.classList.add('modal-open');
    history.pushState({ erModal: true, erSlug: slug }, '', url);
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
      history.replaceState(null, '', '/er');
    }
  }

  /* ── Popstate ── */
  window.addEventListener('popstate', e => {
    const s = e.state;
    if (!els.modal.classList.contains('hidden')) {
      modalHistoryPushed = false;
      currentSlug  = null;
      currentToken = null;
      _doCloseModal();
      history.replaceState(s || null, '', '/er');
      return;
    }
    if (s && s.erModal && s.erSlug) {
      modalHistoryPushed = true;
      openPlayer(s.erSlug, { fromHistory: true });
      return;
    }
    if (s && typeof s.erPage !== 'undefined') {
      state.page        = s.erPage    || 1;
      state.searchQuery = s.erQ       || '';
      state.catId       = s.erCat     || '';
      state.catName     = s.erCatName || '';
      if (els.searchInput) els.searchInput.value = state.searchQuery;
      loadPosts(false);
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
      const shareUrl   = `${location.origin}/er/watch/${currentToken || encodeSlug(currentSlug)}`;
      const shareTitle = els.videoTitle.textContent || 'Vidorey';
      if (navigator.share) {
        try { await navigator.share({ title: shareTitle, url: shareUrl }); }
        catch (e) { if (e.name !== 'AbortError') showToast(_t('toast.noShare')); }
        return;
      }
      try {
        await navigator.clipboard.writeText(shareUrl);
        showToast(_t('toast.copied'));
      } catch { showToast(shareUrl); }
    });
  }

  /* ── Download ── */
  if (els.dlBtn) {
    els.dlBtn.disabled = true;
    els.dlBtn.addEventListener('click', () => {
      if (!currentDownloadUrl) return;
      if (window.VdryAds) VdryAds.triggerDirectlink();
      const url   = currentDownloadUrl;
      const title = (els.videoTitle.textContent || 'video').replace(/[/\\?%*:|"<>]/g, '-');
      setTimeout(() => {
        const a = document.createElement('a');
        a.href     = url;
        a.download = title + '.mp4';
        a.target   = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, 800);
    });
  }

  /* ── Retry ── */
  if (els.retryBtn) els.retryBtn.addEventListener('click', () => loadPosts(false));

  /* ── Escape helper ── */
  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ── Init ── */
  const deepLinkMatch = location.pathname.match(/^\/er\/watch\/([^/]+)\/?$/);

  /* ── Kategori picker ── */
  if (window.initVdryCategoryPicker && document.getElementById('erCatBtn')) {
    initVdryCategoryPicker({
      button:      document.getElementById('erCatBtn'),
      panel:       document.getElementById('erCatPanel'),
      apiPath:     `${API}/api/er/categories`,
      getActiveId: () => state.catId,
      onSelect: (item) => {
        if (window.VdryAds) VdryAds.triggerPopunder();
        state.searchQuery = '';
        els.searchInput.value = '';
        state.catId   = item ? String(item.id) : '';
        state.catName = item ? item.name : '';
        state.page = 1;
        loadPosts(true);
      },
    });
  }

  loadPosts(false);
  if (window.VdryAds) VdryAds.initVideoOverlay('er');
  if (window.VdryAds) VdryAds.initVideoTap('er');

  // Deep-link: /er/watch/<token> atau /er/watch/<base64slug>
  if (deepLinkMatch) {
    const segment = deepLinkMatch[1];
    if (/^[a-z0-9]{11}$/.test(segment)) {
      // Short token → resolve server-side
      apiFetch(`/api/s/er/${segment}`)
        .then(d => { if (d?.slug) { modalHistoryPushed = false; openPlayer(d.slug); } })
        .catch(() => {});
    } else {
      // Base64-encoded albumId (legacy / langsung)
      const albumId = decodeSlug(segment);
      if (albumId) { modalHistoryPushed = false; openPlayer(albumId); }
    }
  }

  /* ── Language change: re-render heading ── */
  window.addEventListener('langchange', updateSearchHeading);

})();
