const express = require('express');
const helmet  = require('helmet');
const axios   = require('axios');
const https   = require('https');
const cheerio = require('cheerio');
const stream  = require('stream');
const path    = require('path');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 5000;
const BASE = 'https://xpvid.cc';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

const baseHeaders = {
  'User-Agent':      UA,
  'Accept-Language': 'en-US,en;q=0.9',
};

/* ── Strict allowlists ── */
const THUMB_HOSTS  = new Set(['i.xpvid.cc']);
const STREAM_HOSTS = new Set(['vidoycdn.b-cdn.net', 'cache.cdnvdy.com', 'cache.overfetch.video']);

/* ── Monitor: real-time visit log ── */
const MONITOR_KEY = process.env.SESSION_SECRET || '';
const MON_BUF     = 500;       // max events disimpan di memory
const monitorLog  = [];        // circular buffer
let   monitorSSE  = [];        // connected SSE clients

function pushMonitorEvent(type, payload) {
  const ev = { ts: Date.now(), type, ...payload };
  monitorLog.push(ev);
  if (monitorLog.length > MON_BUF) monitorLog.shift();
  const msg = `data: ${JSON.stringify(ev)}\n\n`;
  monitorSSE = monitorSSE.filter(r => {
    try { r.write(msg); return true; } catch { return false; }
  });
}

/* ── Axios instances ── */
const ax = axios.create({
  timeout:      20000,
  maxRedirects: 5,
});

// No redirects for thumb proxy — we validate manually
const axNoRedirect = axios.create({
  timeout:      15000,
  maxRedirects: 0,
  validateStatus: s => s < 400,
});

// Dedicated instance for ruangbokep.ws — keepAlive:false prevents ECONNRESET
// ("aborted") when WordPress closes a keep-alive socket between requests.
// family:4 forces IPv4 — on autoscale, dual-stack egress can make putarvid's
// IP-detection embed a garbled address (e.g. "0.2") into the CDN token,
// which then never matches the real requesting IP on segment fetch.
const axRb = axios.create({
  timeout:      25000,
  maxRedirects: 5,
  httpsAgent:   new https.Agent({ keepAlive: false, family: 4 }),
});

// Retry wrapper: catches transient network errors (ECONNRESET, ETIMEDOUT, aborted)
// and retries up to `retries` times with exponential back-off.
async function axRbGet(url, config = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await axRb.get(url, config);
    } catch (err) {
      lastErr = err;
      // Don't retry on 4xx HTTP errors — those won't change
      if (err.response?.status >= 400 && err.response?.status < 500) throw err;
      if (i < retries) await new Promise(r => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ── Sanitized error helper ── */
function apiError(res, status, msg) {
  res.status(status).json({ error: msg });
}

/* ── URL allowlist validator ── */
function allowedThumbUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    if (THUMB_HOSTS.has(u.hostname)) return true;
    logCdnAlert(`[cdn-alert] P1 thumbnail domain baru terdeteksi: "${u.hostname}" — tambahkan ke THUMB_HOSTS jika legit`);
    return false;
  } catch { return false; }
}

function allowedStreamUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    if (STREAM_HOSTS.has(u.hostname)) return true;
    // overfetch.video punya banyak subdomain (cache, meiva, dll) — izinkan semua
    if (u.hostname.endsWith('.overfetch.video')) return true;
    // Domain baru terdeteksi — log supaya bisa di-allowlist tanpa debug manual
    logCdnAlert(`[cdn-alert] P1 stream domain baru terdeteksi: "${u.hostname}" — tambahkan ke STREAM_HOSTS jika legit`);
    return false;
  } catch { return false; }
}

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
app.use((req, _res, next) => {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
           || req.socket?.remoteAddress || '?';
  const ua = (req.headers['user-agent'] || '').slice(0, 100);
  const p  = req.path;
  if      (p.startsWith('/proxy/stream/'))  pushMonitorEvent('stream',   { id: p.split('/')[3] || '?', ip, ua });
  else if (p.startsWith('/api/video/'))     pushMonitorEvent('video',    { id: p.split('/')[3] || '?', ip, ua });
  else if (p.startsWith('/api/folder/'))    pushMonitorEvent('folder',   { id: p.split('/')[3] || '?', ip, ua });
  else if (p.startsWith('/api/rb/video/'))  pushMonitorEvent('rb_video', { id: p.split('/')[4] || '?', ip, ua });
  else if (p.startsWith('/api/rb/posts'))   pushMonitorEvent('rb_posts', { ip, ua });
  next();
});

/* ── Health check (untuk cronjob / uptime monitor) ── */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

/* ── Health detail — cache stats + cdn-alerts sejak server start ── */
app.get('/health/detail', (_req, res) => {
  const uptime = process.uptime();
  const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`;
  res.json({
    status: 'ok',
    uptime: uptimeStr,
    startedAt: new Date(Date.now() - uptime * 1000).toISOString(),
    memory: {
      rss:      (process.memoryUsage().rss      / 1024 / 1024).toFixed(1) + ' MB',
      heapUsed: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1) + ' MB',
    },
    caches: [
      videoUrlCache.stats(),
      m3u8Cache.stats(),
      postsCache.stats(),
      freshSessionCache.stats(),
    ],
    cdnAlerts: {
      total: cdnAlerts.length,
      items: cdnAlerts.slice().reverse(), // terbaru di atas
    },
  });
});

/* ═══════════════════════════════════════
   FOLDER API
═══════════════════════════════════════ */
app.get('/api/folder/:id', async (req, res) => {
  const id   = req.params.id;
  const page = Math.max(1, parseInt(req.query.p) || 1);

  // Validate ID format (alphanumeric only)
  if (!/^[a-z0-9]+$/i.test(id)) return apiError(res, 400, 'Invalid folder ID');

  try {
    const { data } = await ax.get(`${BASE}/f/${id}?p=${page}`, {
      headers: { ...baseHeaders, 'Referer': `${BASE}/` },
    });

    const $ = cheerio.load(data);

    const title = $('.drive-title').text().trim()
               || $('title').text().replace(/📂/g, '').trim()
               || id;

    const parentId = (() => {
      const href = $('.back-btn').attr('href') || '';
      return href.startsWith('/f/') ? href.replace('/f/', '').split('?')[0] : null;
    })();

    const folders = [];
    // xpvid.cc uses class "folder-chip" for folder links (updated selector)
    $('a.folder-chip[href^="/f/"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const fid  = href.replace('/f/', '').split('?')[0];
      const label = $(el).text().trim() || fid;
      if (fid && fid !== id && /^[a-z0-9]+$/i.test(fid)) {
        folders.push({ id: fid, name: label });
      }
    });

    // Parse videos — use only .thumb-link anchors (one per card) to avoid duplicates.
    // Title comes from aria-label (most reliable), thumb from child <img>.
    const videos = [];
    const seenVids = new Set();
    $('a.thumb-link[href^="/d/"]').each((_, el) => {
      const href  = $(el).attr('href') || '';
      const vid   = href.replace('/d/', '').split('?')[0];
      if (!vid || !/^[a-z0-9]+$/i.test(vid) || seenVids.has(vid)) return;
      seenVids.add(vid);

      const name  = $(el).attr('aria-label')
                 || $(el).attr('title')
                 || vid;
      const img   = $(el).find('img').attr('src') || '';
      videos.push({ id: vid, name, thumb: img });
    });

    // Fallback: if site changes class, try all /d/ links but deduplicate
    if (videos.length === 0) {
      $('a[href^="/d/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const vid  = href.replace('/d/', '').split('?')[0];
        if (!vid || !/^[a-z0-9]+$/i.test(vid) || seenVids.has(vid)) return;
        seenVids.add(vid);
        const img  = $(el).find('img').attr('src') || '';
        const name = $(el).attr('aria-label') || $(el).attr('title') || $(el).text().trim() || vid;
        if (img || name !== vid) videos.push({ id: vid, name, thumb: img });
      });
      // Jika fallback juga kosong tapi ada /d/ links di halaman → selector rusak, bukan folder kosong
      if (videos.length === 0 && $('a[href^="/d/"]').length > 0) {
        console.warn(`[scraper-alert] folder/${id} p=${page}: ada ${$('a[href^="/d/"]').length} /d/ links tapi 0 videos di-parse — selector mungkin berubah`);
      }
    }

    const pages = [];
    $('.page-btn[href]').each((_, el) => {
      const m = ($(el).attr('href') || '').match(/[?&]p=(\d+)/);
      if (m) { const n = parseInt(m[1]); if (!pages.includes(n)) pages.push(n); }
    });
    const totalPages = pages.length > 0 ? Math.max(...pages) : 1;

    res.json({ id, title, parentId, folders, videos, page, totalPages });
  } catch (err) {
    console.error('folder error:', err.message);
    const status = err.response?.status;
    if (status === 404) return apiError(res, 404, 'Folder tidak ditemukan');
    apiError(res, 502, 'Gagal memuat folder dari server upstream');
  }
});

/* ═══════════════════════════════════════
   VIDEO INFO API
═══════════════════════════════════════ */
app.get('/api/video/:id', async (req, res) => {
  const id = req.params.id;
  if (!/^[a-z0-9]+$/i.test(id)) return apiError(res, 400, 'Invalid video ID');

  // Serve from cache jika sudah pernah di-resolve
  const cachedVideo = videoUrlCache.get(id);
  if (cachedVideo) {
    return res.json({ id, title: cachedVideo.title, src: cachedVideo.src, thumb: cachedVideo.thumb });
  }

  try {
    const { data } = await ax.get(`${BASE}/embed.php?bucket=vidoycdn&id=${id}`, {
      headers: { ...baseHeaders, 'Referer': `${BASE}/e/${id}` },
    });

    const $ = cheerio.load(data);
    const src = $('source[type="video/mp4"]').attr('src')
             || $('video source').attr('src')
             || $('video').attr('src')
             || null;

    if (!src || !allowedStreamUrl(src)) {
      return apiError(res, 404, 'Sumber video tidak ditemukan');
    }

    const title = $('title').text().trim() || id;
    const thumb = $('video').attr('poster') || '';

    // Simpan payload lengkap agar /proxy/stream/:id tidak perlu re-fetch
    videoUrlCache.set(id, { src, title, thumb });

    res.json({ id, title, src, thumb });
  } catch (err) {
    console.error('video error:', err.message);
    if (err.response?.status === 404) return apiError(res, 404, 'Video tidak ditemukan');
    apiError(res, 502, 'Gagal mengambil info video');
  }
});

/* ═══════════════════════════════════════
   STREAM PROXY  (with Range support)
═══════════════════════════════════════ */
app.get('/proxy/stream/:id', async (req, res) => {
  const id = req.params.id;
  if (!/^[a-z0-9]+$/i.test(id)) return apiError(res, 400, 'Invalid ID');

  // Step 1 — resolve MP4 URL (cache dulu, baru fetch jika miss)
  async function resolveP1Mp4(evictFirst = false) {
    if (evictFirst) videoUrlCache.del(id);
    const cached = videoUrlCache.get(id);
    if (cached) return cached.src;
    const { data } = await ax.get(`${BASE}/embed.php?bucket=vidoycdn&id=${id}`, {
      headers: { ...baseHeaders, 'Referer': `${BASE}/e/${id}` },
    });
    const $e = cheerio.load(data);
    const src = $e('source[type="video/mp4"]').attr('src')
             || $e('video source').attr('src')
             || $e('video').attr('src')
             || null;
    if (src && allowedStreamUrl(src)) {
      videoUrlCache.set(id, { src, title: $e('title').text().trim() || id, thumb: $e('video').attr('poster') || '' });
    }
    return src;
  }

  let mp4Url;
  try {
    mp4Url = await resolveP1Mp4();
  } catch (err) {
    console.error('stream resolve error:', err.message);
    return apiError(res, 502, 'Gagal resolve URL video');
  }

  if (!mp4Url || !allowedStreamUrl(mp4Url)) {
    return apiError(res, 404, 'Sumber video tidak ditemukan');
  }

  // Step 2 — proxy stream
  const reqHeaders = {
    'User-Agent': UA,
    'Referer':    `${BASE}/`,
    'Origin':     BASE,
  };
  if (req.headers.range) reqHeaders['Range'] = req.headers.range;

  // Helper fetch — ekstrak agar bisa dipanggil ulang setelah evict cache
  async function fetchUpstream(url) {
    return ax.get(url, {
      headers:        reqHeaders,
      responseType:   'stream',
      validateStatus: s => s < 500,
      timeout:        30000,
    });
  }

  try {
    let upstream = await fetchUpstream(mp4Url);

    // Jika CDN tolak URL (token expired / 403/404), evict cache & re-resolve sekali
    if (upstream.status === 403 || upstream.status === 404) {
      upstream.data.destroy();
      console.warn(`[stream-evict] CDN ${upstream.status} for ${id} — re-resolving`);
      try {
        mp4Url = await resolveP1Mp4(true /* evictFirst */);
      } catch (e) {
        console.error('stream re-resolve error:', e.message);
        return apiError(res, 502, 'Gagal resolve URL video');
      }
      if (!mp4Url || !allowedStreamUrl(mp4Url)) {
        return apiError(res, 404, 'Sumber video tidak ditemukan');
      }
      upstream = await fetchUpstream(mp4Url);
    }

    res.status(upstream.status);

    // Selalu set accept-ranges — CDN kadang tidak mengirimnya tapi stream tetap support Range
    res.setHeader('accept-ranges', 'bytes');
    const forward = [
      'content-type', 'content-length', 'content-range',
      'cache-control', 'last-modified', 'etag',
    ];
    forward.forEach(h => {
      if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
    });

    // Proper cleanup on disconnect
    const onClose = () => {
      upstream.data.destroy();
    };
    req.on('close', onClose);
    res.on('close', onClose);

    upstream.data.on('error', err => {
      console.error('upstream stream error:', err.message);
      if (!res.headersSent) apiError(res, 502, 'Stream terputus');
      else res.end();
    });

    stream.pipeline(upstream.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error('pipeline error:', err.message);
      }
    });

  } catch (err) {
    console.error('stream error:', err.message);
    if (!res.headersSent) apiError(res, 502, 'Gagal streaming video');
  }
});

/* ═══════════════════════════════════════
   THUMBNAIL PROXY  (strict, no redirects)
═══════════════════════════════════════ */
app.get('/proxy/thumb', async (req, res) => {
  const raw = req.query.url;

  if (!raw || !allowedThumbUrl(raw)) {
    return res.status(400).end();
  }

  try {
    const upstream = await axNoRedirect.get(raw, {
      headers:      { 'User-Agent': UA, 'Referer': `${BASE}/` },
      responseType: 'stream',
    });

    const ct = upstream.headers['content-type'] || '';
    if (!ct.startsWith('image/')) {
      upstream.data.destroy();
      return res.status(415).end();
    }

    res.setHeader('content-type', ct);
    res.setHeader('cache-control', 'public, max-age=86400');

    // Cleanup on client disconnect
    const onClose = () => upstream.data.destroy();
    req.on('close', onClose);
    res.on('close', onClose);

    upstream.data.on('error', err => {
      console.error('thumb stream error:', err.message);
      if (!res.headersSent) res.status(502).end();
      else res.end();
    });

    stream.pipeline(upstream.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error('thumb pipeline error:', err.message);
      }
    });

  } catch (err) {
    console.error('thumb proxy error:', err.message);
    if (!res.headersSent) res.status(502).end();
  }
});

/* ═══════════════════════════════════════
   PLATFORM 2 — RUANGBOKEP (RB)
═══════════════════════════════════════ */

const RB_BASE = 'https://ruangbokep.ws';
const rbHeaders = {
  'User-Agent':      UA,
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate',   // NO brotli — axios tidak support br decompression reliably
  'Referer':         `${RB_BASE}/`,
  'Cache-Control':   'no-cache',
};

/* ── RB: Categories ── */
app.get('/api/rb/categories', async (_req, res) => {
  try {
    const { data } = await axRbGet(
      `${RB_BASE}/wp-json/wp/v2/categories?per_page=100&_fields=id,name,slug,count&orderby=count&order=desc`,
      { headers: { ...rbHeaders, Accept: 'application/json' } }
    );
    res.json(data.filter(c => c.slug !== 'uncategorized' && c.count > 0));
  } catch (err) {
    console.error('rb categories error:', err.message);
    apiError(res, 502, 'Gagal memuat kategori');
  }
});

/* ── RB: Post listing (homepage / kategori / search) ── */
app.get('/api/rb/posts', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.p) || 1);
  const cat  = (req.query.cat || '').replace(/[^a-z0-9-]/gi, '');
  const q    = (req.query.q  || '').trim().substring(0, 150);

  // ── Cache check — kembalikan langsung jika masih fresh ──
  const cacheKey = postsCacheKey(page, cat, q);
  const cached = postsCacheGet(cacheKey);
  if (cached) {
    // Periksa sentinel sebelum serve — jangan bocorkan internal state ke client
    if (cached._error)  return apiError(res, 502, 'Gagal memuat konten');
    if (cached._status === 404) return apiError(res, 404, 'Halaman tidak ditemukan');
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached);
  }

  try {
    let url;
    if (q) {
      // Search — WordPress /?s= format
      const enc = encodeURIComponent(q);
      url = page > 1 ? `${RB_BASE}/page/${page}/?s=${enc}` : `${RB_BASE}/?s=${enc}`;
    } else if (cat) {
      url = page > 1 ? `${RB_BASE}/${cat}/page/${page}/` : `${RB_BASE}/${cat}/`;
    } else {
      url = page > 1 ? `${RB_BASE}/page/${page}/` : `${RB_BASE}/`;
    }

    const { data: html } = await axRbGet(url, { headers: rbHeaders });
    const $ = cheerio.load(html);

    const posts = [];
    $('article.loop-video').each((_, el) => {
      const $el   = $(el);
      const thumb = $el.attr('data-main-thumb')
                 || $el.find('img.video-main-thumb').attr('data-lazy-src')
                 || $el.find('img.video-main-thumb').attr('src')
                 || '';
      const href  = $el.find('a[href*="ruangbokep.ws"]').first().attr('href')
                 || $el.find('a').first().attr('href')
                 || '';
      const title = $el.find('img.video-main-thumb').attr('alt')
                 || $el.find('.entry-title, h2, h3').first().text().trim()
                 || '';
      const m = href.match(/ruangbokep\.ws\/([^/]+)\/?$/);
      const slug = m ? m[1] : '';
      if (slug && title) posts.push({ slug, title, thumb });
    });

    // Detect total pages — site uses .pagination ul li a structure
    // "Last" button href contains the actual total page count
    let totalPages = 1;
    $('.pagination ul li a').each((_, el) => {
      if ($(el).text().trim() === 'Last') {
        const m = ($(el).attr('href') || '').match(/\/page\/(\d+)\//);
        if (m) { totalPages = parseInt(m[1]); return false; }
      }
    });
    // Fallback: use max numbered page button
    if (totalPages === 1) {
      $('.pagination ul li a').each((_, el) => {
        const n = parseInt($(el).text().trim());
        if (n && !isNaN(n) && n > totalPages) totalPages = n;
      });
    }

    const result = { posts, page, totalPages, category: cat || null };

    if (posts.length > 0) {
      // Cache normal — 3 menit
      postsCacheSet(cacheKey, result);
    } else {
      // Bedakan: halaman genuinely kosong vs selector rusak.
      // Selector rusak = upstream punya <article> tapi kita tidak bisa parse.
      const articleCount = $('article').length;
      if (articleCount > 0) {
        console.warn(`[scraper-alert] rb/posts key="${cacheKey}": ${articleCount} <article> ditemukan tapi 0 posts di-parse — selector mungkin berubah`);
      }
      // Cache singkat 30 detik — throttle upstream untuk halaman kosong/rusak
      postsCacheSet(cacheKey, result, 30 * 1000);
    }

    res.setHeader('X-Cache', 'MISS');
    res.json(result);
  } catch (err) {
    console.error('rb posts error:', err.message);
    if (err.response?.status === 404) {
      // Cache dengan _status sentinel — cache check akan return 404 yang benar
      postsCacheSet(cacheKey, { _status: 404 }, 30 * 1000);
      return apiError(res, 404, 'Halaman tidak ditemukan');
    }
    // Untuk error 502/network: cache error singkat 20 detik
    postsCacheSet(cacheKey, { _error: true }, 20 * 1000);
    apiError(res, 502, 'Gagal memuat konten');
  }
});

/* ── RB CDN allowlist untuk HLS proxy ── */
// Ekstensi path yang diizinkan: HLS segments, manifest, encryption key, init segment
const RB_CDN_ALLOWED_EXT = new Set(['.ts', '.m3u8', '.m3u', '.aac', '.mp4', '.m4s', '.key', '.init']);

function isAllowedRbCdnUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    // Validasi host: hanya domain CDN yang diketahui dipakai oleh putarvid/streamruby
    const hostOk = (
      u.hostname === 'putarvid.com'         ||
      u.hostname.endsWith('.putarvid.com')  ||
      u.hostname.endsWith('.streamruby.net') ||  // putarvid stream CDN
      u.hostname.endsWith('.b-cdn.net')     ||
      u.hostname.endsWith('.bunnycdn.com')
    );
    // Validasi path: hanya izinkan ekstensi HLS yang valid agar proxy tidak bisa
    // dipakai untuk fetch konten arbitrer dari CDN-CDN broad ini.
    const ext = u.pathname.substring(u.pathname.lastIndexOf('.')).toLowerCase();
    const extOk = RB_CDN_ALLOWED_EXT.has(ext) || u.pathname.endsWith('.m3u8');
    const ok = hostOk && extOk;
    if (!hostOk) logCdnAlert(`[cdn-alert] P2 CDN domain baru terdeteksi: "${u.hostname}" — tambahkan ke isAllowedRbCdnUrl jika legit`);
    if (hostOk && !extOk) logCdnAlert(`[cdn-alert] P2 path ekstensi tidak dikenal: "${u.pathname}" dari "${u.hostname}"`);
    return ok;
  } catch { return false; }
}

/* ── Resolve relative URL terhadap base ── */
function resolveUrl(url, base) {
  try { return new URL(url, base).href; } catch { return url; }
}

/* ── Rewrite semua URL dalam m3u8 manifest → /proxy/rb/seg?url=... ──
   `slug` (opsional) disisipkan sebagai &_s= supaya /proxy/rb/seg bisa
   re-resolve token baru jika CDN menolak (lihat reresolveUrl()) — perlu
   karena autoscale bisa route tiap request ke instance berbeda dengan
   IP keluar berbeda, sementara token CDN dikunci ke IP peminta. ── */
function rewriteM3u8(content, baseUrl, slug) {
  const suffix = slug ? `&_s=${encodeURIComponent(slug)}` : '';
  return content.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      // Rewrite URI= attribute di dalam tag (e.g. #EXT-X-KEY:URI="...")
      return line.replace(/URI="([^"]+)"/g, (_, uri) => {
        const abs = resolveUrl(uri, baseUrl);
        return `URI="/proxy/rb/seg?url=${encodeURIComponent(abs)}${suffix}"`;
      });
    }
    // Baris URL (segment atau sub-manifest)
    const abs = resolveUrl(trimmed, baseUrl);
    return `/proxy/rb/seg?url=${encodeURIComponent(abs)}${suffix}`;
  }).join('\n');
}

/* ── Axios instance tanpa redirect untuk segment proxy ──
   family:4 forces IPv4 — sama alasan seperti axRb di atas: mencegah
   putarvid/streamruby salah mendeteksi IP requester lewat jalur IPv6. ── */
const axSegment = axios.create({
  timeout: 20000, maxRedirects: 5, validateStatus: s => s < 500,
  httpsAgent: new https.Agent({ family: 4 }),
});

// Retry wrapper untuk manifest/segment CDN — CDN streamruby/putarvid kadang
// ECONNRESET/timeout sesaat di bawah traffic produksi. Jangan retry status HTTP
// (403/404/dll sudah valid dari CDN, tidak akan berubah dengan retry).
async function axSegmentGet(url, config = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await axSegment.get(url, config);
    } catch (err) {
      lastErr = err;
      if (err.response) throw err; // status HTTP nyata dari CDN — jangan retry
      if (i < retries) await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ── CDN Alert buffer — ditangkap oleh logCdnAlert(), dibaca oleh /health/detail ── */
const cdnAlerts = [];
const CDN_ALERT_MAX = 100;
function logCdnAlert(msg) {
  console.warn(msg);
  if (cdnAlerts.length >= CDN_ALERT_MAX) cdnAlerts.shift();
  cdnAlerts.push({ ts: new Date().toISOString(), msg });
}

/* ── Generic cache helper — reusable untuk semua in-memory cache ── */
function makeCache(maxSize, defaultTtlMs, name = '') {
  const store = new Map();
  let hits = 0, misses = 0;
  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) { misses++; return null; }
      if (entry.expires <= Date.now()) { store.delete(key); misses++; return null; }
      hits++;
      return entry.value;
    },
    set(key, value, ttlMs = defaultTtlMs) {
      if (store.size >= maxSize) {
        // Evict satu expired entry dulu, fallback FIFO
        for (const [k, v] of store) {
          if (v.expires <= Date.now()) { store.delete(k); break; }
        }
        if (store.size >= maxSize) store.delete(store.keys().next().value);
      }
      store.set(key, { value, expires: Date.now() + ttlMs });
    },
    del(key) { store.delete(key); },
    has(key) { return this.get(key) !== null; },
    stats() {
      return { name, size: store.size, maxSize, hits, misses, hitRate: hits + misses > 0 ? ((hits / (hits + misses)) * 100).toFixed(1) + '%' : 'n/a' };
    },
  };
}

/* ── Cache MP4 URL Platform 1 (TTL 5 menit, max 300 entries) ──────────
   Mencegah double HTTP call ke embed.php: /api/video/:id dan
   /proxy/stream/:id keduanya butuh URL yang sama — cukup fetch sekali.
──────────────────────────────────────────────────────────────────────── */
const videoUrlCache = makeCache(300, 5 * 60 * 1000, 'p1_videoUrl'); // id → mp4Url

/* ── Cache m3u8 yang sudah di-resolve (TTL 5 menit, max 500 entries) ── */
const m3u8Cache = makeCache(500, 5 * 60 * 1000, 'p2_m3u8'); // slug → m3u8Url
// Shim agar kode lama yang pakai m3u8CacheSet/m3u8Cache.get tetap bekerja
function m3u8CacheSet(slug, url) { m3u8Cache.set(slug, url); }

/* ── Cache posts listing (TTL 3 menit, max 200 entries) ────────────────
   Key: "page:cat:q" — mencegah scrape berulang saat navigasi antar halaman.
   TTL pendek (3 menit) supaya konten baru tetap muncul dalam waktu wajar.
   Empty result di-cache 30 detik, error di-cache 20 detik — mencegah
   upstream di-pukul terus-menerus saat halaman memang kosong/error.
──────────────────────────────────────────────────────────────────────── */
const postsCache = makeCache(200, 3 * 60 * 1000, 'p2_posts'); // key → result
function postsCacheKey(page, cat, q) { return `${page}:${cat || ''}:${q || ''}`; }
function postsCacheGet(key) { return postsCache.get(key); }
function postsCacheSet(key, data, ttlMs = 3 * 60 * 1000) { postsCache.set(key, data, ttlMs); }

/* ── Safe PackerJS decoder — ONLY string replacements, no code execution ── */
function unpackPacker(html) {
  // Anchor ke `}(` — brace penutup function body IIFE packer, supaya tidak
  // salah match `(` yang ada di dalam konten packed itu sendiri.
  // Support single- atau double-quoted string (beberapa versi putarvid beda).
  const re = /\}\s*\((['"])([\s\S]*?)\1,\s*(\d+),\s*(\d+),\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)\)/;
  const m = html.match(re);
  if (!m) return null;
  let p = m[2];           // packed string (captured in group 2)
  const a = parseInt(m[3]);
  let c = parseInt(m[4]);
  const k = m[6].split('|'); // keyword list (captured in group 6)
  while (c--) {
    if (k[c]) p = p.replace(new RegExp('\\b' + c.toString(a) + '\\b', 'g'), k[c]);
  }
  return p;
}

/* ── Resolve putarvid embed → raw m3u8 URL (strips ads completely) ── */
async function resolveRbVideoUrl(embedUrl) {
  try {
    const parsed = new URL(embedUrl);
    // Strict allowlist — only putarvid.com and its own subdomains
    if (parsed.hostname !== 'putarvid.com' && !parsed.hostname.endsWith('.putarvid.com')) return null;
    if (parsed.protocol !== 'https:') return null;
  } catch { return null; }

  try {
    const { data: html } = await axRbGet(embedUrl, {
      headers: {
        'User-Agent':      UA,
        'Referer':         `${RB_BASE}/`,
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
      },
      timeout: 18000,
    });
    const decoded = unpackPacker(html);
    if (!decoded) return null;
    const m = decoded.match(/file:"(https?:\/\/[^"]+\.m3u8[^"]*)"/);
    return m ? m[1] : null;
  } catch (err) {
    console.error('resolveRbVideoUrl:', err.message);
    return null;
  }
}

/* ── Ambil embed URL putarvid dari halaman post ruangbokep.ws ── */
async function fetchRbEmbedUrl(slug) {
  const { data: html } = await axRbGet(`${RB_BASE}/${slug}/`, { headers: rbHeaders });
  const $ = cheerio.load(html);
  const title = $('h1.entry-title, h2.entry-title, .entry-title, h1').first().text().trim() || slug;
  const thumb = $('meta[property="og:image"]').attr('content') || '';
  const embedUrl = $('meta[itemprop="embedURL"]').attr('content')
                || $('IFRAME[SRC*="putarvid"]').first().attr('SRC')
                || $('iframe[src*="putarvid"]').first().attr('src')
                || '';
  return { embedUrl, title, thumb };
}

/* ── Resolve slug → master m3u8 URL yang FRESH (selalu request baru, tidak
   pakai cache). Dipanggil dari instance yang SEDANG menangani request ini,
   supaya token CDN yang dihasilkan cocok dengan IP keluar instance
   tersebut. Dipakai untuk self-healing saat CDN menolak token lama
   (kemungkinan besar di-generate oleh instance lain di autoscale). ── */
async function freshResolveMaster(slug) {
  const { embedUrl } = await fetchRbEmbedUrl(slug);
  if (!embedUrl) return null;
  const resolved = await resolveRbVideoUrl(embedUrl);
  if (!resolved || !isAllowedRbCdnUrl(resolved)) return null;
  return resolved;
}

/* ── RB: Single video — resolve to clean m3u8, no ads ── */
app.get('/api/rb/video/:slug', async (req, res) => {
  const slug = req.params.slug;
  if (!/^[a-z0-9-]+$/i.test(slug)) return apiError(res, 400, 'Invalid slug');

  try {
    const { embedUrl, title, thumb } = await fetchRbEmbedUrl(slug);

    if (!embedUrl) return apiError(res, 404, 'Player tidak ditemukan');

    // Decode putarvid packed JS → extract raw m3u8 (removes ALL ads)
    const m3u8Url = await resolveRbVideoUrl(embedUrl);
    if (m3u8Url && isAllowedRbCdnUrl(m3u8Url)) {
      // Cache URL yang sudah di-resolve (dipakai oleh /proxy/rb/hls/:slug)
      m3u8CacheSet(slug, m3u8Url);
      // Return proxy URL — browser tidak pernah akses CDN langsung
      return res.json({ slug, title, thumb, m3u8Url: `/proxy/rb/hls/${slug}` });
    }

    // Fallback: return embed URL only if it's a trusted putarvid domain
    let safeEmbedUrl = null;
    try {
      const u = new URL(embedUrl);
      if (u.protocol === 'https:' && (u.hostname === 'putarvid.com' || u.hostname.endsWith('.putarvid.com'))) {
        safeEmbedUrl = embedUrl;
      }
    } catch { /* invalid URL — drop it */ }
    if (safeEmbedUrl) {
      return res.json({ slug, title, thumb, embedUrl: safeEmbedUrl });
    }
    apiError(res, 404, 'Sumber video tidak dapat diakses');
  } catch (err) {
    console.error('rb video error:', err.message);
    if (err.response?.status === 404) return apiError(res, 404, 'Video tidak ditemukan');
    apiError(res, 502, 'Gagal memuat video');
  }
});

/* ── Self-healing token refresh ────────────────────────────────────────
   Autoscale bisa route request berbeda ke instance berbeda dengan IP
   keluar berbeda, sementara token CDN putarvid/streamruby dikunci ke IP
   yang melakukan resolve. Kalau CDN menolak (403/401/5xx), kita re-resolve
   master m3u8 FRESH dari instance yang SEDANG menangani request ini, lalu
   cari ulang URL segment/sub-manifest yang sepadan (dicocokkan by filename)
   supaya tokennya cocok dengan IP instance saat ini.
   `freshSessionCache` menyimpan hasil resolve+fetch sesaat (TTL pendek)
   supaya banyak segment yang gagal berurutan cukup memicu SATU re-resolve. */
const freshSessionCache = makeCache(100, 20 * 1000, 'p2_freshSession'); // slug → { masterUrl, masterContent, subs }

function basenameNoQuery(u) {
  try { return new URL(u).pathname.split('/').pop(); } catch { return String(u).split('/').pop(); }
}

async function getFreshSession(slug, forceNew = false) {
  if (!forceNew) {
    const cached = freshSessionCache.get(slug);
    if (cached) return cached;
  }
  const masterUrl = await freshResolveMaster(slug);
  if (!masterUrl) return null;
  const session = { masterUrl, masterContent: null, subs: new Map() };
  freshSessionCache.set(slug, session);
  m3u8CacheSet(slug, masterUrl); // sinkronkan cache display juga
  return session;
}

/* Telusuri master → sub-playlist untuk menemukan URL yang baru di-tokenize
   untuk file yang sama (dicocokkan lewat nama file, bukan query token). */
async function reresolveUrl(slug, targetUrl, forceNewSession = false) {
  const session = await getFreshSession(slug, forceNewSession);
  if (!session) return null;
  const targetName = basenameNoQuery(targetUrl);

  if (!session.masterContent) {
    const resp = await axSegmentGet(session.masterUrl, {
      headers: { 'User-Agent': UA, 'Referer': 'https://putarvid.com/', 'Origin': 'https://putarvid.com', 'Accept-Encoding': 'gzip, deflate' },
      timeout: 15000,
    });
    if (resp.status < 200 || resp.status >= 300) return null;
    session.masterContent = String(resp.data);
  }

  const masterBase = session.masterUrl.substring(0, session.masterUrl.lastIndexOf('/') + 1);
  const masterUrls = session.masterContent.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => resolveUrl(l, masterBase));

  // Level 1: target adalah sub-manifest itu sendiri
  const directMatch = masterUrls.find(u => basenameNoQuery(u) === targetName);
  if (directMatch) return directMatch;

  // Level 2: target adalah segment di dalam salah satu sub-playlist
  for (const subUrl of masterUrls) {
    const subKey = basenameNoQuery(subUrl);
    let subContent = session.subs.get(subKey);
    if (!subContent) {
      try {
        const subResp = await axSegmentGet(subUrl, {
          headers: { 'User-Agent': UA, 'Referer': 'https://putarvid.com/', 'Origin': 'https://putarvid.com' },
          timeout: 15000,
        });
        if (subResp.status < 200 || subResp.status >= 300) continue;
        subContent = String(subResp.data);
        session.subs.set(subKey, subContent);
      } catch { continue; }
    }
    const subBase = subUrl.substring(0, subUrl.lastIndexOf('/') + 1);
    const match = subContent.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => resolveUrl(l, subBase))
      .find(u => basenameNoQuery(u) === targetName);
    if (match) return match;
  }
  return null;
}

/* ── RB: HLS manifest proxy — browser tidak pernah akses CDN langsung ── */
app.get('/proxy/rb/hls/:slug', async (req, res) => {
  const slug = req.params.slug;
  if (!/^[a-z0-9-]+$/i.test(slug)) return apiError(res, 400, 'Invalid slug');

  try {
    let m3u8Url = m3u8Cache.get(slug) || null;
    let manifestResp = null;

    if (m3u8Url) {
      manifestResp = await axSegmentGet(m3u8Url, {
        headers: { 'User-Agent': UA, 'Referer': 'https://putarvid.com/', 'Origin': 'https://putarvid.com', 'Accept-Encoding': 'gzip, deflate' },
        timeout: 15000,
      }).catch(err => err.response || null);
    }

    // Cache miss ATAU CDN menolak (kemungkinan token dari instance lain di
    // autoscale) — selalu re-resolve fresh dari instance ini sebelum menyerah.
    if (!manifestResp || manifestResp.status < 200 || manifestResp.status >= 300) {
      m3u8Url = await freshResolveMaster(slug);
      if (!m3u8Url) return apiError(res, 404, 'Stream tidak ditemukan');
      m3u8CacheSet(slug, m3u8Url);
      freshSessionCache.del(slug); // paksa session baru dipakai reresolveUrl juga
      manifestResp = await axSegmentGet(m3u8Url, {
        headers: { 'User-Agent': UA, 'Referer': 'https://putarvid.com/', 'Origin': 'https://putarvid.com', 'Accept-Encoding': 'gzip, deflate' },
        timeout: 15000,
      });
    }

    if (manifestResp.status < 200 || manifestResp.status >= 300) {
      console.error('hls proxy: CDN reject status', manifestResp.status, 'slug', slug);
      return apiError(res, 502, 'CDN menolak manifest stream');
    }
    const manifest = manifestResp.data;

    const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
    const rewritten = rewriteM3u8(String(manifest), baseUrl, slug);

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(rewritten);
  } catch (err) {
    console.error('hls proxy error:', err.message);
    apiError(res, 502, 'Gagal memuat manifest stream');
  }
});

/* ── RB: HLS segment / sub-manifest proxy ──
   `_s` (slug) opsional dipakai untuk self-healing: kalau CDN menolak token
   (403/401/5xx), re-resolve fresh dari instance ini & retry sekali. ── */
app.get('/proxy/rb/seg', async (req, res) => {
  const raw = req.query.url;
  const slugHint = /^[a-z0-9-]+$/i.test(req.query._s || '') ? req.query._s : null;
  if (!raw || !isAllowedRbCdnUrl(raw)) return res.status(400).end();

  await handleRbSeg(raw, slugHint, req, res, false);
});

async function handleRbSeg(raw, slugHint, req, res, isRetry) {
  try {
    const upstream = await axSegmentGet(raw, {
      headers: { 'User-Agent': UA, 'Referer': 'https://putarvid.com/', 'Origin': 'https://putarvid.com' },
      responseType: 'stream',
      timeout: 20000,
    });

    const ct = (upstream.headers['content-type'] || '').toLowerCase();

    // Reject non-2xx from CDN early — coba self-heal sekali sebelum menyerah
    if (upstream.status < 200 || upstream.status >= 300) {
      console.error('seg proxy: CDN reject status', upstream.status, 'isRetry', isRetry);
      upstream.data.destroy();
      if (!isRetry && slugHint && [401, 403, 500, 502, 503].includes(upstream.status)) {
        const fresh = await reresolveUrl(slugHint, raw, true).catch(() => null);
        if (fresh && fresh !== raw && isAllowedRbCdnUrl(fresh)) return handleRbSeg(fresh, slugHint, req, res, true);
      }
      return res.status(upstream.status < 500 ? 404 : 502).end();
    }

    // Sub-manifest (variant playlist) — rewrite URL-nya juga
    if (ct.includes('mpegurl') || raw.includes('.m3u8')) {
      let body = '';
      upstream.data.on('data', chunk => { body += chunk.toString(); });
      upstream.data.on('end', () => {
        const baseUrl = raw.substring(0, raw.lastIndexOf('/') + 1);
        const rewritten = rewriteM3u8(body, baseUrl, slugHint);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-store');
        res.send(rewritten);
      });
      upstream.data.on('error', () => { if (!res.headersSent) res.status(502).end(); });
      return;
    }

    // Segment binary (TS / AAC / key)
    res.status(upstream.status);
    const forward = ['content-type', 'content-length', 'cache-control'];
    forward.forEach(h => { if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]); });
    res.setHeader('Access-Control-Allow-Origin', '*');

    req.on('close', () => upstream.data.destroy());
    upstream.data.on('error', err => {
      console.error('seg stream error:', err.message);
      if (!res.headersSent) res.status(502).end();
    });
    stream.pipeline(upstream.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error('seg pipeline:', err.message);
    });
  } catch (err) {
    console.error('seg proxy error:', err.message);
    if (!res.headersSent) res.status(502).end();
  }
}

/* ── RB: Thumbnail proxy ── */
app.get('/proxy/rb/thumb', async (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).end();

  let parsed;
  try { parsed = new URL(raw); } catch { return res.status(400).end(); }
  // WordPress sering serve thumbnail dari i0/i1/i2.wp.com (Jetpack CDN)
  const allowed = ['ruangbokep.ws', 'img.streamruby.com', 'i0.wp.com', 'i1.wp.com', 'i2.wp.com'];
  if (!allowed.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) {
    return res.status(400).end();
  }

  try {
    const up = await axNoRedirect.get(raw, {
      headers: { 'User-Agent': UA, 'Referer': `${RB_BASE}/` },
      responseType: 'stream',
    });
    const ct = up.headers['content-type'] || '';
    if (!ct.startsWith('image/')) { up.data.destroy(); return res.status(415).end(); }
    res.setHeader('content-type', ct);
    res.setHeader('cache-control', 'public, max-age=86400');
    req.on('close', () => up.data.destroy());
    up.data.on('error', err => {
      console.error('rb thumb stream error:', err.message);
      if (!res.headersSent) res.status(502).end();
    });
    stream.pipeline(up.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error('rb thumb pipeline error:', err.message);
      }
    });
  } catch (err) {
    console.error('rb thumb proxy error:', err.message);
    if (!res.headersSent) res.status(502).end();
  }
});

/* ── RB: SPA routes ── */
app.get('/rb', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'rb.html')));
app.get('/rb/*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'rb.html')));

/* ═══════════════════════════════════════
   PLATFORM 1 — EMBED PLAYER PAGE
   Halaman minimal yang serve <video> same-origin ke /proxy/stream/:id.
   Dimuat lewat <iframe> oleh Firebase frontend supaya tidak ada
   cross-origin video issue (Android Chrome block cross-origin <video>
   bahkan dengan CORS header yang benar).
═══════════════════════════════════════ */
app.get('/embed/:id', (req, res) => {
  const id = req.params.id;
  if (!/^[a-z0-9]+$/i.test(id)) return res.status(400).send('Invalid ID');

  // Helmet set X-Frame-Options: SAMEORIGIN secara global.
  // Hapus supaya Firebase (cross-origin) bisa embed halaman ini dalam iframe.
  res.removeHeader('X-Frame-Options');
  // frame-ancestors — hanya izinkan origin yang diketahui (Firebase + Replit)
  res.setHeader('Content-Security-Policy', [
    "frame-ancestors 'self'",
    'https://vidorey.web.app',
    'https://vidorey.firebaseapp.com',
    'https://*.replit.app',
    'https://*.replit.dev',
    'http://localhost:*',
  ].join(' '));

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%; height: 100%;
      background: #000;
      display: flex; align-items: center; justify-content: center;
      overflow: hidden;
    }
    video {
      width: 100%; height: 100%;
      display: block;
      background: #000;
      outline: none;
    }
  </style>
</head>
<body>
  <video controls playsinline autoplay preload="auto" src="/proxy/stream/${id}">
    Browser tidak mendukung video HTML5.
  </video>
</body>
</html>`);
});

/* ═══════════════════════════════════════
   MONITOR — real-time visitor dashboard
═══════════════════════════════════════ */
function checkMonitorKey(req, res) {
  if (!MONITOR_KEY) { res.status(503).send('SESSION_SECRET belum di-set.'); return false; }
  if (req.query.key !== MONITOR_KEY) {
    // Tampilkan form login jika key salah / tidak ada
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(req.query.key ? 401 : 200).send(`<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vidorey Monitor — Login</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0d0d12;color:#e0e0e8;font-family:'Segoe UI',system-ui,sans-serif;
       display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#14141e;border:1px solid #2a2a3a;border-radius:12px;padding:32px 28px;
        width:100%;max-width:360px;text-align:center}
  h1{font-size:1.1rem;color:#a78bfa;margin-bottom:6px}
  p{font-size:.78rem;color:#52525b;margin-bottom:24px}
  input{width:100%;padding:10px 14px;background:#0d0d12;border:1px solid #2a2a3a;
        border-radius:8px;color:#e0e0e8;font-size:.9rem;margin-bottom:12px;outline:none}
  input:focus{border-color:#7c3aed}
  button{width:100%;padding:10px;background:#7c3aed;border:none;border-radius:8px;
         color:#fff;font-size:.9rem;font-weight:600;cursor:pointer}
  button:hover{background:#6d28d9}
  .err{color:#f87171;font-size:.75rem;margin-bottom:12px}
</style></head>
<body><div class="card">
  <h1>⬡ Vidorey Monitor</h1>
  <p>Masukkan SESSION_SECRET untuk masuk</p>
  ${req.query.key ? '<div class="err">⚠ Key salah, coba lagi.</div>' : ''}
  <form method="GET" action="/monitor">
    <input type="password" name="key" placeholder="SESSION_SECRET" autofocus autocomplete="current-password">
    <button type="submit">Masuk</button>
  </form>
</div></body></html>`);
    return false;
  }
  return true;
}

app.get('/monitor', (req, res) => {
  if (!checkMonitorKey(req, res)) return;
  const key = encodeURIComponent(req.query.key);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vidorey Monitor</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#0d0d12;color:#e0e0e8;min-height:100vh;padding:16px}
  h1{font-size:1.1rem;color:#a78bfa;letter-spacing:.05em;margin-bottom:8px}
  .topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
  .toplinks{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .btn-firebase{display:inline-flex;align-items:center;gap:6px;background:#1a1a24;border:1px solid #f59e0b44;
    color:#fbbf24;border-radius:8px;padding:6px 14px;font-size:.78rem;font-weight:600;text-decoration:none;
    letter-spacing:.03em;transition:background .15s}
  .btn-firebase:hover{background:#2a2010}
  .btn-console{display:inline-flex;align-items:center;gap:6px;background:#1a1a24;border:1px solid #4285f444;
    color:#74a9ff;border-radius:8px;padding:6px 14px;font-size:.78rem;font-weight:600;text-decoration:none;
    letter-spacing:.03em;transition:background .15s}
  .btn-console:hover{background:#101828}
  .stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px}
  .stat{background:#1a1a24;border:1px solid #2a2a3a;border-radius:8px;padding:10px 16px;min-width:110px}
  .stat-val{font-size:1.6rem;font-weight:700;color:#c4b5fd}
  .stat-lbl{font-size:.7rem;color:#6b6b80;margin-top:2px;text-transform:uppercase;letter-spacing:.05em}
  #feed{display:flex;flex-direction:column;gap:4px}
  .ev{display:grid;grid-template-columns:70px 80px 1fr 120px;gap:8px;align-items:center;
      background:#14141e;border:1px solid #1f1f2e;border-radius:6px;padding:7px 10px;
      font-size:.75rem;animation:fadeIn .3s ease}
  @keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
  .ev-time{color:#6b6b80;font-variant-numeric:tabular-nums}
  .badge{display:inline-block;padding:2px 7px;border-radius:99px;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
  .b-stream  {background:#14532d;color:#4ade80}
  .b-video   {background:#1e3a5f;color:#60a5fa}
  .b-folder  {background:#2a2a2a;color:#a1a1aa}
  .b-rb_video{background:#3b1d5a;color:#c084fc}
  .b-rb_posts{background:#3b1d5a;color:#c084fc}
  .ev-id{color:#d4d4d8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ev-ip{color:#71717a;font-size:.7rem;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#22c55e;margin-right:6px;animation:pulse 1.5s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
  #status{font-size:.72rem;color:#52525b;margin-bottom:12px}
</style>
</head>
<body>
<div class="topbar">
  <h1>⬡ Vidorey Monitor</h1>
  <div class="toplinks">
    <a class="btn-firebase" href="https://vidorey.web.app" target="_blank" rel="noopener">🔥 vidorey.web.app</a>
    <a class="btn-console" href="https://analytics.google.com/analytics/web/?authuser=1&hl=en-US#/a338511152p518732508/reports/dashboard?r=firebase-overview" target="_blank" rel="noopener">📊 Firebase Analytics</a>
  </div>
</div>
<div id="status"><span class="dot"></span>Connecting…</div>
<div class="stats">
  <div class="stat"><div class="stat-val" id="s-total">0</div><div class="stat-lbl">Total Events</div></div>
  <div class="stat"><div class="stat-val" id="s-stream">0</div><div class="stat-lbl">Streams</div></div>
  <div class="stat"><div class="stat-val" id="s-video">0</div><div class="stat-lbl">Video Opens</div></div>
  <div class="stat"><div class="stat-val" id="s-ip">0</div><div class="stat-lbl">Unique IPs</div></div>
</div>
<div id="feed"></div>
<script>
const KEY = '${key}';
const feed = document.getElementById('feed');
const MAX_ROWS = 200;
let counts = {total:0, stream:0, video:0};
const ips = new Set();

function fmt(ts){
  const d = new Date(ts);
  return d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function addRow(ev, prepend=true){
  counts.total++;
  if(ev.type==='stream')  counts.stream++;
  if(ev.type==='video')   counts.video++;
  if(ev.ip) ips.add(ev.ip);
  document.getElementById('s-total').textContent  = counts.total;
  document.getElementById('s-stream').textContent = counts.stream;
  document.getElementById('s-video').textContent  = counts.video;
  document.getElementById('s-ip').textContent     = ips.size;

  const row = document.createElement('div');
  row.className = 'ev';
  const badge = '<span class="badge b-'+ev.type+'">'+ev.type.replace('_',' ')+'</span>';
  const ipShort = (ev.ip||'?').split(',')[0].trim().slice(0,20);
  row.innerHTML = '<span class="ev-time">'+fmt(ev.ts)+'</span>'
    + badge
    + '<span class="ev-id">'+(ev.id||'-')+'</span>'
    + '<span class="ev-ip">'+ipShort+'</span>';
  if(prepend) feed.prepend(row); else feed.append(row);
  while(feed.children.length > MAX_ROWS) feed.lastChild.remove();
}

function connect(){
  const es = new EventSource('/monitor/events?key='+KEY);
  es.onopen = () => {
    document.getElementById('status').innerHTML = '<span class="dot"></span>Live';
  };
  es.addEventListener('history', e => {
    const data = JSON.parse(e.data);
    // render history oldest-first (they'll be prepended so newest ends up on top)
    data.events.slice().reverse().forEach(ev => addRow(ev, true));
  });
  es.addEventListener('event', e => {
    addRow(JSON.parse(e.data), true);
  });
  es.onerror = () => {
    document.getElementById('status').innerHTML = '<span style="color:#ef4444">● Disconnected — reconnecting…</span>';
    es.close();
    setTimeout(connect, 3000);
  };
}
connect();
</script>
</body>
</html>`);
});

app.get('/monitor/events', (req, res) => {
  if (!checkMonitorKey(req, res)) return;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Kirim history tersimpan sekaligus
  res.write(`event: history\ndata: ${JSON.stringify({ events: monitorLog })}\n\n`);

  // Daftarkan sebagai SSE client
  monitorSSE.push(res);
  const keepalive = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
  req.on('close', () => {
    clearInterval(keepalive);
    monitorSSE = monitorSSE.filter(r => r !== res);
  });
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
