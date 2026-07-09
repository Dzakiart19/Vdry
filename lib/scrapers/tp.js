/* ═══════════════════════════════════════════════════════════════════════
   PLATFORM 5 — tik.porn (TP) "Vidorey TikTok"
   __NEXT_DATA__ scrape → HLS proxy via video-cdn.tik.porn.
   Token TTL ~1 tahun → tidak perlu self-healing; cache 24 jam aman.
   Terisolasi penuh dari P1-P4 — tidak share cache atau state apa pun.
═══════════════════════════════════════════════════════════════════════ */

const express = require('express');
const cheerio = require('cheerio');
const axios   = require('axios');
const stream  = require('stream');
const path    = require('path');

const { makeCache }                          = require('../cache');
const { UA, apiError, axNoRedirect, resolveUrl } = require('../proxy');
const { logCdnAlert }                        = require('../monitor');
const { registerSlug }                       = require('../shortlink');

const router = express.Router();

const TP_BASE    = 'https://tik.porn';
const TP_CDN     = 'video-cdn.tik.porn';
const TP_IMG_CDN = 'image-cdn.tik.porn';
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

const tpHeaders = {
  'User-Agent':      UA,
  'Referer':         `${TP_BASE}/`,
  'Accept-Encoding': 'gzip, deflate',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/* ── Axios instance untuk request ke tik.porn ── */
const axTp = axios.create({ timeout: 25000, maxRedirects: 5 });

async function axTpGet(url, config = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await axTp.get(url, config);
    } catch (err) {
      lastErr = err;
      if (err.response?.status >= 400 && err.response?.status < 500) throw err;
      if (i < retries) await new Promise(r => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ── CDN allowlist ── */
function isAllowedTpCdnUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    if (u.hostname === TP_CDN || u.hostname.endsWith('.' + TP_CDN)) return true;
    logCdnAlert(`[cdn-alert] P5 video domain baru: "${u.hostname}" — tambahkan ke allowlist jika legit`);
    return false;
  } catch { return false; }
}

function isAllowedTpThumbUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    if (u.hostname === TP_IMG_CDN || u.hostname.endsWith('.' + TP_IMG_CDN)) return true;
    logCdnAlert(`[cdn-alert] P5 thumbnail domain baru: "${u.hostname}"`);
    return false;
  } catch { return false; }
}

/* ── Base64url encode/decode untuk param URL di proxy ── */
function encodeB64Url(str) { return Buffer.from(str).toString('base64url'); }
function decodeB64Url(str) {
  try { return Buffer.from(str, 'base64url').toString('utf8'); } catch { return ''; }
}

/* ── Redirect-safe GET: follow redirects tapi validasi setiap hop ──────────
   Mencegah CDN redirect bypass allowlist: sebelum follow redirect, URL
   tujuan divalidasi. Max 3 hop untuk menghindari redirect loop.
── */
async function axTpGetSafe(url, config = {}, maxHops = 3) {
  let current = url;
  for (let hop = 0; hop <= maxHops; hop++) {
    const resp = await axTp.get(current, { ...config, maxRedirects: 0, validateStatus: s => s < 500 });
    if (resp.status < 300) return resp;
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.location;
      if (!location) throw new Error('Redirect tanpa Location header');
      const abs = resolveUrl(location, current);
      if (!isAllowedTpCdnUrl(abs)) {
        logCdnAlert(`[cdn-alert] P5 redirect ke domain tidak diizinkan: "${new URL(abs).hostname}"`);
        throw new Error('Redirect ke domain yang tidak diizinkan');
      }
      current = abs;
      continue;
    }
    throw new Error(`CDN HTTP ${resp.status}`);
  }
  throw new Error('Terlalu banyak redirect');
}

/* ── Caches Platform 5 ─────────────────────────────────────────────────
   tpPostsCache — listing/search result (10 mnt)
   tpVideoCache — video info payload + raw HLS CDN URL (24 jam)
                  key: 'video:{id}' → payload, 'hls:{id}' → CDN URL
   tpThumbCache — reserved (1 jam) — saat ini tidak dipakai aktif
                  tapi disertakan di module.exports.caches untuk health stats
──────────────────────────────────────────────────────────────────────── */
const tpPostsCache = makeCache(500,  10 * 60 * 1000,      'p5_posts');
const tpVideoCache = makeCache(1000, 24 * 60 * 60 * 1000, 'p5_video');
const tpThumbCache = makeCache(500,  60 * 60 * 1000,       'p5_thumb');

/* ── Parse __NEXT_DATA__ dari HTML response tik.porn ── */
async function fetchNextData(url) {
  const { data: html } = await axTpGet(url, { headers: tpHeaders });
  const $ = cheerio.load(html);
  const raw = $('#__NEXT_DATA__').text();
  if (!raw) throw new Error('__NEXT_DATA__ tidak ditemukan di halaman');
  const json = JSON.parse(raw);
  return json.props.pageProps;
}

/* ── Strip placeholder tag TikTok dari caption ── */
function stripTagPlaceholders(text) {
  return (text || '').replace(/#\{\{tag:\d+\}\}/g, '').trim();
}

/* ── Normalize video object dari __NEXT_DATA__ → format response API ── */
function normalizeVideo(v) {
  return {
    id:          v.id,
    duration:    v.duration || 0,
    likes:       v.likes    || 0,
    views:       v.views    || 0,
    tags:        (v.tags    || []).map(t => ({ id: t.id, name: t.name, slug: t.slug })),
    user:        v.user     ? { id: v.user.id, name: v.user.name, slug: v.user.slug } : null,
    thumbnailSm: v.thumbnails?.sm || '',
    caption:     stripTagPlaceholders(v.texts?.video?.text || ''),
  };
}

/* ══════════════════════════════════════════════
   POSTS LISTING + SEARCH
   GET /api/tp/posts?page=1&tag=&q=

   Tiga mode:
     (a) q tidak kosong  → search (?s=query&page=N) — multi-page, bekerja
     (b) tag tidak kosong → tag feed (/tag/{slug})  — hanya page 1 (SSR tik.porn
         tidak benar-benar mengganti konten saat ?page=N pada tag/homepage; 
         pagination dilakukan client-side oleh tik.porn sehingga tidak bisa
         di-scrape via __NEXT_DATA__)
     (c) default (tanpa q/tag) → homepage featured via initialRelatedVideos
         — hanya page 1, 10 video dari "related/recommended" section homepage
═══════════════════════════════════════════════ */
router.get('/api/tp/posts', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const tag  = (req.query.tag || '').trim().replace(/[^a-zA-Z0-9._-]/g, '');
  const q    = (req.query.q   || '').trim().substring(0, 200);

  /* ── Mode (a): Search — satu-satunya yang bisa multi-page ── */
  if (q) {
    const cacheKey = `posts:q:${q}:${page}`;
    const cached   = tpPostsCache.get(cacheKey);
    if (cached !== null) {
      if (cached._error)          return apiError(res, 502, 'Gagal memuat video');
      if (cached._status === 404) return apiError(res, 404, 'Tidak ada video');
      return res.json(cached);
    }
    try {
      const pageProps = await fetchNextData(`${TP_BASE}/?s=${encodeURIComponent(q)}&page=${page}`);
      const videoData = pageProps.initialVideoResults;
      if (!videoData) {
        const empty = { videos: [], pagination: { page, totalPages: 1, hasMore: false }, query: q, mode: 'search' };
        tpPostsCache.set(cacheKey, empty, 30_000);
        return res.json(empty);
      }
      const videos = (videoData.data || []).map(normalizeVideo);
      const pag    = videoData.pagination || {};
      const result = {
        videos,
        pagination: { page: pag.page ?? page, totalPages: pag.totalPages ?? 1, hasMore: !!pag.hasMore },
        query: q,
        mode: 'search',
      };
      tpPostsCache.set(cacheKey, result, videos.length ? undefined : 30_000);
      return res.json(result);
    } catch (err) {
      console.error('[tp] search error:', err.message);
      if (err.response?.status === 404) {
        tpPostsCache.set(`posts:q:${q}:${page}`, { _status: 404 }, 30_000);
        return apiError(res, 404, 'Tidak ada video');
      }
      tpPostsCache.set(`posts:q:${q}:${page}`, { _error: true }, 20_000);
      return apiError(res, 502, 'Gagal memuat video');
    }
  }

  /* ── Mode (b): Tag — hanya page 1 (SSR pagination tidak bekerja) ── */
  if (tag) {
    const cacheKey = `posts:tag:${tag}`;
    const cached   = tpPostsCache.get(cacheKey);
    if (cached !== null) {
      if (cached._error)          return apiError(res, 502, 'Gagal memuat video');
      if (cached._status === 404) return apiError(res, 404, 'Tag tidak ditemukan');
      return res.json(cached);
    }
    // Page > 1 tidak berguna untuk tag — kembalikan kosong
    if (page > 1) {
      return res.json({ videos: [], pagination: { page, totalPages: 1, hasMore: false }, query: '', mode: 'tag' });
    }
    try {
      const pageProps = await fetchNextData(`${TP_BASE}/tag/${tag}`);
      const videoData = pageProps.videos;
      if (!videoData || !videoData.data?.length) {
        tpPostsCache.set(cacheKey, { _status: 404 }, 30_000);
        return apiError(res, 404, 'Tag tidak ditemukan');
      }
      const videos = videoData.data.filter(v => v.id).map(normalizeVideo);
      const result = {
        videos,
        // hasMore: false — pagination tag tidak bekerja server-side
        pagination: { page: 1, totalPages: 1, hasMore: false },
        query: '',
        mode: 'tag',
        tag,
      };
      tpPostsCache.set(cacheKey, result);
      return res.json(result);
    } catch (err) {
      console.error('[tp] tag error:', err.message);
      if (err.response?.status === 404) {
        tpPostsCache.set(cacheKey, { _status: 404 }, 30_000);
        return apiError(res, 404, 'Tag tidak ditemukan');
      }
      tpPostsCache.set(cacheKey, { _error: true }, 20_000);
      return apiError(res, 502, 'Gagal memuat video');
    }
  }

  /* ── Mode (c): Default homepage — initialRelatedVideos, hanya page 1 ── */
  const cacheKey = 'posts:home';
  const cached   = tpPostsCache.get(cacheKey);
  if (cached !== null) {
    if (cached._error) return apiError(res, 502, 'Gagal memuat video');
    return res.json(cached);
  }
  // Page > 1 tidak ada konten baru di homepage
  if (page > 1) {
    return res.json({ videos: [], pagination: { page, totalPages: 1, hasMore: false }, query: '', mode: 'home' });
  }
  try {
    const pageProps = await fetchNextData(`${TP_BASE}/`);
    const relatedVids = pageProps.initialRelatedVideos;
    const videos = (relatedVids?.data || []).filter(v => v.id).map(normalizeVideo);
    const result = {
      videos,
      pagination: { page: 1, totalPages: 1, hasMore: false },
      query: '',
      mode: 'home',
    };
    tpPostsCache.set(cacheKey, result);
    return res.json(result);
  } catch (err) {
    console.error('[tp] home error:', err.message);
    tpPostsCache.set(cacheKey, { _error: true }, 20_000);
    return apiError(res, 502, 'Gagal memuat video');
  }
});

/* ══════════════════════════════════════════════
   VIDEO INFO
   GET /api/tp/video/:id
   Scrape __NEXT_DATA__ → firstVideo → ambil HLS URL dari sources[].
   Simpan raw CDN URL ke cache 'hls:{id}' untuk dipakai proxy.
═══════════════════════════════════════════════ */
router.get('/api/tp/video/:id', async (req, res) => {
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return apiError(res, 400, 'Invalid video ID');

  const cached = tpVideoCache.get(`video:${id}`);
  if (cached !== null) {
    if (cached._error)          return apiError(res, 502, 'Gagal mengambil info video');
    if (cached._status === 404) return apiError(res, 404, 'Video tidak ditemukan');
    return res.json({ ...cached, token: registerSlug('tp', id) });
  }

  try {
    const pageProps = await fetchNextData(`${TP_BASE}/video/${id}`);
    const v = pageProps.firstVideo;
    if (!v) {
      tpVideoCache.set(`video:${id}`, { _status: 404 }, 30_000);
      return apiError(res, 404, 'Video tidak ditemukan');
    }

    // Ambil HLS URL dari sources[]
    const hlsSrc = (v.sources || []).find(s => s.type === 'application/x-mpegURL')?.src || '';
    if (!hlsSrc || !isAllowedTpCdnUrl(hlsSrc)) {
      console.error('[tp] video CDN URL tidak valid:', hlsSrc);
      tpVideoCache.set(`video:${id}`, { _error: true }, 20_000);
      return apiError(res, 502, 'Sumber video tidak tersedia');
    }

    const payload = {
      id,
      title:       v.metadata?.title || stripTagPlaceholders(v.texts?.video?.text || '') || `Video ${id}`,
      caption:     stripTagPlaceholders(v.texts?.video?.text || ''),
      poster:      v.poster         || v.thumbnails?.md || '',
      thumbnailSm: v.thumbnails?.sm || '',
      thumbnailMd: v.thumbnails?.md || '',
      duration:    v.duration    || 0,
      likes:       v.likes       || 0,
      views:       v.views       || 0,
      comments:    v.comments    || 0,
      tags:        (v.tags       || []).map(t => ({ id: t.id, name: t.name, slug: t.slug })),
      user:        v.user        ? { id: v.user.id, name: v.user.name, slug: v.user.slug } : null,
      hlsUrl:      `/proxy/tp/hls/${id}`,
    };

    // Simpan raw CDN URL terpisah — dipakai /proxy/tp/hls/:id
    tpVideoCache.set(`hls:${id}`, hlsSrc);
    tpVideoCache.set(`video:${id}`, payload);

    res.json({ ...payload, token: registerSlug('tp', id) });

  } catch (err) {
    console.error('[tp] video error:', err.message);
    if (err.response?.status === 404) {
      tpVideoCache.set(`video:${id}`, { _status: 404 }, 30_000);
      return apiError(res, 404, 'Video tidak ditemukan');
    }
    tpVideoCache.set(`video:${id}`, { _error: true }, 20_000);
    apiError(res, 502, 'Gagal mengambil info video');
  }
});

/* ── Rewrite m3u8 manifest: semua URL relatif → /proxy/tp/seg?url=<base64url> ── */
function rewriteTpM3u8(content, baseUrl) {
  return content.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      // Rewrite URI= attribute di dalam tag (mis. #EXT-X-KEY:URI="...")
      return line.replace(/URI="([^"]+)"/g, (_, uri) => {
        const abs = resolveUrl(uri, baseUrl);
        return `URI="/proxy/tp/seg?url=${encodeB64Url(abs)}"`;
      });
    }
    // Baris URL (segment atau sub-manifest)
    const abs = resolveUrl(trimmed, baseUrl);
    return `/proxy/tp/seg?url=${encodeB64Url(abs)}`;
  }).join('\n');
}

/* ══════════════════════════════════════════════
   HLS MANIFEST PROXY
   GET /proxy/tp/hls/:id
   Fetch master.m3u8 dari CDN, rewrite semua URL ke /proxy/tp/seg.
   Browser tidak pernah tahu URL CDN asli.
═══════════════════════════════════════════════ */
router.get('/proxy/tp/hls/:id', async (req, res) => {
  const id = req.params.id;
  if (!/^\d+$/.test(id)) return res.status(400).end();

  try {
    let hlsUrl = tpVideoCache.get(`hls:${id}`);

    // Cache miss (server restart) — re-scrape sekali
    if (!hlsUrl) {
      const pageProps = await fetchNextData(`${TP_BASE}/video/${id}`);
      const v = pageProps.firstVideo;
      hlsUrl = (v?.sources || []).find(s => s.type === 'application/x-mpegURL')?.src || '';
      if (!hlsUrl || !isAllowedTpCdnUrl(hlsUrl)) return apiError(res, 404, 'Stream tidak ditemukan');
      tpVideoCache.set(`hls:${id}`, hlsUrl);
    }

    const resp = await axTpGetSafe(hlsUrl, {
      headers: { 'User-Agent': UA, 'Referer': `${TP_BASE}/` },
    });

    if (resp.status < 200 || resp.status >= 300) {
      return apiError(res, 502, 'CDN menolak manifest');
    }

    const baseUrl   = hlsUrl.substring(0, hlsUrl.lastIndexOf('/') + 1);
    const rewritten = rewriteTpM3u8(String(resp.data), baseUrl);

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(rewritten);

  } catch (err) {
    console.error('[tp] hls proxy error:', err.message);
    apiError(res, 502, 'Gagal memuat stream');
  }
});

/* ══════════════════════════════════════════════
   SEGMENT / SUB-MANIFEST PROXY
   GET /proxy/tp/seg?url=BASE64URL
   URL di-encode base64url oleh rewriteTpM3u8 dan client.
   Sub-manifest (.m3u8): rewrite lagi, kirim sebagai text.
   Segment (.ts / .key): pipe langsung ke client.
═══════════════════════════════════════════════ */
router.get('/proxy/tp/seg', async (req, res) => {
  const raw = decodeB64Url(req.query.url || '');
  if (!raw || !isAllowedTpCdnUrl(raw)) return res.status(400).end();

  try {
    // responseType stream tidak kompatibel dengan axTpGetSafe (redirect-safe)
    // → gunakan maxRedirects:0; CDN segment/key tidak seharusnya redirect
    const upstream = await axTp.get(raw, {
      headers:        { 'User-Agent': UA, 'Referer': `${TP_BASE}/` },
      responseType:   'stream',
      timeout:        20000,
      maxRedirects:   0,
      validateStatus: s => s < 500,
    });

    if (upstream.status < 200 || upstream.status >= 300) {
      upstream.data.destroy();
      return res.status(upstream.status < 500 ? 404 : 502).end();
    }

    const ct = (upstream.headers['content-type'] || '').toLowerCase();

    // Sub-manifest — rewrite lagi
    if (ct.includes('mpegurl') || raw.includes('.m3u8')) {
      let body = '';
      upstream.data.on('data', chunk => { body += chunk.toString(); });
      upstream.data.on('end', () => {
        const baseUrl   = raw.substring(0, raw.lastIndexOf('/') + 1);
        const rewritten = rewriteTpM3u8(body, baseUrl);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(rewritten);
      });
      upstream.data.on('error', () => { if (!res.headersSent) res.status(502).end(); });
      return;
    }

    // Segment binary (.ts / .key / dll)
    res.status(upstream.status);
    ['content-type', 'content-length', 'cache-control'].forEach(h => {
      if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
    });
    res.setHeader('Access-Control-Allow-Origin', '*');

    req.on('close', () => upstream.data.destroy());
    upstream.data.on('error', err => {
      console.error('[tp] seg stream error:', err.message);
      if (!res.headersSent) res.status(502).end();
    });
    stream.pipeline(upstream.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error('[tp] seg pipeline error:', err.message);
      }
    });

  } catch (err) {
    console.error('[tp] seg error:', err.message);
    if (!res.headersSent) res.status(502).end();
  }
});

/* ══════════════════════════════════════════════
   THUMBNAIL PROXY
   GET /proxy/tp/thumb?url=BASE64URL
   Validasi allowlist image-cdn.tik.porn, validasi content-type.
═══════════════════════════════════════════════ */
router.get('/proxy/tp/thumb', async (req, res) => {
  const raw = decodeB64Url(req.query.url || '');
  if (!raw || !isAllowedTpThumbUrl(raw)) return res.status(400).end();

  try {
    const upstream = await axNoRedirect.get(raw, {
      headers:      { 'User-Agent': UA, 'Referer': `${TP_BASE}/` },
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
      console.error('[tp] thumb error:', err.message);
      if (!res.headersSent) res.status(502).end();
    });
    stream.pipeline(upstream.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error('[tp] thumb pipeline error:', err.message);
      }
    });

  } catch (err) {
    console.error('[tp] thumb proxy error:', err.message);
    if (!res.headersSent) res.status(502).end();
  }
});

/* ══════════════════════════════════════════════
   HTML ROUTES — SPA fallback untuk semua /tp/* path
═══════════════════════════════════════════════ */
router.get('/tp',   (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'tp.html')));
router.get('/tp/*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'tp.html')));

module.exports = { router, caches: [tpPostsCache, tpVideoCache, tpThumbCache] };
