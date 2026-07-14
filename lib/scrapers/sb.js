/* ═══════════════════════════════════════════════════════════════════════
   PLATFORM 7 — situsbokep.cc (SB)
   HTML listing scrape (cheerio) → xvideos embedframe resolve → HLS proxy.
   Chain: situsbokep.cc/view/[slug] → itemprop="embedURL" →
          www.xvideos.com/embedframe/[xv_id] → setVideoHLS → *.xvideos-cdn.com
   Token TTL ~1 year, self-healing tetap diimplementasikan sebagai pengaman.
   Terisolasi penuh dari platform lain — tidak share cache atau state apapun.
═══════════════════════════════════════════════════════════════════════ */

const express = require('express');
const cheerio = require('cheerio');
const axios   = require('axios');
const https   = require('https');
const stream  = require('stream');

const { makeCache } = require('../cache');
const { UA, apiError, resolveUrl, basenameNoQuery } = require('../proxy');
const { logCdnAlert } = require('../monitor');
const { registerSlug } = require('../shortlink');

const router = express.Router();

const SB_BASE = 'https://situsbokep.cc';
const XV_BASE = 'https://www.xvideos.com';

const sbHeaders = {
  'User-Agent':      UA,
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate',
  'Referer':         `${SB_BASE}/`,
  'Cache-Control':   'no-cache',
};

const xvHeaders = {
  'User-Agent':      UA,
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate',
  'Referer':         'https://www.xvideos.com/',
};

/* ── Dedicated axios instance untuk situsbokep.cc ── */
const axSb = axios.create({
  timeout:      25000,
  maxRedirects: 5,
  httpsAgent:   new https.Agent({ keepAlive: false, family: 4 }),
});

async function axSbGet(url, config = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await axSb.get(url, config);
    } catch (err) {
      lastErr = err;
      if (err.response?.status >= 400 && err.response?.status < 500) throw err;
      if (i < retries) await new Promise(r => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ── Axios instance untuk xvideos CDN segment proxy ── */
const axSeg = axios.create({
  timeout: 20000, maxRedirects: 5, validateStatus: s => s < 500,
  httpsAgent: new https.Agent({ family: 4 }),
});

async function axSegGet(url, config = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await axSeg.get(url, config);
    } catch (err) {
      lastErr = err;
      if (err.response) throw err;
      if (i < retries) await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ── CDN allowlist ── */
const SB_CDN_ALLOWED_EXT = new Set(['.ts', '.m3u8', '.m3u', '.aac', '.mp4', '.m4s', '.key', '.init']);

function isAllowedSbCdnUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    const hostOk = (
      u.hostname.endsWith('.xvideos-cdn.com') ||
      u.hostname.endsWith('.xnxx-cdn.com')    ||
      u.hostname === 'xvideos-cdn.com'         ||
      u.hostname === 'xnxx-cdn.com'
    );
    const ext = u.pathname.substring(u.pathname.lastIndexOf('.')).toLowerCase().split('?')[0];
    const extOk = SB_CDN_ALLOWED_EXT.has(ext) || u.pathname.includes('.m3u8');
    const ok = hostOk && extOk;
    if (!hostOk) logCdnAlert(`[cdn-alert] P7 CDN domain baru: "${u.hostname}" — tambahkan ke isAllowedSbCdnUrl jika legit`);
    return ok;
  } catch { return false; }
}

/* ── Thumbnail allowlist ── */
function isAllowedSbThumb(raw) {
  try {
    const u = new URL(raw);
    return (
      u.hostname === 'situsbokep.cc'                      ||
      u.hostname.endsWith('.situsbokep.cc')               ||
      u.hostname.endsWith('.imserverx1.online')           ||
      u.hostname.endsWith('.imserverx2.online')           ||
      u.hostname.endsWith('.lotnok.com')                  ||
      u.hostname.endsWith('.xvideos-cdn.com')
    );
  } catch { return false; }
}

/* ── Caches ── */
const sbPostsCache = makeCache(200, 3 * 60 * 1000,   'p7_posts');
const sbCategoriesCache = makeCache(1, 60 * 60 * 1000, 'p7_categories'); // daftar kategori (TTL 1 jam)
const sbM3u8Cache  = makeCache(500, 8 * 60 * 60 * 1000, 'p7_m3u8'); // 8 jam — token XV valid ~1 tahun
const sbVideoCache = makeCache(300, 4 * 60 * 60 * 1000, 'p7_video'); // 4 jam
const sbFreshCache = makeCache(100, 60 * 1000,          'p7_fresh');

module.exports = { router, caches: [sbPostsCache, sbM3u8Cache, sbVideoCache, sbFreshCache, sbCategoriesCache] };

/* ── Rewrite m3u8 manifest → proxy our /proxy/sb/seg ── */
function rewriteM3u8(content, baseUrl, slug) {
  const suffix = slug ? `&_s=${encodeURIComponent(slug)}` : '';
  return content.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_, uri) => {
        const abs = resolveUrl(uri, baseUrl);
        return `URI="/proxy/sb/seg?url=${encodeURIComponent(abs)}${suffix}"`;
      });
    }
    const abs = resolveUrl(trimmed, baseUrl);
    return `/proxy/sb/seg?url=${encodeURIComponent(abs)}${suffix}`;
  }).join('\n');
}

/* ── Extract xvideos embed ID dari embedURL ── */
function extractXvId(embedUrl) {
  // Format: https://x.fbplay.vip/embed/https://www.xvideos.com/embedframe/[id]
  // atau: https://v.fbplay.vip/embed/https://www.xvideos.com/embedframe/[id]
  // atau langsung: https://www.xvideos.com/embedframe/[id]
  const m = embedUrl.match(/xvideos\.com\/embedframe\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

/* ── Resolve xvideos embed ID → HLS URL ── */
async function resolveXvHls(xvId) {
  const url = `${XV_BASE}/embedframe/${xvId}`;
  const { data: html } = await axSbGet(url, {
    headers: xvHeaders,
    timeout: 18000,
  });

  // Cari setVideoHLS terlebih dulu (kualitas lebih tinggi)
  let m = html.match(/html5player\.setVideoHLS\(['"]([^'"]+)['"]/);
  if (m) return m[1];

  // Fallback: setVideoUrlHigh
  m = html.match(/html5player\.setVideoUrlHigh\(['"]([^'"]+)['"]/);
  if (m) return m[1];

  // Fallback: setVideoUrlLow
  m = html.match(/html5player\.setVideoUrlLow\(['"]([^'"]+)['"]/);
  if (m) return m[1];

  return null;
}

/* ── Scrape listing HTML dari situsbokep.cc ── */
async function scrapeSbListing(url) {
  const { data: html } = await axSbGet(url, { headers: sbHeaders });
  const $ = cheerio.load(html);

  const posts = [];
  $('article.thumb-block, article.loop-video').each((_, el) => {
    const $el = $(el);
    // Link ke /view/[slug] — bisa absolute atau relative
    const $a  = $el.find('a[href*="/view/"]').first();
    const href = $a.attr('href') || '';
    const title = $a.attr('title')
               || $el.find('a[title]').first().attr('title')
               || $el.find('img').first().attr('alt')
               || '';

    // Thumbnail: data-src (lazy) atau src biasa, filter loading.gif
    const $img  = $el.find('img').first();
    const thumb = $img.attr('data-src') || $img.attr('src') || '';
    const thumbClean = (thumb && !thumb.includes('loading.gif') && !thumb.includes('data:image')) ? thumb : '';

    // Slug dari href — support absolute URL: https://situsbokep.cc/view/[slug]
    // Juga support relative: /view/[slug]
    const mSlug = href.match(/\/view\/([^/?#]+)/);
    const slug = mSlug ? decodeURIComponent(mSlug[1]) : '';

    if (slug && title) posts.push({ slug, title, thumb: thumbClean });
  });

  // Total pages dari pagination — situsbokep.cc pakai absolute URL
  // mis. href="https://situsbokep.cc/page/1381/"
  let totalPages = 1;
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/\/page\/(\d+)\/?(?:[?#]|$)/);
    if (m) {
      const n = parseInt(m[1]);
      if (n > totalPages) totalPages = n;
    }
  });

  return { posts, totalPages };
}

/* ── SB: Categories (WP REST API native) ── */
router.get('/api/sb/categories', async (_req, res) => {
  const cached = sbCategoriesCache.get('list');
  if (cached) return res.json(cached);
  try {
    const { data } = await axSbGet(
      `${SB_BASE}/wp-json/wp/v2/categories?per_page=100&_fields=id,name,slug,count&orderby=count&order=desc`,
      { headers: { ...sbHeaders, Accept: 'application/json' } }
    );
    const list = (data || []).filter(c => c.slug !== 'uncategorized' && c.count > 0);
    sbCategoriesCache.set('list', list);
    res.json(list);
  } catch (err) {
    console.error('sb categories error:', err.message);
    apiError(res, 502, 'Gagal memuat kategori');
  }
});

/* ── SB: Search via WP REST API (pagination akurat via X-WP-TotalPages) ──
   HTML scrape /?s=query&page=N tidak bekerja di WordPress — server selalu
   mengembalikan halaman 1. REST API /wp-json/wp/v2/posts?search=X&page=N
   punya pagination benar dan header X-WP-TotalPages yang reliable.
── */
async function searchSbViaApi(q, page) {
  const PER_PAGE = 24;
  const url = `${SB_BASE}/wp-json/wp/v2/posts` +
    `?search=${encodeURIComponent(q)}` +
    `&page=${page}` +
    `&per_page=${PER_PAGE}` +
    `&_embed=wp:featuredmedia` +
    `&_fields=slug,title,_embedded,_links`;

  const { data, headers } = await axSbGet(url, {
    headers: { ...sbHeaders, Accept: 'application/json' },
    timeout: 20000,
  });

  const totalPages = parseInt(headers['x-wp-totalpages'] || '1') || 1;

  const posts = (data || []).map(p => {
    const thumb = p._embedded?.['wp:featuredmedia']?.[0]?.source_url
               || p._embedded?.['wp:featuredmedia']?.[0]?.media_details?.sizes?.thumbnail?.source_url
               || '';
    return {
      slug:  p.slug || '',
      title: (p.title?.rendered || p.slug || '').replace(/&#(\d+);/g, (_, c) => String.fromCharCode(c)).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'"),
      thumb: thumb && isAllowedSbThumb(thumb) ? thumb : '',
    };
  }).filter(p => p.slug);

  return { posts, totalPages };
}

/* ── SB: Post listing ── */
router.get('/api/sb/posts', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.p) || 1);
  const cat  = (req.query.cat || '').replace(/[^a-z0-9-]/gi, '');
  const q    = (req.query.q  || '').trim().substring(0, 150);

  const cacheKey = `${page}:${cat}:${q}`;
  const cached = sbPostsCache.get(cacheKey);
  if (cached) {
    if (cached._error)             return apiError(res, 502, 'Gagal memuat konten');
    if (cached._status === 404)    return apiError(res, 404, 'Halaman tidak ditemukan');
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached);
  }

  try {
    let posts, totalPages;

    if (q) {
      /* Search: gunakan WP REST API — HTML scrape tidak support multi-page search */
      ({ posts, totalPages } = await searchSbViaApi(q, page));
    } else {
      /* Browse / kategori: tetap pakai HTML scrape (lebih lengkap) */
      let url;
      if (cat) {
        url = page > 1 ? `${SB_BASE}/bokep/${cat}/page/${page}/` : `${SB_BASE}/bokep/${cat}/`;
      } else {
        url = page > 1 ? `${SB_BASE}/page/${page}/` : `${SB_BASE}/`;
      }
      ({ posts, totalPages } = await scrapeSbListing(url));
    }

    const result = { posts, page, totalPages, category: cat || null };

    if (posts.length > 0) {
      sbPostsCache.set(cacheKey, result);
    } else {
      sbPostsCache.set(cacheKey, result, 30 * 1000);
    }

    res.setHeader('X-Cache', 'MISS');
    res.json(result);
  } catch (err) {
    console.error('sb posts error:', err.message);
    if (err.response?.status === 404) {
      sbPostsCache.set(cacheKey, { _status: 404 }, 30 * 1000);
      return apiError(res, 404, 'Halaman tidak ditemukan');
    }
    sbPostsCache.set(cacheKey, { _error: true }, 20 * 1000);
    apiError(res, 502, 'Gagal memuat konten');
  }
});

/* ── Scrape video page situsbokep.cc/view/[slug] ── */
async function fetchSbVideoPage(slug) {
  const url = `${SB_BASE}/view/${encodeURIComponent(slug)}`;
  const { data: html } = await axSbGet(url, { headers: sbHeaders });
  const $ = cheerio.load(html);

  const title = $('h1.entry-title, h1[itemprop="name"]').first().text().trim()
             || $('meta[property="og:title"]').attr('content')
             || slug;
  const thumb = $('meta[itemprop="thumbnailUrl"]').attr('content')
             || $('meta[property="og:image"]').attr('content')
             || '';
  const description = $('meta[property="og:description"]').attr('content')
                   || $('meta[name="description"]').attr('content')
                   || '';

  // Ambil embedURL dari schema.org itemprop
  const embedUrl = $('meta[itemprop="embedURL"]').attr('content')
                || $('iframe[src*="xvideos.com"], iframe[src*="fbplay.vip"]').first().attr('src')
                || '';

  // Related videos — artikel di bawah player
  const related = [];
  const seenSlugs = new Set([slug]);
  $('article.thumb-block, article.loop-video').each((_, el) => {
    const $el = $(el);
    const $a  = $el.find('a[href*="/view/"]').first();
    const href = $a.attr('href') || '';
    const $img = $el.find('img').first();
    const rThumb = $img.attr('data-src') || $img.attr('src') || '';
    const rTitle = $a.attr('title') || $img.attr('alt') || '';
    const mSlug  = href.match(/\/view\/([^/?#]+)/);
    const rSlug  = mSlug ? decodeURIComponent(mSlug[1]) : '';
    const rThumbClean = (rThumb && !rThumb.includes('loading.gif') && !rThumb.includes('data:image')) ? rThumb : '';
    if (rSlug && rTitle && !seenSlugs.has(rSlug)) {
      seenSlugs.add(rSlug);
      related.push({ slug: rSlug, title: rTitle, thumb: rThumbClean });
    }
  });

  return { embedUrl, title, thumb, description, related };
}

/* ── Fresh resolve (re-fetch xvideos embed, skip situsbokep fetch) ── */
async function freshResolveM3u8(slug) {
  // Coba dari cache dulu — ambil xvId yang tersimpan
  const cached = sbVideoCache.get(slug);
  let xvId = cached?._xvId || null;

  if (!xvId) {
    const { embedUrl } = await fetchSbVideoPage(slug);
    xvId = extractXvId(embedUrl);
  }
  if (!xvId) return null;

  const m3u8Url = await resolveXvHls(xvId);
  if (!m3u8Url || !isAllowedSbCdnUrl(m3u8Url)) return null;
  return { m3u8Url, xvId };
}

/* ── SB: Single video ── */
router.get('/api/sb/video/:slug(*)', async (req, res) => {
  const slug = req.params.slug;
  if (!slug || slug.length > 300) return apiError(res, 400, 'Invalid slug');

  const vidCached = sbVideoCache.get(slug);
  if (vidCached) {
    if (vidCached._error)          return apiError(res, 502, 'Gagal memuat video');
    if (vidCached._status === 404) return apiError(res, 404, vidCached._msg || 'Video tidak ditemukan');
    res.setHeader('X-Cache', 'HIT');
    return res.json({ ...vidCached, token: registerSlug('sb', slug) });
  }

  try {
    const { embedUrl, title, thumb, description, related } = await fetchSbVideoPage(slug);

    if (!embedUrl) {
      sbVideoCache.set(slug, { _status: 404, _msg: 'Player tidak ditemukan' }, 60 * 1000);
      return apiError(res, 404, 'Player tidak ditemukan');
    }

    const xvId = extractXvId(embedUrl);
    if (!xvId) {
      sbVideoCache.set(slug, { _status: 404, _msg: 'Sumber video tidak didukung' }, 60 * 1000);
      return apiError(res, 404, 'Sumber video tidak didukung');
    }

    // Cache-hit m3u8
    let m3u8Url = sbM3u8Cache.get(slug) || null;
    if (!m3u8Url || !isAllowedSbCdnUrl(m3u8Url)) {
      m3u8Url = await resolveXvHls(xvId);
    }

    if (!m3u8Url || !isAllowedSbCdnUrl(m3u8Url)) {
      sbVideoCache.set(slug, { _status: 404, _msg: 'Stream tidak dapat diakses' }, 60 * 1000);
      return apiError(res, 404, 'Stream tidak dapat diakses');
    }

    sbM3u8Cache.set(slug, m3u8Url);
    const payload = {
      slug, title, thumb, description, related,
      m3u8Url: `/proxy/sb/hls/${encodeURIComponent(slug)}`,
      _xvId: xvId,  // simpan untuk self-healing
    };
    sbVideoCache.set(slug, payload);
    return res.json({ ...payload, token: registerSlug('sb', slug) });

  } catch (err) {
    console.error('sb video error:', err.message);
    if (err.response?.status === 404) {
      sbVideoCache.set(slug, { _status: 404, _msg: 'Video tidak ditemukan' }, 60 * 1000);
      return apiError(res, 404, 'Video tidak ditemukan');
    }
    sbVideoCache.set(slug, { _error: true }, 20 * 1000);
    apiError(res, 502, 'Gagal memuat video');
  }
});

/* ── Self-healing reresolve (xvideos token jika bermasalah) ── */
async function reresolveXvUrl(slug, targetUrl) {
  const cached = sbFreshCache.get(slug);
  if (cached) {
    // Coba cocokkan filename
    const targetName = basenameNoQuery(targetUrl);
    const freshName  = basenameNoQuery(cached.m3u8Url);
    if (freshName === targetName) return cached.m3u8Url;
    // Kalau tidak cocok (segment dalam sub-manifest), return fresh master
    return cached.m3u8Url;
  }

  const result = await freshResolveM3u8(slug).catch(() => null);
  if (!result) return null;
  sbFreshCache.set(slug, result);
  sbM3u8Cache.set(slug, result.m3u8Url);
  return result.m3u8Url;
}

/* ── SB: HLS manifest proxy ── */
router.get('/proxy/sb/hls/:slug(*)', async (req, res) => {
  const slug = req.params.slug;
  if (!slug || slug.length > 300) return apiError(res, 400, 'Invalid slug');

  try {
    let m3u8Url = sbM3u8Cache.get(slug) || null;

    let manifestResp = null;
    if (m3u8Url) {
      manifestResp = await axSegGet(m3u8Url, {
        headers: { 'User-Agent': UA, 'Referer': XV_BASE + '/', 'Accept-Encoding': 'gzip, deflate' },
        timeout: 15000,
      }).catch(() => null);
    }

    if (!manifestResp || manifestResp.status < 200 || manifestResp.status >= 300) {
      const result = await freshResolveM3u8(slug).catch(() => null);
      if (!result) return apiError(res, 404, 'Stream tidak ditemukan');
      m3u8Url = result.m3u8Url;
      sbM3u8Cache.set(slug, m3u8Url);
      sbFreshCache.set(slug, result);
      manifestResp = await axSegGet(m3u8Url, {
        headers: { 'User-Agent': UA, 'Referer': XV_BASE + '/', 'Accept-Encoding': 'gzip, deflate' },
        timeout: 15000,
      });
    }

    if (manifestResp.status < 200 || manifestResp.status >= 300) {
      return apiError(res, 502, 'CDN menolak manifest stream');
    }

    const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
    const rewritten = rewriteM3u8(String(manifestResp.data), baseUrl, slug);

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(rewritten);
  } catch (err) {
    console.error('sb hls proxy error:', err.message);
    apiError(res, 502, 'Gagal memuat manifest stream');
  }
});

/* ── SB: HLS segment proxy ── */
router.get('/proxy/sb/seg', async (req, res) => {
  const raw = req.query.url;
  const slugHint = req.query._s || null;
  if (!raw || !isAllowedSbCdnUrl(raw)) return res.status(400).end();
  await handleSbSeg(raw, slugHint, req, res, false);
});

async function handleSbSeg(raw, slugHint, req, res, isRetry) {
  try {
    const upstream = await axSegGet(raw, {
      headers: { 'User-Agent': UA, 'Referer': XV_BASE + '/' },
      responseType: 'stream',
      timeout: 20000,
    });

    const ct = (upstream.headers['content-type'] || '').toLowerCase();

    if (upstream.status < 200 || upstream.status >= 300) {
      upstream.data.destroy();
      if (!isRetry && slugHint && [401, 403, 500, 502, 503].includes(upstream.status)) {
        const fresh = await reresolveXvUrl(slugHint, raw).catch(() => null);
        if (fresh && fresh !== raw && isAllowedSbCdnUrl(fresh)) return handleSbSeg(fresh, slugHint, req, res, true);
      }
      return res.status(upstream.status < 500 ? 404 : 502).end();
    }

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

    res.status(upstream.status);
    ['content-type', 'content-length', 'cache-control'].forEach(h => {
      if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    req.on('close', () => upstream.data.destroy());
    upstream.data.on('error', err => {
      if (!res.headersSent) res.status(502).end();
    });
    stream.pipeline(upstream.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error('sb seg pipeline:', err.message);
    });
  } catch (err) {
    console.error('sb seg proxy error:', err.message);
    if (!res.headersSent) res.status(502).end();
  }
}

/* ── SB: Thumbnail proxy ── */
/* ── SB: SPA routes ── */
const path = require('path');
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
router.get('/sb',   (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'sb.html')));
router.get('/sb/*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'sb.html')));

router.get('/proxy/sb/thumb', async (req, res) => {
  const raw = req.query.url;
  if (!raw || !isAllowedSbThumb(raw)) return res.status(400).end();

  try {
    const upstream = await axSegGet(raw, {
      headers: { 'User-Agent': UA, 'Referer': `${SB_BASE}/`, 'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8' },
      responseType: 'stream',
      timeout: 10000,
    });

    if (upstream.status < 200 || upstream.status >= 300) {
      upstream.data.destroy();
      return res.status(404).end();
    }

    res.status(upstream.status);
    ['content-type', 'content-length', 'cache-control'].forEach(h => {
      if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
    });
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    req.on('close', () => upstream.data.destroy());
    stream.pipeline(upstream.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error('sb thumb pipeline:', err.message);
    });
  } catch (err) {
    console.error('sb thumb proxy error:', err.message);
    if (!res.headersSent) res.status(502).end();
  }
});
