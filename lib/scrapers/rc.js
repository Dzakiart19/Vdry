/* ═══════════════════════════════════════════════════════════════════════
   PLATFORM 6 — ReddClips (RC) "Vidorey Reddit"
   API: api.reddclips.com (undocumented, monitor untuk perubahan)
   Video: direct MP4 dari api.reddclips.com/video/{hash}.mp4
   Thumbnail: external-preview.redd.it / preview.redd.it / i.redd.it
   Terisolasi penuh dari P1–P5 — tidak share cache atau state apa pun.
═══════════════════════════════════════════════════════════════════════ */

const express = require('express');
const axios   = require('axios');
const stream  = require('stream');
const path    = require('path');

const { makeCache }            = require('../cache');
const { UA, apiError, axNoRedirect } = require('../proxy');
const { logCdnAlert }          = require('../monitor');

const router = express.Router();

const RC_API     = 'https://api.reddclips.com';
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

/* ── CDN allowlist ── */
const RC_VIDEO_HOSTS = new Set(['api.reddclips.com']);
const RC_THUMB_HOSTS = new Set([
  'external-preview.redd.it',
  'preview.redd.it',
  'i.redd.it',
]);

function isAllowedRcVideoUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    if (RC_VIDEO_HOSTS.has(u.hostname)) return true;
    logCdnAlert(`[cdn-alert] P6 video domain baru: "${u.hostname}" — tambahkan ke allowlist jika legit`);
    return false;
  } catch { return false; }
}

function isAllowedRcThumbUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    if (RC_THUMB_HOSTS.has(u.hostname)) return true;
    logCdnAlert(`[cdn-alert] P6 thumbnail domain baru: "${u.hostname}"`);
    return false;
  } catch { return false; }
}

/* ── Base64url encode/decode untuk param URL di proxy ── */
function encodeB64Url(str) { return Buffer.from(str).toString('base64url'); }
function decodeB64Url(str) {
  try { return Buffer.from(str, 'base64url').toString('utf8'); } catch { return ''; }
}

/* ── Axios instance untuk request ke api.reddclips.com ── */
const axRc = axios.create({
  timeout: 20000,
  headers: {
    'User-Agent':      UA,
    'Origin':          'https://reddclips.com',
    'Referer':         'https://reddclips.com/',
    'Accept':          'application/json',
    'Accept-Encoding': 'gzip, deflate',
  },
});

async function axRcGet(url, config = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try { return await axRc.get(url, config); }
    catch (err) {
      lastErr = err;
      if (err.response?.status >= 400 && err.response?.status < 500) throw err;
      if (i < retries) await new Promise(r => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ── Caches Platform 6 ───────────────────────────────────────────────
   rcCategoriesCache — daftar kategori (1 jam, sedikit entry)
   rcPostsCache      — hasil listing per kategori+sort+cursor (10 mnt)
   rcThumbCache      — thumbnail URL per hash (24 jam) — tidak aktif
                       dipakai, tapi disertakan untuk health stats
──────────────────────────────────────────────────────────────────── */
const rcCategoriesCache = makeCache(10,  60 * 60 * 1000,      'p6_categories');
const rcPostsCache      = makeCache(300, 10 * 60 * 1000,      'p6_posts');
const rcThumbCache      = makeCache(100,  5 * 60 * 1000,      'p6_thumb');

/* ══════════════════════════════════════════════
   CATEGORIES
   GET /api/rc/categories
   Fetch dari api.reddclips.com/categories.
   Scraper-alert jika struktur berubah.
═══════════════════════════════════════════════ */
router.get('/api/rc/categories', async (_req, res) => {
  const cached = rcCategoriesCache.get('all');
  if (cached !== null) {
    if (cached._error) return apiError(res, 502, 'Gagal memuat kategori');
    return res.json(cached);
  }

  try {
    const { data } = await axRcGet(`${RC_API}/categories`);

    if (!data.categories || !Array.isArray(data.categories)) {
      logCdnAlert('[scraper-alert] P6 /categories — struktur response berubah: field "categories" tidak ditemukan');
      rcCategoriesCache.set('all', { _error: true }, 20_000);
      return apiError(res, 502, 'Gagal memuat kategori');
    }

    const result = { categories: data.categories };
    rcCategoriesCache.set('all', result);
    return res.json(result);

  } catch (err) {
    console.error('[rc] categories error:', err.message);
    rcCategoriesCache.set('all', { _error: true }, 20_000);
    return apiError(res, 502, 'Gagal memuat kategori');
  }
});

/* ══════════════════════════════════════════════
   POSTS LISTING
   GET /api/rc/posts?categoryId=6&sort=hot&limit=25&after=cursor
   Fetch dari api.reddclips.com/categories/{id}/posts.
   Filter hanya mediaType === "video", extract hash dari mediaUrl.
═══════════════════════════════════════════════ */
router.get('/api/rc/posts', async (req, res) => {
  const categoryId = Math.max(1, parseInt(req.query.categoryId) || 6);
  const sort = ['hot', 'new', 'top', 'rising', 'controversial'].includes(req.query.sort)
    ? req.query.sort : 'hot';
  const limit = Math.min(parseInt(req.query.limit) || 25, 50);
  const after = (req.query.after || '').replace(/[^A-Za-z0-9+/=_-]/g, '');

  const cacheKey = `posts:${categoryId}:${sort}:${after || 'start'}`;
  const cached   = rcPostsCache.get(cacheKey);
  if (cached !== null) {
    if (cached._error) return apiError(res, 502, 'Gagal memuat video');
    return res.json(cached);
  }

  try {
    let url = `${RC_API}/categories/${categoryId}/posts?sort=${sort}&limit=${limit}`;
    if (after) url += `&after=${encodeURIComponent(after)}`;

    const { data } = await axRcGet(url);

    if (!data.posts || !Array.isArray(data.posts)) {
      logCdnAlert(`[scraper-alert] P6 /categories/${categoryId}/posts — struktur berubah: field "posts" tidak ditemukan`);
      rcPostsCache.set(cacheKey, { _error: true }, 20_000);
      return apiError(res, 502, 'Gagal memuat video');
    }

    /* Filter video only, extract hash dari mediaUrl "/video/{hash}.mp4" */
    const videos = data.posts
      .filter(p => p.mediaType === 'video' && p.mediaUrl)
      .map(p => {
        const m = (p.mediaUrl || '').match(/\/video\/([a-f0-9]{8,20})\.mp4/i);
        if (!m) return null;
        const hash = m[1];
        return {
          hash,
          title:     p.title     || '',
          subreddit: p.subreddit || '',
          author:    p.author    || '',
          upvotes:   p.upvotes   || 0,
          timestamp: p.timestamp || '',
          over18:    !!p.over18,
          thumbnail: p.thumbnail || '',
        };
      })
      .filter(Boolean);

    const result = {
      videos,
      cursor:  data.cursors?.after || null,
      hasMore: !!(data.cursors?.after),
    };

    rcPostsCache.set(cacheKey, result);
    return res.json(result);

  } catch (err) {
    console.error('[rc] posts error:', err.message);
    if (err.response?.status === 404) return apiError(res, 404, 'Kategori tidak ditemukan');
    rcPostsCache.set(cacheKey, { _error: true }, 20_000);
    return apiError(res, 502, 'Gagal memuat video');
  }
});

/* ══════════════════════════════════════════════
   MP4 STREAM PROXY
   GET /proxy/rc/stream/:hash
   Forward Range header untuk support seeking.
   CDN: api.reddclips.com/video/{hash}.mp4
   Cache-Control dari CDN: max-age=86400 → stabil 24 jam.
═══════════════════════════════════════════════ */
router.get('/proxy/rc/stream/:hash', async (req, res) => {
  const { hash } = req.params;
  /* Hash dari reddclips adalah hex lowercase, 10–16 karakter */
  if (!/^[a-f0-9]{8,20}$/i.test(hash)) return res.status(400).end();

  const videoUrl = `${RC_API}/video/${hash}.mp4`;
  if (!isAllowedRcVideoUrl(videoUrl)) return res.status(400).end();

  const rangeHeader = req.headers.range;

  try {
    const upstream = await axRc.get(videoUrl, {
      headers: {
        'User-Agent': UA,
        'Referer':    'https://reddclips.com/',
        ...(rangeHeader ? { Range: rangeHeader } : {}),
      },
      responseType:   'stream',
      timeout:        30000,
      maxRedirects:   3,
      validateStatus: s => s < 500,
    });

    if (upstream.status < 200 || upstream.status >= 400) {
      upstream.data.destroy();
      return res.status(upstream.status === 404 ? 404 : 502).end();
    }

    res.status(upstream.status);
    ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control'].forEach(h => {
      if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
    });
    res.setHeader('Access-Control-Allow-Origin', '*');

    req.on('close', () => upstream.data.destroy());
    upstream.data.on('error', err => {
      console.error('[rc] stream error:', err.message);
      if (!res.headersSent) res.status(502).end();
    });
    stream.pipeline(upstream.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE')
        console.error('[rc] stream pipeline error:', err.message);
    });

  } catch (err) {
    console.error('[rc] stream error:', err.message);
    if (!res.headersSent) res.status(502).end();
  }
});

/* ══════════════════════════════════════════════
   THUMBNAIL PROXY
   GET /proxy/rc/thumb?url=BASE64URL
   Allowlist: external-preview.redd.it, preview.redd.it, i.redd.it
   Validasi content-type harus image/*.
═══════════════════════════════════════════════ */
router.get('/proxy/rc/thumb', async (req, res) => {
  const raw = decodeB64Url(req.query.url || '');
  if (!raw || !isAllowedRcThumbUrl(raw)) return res.status(400).end();

  /* Cache thumbnail URL (sudah dipanggil, hasilnya pasti image) */
  const cacheHit = rcThumbCache.get(raw);
  if (cacheHit === true) {
    /* URL ini pernah sukses — lanjutkan fetch ulang (tidak simpan binary) */
  }

  try {
    const upstream = await axNoRedirect.get(raw, {
      headers:      { 'User-Agent': UA },
      responseType: 'stream',
    });

    const ct = upstream.headers['content-type'] || '';
    if (!ct.startsWith('image/')) {
      upstream.data.destroy();
      return res.status(415).end();
    }

    res.setHeader('content-type', ct);
    res.setHeader('cache-control', 'public, max-age=86400');
    rcThumbCache.set(raw, true);

    const onClose = () => upstream.data.destroy();
    req.on('close', onClose);
    res.on('close', onClose);

    upstream.data.on('error', err => {
      console.error('[rc] thumb error:', err.message);
      if (!res.headersSent) res.status(502).end();
    });
    stream.pipeline(upstream.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE')
        console.error('[rc] thumb pipeline error:', err.message);
    });

  } catch (err) {
    console.error('[rc] thumb error:', err.message);
    if (!res.headersSent) res.status(502).end();
  }
});

/* ══════════════════════════════════════════════
   HTML ROUTES — SPA fallback untuk semua /rc/* path
═══════════════════════════════════════════════ */
router.get('/rc',   (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'rc.html')));
router.get('/rc/*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'rc.html')));

module.exports = { router, caches: [rcCategoriesCache, rcPostsCache, rcThumbCache] };
