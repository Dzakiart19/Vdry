/* ═══════════════════════════════════════════════════════════════════════
   PLATFORM 8 — xchina.tube (XN)
   Angular SPA → POST REST API → AES-CBC decrypt → HLS proxy.
   Chain: POST api_server/sevenVideos/{vId} → decrypt("xxx") →
          {m3u8s: ["https://tm.helloye.com/TOKEN,TS/ID/index.m3u8"]}
          → proxy via /proxy/xn/hls/:vId
   Token TTL ~1.5h — self-healing on 403.
   Terisolasi penuh dari platform lain — tidak share cache atau state apapun.
═══════════════════════════════════════════════════════════════════════ */

const express = require('express');
const axios   = require('axios');
const crypto  = require('crypto');
const https   = require('https');
const path    = require('path');

const { makeCache }                = require('../cache');
const { UA, apiError, resolveUrl } = require('../proxy');
const { logCdnAlert }              = require('../monitor');
const { registerSlug }             = require('../shortlink');

const router     = express.Router();
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

/* ── API server list (from xchina.tube httpNames in bundle) ── */
const XN_SERVERS = [
  'https://v2.tianmtv.com',
  'https://v2.madou.ws',
  'https://v2.luchu.org',
  'https://v2.papapa.biz',
  'https://v2.randoms.site',
  'https://v2.kekecdn.net',
  'https://v2.xiaoshuo.info',
  'https://v2.xiaoshuo.la',
];

/* ── AES-CBC decrypt (CryptoJS OpenSSL format, MD5 KDF, key="xxx") ──
   xchina.tube mengenkripsi semua response dengan AES dan key "xxx".
   Ini bukan keamanan yang kuat — key-nya ada di bundle JS publik mereka. ── */
function xnDecrypt(encBase64) {
  const pad    = encBase64.length % 4;
  const padded = pad ? encBase64 + '='.repeat(4 - pad) : encBase64;
  const ct     = Buffer.from(padded, 'base64');
  if (ct.subarray(0, 8).toString('ascii') !== 'Salted__') throw new Error('Invalid ciphertext header');

  const salt  = ct.subarray(8, 16);
  const data  = ct.subarray(16);
  const passB = Buffer.from('xxx');

  // CryptoJS default: MD5-based KDF to derive key(32) + iv(16)
  let dk = Buffer.alloc(0), di = Buffer.alloc(0);
  while (dk.length < 48) {
    di = crypto.createHash('md5').update(Buffer.concat([di, passB, salt])).digest();
    dk = Buffer.concat([dk, di]);
  }
  const key = dk.subarray(0, 32);
  const iv  = dk.subarray(32, 48);

  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/* ── Dedicated axios instances ── */
const axXn = axios.create({
  timeout:      14000,
  maxRedirects: 3,
  httpsAgent:   new https.Agent({ keepAlive: false, family: 4 }),
  headers: {
    'Content-Type': 'application/json',
    'Origin':       'https://xchina.tube',
    'Referer':      'https://xchina.tube/',
    'User-Agent':   UA,
  },
});

const axSeg = axios.create({
  timeout: 20000, maxRedirects: 3, validateStatus: s => s < 500,
  httpsAgent: new https.Agent({ family: 4 }),
});

/* ── POST ke API server dengan AES decrypt, fallback ke server lain ── */
async function apiPost(urlPath, body = {}) {
  let lastErr;
  for (const server of XN_SERVERS) {
    try {
      const { data } = await axXn.post(`${server}${urlPath}`, body, { timeout: 12000 });
      if (!data || !data.r) throw new Error('Empty or unencrypted response');
      return JSON.parse(xnDecrypt(data.r));
    } catch (err) {
      lastErr = err;
      // HTTP 4xx dari server → error definitif, jangan coba server lain
      if (err.response?.status >= 400 && err.response?.status < 500) throw err;
      // Timeout / network error → coba server berikutnya
    }
  }
  throw lastErr;
}

/* ── CDN allowlist ── */
const XN_CDN_EXTS = new Set(['.ts', '.m3u8', '.m3u', '.key', '.aac', '.mp4', '.m4s']);

function isAllowedXnCdnUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    const hostOk = u.hostname === 'tm.helloye.com' || u.hostname.endsWith('.helloye.com');
    const extRaw = u.pathname.substring(u.pathname.lastIndexOf('.')).toLowerCase().split('?')[0];
    const extOk  = XN_CDN_EXTS.has(extRaw) || u.pathname.includes('.m3u8') || u.pathname.includes('.ts');
    if (!hostOk) logCdnAlert(`[cdn-alert] P8 CDN domain baru terdeteksi: "${u.hostname}" — tambahkan ke isAllowedXnCdnUrl jika legit`);
    return hostOk && extOk;
  } catch { return false; }
}

function isAllowedXnThumb(raw) {
  try {
    const u = new URL(raw);
    return u.hostname === 'tp.helloye.com' || u.hostname.endsWith('.helloye.com');
  } catch { return false; }
}

/* ── Caches ── */
// p8_posts: 3 menit (konten baru muncul tiap jam)
// p8_m3u8 : 60 menit (token CDN TTL ~1.5 jam, cache lebih pendek agar tidak expired)
// p8_video: 2 jam (metadata video stabil)
// p8_fresh: 90 detik (dedup self-healing re-resolve)
const xnPostsCache = makeCache(300, 3 * 60 * 1000,      'p8_posts');
const xnM3u8Cache  = makeCache(500, 60 * 60 * 1000,     'p8_m3u8');
const xnVideoCache = makeCache(500, 2 * 60 * 60 * 1000, 'p8_video');
const xnFreshCache = makeCache(200, 90 * 1000,           'p8_fresh');

module.exports = { router, caches: [xnPostsCache, xnM3u8Cache, xnVideoCache, xnFreshCache] };

/* ── Normalise video object dari API (listing vs single berbeda sedikit) ── */
function normVideo(v) {
  const thumb = ((v.thumbNails || v.thumbnails || [])[0]) || '';
  return {
    vId:      v.vId || v.id || '',
    title:    v.title_en || v.title || '',
    thumb:    thumb && isAllowedXnThumb(thumb) ? thumb : '',
    duration: v.durationStr || '',
    vip:      !!v.vip,
  };
}

/* ── Rewrite m3u8 manifest → proxy /proxy/xn/seg ── */
function rewriteM3u8(content, baseUrl, vId) {
  const suffix = vId ? `&_v=${encodeURIComponent(vId)}` : '';
  return content.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_, uri) => {
        const abs = resolveUrl(uri, baseUrl);
        return `URI="/proxy/xn/seg?url=${encodeURIComponent(abs)}${suffix}"`;
      });
    }
    const abs = resolveUrl(trimmed, baseUrl);
    return `/proxy/xn/seg?url=${encodeURIComponent(abs)}${suffix}`;
  }).join('\n');
}

/* ════════════════════════════════════════════════════════════════════
   API ROUTES
════════════════════════════════════════════════════════════════════ */

/* ── XN: Posts listing + search ── */
router.get('/api/xn/posts', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.p) || 1);
  const q    = (req.query.q || '').trim().substring(0, 150);

  const cacheKey = `${page}:${q}`;
  const cached   = xnPostsCache.get(cacheKey);
  if (cached) {
    if (cached._error)          return apiError(res, 502, 'Gagal memuat konten');
    if (cached._status === 404) return apiError(res, 404, 'Halaman tidak ditemukan');
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached);
  }

  try {
    let raw;
    if (q) {
      raw = await apiPost('/searchSevenVideos', { keyword: q, page });
    } else {
      raw = await apiPost(`/sevenVideos?page=${page}`);
    }

    const posts = (Array.isArray(raw) ? raw : [])
      .map(v => { const n = normVideo(v); return { slug: n.vId, title: n.title, thumb: n.thumb }; })
      .filter(p => p.slug && p.title);

    // Tidak ada totalPages dari API — estimasi dari jumlah hasil
    const hasMore    = posts.length >= 24;
    const totalPages = hasMore ? Math.max(999, page + 10) : page;

    const result = { posts, page, totalPages };

    xnPostsCache.set(cacheKey, result, posts.length > 0 ? undefined : 30 * 1000);
    res.setHeader('X-Cache', 'MISS');
    res.json(result);
  } catch (err) {
    console.error('xn posts error:', err.message);
    xnPostsCache.set(cacheKey, { _error: true }, 20 * 1000);
    apiError(res, 502, 'Gagal memuat konten');
  }
});

/* ── XN: Single video ── */
router.get('/api/xn/video/:vId', async (req, res) => {
  const vId = req.params.vId;
  if (!vId || !/^[a-zA-Z0-9_-]{3,20}$/.test(vId)) return apiError(res, 400, 'Invalid video ID');

  const vidCached = xnVideoCache.get(vId);
  if (vidCached) {
    if (vidCached._error)          return apiError(res, 502, 'Gagal memuat video');
    if (vidCached._status === 404) return apiError(res, 404, vidCached._msg || 'Video tidak ditemukan');
    res.setHeader('X-Cache', 'HIT');
    return res.json({ ...vidCached, token: registerSlug('xn', vId) });
  }

  try {
    const raw      = await apiPost(`/sevenVideos/${vId}`);
    const m3u8List = raw.m3u8s || [];

    if (!m3u8List.length) {
      xnVideoCache.set(vId, { _status: 404, _msg: 'Stream tidak tersedia (VIP?)' }, 60 * 1000);
      return apiError(res, 404, 'Stream tidak tersedia');
    }

    const m3u8Url = m3u8List[0];
    if (!isAllowedXnCdnUrl(m3u8Url)) {
      logCdnAlert(`[cdn-alert] P8 m3u8 URL tidak diizinkan: "${new URL(m3u8Url).hostname}"`);
      xnVideoCache.set(vId, { _status: 404, _msg: 'Stream tidak dapat diakses' }, 60 * 1000);
      return apiError(res, 404, 'Stream tidak dapat diakses');
    }

    // Fetch related videos (non-blocking, error diabaikan)
    let related = [];
    try {
      const relRaw = await apiPost(`/relatedSevenVideos?v=${vId}`);
      related = (Array.isArray(relRaw) ? relRaw : [])
        .map(v => { const n = normVideo(v); return { slug: n.vId, title: n.title, thumb: n.thumb }; })
        .filter(p => p.slug && p.title);
    } catch { /* related optional */ }

    const thumb = ((raw.thumbNails || raw.thumbnails || [])[0]) || '';
    const payload = {
      slug:        vId,
      title:       raw.title_en || raw.title || vId,
      thumb:       thumb && isAllowedXnThumb(thumb) ? thumb : '',
      description: raw.tags_en || raw.tags || '',
      related,
      m3u8Url:     `/proxy/xn/hls/${encodeURIComponent(vId)}`,
    };

    xnM3u8Cache.set(vId, m3u8Url);
    xnVideoCache.set(vId, payload);
    return res.json({ ...payload, token: registerSlug('xn', vId) });

  } catch (err) {
    console.error('xn video error:', err.message);
    if (err.response?.status === 404) {
      xnVideoCache.set(vId, { _status: 404, _msg: 'Video tidak ditemukan' }, 60 * 1000);
      return apiError(res, 404, 'Video tidak ditemukan');
    }
    xnVideoCache.set(vId, { _error: true }, 20 * 1000);
    apiError(res, 502, 'Gagal memuat video');
  }
});

/* ════════════════════════════════════════════════════════════════════
   PROXY ROUTES
════════════════════════════════════════════════════════════════════ */

/* ── Self-healing: re-fetch fresh m3u8 dari API ── */
async function reresolveXnM3u8(vId) {
  // Cek fresh cache dulu untuk dedup (jangan re-resolve berkali-kali dalam 90 detik)
  const cached = xnFreshCache.get(vId);
  if (cached) return cached;

  try {
    const raw      = await apiPost(`/sevenVideos/${vId}`);
    const m3u8List = raw.m3u8s || [];
    if (!m3u8List.length) return null;
    const m3u8Url = m3u8List[0];
    if (!isAllowedXnCdnUrl(m3u8Url)) return null;

    xnFreshCache.set(vId, m3u8Url);
    xnM3u8Cache.set(vId, m3u8Url);
    xnVideoCache.del(vId); // evict agar /api/xn/video return payload baru
    return m3u8Url;
  } catch { return null; }
}

/* ── XN: HLS manifest proxy ── */
router.get('/proxy/xn/hls/:vId', async (req, res) => {
  const vId = req.params.vId;
  if (!vId || !/^[a-zA-Z0-9_-]{3,20}$/.test(vId)) return apiError(res, 400, 'Invalid video ID');

  let m3u8Url = xnM3u8Cache.get(vId);
  if (!m3u8Url) {
    m3u8Url = await reresolveXnM3u8(vId);
    if (!m3u8Url) return apiError(res, 503, 'Stream tidak dapat dimuat');
  }
  if (!isAllowedXnCdnUrl(m3u8Url)) return apiError(res, 400, 'Forbidden CDN');

  const hlsHeaders = { 'User-Agent': UA, 'Referer': 'https://xchina.tube/', 'Origin': 'https://xchina.tube' };

  async function fetchAndSend(url) {
    const { data: content } = await axXn.get(url, {
      headers: hlsHeaders, responseType: 'text', timeout: 15000,
    });
    const baseUrl   = url.substring(0, url.lastIndexOf('/') + 1);
    const rewritten = rewriteM3u8(content, baseUrl, vId);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(rewritten);
  }

  try {
    await fetchAndSend(m3u8Url);
  } catch (err) {
    // 403 → token expired → self-heal sekali
    if ((err.response?.status === 403 || err.response?.status === 401) && !res.headersSent) {
      xnM3u8Cache.del(vId);
      xnFreshCache.del(vId);
      const fresh = await reresolveXnM3u8(vId);
      if (fresh) {
        try { return await fetchAndSend(fresh); } catch {}
      }
    }
    if (!res.headersSent) {
      console.error('xn hls proxy error:', err.message);
      apiError(res, 502, 'Gagal memuat stream');
    }
  }
});

/* ── XN: Segment proxy ── */
router.get('/proxy/xn/seg', async (req, res) => {
  const raw = req.query.url;
  const vId = req.query._v || null;
  if (!raw) return apiError(res, 400, 'Missing url');

  let target;
  try { target = decodeURIComponent(raw); } catch { return apiError(res, 400, 'Invalid url'); }
  if (!isAllowedXnCdnUrl(target)) return apiError(res, 403, 'Forbidden');

  const segHeaders = { 'User-Agent': UA, 'Referer': 'https://xchina.tube/', 'Origin': 'https://xchina.tube' };

  async function fetchSeg(url) {
    return axSeg.get(url, { headers: segHeaders, responseType: 'stream', timeout: 20000 });
  }

  function sendStream(status, headers, data) {
    res.status(status);
    const ct = headers['content-type'];
    if (ct) res.setHeader('Content-Type', ct);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    data.pipe(res);
  }

  try {
    let { status, headers: upH, data } = await fetchSeg(target);

    // Self-heal 403: rebuild segment URL dari fresh m3u8 token
    if ((status === 403 || status === 401) && vId) {
      xnM3u8Cache.del(vId);
      xnFreshCache.del(vId);
      const freshM3u8 = await reresolveXnM3u8(vId).catch(() => null);
      if (freshM3u8) {
        // Segment filename sama, token berubah di path prefix
        const segFile   = target.split('/').pop();
        const freshBase = freshM3u8.substring(0, freshM3u8.lastIndexOf('/') + 1);
        const freshSeg  = freshBase + segFile;
        if (isAllowedXnCdnUrl(freshSeg)) {
          const retry = await fetchSeg(freshSeg).catch(() => null);
          if (retry && retry.status < 400) {
            return sendStream(retry.status, retry.headers, retry.data);
          }
        }
      }
    }

    sendStream(status, upH, data);
  } catch (err) {
    if (!res.headersSent) apiError(res, 502, 'Gagal memuat segment');
  }
});

/* ── XN: Thumbnail proxy ── */
router.get('/proxy/xn/thumb', async (req, res) => {
  const raw = req.query.url;
  if (!raw) return apiError(res, 400, 'Missing url');
  let target;
  try { target = decodeURIComponent(raw); } catch { return apiError(res, 400, 'Invalid url'); }
  if (!isAllowedXnThumb(target)) return apiError(res, 403, 'Forbidden');

  try {
    const { status, headers: upH, data } = await axSeg.get(target, {
      headers: { 'User-Agent': UA, 'Referer': 'https://xchina.tube/' },
      responseType: 'stream', timeout: 12000,
    });
    res.status(status);
    res.setHeader('Content-Type', upH['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    data.pipe(res);
  } catch (err) {
    if (!res.headersSent) apiError(res, 502, 'Gagal memuat thumbnail');
  }
});

/* ── SPA routes — WAJIB, tanpa ini /xn jatuh ke index.html (Platform 1) ── */
router.get('/xn',   (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'xn.html')));
router.get('/xn/*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'xn.html')));
