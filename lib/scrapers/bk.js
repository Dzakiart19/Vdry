/* ═══════════════════════════════════════════════════════════════════════
   PLATFORM 4 — BokepKing (bokepking.cam)
   WordPress + WP REST API listing · Direct MP4 stream proxy.
   API bypass: /?rest_route=/wp/v2/posts (403 untuk /wp-json/wp/v2/posts).
   Video URL dari HTML scrape: <meta itemprop="contentURL" content="...mp4">.
   Stream CDN: vdn.bokepking.cam — support Range, tanpa signed token.
   Terisolasi penuh dari P1/P2/P3 — tidak share cache atau state apa pun.
═══════════════════════════════════════════════════════════════════════ */

const express = require('express');
const cheerio = require('cheerio');
const axios   = require('axios');
const https   = require('https');
const stream  = require('stream');
const path    = require('path');

const { makeCache }              = require('../cache');
const { UA, apiError, axNoRedirect } = require('../proxy');
const { logCdnAlert }            = require('../monitor');
const { registerSlug }           = require('../shortlink');

const router = express.Router();

const BK_BASE   = 'https://bokepking.cam';
const BK_CDN    = 'vdn.bokepking.cam';
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

const baseHeaders = {
  'User-Agent':      UA,
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
  'Referer':         `${BK_BASE}/`,
};

/* ── Force IPv4 — sama seperti P2/P3, mencegah IP drift saat Replit autoscale ke IPv6 ── */
const ipv4Agent = new https.Agent({ family: 4 });

/* ── Axios instance untuk semua request P4 ── */
const axBk = axios.create({
  timeout:      20000,
  maxRedirects: 5,
  httpsAgent:   ipv4Agent,
});

/* ── Axios instance untuk stream proxy (tanpa maxRedirects agar bisa ikuti redirect CDN) ── */
const axBkStream = axios.create({
  timeout:        30000,
  maxRedirects:   5,
  validateStatus: s => s < 500,
  httpsAgent:     ipv4Agent,
});

/* ── Retry wrapper — berhenti pada 4xx definitif, retry pada network error ── */
async function axBkGet(url, config = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await axBk.get(url, config);
    } catch (err) {
      lastErr = err;
      if (err.response?.status >= 400 && err.response?.status < 500) throw err;
      if (i < retries) await new Promise(r => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ── Strict CDN allowlist ── */
function isAllowedBkCdnUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    if (u.hostname === BK_CDN || u.hostname.endsWith('.' + BK_CDN)) return true;
    logCdnAlert(`[cdn-alert] P4 stream domain baru terdeteksi: "${u.hostname}" — tambahkan ke allowlist jika legit`);
    return false;
  } catch { return false; }
}

function isAllowedBkThumbUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    if (u.hostname === BK_CDN || u.hostname.endsWith('.' + BK_CDN)) return true;
    logCdnAlert(`[cdn-alert] P4 thumbnail domain baru terdeteksi: "${u.hostname}"`);
    return false;
  } catch { return false; }
}

/* ── Caches Platform 4 ─────────────────────────────────────────────────
   bkPostsCache   — hasil listing/search termasuk thumb URL (TTL 3 mnt)
   bkThumbCache   — mediaId → thumbUrl; thumbnail WP tidak berubah (TTL 24 jam)
   bkVideoUrlCache — slug → {mp4Url, title, thumb}; CDN vdn.bokepking.cam
                     tidak pakai signed token jadi TTL 30 mnt aman
──────────────────────────────────────────────────────────────────────── */
const bkPostsCache    = makeCache(200,  3  * 60 * 1000,        'p4_posts');
const bkCategoriesCache = makeCache(1,  60 * 60 * 1000,        'p4_categories'); // daftar kategori (TTL 1 jam)
const bkThumbCache    = makeCache(2000, 24 * 60 * 60 * 1000,   'p4_thumb');
const bkVideoUrlCache = makeCache(300,  30 * 60 * 1000,        'p4_videoUrl');

/* ═══════════════════════════════════════
   POSTS LISTING + SEARCH API
   GET /api/bk/posts?p=N&q=query
═══════════════════════════════════════ */
/* ── BK: Categories (WP REST API via rest_route bypass) ── */
router.get('/api/bk/categories', async (_req, res) => {
  const cached = bkCategoriesCache.get('list');
  if (cached) return res.json(cached);
  try {
    const { data } = await axBkGet(
      `${BK_BASE}/?rest_route=/wp/v2/categories&per_page=100&_fields=id,name,slug,count&orderby=count&order=desc`,
      { headers: { ...baseHeaders, 'Accept': 'application/json' } }
    );
    const list = (data || []).filter(c => c.slug !== 'uncategorized' && c.count > 0);
    bkCategoriesCache.set('list', list);
    res.json(list);
  } catch (err) {
    console.error('[bk] categories error:', err.message);
    apiError(res, 502, 'Gagal memuat kategori');
  }
});

router.get('/api/bk/posts', async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.p) || 1);
  const q     = (req.query.q || '').trim().substring(0, 200);
  const catId = /^\d+$/.test(req.query.cat || '') ? req.query.cat : '';
  const key   = `${page}:${q}:${catId}`;

  const cached = bkPostsCache.get(key);
  if (cached !== null) {
    if (cached._error)          return apiError(res, 502, 'Gagal memuat daftar video');
    if (cached._status === 404) return apiError(res, 404, 'Tidak ada video');
    if (cached._status === 400) return apiError(res, 400, 'Parameter tidak valid');
    return res.json(cached);
  }

  try {
    // WP REST API bypass: /?rest_route= menghindari 403 pada /wp-json/wp/v2/posts
    let qs = `/?rest_route=/wp/v2/posts&per_page=40&page=${page}&_fields=id,slug,title,date,featured_media&order=desc`;
    if (q) {
      qs += `&search=${encodeURIComponent(q)}&orderby=relevance`;
    } else {
      qs += `&orderby=date`;
      if (catId) qs += `&categories=${catId}`;
    }

    const { data: posts, headers } = await axBkGet(`${BK_BASE}${qs}`, {
      headers: { ...baseHeaders, 'Accept': 'application/json' },
    });

    const totalPages = Math.max(1, parseInt(headers['x-wp-totalpages']) || 1);

    // Throttle 30s jika hasil kosong — mencegah hammer upstream (pola sama P2/P3)
    if (!posts.length) {
      const empty = { posts: [], totalPages: 1 };
      bkPostsCache.set(key, empty, 30_000);
      return res.json(empty);
    }

    // Fetch thumbnail URL secara paralel untuk tiap featured_media ID
    // bkThumbCache TTL 24 jam — setelah cache warm, ini gratis
    await Promise.all(posts.map(async (p) => {
      if (!p.featured_media) return;
      const mediaId = p.featured_media;
      // get() === null berarti belum di-cache, bukan string kosong (sentinel)
      if (bkThumbCache.get(mediaId) !== null) return;
      try {
        const { data: media } = await axBk.get(
          `${BK_BASE}/?rest_route=/wp/v2/media/${mediaId}&_fields=source_url`,
          { headers: { ...baseHeaders, 'Accept': 'application/json' }, timeout: 8000 }
        );
        bkThumbCache.set(mediaId, media.source_url || '');
      } catch {
        bkThumbCache.set(mediaId, ''); // sentinel kosong agar tidak retry terus
      }
    }));

    const assembled = posts.map(p => ({
      id:    p.id,
      slug:  p.slug,
      title: p.title?.rendered || p.slug,
      date:  p.date,
      thumb: bkThumbCache.get(p.featured_media) || '',
    }));

    const result = { posts: assembled, totalPages, category: catId || null };
    bkPostsCache.set(key, result);
    res.json(result);

  } catch (err) {
    console.error('[bk] posts error:', err.message);
    if (err.response?.status === 400) {
      bkPostsCache.set(key, { _status: 400 }, 30_000);
      return apiError(res, 400, 'Parameter tidak valid');
    }
    if (err.response?.status === 404) {
      bkPostsCache.set(key, { _status: 404 }, 30_000);
      return apiError(res, 404, 'Tidak ada video');
    }
    bkPostsCache.set(key, { _error: true }, 20_000);
    apiError(res, 502, 'Gagal memuat daftar video');
  }
});

/* ═══════════════════════════════════════
   VIDEO INFO API
   GET /api/bk/video/:slug
   Resolve MP4 URL dari HTML — cache 30 mnt.
═══════════════════════════════════════ */
router.get('/api/bk/video/:slug', async (req, res) => {
  const slug = req.params.slug;
  if (!/^[a-z0-9-]+$/i.test(slug)) return apiError(res, 400, 'Invalid slug');

  const cached = bkVideoUrlCache.get(slug);
  if (cached !== null) {
    if (cached._error)          return apiError(res, 502, 'Gagal mengambil info video');
    if (cached._status === 404) return apiError(res, 404, 'Video tidak ditemukan');
    return res.json({
      slug,
      title:       cached.title,
      thumb:       cached.thumb,
      description: cached.description || '',
      related:     cached.related || [],
      mp4Url:      '/proxy/bk/stream/' + encodeURIComponent(slug),
      token:       registerSlug('bk', slug),
    });
  }

  try {
    const mp4Url = await resolveBkMp4(slug);
    if (!mp4Url) return apiError(res, 404, 'Sumber video tidak ditemukan');

    const entry = bkVideoUrlCache.get(slug);
    res.json({
      slug,
      title:       entry?.title || slug,
      thumb:       entry?.thumb || '',
      description: entry?.description || '',
      related:     entry?.related || [],
      mp4Url:      '/proxy/bk/stream/' + encodeURIComponent(slug),
      token:       registerSlug('bk', slug),
    });
  } catch (err) {
    console.error('[bk] video info error:', err.message);
    if (err.response?.status === 404) {
      bkVideoUrlCache.set(slug, { _status: 404 }, 30_000);
      return apiError(res, 404, 'Video tidak ditemukan');
    }
    bkVideoUrlCache.set(slug, { _error: true }, 20_000);
    apiError(res, 502, 'Gagal mengambil info video');
  }
});

/* ── Resolve MP4 URL dari HTML: <meta itemprop="contentURL" content="...mp4"> ── */
async function resolveBkMp4(slug, evictFirst = false) {
  if (evictFirst) bkVideoUrlCache.del(slug);
  const cached = bkVideoUrlCache.get(slug);
  if (cached) return cached.mp4Url;

  const { data: html } = await axBkGet(`${BK_BASE}/${slug}/`, {
    headers: { ...baseHeaders },
  });

  const $ = cheerio.load(html);

  // Primary: <meta itemprop="contentURL" content="...mp4">
  // Fallback: <source type="video/mp4" src="...">
  const mp4Url = $('meta[itemprop="contentURL"]').attr('content')
              || $('source[type="video/mp4"]').attr('src')
              || null;

  if (!mp4Url || !isAllowedBkCdnUrl(mp4Url)) {
    logCdnAlert(`[cdn-alert] P4 gagal resolve MP4 untuk "${slug}" — URL ditemukan: "${mp4Url || 'kosong'}"`);
    return null;
  }

  const title = $('meta[itemprop="name"]').attr('content')
             || $('h1').first().text().trim()
             || slug;
  const thumb = $('meta[itemprop="thumbnailUrl"]').attr('content')
             || $('meta[property="og:image"]').attr('content')
             || '';
  const description = $('meta[property="og:description"]').attr('content')
                    || $('meta[itemprop="description"]').attr('content')
                    || $('meta[name="description"]').attr('content')
                    || '';

  // ── Related videos ────────────────────────────────────────────────────
  // bokepking.cam merender "video lainnya" di bawah player tanpa heading
  // "Related videos" eksplisit (beda dari yobokep.com), markup-nya:
  // <div class="under-video-block"><div class="videos-list">
  //   <article id="post-N" class="thumb-block ..."><a href title>
  //     <img data-src="..."><div class="duration">MM:SS</div>
  //   </a>...<span class="title">...</span></article>
  // </div></div> (dicek via curl langsung ke halaman post). Hanya ada SATU
  // .under-video-block di halaman ini, jadi container-nya sendiri sudah
  // cukup unik untuk dijadikan scope tanpa perlu filter heading tambahan.
  const related = [];
  const seenSlugs = new Set([slug]);
  $('.under-video-block > .videos-list > article[id]').each((_, el) => {
    const $el   = $(el);
    const $link = $el.find('> a').first();
    const rHref  = $link.attr('href') || '';
    const rThumb = $link.find('img').attr('data-src')
                || $link.find('img').attr('src')
                || '';
    const rTitle = $el.find('.title').first().text().trim()
                || $link.find('img').attr('alt')
                || $link.attr('title')
                || '';
    const rDuration = $link.find('.duration').text().trim();
    const m = rHref.match(/bokepking\.cam\/([^/]+)\/?$/);
    const rSlug = m ? m[1] : '';
    if (rSlug && rTitle && !seenSlugs.has(rSlug)) {
      seenSlugs.add(rSlug);
      related.push({ slug: rSlug, title: rTitle, thumb: rThumb, duration: rDuration });
    }
  });

  bkVideoUrlCache.set(slug, { mp4Url, title, thumb, description, related });
  return mp4Url;
}

/* ═══════════════════════════════════════
   STREAM PROXY  (Range support + evict/retry seperti P1)
   GET /proxy/bk/stream/:slug
═══════════════════════════════════════ */
router.get('/proxy/bk/stream/:slug', async (req, res) => {
  const slug = req.params.slug;
  if (!/^[a-z0-9-]+$/i.test(slug)) return apiError(res, 400, 'Invalid slug');

  // Step 1 — resolve URL MP4 (dari cache atau scrape HTML)
  let mp4Url;
  try {
    mp4Url = await resolveBkMp4(slug);
  } catch (err) {
    console.error('[bk] stream resolve error:', err.message);
    return apiError(res, 502, 'Gagal resolve URL video');
  }

  if (!mp4Url || !isAllowedBkCdnUrl(mp4Url)) {
    return apiError(res, 404, 'Sumber video tidak ditemukan');
  }

  // Step 2 — proxy ke CDN dengan Range support
  const reqHeaders = {
    'User-Agent': UA,
    'Referer':    `${BK_BASE}/`,
    'Origin':     BK_BASE,
  };
  if (req.headers.range) reqHeaders['Range'] = req.headers.range;

  async function fetchUpstream(url) {
    return axBkStream.get(url, {
      headers:      reqHeaders,
      responseType: 'stream',
    });
  }

  try {
    let upstream = await fetchUpstream(mp4Url);

    // Jika CDN tolak URL (file dipindah / 403/404), evict cache & re-scrape sekali
    if (upstream.status === 403 || upstream.status === 404) {
      upstream.data.destroy();
      console.warn(`[bk-stream-evict] CDN ${upstream.status} for "${slug}" — re-resolving`);
      try {
        mp4Url = await resolveBkMp4(slug, true /* evictFirst */);
      } catch (e) {
        console.error('[bk] stream re-resolve error:', e.message);
        return apiError(res, 502, 'Gagal resolve URL video');
      }
      if (!mp4Url || !isAllowedBkCdnUrl(mp4Url)) {
        return apiError(res, 404, 'Sumber video tidak ditemukan');
      }
      upstream = await fetchUpstream(mp4Url);
    }

    res.status(upstream.status);
    // Selalu set accept-ranges — CDN vdn.bokepking.cam support Range (dikonfirmasi di recon)
    res.setHeader('accept-ranges', 'bytes');
    ['content-type', 'content-length', 'content-range', 'cache-control', 'last-modified', 'etag']
      .forEach(h => { if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]); });

    const onClose = () => upstream.data.destroy();
    req.on('close', onClose);
    res.on('close', onClose);

    upstream.data.on('error', err => {
      console.error('[bk] upstream stream error:', err.message);
      if (!res.headersSent) apiError(res, 502, 'Stream terputus');
      else res.end();
    });

    stream.pipeline(upstream.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error('[bk] pipeline error:', err.message);
      }
    });

  } catch (err) {
    console.error('[bk] stream error:', err.message);
    if (!res.headersSent) apiError(res, 502, 'Gagal streaming video');
  }
});

/* ═══════════════════════════════════════
   THUMBNAIL PROXY  (strict, no redirects)
   GET /proxy/bk/thumb?url=...
═══════════════════════════════════════ */
router.get('/proxy/bk/thumb', async (req, res) => {
  const raw = req.query.url;
  if (!raw || !isAllowedBkThumbUrl(raw)) return res.status(400).end();

  try {
    const upstream = await axNoRedirect.get(raw, {
      headers:      { 'User-Agent': UA, 'Referer': `${BK_BASE}/` },
      responseType: 'stream',
    });

    const ct = upstream.headers['content-type'] || '';
    if (!ct.startsWith('image/')) {
      upstream.data.destroy();
      return res.status(415).end();
    }

    res.setHeader('content-type', ct);
    res.setHeader('cache-control', 'public, max-age=86400');

    const onClose = () => upstream.data.destroy();
    req.on('close', onClose);
    res.on('close', onClose);

    upstream.data.on('error', err => {
      console.error('[bk] thumb stream error:', err.message);
      if (!res.headersSent) res.status(502).end();
      else res.end();
    });

    stream.pipeline(upstream.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error('[bk] thumb pipeline error:', err.message);
      }
    });

  } catch (err) {
    console.error('[bk] thumb proxy error:', err.message);
    if (!res.headersSent) res.status(502).end();
  }
});

/* ═══════════════════════════════════════
   HTML ROUTES
   Serve bk.html untuk semua /bk path
   (sama seperti pola rb.js dan yb.js)
═══════════════════════════════════════ */
router.get('/bk',   (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'bk.html')));
router.get('/bk/*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'bk.html')));

module.exports = { router, caches: [bkPostsCache, bkVideoUrlCache, bkThumbCache, bkCategoriesCache] };
