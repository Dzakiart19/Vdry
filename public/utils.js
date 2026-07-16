'use strict';
/* ── Vidorey shared utilities — VideoObject JSON-LD for SEO ── */

/** Inject or update VideoObject JSON-LD schema di <head> saat video dibuka. */
window.setVideoJsonLd = function (title, contentUrl, thumbnailUrl, description) {
  var el = document.getElementById('vidorey-jsonld');
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id   = 'vidorey-jsonld';
    document.head.appendChild(el);
  }
  var schema = {
    '@context': 'https://schema.org',
    '@type':    'VideoObject',
    name:         title || 'Video',
    description:  description || title || 'Free video streaming on Vidorey',
    thumbnailUrl: thumbnailUrl || '',
    contentUrl:   contentUrl  || window.location.href,
    embedUrl:     window.location.href,
  };
  el.textContent = JSON.stringify(schema);
};

/** Hapus VideoObject JSON-LD (panggil saat player ditutup / video baru dibuka). */
window.clearVideoJsonLd = function () {
  var el = document.getElementById('vidorey-jsonld');
  if (el) el.remove();
};

/* ── Dynamic canonical + Open Graph / Twitter Card per video ──────
   Saat video dibuka, URL yang dibagikan (link token /rb/watch/<token>
   dkk) harus match dengan meta tag di <head> — supaya preview di
   WhatsApp/Telegram/Facebook/X menampilkan judul & thumbnail video
   yang benar, bukan judul generik halaman listing.
   Nilai asli halaman disimpan sekali (lazy) supaya clearVideoMeta()
   bisa mengembalikannya saat player ditutup.
─────────────────────────────────────────────────────────────────── */
var _vdryOrigMeta = null;

function _vdryGetMetaEl(selector) {
  return document.querySelector(selector);
}

function _vdrySaveOrigMeta() {
  if (_vdryOrigMeta) return; // sudah tersimpan
  var canonicalEl = _vdryGetMetaEl('link[rel="canonical"]');
  _vdryOrigMeta = {
    canonical:        canonicalEl ? canonicalEl.getAttribute('href') : null,
    ogUrl:            _vdryMetaContent('meta[property="og:url"]'),
    ogTitle:          _vdryMetaContent('meta[property="og:title"]'),
    ogDescription:    _vdryMetaContent('meta[property="og:description"]'),
    ogImage:          _vdryMetaContent('meta[property="og:image"]'),
    twitterTitle:     _vdryMetaContent('meta[name="twitter:title"]'),
    twitterDescription: _vdryMetaContent('meta[name="twitter:description"]'),
    twitterImage:     _vdryMetaContent('meta[name="twitter:image"]'),
  };
}

function _vdryMetaContent(selector) {
  var el = _vdryGetMetaEl(selector);
  return el ? el.getAttribute('content') : null;
}

function _vdrySetMetaContent(selector, value) {
  if (value == null) return;
  var el = _vdryGetMetaEl(selector);
  if (el) el.setAttribute('content', value);
}

/** Update canonical + OG/Twitter meta ke URL & info video yang sedang dibuka. */
window.setVideoMeta = function (title, url, imageUrl, description) {
  _vdrySaveOrigMeta();

  var canonicalEl = _vdryGetMetaEl('link[rel="canonical"]');
  if (canonicalEl) canonicalEl.setAttribute('href', url);

  var desc = description || title || '';
  _vdrySetMetaContent('meta[property="og:url"]',             url);
  _vdrySetMetaContent('meta[property="og:title"]',            title);
  _vdrySetMetaContent('meta[property="og:description"]',      desc);
  if (imageUrl) _vdrySetMetaContent('meta[property="og:image"]', imageUrl);
  _vdrySetMetaContent('meta[name="twitter:title"]',            title);
  _vdrySetMetaContent('meta[name="twitter:description"]',      desc);
  if (imageUrl) _vdrySetMetaContent('meta[name="twitter:image"]', imageUrl);
};

/* ── Kategori picker (dropdown) — dipakai bersama di rb/yb/bk/sb ─────────
   Fetch daftar kategori sekali (lazy) dari `apiPath`, render sebagai chip
   di dalam panel dropdown. Klik chip → callback onSelect(item) dengan
   { id, slug, name }. "Semua Kategori" mengirim null untuk reset filter.
─────────────────────────────────────────────────────────────────────── */
window.initVdryCategoryPicker = function (opts) {
  var btn      = opts.button;
  var panel    = opts.panel;
  var apiPath  = opts.apiPath;
  var onSelect = opts.onSelect;
  var getActiveId = opts.getActiveId || function () { return null; };
  var list = null; // null = belum di-fetch, [] = sudah tapi kosong

  function render() {
    if (list === null) { panel.innerHTML = '<div class="vdry-cat-panel-empty">Memuat…</div>'; return; }
    if (!list.length)  { panel.innerHTML = '<div class="vdry-cat-panel-empty">Kategori tidak tersedia.</div>'; return; }
    var activeId = getActiveId();
    var chips = ['<button type="button" class="vdry-cat-chip' + (activeId ? '' : ' active') + '" data-id="">Semua Kategori</button>'];
    list.forEach(function (c) {
      var isActive = String(activeId) === String(c.id || c.slug);
      chips.push('<button type="button" class="vdry-cat-chip' + (isActive ? ' active' : '') + '" data-id="' +
        String(c.id != null ? c.id : c.slug) + '">' + escHtmlLocal(c.name) + (c.count != null ? ' (' + c.count + ')' : '') + '</button>');
    });
    panel.innerHTML = chips.join('');
    panel.querySelectorAll('.vdry-cat-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var id = chip.getAttribute('data-id');
        close();
        if (!id) { onSelect(null); return; }
        var item = list.find(function (c) { return String(c.id != null ? c.id : c.slug) === id; });
        onSelect(item || null);
      });
    });
  }

  function escHtmlLocal(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function open() {
    btn.classList.add('open');
    panel.classList.add('open');
    if (list === null) {
      render();
      fetch(apiPath).then(function (r) { return r.ok ? r.json() : []; })
        .then(function (data) { list = Array.isArray(data) ? data : []; render(); })
        .catch(function () { list = []; render(); });
    } else {
      render();
    }
  }

  function close() {
    btn.classList.remove('open');
    panel.classList.remove('open');
  }

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (panel.classList.contains('open')) close(); else open();
  });
  document.addEventListener('click', function (e) {
    if (!panel.contains(e.target) && e.target !== btn) close();
  });

  return { close: close, refreshLabel: render };
};

/** Kembalikan canonical + OG/Twitter meta ke nilai asli halaman (panggil saat player ditutup). */
window.clearVideoMeta = function () {
  if (!_vdryOrigMeta) return;
  var canonicalEl = _vdryGetMetaEl('link[rel="canonical"]');
  if (canonicalEl && _vdryOrigMeta.canonical) canonicalEl.setAttribute('href', _vdryOrigMeta.canonical);

  _vdrySetMetaContent('meta[property="og:url"]',        _vdryOrigMeta.ogUrl);
  _vdrySetMetaContent('meta[property="og:title"]',       _vdryOrigMeta.ogTitle);
  _vdrySetMetaContent('meta[property="og:description"]', _vdryOrigMeta.ogDescription);
  _vdrySetMetaContent('meta[property="og:image"]',       _vdryOrigMeta.ogImage);
  _vdrySetMetaContent('meta[name="twitter:title"]',       _vdryOrigMeta.twitterTitle);
  _vdrySetMetaContent('meta[name="twitter:description"]', _vdryOrigMeta.twitterDescription);
  _vdrySetMetaContent('meta[name="twitter:image"]',       _vdryOrigMeta.twitterImage);
};
