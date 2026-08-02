/* ═══════════════════════════════════════════════════════════════════════
   PLATFORM 10 — EroMe (erome.com)
   User-submitted album site · HTML scrape · Direct MP4 stream proxy.
   Listing : /explore?page=N dan /search?q=QUERY&page=N — filter video-only
             via span.album-videos. AlbumId dari href "/a/ALBUMID".
   Video   : fetch /a/ALBUMID → <source type="video/mp4"> (pertama = tertinggi).
   CDN     : v{N}.erome.com — Ceph/S3, Range support, tanpa signed token.
   Thumb   : s{N}.erome.com — expose langsung (imgSrc CSP sudah allow https:).
═══════════════════════════════════════════════════════════════════════ */
'use strict';

const express = require('express');
const cheerio = require('cheerio');
const axios   = require('axios');
const https   = require('https');
const path    = require('path');

const { makeCache }    = require('../cache');
const { UA, apiError } = require('../proxy');
const { logCdnAlert }  = require('../monitor');
const { registerSlug } = require('../shortlink');

const router     = express.Router();
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

const ER_BASE = 'https://www.erome.com';

const baseHeaders = {
  'User-Agent':      UA,
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         `${ER_BASE}/`,
};

/* ── Force IPv4 — cegah drift ke IPv6 saat Replit autoscale ── */
const ipv4Agent = new https.Agent({ family: 4 });

const axEr = axios.create({
  timeout:      20000,
  maxRedirects: 5,
  httpsAgent:   ipv4Agent,
});

const axErStream = axios.create({
  timeout:        30000,
  maxRedirects:   5,
  validateStatus: s => s < 500,
  httpsAgent:     ipv4Agent,
  responseType:   'stream',
});

/* ── Retry wrapper — berhenti pada 4xx definitif ── */
async function axErGet(url, config = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try { return await axEr.get(url, config); }
    catch (err) {
      lastErr = err;
      if (err.response?.status >= 400 && err.response?.status < 500) throw err;
      if (i < retries) await new Promise(r => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ── CDN allowlist: semua subdomain erome.com (v1.erome.com … v107.erome.com) ── */
function isAllowedErUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    if (u.hostname === 'erome.com' || u.hostname.endsWith('.erome.com')) return true;
    logCdnAlert(`[cdn-alert] P10 domain baru terdeteksi: "${u.hostname}"`);
    return false;
  } catch { return false; }
}

/* ── Caches ─────────────────────────────────────────────────────────────────
   erPostsCache — listing/search results (TTL 5 mnt)
   erVideoCache — album → { mp4Url, title, thumb, desc, related } (TTL 4 jam)
   erome tidak pakai signed token → TTL 4 jam aman
─────────────────────────────────────────────────────────────────────────── */
const erPostsCache = makeCache(300, 5  * 60 * 1000,       'er_posts');
const erVideoCache = makeCache(500, 4  * 60 * 60 * 1000, 'er_video');

/* ════════════════════════════════════════════════════════════
   LISTING / POSTS
   GET /api/er/posts?p=N&q=QUERY
════════════════════════════════════════════════════════════ */
router.get('/api/er/posts', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.p) || 1);
  const q    = (req.query.q || '').trim().substring(0, 200);
  const key  = `${page}:${q}`;

  const cached = erPostsCache.get(key);
  if (cached !== null) {
    if (cached._error)          return apiError(res, 502, 'Gagal memuat daftar video');
    if (cached._status === 404) return apiError(res, 404, 'Tidak ada video');
    return res.json(cached);
  }

  try {
    const url = q
      ? `${ER_BASE}/search?q=${encodeURIComponent(q)}&page=${page}`
      : `${ER_BASE}/explore?page=${page}`;

    const { data: html } = await axErGet(url, {
      headers: { ...baseHeaders, 'Accept': 'text/html,application/xhtml+xml' },
    });

    const $ = cheerio.load(html);

    // ── Build albumId→title map dari a.album-title ──
    const titleMap = {};
    $('a.album-title').each((_, el) => {
      const href = $(el).attr('href') || '';
      const m    = href.match(/\/a\/([A-Za-z0-9]{5,12})/);
      if (m) titleMap[m[1]] = $(el).text().trim();
    });

    const posts  = [];
    const seenIds = new Set();

    // ── Loop semua a.album-link — filter hanya yang punya span.album-videos ──
    $('a.album-link').each((_, el) => {
      const $a  = $(el);
      // Hanya album berisi video
      if (!$a.find('span.album-videos').length) return;

      const href = $a.attr('href') || '';
      const m    = href.match(/\/a\/([A-Za-z0-9]{5,12})/);
      if (!m) return;
      const albumId = m[1];
      if (seenIds.has(albumId)) return;
      seenIds.add(albumId);

      // Thumbnail utama: img.album-thumbnail.active (gambar pertama dengan src aktif)
      const thumb = $a.find('img.album-thumbnail.active').first().attr('src') || '';
      const title = titleMap[albumId] || albumId;

      posts.push({ id: albumId, slug: albumId, title, thumb });
    });

    // ── Pagination: ambil angka terbesar dari ul.pagination ──
    let totalPages = page; // minimal sama dengan halaman sekarang
    $('ul.pagination a.page-link').each((_, el) => {
      const n = parseInt($(el).text().trim());
      if (!isNaN(n) && n > totalPages) totalPages = n;
    });

    if (!posts.length) {
      const empty = { posts: [], totalPages: 1 };
      erPostsCache.set(key, empty, 30_000);
      return res.json(empty);
    }

    const result = { posts, totalPages, page };
    erPostsCache.set(key, result);
    res.json(result);

  } catch (err) {
    console.error('[er] posts error:', err.message);
    if (err.response?.status === 404) {
      erPostsCache.set(key, { _status: 404 }, 30_000);
      return apiError(res, 404, 'Tidak ada video');
    }
    erPostsCache.set(key, { _error: true }, 20_000);
    apiError(res, 502, 'Gagal memuat daftar video');
  }
});

/* ════════════════════════════════════════════════════════════
   VIDEO INFO
   GET /api/er/video/:albumId
════════════════════════════════════════════════════════════ */
router.get('/api/er/video/:albumId', async (req, res) => {
  const { albumId } = req.params;
  if (!/^[A-Za-z0-9]{5,12}$/.test(albumId)) return apiError(res, 400, 'Invalid album ID');

  const cached = erVideoCache.get(albumId);
  if (cached !== null) {
    if (cached._error)          return apiError(res, 502, 'Gagal mengambil info video');
    if (cached._status === 404) return apiError(res, 404, 'Video tidak ditemukan');
    return res.json({
      slug:        albumId,
      title:       cached.title,
      thumb:       cached.thumb,
      description: cached.description || '',
      related:     cached.related || [],
      mp4Url:      `/proxy/er/stream/${albumId}`,
      token:       registerSlug('er', albumId),
    });
  }

  try {
    const entry = await resolveErVideo(albumId);
    if (!entry) return apiError(res, 404, 'Sumber video tidak ditemukan');
    res.json({
      slug:        albumId,
      title:       entry.title,
      thumb:       entry.thumb,
      description: entry.description || '',
      related:     entry.related || [],
      mp4Url:      `/proxy/er/stream/${albumId}`,
      token:       registerSlug('er', albumId),
    });
  } catch (err) {
    console.error('[er] video error:', err.message);
    if (err.response?.status === 404) {
      erVideoCache.set(albumId, { _status: 404 }, 30_000);
      return apiError(res, 404, 'Video tidak ditemukan');
    }
    erVideoCache.set(albumId, { _error: true }, 20_000);
    apiError(res, 502, 'Gagal mengambil info video');
  }
});

/* ── Resolve metadata + MP4 URL dari halaman album ── */
async function resolveErVideo(albumId, evictFirst = false) {
  if (evictFirst) erVideoCache.del(albumId);
  const c = erVideoCache.get(albumId);
  if (c && !c._error && !c._status) return c;

  const { data: html } = await axErGet(`${ER_BASE}/a/${albumId}`, {
    headers: { ...baseHeaders },
  });

  const $ = cheerio.load(html);

  // ── Judul ──
  const title = $('h1.album-title-page').first().text().trim()
             || $('meta[property="og:title"]').attr('content')
             || albumId;

  // ── Thumbnail ──
  const thumb = $('meta[property="og:image"]').attr('content')
             || $('img.album-thumbnail.active').first().attr('src')
             || '';

  // ── Deskripsi ──
  const description = $('meta[property="og:description"]').attr('content')
                    || $('meta[name="description"]').attr('content')
                    || '';

  // ── MP4 URLs — erome merender dua video player (lg + normal) dengan URL sama.
  //    Kumpulkan unique URLs; pilih yang pertama (biasanya kualitas tertinggi).
  const seenUrls = new Set();
  let mp4Url = null;
  $('source[type="video/mp4"]').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (!src || seenUrls.has(src)) return;
    seenUrls.add(src);
    if (!mp4Url && isAllowedErUrl(src)) mp4Url = src;
  });

  if (!mp4Url) {
    logCdnAlert(`[cdn-alert] P10 gagal resolve MP4 untuk album "${albumId}"`);
    return null;
  }

  // ── Related albums (video-only) — sama persis struktur listing ──
  const related  = [];
  const seenRel  = new Set([albumId]);
  const relTitleMap = {};

  $('a.album-title').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m    = href.match(/\/a\/([A-Za-z0-9]{5,12})/);
    if (m) relTitleMap[m[1]] = $(el).text().trim();
  });

  $('a.album-link').each((_, el) => {
    const $a  = $(el);
    if (!$a.find('span.album-videos').length) return;
    const href = $a.attr('href') || '';
    const m    = href.match(/\/a\/([A-Za-z0-9]{5,12})/);
    if (!m || seenRel.has(m[1])) return;
    seenRel.add(m[1]);
    const rId    = m[1];
    const rThumb = $a.find('img.album-thumbnail.active').first().attr('src') || '';
    const rTitle = relTitleMap[rId] || rId;
    related.push({ slug: rId, title: rTitle, thumb: rThumb });
    if (related.length >= 24) return false; // limit
  });

  const entry = { title, thumb, description, related, mp4Url };
  erVideoCache.set(albumId, entry);
  return entry;
}

/* ════════════════════════════════════════════════════════════
   STREAM PROXY — browser tidak pernah melihat URL CDN asli
   GET /proxy/er/stream/:albumId
   Range support — seek dan resume berjalan normal
════════════════════════════════════════════════════════════ */
router.get('/proxy/er/stream/:albumId', async (req, res) => {
  const { albumId } = req.params;
  if (!/^[A-Za-z0-9]{5,12}$/.test(albumId)) return apiError(res, 400, 'Invalid album ID');

  let entry;
  try {
    entry = await resolveErVideo(albumId);
  } catch (err) {
    console.error('[er] stream resolve error:', err.message);
    return apiError(res, 502, 'Gagal resolve URL video');
  }

  if (!entry?.mp4Url || !isAllowedErUrl(entry.mp4Url)) {
    return apiError(res, 404, 'Sumber video tidak ditemukan');
  }

  const reqHeaders = {
    'User-Agent': UA,
    'Referer':    `${ER_BASE}/a/${albumId}`,
    'Accept':     'video/mp4,video/*,*/*',
  };
  if (req.headers.range) reqHeaders['Range'] = req.headers.range;

  let upstream;
  const doFetch = async (url) => axErStream.get(url, { headers: reqHeaders });

  try {
    upstream = await doFetch(entry.mp4Url);
  } catch (err) {
    console.error('[er] stream first attempt error:', err.message);
    try {
      entry = await resolveErVideo(albumId, true);
      if (!entry?.mp4Url) return apiError(res, 502, 'Gagal resolve URL video setelah retry');
      upstream = await doFetch(entry.mp4Url);
    } catch (err2) {
      return apiError(res, 502, 'Gagal stream video');
    }
  }

  // 403/404 → evict + retry sekali
  if (upstream.status === 403 || upstream.status === 404) {
    console.warn(`[er] stream ${upstream.status} untuk "${albumId}", retry setelah evict`);
    upstream.data.destroy?.();
    try {
      entry = await resolveErVideo(albumId, true);
      if (!entry?.mp4Url) return apiError(res, 502, 'Gagal resolve URL setelah retry');
      upstream = await doFetch(entry.mp4Url);
    } catch (retryErr) {
      return apiError(res, 502, 'Gagal stream video setelah retry');
    }
  }

  res.status(upstream.status);
  ['content-type', 'content-length', 'content-range',
   'accept-ranges', 'cache-control', 'last-modified', 'etag'].forEach(h => {
    const v = upstream.headers[h];
    if (v) res.setHeader(h, v);
  });

  upstream.data.pipe(res);
  req.on('close', () => upstream.data.destroy?.());
});

/* ── SPA routes ── */
router.get('/er',   (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'er.html')));
router.get('/er/*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'er.html')));

module.exports = { router, caches: [erPostsCache, erVideoCache] };
