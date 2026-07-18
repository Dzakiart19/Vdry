/* ════════════════════════════════════════════
   VIDOREY — SPA Engine
   • History API navigation (back/forward works)
   • Live scrape — no static data
   • Auto-refresh every 3 min
════════════════════════════════════════════ */

const DEFAULT_FOLDER = 'e2bo9hcw9pe';
const STORAGE_KEY    = 'vidorey_saved_v2';

const App = (() => {

  /* ──────── State ──────── */
  let currentFolder      = DEFAULT_FOLDER;
  let currentPage        = 1;
  let currentData        = null;
  let breadcrumbs        = [{ id: DEFAULT_FOLDER, name: 'Home' }];
  let retryFn            = null;
  let refreshTimer       = null;

  /* ──────── DOM ──────── */
  const $  = id => document.getElementById(id);
  const el = {
    loading:    $('loadingState'),
    error:      $('errorState'),
    errorMsg:   $('errorMsg'),
    empty:      $('emptyState'),
    main:       $('mainGrid'),
    pagination: $('pagination'),
    folderList: $('folderList'),
    breadcrumb: $('breadcrumb'),
    /* ── watch view ── */
    modal:             $('p1PlayerModal'),
    backdrop:          $('p1ModalBackdrop'),
    modalBody:         $('p1ModalBody'),
    videoEl:           $('p1VideoEl'),
    videoTitle:        $('p1VideoTitle'),
    playerLoading:     $('p1PlayerLoading'),
    relatedGrid:       $('p1RelatedGrid'),
    relatedSection:    $('p1RelatedSection'),
    relatedPagination: $('p1RelatedPagination'),
    shareBtn:          $('p1ShareBtn'),
    addInput:   $('addFolderInput'),
    addBtn:     $('addFolderBtn'),
  };

  /* ──────── Saved folders (localStorage) ──────── */
  function getSaved() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { return []; }
  }
  function setSaved(arr) { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); }
  function addSaved(id, name) {
    const arr = getSaved();
    if (arr.find(f => f.id === id)) return false;
    arr.push({ id, name: name || id });
    setSaved(arr);
    return true;
  }
  function removeSaved(id) { setSaved(getSaved().filter(f => f.id !== id)); }

  /* ──────── Parse input ──────── */
  function parseInput(raw) {
    raw = (raw || '').trim();
    const m = raw.match(/\/f\/([a-z0-9]+)/i);
    if (m) return m[1];
    if (/^[a-z0-9]+$/i.test(raw)) return raw;
    return null;
  }

  /* ──────── History API ──────── */
  function pushNav(folderId, page, crumbs) {
    const url = folderId === DEFAULT_FOLDER
      ? '/'
      : `/?f=${folderId}${page > 1 ? '&p=' + page : ''}`;
    history.pushState({ folderId, page, breadcrumbs: crumbs }, '', url);
  }

  function replaceNav(folderId, page, crumbs) {
    const url = folderId === DEFAULT_FOLDER
      ? '/'
      : `/?f=${folderId}${page > 1 ? '&p=' + page : ''}`;
    history.replaceState({ folderId, page, breadcrumbs: crumbs }, '', url);
  }

  window.addEventListener('popstate', e => {
    const s = e.state;

    // Modal terbuka → Back HP tutup modal saja
    if (!el.modal.classList.contains('hidden')) {
      watchHistoryPushed = false;
      _doClosePlayer();
      replaceNav(currentFolder, currentPage, breadcrumbs);
      return;
    }

    // Forward ke entry watch (setelah user Back dari modal, lalu Forward lagi)
    if (s && s.p1Watch && s.p1Vid) {
      watchHistoryPushed = true;
      openPlayer(s.p1Vid, '', { fromHistory: true });
      return;
    }

    // Navigasi folder biasa
    if (s && s.folderId) {
      breadcrumbs = s.breadcrumbs || [{ id: DEFAULT_FOLDER, name: 'Home' }];
      loadFolder(s.folderId, s.page || 1, false);
    } else if (!s) {
      breadcrumbs = [{ id: DEFAULT_FOLDER, name: 'Home' }];
      loadFolder(DEFAULT_FOLDER, 1, false);
    }
  });

  /* ──────── Show/hide states ──────── */
  function showState(name) {
    ['loading', 'error', 'empty'].forEach(s => el[s].classList.add('hidden'));
    if (name) el[name].classList.remove('hidden');
  }

  /* ──────── Backend base URL ──────── */
  const API = (window.BACKEND_URL || '').replace(/\/$/, '');

  /* ──────── fetch() dengan timeout 15 detik ──────── */
  function fetchWithTimeout(url, ms = 15000) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(tid));
  }

  /* ──────── Thumb proxy ──────── */
  function thumbSrc(raw) {
    if (!raw) return '';
    return raw.startsWith('https://i.xpvid.cc/')
      ? API + '/proxy/thumb?url=' + encodeURIComponent(raw)
      : raw;
  }

  /* ──────── Escape HTML ──────── */
  function esc(str) {
    return String(str || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  /* ══════════════════════════════════
     LOAD FOLDER
  ══════════════════════════════════ */
  async function loadFolder(id, page = 1, pushHistory = true) {
    currentFolder = id;
    currentPage   = page;
    el.main.innerHTML = '';
    el.pagination.classList.add('hidden');
    showState('loading');

    // Scroll to top
    document.querySelector('.content')?.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      const resp = await fetchWithTimeout(`${API}/api/folder/${id}?p=${page}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      currentData = data;

      if (pushHistory) pushNav(id, page, breadcrumbs);

      renderAll(data);
      scheduleRefresh();
    } catch (err) {
      retryFn = () => loadFolder(id, page);
      el.errorMsg.textContent = 'Server sedang mengalami gangguan. Tim kami sedang menangani masalah ini secepat mungkin.';
      showState('error');
    }
  }

  /* ══════════════════════════════════
     RENDER ALL
  ══════════════════════════════════ */
  function renderAll(data) {
    showState(null);
    renderBreadcrumb();
    renderSidebar(data.folders || []);
    renderMain(data);
    renderPagination(data);
  }

  /* ── Breadcrumb ── */
  function renderBreadcrumb() {
    el.breadcrumb.innerHTML = '';
    breadcrumbs.forEach((bc, i) => {
      const isLast = i === breadcrumbs.length - 1;

      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'bc-sep';
        sep.textContent = '/';
        el.breadcrumb.appendChild(sep);
      }

      const span = document.createElement('span');
      span.className = 'bc-item';
      span.textContent = bc.name || bc.id;

      if (!isLast) {
        span.addEventListener('click', () => {
          breadcrumbs = breadcrumbs.slice(0, i + 1);
          loadFolder(bc.id);
        });
      }

      el.breadcrumb.appendChild(span);
    });
  }

  /* ── Sidebar ── */
  function renderSidebar(subFolders) {
    el.folderList.innerHTML = '';
    const saved = getSaved();

    if (saved.length === 0 && subFolders.length === 0) {
      const msg = document.createElement('p');
      msg.className = 'sb-empty';
      msg.textContent = 'Belum ada folder tersimpan.';
      el.folderList.appendChild(msg);
      return;
    }

    // Saved section
    if (saved.length > 0) {
      const lbl = document.createElement('div');
      lbl.className = 'sb-label';
      lbl.textContent = 'Tersimpan';
      el.folderList.appendChild(lbl);

      saved.forEach(f => {
        const item = makeSidebarItem(f.name || f.id, () => {
          breadcrumbs = [{ id: DEFAULT_FOLDER, name: 'Home' }, { id: f.id, name: f.name || f.id }];
          loadFolder(f.id);
        }, f.id === currentFolder);

        // Delete button
        const del = document.createElement('button');
        del.className = 'folder-del';
        del.title = 'Hapus';
        del.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>`;
        del.addEventListener('click', e => {
          e.stopPropagation();
          removeSaved(f.id);
          renderSidebar(currentData?.folders || []);
          if (currentFolder === DEFAULT_FOLDER) renderMain(currentData);
        });
        item.appendChild(del);

        el.folderList.appendChild(item);
      });
    }

    // Subfolder section
    if (subFolders.length > 0) {
      const lbl = document.createElement('div');
      lbl.className = 'sb-label';
      lbl.textContent = 'Subfolder';
      el.folderList.appendChild(lbl);

      subFolders.forEach(f => {
        const item = makeSidebarItem(f.name || f.id, () => {
          breadcrumbs.push({ id: f.id, name: f.name || f.id });
          loadFolder(f.id);
        }, f.id === currentFolder);
        el.folderList.appendChild(item);
      });
    }
  }

  function makeSidebarItem(label, onClick, active = false) {
    const item = document.createElement('div');
    item.className = 'folder-item' + (active ? ' active' : '');

    item.innerHTML = `
      <svg class="fi-icon" viewBox="0 0 24 24" fill="currentColor">
        <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
      </svg>
      <span class="fi-name">${esc(label)}</span>`;

    item.addEventListener('click', onClick);
    return item;
  }

  /* ── Main content area ── */
  function renderMain(data) {
    el.main.innerHTML = '';

    const saved      = getSaved();
    const folders    = data?.folders || [];
    const videos     = data?.videos  || [];
    const isHome     = currentFolder === DEFAULT_FOLDER;

    // ── Saved cards (only on home) ──
    if (isHome && saved.length > 0) {
      el.main.appendChild(makeSectionHeading('Tersimpan'));
      const grid = makeFolderGrid();

      saved.forEach(f => {
        grid.appendChild(makeFolderCard(f.name || f.id, () => {
          breadcrumbs = [{ id: DEFAULT_FOLDER, name: 'Home' }, { id: f.id, name: f.name || f.id }];
          loadFolder(f.id);
        }));
      });

      const wrap = document.createElement('div');
      wrap.id = 'savedSection';
      wrap.appendChild(grid);
      el.main.appendChild(wrap);
    }

    // ── Subfolder cards ──
    if (folders.length > 0) {
      el.main.appendChild(makeSectionHeading('Folder'));
      const grid = makeFolderGrid();

      folders.forEach(f => {
        grid.appendChild(makeFolderCard(f.name || f.id, () => {
          breadcrumbs.push({ id: f.id, name: f.name || f.id });
          loadFolder(f.id);
        }));
      });

      const wrap = document.createElement('div');
      wrap.id = 'folderSection';
      wrap.appendChild(grid);
      el.main.appendChild(wrap);
    }

    // ── Video cards ──
    if (videos.length > 0) {
      const heading = makeSectionHeading(`Video · ${videos.length} file${data.totalPages > 1 ? ` · Hal. ${data.page}/${data.totalPages}` : ''}`);
      el.main.appendChild(heading);

      const grid = document.createElement('div');
      grid.className = 'video-grid';
      grid.id = 'videoSection';

      videos.forEach(v => grid.appendChild(makeVideoCard(v)));
      el.main.appendChild(grid);
    }

    // ── Empty ──
    if (folders.length === 0 && videos.length === 0 && !(isHome && getSaved().length > 0)) {
      showState('empty');
    }
  }

  function makeSectionHeading(text) {
    const h = document.createElement('div');
    h.className = 'section-heading';
    h.textContent = text;
    return h;
  }

  function makeFolderGrid() {
    const g = document.createElement('div');
    g.className = 'folder-grid';
    return g;
  }

  function makeFolderCard(label, onClick) {
    const card = document.createElement('div');
    card.className = 'folder-card';
    card.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
      </svg>
      <span>${esc(label)}</span>`;
    card.addEventListener('click', onClick);
    return card;
  }

  function makeVideoCard(v) {
    const card = document.createElement('div');
    card.className = 'video-card';

    const src = thumbSrc(v.thumb);
    const thumbHtml = src
      ? `<img src="${esc(src)}" alt="" loading="lazy"
           onerror="this.parentElement.innerHTML='<div class=\\'no-thumb\\'><svg viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'1.5\\'><path d=\\'M15 10l4.553-2.069A1 1 0 0121 8.845v6.31a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z\\'/></svg></div>'">`
      : `<div class="no-thumb"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
           <path d="M15 10l4.553-2.069A1 1 0 0121 8.845v6.31a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/>
         </svg></div>`;

    card.innerHTML = `
      <div class="thumb-wrap">
        ${thumbHtml}
        <div class="play-overlay">
          <div class="play-btn-circle">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
      </div>
      <div class="card-body">
        <div class="card-title">${esc(v.name || v.id)}</div>
      </div>`;

    card.addEventListener('click', () => openPlayer(v.id, v.name || v.id));
    return card;
  }

  /* ── Pagination ── */
  function renderPagination(data) {
    el.pagination.innerHTML = '';
    if (!data.totalPages || data.totalPages <= 1) {
      el.pagination.classList.add('hidden');
      return;
    }

    el.pagination.classList.remove('hidden');
    const cur = data.page;
    const tot = data.totalPages;

    // Prev
    const prev = pgBtn(cur <= 1, '←');
    if (cur > 1) prev.addEventListener('click', () => loadFolder(currentFolder, cur - 1));
    el.pagination.appendChild(prev);

    // Pages — smart truncation
    const pages = buildPageRange(cur, tot);
    pages.forEach(p => {
      if (p === '…') {
        const sep = document.createElement('span');
        sep.className = 'pg-sep';
        sep.textContent = '…';
        el.pagination.appendChild(sep);
      } else {
        const btn = pgBtn(false, p);
        if (p === cur) btn.classList.add('active');
        else btn.addEventListener('click', () => loadFolder(currentFolder, p));
        el.pagination.appendChild(btn);
      }
    });

    // Next
    const next = pgBtn(cur >= tot, '→');
    if (cur < tot) next.addEventListener('click', () => loadFolder(currentFolder, cur + 1));
    el.pagination.appendChild(next);
  }

  function pgBtn(disabled, label) {
    const b = document.createElement('div');
    b.className = 'pg-btn' + (disabled ? ' disabled' : '');
    b.textContent = label;
    return b;
  }

  function buildPageRange(cur, tot) {
    if (tot <= 7) return Array.from({ length: tot }, (_, i) => i + 1);
    if (cur <= 3) return [1, 2, 3, 4, '…', tot];
    if (cur >= tot - 2) return [1, '…', tot-3, tot-2, tot-1, tot];
    return [1, '…', cur-1, cur, cur+1, '…', tot];
  }

  /* ══════════════════════════════════
     WATCH VIEW STATE
  ══════════════════════════════════ */
  const RELATED_PAGE_SIZE = 8;
  let currentVideoId     = null;
  let watchHistoryPushed = false;
  let relatedState       = { items: [], page: 1 };

  /* ══════════════════════════════════
     RELATED VIDEOS (dari folder yang sama)
  ══════════════════════════════════ */
  function renderRelated(items) {
    relatedState = { items: items || [], page: 1 };
    if (!relatedState.items.length) {
      el.relatedGrid.innerHTML = '';
      el.relatedPagination.classList.add('hidden');
      el.relatedSection.classList.add('hidden');
      return;
    }
    el.relatedSection.classList.remove('hidden');
    renderRelatedPage();
  }

  function renderRelatedPage() {
    const { items, page } = relatedState;
    const totalPages = Math.max(1, Math.ceil(items.length / RELATED_PAGE_SIZE));
    const start      = (page - 1) * RELATED_PAGE_SIZE;
    const pageItems  = items.slice(start, start + RELATED_PAGE_SIZE);

    el.relatedGrid.innerHTML = pageItems.map(v => {
      const src   = thumbSrc(v.thumb);
      const title = esc(v.name || v.id);
      const vid   = esc(v.id);
      return `<div class="rb-card" data-vid="${vid}" data-name="${title}" tabindex="0" role="button" aria-label="${title}">
        <div class="rb-card-thumb">
          ${src
            ? `<img src="${esc(src)}" alt="${title}" loading="lazy" decoding="async" onerror="this.parentElement.classList.add('rb-thumb-err')" />`
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

    el.relatedGrid.querySelectorAll('.rb-card').forEach(card => {
      card.addEventListener('click', () => openPlayer(card.dataset.vid, card.dataset.name));
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') openPlayer(card.dataset.vid, card.dataset.name);
      });
    });

    renderRelatedPagination(page, totalPages);
  }

  function renderRelatedPagination(cur, total) {
    if (total <= 1) { el.relatedPagination.classList.add('hidden'); return; }

    const pages = buildPageRange(cur, total);
    let html = '';
    if (cur > 1) html += `<button type="button" class="page-btn page-prev" data-page="${cur - 1}">‹</button>`;
    pages.forEach(p => {
      html += p === '…'
        ? `<span class="page-ellipsis">…</span>`
        : `<button type="button" class="page-btn ${p === cur ? 'active' : ''}" data-page="${p}">${p}</button>`;
    });
    if (cur < total) html += `<button type="button" class="page-btn page-next" data-page="${cur + 1}">›</button>`;

    el.relatedPagination.innerHTML = html;
    el.relatedPagination.classList.remove('hidden');

    el.relatedPagination.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.page);
        if (p !== relatedState.page) {
          relatedState.page = p;
          renderRelatedPage();
          el.relatedSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  /* ══════════════════════════════════
     VIDEO PLAYER (full-page watch view)
  ══════════════════════════════════ */
  async function openPlayer(id, name, opts = {}) {
    currentVideoId = id;

    // Reset player UI
    el.videoTitle.textContent = name || id;
    el.playerLoading.classList.remove('hidden');
    el.videoEl.classList.add('hidden');
    el.videoEl.pause();
    el.videoEl.removeAttribute('src');
    el.videoEl.load();
    if (typeof clearVideoJsonLd === 'function') clearVideoJsonLd();
    if (typeof clearVideoMeta === 'function') clearVideoMeta();

    // Related = video lain di folder yang sedang aktif
    const related = (currentData?.videos || []).filter(v => v.id !== id);
    renderRelated(related);

    // Buka modal
    if (opts.fromHistory) {
      el.modal.classList.remove('hidden');
      document.body.classList.add('modal-open');
    } else {
      _openModal(id);
    }
    if (el.modalBody) el.modalBody.scrollTop = 0;

    // Mulai putar MP4 langsung — server proxy resolve URL-nya sendiri
    const src = `${API}/proxy/stream/${id}`;
    el.videoEl.src = src;
    el.videoEl.load();

    el.videoEl.addEventListener('loadedmetadata', function onMeta() {
      el.videoEl.removeEventListener('loadedmetadata', onMeta);
      el.playerLoading.classList.add('hidden');
      el.videoEl.classList.remove('hidden');
      el.videoEl.play().catch(() => {});
    });
    el.videoEl.addEventListener('error', function onErr() {
      el.videoEl.removeEventListener('error', onErr);
      el.playerLoading.classList.add('hidden');
      showToast(_t('err.video.app'));
    });

    // Fetch title + thumb di background — tidak blokir playback
    fetchWithTimeout(`${API}/api/video/${id}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        if (currentVideoId !== id) return; // sesi berganti
        if (data?.title) {
          el.videoTitle.textContent = data.title;
          const href  = window.location.href;
          const thumb = data.thumb || null;
          if (typeof setVideoJsonLd === 'function') setVideoJsonLd(data.title, href, thumb, '');
          if (typeof setVideoMeta   === 'function') setVideoMeta(data.title, href, thumb, '');
        }
      })
      .catch(() => {});
  }

  function _openModal(id) {
    const url = `/watch/${id}`;
    if (!el.modal.classList.contains('hidden')) {
      // Modal sudah terbuka (klik related) — cukup ganti URL entry ini
      if (watchHistoryPushed) history.replaceState({ p1Watch: true, p1Vid: id }, '', url);
      return;
    }
    el.modal.classList.remove('hidden');
    if (window.VdryAds) VdryAds.reloadModalAds(el.modal);
    document.body.classList.add('modal-open');
    history.pushState({ p1Watch: true, p1Vid: id }, '', url);
    watchHistoryPushed = true;
  }

  function _doClosePlayer() {
    el.videoEl.pause();
    el.videoEl.removeAttribute('src');
    el.videoEl.load();
    el.playerLoading.classList.remove('hidden');
    el.videoEl.classList.add('hidden');
    el.modal.classList.add('hidden');
    document.body.classList.remove('modal-open');
    currentVideoId = null;
  }

  function closePlayer() {
    _doClosePlayer();
    if (typeof clearVideoJsonLd === 'function') clearVideoJsonLd();
    if (typeof clearVideoMeta   === 'function') clearVideoMeta();

    // Ganti entry /watch/:id dengan URL folder bersih — jangan back() karena
    // berisiko keluar dari folder ke halaman sebelumnya
    if (watchHistoryPushed) {
      watchHistoryPushed = false;
      replaceNav(currentFolder, currentPage, breadcrumbs);
    }
  }

  function retry() { if (retryFn) retryFn(); }

  /* ══════════════════════════════════
     ADD FOLDER
  ══════════════════════════════════ */
  async function doAdd() {
    const raw = el.addInput.value.trim();
    if (!raw) return;
    const id = parseInput(raw);
    if (!id) {
      el.addInput.style.borderColor = 'var(--rose)';
      setTimeout(() => el.addInput.style.borderColor = '', 1200);
      return;
    }

    el.addBtn.disabled = true;
    el.addInput.disabled = true;

    try {
      const resp = await fetchWithTimeout(`${API}/api/folder/${id}?p=1`);
      const data = resp.ok ? await resp.json() : null;
      const name = data?.title || id;
      addSaved(id, name);
    } catch {
      addSaved(id, id);
    } finally {
      el.addInput.value = '';
      el.addBtn.disabled = false;
      el.addInput.disabled = false;
      el.addInput.focus();
      renderSidebar(currentData?.folders || []);
      if (currentFolder === DEFAULT_FOLDER) renderMain(currentData);
    }
  }

  /* ══════════════════════════════════
     AUTO-REFRESH (3 min)
  ══════════════════════════════════ */
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(silentRefresh, 3 * 60 * 1000);
  }

  async function silentRefresh() {
    try {
      const resp = await fetchWithTimeout(`${API}/api/folder/${currentFolder}?p=${currentPage}`);
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.error) return;

      const prevV = new Set((currentData?.videos  || []).map(v => v.id));
      const prevF = new Set((currentData?.folders || []).map(f => f.id));
      const newV  = (data.videos  || []).filter(v => !prevV.has(v.id)).length;
      const newF  = (data.folders || []).filter(f => !prevF.has(f.id)).length;

      if (newV + newF > 0) {
        currentData = data;
        renderAll(data);
        showToast(`${newV + newF} ${_t('toast.newContent')}`);
      }
    } catch { /* silent */ }
    finally { scheduleRefresh(); }
  }

  /* ══════════════════════════════════
     TOAST
  ══════════════════════════════════ */
  function showToast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 3200);
  }

  /* ══════════════════════════════════
     EVENT LISTENERS
  ══════════════════════════════════ */
  el.addBtn.addEventListener('click', doAdd);
  el.addInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  el.backdrop.addEventListener('click', closePlayer);
  document.getElementById('p1ModalClose').addEventListener('click', closePlayer);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !el.modal.classList.contains('hidden')) closePlayer();
  });

  /* ── Share button ── */
  if (el.shareBtn) {
    el.shareBtn.addEventListener('click', async () => {
      if (!currentVideoId) return;
      const shareUrl   = `${location.origin}/watch/${currentVideoId}`;
      const shareTitle = el.videoTitle.textContent || 'Vidorey';

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

  /* ══════════════════════════════════
     INIT — resume from URL
  ══════════════════════════════════ */
  (() => {
    const params   = new URLSearchParams(location.search);
    const initId   = params.get('f') || DEFAULT_FOLDER;
    const initPage = parseInt(params.get('p')) || 1;

    if (initId !== DEFAULT_FOLDER) {
      breadcrumbs = [
        { id: DEFAULT_FOLDER, name: 'Home' },
        { id: initId, name: initId },
      ];
    }

    // Deep-link: /watch/:id — buka player langsung (video dari folder default)
    const watchMatch = location.pathname.match(/^\/watch\/([a-z0-9]+)$/i);

    replaceNav(initId, initPage, breadcrumbs);
    loadFolder(initId, initPage, false);

    if (watchMatch) {
      const vid = watchMatch[1];
      // entry history sudah ada (/watch/:id) — jangan push lagi
      watchHistoryPushed = true;
      openPlayer(vid, '', { fromHistory: true });
    }

    if (window.VdryAds) VdryAds.initVideoOverlay('p1');
    scheduleRefresh();
  })();

  return { openPlayer, closePlayer, retry, loadFolder };
})();
