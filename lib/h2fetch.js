/* ═══════════════════════════════════════════════════════════════════════
   lib/h2fetch.js — HTTP/2 fetch helper (anti Cloudflare TLS-fingerprint 403)

   2026-11: yobokep.com (dan beberapa upstream lain) memblokir request
   HTTP/1.1 dari Node.js lewat match JA3/fingerprint — axios (http1.1)
   selalu dapat 403 "Attention Required", sementara browser asli (HTTP/2)
   lolos. Solusi: modul bawaan node:http2, tanpa dependensi baru
   (penting: image deploy Koyeb tetap node:20-slim).

   Catatan desain (hasil pengujian nyata 2026-11-02):
   - Session TIDAK di-pool. Cloudflare memutus/menolak stream pada koneksi
     h2 yang di-multiplex (24 request paralel pada 1 session → hanya 4
     yang berhasil). Satu session baru per request → 24/24 berhasil.
   - Tetap perlu concurrency limiter per-origin (4) supaya beban paralel
     (mis. fetch 24 og:image sekaligus) tidak memicu rate-limit WAF.
   - gzip/deflate/br didekompresi otomatis; redirect diikuti otomatis.

   API (mirip axios, supaya patch scraper minim):
     await h2Get(url, { headers, timeout, maxRedirects }) → { status, headers, data }
     await h2Post(url, body, { headers, timeout })        → { status, headers, data }
     h2GetStream(url, { headers, timeout })               → { status, headers, stream }
       (untuk proxy segment/thumbnail — tanpa dekompresi, pipe langsung)
   data = string hasil dekompresi.
═══════════════════════════════════════════════════════════════════════ */

'use strict';

const http2 = require('http2');
const zlib  = require('zlib');

/* Browser-like default headers — Cloudflare membandingkan konsistensi
   UA ↔ HTTP/2 pseudo-headers; tanpa ini beberapa situs tetap challenge. */
const H2_DEFAULT_HEADERS = {
  'accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9,id;q=0.8',
  'accept-encoding': 'gzip, deflate, br',
};

/* ── Per-origin concurrency limiter ────────────────────────────────
   WAF upstream menoleransi hanya beberapa request h2 bersamaan per IP;
   request kelebihan diantrekan di sini (diuji: tanpa limiter, banjir
   request memicu RST/403 massal). ── */
const MAX_CONCURRENT_PER_ORIGIN = 4;
const originQueues = new Map(); // origin → { active, queue: [{fn, resolve, reject}] }

function pumpQueue(origin) {
  const q = originQueues.get(origin);
  if (!q) return;
  while (q.active < MAX_CONCURRENT_PER_ORIGIN && q.queue.length > 0) {
    const item = q.queue.shift();
    q.active++;
    item.fn()
      .then(item.resolve, item.reject)
      .finally(() => {
        q.active--;
        pumpQueue(origin);
        if (q.active === 0 && q.queue.length === 0) originQueues.delete(origin);
      });
  }
}

function scheduleWithLimit(origin, fn) {
  return new Promise((resolve, reject) => {
    let q = originQueues.get(origin);
    if (!q) { q = { active: 0, queue: [] }; originQueues.set(origin, q); }
    q.queue.push({ fn, resolve, reject });
    pumpQueue(origin);
  });
}

/* HTTP/2 mewajibkan nama header lower-case — caller scraper memakai gaya
   axios ('User-Agent'), jadi normalisasi di sini. */
function lowerKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k.toLowerCase()] = v;
  return out;
}

function decompressBody(buf, encoding) {
  const enc = (encoding || '').toLowerCase();
  try {
    if (enc.includes('br'))      return zlib.brotliDecompressSync(buf);
    if (enc.includes('gzip'))    return zlib.gunzipSync(buf);
    if (enc.includes('deflate')) return zlib.inflateSync(buf);
  } catch {
    /* fallback: kembalikan raw — beberapa server salah set header */
  }
  return buf;
}

function cleanRespHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h || {})) {
    if (!k.startsWith(':')) out[k] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  return out;
}

/* ── Core: satu session baru per request, ditutup setelah selesai ── */
function h2Exchange(method, urlStr, { headers = {}, body = null, timeout = 20000 }) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(new Error(`h2fetch: URL tidak valid: ${urlStr}`)); }
    if (u.protocol !== 'https:') return reject(new Error('h2fetch: hanya https:'));

    const session = http2.connect(u.origin);
    let settled = false;

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      try { session.close(); } catch {}
      fn();
    };

    session.on('error', (e) => finish(() => reject(e)));

    const reqHeaders = {
      ':method': method,
      ':path':    u.pathname + u.search,
      ...H2_DEFAULT_HEADERS,
      ...lowerKeys(headers),
    };
    if (body !== null && !reqHeaders['content-length']) {
      reqHeaders['content-length'] = Buffer.byteLength(body);
    }

    const req = session.request(reqHeaders);
    const chunks = [];
    let respHeaders = null;

    const timer = setTimeout(() => {
      finish(() => reject(new Error(`h2fetch: timeout ${timeout}ms — ${urlStr}`)));
    }, timeout);

    req.on('response', (h) => { respHeaders = h; });
    req.on('data', (c) => chunks.push(c));
    req.on('error', (e) => finish(() => reject(e)));
    req.on('end', () => {
      clearTimeout(timer);
      finish(() => resolve({
        status:  respHeaders?.[':status'] || 0,
        headers: cleanRespHeaders(respHeaders),
        data:    decompressBody(Buffer.concat(chunks), respHeaders?.['content-encoding']),
      }));
    });

    if (body !== null) req.write(body);
    req.end();
  });
}

/* ── Request dengan redirect-follow + concurrency limit ── */
async function h2Request(method, urlStr, opts = {}, redirects = 0) {
  const { maxRedirects = 5, ...rest } = opts;
  const r = await scheduleWithLimit(new URL(urlStr).origin, () => h2Exchange(method, urlStr, rest));

  const loc = r.headers['location'];
  if (loc && [301, 302, 303, 307, 308].includes(r.status) && redirects < maxRedirects) {
    const next = new URL(loc, urlStr).href;
    const nextMethod = (r.status === 303 || (r.status === 301 && method === 'POST')) ? 'GET' : method;
    return h2Request(nextMethod, next, { ...opts, body: nextMethod === 'GET' ? null : rest.body }, redirects + 1);
  }
  return r;
}

/* ── Public API ── */
async function h2Get(url, opts = {}) {
  const r = await h2Request('GET', url, opts);
  return { status: r.status, headers: r.headers, data: r.data.toString('utf8') };
}

async function h2Post(url, body, opts = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  const r = await h2Request('POST', url, { ...opts, body: payload });
  return { status: r.status, headers: r.headers, data: r.data.toString('utf8') };
}

/* Streaming variant untuk proxy segment/thumbnail.
   Tidak melakukan dekompresi maupun redirect-follow otomatis
   (caller sudah meng-handle retry/self-heal sendiri).
   PENTING: stream ini milik session-nya sendiri; caller wajib
   meng-consume / destroy stream — session ditutup otomatis saat
   stream end/close/error. */
function h2GetStream(urlStr, opts = {}) {
  const { headers = {}, timeout = 20000 } = opts;
  return scheduleWithLimit(new URL(urlStr).origin, () => new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(new Error(`h2fetch: URL tidak valid: ${urlStr}`)); }
    if (u.protocol !== 'https:') return reject(new Error('h2fetch: hanya https:'));

    const session = http2.connect(u.origin);
    let settled = false;

    const req = session.request({
      ':method': 'GET',
      ':path':    u.pathname + u.search,
      ...H2_DEFAULT_HEADERS,
      ...lowerKeys(headers),
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { session.destroy(); } catch {}
      reject(new Error(`h2fetch stream: timeout ${timeout}ms — ${urlStr}`));
    }, timeout);

    req.on('response', (h) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stream = req;
      // Tutup session saat stream selesai/diputus — hindari socket bocor
      stream.on('end',     () => { try { session.close(); }  catch {} });
      stream.on('close',   () => { try { session.close(); }  catch {} });
      stream.on('error',   () => { try { session.destroy(); } catch {} });
      resolve({ status: h[':status'] || 0, headers: cleanRespHeaders(h), stream });
    });
    req.on('error', (e) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      try { session.destroy(); } catch {}
      reject(e);
    });
    session.on('error', () => { /* stream error handler yang menangani */ });
    req.end();
  }));
}

module.exports = { h2Get, h2Post, h2GetStream, h2Request };
