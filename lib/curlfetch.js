/* ═══════════════════════════════════════════════════════════════════════
   lib/curlfetch.js — fetch via curl subprocess (TLS fingerprint "rescue")

   2026-11: tik.porn melayani respons palsu ("Welcome to nginx!") / 403
   untuk klien HTTP/2 maupun HTTP/1.1 dari Node (fingerprint dikenali),
   tetapi fingerprint TLS curl tetap lolos. Helper ini menjalankan curl
   sebagai child process dengan execFile (array args — bebas shell
   injection) dan mengembalikan bentuk { status, headers, data } mirip
   axios supaya patch scraper minim.

   Catatan deploy: image Koyeb (node:20-slim) tidak menyertakan curl
   secara default → Dockerfile ditambah `apt-get install -y curl`.

   API:
     await curlGet(url, { headers, timeout, maxRedirects }) → { status, headers, data }
     await curlPost(url, body, { headers, timeout })        → { status, headers, data }
       data = string (dekompresi otomatis via curl --compressed)
═══════════════════════════════════════════════════════════════════════ */

'use strict';

const { execFile } = require('child_process');

/* Header yang TIDAK boleh kita set manual — curl yang urus (dianggap
   "forbidden header" oleh curl: Accept-Encoding diurus --compressed,
   Host/Content-Length diurus curl sendiri). */
const FORBIDDEN_HEADERS = new Set([
  'accept-encoding', 'host', 'content-length', 'connection',
  'transfer-encoding', 'keep-alive', 'expect',
]);

function _curlRun(url, opts, method, bodyStr) {
  const {
    headers      = {},
    timeout      = 25000,
    maxRedirects = 5,
    binary       = false,   // true → data dikembalikan sebagai Buffer (byte-perfect, untuk gambar/biner)
  } = opts;

  return new Promise((resolve, reject) => {
    const args = [
      '-s',                       // silent
      '-i',                       // sertakan response headers di output
      '--compressed',             // auto gzip/deflate/br + set Accept-Encoding
      '--max-time', String(Math.ceil(timeout / 1000)),
      '--max-redirs', String(maxRedirects),
      '-L',                       // follow redirects
      '-w', '\n__CURL_META__%{http_code}__CURL_META__',
    ];
    if (method === 'POST') {
      args.push('-X', 'POST', '--data', bodyStr || '');
    }
    args.push(url);
    for (const [k, v] of Object.entries(headers)) {
      if (!FORBIDDEN_HEADERS.has(k.toLowerCase())) args.push('-H', `${k}: ${v}`);
    }

    /* latin1 (binary string) adalah satu-satunya encoding string yang
       memetakan byte 1:1 — body biner (gambar) tidak rusak. Untuk teks,
       utf8 dipakai langsung. Header/meta selalu ASCII sehingga aman
       dipecah dengan indexOf string pada latin1. */
    execFile('curl', args, {
      timeout: timeout + 2000,
      maxBuffer: 32 * 1024 * 1024,   // 32 MB — halaman HTML besar aman
      encoding: binary ? 'latin1' : 'utf8',
    }, (err, stdout) => {
      if (err && !stdout) return reject(err);

      /* Marker -w: "\n__CURL_META__<code>__CURL_META__" — string marker
         muncul DUA kali (sebelum & sesudah code). indexOf() yang PERTAMA
         tepat setelah body; lastIndexOf() salah karena menunjuk marker
         penutup sehingga "\n__CURL_META__200" bocor ke body. */
      const metaIdx = stdout.indexOf('__CURL_META__');
      let status = 0;
      let body = stdout;
      if (metaIdx >= 0) {
        // marker '__CURL_META__' = 13 karakter → code mulai di metaIdx + 13
        status = parseInt(stdout.slice(metaIdx + 13).trim(), 10) || 0;
        body = stdout.slice(0, metaIdx);
      }

      // Dengan -i, header HTTP pertama (dan tiap redirect hop) menempel di
      // body — buang semua blok header, ambil body setelah blank line terakhir.
      // Redirect hops menghasilkan beberapa "HTTP/1.1 30x" — cari yang TERAKHIR.
      const headerEnds = [];
      let searchFrom = 0;
      for (;;) {
        const idx = body.indexOf('\r\n\r\n', searchFrom);
        if (idx < 0) break;
        headerEnds.push(idx);
        searchFrom = idx + 4;
      }
      let respHeaders = {};
      if (headerEnds.length > 0) {
        const lastEnd = headerEnds[headerEnds.length - 1];
        const headerBlock = body.slice(0, lastEnd);
        body = body.slice(lastEnd + 4);
        // Ambil header blok TERAKHIR saja (response final setelah redirect)
        const blocks = headerBlock.split(/HTTP\/[\d.]+ \d+/);
        const finalBlock = blocks[blocks.length - 1];
        for (const line of finalBlock.split('\r\n')) {
          const ci = line.indexOf(':');
          if (ci > 0) respHeaders[line.slice(0, ci).trim().toLowerCase()] = line.slice(ci + 1).trim();
        }
      }

      if (!status) {
        // Fallback parse dari blok status terakhir
        const m = stdout.match(/HTTP\/[\d.]+\s+(\d{3})/g);
        if (m) status = parseInt(m[m.length - 1].match(/(\d{3})/)[1], 10) || 0;
      }

      if (err && !status) return reject(err);
      resolve({ status, headers: respHeaders, data: binary ? Buffer.from(body, 'latin1') : body });
    });
  });
}

function curlGet(url, opts = {}) {
  return _curlRun(url, opts, 'GET', null);
}

function curlPost(url, body, opts = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  return _curlRun(url, { ...opts, headers }, 'POST', payload);
}

module.exports = { curlGet, curlPost };
