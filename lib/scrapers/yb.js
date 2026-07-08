/* ═══════════════════════════════════════════════════════════════════════
   PLATFORM 3 — YoBokep (yobokep.com)
   WordPress + WP REST API listing · Dua embed provider:
     1. bysezejataos.com → /api/videos/{code} + AES-256-GCM decrypt → *.r66nv9ed.com HLS
     2. streamhls.to     → POST /dl?op=embed  + parse JWPlayer HTML  → *.savefiles.com HLS
   Kedua provider ditangani oleh satu fungsi resolveYbVideoUrl() — if/else domain.
   Terisolasi penuh dari P1/P2 — tidak share cache atau state apa pun.
═══════════════════════════════════════════════════════════════════════ */

const express = require('express');
const cheerio = require('cheerio');
const axios   = require('axios');
const https   = require('https');
const stream  = require('stream');
const path    = require('path');
const crypto  = require('crypto');

const { makeCache } = require('../cache');
const { UA, apiError, resolveUrl, basenameNoQuery } = require('../proxy');
const { logCdnAlert } = require('../monitor');

const router = express.Router();

const YB_BASE = 'https://yobokep.com';

/* ── Axios instance untuk semua request P3 (family:4 → hindari IPv6 garble di savefiles.com) ── */
const axYb = axios.create({
  timeout: 25000,
  maxRedirects: 5,
  httpsAgent: new https.Agent({ keepAlive: false, family: 4 }),
});

/* ── Axios instance untuk CDN proxy (stream) — family:4, validateStatus lebih longgar ── */
const axYbSeg = axios.create({
  timeout: 20000,
  maxRedirects: 5,
  validateStatus: s => s < 500,
  httpsAgent: new https.Agent({ family: 4 }),
});

/* ── Retry wrapper untuk scrape yobokep / bysezejataos ── */
async function axYbGet(url, config = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await axYb.get(url, config);
    } catch (err) {
      lastErr = err;
      // HTTP 4xx = situs menjawab dengan error definitif — jangan retry
      if (err.response?.status >= 400 && err.response?.status < 500) throw err;
      if (i < retries) await new Promise(r => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ── CDN allowlist Platform 3 ── */
const YB_CDN_ALLOWED_EXT = new Set(['.ts', '.m3u8', '.m3u', '.aac', '.mp4', '.m4s', '.key', '.init']);

function isAllowedYbCdnUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    const hostOk = (
      u.hostname.endsWith('.r66nv9ed.com')   ||  // bysezejataos CDN (SprintCDN) — p=0, not IP-locked
      u.hostname.endsWith('.owphbf24.com')   ||  // bysezejataos CDN (SprintCDN edge nodes, e.g. edge1-moscow/frankfurt)
      u.hostname.endsWith('.savefiles.com')  ||  // streamhls.to CDN — i= token, family:4 required
      u.hostname === 'savefiles.com'
    );
    const ext = u.pathname.substring(u.pathname.lastIndexOf('.')).toLowerCase();
    const extOk = YB_CDN_ALLOWED_EXT.has(ext) || u.pathname.endsWith('.m3u8');
    const ok = hostOk && extOk;
    if (!hostOk) logCdnAlert(`[cdn-alert] P3 CDN domain baru terdeteksi: "${u.hostname}" — tambahkan ke isAllowedYbCdnUrl jika legit`);
    if (hostOk && !extOk) logCdnAlert(`[cdn-alert] P3 path ekstensi tidak dikenal: "${u.pathname}" dari "${u.hostname}"`);
    return ok;
  } catch { return false; }
}

/* ── Caches Platform 3 ── */
const ybM3u8Cache         = makeCache(500,  3 * 60 * 1000,       'p3_m3u8');         // slug → m3u8Url (TTL 3 mnt)
const ybPostsCache        = makeCache(200,  3 * 60 * 1000,       'p3_posts');        // key  → result
const ybThumbCache        = makeCache(2000, 24 * 60 * 60 * 1000, 'p3_thumb');        // slug → thumbUrl (TTL 24 jam)
const ybFreshSessionCache = makeCache(100,  20 * 1000,            'p3_freshSession'); // slug → {masterUrl, masterContent, subs}
function ybPostsCacheKey(page, q) { return `${page}:${q || ''}`; }

/* ── Rewrite m3u8 manifest — proxy semua URL ke /proxy/yb/seg ── */
function rewriteYbM3u8(content, baseUrl, slug) {
  const suffix = slug ? `&_s=${encodeURIComponent(slug)}` : '';
  return content.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_, uri) => {
        const abs = resolveUrl(uri, baseUrl);
        return `URI="/proxy/yb/seg?url=${encodeURIComponent(abs)}${suffix}"`;
      });
    }
    const abs = resolveUrl(trimmed, baseUrl);
    return `/proxy/yb/seg?url=${encodeURIComponent(abs)}${suffix}`;
  }).join('\n');
}

/* ── AES-256-GCM decryptor untuk bysezejataos.com ─────────────────────
   API /api/videos/{code} mengembalikan playback terenkripsi.
   Algoritma key assembly (reverse-engineered dari videoPagesBundle JS):
     vi() map: version N → [N^0, (31-N)^0] = [N, 31-N]  (1-based indices)
     Ki(version, count) → [i, s] = vi()[version]
     key = concat(base64url_decode(key_parts[i-1]), base64url_decode(key_parts[s-1]))
   Contoh version "11": indices = [11, 20] → 0-based [10, 19] → 16+16 = 32 bytes ── */
function ybB64uDecode(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function byseKeyIndices(version) {
  const v = typeof version === 'string' ? parseInt(version.trim()) : Number(version);
  if (!v || v < 1 || v > 20) return null;
  return [v - 1, 30 - v];  // 0-based indices ke key_parts array
}

function byseDecryptPlayback(playback) {
  const { iv, payload, key_parts, version } = playback;
  if (!iv || !payload || !Array.isArray(key_parts) || key_parts.length < 30) {
    throw new Error('byse: data playback tidak lengkap');
  }
  const idx = byseKeyIndices(version);
  if (!idx) throw new Error(`byse: versi tidak dikenal "${version}"`);
  const [i1, i2] = idx;
  const keyBuf  = Buffer.concat([ybB64uDecode(key_parts[i1]), ybB64uDecode(key_parts[i2])]);
  const ivBuf   = ybB64uDecode(iv);
  const payBuf  = ybB64uDecode(payload);
  const authTag = payBuf.slice(-16);
  const cipher  = payBuf.slice(0, -16);
  const d = crypto.createDecipheriv('aes-256-gcm', keyBuf, ivBuf);
  d.setAuthTag(authTag);
  const plain = Buffer.concat([d.update(cipher), d.final()]).toString('utf8');
  return JSON.parse(plain);
}

/* ── Resolve bysezejataos.com embed code → raw m3u8 URL ── */
async function resolveByseEmbed(code) {
  const { data } = await axYbGet(`https://bysezejataos.com/api/videos/${code}`, {
    headers: {
      'User-Agent': UA,
      'Referer':    `https://bysezejataos.com/e/${code}`,
      'Accept':     'application/json',
    },
    timeout: 12000,
  });
  if (!data || !data.playback) throw new Error('byse: respons tidak mengandung playback');
  const decrypted = byseDecryptPlayback(data.playback);
  const src = decrypted?.sources?.[0]?.url;
  if (!src) throw new Error('byse: tidak ada URL sumber di payload yang terdekripsi');
  return src;
}

/* ── Resolve streamhls.to embed code → raw m3u8 URL ───────────────────
   streamhls.to = savefiles.com embed system.
   i= token dikunci ke IP peminta — axYb sudah pakai family:4
   supaya IP keluar server konsisten (IPv4, bukan garbled IPv6). ── */
async function resolveStreamhlsEmbed(code) {
  const { data: html } = await axYb.post(
    'https://streamhls.to/dl',
    `op=embed&file_code=${encodeURIComponent(code)}&auto=1&referer=https://yobokep.com/`,
    {
      headers: {
        'User-Agent':   UA,
        'Referer':      'https://yobokep.com/',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 15000,
    }
  );
  // Extract m3u8 dari JWPlayer config (sources[].file atau file: "...")
  const m = html.match(/file:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)/);
  if (!m) throw new Error('streamhls: m3u8 tidak ditemukan di respons embed');
  return m[1];
}

/* ── Ambil embed URL dari halaman post yobokep.com ─────────────────────
   Embed disimpan di data-litespeed-src (LiteSpeed defer) bukan di src.
   Fallback ke src jika LiteSpeed sudah mengisi ulang attr. ── */
async function fetchYbEmbedInfo(slug) {
  const { data: html } = await axYbGet(`${YB_BASE}/${slug}/`, {
    headers: {
      'User-Agent':      UA,
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
      'Accept-Encoding': 'gzip, deflate',
      'Referer':         `${YB_BASE}/`,
    },
  });
  const $ = cheerio.load(html);
  const title = $('h1.entry-title, h2.entry-title, .entry-title').first().text().trim()
             || $('title').text().replace(/\s*[-–|].*$/, '').trim()
             || slug;
  const thumb = $('meta[property="og:image"]').attr('content') || '';

  // Cari elemen dengan URL embed provider yang dikenal
  const isEmbedUrl = s => s && (s.includes('bysezejataos.com') || s.includes('streamhls.to'));
  const embedUrl = (() => {
    // Priority: data-litespeed-src (LiteSpeed defer)
    let url = '';
    $('[data-litespeed-src]').each((_, el) => {
      const s = $(el).attr('data-litespeed-src') || '';
      if (isEmbedUrl(s)) { url = s; return false; }
    });
    if (url) return url;
    // Fallback: src attribute (setelah LiteSpeed resolve)
    $('iframe[src]').each((_, el) => {
      const s = $(el).attr('src') || '';
      if (isEmbedUrl(s)) { url = s; return false; }
    });
    return url;
  })();

  return { embedUrl, title, thumb };
}

/* ── Dispatch ke provider yang tepat berdasarkan hostname embed URL ── */
async function resolveYbVideoUrl(embedUrl) {
  try {
    const u = new URL(embedUrl);
    if (u.protocol !== 'https:') return null;
    const codeMatch = u.pathname.match(/\/e\/([a-z0-9]+)/i);
    if (!codeMatch) return null;
    const code = codeMatch[1];

    if (u.hostname === 'bysezejataos.com') {
      return await resolveByseEmbed(code);
    }
    if (u.hostname === 'streamhls.to') {
      return await resolveStreamhlsEmbed(code);
    }
    console.warn(`[yb] embed host tidak dikenal: "${u.hostname}"`);
    return null;
  } catch (err) {
    console.error('resolveYbVideoUrl:', err.message);
    return null;
  }
}

/* ── P3 Self-healing: fresh session + reresolve (mirror pola P2) ──────────
   bysezejataos CDN: token expire (TTL) → re-resolve.
   streamhls CDN (savefiles.com): i= token dikunci ke IP → re-resolve jika IP drift.
   freshSessionCache (TTL 20 detik) mencegah flood re-resolve saat banyak segment
   gagal berurutan: hanya SATU re-fetch yang terjadi per slug per window. ── */

async function getYbFreshSession(slug, forceNew = false) {
  if (!forceNew) {
    const cached = ybFreshSessionCache.get(slug);
    if (cached) return cached;
  }
  const { embedUrl } = await fetchYbEmbedInfo(slug);
  if (!embedUrl) return null;
  const masterUrl = await resolveYbVideoUrl(embedUrl);
  if (!masterUrl || !isAllowedYbCdnUrl(masterUrl)) return null;
  ybM3u8Cache.set(slug, masterUrl);
  const session = { masterUrl, masterContent: null, subs: new Map() };
  ybFreshSessionCache.set(slug, session);
  return session;
}

/* Ambil URL baru (dengan token segar) untuk segment/sub-manifest targetUrl.
   Cocokkan berdasarkan nama file (tanpa query token) — sama dengan pola P2. */
async function reresolveYbUrl(slug, targetUrl, forceNew = false) {
  const session = await getYbFreshSession(slug, forceNew);
  if (!session) return null;

  if (!session.masterContent) {
    const referer = targetUrl.includes('savefiles.com') || targetUrl.includes('bysezejataos.com')
      ? 'https://bysezejataos.com/' : `${YB_BASE}/`;
    const r = await axYbSeg.get(session.masterUrl, {
      headers: { 'User-Agent': UA, 'Referer': referer },
      timeout: 15000,
    });
    session.masterContent = String(r.data);
  }

  const targetBase = basenameNoQuery(targetUrl);
  const masterBase = session.masterUrl.substring(0, session.masterUrl.lastIndexOf('/') + 1);

  // Cek langsung di master (untuk sub-manifest)
  for (const line of session.masterContent.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const abs = t.startsWith('http') ? t : masterBase + t;
    if (basenameNoQuery(abs) === targetBase) return abs;
  }

  // Cek di tiap sub-manifest (untuk segment TS/MP4)
  for (const line of session.masterContent.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const subUrl = t.startsWith('http') ? t : masterBase + t;
    try {
      const subKey = basenameNoQuery(subUrl);
      if (!session.subs.has(subKey)) {
        const r = await axYbSeg.get(subUrl, {
          headers: { 'User-Agent': UA, 'Referer': 'https://bysezejataos.com/' },
          timeout: 10000,
        });
        session.subs.set(subKey, String(r.data));
      }
      const subContent = session.subs.get(subKey);
      const subBase    = subUrl.substring(0, subUrl.lastIndexOf('/') + 1);
      for (const sl of subContent.split('\n')) {
        const st = sl.trim();
        if (!st || st.startsWith('#')) continue;
        const abs = st.startsWith('http') ? st : subBase + st;
        if (basenameNoQuery(abs) === targetBase) return abs;
      }
    } catch { continue; }
  }
  return null;
}

/* ── YB: Post listing ──────────────────────────────────────────────────────
   Diagnosis: yobokep.com HTML listing page selalu return 24 post yang sama
   di semua /page/N/ (server-side pagination tidak berjalan — butuh JS/AJAX).
   Solusi: WP REST API untuk slug + title + totalPages (paginasi benar),
   lalu parallel-fetch og:image dari halaman post individual untuk thumbnail
   (di-cache 24 jam di ybThumbCache agar tiap slug hanya di-fetch sekali).
   ─────────────────────────────────────────────────────────────────────── */
router.get('/api/yb/posts', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.p) || 1);
  const q    = (req.query.q || '').trim().substring(0, 150);
  const cacheKey = ybPostsCacheKey(page, q);

  const cached = ybPostsCache.get(cacheKey);
  if (cached) {
    if (cached._error)          return apiError(res, 502, 'Gagal memuat konten');
    if (cached._status === 404) return apiError(res, 404, 'Halaman tidak ditemukan');
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached);
  }

  try {
    // Step 1: WP REST API — slug + title + totalPages (pagination berjalan benar)
    const apiUrl = q
      ? `${YB_BASE}/wp-json/wp/v2/posts?per_page=24&page=${page}&_fields=slug,title&search=${encodeURIComponent(q)}`
      : `${YB_BASE}/wp-json/wp/v2/posts?per_page=24&page=${page}&_fields=slug,title`;

    const apiResp = await axYbGet(apiUrl, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
    });

    const totalPages = Math.max(1, parseInt(apiResp.headers['x-wp-totalpages'] || '1') || 1);
    const rawPosts = (apiResp.data || []).map(p => ({
      slug:  p.slug,
      title: (p.title?.rendered || p.slug)
               .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
               .replace(/<[^>]+>/g, ''),
    }));

    if (!rawPosts.length) {
      const result = { posts: [], page, totalPages };
      ybPostsCache.set(cacheKey, result, 30 * 1000);
      res.setHeader('X-Cache', 'MISS');
      return res.json(result);
    }

    // Step 2: Thumbnail — fetch og:image dari halaman post individual, parallel.
    // ybThumbCache (TTL 24 jam) memastikan tiap slug hanya di-fetch sekali.
    const uncachedSlugs = rawPosts
      .filter(p => ybThumbCache.get(p.slug) === null)
      .map(p => p.slug);

    if (uncachedSlugs.length > 0) {
      await Promise.allSettled(
        uncachedSlugs.map(slug =>
          axYbGet(`${YB_BASE}/${slug}/`, {
            headers: {
              'User-Agent': UA,
              'Accept':     'text/html',
              'Referer':    `${YB_BASE}/`,
            },
          }).then(r => {
            const html = r.data || '';
            // og:image bisa hadir dalam dua urutan atribut
            const m = html.match(/property=["']og:image["'][^>]*content=["']([^"']+)/)
                   || html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/);
            ybThumbCache.set(slug, m?.[1] || '');
          }).catch(() => {
            ybThumbCache.set(slug, ''); // cache kosong agar tidak retry terus
          })
        )
      );
    }

    // Step 3: Gabungkan — slug + title dari API, thumb dari cache
    const posts = rawPosts.map(p => ({
      slug:  p.slug,
      title: p.title,
      thumb: ybThumbCache.get(p.slug) || '',
    }));

    const result = { posts, page, totalPages };
    ybPostsCache.set(cacheKey, result);
    res.setHeader('X-Cache', 'MISS');
    res.json(result);
  } catch (err) {
    console.error('yb posts error:', err.message);
    if (err.response?.status === 400 || err.response?.status === 404) {
      ybPostsCache.set(cacheKey, { _status: 404 }, 30 * 1000);
      return apiError(res, 404, 'Halaman tidak ditemukan');
    }
    ybPostsCache.set(cacheKey, { _error: true }, 20 * 1000);
    apiError(res, 502, 'Gagal memuat konten');
  }
});

/* ── YB: Single video — resolve embed → m3u8 ── */
router.get('/api/yb/video/:slug', async (req, res) => {
  const slug = req.params.slug;
  if (!/^[a-z0-9-]+$/i.test(slug)) return apiError(res, 400, 'Invalid slug');

  try {
    const { embedUrl, title, thumb } = await fetchYbEmbedInfo(slug);
    if (!embedUrl) return apiError(res, 404, 'Player tidak ditemukan di halaman ini');

    const m3u8Url = await resolveYbVideoUrl(embedUrl);
    if (m3u8Url && isAllowedYbCdnUrl(m3u8Url)) {
      ybM3u8Cache.set(slug, m3u8Url);
      return res.json({ slug, title, thumb, m3u8Url: `/proxy/yb/hls/${slug}` });
    }

    apiError(res, 404, 'Sumber video tidak dapat diakses');
  } catch (err) {
    console.error('yb video error:', err.message);
    if (err.response?.status === 404) return apiError(res, 404, 'Video tidak ditemukan');
    apiError(res, 502, 'Gagal memuat video');
  }
});

/* ── YB: HLS manifest proxy — dengan self-healing saat token expire ── */
router.get('/proxy/yb/hls/:slug', async (req, res) => {
  const slug = req.params.slug;
  if (!/^[a-z0-9-]+$/i.test(slug)) return apiError(res, 400, 'Invalid slug');

  async function fetchManifest(url) {
    return axYbSeg.get(url, {
      headers: { 'User-Agent': UA, 'Referer': 'https://bysezejataos.com/' },
      timeout: 15000,
    });
  }

  try {
    let m3u8Url = ybM3u8Cache.get(slug);

    // Cache miss → resolve fresh via getYbFreshSession
    if (!m3u8Url) {
      const session = await getYbFreshSession(slug, true);
      if (!session) return apiError(res, 404, 'Stream tidak ditemukan');
      m3u8Url = session.masterUrl;
    }

    let manifestResp = await fetchManifest(m3u8Url);

    // CDN menolak → token expire → re-resolve sekali via getYbFreshSession
    if (manifestResp.status < 200 || manifestResp.status >= 300) {
      console.warn(`yb hls: CDN reject ${manifestResp.status} slug="${slug}", re-resolving…`);
      const session = await getYbFreshSession(slug, true);
      if (!session) return apiError(res, 502, 'CDN menolak manifest stream');
      m3u8Url = session.masterUrl;
      manifestResp = await fetchManifest(m3u8Url);
    }

    if (manifestResp.status < 200 || manifestResp.status >= 300)
      return apiError(res, 502, 'CDN menolak manifest stream');

    const base      = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
    const rewritten = rewriteYbM3u8(String(manifestResp.data), base, slug);

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(rewritten);
  } catch (err) {
    console.error('yb hls proxy error:', err.message);
    if (!res.headersSent) apiError(res, 502, 'Gagal proxy stream');
  }
});

/* ── YB: HLS segment proxy — self-healing + stream.pipeline() ── */
router.get('/proxy/yb/seg', async (req, res) => {
  const raw      = req.query.url;
  const slugHint = /^[a-z0-9-]+$/i.test(req.query._s || '') ? req.query._s : null;
  if (!raw || !isAllowedYbCdnUrl(raw)) return res.status(400).end();
  await handleYbSeg(raw, slugHint, req, res, false);
});

async function handleYbSeg(raw, slugHint, req, res, isRetry) {
  try {
    const upstream = await axYbSeg.get(raw, {
      headers: { 'User-Agent': UA, 'Referer': 'https://bysezejataos.com/' },
      responseType: 'stream',
      timeout: 20000,
    });

    const ct = (upstream.headers['content-type'] || '').toLowerCase();

    // Non-2xx dari CDN → coba self-heal sekali sebelum menyerah
    if (upstream.status < 200 || upstream.status >= 300) {
      upstream.data.destroy();
      console.error('yb seg: CDN reject', upstream.status, 'isRetry', isRetry, 'slug', slugHint);
      if (!isRetry && slugHint && [401, 403, 500, 502, 503].includes(upstream.status)) {
        const fresh = await reresolveYbUrl(slugHint, raw, true).catch(() => null);
        if (fresh && fresh !== raw && isAllowedYbCdnUrl(fresh))
          return handleYbSeg(fresh, slugHint, req, res, true);
      }
      return res.status(upstream.status < 500 ? 404 : 502).end();
    }

    // Sub-manifest → rewrite URL sebelum dikirim ke client
    if (ct.includes('mpegurl') || raw.includes('.m3u8')) {
      let body = '';
      upstream.data.on('data', chunk => { body += chunk.toString(); });
      upstream.data.on('end', () => {
        const base      = raw.substring(0, raw.lastIndexOf('/') + 1);
        const rewritten = rewriteYbM3u8(body, base, slugHint);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-store');
        res.send(rewritten);
      });
      upstream.data.on('error', () => { if (!res.headersSent) res.status(502).end(); });
      return;
    }

    // Binary segment (ts, mp4, key, dll)
    res.status(upstream.status);
    ['content-type', 'content-length', 'cache-control'].forEach(h => {
      if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    req.on('close', () => upstream.data.destroy());
    upstream.data.on('error', err => {
      console.error('yb seg stream error:', err.message);
      if (!res.headersSent) res.status(502).end();
    });
    stream.pipeline(upstream.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error('yb seg pipeline:', err.message);
    });
  } catch (err) {
    console.error('yb seg error:', err.message);
    if (!res.headersSent) res.status(502).end();
  }
}

/* ── YB: Thumbnail proxy — content-type validation + stream.pipeline() ── */
const YB_THUMB_HOSTS = new Set(['yobokep.com', 'img-place.com', 'img.savefiles.com']);
router.get('/proxy/yb/thumb', async (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).end();
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return res.status(400).end();
    const allowed = YB_THUMB_HOSTS.has(u.hostname) || u.hostname.endsWith('.yobokep.com');
    if (!allowed) return res.status(403).end();
  } catch { return res.status(400).end(); }

  try {
    const upstream = await axYbSeg.get(raw, {
      headers: { 'User-Agent': UA, 'Referer': `${YB_BASE}/` },
      responseType: 'stream',
      timeout: 10000,
    });
    const ct = upstream.headers['content-type'] || '';
    if (!ct.startsWith('image/')) {
      upstream.data.destroy();
      return res.status(415).end();
    }
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    req.on('close', () => upstream.data.destroy());
    stream.pipeline(upstream.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error('yb thumb pipeline:', err.message);
    });
  } catch (err) {
    console.error('yb thumb error:', err.message);
    if (!res.headersSent) res.status(502).end();
  }
});

/* ── YB: SPA routes ── */
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
router.get('/yb', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'yb.html')));
router.get('/yb/*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'yb.html')));

module.exports = { router, caches: [ybM3u8Cache, ybPostsCache, ybFreshSessionCache] };
