/* ═══════════════════════════════════════════════════════════════════════
   PLATFORM 2 — ruangbokep.ws (RB)
   Post listing (WordPress scrape) → putarvid embed → PackerJS decode →
   HLS proxy dengan self-healing token (autoscale IP drift).
   Terisolasi penuh dari P1/P3 — tidak share cache atau state apa pun.
═══════════════════════════════════════════════════════════════════════ */

const express = require('express');
const cheerio = require('cheerio');
const axios   = require('axios');
const https   = require('https');
const stream  = require('stream');
const path    = require('path');

const { makeCache } = require('../cache');
const { UA, apiError, axNoRedirect, resolveUrl, basenameNoQuery } = require('../proxy');
const { logCdnAlert } = require('../monitor');
const { registerSlug } = require('../shortlink');

const router = express.Router();

const RB_BASE = 'https://ruangbokep.ws';
const rbHeaders = {
  'User-Agent':      UA,
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate',   // NO brotli — axios tidak support br decompression reliably
  'Referer':         `${RB_BASE}/`,
  'Cache-Control':   'no-cache',
};

/* ── Dedicated instance untuk ruangbokep.ws — keepAlive:false mencegah
   ECONNRESET ("aborted") saat WordPress menutup keep-alive socket.
   family:4 forces IPv4 — di autoscale, dual-stack egress bisa membuat
   putarvid's IP-detection embed alamat garbled ke token CDN. ── */
const axRb = axios.create({
  timeout:      25000,
  maxRedirects: 5,
  httpsAgent:   new https.Agent({ keepAlive: false, family: 4 }),
});

// Retry wrapper: catches transient network errors (ECONNRESET, ETIMEDOUT, aborted)
// dan retry sampai `retries` kali dengan exponential back-off.
async function axRbGet(url, config = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await axRb.get(url, config);
    } catch (err) {
      lastErr = err;
      // Don't retry on 4xx HTTP errors — those won't change
      if (err.response?.status >= 400 && err.response?.status < 500) throw err;
      if (i < retries) await new Promise(r => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ── RB: Categories ── */
router.get('/api/rb/categories', async (_req, res) => {
  try {
    const { data } = await axRbGet(
      `${RB_BASE}/wp-json/wp/v2/categories?per_page=100&_fields=id,name,slug,count&orderby=count&order=desc`,
      { headers: { ...rbHeaders, Accept: 'application/json' } }
    );
    res.json(data.filter(c => c.slug !== 'uncategorized' && c.count > 0));
  } catch (err) {
    console.error('rb categories error:', err.message);
    apiError(res, 502, 'Gagal memuat kategori');
  }
});

/* ── Cache posts listing (TTL 3 menit, max 200 entries) ────────────────
   Key: "page:cat:q" — mencegah scrape berulang saat navigasi antar halaman.
   Empty result di-cache 30 detik, error di-cache 20 detik — mencegah
   upstream di-pukul terus-menerus saat halaman memang kosong/error.
──────────────────────────────────────────────────────────────────────── */
const postsCache = makeCache(200, 3 * 60 * 1000, 'p2_posts'); // key → result
function postsCacheKey(page, cat, q) { return `${page}:${cat || ''}:${q || ''}`; }
function postsCacheGet(key) { return postsCache.get(key); }
function postsCacheSet(key, data, ttlMs = 3 * 60 * 1000) { postsCache.set(key, data, ttlMs); }

/* ── RB: Post listing (homepage / kategori / search) ── */
router.get('/api/rb/posts', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.p) || 1);
  const cat  = (req.query.cat || '').replace(/[^a-z0-9-]/gi, '');
  const q    = (req.query.q  || '').trim().substring(0, 150);

  // ── Cache check — kembalikan langsung jika masih fresh ──
  const cacheKey = postsCacheKey(page, cat, q);
  const cached = postsCacheGet(cacheKey);
  if (cached) {
    // Periksa sentinel sebelum serve — jangan bocorkan internal state ke client
    if (cached._error)  return apiError(res, 502, 'Gagal memuat konten');
    if (cached._status === 404) return apiError(res, 404, 'Halaman tidak ditemukan');
    res.setHeader('X-Cache', 'HIT');
    return res.json(cached);
  }

  try {
    let url;
    if (q) {
      // Search — WordPress /?s= format
      const enc = encodeURIComponent(q);
      url = page > 1 ? `${RB_BASE}/page/${page}/?s=${enc}` : `${RB_BASE}/?s=${enc}`;
    } else if (cat) {
      url = page > 1 ? `${RB_BASE}/${cat}/page/${page}/` : `${RB_BASE}/${cat}/`;
    } else {
      url = page > 1 ? `${RB_BASE}/page/${page}/` : `${RB_BASE}/`;
    }

    const { data: html } = await axRbGet(url, { headers: rbHeaders });
    const $ = cheerio.load(html);

    const posts = [];
    $('article.loop-video').each((_, el) => {
      const $el   = $(el);
      const thumb = $el.attr('data-main-thumb')
                 || $el.find('img.video-main-thumb').attr('data-lazy-src')
                 || $el.find('img.video-main-thumb').attr('src')
                 || '';
      const href  = $el.find('a[href*="ruangbokep.ws"]').first().attr('href')
                 || $el.find('a').first().attr('href')
                 || '';
      const title = $el.find('img.video-main-thumb').attr('alt')
                 || $el.find('.entry-title, h2, h3').first().text().trim()
                 || '';
      const m = href.match(/ruangbokep\.ws\/([^/]+)\/?$/);
      const slug = m ? m[1] : '';
      if (slug && title) posts.push({ slug, title, thumb });
    });

    // Detect total pages — site uses .pagination ul li a structure
    // "Last" button href contains the actual total page count
    let totalPages = 1;
    $('.pagination ul li a').each((_, el) => {
      if ($(el).text().trim() === 'Last') {
        const m = ($(el).attr('href') || '').match(/\/page\/(\d+)\//);
        if (m) { totalPages = parseInt(m[1]); return false; }
      }
    });
    // Fallback: use max numbered page button
    if (totalPages === 1) {
      $('.pagination ul li a').each((_, el) => {
        const n = parseInt($(el).text().trim());
        if (n && !isNaN(n) && n > totalPages) totalPages = n;
      });
    }

    const result = { posts, page, totalPages, category: cat || null };

    if (posts.length > 0) {
      // Cache normal — 3 menit
      postsCacheSet(cacheKey, result);
    } else {
      // Bedakan: halaman genuinely kosong vs selector rusak.
      // Selector rusak = upstream punya <article> tapi kita tidak bisa parse.
      const articleCount = $('article').length;
      if (articleCount > 0) {
        console.warn(`[scraper-alert] rb/posts key="${cacheKey}": ${articleCount} <article> ditemukan tapi 0 posts di-parse — selector mungkin berubah`);
      }
      // Cache singkat 30 detik — throttle upstream untuk halaman kosong/rusak
      postsCacheSet(cacheKey, result, 30 * 1000);
    }

    res.setHeader('X-Cache', 'MISS');
    res.json(result);
  } catch (err) {
    console.error('rb posts error:', err.message);
    if (err.response?.status === 404) {
      // Cache dengan _status sentinel — cache check akan return 404 yang benar
      postsCacheSet(cacheKey, { _status: 404 }, 30 * 1000);
      return apiError(res, 404, 'Halaman tidak ditemukan');
    }
    // Untuk error 502/network: cache error singkat 20 detik
    postsCacheSet(cacheKey, { _error: true }, 20 * 1000);
    apiError(res, 502, 'Gagal memuat konten');
  }
});

/* ── RB CDN allowlist untuk HLS proxy ── */
// Ekstensi path yang diizinkan: HLS segments, manifest, encryption key, init segment
const RB_CDN_ALLOWED_EXT = new Set(['.ts', '.m3u8', '.m3u', '.aac', '.mp4', '.m4s', '.key', '.init']);

function isAllowedRbCdnUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    // Validasi host: hanya domain CDN yang diketahui dipakai oleh putarvid/streamruby
    const hostOk = (
      u.hostname === 'putarvid.com'         ||
      u.hostname.endsWith('.putarvid.com')  ||
      u.hostname.endsWith('.streamruby.net') ||  // putarvid stream CDN
      u.hostname.endsWith('.b-cdn.net')     ||
      u.hostname.endsWith('.bunnycdn.com')
    );
    // Validasi path: hanya izinkan ekstensi HLS yang valid agar proxy tidak bisa
    // dipakai untuk fetch konten arbitrer dari CDN-CDN broad ini.
    const ext = u.pathname.substring(u.pathname.lastIndexOf('.')).toLowerCase();
    const extOk = RB_CDN_ALLOWED_EXT.has(ext) || u.pathname.endsWith('.m3u8');
    const ok = hostOk && extOk;
    if (!hostOk) logCdnAlert(`[cdn-alert] P2 CDN domain baru terdeteksi: "${u.hostname}" — tambahkan ke isAllowedRbCdnUrl jika legit`);
    if (hostOk && !extOk) logCdnAlert(`[cdn-alert] P2 path ekstensi tidak dikenal: "${u.pathname}" dari "${u.hostname}"`);
    return ok;
  } catch { return false; }
}

/* ── Rewrite semua URL dalam m3u8 manifest → /proxy/rb/seg?url=... ──
   `slug` (opsional) disisipkan sebagai &_s= supaya /proxy/rb/seg bisa
   re-resolve token baru jika CDN menolak (lihat reresolveUrl()) — perlu
   karena autoscale bisa route tiap request ke instance berbeda dengan
   IP keluar berbeda, sementara token CDN dikunci ke IP peminta. ── */
function rewriteM3u8(content, baseUrl, slug) {
  const suffix = slug ? `&_s=${encodeURIComponent(slug)}` : '';
  return content.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      // Rewrite URI= attribute di dalam tag (e.g. #EXT-X-KEY:URI="...")
      return line.replace(/URI="([^"]+)"/g, (_, uri) => {
        const abs = resolveUrl(uri, baseUrl);
        return `URI="/proxy/rb/seg?url=${encodeURIComponent(abs)}${suffix}"`;
      });
    }
    // Baris URL (segment atau sub-manifest)
    const abs = resolveUrl(trimmed, baseUrl);
    return `/proxy/rb/seg?url=${encodeURIComponent(abs)}${suffix}`;
  }).join('\n');
}

/* ── Axios instance tanpa redirect untuk segment proxy ──
   family:4 forces IPv4 — sama alasan seperti axRb di atas: mencegah
   putarvid/streamruby salah mendeteksi IP requester lewat jalur IPv6. ── */
const axSegment = axios.create({
  timeout: 20000, maxRedirects: 5, validateStatus: s => s < 500,
  httpsAgent: new https.Agent({ family: 4 }),
});

// Retry wrapper untuk manifest/segment CDN — CDN streamruby/putarvid kadang
// ECONNRESET/timeout sesaat di bawah traffic produksi. Jangan retry status HTTP
// (403/404/dll sudah valid dari CDN, tidak akan berubah dengan retry).
async function axSegmentGet(url, config = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await axSegment.get(url, config);
    } catch (err) {
      lastErr = err;
      if (err.response) throw err; // status HTTP nyata dari CDN — jangan retry
      if (i < retries) await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ── Cache m3u8 yang sudah di-resolve (TTL 5 menit, max 500 entries) ── */
const m3u8Cache = makeCache(500, 5 * 60 * 1000, 'p2_m3u8'); // slug → m3u8Url
// Shim agar kode lama yang pakai m3u8CacheSet/m3u8Cache.get tetap bekerja
function m3u8CacheSet(slug, url) { m3u8Cache.set(slug, url); }

/* ── Cache respons video lengkap (TTL 30 menit, max 300 entries) ──────────
   Menyimpan seluruh payload /api/rb/video/:slug (tanpa token — token selalu
   di-generate fresh dari registerSlug).  Dua keuntungan utama:
   1. Respons cache-hit kembali dalam <1 ms → history.replaceState ke 11-char
      token selalu terjadi sebelum client timeout 15 s.
   2. Mengurangi beban ke ruangbokep.ws / putarvid.com.
   Error di-cache singkat (20–60 detik) agar upstream tidak di-pukul terus.
────────────────────────────────────────────────────────────────────────── */
const rbVideoCache = makeCache(300, 30 * 60 * 1000, 'p2_video'); // slug → response

/* ── Safe PackerJS decoder — ONLY string replacements, no code execution ── */
function unpackPacker(html) {
  // Anchor ke `}(` — brace penutup function body IIFE packer, supaya tidak
  // salah match `(` yang ada di dalam konten packed itu sendiri.
  // Support single- atau double-quoted string (beberapa versi putarvid beda).
  const re = /\}\s*\((['"])([\s\S]*?)\1,\s*(\d+),\s*(\d+),\s*(['"])([\s\S]*?)\5\.split\(['"]\|['"]\)\)/;
  const m = html.match(re);
  if (!m) return null;
  let p = m[2];           // packed string (captured in group 2)
  const a = parseInt(m[3]);
  let c = parseInt(m[4]);
  const k = m[6].split('|'); // keyword list (captured in group 6)
  while (c--) {
    if (k[c]) p = p.replace(new RegExp('\\b' + c.toString(a) + '\\b', 'g'), k[c]);
  }
  return p;
}

/* ── Resolve putarvid embed → raw m3u8 URL (strips ads completely) ── */
async function resolveRbVideoUrl(embedUrl) {
  try {
    const parsed = new URL(embedUrl);
    // Strict allowlist — only putarvid.com and its own subdomains
    if (parsed.hostname !== 'putarvid.com' && !parsed.hostname.endsWith('.putarvid.com')) return null;
    if (parsed.protocol !== 'https:') return null;
  } catch { return null; }

  try {
    const { data: html } = await axRbGet(embedUrl, {
      headers: {
        'User-Agent':      UA,
        'Referer':         `${RB_BASE}/`,
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
      },
      timeout: 18000,
    });
    const decoded = unpackPacker(html);
    if (!decoded) return null;
    // Support single- dan double-quote (beberapa versi putarvid berbeda)
    const m = decoded.match(/file:["'](https?:\/\/[^"']+\.m3u8[^"']*)/);
    return m ? m[1] : null;
  } catch (err) {
    console.error('resolveRbVideoUrl:', err.message);
    return null;
  }
}

/* ── Ambil embed URL putarvid dari halaman post ruangbokep.ws ──
   Halaman post juga merender widget "Related videos" di bawah player
   dengan markup persis sama (`article.loop-video[data-main-thumb]`)
   seperti listing homepage — aman di-scrape dengan selector yang sama
   karena wrapper artikel utama halaman ini TIDAK punya class loop-video. ── */
async function fetchRbEmbedUrl(slug) {
  const { data: html } = await axRbGet(`${RB_BASE}/${slug}/`, { headers: rbHeaders });
  const $ = cheerio.load(html);
  const title = $('h1.entry-title, h2.entry-title, .entry-title, h1').first().text().trim() || slug;
  const thumb = $('meta[property="og:image"]').attr('content') || '';
  const description = $('meta[property="og:description"]').attr('content')
                    || $('meta[name="description"]').attr('content')
                    || '';
  const embedUrl = $('meta[itemprop="embedURL"]').attr('content')
                || $('IFRAME[SRC*="putarvid"]').first().attr('SRC')
                || $('iframe[src*="putarvid"]').first().attr('src')
                || '';

  // Scope ketat ke widget "Related videos" (.under-video-block yang mengikuti
  // heading "Related videos") — bukan seluruh dokumen. Ini mencegah selector
  // article.loop-video "bocor" mengambil kartu video dari widget lain (mis.
  // "populer minggu ini" di sidebar) kalau markup situs berubah nanti.
  let $relatedScope = $('.under-video-block').filter((_, el) =>
    $(el).find('.widget-title').text().trim().toLowerCase().includes('related video')
  );
  if (!$relatedScope.length) $relatedScope = $('h2.widget-title:contains("Related videos")').parent();

  const related = [];
  const seenSlugs = new Set([slug]);
  $relatedScope.find('article.loop-video').each((_, el) => {
    const $el = $(el);
    const rThumb = $el.attr('data-main-thumb')
                || $el.find('img.video-main-thumb').attr('data-lazy-src')
                || $el.find('img.video-main-thumb').attr('src')
                || '';
    const rHref  = $el.find('a[href*="ruangbokep.ws"]').first().attr('href')
                || $el.find('a').first().attr('href')
                || '';
    const rTitle = $el.find('img.video-main-thumb').attr('alt')
                || $el.find('.entry-title, h2, h3').first().text().trim()
                || '';
    const rDuration = $el.find('.duration').text().replace(/^\D+/, '').trim();
    const m = rHref.match(/ruangbokep\.ws\/([^/]+)\/?$/);
    const rSlug = m ? m[1] : '';
    if (rSlug && rTitle && !seenSlugs.has(rSlug)) {
      seenSlugs.add(rSlug);
      related.push({ slug: rSlug, title: rTitle, thumb: rThumb, duration: rDuration });
    }
  });

  return { embedUrl, title, thumb, description, related };
}

/* ── Resolve slug → master m3u8 URL yang FRESH (selalu request baru, tidak
   pakai cache). Dipanggil dari instance yang SEDANG menangani request ini,
   supaya token CDN yang dihasilkan cocok dengan IP keluar instance
   tersebut. Dipakai untuk self-healing saat CDN menolak token lama
   (kemungkinan besar di-generate oleh instance lain di autoscale). ── */
async function freshResolveMaster(slug) {
  const { embedUrl } = await fetchRbEmbedUrl(slug);
  if (!embedUrl) return null;
  const resolved = await resolveRbVideoUrl(embedUrl);
  if (!resolved || !isAllowedRbCdnUrl(resolved)) return null;
  return resolved;
}

/* ── RB: Single video — resolve to clean m3u8, no ads ── */
router.get('/api/rb/video/:slug', async (req, res) => {
  const slug = req.params.slug;
  if (!/^[a-z0-9-]+$/i.test(slug)) return apiError(res, 400, 'Invalid slug');

  // ── Cache check — kembalikan langsung jika masih fresh ──
  const vidCached = rbVideoCache.get(slug);
  if (vidCached) {
    if (vidCached._error)          return apiError(res, 502, 'Gagal memuat video');
    if (vidCached._status === 404) return apiError(res, 404, vidCached._msg || 'Video tidak ditemukan');
    res.setHeader('X-Cache', 'HIT');
    // Token selalu di-generate fresh (registerSlug idempoten dalam 48 jam TTL)
    return res.json({ ...vidCached, token: registerSlug('rb', slug) });
  }

  try {
    const { embedUrl, title, thumb, description, related } = await fetchRbEmbedUrl(slug);

    if (!embedUrl) {
      rbVideoCache.set(slug, { _status: 404, _msg: 'Player tidak ditemukan' }, 60 * 1000);
      return apiError(res, 404, 'Player tidak ditemukan');
    }

    // ── m3u8Cache fast-path: jika URL CDN sudah di-cache dari request sebelumnya,
    //    skip fetch putarvid.com (hemat 1 network round-trip). ──
    let m3u8Url = m3u8Cache.get(slug) || null;
    if (!m3u8Url || !isAllowedRbCdnUrl(m3u8Url)) {
      // Decode putarvid packed JS → extract raw m3u8 (removes ALL ads)
      m3u8Url = await resolveRbVideoUrl(embedUrl);
    }

    if (m3u8Url && isAllowedRbCdnUrl(m3u8Url)) {
      // Cache URL yang sudah di-resolve (dipakai oleh /proxy/rb/hls/:slug)
      m3u8CacheSet(slug, m3u8Url);
      const payload = { slug, title, thumb, description, related, m3u8Url: `/proxy/rb/hls/${slug}` };
      rbVideoCache.set(slug, payload);
      // Return proxy URL — browser tidak pernah akses CDN langsung
      return res.json({ ...payload, token: registerSlug('rb', slug) });
    }

    // Fallback: return embed URL only if it's a trusted putarvid domain
    let safeEmbedUrl = null;
    try {
      const u = new URL(embedUrl);
      if (u.protocol === 'https:' && (u.hostname === 'putarvid.com' || u.hostname.endsWith('.putarvid.com'))) {
        safeEmbedUrl = embedUrl;
      }
    } catch { /* invalid URL — drop it */ }
    if (safeEmbedUrl) {
      const payload = { slug, title, thumb, description, related, embedUrl: safeEmbedUrl };
      rbVideoCache.set(slug, payload);
      return res.json({ ...payload, token: registerSlug('rb', slug) });
    }

    rbVideoCache.set(slug, { _status: 404, _msg: 'Sumber video tidak dapat diakses' }, 60 * 1000);
    apiError(res, 404, 'Sumber video tidak dapat diakses');
  } catch (err) {
    console.error('rb video error:', err.message);
    if (err.response?.status === 404) {
      rbVideoCache.set(slug, { _status: 404, _msg: 'Video tidak ditemukan' }, 60 * 1000);
      return apiError(res, 404, 'Video tidak ditemukan');
    }
    rbVideoCache.set(slug, { _error: true }, 20 * 1000);
    apiError(res, 502, 'Gagal memuat video');
  }
});

/* ── Self-healing token refresh ────────────────────────────────────────
   Autoscale bisa route request berbeda ke instance berbeda dengan IP
   keluar berbeda, sementara token CDN putarvid/streamruby dikunci ke IP
   yang melakukan resolve. Kalau CDN menolak (403/401/5xx), kita re-resolve
   master m3u8 FRESH dari instance yang SEDANG menangani request ini, lalu
   cari ulang URL segment/sub-manifest yang sepadan (dicocokkan by filename)
   supaya tokennya cocok dengan IP instance saat ini.
   `freshSessionCache` menyimpan hasil resolve+fetch sesaat (TTL pendek)
   supaya banyak segment yang gagal berurutan cukup memicu SATU re-resolve. */
const freshSessionCache = makeCache(100, 20 * 1000, 'p2_freshSession'); // slug → { masterUrl, masterContent, subs }

async function getFreshSession(slug, forceNew = false) {
  if (!forceNew) {
    const cached = freshSessionCache.get(slug);
    if (cached) return cached;
  }
  const masterUrl = await freshResolveMaster(slug);
  if (!masterUrl) return null;
  const session = { masterUrl, masterContent: null, subs: new Map() };
  freshSessionCache.set(slug, session);
  m3u8CacheSet(slug, masterUrl); // sinkronkan cache display juga
  return session;
}

/* Telusuri master → sub-playlist untuk menemukan URL yang baru di-tokenize
   untuk file yang sama (dicocokkan lewat nama file, bukan query token). */
async function reresolveUrl(slug, targetUrl, forceNewSession = false) {
  const session = await getFreshSession(slug, forceNewSession);
  if (!session) return null;
  const targetName = basenameNoQuery(targetUrl);

  if (!session.masterContent) {
    const resp = await axSegmentGet(session.masterUrl, {
      headers: { 'User-Agent': UA, 'Referer': 'https://putarvid.com/', 'Origin': 'https://putarvid.com', 'Accept-Encoding': 'gzip, deflate' },
      timeout: 15000,
    });
    if (resp.status < 200 || resp.status >= 300) return null;
    session.masterContent = String(resp.data);
  }

  const masterBase = session.masterUrl.substring(0, session.masterUrl.lastIndexOf('/') + 1);
  const masterUrls = session.masterContent.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => resolveUrl(l, masterBase));

  // Level 1: target adalah sub-manifest itu sendiri
  const directMatch = masterUrls.find(u => basenameNoQuery(u) === targetName);
  if (directMatch) return directMatch;

  // Level 2: target adalah segment di dalam salah satu sub-playlist
  for (const subUrl of masterUrls) {
    const subKey = basenameNoQuery(subUrl);
    let subContent = session.subs.get(subKey);
    if (!subContent) {
      try {
        const subResp = await axSegmentGet(subUrl, {
          headers: { 'User-Agent': UA, 'Referer': 'https://putarvid.com/', 'Origin': 'https://putarvid.com' },
          timeout: 15000,
        });
        if (subResp.status < 200 || subResp.status >= 300) continue;
        subContent = String(subResp.data);
        session.subs.set(subKey, subContent);
      } catch { continue; }
    }
    const subBase = subUrl.substring(0, subUrl.lastIndexOf('/') + 1);
    const match = subContent.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => resolveUrl(l, subBase))
      .find(u => basenameNoQuery(u) === targetName);
    if (match) return match;
  }
  return null;
}

/* ── RB: HLS manifest proxy — browser tidak pernah akses CDN langsung ── */
router.get('/proxy/rb/hls/:slug', async (req, res) => {
  const slug = req.params.slug;
  if (!/^[a-z0-9-]+$/i.test(slug)) return apiError(res, 400, 'Invalid slug');

  try {
    let m3u8Url = m3u8Cache.get(slug) || null;

    let manifestResp = null;
    if (m3u8Url) {
      manifestResp = await axSegmentGet(m3u8Url, {
        headers: { 'User-Agent': UA, 'Referer': 'https://putarvid.com/', 'Origin': 'https://putarvid.com', 'Accept-Encoding': 'gzip, deflate' },
        timeout: 15000,
      }).catch(() => null);
    }

    // Cache miss ATAU CDN menolak (kemungkinan token dari instance lain di
    // autoscale) — selalu re-resolve fresh dari instance ini sebelum menyerah.
    if (!manifestResp || manifestResp.status < 200 || manifestResp.status >= 300) {
      m3u8Url = await freshResolveMaster(slug);
      if (!m3u8Url) return apiError(res, 404, 'Stream tidak ditemukan');
      m3u8CacheSet(slug, m3u8Url);
      freshSessionCache.del(slug); // paksa session baru dipakai reresolveUrl juga
      manifestResp = await axSegmentGet(m3u8Url, {
        headers: { 'User-Agent': UA, 'Referer': 'https://putarvid.com/', 'Origin': 'https://putarvid.com', 'Accept-Encoding': 'gzip, deflate' },
        timeout: 15000,
      });
    }

    if (manifestResp.status < 200 || manifestResp.status >= 300) {
      console.error('hls proxy: CDN reject status', manifestResp.status, 'slug', slug);
      return apiError(res, 502, 'CDN menolak manifest stream');
    }
    const manifest = manifestResp.data;

    const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
    const rewritten = rewriteM3u8(String(manifest), baseUrl, slug);

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(rewritten);
  } catch (err) {
    console.error('hls proxy error:', err.message);
    apiError(res, 502, 'Gagal memuat manifest stream');
  }
});

/* ── RB: HLS segment / sub-manifest proxy ──
   `_s` (slug) opsional dipakai untuk self-healing: kalau CDN menolak token
   (403/401/5xx), re-resolve fresh dari instance ini & retry sekali. ── */
router.get('/proxy/rb/seg', async (req, res) => {
  const raw = req.query.url;
  const slugHint = /^[a-z0-9-]+$/i.test(req.query._s || '') ? req.query._s : null;
  if (!raw || !isAllowedRbCdnUrl(raw)) return res.status(400).end();

  await handleRbSeg(raw, slugHint, req, res, false);
});

async function handleRbSeg(raw, slugHint, req, res, isRetry) {
  try {
    const upstream = await axSegmentGet(raw, {
      headers: { 'User-Agent': UA, 'Referer': 'https://putarvid.com/', 'Origin': 'https://putarvid.com' },
      responseType: 'stream',
      timeout: 20000,
    });

    const ct = (upstream.headers['content-type'] || '').toLowerCase();

    // Reject non-2xx from CDN early — coba self-heal sekali sebelum menyerah
    if (upstream.status < 200 || upstream.status >= 300) {
      console.error('seg proxy: CDN reject status', upstream.status, 'isRetry', isRetry);
      upstream.data.destroy();
      if (!isRetry && slugHint && [401, 403, 500, 502, 503].includes(upstream.status)) {
        const fresh = await reresolveUrl(slugHint, raw, true).catch(() => null);
        if (fresh && fresh !== raw && isAllowedRbCdnUrl(fresh)) return handleRbSeg(fresh, slugHint, req, res, true);
      }
      return res.status(upstream.status < 500 ? 404 : 502).end();
    }

    // Sub-manifest (variant playlist) — rewrite URL-nya juga
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

    // Segment binary (TS / AAC / key)
    res.status(upstream.status);
    const forward = ['content-type', 'content-length', 'cache-control'];
    forward.forEach(h => { if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]); });
    res.setHeader('Access-Control-Allow-Origin', '*');

    req.on('close', () => upstream.data.destroy());
    upstream.data.on('error', err => {
      console.error('seg stream error:', err.message);
      if (!res.headersSent) res.status(502).end();
    });
    stream.pipeline(upstream.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error('seg pipeline:', err.message);
    });
  } catch (err) {
    console.error('seg proxy error:', err.message);
    if (!res.headersSent) res.status(502).end();
  }
}

/* ── RB: Thumbnail proxy ── */
router.get('/proxy/rb/thumb', async (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).end();

  let parsed;
  try { parsed = new URL(raw); } catch { return res.status(400).end(); }
  // WordPress sering serve thumbnail dari i0/i1/i2.wp.com (Jetpack CDN)
  const allowed = ['ruangbokep.ws', 'img.streamruby.com', 'i0.wp.com', 'i1.wp.com', 'i2.wp.com'];
  if (!allowed.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) {
    return res.status(400).end();
  }

  try {
    const up = await axNoRedirect.get(raw, {
      headers: { 'User-Agent': UA, 'Referer': `${RB_BASE}/` },
      responseType: 'stream',
    });
    const ct = up.headers['content-type'] || '';
    if (!ct.startsWith('image/')) { up.data.destroy(); return res.status(415).end(); }
    res.setHeader('content-type', ct);
    res.setHeader('cache-control', 'public, max-age=86400');
    req.on('close', () => up.data.destroy());
    up.data.on('error', err => {
      console.error('rb thumb stream error:', err.message);
      if (!res.headersSent) res.status(502).end();
    });
    stream.pipeline(up.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error('rb thumb pipeline error:', err.message);
      }
    });
  } catch (err) {
    console.error('rb thumb proxy error:', err.message);
    if (!res.headersSent) res.status(502).end();
  }
});

/* ── RB: SPA routes ── */
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
router.get('/rb', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'rb.html')));
router.get('/rb/*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'rb.html')));

module.exports = { router, caches: [m3u8Cache, postsCache, freshSessionCache, rbVideoCache] };
