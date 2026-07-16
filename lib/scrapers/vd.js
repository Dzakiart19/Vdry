/* ═══════════════════════════════════════════════════════════════════════
   PLATFORM VD — videy.design
   PHP site · HTML scrape · Direct MP4 stream proxy (no HLS, no tokens).
   Listing  : GET /?page=N&sort=terbaru   → parse .video-card grid
   Watch    : GET /watch.php?id=N          → parse <source> + poster + related
   CDN      : videy.design — no hotlink protection, no signed tokens, Range OK.
   Terisolasi penuh dari semua platform lain.
═══════════════════════════════════════════════════════════════════════ */

const express = require('express');
const cheerio = require('cheerio');
const axios   = require('axios');
const https   = require('https');
const stream  = require('stream');
const path    = require('path');

const { makeCache }              = require('../cache');
const { UA, apiError }           = require('../proxy');
const { logCdnAlert }            = require('../monitor');
const { registerSlug }           = require('../shortlink');

const router     = express.Router();
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

const VD_BASE = 'https://videy.design';

/* ── Axios instance ── */
const ipv4Agent = new https.Agent({ family: 4 });

const axVd = axios.create({
  timeout:      20000,
  maxRedirects: 5,
  httpsAgent:   ipv4Agent,
  headers: {
    'User-Agent':      UA,
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
    'Referer':         `${VD_BASE}/`,
  },
});

const axVdStream = axios.create({
  timeout:        30000,
  maxRedirects:   5,
  validateStatus: s => s < 500,
  httpsAgent:     ipv4Agent,
});

/* ── Retry wrapper ── */
async function axVdGet(url, config = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await axVd.get(url, config);
    } catch (err) {
      lastErr = err;
      if (err.response?.status >= 400 && err.response?.status < 500) throw err;
      if (i < retries) await new Promise(r => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ── CDN allowlist — hanya videy.design ── */
function isAllowedVdUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    if (u.hostname === 'videy.design') return true;
    logCdnAlert(`[cdn-alert] VD domain baru terdeteksi: "${u.hostname}" — tambahkan ke allowlist jika legit`);
    return false;
  } catch { return false; }
}

/* ── Resolve relative URL ke absolute videy.design ── */
function toAbs(rel) {
  if (!rel) return '';
  if (rel.startsWith('http')) return rel;
  return `${VD_BASE}/${rel.replace(/^\//, '')}`;
}

/* ── Caches ── */
// vdPostsCache  : 3 mnt — listing bisa berubah sering
// vdVideoCache  : 2 jam — MP4 URL permanen, tidak ada token expiry
// vdThumbCache  : 24 jam — thumbnail URL tidak berubah
const vdPostsCache = makeCache(200, 3  * 60 * 1000,        'vd_posts');
const vdVideoCache = makeCache(500, 2  * 60 * 60 * 1000,   'vd_video');
const vdThumbCache = makeCache(500, 24 * 60 * 60 * 1000,   'vd_thumb');

/* ════════════════════════════════════════════════════════════════════
   LISTING API
   GET /api/vd/posts?p=N
════════════════════════════════════════════════════════════════════ */
router.get('/api/vd/posts', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.p) || 1);
  const key  = `${page}`;

  const cached = vdPostsCache.get(key);
  if (cached !== null) {
    if (cached._error)          return apiError(res, 502, 'Gagal memuat daftar video');
    if (cached._status === 404) return apiError(res, 404, 'Halaman tidak ditemukan');
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached);
  }

  try {
    const url = `${VD_BASE}/?page=${page}&sort=terbaru`;
    const { data: html } = await axVdGet(url);
    const $ = cheerio.load(html);

    const posts = [];
    const seen  = new Set();

    // Struktur card: <div class="video-card">
    //   <a href="watch.php?id=N"><div class="video-thumbnail"><img ...></div></a>
    //   <div class="video-info"><div class="video-title">...</div></div>
    // Penting: .video-title BUKAN di dalam <a>, melainkan sibling di video-info.
    $('.video-card').each((_, el) => {
      const $card   = $(el);
      const $link   = $card.find('a[href*="watch.php?id="]').first();
      const href    = $link.attr('href') || '';
      const idMatch = href.match(/watch\.php\?id=(\d+)/);
      const id      = idMatch ? idMatch[1] : null;
      if (!id || seen.has(id)) return;
      seen.add(id);

      const rawThumb = $link.find('img').attr('src') || '';
      const thumb    = rawThumb ? toAbs(rawThumb) : '';
      // Title dari .video-title di video-info (sibling dari <a>), fallback ke img alt
      const title    = $card.find('.video-title').text().trim()
                    || $link.find('img').attr('alt') || '';
      const duration = $card.find('.duration').text().trim();

      if (id && title) {
        posts.push({ slug: id, title, thumb, duration });
      }
    });

    if (!posts.length && page === 1) {
      vdPostsCache.set(key, { posts: [], totalPages: 1 }, 30_000);
      res.setHeader('X-Cache', 'MISS');
      return res.json({ posts: [], totalPages: 1 });
    }

    // videy.design tidak menampilkan total halaman — estimasi dari jumlah hasil
    const hasMore    = posts.length >= 20;
    const totalPages = hasMore ? page + 50 : page;

    const result = { posts, page, totalPages };
    vdPostsCache.set(key, result, posts.length > 0 ? undefined : 30_000);
    res.setHeader('X-Cache', 'MISS');
    res.json(result);

  } catch (err) {
    console.error('[vd] posts error:', err.message);
    vdPostsCache.set(key, { _error: true }, 20_000);
    apiError(res, 502, 'Gagal memuat daftar video');
  }
});

/* ════════════════════════════════════════════════════════════════════
   VIDEO INFO API
   GET /api/vd/video/:id
   Scrape watch.php?id=N untuk MP4 URL, title, thumb, related.
════════════════════════════════════════════════════════════════════ */
router.get('/api/vd/video/:id', async (req, res) => {
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return apiError(res, 400, 'Invalid video ID');

  const cached = vdVideoCache.get(id);
  if (cached !== null) {
    if (cached._error)          return apiError(res, 502, 'Gagal mengambil info video');
    if (cached._status === 404) return apiError(res, 404, 'Video tidak ditemukan');
    res.setHeader('X-Cache', 'HIT');
    return res.json({ ...cached, token: registerSlug('vd', id) });
  }

  try {
    const mp4Url = await resolveVdMp4(id);
    if (!mp4Url) return apiError(res, 404, 'Sumber video tidak ditemukan');

    const entry = vdVideoCache.get(id);
    res.setHeader('X-Cache', 'MISS');
    return res.json({
      slug:        id,
      title:       entry?.title || id,
      thumb:       entry?.thumb || '',
      description: entry?.description || '',
      related:     entry?.related || [],
      mp4Url:      `/proxy/vd/stream/${encodeURIComponent(id)}`,
      token:       registerSlug('vd', id),
    });
  } catch (err) {
    console.error('[vd] video error:', err.message);
    if (err.response?.status === 404) {
      vdVideoCache.set(id, { _status: 404 }, 30_000);
      return apiError(res, 404, 'Video tidak ditemukan');
    }
    vdVideoCache.set(id, { _error: true }, 20_000);
    apiError(res, 502, 'Gagal mengambil info video');
  }
});

/* ── Resolve MP4 URL dari HTML watch.php?id=N ── */
async function resolveVdMp4(id, evictFirst = false) {
  if (evictFirst) vdVideoCache.del(id);

  const cached = vdVideoCache.get(id);
  if (cached && cached.mp4Url) return cached.mp4Url;

  const { data: html } = await axVdGet(`${VD_BASE}/watch.php?id=${id}`);
  const $ = cheerio.load(html);

  // MP4: <source src="uploads/videos/vid_*.mp4" type="video/mp4">
  const rawMp4 = $('source[type="video/mp4"]').attr('src')
              || $('video#videoPlayer').attr('src')
              || $('video').attr('src')
              || '';
  const mp4Url = rawMp4 ? toAbs(rawMp4) : null;

  if (!mp4Url || !isAllowedVdUrl(mp4Url)) {
    logCdnAlert(`[cdn-alert] VD gagal resolve MP4 untuk id="${id}" — URL ditemukan: "${mp4Url || 'kosong'}"`);
    return null;
  }

  // Thumbnail: poster attribute
  const rawPoster = $('video#videoPlayer').attr('poster')
                 || $('video').attr('poster') || '';
  const thumb     = rawPoster ? toAbs(rawPoster) : '';

  const title = $('h1.video-title').text().trim()
             || $('h1').first().text().trim()
             || id;

  const description = $('meta[name="description"]').attr('content')
                    || $('meta[property="og:description"]').attr('content')
                    || '';

  // Related: <a href="watch.php?id=N" class="related-video-link">
  const related = [];
  const seenIds = new Set([id]);
  $('a.related-video-link[href*="watch.php?id="]').each((_, el) => {
    const $a     = $(el);
    const href   = $a.attr('href') || '';
    const idM    = href.match(/watch\.php\?id=(\d+)/);
    const rid    = idM ? idM[1] : null;
    if (!rid || seenIds.has(rid)) return;
    seenIds.add(rid);

    const rTitle = $a.find('.related-title').text().trim();

    // Thumbnail dari background-image style: url('uploads/thumbnails/...')
    const styleAttr = $a.find('.related-thumbnail').attr('style') || '';
    const bgMatch   = styleAttr.match(/url\(['"]?([^'")\s]+)['"]?\)/);
    const rRawThumb = bgMatch ? bgMatch[1] : '';
    const rThumb    = rRawThumb ? toAbs(rRawThumb) : '';

    // Fallback thumbnail dari img (jika ada)
    const imgSrc = $a.find('img').attr('src') || '';
    const finalThumb = rThumb || (imgSrc ? toAbs(imgSrc) : '');

    if (rid && rTitle) {
      related.push({ slug: rid, title: rTitle, thumb: finalThumb });
    }
  });

  const payload = { slug: id, title, thumb, description, related, mp4Url };
  vdVideoCache.set(id, payload);
  return mp4Url;
}

/* ════════════════════════════════════════════════════════════════════
   STREAM PROXY — Range support, evict & retry on 403/404
   GET /proxy/vd/stream/:id
════════════════════════════════════════════════════════════════════ */
router.get('/proxy/vd/stream/:id', async (req, res) => {
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return apiError(res, 400, 'Invalid video ID');

  let mp4Url;
  try {
    mp4Url = await resolveVdMp4(id);
  } catch (err) {
    console.error('[vd] stream resolve error:', err.message);
    return apiError(res, 502, 'Gagal resolve URL video');
  }
  if (!mp4Url || !isAllowedVdUrl(mp4Url)) {
    return apiError(res, 404, 'Sumber video tidak ditemukan');
  }

  const reqHeaders = {
    'User-Agent': UA,
    'Referer':    `${VD_BASE}/`,
  };
  if (req.headers.range) reqHeaders['Range'] = req.headers.range;

  async function fetchUpstream(url) {
    return axVdStream.get(url, { headers: reqHeaders, responseType: 'stream' });
  }

  try {
    let upstream = await fetchUpstream(mp4Url);

    // Evict cache & re-scrape jika CDN menolak (seharusnya jarang terjadi karena URL permanen)
    if (upstream.status === 403 || upstream.status === 404) {
      upstream.data.destroy();
      console.warn(`[vd-stream-evict] CDN ${upstream.status} for id="${id}" — re-resolving`);
      try {
        mp4Url = await resolveVdMp4(id, true /* evictFirst */);
      } catch (e) {
        console.error('[vd] stream re-resolve error:', e.message);
        return apiError(res, 502, 'Gagal resolve URL video');
      }
      if (!mp4Url || !isAllowedVdUrl(mp4Url)) {
        return apiError(res, 404, 'Sumber video tidak ditemukan');
      }
      upstream = await fetchUpstream(mp4Url);
    }

    res.status(upstream.status);
    res.setHeader('accept-ranges', 'bytes');
    ['content-type', 'content-length', 'content-range', 'cache-control', 'last-modified', 'etag']
      .forEach(h => { if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]); });

    const onClose = () => upstream.data.destroy();
    req.on('close', onClose);
    res.on('close', onClose);

    upstream.data.on('error', err => {
      console.error('[vd] upstream stream error:', err.message);
      if (!res.headersSent) apiError(res, 502, 'Stream terputus');
      else res.end();
    });

    stream.pipeline(upstream.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error('[vd] pipeline error:', err.message);
      }
    });

  } catch (err) {
    console.error('[vd] stream error:', err.message);
    if (!res.headersSent) apiError(res, 502, 'Gagal streaming video');
  }
});

/* ════════════════════════════════════════════════════════════════════
   THUMBNAIL PROXY
   GET /proxy/vd/thumb?url=...
════════════════════════════════════════════════════════════════════ */
router.get('/proxy/vd/thumb', async (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).end();
  let target;
  try { target = decodeURIComponent(raw); } catch { return res.status(400).end(); }
  if (!isAllowedVdUrl(target)) return res.status(403).end();

  // Cek thumb cache
  const cached = vdThumbCache.get(target);
  if (cached === '') return res.status(404).end();

  try {
    const upstream = await axVdStream.get(target, {
      headers:      { 'User-Agent': UA, 'Referer': `${VD_BASE}/` },
      responseType: 'stream',
      timeout:      12000,
    });

    const ct = upstream.headers['content-type'] || '';
    if (!ct.startsWith('image/')) {
      upstream.data.destroy();
      vdThumbCache.set(target, '');
      return res.status(415).end();
    }

    res.setHeader('content-type', ct);
    res.setHeader('cache-control', 'public, max-age=86400');

    const onClose = () => upstream.data.destroy();
    req.on('close', onClose);
    res.on('close', onClose);

    upstream.data.on('error', err => {
      console.error('[vd] thumb stream error:', err.message);
      if (!res.headersSent) res.status(502).end();
      else res.end();
    });

    stream.pipeline(upstream.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error('[vd] thumb pipeline error:', err.message);
      }
    });

  } catch (err) {
    console.error('[vd] thumb proxy error:', err.message);
    if (!res.headersSent) res.status(502).end();
  }
});

/* ── SPA routes — WAJIB, tanpa ini /vd jatuh ke index.html (Platform 1) ── */
router.get('/vd',   (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'vd.html')));
router.get('/vd/*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'vd.html')));

module.exports = { router, caches: [vdPostsCache, vdVideoCache, vdThumbCache] };
