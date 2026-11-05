const axios = require('axios');

/* ── User-Agent & error helper dipakai semua platform ── */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

function apiError(res, status, msg) {
  res.status(status).json({ error: msg });
}

/* ── Axios generik (tanpa agent/family khusus) ── */
const ax = axios.create({
  timeout:      20000,
  maxRedirects: 5,
});

// No redirects — dipakai proxy thumbnail yang butuh validasi allowlist manual
const axNoRedirect = axios.create({
  timeout:        15000,
  maxRedirects:   0,
  validateStatus: s => s < 400,
});

/* ── Resolve relative URL terhadap base — dipakai rewrite m3u8 P2 & P3 ── */
function resolveUrl(url, base) {
  try { return new URL(url, base).href; } catch { return url; }
}

/* ── Nama file dari URL tanpa query string — dipakai self-healing P2 & P3
   untuk mencocokkan segment/sub-manifest by filename, bukan by token CDN ── */
function basenameNoQuery(u) {
  try { return new URL(u).pathname.split('/').pop(); } catch { return String(u).split('/').pop(); }
}

module.exports = { UA, apiError, ax, axNoRedirect, resolveUrl, basenameNoQuery };
