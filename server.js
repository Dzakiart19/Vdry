const express = require('express');
const axios   = require('axios');
const cheerio = require('cheerio');
const stream  = require('stream');
const path    = require('path');

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

app.use(express.static(path.join(__dirname, 'public')));

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
   SPA FALLBACK
═══════════════════════════════════════ */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
