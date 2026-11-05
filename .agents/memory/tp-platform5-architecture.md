---
name: Platform 5 TP Architecture
description: tik.porn (Vidorey TikTok) — scraping, proxy, and client architecture decisions for P5.
---

## Core approach
- Scrape `__NEXT_DATA__` dari halaman tik.porn (cheerio `$('#__NEXT_DATA__').text()`)
- **Homepage listing (home mode):** Fetch `/?` SATU KALI SAJA → `pageProps.initialRelatedVideos.data[]` (10 video), `hasMore: false`. JANGAN coba pagination: `/?page=2` mengembalikan `initialRelatedVideos` yang IDENTIK dengan page 1. `/new`, `/popular`, `/trending` semua 404. Cache key: `posts:home` (tanpa page number).
- **End slide home mode:** sertakan `pageProps.relatedSearches` (featured trending terms) dalam response, tampilkan sebagai clickable chips di end slide agar user bisa lanjut browse via search.
- Search → `.props.pageProps.initialVideoResults.data[]` (bukan `.videos`)
- Video detail → `.props.pageProps.firstVideo`; HLS URL di `firstVideo.sources[].type === 'application/x-mpegURL'`

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

## History / Browser Back Button
- `tpNav(push, mode, q, tag)` — helper pushState/replaceState; mode: `'home'|'search'|'tag'`
- Init: `replaceState` dengan `{ tpMode: 'home' }` → back dari home keluar platform (benar)
- Search/tag/trend chip: `pushState` → back dari search kembali ke home dalam platform
- Video `replaceState` menyertakan context `{ tpMode, q, tag }` agar popstate tahu mode sebelumnya
- `popstate` handler: restore feed (`resetFeed` + set `currentQuery`/`currentTag` + `loadPosts`)
- URL: `/tp` (home), `/tp?q=...` (search), `/tp?tag=...` (tag), `/tp/video/:token` (watching)
- Init juga parse `location.search` agar shared link `/tp?q=...` langsung load hasil search

## CSP additions
- `https://pl26548697.profitableratecpm.com` dan `https://pl26548687.profitableratecpm.com` ditambah ke `scriptSrc` di server.js

## Caption template tags
- tik.porn kadang mengirim caption dengan placeholder seperti `@{{action:26}}`, `@{{pornstar:4775}}`, `@{{studio:189}}`
- Hanya `#{{tag:\d+}}` yang di-strip (`stripTagPlaceholders`); `@{{...}}` dibiarkan (bisa di-strip ke depan jika diinginkan)

## Client-side search dedup (seenVideoIds)
tik.porn SSR search (`/?s=query&page=N`) tidak mendukung multi-page — setiap page mengembalikan konten yang sama dengan page 1. Fix di `public/tp.js`:
- `seenVideoIds` (Set) di-reset saat `resetFeed()`, diisi saat video ditambahkan ke feed
- Setiap batch baru difilter: `videos.filter(v => !seenVideoIds.has(String(v.id)))`
- Jika hasil filter kosong dan feed sudah ada konten → `hasMore = false` → end slide tampil
- Tidak perlu perubahan server-side

**Why:** SSR tik.porn tidak membedakan page=1 vs page=2 untuk search — response `initialVideoResults` identik. Client dedup adalah satu-satunya cara yang reliable tanpa mengakses internal API tik.porn.

## Platform identity — BUKAN Vidorey 5
- **Nama UI**: Vidorey TikTok 1 (bukan Vidorey 5)
- **Nav drawer**: masuk seksi **"Fitur Lain"** (di bawah divider), bukan seksi listing atas
- **Urutan listing**: Vidorey 1 = P1, Vidorey 2 = P2, Vidorey 3 = P3, Vidorey 4 = P4, **Vidorey 5 = P6/sb** — TP tidak dihitung dalam urutan numerik listing

## Nav drawer pattern untuk platform baru
- TikTok-style baru → tambah di seksi "Fitur Lain" (setelah `<div class="nav-drawer-label">Fitur Lain</div>`)
- "rc" (Vidorey TikTok 2, reddclips) pernah direncanakan tapi **tidak pernah dibangun** — tidak ada `rc.html` atau `lib/scrapers/rc.js`
- Update SEMUA 6 HTML (index, rb, yb, bk, tp, sb) jika ada platform TikTok baru

## Ad slot TP — struktur yang benar (PENTING)
`body.tp-page { overflow: hidden }` + `#tpFeed { position: fixed; inset: 0 }` — static HTML slot di luar feed (leaderboard/skyscraper/mobile) TIDAK TERLIHAT karena tertimpa feed fixed. Sudah dibersihkan.

Slot iklan aktif di TP (identik dengan RC/P6):
1. `#tpNativeAd .tp-native-ad` — native sticky bottom (`position: fixed; z-index: 130`)
2. `#tpDisplayTop .tp-display-top` — mobile banner 320×50 fixed di bawah topbar (`z-index: 119`, key `d37e31d713d11b2ddde7d3efca199c9d`)
3. `tp.js createAdSlide()` — display banner 300×250 sebagai full-screen slide setiap 5 video
4. `tp.js appendEndSlide()` — display banner 300×250 di end slide
5. Popunder & Social Bar script — bekerja global tanpa tergantung posisi DOM

**Why:** Jangan tambahkan static `ad-leaderboard-slot`/`ad-skyscraper-slot` ke tp.html — mereka invisible di balik feed fixed dan hanya membuang request network.

## Platform name (UI)
Nama user-facing: **"Vidorey TikTok 1"** — tidak menyebut "tik.porn" atau nama sumber apapun.
