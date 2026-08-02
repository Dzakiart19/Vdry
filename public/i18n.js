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
      'nav.select'   : 'Pilih Platform 🔥',
      'nav.other'    : 'Fitur Lain',
      'nav.p1'       : 'Folder bokep · streaming 💦',
      'nav.p2'       : 'Update harian · cari & tonton 🥵',
      'nav.p3'       : 'Bokep segar · cari & tonton 🫦',
      'nav.p4'       : 'Video panas · cari & tonton 🔥',
      'nav.p5'       : 'Koleksi hot · cari & tonton 💦',
      'nav.p6'       : 'Video Asia hot · cari & tonton 🥵',
      'nav.p7'       : 'Streaming langsung · tonton sekarang 🔞',
      'nav.p8'       : 'Homemade asli · amateur hot 🫦',
      'nav.er'       : 'Album erotis · foto & video 💦',
      'nav.p9'       : 'Album erotis · foto & video 💦',
      'nav.tp.label' : 'Platform Video 🔥',
      'nav.tp.p1'    : 'Platform 1 · cari video panas',
      'nav.tp.p2'    : 'Platform 2 · streaming video hot',
      'nav.tp.p3'    : 'Platform 3 · video premium',
      'nav.tp.p4'    : 'Platform 4 · video dewasa',
      'nav.tp'       : 'Scroll video panas · gaya TikTok 🥵',
      'smartlink.name': 'Situs Partner 🔞',
      'smartlink.desc': 'Situs bokep gratis lainnya, gas',
      /* ── Search ── */
      'search.ph'    : 'Cari video panas… 🔥',
      'search.btn'   : 'Cari',
      /* ── Category picker ── */
      'cat.btn'      : 'Kategori 🫦',
      'cat.all'      : 'Semua Kategori',
      'cat.loading'  : 'Sabar… 💦',
      'cat.empty'    : 'Kategori kosong nih.',
      /* ── States ── */
      'state.loading': 'Lagi nyari yang hot… 💦',
      'state.empty'  : 'Kosong nih, coba keyword lain 🥵',
      'state.retry'  : 'Coba lagi',
      'state.p1empty': 'Folder ini kosong, coba folder lain.',
      'state.p1unavail': 'Lagi gangguan, coba lagi bentar',
      /* ── Errors ── */
      'err.base'     : 'Ada error nih, coba lagi.',
      'err.content'  : 'Gagal muat konten 😓 Cek koneksi kamu & coba lagi.',
      'err.video'    : 'Video gagal muat 😓 Cek koneksi & coba lagi.',
      'err.hls'      : 'Browser kamu gak support format ini',
      'err.stream'   : 'Stream putus — klik video lagi buat reload',
      /* ── Player ── */
      'player.loading': 'Nyiapin video panas… 💦',
      'player.back'  : 'Balik',
      'player.share' : 'Bagikan',
      'player.download': 'Download',
      'player.related': 'Video Panas Lainnya 🔥',
      'player.folder': 'Video Lain di Folder Ini 🫦',
      /* ── Toasts ── */
      'toast.noShare': 'Gagal bagiin link.',
      'toast.copied' : 'Link video udah disalin 💦',
      'toast.newContent': 'ada konten baru nih',
      /* ── Additional keys ── */
      'err.video.title': 'Video gagal muat',
      'err.video.app' : 'Video gagal muat. Coba lagi.',
      'tp.err.play'   : 'Gagal putar. Geser ke video lain.',
      'tp.err.browser': 'Browser kamu gak support format ini.',
      'tp.err.load'   : 'Gagal muat video. Geser ke yang lain.',
      'tp.err.load2'  : 'Gagal muat video. Cek koneksi kamu.',
      /* ── Headings (built in JS) ── */
      'heading.search': 'Hasil pencarian 🔥',
      'heading.cat'  : 'Kategori',
      'heading.clear': '✕ Semua',
      'heading.clearSearch': '✕ Hapus',
      /* ── Welcome popup ── */
      'welcome.title': 'Selamat Datang di Vidorey 🔥',
      'welcome.sub'  : 'Platform bokep gratis, update tiap hari 💦',
      'welcome.li1'  : '<strong>Gratis</strong> — gak perlu daftar atau bayar, langsung gas 🥵',
      'welcome.li2'  : '<strong>Update tiap hari</strong> — konten hot selalu hadir 💦',
      'welcome.li3'  : '<strong>Putar langsung</strong> — tanpa ribet, langsung enak 🫦',
      'welcome.check': 'Jangan tampilkan lagi',
      'welcome.btn'  : 'Gas Sekarang 🔥',
      /* ── TP specific ── */
      'tp.mute'      : 'Aktifkan suara',
      'tp.unmute'    : 'Matikan suara',
      'tp.search.ph' : 'Cari yang panas… 🔥',
    },
    en: {
      /* ── Navigation ── */
      'nav.select'   : 'Pick a Platform 🔥',
      'nav.other'    : 'More Features',
      'nav.p1'       : 'Porn folders · stream now 💦',
      'nav.p2'       : 'Daily updates · search & watch 🥵',
      'nav.p3'       : 'Fresh porn · search & watch 🫦',
      'nav.p4'       : 'Hot videos · search & watch 🔥',
      'nav.p5'       : 'Hot collection · search & watch 💦',
      'nav.p6'       : 'Hot Asian vids · search & watch 🥵',
      'nav.p7'       : 'Direct streaming · watch now 🔞',
      'nav.p8'       : 'Real homemade · amateur 🫦',
      'nav.er'       : 'Erotic albums · photos & videos 💦',
      'nav.p9'       : 'Erotic albums · photos & videos 💦',
      'nav.tp.label' : 'Video Platform 🔥',
      'nav.tp.p1'    : 'Platform 1 · search hot videos',
      'nav.tp.p2'    : 'Platform 2 · hot video stream',
      'nav.tp.p3'    : 'Platform 3 · premium videos',
      'nav.tp.p4'    : 'Platform 4 · adult videos',
      'nav.tp'       : 'Scroll hot videos · TikTok style 🥵',
      'smartlink.name': 'Partner Sites 🔞',
      'smartlink.desc': 'More free porn sites, go',
      /* ── Search ── */
      'search.ph'    : 'Search hot videos… 🔥',
      'search.btn'   : 'Search',
      /* ── Category picker ── */
      'cat.btn'      : 'Categories 🫦',
      'cat.all'      : 'All Categories',
      'cat.loading'  : 'Hold on… 💦',
      'cat.empty'    : 'No categories here.',
      /* ── States ── */
      'state.loading': 'Finding the hot stuff… 💦',
      'state.empty'  : 'Nothing here, try another keyword 🥵',
      'state.retry'  : 'Try again',
      'state.p1empty': 'Folder is empty, try another.',
      'state.p1unavail': 'Down for now, try again later',
      /* ── Errors ── */
      'err.base'     : 'Something went wrong, try again.',
      'err.content'  : 'Content failed to load 😓 Check your connection & retry.',
      'err.video'    : 'Video failed to load 😓 Check your connection & retry.',
      'err.hls'      : 'Your browser doesn\u2019t support this format',
      'err.stream'   : 'Stream dropped — click the video again to reload',
      /* ── Player ── */
      'player.loading': 'Loading the good stuff… 💦',
      'player.back'  : 'Back',
      'player.share' : 'Share',
      'player.download': 'Download',
      'player.related': 'More Hot Videos 🔥',
      'player.folder': 'More in This Folder 🫦',
      /* ── Toasts ── */
      'toast.noShare': 'Failed to share link.',
      'toast.copied' : 'Video link copied 💦',
      'toast.newContent': 'new content dropped',
      /* ── Additional keys ── */
      'err.video.title': 'Video failed to load',
      'err.video.app' : 'Video failed to load. Try again.',
      'tp.err.play'   : 'Failed to play. Swipe to another.',
      'tp.err.browser': 'Your browser doesn\u2019t support this format.',
      'tp.err.load'   : 'Failed to load. Try swiping to another.',
      'tp.err.load2'  : 'Failed to load. Check your connection.',
      /* ── Headings ── */
      'heading.search': 'Search results 🔥',
      'heading.cat'  : 'Category',
      'heading.clear': '✕ All',
      'heading.clearSearch': '✕ Clear',
      /* ── Welcome popup ── */
      'welcome.title': 'Welcome to Vidorey 🔥',
      'welcome.sub'  : 'Free porn platform, updated daily 💦',
      'welcome.li1'  : '<strong>Free</strong> — no sign-up, no payment, just watch 🥵',
      'welcome.li2'  : '<strong>Updated daily</strong> — hot new content always dropping 💦',
      'welcome.li3'  : '<strong>Play instantly</strong> — no hassle, just enjoy 🫦',
      'welcome.check': "Don\u2019t show again",
      'welcome.btn'  : 'Let\u2019s Go 🔥',
      /* ── TP specific ── */
      'tp.mute'      : 'Unmute',
      'tp.unmute'    : 'Mute',
      'tp.search.ph' : 'Search hot stuff… 🔥',
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
    if (btn) btn.textContent = _lang === 'id' ? 'ID' : 'EN';
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
