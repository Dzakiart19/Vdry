/* ═══════════════════════════════════════════════════════════════════════
   Vidorey — Tri-Platform Video Browser
   Composition root: security middleware + mount tiga platform (terisolasi
   penuh satu sama lain) + monitor/health routes + SPA fallback.
   Detail per-platform ada di lib/scrapers/{p1,rb,yb}.js
═══════════════════════════════════════════════════════════════════════ */

const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const path    = require('path');

const { trackRequest, registerMonitorRoutes } = require('./lib/monitor');
const p1 = require('./lib/scrapers/p1');
const rb = require('./lib/scrapers/rb');
const yb = require('./lib/scrapers/yb');

const app  = express();
const PORT = process.env.PORT || 5000;

/* ── Security headers ── */
app.use(helmet({
  contentSecurityPolicy:     false, // dihandle manual karena proxy inline script
  crossOriginEmbedderPolicy: false, // video HLS butuh cross-origin resource
  crossOriginOpenerPolicy:   false, // Adsterra popunder perlu window.opener
  crossOriginResourcePolicy: false, // Firebase frontend beda origin — allow cross-origin load (img, video)
}));

/* ── CORS ── */
app.use(cors({
  origin(origin, cb) {
    // Izinkan: tanpa origin (curl/Postman), localhost (exact), *.replit.dev, *.replit.app
    if (!origin) return cb(null, true);
    let hostname, proto;
    try { const u = new URL(origin); hostname = u.hostname; proto = u.protocol; }
    catch { return cb(new Error('CORS: origin tidak valid'), false); }
    // Gunakan URL parsing agar "localhost.evil.com" tidak lolos prefix check
    const ok = (
      (hostname === 'localhost')                                        ||
      (hostname.endsWith('.replit.dev')  && proto === 'https:')        ||
      (hostname.endsWith('.replit.app')  && proto === 'https:')        ||
      origin === 'https://vidorey.web.app'                             ||
      origin === 'https://vidorey.firebaseapp.com'
    );
    cb(ok ? null : new Error('CORS: origin tidak diizinkan'), ok);
  },
  methods: ['GET', 'HEAD'],
  allowedHeaders: ['Range', 'Content-Type'],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type'],
  credentials: false,
}));

app.use(express.static(path.join(__dirname, 'public')));

/* ── Monitor middleware: catat setiap request API ── */
app.use(trackRequest);

/* ── Tiga platform, terisolasi penuh — tidak ada path yang overlap ── */
app.use(p1.router);
app.use(rb.router);
app.use(yb.router);

/* ── Monitor & health — cache stats digabung read-only dari ketiga platform.
   Urutan & daftar persis meniru server.js lama (ybFreshSessionCache sengaja
   tidak dimasukkan di sana, jadi tetap tidak dimasukkan di sini). ── */
registerMonitorRoutes(app, {
  getCacheStats: () => [
    p1.caches[0],                                  // videoUrlCache
    rb.caches[0], rb.caches[1], rb.caches[2],       // m3u8Cache, postsCache, freshSessionCache
    yb.caches[0], yb.caches[1],                     // ybM3u8Cache, ybPostsCache
  ].map(c => c.stats()),
});

/* ═══════════════════════════════════════
   SPA FALLBACK
═══════════════════════════════════════ */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
