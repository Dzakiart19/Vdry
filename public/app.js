/* ════════════════════════════════════════
   XPVid Browser — Frontend App
   ════════════════════════════════════════ */

const DEFAULT_FOLDER = 'e2bo9hcw9pe';

const App = (() => {
  /* ─── state ─── */
  let currentFolder = DEFAULT_FOLDER;
  let currentPage   = 1;
  let currentData   = null;
  let breadcrumbs   = [{ id: DEFAULT_FOLDER, name: 'Home' }];
  let searchQuery   = '';
  let retryFn       = null;

  /* ─── DOM refs ─── */
  const $  = id => document.getElementById(id);
  const el = {
    loading:    $('loadingState'),
    error:      $('errorState'),
    errorMsg:   $('errorMsg'),
    empty:      $('emptyState'),
    grid:       $('videoGrid'),
    pagination: $('pagination'),
    sidebar:    $('folderList'),
    breadcrumb: $('breadcrumb'),
    modal:      $('playerModal'),
    video:      $('videoPlayer'),
    videoTitle: $('videoTitle'),
    videoSub:   $('videoSubtitle'),
    search:     $('searchInput'),
  };

  /* ─── helpers ─── */
  function showState(name) {
    ['loading', 'error', 'empty'].forEach(s => el[s].classList.add('hidden'));
    if (name) el[name].classList.remove('hidden');
  }

  function thumbUrl(raw) {
    if (!raw) return '';
    if (raw.startsWith('https://i.xpvid.cc/')) {
      return '/proxy/thumb?url=' + encodeURIComponent(raw);
    }
    return raw;
  }

  /* ─── load folder ─── */
  async function loadFolder(id, page = 1) {
    currentFolder = id;
    currentPage   = page;
    searchQuery   = '';
    el.search.value = '';

    showState('loading');
    el.grid.innerHTML       = '';
    el.pagination.classList.add('hidden');
    el.sidebar.innerHTML    = '';

    try {
      const resp = await fetch(`/api/folder/${id}?p=${page}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      currentData = data;
      renderFolder(data);
    } catch (err) {
      retryFn = () => loadFolder(id, page);
      el.errorMsg.textContent = err.message || 'Gagal memuat folder.';
      showState('error');
    }
  }

  /* ─── render ─── */
  function renderFolder(data) {
    showState(null); // hapus loading/error/empty dulu
    renderBreadcrumb(data);
    renderSidebar(data.folders || []);
    renderFolderCards(data.folders || []);
    renderGrid(data.videos || []);
    renderPagination(data);
  }

  function renderBreadcrumb(data) {
    el.breadcrumb.innerHTML = '';

    // Always show root
    breadcrumbs.forEach((bc, i) => {
      const span = document.createElement('span');
      span.className = 'bc-item';
      span.textContent = bc.name || bc.id;
      span.dataset.id  = bc.id;

      if (i < breadcrumbs.length - 1) {
        span.addEventListener('click', () => {
          breadcrumbs = breadcrumbs.slice(0, i + 1);
          loadFolder(bc.id);
        });
        el.breadcrumb.appendChild(span);

        const sep = document.createElement('span');
        sep.className = 'bc-sep';
        sep.textContent = '/';
        el.breadcrumb.appendChild(sep);
      } else {
        el.breadcrumb.appendChild(span);
      }
    });
  }

  function renderSidebar(folders) {
    el.sidebar.innerHTML = '';

    if (folders.length === 0) {
      const msg = document.createElement('div');
      msg.style.cssText = 'padding:10px 10px;font-size:12px;color:var(--muted2)';
      msg.textContent = 'Tidak ada subfolder.';
      el.sidebar.appendChild(msg);
      return;
    }

    folders.forEach(f => {
      const item = document.createElement('div');
      item.className = 'folder-item';
      item.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
        </svg>
        <span>${escHtml(f.name || f.id)}</span>`;

      item.addEventListener('click', () => {
        breadcrumbs.push({ id: f.id, name: f.name || f.id });
        loadFolder(f.id);
      });

      el.sidebar.appendChild(item);
    });
  }

  function renderFolderCards(folders) {
    // Hapus folder cards lama jika ada
    const old = document.getElementById('folderCards');
    if (old) old.remove();
    if (!folders.length) return;

    const wrap = document.createElement('div');
    wrap.id = 'folderCards';
    wrap.innerHTML = `<div class="section-label">Folder</div>`;

    const grid = document.createElement('div');
    grid.className = 'folder-card-grid';

    folders.forEach(f => {
      const card = document.createElement('div');
      card.className = 'folder-card';
      card.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
        </svg>
        <span>${escHtml(f.name || f.id)}</span>`;
      card.addEventListener('click', () => {
        breadcrumbs.push({ id: f.id, name: f.name || f.id });
        loadFolder(f.id);
      });
      grid.appendChild(card);
    });

    wrap.appendChild(grid);

    // Sisipkan sebelum video grid
    el.grid.parentNode.insertBefore(wrap, el.grid);
  }

  function renderGrid(videos) {
    el.grid.innerHTML = '';

    const filtered = searchQuery
      ? videos.filter(v => v.name.toLowerCase().includes(searchQuery.toLowerCase()))
      : videos;

    if (filtered.length === 0) {
      // Hanya tampilkan empty kalau juga tidak ada folder cards
      if (!document.getElementById('folderCards')) showState('empty');
      return;
    }

    showState(null);

    filtered.forEach(v => {
      const card = document.createElement('div');
      card.className = 'video-card';

      const thumbSrc = thumbUrl(v.thumb);
      card.innerHTML = `
        <div class="thumb-wrap">
          ${thumbSrc
            ? `<img src="${escHtml(thumbSrc)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'no-thumb\\'><svg viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'1.5\\'><path d=\\'M15 10l4.553-2.069A1 1 0 0121 8.845v6.31a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z\\'/></svg></div>'">`
            : `<div class="no-thumb"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M15 10l4.553-2.069A1 1 0 0121 8.845v6.31a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/></svg></div>`
          }
          <div class="play-icon">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
        <div class="card-body">
          <div class="card-title">${escHtml(v.name || v.id)}</div>
        </div>`;

      card.addEventListener('click', () => openPlayer(v.id, v.name || v.id));
      el.grid.appendChild(card);
    });
  }

  function renderPagination(data) {
    el.pagination.innerHTML = '';
    if (!data.totalPages || data.totalPages <= 1) {
      el.pagination.classList.add('hidden');
      return;
    }

    el.pagination.classList.remove('hidden');

    // Prev
    const prev = pageBtn('‹', data.page <= 1);
    if (data.page > 1) prev.addEventListener('click', () => loadFolder(currentFolder, data.page - 1));
    el.pagination.appendChild(prev);

    // Pages
    for (let i = 1; i <= data.totalPages; i++) {
      const btn = pageBtn(i, false);
      if (i === data.page) btn.classList.add('active');
      else btn.addEventListener('click', () => loadFolder(currentFolder, i));
      el.pagination.appendChild(btn);
    }

    // Next
    const next = pageBtn('›', data.page >= data.totalPages);
    if (data.page < data.totalPages) next.addEventListener('click', () => loadFolder(currentFolder, data.page + 1));
    el.pagination.appendChild(next);
  }

  function pageBtn(label, disabled) {
    const btn = document.createElement('div');
    btn.className = 'page-btn';
    btn.textContent = label;
    if (disabled) btn.classList.add('active'); // reuse style for disabled arrows
    return btn;
  }

  /* ─── player ─── */
  async function openPlayer(id, name) {
    el.videoTitle.textContent = name || id;
    el.videoSub.textContent   = 'Memuat video…';
    el.video.removeAttribute('src');
    el.video.load();
    el.modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    try {
      const resp = await fetch(`/api/video/${id}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data.error) throw new Error(data.error);

      el.videoTitle.textContent = data.title || name;
      el.videoSub.textContent   = 'Klik play untuk memutar';

      // Use proxy stream (handles Referer)
      el.video.src = `/proxy/stream/${id}`;
      el.video.load();
      el.video.play().catch(() => {});
    } catch (err) {
      el.videoSub.textContent = '⚠️ Gagal: ' + (err.message || 'error');
    }
  }

  function closePlayer() {
    el.modal.classList.add('hidden');
    el.video.pause();
    el.video.removeAttribute('src');
    el.video.load();
    document.body.style.overflow = '';
  }

  function retry() {
    if (retryFn) retryFn();
  }

  /* ─── search ─── */
  let searchTimer;
  el.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = el.search.value.trim();
      if (currentData) renderGrid(currentData.videos || []);
    }, 250);
  });

  /* ─── keyboard ─── */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closePlayer();
  });

  /* ─── init ─── */
  loadFolder(DEFAULT_FOLDER);

  /* ─── utils ─── */
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return { openPlayer, closePlayer, retry, loadFolder };
})();
