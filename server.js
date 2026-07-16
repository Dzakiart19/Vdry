/* ═══════════════════════════════════════════════════════════════════════
   Vidorey — Hexa-Platform Video Browser
   Composition root: security middleware + mount enam platform (terisolasi
   penuh satu sama lain) + monitor/health routes + SPA fallback.
   Detail per-platform ada di lib/scrapers/{p1,rb,yb,bk,tp,sb}.js
═══════════════════════════════════════════════════════════════════════ */

const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const path      = require('path');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

const { trackRequest, registerMonitorRoutes } = require('./lib/monitor');
const { resolveToken } = require('./lib/shortlink');
const p1 = require('./lib/scrapers/p1');
const rb = require('./lib/scrapers/rb');
const yb = require('./lib/scrapers/yb');
const bk = require('./lib/scrapers/bk');
const tp = require('./lib/scrapers/tp');
const sb = require('./lib/scrapers/sb');
const xn = require('./lib/scrapers/xn');

const app  = express();
const PORT = process.env.PORT || 5000;

/* Replit menempatkan app di belakang satu reverse proxy (mTLS proxy).
   Tanpa ini, req.ip selalu mengarah ke IP proxy internal — bukan IP
   client asli — sehingga express-rate-limit akan menganggap SEMUA
   pengunjung sebagai satu IP yang sama dan saling membatasi satu sama
   lain. `1` = percayai persis satu hop proxy di depan app. */
app.set('trust proxy', 1);
// SSE route (/monitor/events) harus di-exclude dari compression:
// compression() mem-buffer data untuk dikompresi, sehingga res.write() pada
// SSE stream tidak pernah di-flush ke client → browser stuck "Connecting…"
app.use(compression({
  filter: (req, res) => {
    if (req.path === '/monitor/events') return false;
    return compression.filter(req, res);
  }
}));

/* ── Security headers ──────────────────────────────────────────────────
   CSP: 'unsafe-inline' terpaksa dipakai di script-src/style-src karena
   index.html/rb.html/yb.html masih pakai inline <script> dan inline
   onclick/onerror handler — tanpa itu UI akan langsung rusak total.
   Proteksi nyata datang dari: object-src none, base-uri self,
   frame-ancestors self, dan blokir sumber non-https/data: untuk script.
   /embed/:id sengaja override frame-ancestors-nya sendiri (lihat p1.js)
   supaya masih bisa di-iframe oleh Firebase frontend. ── */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc: [
        "'self'", "'unsafe-inline'",
        // Google Tag Manager
        'https://www.googletagmanager.com',
        // hls.js (rb.html + yb.html)
        'https://cdn.jsdelivr.net',
        // Adsterra ad network
        'https://pl28423230.effectivecpmnetwork.com',
        'https://pl28418540.effectivecpmnetwork.com',
        'https://pl28427857.effectivecpmnetwork.com',
        'https://www.highperformanceformat.com',
        // Adsterra / profitableratecpm (Platform 5 tp.html)
        'https://pl26548697.profitableratecpm.com',
        'https://pl26548687.profitableratecpm.com',
        // Adsterra 728×90 leaderboard + 468×60 banner (semua listing pages)
        'https://turbulentrefreshments.com',

      ],
      styleSrc:  ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc:    ["'self'", 'data:', 'https:'],
      fontSrc:   ["'self'", 'https://fonts.gstatic.com', 'data:'],
      mediaSrc:       ["'self'", 'blob:', 'https:'],
      connectSrc: [
        "'self'",
        // GA4 measurement beacons (dikirim via GTM) — tanpa ini connect-src
        // 'self' memblokir semua request analytics, GA4 tidak pernah dapat data.
        'https://www.google-analytics.com',
        'https://*.google-analytics.com',
        'https://analytics.google.com',
        'https://www.googletagmanager.com',
        'https://www.google.com',
      ],
      frameSrc:       ['https:'],
      objectSrc:      ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
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
      (hostname.endsWith('.koyeb.app')   && proto === 'https:')        ||
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

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '2h',
  etag:   true,
}));

/* ── Monitor middleware: catat setiap request API ── */
app.use(trackRequest);

/* ── Rate limiting ────────────────────────────────────────────────────
   Melindungi upstream (xpvid.cc/ruangbokep.ws/yobokep.com) dari spam
   scraping dan mencegah server sendiri dibanjiri request.
   - /api/* — endpoint scraping (folder/posts/video info), limit ketat
     karena tiap hit memicu HTTP request baru ke situs sumber.
   - /proxy/* — stream/HLS segment & thumbnail, limit jauh lebih longgar
     karena satu video normal saja bisa memicu puluhan-ratusan hit
     (tiap segmen .ts, tiap thumbnail di grid) dalam waktu singkat. ── */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak permintaan, coba lagi sebentar lagi.' },
});
const proxyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak permintaan, coba lagi sebentar lagi.' },
});
app.use('/api', apiLimiter);
app.use('/proxy', proxyLimiter);

/* ── Tujuh platform, terisolasi penuh — tidak ada path yang overlap ── */
app.use(p1.router);
app.use(rb.router);
app.use(yb.router);
app.use(bk.router);
app.use(tp.router);
app.use(sb.router);
app.use(xn.router);

/* ── Monitor & health — cache stats digabung read-only dari semua platform.
   Urutan & daftar persis meniru server.js lama (ybFreshSessionCache sengaja
   tidak dimasukkan di sana, jadi tetap tidak dimasukkan di sini). ── */
registerMonitorRoutes(app, {
  getCacheStats: () => [
    p1.caches[0],                                   // p1: videoUrlCache
    rb.caches[0], rb.caches[1], rb.caches[2], rb.caches[3], // p2: m3u8Cache, postsCache, freshSessionCache, rbVideoCache
    yb.caches[0], yb.caches[1], yb.caches[2], yb.caches[3], // p3: ybM3u8Cache, ybPostsCache, ybVideoCache, ybThumbCache
    bk.caches[0], bk.caches[1], bk.caches[2],               // p4: bkPostsCache, bkVideoUrlCache, bkThumbCache
    tp.caches[0], tp.caches[1],                              // p5: tpPostsCache, tpVideoCache
    sb.caches[0], sb.caches[1], sb.caches[2], sb.caches[3], // p6: sbPostsCache, sbM3u8Cache, sbVideoCache, sbFreshCache
    xn.caches[0], xn.caches[1], xn.caches[2], xn.caches[3], // p8: xnPostsCache, xnM3u8Cache, xnVideoCache, xnFreshCache
  ].map(c => c.stats()),
});


/* ── Shortlink resolver — /api/s/:platform/:token → { slug } ── */
app.get('/api/s/:platform/:token', (req, res) => {
  const { platform, token } = req.params;
  if (!['rb', 'yb', 'bk', 'tp', 'sb', 'xn'].includes(platform)) return res.status(404).json({ error: 'not found' });
  if (!/^[a-z0-9]{11}$/.test(token)) return res.status(400).json({ error: 'invalid token' });
  const slug = resolveToken(platform, token);
  if (!slug) return res.status(404).json({ error: 'Link kadaluarsa atau tidak ditemukan' });
  res.json({ slug });
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
