/* ═══════════════════════════════════════
   Vidorey 8 — Platform ZG (zoig.com)
   Amateur site · HTML scrape · Direct MP4 stream proxy.
   Slug = integer video ID (misal "14850331").
   Self-healing: token berubah tiap request, proxy handle evict+retry.
═══════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Slug encode/decode ── */
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
    page:       1,
    totalPages: 1,
    loading:    false,
    catSlug:    '',   // '' = semua kategori
    catName:    '',
  };

  /* ── DOM refs ── */
  const $ = id => document.getElementById(id);
  const els = {
    grid:          $('zgGrid'),
    pagination:    $('zgPagination'),
    loading:       $('zgLoadingState'),
    error:         $('zgErrorState'),
    errorMsg:      $('zgErrorMsg'),
    empty:         $('zgEmptyState'),
    searchHeading: $('zgSearchHeading'),
    catBtn:        $('zgCatBtn'),
    catPanel:      $('zgCatPanel'),
    modal:         $('zgPlayerModal'),
    modalBackdrop: $('zgModalBackdrop'),
    modalClose:    $('zgModalClose'),
    modalBody:     $('zgModalBody'),
    videoTitle:    $('zgVideoTitle'),
    videoSub:      $('zgVideoSub'),
    videoEl:       $('zgVideoEl'),
    playerLoading: $('zgPlayerLoading'),
    retryBtn:      $('zgRetryBtn'),
    toast:         $('toast'),
    watchDesc:     $('zgWatchDesc'),
    watchDescText: $('zgWatchDescText'),
    relatedSection:    $('zgRelatedSection'),
    relatedGrid:       $('zgRelatedGrid'),
    relatedPagination: $('zgRelatedPagination'),
    shareBtn:      $('zgShareBtn'),
  };

  /* ── Slug / token tracking ── */
  let currentSlug  = null;
  let currentToken = null;

  /* ── Player session ── */
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

  /* ── Kategori heading ── */
  function updateSearchHeading() {
    const cat = state.catName;
    if (!cat) {
      els.searchHeading.classList.remove('visible');
      els.searchHeading.innerHTML = '';
      return;
    }
    els.searchHeading.classList.add('visible');
    els.searchHeading.innerHTML =
      `${_t('heading.cat')}: <strong>${escHtml(cat)}</strong>` +
      `<button class="rb-search-clear" id="zgCatClear">${_t('heading.clear')}</button>`;
    document.getElementById('zgCatClear').addEventListener('click', () => {
      state.catSlug = '';
      state.catName = '';
      state.page    = 1;
      state.loading = false;
      loadPosts(true);
    });
  }

  /* ── fetch() dengan timeout ── */
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

  /* ── History helpers ── */
  function saveNav(push) {
    const s = { zgPage: state.page, zgCat: state.catSlug, zgCatName: state.catName };
    if (push) {
      history.pushState(s, '', '/zg');
    } else {
      history.replaceState(s, '', '/zg');
    }
  }

  /* ── Load posts ── */
  async function loadPosts(pushNav = false) {
    if (state.loading) return;
    state.loading = true;
    showState('loading');
    updateSearchHeading();
    saveNav(pushNav);

    let qs = `p=${state.page}`;
    if (state.catSlug) qs += `&cat=${encodeURIComponent(state.catSlug)}`;

    try {
      const data = await apiFetch(`/api/zg/posts?${qs}`);
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
        ? `${API}/proxy/zg/thumb?url=${encodeURIComponent(rawThumb)}`
        : '';
      const title    = escHtml(p.title);
      const slug     = escHtml(p.slug);
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

  /* ── Related videos ── */
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
      const thumb = rawThumb ? `${API}/proxy/zg/thumb?url=${encodeURIComponent(rawThumb)}` : '';
      const title    = escHtml(p.title);
      const slug     = escHtml(p.slug);

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

  /* ── Open player modal ── */
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
      const data = await apiFetch(`/api/zg/video/${encodeURIComponent(slug)}`);
      if (session !== playerSession) return;

      if (data.token) {
        currentToken = data.token;
        history.replaceState({ zgModal: true, zgSlug: slug }, '', `/zg/watch/${data.token}`);
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

  /* ── MP4 playback ── */
  function playMp4(proxyUrl, session) {
    const video = els.videoEl;

    // ⚠️ MOBILE FIX: tampilkan <video> SEBELUM set src
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
  let modalHistoryPushed = false;

  function openModal(slug) {
    const url = slug ? `/zg/watch/${encodeSlug(slug)}` : '/zg/watch';

    if (!els.modal.classList.contains('hidden')) {
      if (modalHistoryPushed) history.replaceState({ zgModal: true, zgSlug: slug }, '', url);
      return;
    }

    els.modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    history.pushState({ zgModal: true, zgSlug: slug }, '', url);
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
      history.replaceState(null, '', '/zg');
    }
  }

  window.addEventListener('popstate', e => {
    const s = e.state;

    if (!els.modal.classList.contains('hidden')) {
      modalHistoryPushed = false;
      currentSlug  = null;
      currentToken = null;
      _doCloseModal();
      history.replaceState(s || null, '', '/zg');
      return;
    }

    if (s && s.zgModal && s.zgSlug) {
      modalHistoryPushed = true;
      openPlayer(s.zgSlug, { fromHistory: true });
      return;
    }

    if (s && typeof s.zgPage !== 'undefined') {
      state.page    = s.zgPage || 1;
      state.catSlug = s.zgCat     || '';
      state.catName = s.zgCatName || '';
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
      const shareUrl   = `${location.origin}/zg/watch/${currentToken || encodeSlug(currentSlug)}`;
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

  /* ── Kategori picker ── */
  if (window.initVdryCategoryPicker && els.catBtn) {
    initVdryCategoryPicker({
      button:      els.catBtn,
      panel:       els.catPanel,
      apiPath:     `${API}/api/zg/categories`,
      getActiveId: () => state.catSlug,
      onSelect: (item) => {
        state.catSlug = item ? (item.slug || String(item.id || '')) : '';
        state.catName = item ? item.name : '';
        state.page    = 1;
        state.loading = false;   // batalkan guard jika ada load sebelumnya
        loadPosts(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    });

    /* ── Fix posisi panel: gunakan fixed positioning ──
       Dipanggil setiap kali panel dibuka agar panel muncul
       di bawah button, bukan terpotong oleh stacking context. */
    function repositionPanel() {
      if (!els.catPanel.classList.contains('open')) return;
      const rect = els.catBtn.getBoundingClientRect();
      els.catPanel.style.top  = (rect.bottom + 6) + 'px';
      els.catPanel.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 280)) + 'px';
    }

    els.catBtn.addEventListener('click', function () {
      requestAnimationFrame(repositionPanel);
    });

    /* Tutup panel saat scroll */
    window.addEventListener('scroll', function () {
      if (els.catPanel.classList.contains('open')) {
        els.catBtn.classList.remove('open');
        els.catPanel.classList.remove('open');
      }
    }, { passive: true });

    /* ── Mobile touch override ──────────────────────────────────
       Adsterra Popunder menggunakan document.addEventListener('click',…,true)
       capture-phase yang menangkap tap SEBELUM button handler jalan.
       Fix: gunakan 'touchend' pada mobile yang tidak diintersept popunder. */
    if ('ontouchstart' in window) {
      let _zgCatList = null;   // cache list setelah fetch pertama

      function _zgOpenPanel() {
        els.catBtn.classList.add('open');
        els.catPanel.classList.add('open');
        requestAnimationFrame(repositionPanel);

        if (_zgCatList !== null) { _zgRenderChips(); return; }
        els.catPanel.innerHTML = '<div class="vdry-cat-panel-empty">Memuat…</div>';
        fetch(`${API}/api/zg/categories`)
          .then(r => r.ok ? r.json() : [])
          .then(list => { _zgCatList = Array.isArray(list) ? list : []; _zgRenderChips(); })
          .catch(() => { _zgCatList = []; _zgRenderChips(); });
      }

      function _zgClosePanel() {
        els.catBtn.classList.remove('open');
        els.catPanel.classList.remove('open');
      }

      function _zgRenderChips() {
        if (!_zgCatList || !_zgCatList.length) {
          els.catPanel.innerHTML = '<div class="vdry-cat-panel-empty">' + _t('cat.empty') + '</div>';
          return;
        }
        const activeSlug = state.catSlug;
        const html = [
          `<button type="button" class="vdry-cat-chip${activeSlug ? '' : ' active'}" data-id="">${_t('cat.all')}</button>`,
          ..._zgCatList.map(c =>
            `<button type="button" class="vdry-cat-chip${activeSlug === c.slug ? ' active' : ''}" data-id="${c.slug}">${c.name}${c.count ? ` (${c.count})` : ''}</button>`
          )
        ].join('');
        els.catPanel.innerHTML = html;

        els.catPanel.querySelectorAll('.vdry-cat-chip').forEach(chip => {
          let _touchStartY = 0, _touchStartX = 0;
          chip.addEventListener('touchstart', function (e) {
            _touchStartY = e.touches[0].clientY;
            _touchStartX = e.touches[0].clientX;
          }, { passive: true });
          chip.addEventListener('touchend', function (e) {
            /* Jika jari bergerak >8px = scroll, abaikan */
            const dy = Math.abs(e.changedTouches[0].clientY - _touchStartY);
            const dx = Math.abs(e.changedTouches[0].clientX - _touchStartX);
            if (dy > 8 || dx > 8) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            const id = chip.getAttribute('data-id');
            _zgClosePanel();
            state.catSlug = id;
            state.catName = id ? (_zgCatList.find(c => c.slug === id)?.name || '') : '';
            state.page    = 1;
            state.loading = false;
            loadPosts(true);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }, { passive: false });
        });
      }

      /* Ganti click dengan touchend pada button */
      els.catBtn.addEventListener('touchend', function (e) {
        e.preventDefault();          // cegah ghost click
        e.stopImmediatePropagation(); // blokir popunder capture
        /* Blokir ghost click agar utils.js tidak toggle-close panel */
        els.catBtn.addEventListener('click', function stopGhost(ev) {
          ev.stopImmediatePropagation();
          ev.preventDefault();
        }, { once: true, capture: true });
        if (els.catPanel.classList.contains('open')) {
          _zgClosePanel();
        } else {
          _zgOpenPanel();
        }
      }, { passive: false });

      /* Tutup saat tap di luar panel */
      document.addEventListener('touchend', function (e) {
        if (els.catPanel.classList.contains('open') &&
            !els.catPanel.contains(e.target) &&
            e.target !== els.catBtn &&
            !els.catBtn.contains(e.target)) {
          _zgClosePanel();
        }
      }, { passive: true });
    }
  }

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
  const deepLinkMatch = location.pathname.match(/^\/zg\/watch\/([^/]+)\/?$/);

  loadPosts(false);

  if (deepLinkMatch) {
    const segment = deepLinkMatch[1];
    if (/^[a-z0-9]{11}$/.test(segment)) {
      // Short token — resolve server-side
      apiFetch(`/api/s/zg/${segment}`)
        .then(d => { if (d?.slug) { modalHistoryPushed = false; openPlayer(d.slug); } })
        .catch(() => {});
    } else {
      // Legacy: base64-encoded slug
      const slug = decodeSlug(segment);
      if (slug) { modalHistoryPushed = false; openPlayer(slug); }
    }
  }

  /* ── Language change: re-render dynamic text ── */
  window.addEventListener('langchange', function () {
    updateSearchHeading();
  });

})();
