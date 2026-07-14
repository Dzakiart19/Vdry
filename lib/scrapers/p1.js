/* ═══════════════════════════════════════════════════════════════════════
   PLATFORM 1 — xpvid.cc
   Folder browser + direct MP4 stream proxy + thumbnail proxy + embed page.
   Terisolasi penuh dari P2/P3 — tidak share cache atau state apa pun.
═══════════════════════════════════════════════════════════════════════ */

const express = require('express');
const cheerio = require('cheerio');
const stream  = require('stream');

const { makeCache } = require('../cache');
const { UA, apiError, ax, axNoRedirect } = require('../proxy');
const { logCdnAlert } = require('../monitor');

const router = express.Router();

/* Dead-stream guard: video yang CDN-nya terus 404 bahkan setelah re-resolve
   (video benar-benar dihapus) ditandai "dead" selama 5 menit — semua request
   berikutnya langsung 404 tanpa memicu re-resolve loop. */
const deadStreamIds = new Map(); // id → expiresAt (ms)
const DEAD_TTL_MS = 5 * 60 * 1000;

const BASE = 'https://xpvid.cc';
const baseHeaders = {
  'User-Agent':      UA,
  'Accept-Language': 'en-US,en;q=0.9',
};

/* ── Strict allowlists ── */
const THUMB_HOSTS  = new Set(['i.xpvid.cc']);
const STREAM_HOSTS = new Set(['vidoycdn.b-cdn.net', 'cache.cdnvdy.com', 'cache.overfetch.video']);

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

/* ── Cache MP4 URL Platform 1 (TTL 5 menit, max 300 entries) ──────────
   Mencegah double HTTP call ke embed.php: /api/video/:id dan
   /proxy/stream/:id keduanya butuh URL yang sama — cukup fetch sekali.
──────────────────────────────────────────────────────────────────────── */
const videoUrlCache = makeCache(300, 5 * 60 * 1000, 'p1_videoUrl'); // id → mp4Url

/* ═══════════════════════════════════════
   FOLDER API
═══════════════════════════════════════ */
router.get('/api/folder/:id', async (req, res) => {
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
router.get('/api/video/:id', async (req, res) => {
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
router.get('/proxy/stream/:id', async (req, res) => {
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

    // Jika CDN tolak URL (token expired / 403/404), evict cache & re-resolve sekali.
    // Dead-stream guard: jika video sudah ditandai dead (re-resolve sebelumnya juga gagal),
    // langsung 404 tanpa re-resolve untuk menghindari loop spam di log.
    if (upstream.status === 403 || upstream.status === 404) {
      upstream.data.destroy();
      const deadUntil = deadStreamIds.get(id);
      if (deadUntil && Date.now() < deadUntil) {
        return apiError(res, 404, 'Sumber video tidak ditemukan');
      }
      console.warn(`[stream-evict] CDN ${upstream.status} for ${id} — re-resolving`);
      try {
        mp4Url = await resolveP1Mp4(true /* evictFirst */);
      } catch (e) {
        console.error('stream re-resolve error:', e.message);
        deadStreamIds.set(id, Date.now() + DEAD_TTL_MS);
        return apiError(res, 502, 'Gagal resolve URL video');
      }
      if (!mp4Url || !allowedStreamUrl(mp4Url)) {
        deadStreamIds.set(id, Date.now() + DEAD_TTL_MS);
        return apiError(res, 404, 'Sumber video tidak ditemukan');
      }
      upstream = await fetchUpstream(mp4Url);
      // CDN masih tolak setelah re-resolve → video benar-benar dead, tandai agar tidak loop
      if (upstream.status === 403 || upstream.status === 404) {
        deadStreamIds.set(id, Date.now() + DEAD_TTL_MS);
      }
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
router.get('/proxy/thumb', async (req, res) => {
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
   EMBED PLAYER PAGE
   Halaman minimal yang serve <video> same-origin ke /proxy/stream/:id.
   Dimuat lewat <iframe> oleh Firebase frontend supaya tidak ada
   cross-origin video issue (Android Chrome block cross-origin <video>
   bahkan dengan CORS header yang benar).
═══════════════════════════════════════ */
router.get('/embed/:id', (req, res) => {
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

module.exports = { router, caches: [videoUrlCache] };
