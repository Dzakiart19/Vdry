/* ═══════════════════════════════════════════════════════════════════════
   PLATFORM ZG — zoig.com
   Amateur video site · HTML scrape · Direct MP4 stream proxy.
   Listing  : GET /amateur-videos{N}.html   → parse .thumbnailz links
   Watch    : GET /play/{id}                → parse <source> MP4 URL
   CDN MP4  : zoigvids.zoigg.com — signed token TTL pendek, Range OK.
   CDN Thumb: cdn-o9.zoig1.com — stabil, no hotlink restriction.
   Access   : site blokir datacenter IP → bypass via X-Forwarded-For.
   Self-heal: token berubah tiap request → evict + re-resolve on 403/404.
   Terisolasi penuh dari semua platform lain.
═══════════════════════════════════════════════════════════════════════ */

const express = require('express');
const cheerio = require('cheerio');
const axios   = require('axios');
const https   = require('https');
const stream  = require('stream');
const path    = require('path');

const { makeCache }     = require('../cache');
const { UA, apiError }  = require('../proxy');
const { logCdnAlert }   = require('../monitor');
const { registerSlug }  = require('../shortlink');

const router     = express.Router();
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

const ZG_BASE      = 'https://www.zoig.com';
const ZG_MP4_CDN   = 'zoigvids.zoigg.com';
const ZG_THUMB_CDN = 'cdn-o9.zoig1.com';

/* ── Residential IP — bypass Apache IP-block (trusts X-Forwarded-For) ── */
const ZG_FORWARD_IP = '98.139.180.149';

/* ── Axios instance untuk scraping zoig.com ── */
const ipv4Agent = new https.Agent({ family: 4 });

const axZg = axios.create({
  timeout:      25000,
  maxRedirects: 5,
  httpsAgent:   ipv4Agent,
  headers: {
    'User-Agent':      UA,
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-Forwarded-For': ZG_FORWARD_IP,
    'Sec-Fetch-Dest':  'document',
    'Sec-Fetch-Mode':  'navigate',
    'Sec-Fetch-Site':  'none',
  },
});

const axZgStream = axios.create({
  timeout:        30000,
  maxRedirects:   5,
  validateStatus: s => s < 500,
  httpsAgent:     ipv4Agent,
});

/* ── Retry wrapper ── */
async function axZgGet(url, config = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await axZg.get(url, config);
    } catch (err) {
      lastErr = err;
      if (err.response?.status >= 400 && err.response?.status < 500) throw err;
      if (i < retries) await new Promise(r => setTimeout(r, 900 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ── CDN allowlist ── */
function isAllowedZgUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    if (u.hostname === ZG_MP4_CDN)   return true;
    if (u.hostname === ZG_THUMB_CDN) return true;
    logCdnAlert(`[cdn-alert] ZG domain baru terdeteksi: "${u.hostname}" — tambahkan ke allowlist jika legit`);
    return false;
  } catch { return false; }
}

/* ── Caches ──
   zgPostsCache : 5 mnt  — listing bisa berubah tiap jam
   zgVideoCache : 8 mnt  — signed token TTL pendek, jangan cache terlalu lama
   zgThumbCache : 24 jam — URL thumbnail stabil
*/
const zgPostsCache = makeCache(200,  5 * 60 * 1000,       'zg_posts');
const zgVideoCache = makeCache(300,  8 * 60 * 1000,       'zg_video');
const zgThumbCache = makeCache(500, 24 * 60 * 60 * 1000,  'zg_thumb');

/* ════════════════════════════════════════════════════════════════════
   LISTING API
   GET /api/zg/posts?p=N
   Pagination: /amateur-videos1.html, /amateur-videos2.html, ...
════════════════════════════════════════════════════════════════════ */
router.get('/api/zg/posts', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.p) || 1);
  const key  = `${page}`;

  const cached = zgPostsCache.get(key);
  if (cached !== null) {
    if (cached._error)          return apiError(res, 502, 'Gagal memuat daftar video');
    if (cached._status === 404) return apiError(res, 404, 'Halaman tidak ditemukan');
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached);
  }

  try {
    const url = `${ZG_BASE}/amateur-videos${page}.html`;
    const { data: html } = await axZgGet(url);
    const $ = cheerio.load(html);

    const posts = [];
    const seen  = new Set();

    // Card: <a href="/play/{id}" class="tt thumbnailz hRotator" title="{title}">
    //         <img src="https://cdn-o9.zoig1.com/thumb/180x135/{hash}/{code}.jpg" alt="{title}" />
    //       </a>
    $('a.thumbnailz[href*="/play/"]').each((_, el) => {
      const $a    = $(el);
      const href  = $a.attr('href') || '';
      const idM   = href.match(/\/play\/(\d+)/);
      const id    = idM ? idM[1] : null;
      if (!id || seen.has(id)) return;
      seen.add(id);

      const title    = ($a.attr('title') || $a.find('img').attr('alt') || '').trim();
      const rawThumb = $a.find('img').first().attr('src') || '';
      const thumb    = rawThumb.startsWith('http') ? rawThumb
                     : rawThumb ? `${ZG_BASE}${rawThumb}` : '';

      if (id && title) {
        posts.push({ slug: id, title, thumb, duration: '' });
      }
    });

    if (!posts.length && page === 1) {
      zgPostsCache.set(key, { posts: [], totalPages: 1 }, 30_000);
      res.setHeader('X-Cache', 'MISS');
      return res.json({ posts: [], totalPages: 1 });
    }

    // Zoig tidak tampilkan total halaman — estimasi besar karena 228k+ video
    const hasMore    = posts.length >= 10;
    const totalPages = hasMore ? page + 200 : page;

    const result = { posts, page, totalPages };
    zgPostsCache.set(key, result, posts.length > 0 ? undefined : 30_000);
    res.setHeader('X-Cache', 'MISS');
    res.json(result);

  } catch (err) {
    console.error('[zg] posts error:', err.message);
    zgPostsCache.set(key, { _error: true }, 20_000);
    apiError(res, 502, 'Gagal memuat daftar video');
  }
});

/* ════════════════════════════════════════════════════════════════════
   VIDEO INFO API
   GET /api/zg/video/:id
   Scrape /play/{id} → MP4 URL (signed token) + title + duration + related.
════════════════════════════════════════════════════════════════════ */
router.get('/api/zg/video/:id', async (req, res) => {
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return apiError(res, 400, 'Invalid video ID');

  const cached = zgVideoCache.get(id);
  if (cached !== null) {
    if (cached._error)          return apiError(res, 502, 'Gagal mengambil info video');
    if (cached._status === 404) return apiError(res, 404, 'Video tidak ditemukan');
    res.setHeader('X-Cache', 'HIT');
    return res.json({ ...cached, token: registerSlug('zg', id) });
  }

  try {
    const entry = await resolveZgVideo(id);
    if (!entry) return apiError(res, 404, 'Sumber video tidak ditemukan');

    res.setHeader('X-Cache', 'MISS');
    return res.json({
      slug:     id,
      title:    entry.title || id,
      thumb:    entry.thumb || '',
      duration: entry.duration || '',
      related:  entry.related || [],
      mp4Url:   `/proxy/zg/stream/${encodeURIComponent(id)}`,
      token:    registerSlug('zg', id),
    });
  } catch (err) {
    console.error('[zg] video error:', err.message);
    if (err.response?.status === 404) {
      zgVideoCache.set(id, { _status: 404 }, 30_000);
      return apiError(res, 404, 'Video tidak ditemukan');
    }
    zgVideoCache.set(id, { _error: true }, 20_000);
    apiError(res, 502, 'Gagal mengambil info video');
  }
});

/* ── Scrape /play/{id} → entry { slug, title, thumb, duration, mp4Url, related } ── */
async function resolveZgVideo(id, evictFirst = false) {
  if (evictFirst) zgVideoCache.del(id);

  const cached = zgVideoCache.get(id);
  if (cached && cached.mp4Url) return cached;

  const { data: html } = await axZgGet(`${ZG_BASE}/play/${id}`);
  const $ = cheerio.load(html);

  // MP4: <source src="https://zoigvids.zoigg.com/preview/{token}/{ts}/path.mp4" type="video/mp4">
  const rawMp4 = $('source[type="video/mp4"]').attr('src')
              || $('video source').first().attr('src')
              || $('video').attr('src')
              || '';
  const mp4Url = rawMp4.startsWith('http') ? rawMp4
               : rawMp4 ? `${ZG_BASE}${rawMp4}` : null;

  if (!mp4Url || !isAllowedZgUrl(mp4Url)) {
    logCdnAlert(`[cdn-alert] ZG gagal resolve MP4 id="${id}" — URL: "${mp4Url || 'kosong'}"`);
    return null;
  }

  // Title — zoig <title> format: "{uploader} {video title} ... homemade amateur video {id}"
  const rawTitle = $('meta[property="og:title"]').attr('content')
                || $('title').text();
  const title = rawTitle
    .replace(/\s*[-–|]\s*ZOIG\.COM.*$/i, '')
    .replace(/\s+homemade\s+amateur\s+video\s+\d+\s*$/i, '')
    .trim() || id;

  // Duration — muncul sebagai pola MM:SS atau H:MM:SS di halaman player info
  let duration = '';
  const durMatch = html.match(/\b(\d{1,2}:\d{2})\b/);
  if (durMatch) duration = durMatch[1];

  // Thumbnail — poster attribute pada flowplayer div atau video element
  const rawPoster = $('[data-poster]').first().attr('data-poster')
                 || $('video').first().attr('poster')
                 || html.match(/poster=['"]([^'"]+)['"]/)?.[1]
                 || '';
  const thumb = (rawPoster && isAllowedZgUrl(rawPoster)) ? rawPoster : '';

  // Related — ul.browse.related li a.thumbnail[href*="/play/"]
  const related = [];
  const seenIds = new Set([id]);
  $('ul.browse.related a.thumbnail[href*="/play/"], ul.browse a.thumbnail[href*="/play/"]').each((_, el) => {
    const $a   = $(el);
    const href = $a.attr('href') || '';
    const ridM = href.match(/\/play\/(\d+)/);
    const rid  = ridM ? ridM[1] : null;
    if (!rid || seenIds.has(rid)) return;
    seenIds.add(rid);

    const rTitle    = ($a.attr('title') || $a.find('img').attr('alt') || '').trim();
    const rawRThumb = $a.find('img').first().attr('src') || '';
    const rThumb    = rawRThumb.startsWith('http') ? rawRThumb
                    : rawRThumb ? `${ZG_BASE}${rawRThumb}` : '';

    if (rid && rTitle) related.push({ slug: rid, title: rTitle, thumb: rThumb });
    if (related.length >= 12) return false;
  });

  const entry = { slug: id, title, thumb, duration, mp4Url, related };
  zgVideoCache.set(id, entry);
  return entry;
}

/* ════════════════════════════════════════════════════════════════════
   STREAM PROXY — Range support, self-healing on token expiry
   GET /proxy/zg/stream/:id
   Signed token di MP4 URL berubah tiap request →
   jika CDN return 403/404, evict cache + re-scrape /play/{id} + retry.
════════════════════════════════════════════════════════════════════ */
router.get('/proxy/zg/stream/:id', async (req, res) => {
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return apiError(res, 400, 'Invalid video ID');

  let entry;
  try {
    entry = await resolveZgVideo(id);
  } catch (err) {
    console.error('[zg] stream resolve error:', err.message);
    return apiError(res, 502, 'Gagal resolve URL video');
  }
  if (!entry || !isAllowedZgUrl(entry.mp4Url)) {
    return apiError(res, 404, 'Sumber video tidak ditemukan');
  }

  const reqHeaders = { 'User-Agent': UA, 'Referer': `${ZG_BASE}/` };
  if (req.headers.range) reqHeaders['Range'] = req.headers.range;

  async function fetchUpstream(url) {
    return axZgStream.get(url, { headers: reqHeaders, responseType: 'stream' });
  }

  try {
    let upstream = await fetchUpstream(entry.mp4Url);

    // Token expired (403/404) → evict, re-scrape untuk fresh signed URL, retry sekali
    if (upstream.status === 403 || upstream.status === 404) {
      upstream.data.destroy();
      console.warn(`[zg-stream-evict] CDN ${upstream.status} id="${id}" — re-resolving fresh token`);
      try {
        entry = await resolveZgVideo(id, true /* evictFirst */);
      } catch (e) {
        console.error('[zg] stream re-resolve error:', e.message);
        return apiError(res, 502, 'Gagal resolve URL video');
      }
      if (!entry || !isAllowedZgUrl(entry.mp4Url)) {
        return apiError(res, 404, 'Sumber video tidak ditemukan');
      }
      upstream = await fetchUpstream(entry.mp4Url);
    }

    res.status(upstream.status);
    res.setHeader('accept-ranges', 'bytes');
    ['content-type', 'content-length', 'content-range', 'cache-control', 'last-modified', 'etag']
      .forEach(h => { if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]); });

    const onClose = () => upstream.data.destroy();
    req.on('close', onClose);
    res.on('close', onClose);

    upstream.data.on('error', err => {
      console.error('[zg] upstream stream error:', err.message);
      if (!res.headersSent) apiError(res, 502, 'Stream terputus');
      else res.end();
    });

    stream.pipeline(upstream.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error('[zg] pipeline error:', err.message);
      }
    });

  } catch (err) {
    console.error('[zg] stream error:', err.message);
    if (!res.headersSent) apiError(res, 502, 'Gagal streaming video');
  }
});

/* ════════════════════════════════════════════════════════════════════
   THUMBNAIL PROXY
   GET /proxy/zg/thumb?url=...
   Proxy cdn-o9.zoig1.com thumbnails (dan zoigvids.zoigg.com jika perlu)
════════════════════════════════════════════════════════════════════ */
router.get('/proxy/zg/thumb', async (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).end();
  let target;
  try { target = decodeURIComponent(raw); } catch { return res.status(400).end(); }
  if (!isAllowedZgUrl(target)) return res.status(403).end();

  const cached = zgThumbCache.get(target);
  if (cached === '') return res.status(404).end();

  try {
    const upstream = await axZgStream.get(target, {
      headers:      { 'User-Agent': UA, 'Referer': `${ZG_BASE}/` },
      responseType: 'stream',
      timeout:      12000,
    });

    const ct = upstream.headers['content-type'] || '';
    if (!ct.startsWith('image/')) {
      upstream.data.destroy();
      zgThumbCache.set(target, '');
      return res.status(415).end();
    }

    res.setHeader('content-type', ct);
    res.setHeader('cache-control', 'public, max-age=86400');

    const onClose = () => upstream.data.destroy();
    req.on('close', onClose);
    res.on('close', onClose);

    upstream.data.on('error', err => {
      console.error('[zg] thumb stream error:', err.message);
      if (!res.headersSent) res.status(502).end();
      else res.end();
    });

    stream.pipeline(upstream.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error('[zg] thumb pipeline error:', err.message);
      }
    });

  } catch (err) {
    console.error('[zg] thumb proxy error:', err.message);
    if (!res.headersSent) res.status(502).end();
  }
});

/* ── SPA routes — WAJIB, tanpa ini /zg jatuh ke index.html (Platform 1) ── */
router.get('/zg',   (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'zg.html')));
router.get('/zg/*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'zg.html')));

module.exports = { router, caches: [zgPostsCache, zgVideoCache, zgThumbCache] };
