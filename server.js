const express = require('express');
const axios   = require('axios');
const cheerio = require('cheerio');
const stream  = require('stream');
const path    = require('path');
const cors    = require('cors');

const app  = express();
const PORT = 5000;
const BASE = 'https://xpvid.cc';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

const baseHeaders = {
  'User-Agent':      UA,
  'Accept-Language': 'en-US,en;q=0.9',
};

/* ── Strict allowlists ── */
const THUMB_HOSTS  = new Set(['i.xpvid.cc']);
const STREAM_HOSTS = new Set(['vidoycdn.b-cdn.net']);

/* ── Axios instances ── */
const ax = axios.create({
  timeout:      20000,
  maxRedirects: 5,
});

// No redirects for thumb proxy — we validate manually
const axNoRedirect = axios.create({
  timeout:      15000,
  maxRedirects: 0,
  validateStatus: s => s < 400,
});

/* ── Sanitized error helper ── */
function apiError(res, status, msg) {
  res.status(status).json({ error: msg });
}

/* ── URL allowlist validator ── */
function allowedThumbUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && THUMB_HOSTS.has(u.hostname);
  } catch { return false; }
}

function allowedStreamUrl(raw) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && STREAM_HOSTS.has(u.hostname);
  } catch { return false; }
}

/* ── CORS — izinkan Firebase Hosting & dev ── */
app.use(cors({
  origin(origin, cb) {
    // Izinkan: tanpa origin (curl/Postman), localhost, *.replit.dev, *.web.app, *.firebaseapp.com
    if (!origin) return cb(null, true);
    const ok = [
      /^http:\/\/localhost/,
      /\.replit\.dev$/,
      /\.replit\.app$/,
      /\.web\.app$/,
      /\.firebaseapp\.com$/,
    ].some(r => r.test(origin));
    cb(ok ? null : new Error('CORS: origin tidak diizinkan'), ok);
  },
  methods: ['GET', 'HEAD'],
  allowedHeaders: ['Range', 'Content-Type'],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type'],
  credentials: false,
}));

app.use(express.static(path.join(__dirname, 'public')));

/* ── Health check (untuk cronjob / uptime monitor) ── */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

/* ═══════════════════════════════════════
   FOLDER API
═══════════════════════════════════════ */
app.get('/api/folder/:id', async (req, res) => {
  const id   = req.params.id;
  const page = Math.max(1, parseInt(req.query.p) || 1);

  // Validate ID format (alphanumeric only)
  if (!/^[a-z0-9]+$/i.test(id)) return apiError(res, 400, 'Invalid folder ID');

  try {
    const { data } = await ax.get(`${BASE}/f/${id}?p=${page}`, {
      headers: { ...baseHeaders, 'Referer': `${BASE}/` },
    });

    const $ = cheerio.load(data);

    const title = $('.drive-title').text().trim()
               || $('title').text().replace(/📂/g, '').trim()
               || id;

    const parentId = (() => {
      const href = $('.back-btn').attr('href') || '';
      return href.startsWith('/f/') ? href.replace('/f/', '').split('?')[0] : null;
    })();

    const folders = [];
    $('.folder-row a').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!href.startsWith('/f/') || $(el).hasClass('back-btn')) return;
      const fid   = href.replace('/f/', '').split('?')[0];
      const label = $(el).text().trim() || fid;
      if (fid && fid !== id && /^[a-z0-9]+$/i.test(fid)) {
        folders.push({ id: fid, name: label });
      }
    });

    // Parse videos — use only .thumb-link anchors (one per card) to avoid duplicates.
    // Title comes from aria-label (most reliable), thumb from child <img>.
    const videos = [];
    const seenVids = new Set();
    $('a.thumb-link[href^="/d/"]').each((_, el) => {
      const href  = $(el).attr('href') || '';
      const vid   = href.replace('/d/', '').split('?')[0];
      if (!vid || !/^[a-z0-9]+$/i.test(vid) || seenVids.has(vid)) return;
      seenVids.add(vid);

      const name  = $(el).attr('aria-label')
                 || $(el).attr('title')
                 || vid;
      const img   = $(el).find('img').attr('src') || '';
      videos.push({ id: vid, name, thumb: img });
    });

    // Fallback: if site changes class, try all /d/ links but deduplicate
    if (videos.length === 0) {
      $('a[href^="/d/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const vid  = href.replace('/d/', '').split('?')[0];
        if (!vid || !/^[a-z0-9]+$/i.test(vid) || seenVids.has(vid)) return;
        seenVids.add(vid);
        const img  = $(el).find('img').attr('src') || '';
        const name = $(el).attr('aria-label') || $(el).attr('title') || $(el).text().trim() || vid;
        if (img || name !== vid) videos.push({ id: vid, name, thumb: img });
      });
    }

    const pages = [];
    $('.page-btn[href]').each((_, el) => {
      const m = ($(el).attr('href') || '').match(/[?&]p=(\d+)/);
      if (m) { const n = parseInt(m[1]); if (!pages.includes(n)) pages.push(n); }
    });
    const totalPages = pages.length > 0 ? Math.max(...pages) : 1;

    res.json({ id, title, parentId, folders, videos, page, totalPages });
  } catch (err) {
    console.error('folder error:', err.message);
    const status = err.response?.status;
    if (status === 404) return apiError(res, 404, 'Folder tidak ditemukan');
    apiError(res, 502, 'Gagal memuat folder dari server upstream');
  }
});

/* ═══════════════════════════════════════
   VIDEO INFO API
═══════════════════════════════════════ */
app.get('/api/video/:id', async (req, res) => {
  const id = req.params.id;
  if (!/^[a-z0-9]+$/i.test(id)) return apiError(res, 400, 'Invalid video ID');

  try {
    const { data } = await ax.get(`${BASE}/embed.php?bucket=vidoycdn&id=${id}`, {
      headers: { ...baseHeaders, 'Referer': `${BASE}/e/${id}` },
    });

    const $ = cheerio.load(data);
    const src = $('source[type="video/mp4"]').attr('src')
             || $('video source').attr('src')
             || $('video').attr('src')
             || null;

    if (!src || !allowedStreamUrl(src)) {
      return apiError(res, 404, 'Sumber video tidak ditemukan');
    }

    res.json({
      id,
      title: $('title').text().trim() || id,
      src,
      thumb: $('video').attr('poster') || '',
    });
  } catch (err) {
    console.error('video error:', err.message);
    if (err.response?.status === 404) return apiError(res, 404, 'Video tidak ditemukan');
    apiError(res, 502, 'Gagal mengambil info video');
  }
});

/* ═══════════════════════════════════════
   STREAM PROXY  (with Range support)
═══════════════════════════════════════ */
app.get('/proxy/stream/:id', async (req, res) => {
  const id = req.params.id;
  if (!/^[a-z0-9]+$/i.test(id)) return apiError(res, 400, 'Invalid ID');

  // Step 1 — resolve MP4 URL
  let mp4Url;
  try {
    const { data } = await ax.get(`${BASE}/embed.php?bucket=vidoycdn&id=${id}`, {
      headers: { ...baseHeaders, 'Referer': `${BASE}/e/${id}` },
    });
    const $ = cheerio.load(data);
    mp4Url = $('source[type="video/mp4"]').attr('src')
          || $('video source').attr('src')
          || $('video').attr('src');
  } catch (err) {
    console.error('stream resolve error:', err.message);
    return apiError(res, 502, 'Gagal resolve URL video');
  }

  if (!mp4Url || !allowedStreamUrl(mp4Url)) {
    return apiError(res, 404, 'Sumber video tidak ditemukan');
  }

  // Step 2 — proxy stream
  const reqHeaders = {
    'User-Agent': UA,
    'Referer':    `${BASE}/`,
    'Origin':     BASE,
  };
  if (req.headers.range) reqHeaders['Range'] = req.headers.range;

  try {
    const upstream = await ax.get(mp4Url, {
      headers:        reqHeaders,
      responseType:   'stream',
      validateStatus: s => s < 500,
      timeout:        30000,
    });

    res.status(upstream.status);

    const forward = [
      'content-type', 'content-length', 'content-range',
      'accept-ranges', 'cache-control', 'last-modified', 'etag',
    ];
    forward.forEach(h => {
      if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
    });

    // Proper cleanup on disconnect
    const onClose = () => {
      upstream.data.destroy();
    };
    req.on('close', onClose);
    res.on('close', onClose);

    upstream.data.on('error', err => {
      console.error('upstream stream error:', err.message);
      if (!res.headersSent) apiError(res, 502, 'Stream terputus');
      else res.end();
    });

    stream.pipeline(upstream.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error('pipeline error:', err.message);
      }
    });

  } catch (err) {
    console.error('stream error:', err.message);
    if (!res.headersSent) apiError(res, 502, 'Gagal streaming video');
  }
});

/* ═══════════════════════════════════════
   THUMBNAIL PROXY  (strict, no redirects)
═══════════════════════════════════════ */
app.get('/proxy/thumb', async (req, res) => {
  const raw = req.query.url;

  if (!raw || !allowedThumbUrl(raw)) {
    return res.status(400).end();
  }

  try {
    const upstream = await axNoRedirect.get(raw, {
      headers:      { 'User-Agent': UA, 'Referer': `${BASE}/` },
      responseType: 'stream',
    });

    const ct = upstream.headers['content-type'] || '';
    if (!ct.startsWith('image/')) {
      upstream.data.destroy();
      return res.status(415).end();
    }

    res.setHeader('content-type', ct);
    res.setHeader('cache-control', 'public, max-age=86400');

    // Cleanup on client disconnect
    const onClose = () => upstream.data.destroy();
    req.on('close', onClose);
    res.on('close', onClose);

    upstream.data.on('error', () => res.end());

    stream.pipeline(upstream.data, res, err => {
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error('thumb pipeline error:', err.message);
      }
    });

  } catch (err) {
    if (!res.headersSent) res.status(502).end();
  }
});

/* ═══════════════════════════════════════
   PLATFORM 2 — RUANGBOKEP (RB)
═══════════════════════════════════════ */

const RB_BASE = 'https://ruangbokep.ws';
const rbHeaders = {
  'User-Agent':      UA,
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         `${RB_BASE}/`,
};

/* ── RB: Categories ── */
app.get('/api/rb/categories', async (_req, res) => {
  try {
    const { data } = await ax.get(
      `${RB_BASE}/wp-json/wp/v2/categories?per_page=100&_fields=id,name,slug,count&orderby=count&order=desc`,
      { headers: { ...rbHeaders, Accept: 'application/json' } }
    );
    res.json(data.filter(c => c.slug !== 'uncategorized' && c.count > 0));
  } catch (err) {
    console.error('rb categories error:', err.message);
    apiError(res, 502, 'Gagal memuat kategori');
  }
});

/* ── RB: Post listing (with optional category) ── */
app.get('/api/rb/posts', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.p) || 1);
  const cat  = (req.query.cat || '').replace(/[^a-z0-9-]/gi, '');

  try {
    const url = cat
      ? (page > 1 ? `${RB_BASE}/${cat}/page/${page}/` : `${RB_BASE}/${cat}/`)
      : (page > 1 ? `${RB_BASE}/page/${page}/` : `${RB_BASE}/`);

    const { data: html } = await ax.get(url, { headers: rbHeaders });
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

    // Detect total pages
    const nums = [];
    $('a.page-numbers').each((_, el) => {
      const n = parseInt($(el).text().trim());
      if (n && !isNaN(n)) nums.push(n);
    });
    // Also try "Pages: X" or "X of Y" patterns
    const ofMatch = $('[class*="page"]').text().match(/of\s+(\d+)/i);
    if (ofMatch) nums.push(parseInt(ofMatch[1]));

    const totalPages = nums.length ? Math.max(...nums) : 1;

    res.json({ posts, page, totalPages, category: cat || null });
  } catch (err) {
    console.error('rb posts error:', err.message);
    if (err.response?.status === 404) return apiError(res, 404, 'Halaman tidak ditemukan');
    apiError(res, 502, 'Gagal memuat konten');
  }
});

/* ── Safe PackerJS decoder — ONLY string replacements, no code execution ── */
function unpackPacker(html) {
  const m = html.match(/\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)\)/);
  if (!m) return null;
  let p = m[1];
  const a = parseInt(m[2]);
  let c = parseInt(m[3]);
  const k = m[4].split('|');
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
    const { data: html } = await ax.get(embedUrl, {
      headers: {
        'User-Agent':      UA,
        'Referer':         `${RB_BASE}/`,
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 18000,
    });
    const decoded = unpackPacker(html);
    if (!decoded) return null;
    const m = decoded.match(/file:"(https?:\/\/[^"]+\.m3u8[^"]*)"/);
    return m ? m[1] : null;
  } catch (err) {
    console.error('resolveRbVideoUrl:', err.message);
    return null;
  }
}

/* ── RB: Single video — resolve to clean m3u8, no ads ── */
app.get('/api/rb/video/:slug', async (req, res) => {
  const slug = req.params.slug;
  if (!/^[a-z0-9-]+$/i.test(slug)) return apiError(res, 400, 'Invalid slug');

  try {
    const { data: html } = await ax.get(`${RB_BASE}/${slug}/`, { headers: rbHeaders });
    const $ = cheerio.load(html);

    const title = $('h1.entry-title, h2.entry-title, .entry-title, h1').first().text().trim() || slug;
    const thumb = $('meta[property="og:image"]').attr('content') || '';

    // Use structured-data meta as primary source (most reliable, no JS lazy-load)
    const embedUrl = $('meta[itemprop="embedURL"]').attr('content')
                  || $('IFRAME[SRC*="putarvid"]').first().attr('SRC')
                  || $('iframe[src*="putarvid"]').first().attr('src')
                  || '';

    if (!embedUrl) return apiError(res, 404, 'Player tidak ditemukan');

    // Decode putarvid packed JS → extract raw m3u8 (removes ALL ads)
    const m3u8Url = await resolveRbVideoUrl(embedUrl);
    if (m3u8Url) {
      return res.json({ slug, title, thumb, m3u8Url });
    }

    // Fallback: return embed URL (user sees ads, but video still plays)
    res.json({ slug, title, thumb, embedUrl });
  } catch (err) {
    console.error('rb video error:', err.message);
    if (err.response?.status === 404) return apiError(res, 404, 'Video tidak ditemukan');
    apiError(res, 502, 'Gagal memuat video');
  }
});

/* ── RB: Thumbnail proxy ── */
app.get('/proxy/rb/thumb', async (req, res) => {
  const raw = req.query.url;
  if (!raw) return res.status(400).end();

  let parsed;
  try { parsed = new URL(raw); } catch { return res.status(400).end(); }
  const allowed = ['ruangbokep.ws', 'img.streamruby.com'];
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
    up.data.on('error', () => !res.headersSent && res.status(502).end());
    stream.pipeline(up.data, res, () => {});
  } catch {
    if (!res.headersSent) res.status(502).end();
  }
});

/* ── RB: SPA routes ── */
app.get('/rb', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'rb.html')));
app.get('/rb/*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'rb.html')));

/* ═══════════════════════════════════════
   SPA FALLBACK
═══════════════════════════════════════ */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
