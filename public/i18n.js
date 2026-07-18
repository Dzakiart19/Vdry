/* ═══════════════════════════════════════
   Vidorey — i18n Language Module
   Toggle EN/ID. Saved in localStorage.
   Usage:
     HTML: data-i18n="key"          → el.textContent
           data-i18n-html="key"     → el.innerHTML  (for <strong> etc.)
           data-i18n-placeholder="key" → el.placeholder
     JS:   _t('key')                → translated string
   Lang change event: window listens to 'langchange' {detail:{lang}}
═══════════════════════════════════════ */
(function () {
  'use strict';

  var STORAGE_KEY = 'vidorey_lang';
  var DEFAULT = 'id';

  var T = {
    id: {
      /* ── Navigation ── */
      'nav.select'   : 'Pilih Platform',
      'nav.other'    : 'Fitur Lain',
      'nav.p1'       : 'Folder video \xb7 streaming',
      'nav.p2'       : 'Video harian \xb7 cari & tonton',
      'nav.p8'       : 'Homemade amateur \xb7 real people',
      'nav.tp.label' : 'Platform Video',
      'nav.tp.p1'    : 'Platform 1 \xb7 pencarian video',
      'nav.tp.p2'    : 'Platform 2 \xb7 streaming video',
      'nav.tp.p3'    : 'Platform 3 \xb7 video premium',
      'nav.tp.p4'    : 'Platform 4 \xb7 video dewasa',
      'nav.tp'       : 'TikTok 1 \xb7 scroll vertikal',
      'smartlink.name': 'Situs Partner',
      'smartlink.desc': 'Situs video dewasa gratis lainnya',
      /* ── Search ── */
      'search.ph'    : 'Cari video\u2026',
      'search.btn'   : 'Cari',
      /* ── Category picker ── */
      'cat.btn'      : 'Kategori',
      'cat.all'      : 'Semua Kategori',
      'cat.loading'  : 'Memuat\u2026',
      'cat.empty'    : 'Kategori tidak tersedia.',
      /* ── States ── */
      'state.loading': 'Memuat\u2026',
      'state.empty'  : 'Tidak ada video ditemukan.',
      'state.retry'  : 'Coba lagi',
      'state.p1empty': 'Folder ini kosong.',
      'state.p1unavail': 'Layanan Sementara Tidak Tersedia',
      /* ── Errors ── */
      'err.base'     : 'Terjadi kesalahan.',
      'err.content'  : 'Gagal memuat konten. Periksa koneksi internet atau coba lagi.',
      'err.video'    : 'Gagal memuat video. Periksa koneksi internet atau coba lagi.',
      'err.hls'      : 'Browser tidak mendukung HLS playback',
      'err.stream'   : 'Stream terputus \u2014 klik video lagi untuk reload',
      /* ── Player ── */
      'player.loading': 'Memuat video\u2026',
      'player.back'  : 'Kembali',
      'player.share' : 'Bagikan',
      'player.related': 'Video Lainnya',
      'player.folder': 'Video di Folder Ini',
      /* ── Toasts ── */
      'toast.noShare': 'Gagal membagikan link.',
      'toast.copied' : 'Link video disalin ke clipboard',
      'toast.newContent': 'konten baru ditemukan',
      /* ── Additional keys ── */
      'err.video.title': 'Gagal memuat video',
      'err.video.app' : 'Gagal memuat video. Coba lagi.',
      'tp.err.play'   : 'Gagal memutar video. Geser ke video lain.',
      'tp.err.browser': 'Browser tidak mendukung format video ini.',
      'tp.err.load'   : 'Gagal memuat video. Coba geser ke video lain.',
      'tp.err.load2'  : 'Gagal memuat video. Periksa koneksi internet.',
      /* ── Headings (built in JS) ── */
      'heading.search': 'Hasil cari',
      'heading.cat'  : 'Kategori',
      'heading.clear': '\u2715 Semua',
      'heading.clearSearch': '\u2715 Hapus',
      /* ── Welcome popup ── */
      'welcome.title': 'Selamat Datang di Vidorey',
      'welcome.sub'  : 'Platform video gratis, update setiap hari',
      'welcome.li1'  : '<strong>Gratis</strong> \u2014 tidak perlu daftar atau bayar apapun',
      'welcome.li2'  : '<strong>Update setiap hari</strong> \u2014 konten baru selalu hadir',
      'welcome.li3'  : '<strong>Enjoy nonton</strong> \u2014 putar langsung, tanpa ribet',
      'welcome.check': 'Jangan tampilkan lagi',
      'welcome.btn'  : 'Mulai Nonton \u2192',
      /* ── TP specific ── */
      'tp.mute'      : 'Aktifkan suara',
      'tp.unmute'    : 'Matikan suara',
      'tp.search.ph' : 'Cari\u2026',
    },
    en: {
      /* ── Navigation ── */
      'nav.select'   : 'Select Platform',
      'nav.other'    : 'Other Features',
      'nav.p1'       : 'Video folders \xb7 streaming',
      'nav.p2'       : 'Daily videos \xb7 search & watch',
      'nav.p8'       : 'Homemade amateur \xb7 real people',
      'nav.tp.label' : 'Video Platform',
      'nav.tp.p1'    : 'Platform 1 \xb7 video search',
      'nav.tp.p2'    : 'Platform 2 \xb7 video streaming',
      'nav.tp.p3'    : 'Platform 3 \xb7 premium videos',
      'nav.tp.p4'    : 'Platform 4 \xb7 adult videos',
      'nav.tp'       : 'TikTok 1 \xb7 vertical scroll',
      'smartlink.name': 'Partner Sites',
      'smartlink.desc': 'More free adult sites',
      /* ── Search ── */
      'search.ph'    : 'Search videos\u2026',
      'search.btn'   : 'Search',
      /* ── Category picker ── */
      'cat.btn'      : 'Categories',
      'cat.all'      : 'All Categories',
      'cat.loading'  : 'Loading\u2026',
      'cat.empty'    : 'No categories available.',
      /* ── States ── */
      'state.loading': 'Loading\u2026',
      'state.empty'  : 'No videos found.',
      'state.retry'  : 'Try again',
      'state.p1empty': 'This folder is empty.',
      'state.p1unavail': 'Service Temporarily Unavailable',
      /* ── Errors ── */
      'err.base'     : 'An error occurred.',
      'err.content'  : 'Failed to load content. Check your internet connection and try again.',
      'err.video'    : 'Failed to load video. Check your internet connection and try again.',
      'err.hls'      : 'Browser does not support HLS playback',
      'err.stream'   : 'Stream disconnected \u2014 click video again to reload',
      /* ── Player ── */
      'player.loading': 'Loading video\u2026',
      'player.back'  : 'Back',
      'player.share' : 'Share',
      'player.related': 'More Videos',
      'player.folder': 'Videos in This Folder',
      /* ── Toasts ── */
      'toast.noShare': 'Failed to share link.',
      'toast.copied' : 'Video link copied to clipboard',
      'toast.newContent': 'new content found',
      /* ── Additional keys ── */
      'err.video.title': 'Failed to load video',
      'err.video.app' : 'Failed to load video. Try again.',
      'tp.err.play'   : 'Failed to play video. Swipe to another.',
      'tp.err.browser': 'Browser does not support this video format.',
      'tp.err.load'   : 'Failed to load video. Try swiping to another.',
      'tp.err.load2'  : 'Failed to load video. Check your connection.',
      /* ── Headings ── */
      'heading.search': 'Search results',
      'heading.cat'  : 'Category',
      'heading.clear': '\u2715 All',
      'heading.clearSearch': '\u2715 Clear',
      /* ── Welcome popup ── */
      'welcome.title': 'Welcome to Vidorey',
      'welcome.sub'  : 'Free video platform, updated daily',
      'welcome.li1'  : '<strong>Free</strong> \u2014 no sign-up or payment required',
      'welcome.li2'  : '<strong>Updated daily</strong> \u2014 new content always available',
      'welcome.li3'  : '<strong>Enjoy watching</strong> \u2014 play instantly, hassle-free',
      'welcome.check': "Don\u2019t show again",
      'welcome.btn'  : 'Start Watching \u2192',
      /* ── TP specific ── */
      'tp.mute'      : 'Unmute',
      'tp.unmute'    : 'Mute',
      'tp.search.ph' : 'Search\u2026',
    }
  };

  /* ── Current lang ── */
  var _lang = localStorage.getItem(STORAGE_KEY) || DEFAULT;

  /* ── t() — get translation ── */
  function t(key) {
    var d = T[_lang] || T[DEFAULT];
    return d[key] !== undefined ? d[key] : (T[DEFAULT][key] || key);
  }

  /* ── Apply all data-i18n* attributes in document ── */
  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    /* Update toggle button label */
    var btn = document.getElementById('langToggle');
    if (btn) btn.textContent = _lang === 'id' ? 'EN' : 'ID';
    /* Update <html lang> */
    document.documentElement.lang = _lang === 'id' ? 'id' : 'en';
  }

  /* ── setLang / toggleLang ── */
  function setLang(lang) {
    _lang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    applyTranslations();
    window.dispatchEvent(new CustomEvent('langchange', { detail: { lang: lang } }));
  }

  function toggleLang() {
    setLang(_lang === 'id' ? 'en' : 'id');
  }

  /* ── Expose globally ── */
  window._t = t;
  window.VDRY_I18N = { t: t, setLang: setLang, getLang: function () { return _lang; } };

  /* ── Boot: apply on DOMContentLoaded, attach toggle button ── */
  function boot() {
    applyTranslations();
    var btn = document.getElementById('langToggle');
    if (btn) btn.addEventListener('click', toggleLang);
    /* Also wire TP toggle if page has it */
    var tpBtn = document.getElementById('langToggleTp');
    if (tpBtn) tpBtn.addEventListener('click', toggleLang);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
