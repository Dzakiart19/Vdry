---
name: Platform 5 TP Architecture
description: tik.porn (Vidorey TikTok) — scraping, proxy, and client architecture decisions for P5.
---

## Core approach
- Scrape `__NEXT_DATA__` dari halaman tik.porn (cheerio `$('#__NEXT_DATA__').text()`)
- **Homepage listing (home mode):** `/?page=N` → `pageProps.initialRelatedVideos.data[]` (10 video/page); `pageProps.videos.pagination.hasMore` untuk deteksi halaman berikutnya. JANGAN pakai `pageProps.videos.data[]` untuk listing — itu hanya 1 featured video per page. `/new`, `/popular`, `/trending` semua 404.
- Search → `.props.pageProps.initialVideoResults.data[]` (bukan `.videos`)
- Video detail → `.props.pageProps.firstVideo`; HLS URL di `firstVideo.sources[].type === 'application/x-mpegURL'`
- Cache key home: `posts:home:{page}` (include page number — setiap page kontennya berbeda)

## CDN allowlist
- Video: `video-cdn.tik.porn` (exact + subdomain)
- Thumbnail: `image-cdn.tik.porn` (exact + subdomain)
- Token TTL ~1 tahun → cache 24 jam aman, tidak perlu self-healing

## Proxy URL encoding
- Semua segment dan sub-manifest URL di-encode pakai **base64url** (bukan encodeURIComponent)
- Server: `Buffer.from(str).toString('base64url')` / `Buffer.from(str, 'base64url').toString('utf8')`
- Client: `btoa(utf8bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')`

**Why:** base64url lebih robust untuk URL param (tidak ada `+`, `/`, `=` yang perlu double-encode), dan Node.js built-in support tanpa dependency.

## Redirect security (axTpGetSafe)
- `axTpGetSafe(url, config, maxHops=3)` — validate setiap redirect Location header terhadap CDN allowlist
- Segment proxy (`/proxy/tp/seg`) menggunakan `maxRedirects: 0` langsung (stream responseType tidak kompatibel dengan axTpGetSafe)
- HLS manifest proxy pakai `axTpGetSafe`

**Why:** Axios `maxRedirects: 5` tanpa re-validasi bisa bypass allowlist jika CDN redirect ke domain lain. Code reviewer (architect) flagged ini sebagai serious issue.

## Cache keys (tpVideoCache)
- `video:{id}` → payload objek (fields: id, title, caption, poster, thumbnails, hlsUrl, dll)
- `hls:{id}` → raw CDN URL string (dipakai /proxy/tp/hls/:id)
- Keduanya di cache yang sama (`tpVideoCache`); tidak ada konflik karena prefix berbeda

## TikTok UI
- Tidak ada modal — `tp-feed` adalah full-height vertical scroll-snap container (CSS: `scroll-snap-type: y mandatory`)
- `body.tp-page` + `position: fixed` untuk feed agar cover seluruh viewport
- IntersectionObserver threshold: 0.75 untuk play/pause, 0.5 untuk infinite scroll trigger
- Topbar burger ID: `tpNavBurger` (bukan `navBurger` — karena topbar custom, bukan `.topbar`)
- Nav drawer IDs tetap sama: `navDrawer`, `navOverlay`, `navClose`

## CSP additions
- `https://pl26548697.profitableratecpm.com` dan `https://pl26548687.profitableratecpm.com` ditambah ke `scriptSrc` di server.js

## Caption template tags
- tik.porn kadang mengirim caption dengan placeholder seperti `@{{action:26}}`, `@{{pornstar:4775}}`, `@{{studio:189}}`
- Hanya `#{{tag:\d+}}` yang di-strip (`stripTagPlaceholders`); `@{{...}}` dibiarkan (bisa di-strip ke depan jika diinginkan)

## Nav drawer pattern untuk platform baru
- Tambah `<hr class="nav-section-divider">` + `<div class="nav-drawer-label">Fitur Lain</div>` sebelum item baru
- Update SEMUA 5 HTML (index, rb, yb, bk, tp) — jangan lupa satu pun
