/* ═══════════════════════════════════════════
   VIDOREY — Runtime Config
   Auto-detect backend URL berdasarkan hostname:
   - vidorey.web.app / firebaseapp.com → URL production Replit
   - *.replit.dev / *.replit.app / localhost → relatif (server sama)
═══════════════════════════════════════════ */
(function () {
  var h = window.location.hostname;
  if (h === 'vidorey.web.app' || h === 'vidorey.firebaseapp.com') {
    window.BACKEND_URL = 'https://vdry--dzeckj1tsovba.replit.app';
  } else {
    window.BACKEND_URL = '';
  }
})();
