/* VIDOREY — Runtime Config
   Auto-detect environment:
   - Replit dev / preview (*.replit.dev, *.replit.app, localhost) → URL relatif ('')
   - Firebase production (vidorey.web.app, dll) → URL Replit backend */
(function () {
  var h = window.location.hostname;
  var isReplit =
    h === 'localhost' ||
    h.endsWith('.replit.dev') ||
    h.endsWith('.replit.app');
  window.BACKEND_URL = isReplit ? '' : 'https://vidorey--lturner686.replit.app';
})();
