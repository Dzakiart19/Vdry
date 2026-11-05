/* VIDOREY — Runtime Config
   File ini JANGAN diedit manual.
   URL backend di-inject otomatis oleh deploy.sh saat deploy ke Firebase.

   - Replit dev / preview (*.replit.dev, *.replit.app, localhost, 127.0.0.1)
     → BACKEND_URL = '' (relative, langsung ke server ini)
   - Koyeb (*.koyeb.app) — frontend & backend satu server
     → BACKEND_URL = '' (relative, langsung ke server ini)
   - Firebase production (vidorey.web.app, dll)
     → BACKEND_URL = URL Replit backend (di-inject deploy.sh dari REPLIT_BACKEND_URL secret)
*/
(function () {
  var h = window.location.hostname;
  var isSelfHosted =
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h.endsWith('.replit.dev') ||
    h.endsWith('.replit.app') ||
    h.endsWith('.koyeb.app');
  window.BACKEND_URL = isSelfHosted ? '' : 'https://hungry-dyann-dzeckyete-cca268ec.koyeb.app';
})();
