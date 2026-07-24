---
name: adding-scraping-platform
description: Add a new scraping platform (Platform N) to Vidorey following the Platform 1 (vdy.to) direct-proxy / Platform 2-4's HLS-or-MP4 pattern, so video streams never expose raw CDN tokens to the client and never show "stream expired" errors. Use when the user asks to add a new video source/platform, integrate a new site, or wants a new platform to behave reliably like the existing ones.
---

# Adding a New Scraping Platform to Vidorey

Vidorey currently has **nine** platforms, all completely isolated from each other:

| Platform | URL | Source | Delivery | Backend module | HTML | JS | Nama UI | Tipe UI |
|---|---|---|---|---|---|---|---|---|
| Platform 1 | `/` | vdy.to | direct MP4 | `lib/scrapers/p1.js` | `index.html` | `app.js` | Vidorey 1 | Listing |
| Platform 2 | `/rb` | ruangbokep.ws | HLS (m3u8) | `lib/scrapers/rb.js` | `rb.html` | `rb.js` | Vidorey 2 | Listing |
| Platform 3 | `/yb` | yobokep.com | HLS (m3u8) | `lib/scrapers/yb.js` | `yb.html` | `yb.js` | Vidorey 3 | Listing |
| Platform 4 | `/bk` | bokepking.cam | direct MP4 | `lib/scrapers/bk.js` | `bk.html` | `bk.js` | Vidorey 4 | Listing |
| Platform 5 | `/tp` | tik.porn | HLS (m3u8) | `lib/scrapers/tp.js` | `tp.html` | `tp.js` | Vidorey TikTok 1 | TikTok-style |
| Platform 6 | `/sb` | situsbokep.cc | HLS (m3u8) | `lib/scrapers/sb.js` | `sb.html` | `sb.js` | Vidorey 5 | Listing |
| Platform 7 | `/vd` | videy.design | direct MP4 | `lib/scrapers/vd.js` | `vd.html` | `vd.js` | Vidorey 7 | Listing |
| Platform 8 | `/xn` | xchina.tube | HLS (m3u8) | `lib/scrapers/xn.js` | `xn.html` | `xn.js` | Vidorey 6 | Listing |
| Platform 9 | `/zg` | zoig.com | direct MP4 | `lib/scrapers/zg.js` | `zg.html` | `zg.js` | Vidorey 8 | Listing |

**Nama UI tidak menyebut nama web sumber** — ini aturan eksplisit dari user.

## Tipe UI dan referensi implementasi

- **Listing biasa** (grid/card + pagination + search bar) → copy Platform 4 (`bk.js` + `bk.html`/`bk.js`) untuk MP4, atau Platform 2/7 (`rb.js`/`sb.js`) untuk HLS.
- **TikTok-style feed (direct MP4)** → copy Platform 6 (`rc.js` + `rc.html`/`rc.js`).
- **TikTok-style feed (HLS)** → copy Platform 5 (`tp.js` + `tp.html`/`tp.js`).

`server.js` is a thin composition root — it only wires Helmet/CSP, CORS, rate limiting, mounts each platform's router, the shortlink resolver route, and serves the SPA fallback. Shared, stateless helpers live in:
- `lib/cache.js` — `makeCache()` factory
- `lib/proxy.js` — UA string, `apiError()`, axios instances, `resolveUrl()`, `basenameNoQuery()`
- `lib/shortlink.js` — `registerSlug(platform, slug)` → 11-char token; `resolveToken(platform, token)` → slug

These are the **only** files a new platform module may import from. Never import one scraper module from another.

---

## NAV DRAWER — ATURAN PENEMPATAN (KRITIS)

Nav drawer dibagi dua seksi yang tidak boleh dicampur:

### Seksi Atas (tidak ada label)
Platform **listing biasa** (grid/card + pagination + search bar). Ditempatkan **SEBELUM** `<hr class="nav-section-divider">`.

Urutan saat ini: P1(/) → P2(/rb) → P3(/yb) → P4(/bk) → P6(/sb) → P8(/xn) → P7(/vd) → P9(/zg) → *platform listing baru di sini*

### Pemisah
```html
<hr class="nav-section-divider">
<div class="nav-drawer-label">Fitur Lain</div>
```

### Seksi Bawah — "Fitur Lain"
Platform **TikTok-style** (vertical scroll-snap, tidak ada grid/card). Ditempatkan **SETELAH** label "Fitur Lain".

Urutan saat ini: P5(/tp, TikTok 1) → *platform TikTok baru di sini*

**⚠️ Bug yang sudah terjadi:** Platform SB (listing biasa) awalnya ditempatkan di seksi "Fitur Lain" → user complaint. Pelajaran: **listing platform TIDAK BOLEH masuk "Fitur Lain"**. "Fitur Lain" hanya untuk TikTok-style.

---

## Why isolation + the retry/proxy pattern is the standard

The root cause of "stream expired" bugs is **exposing a CDN's raw, time-limited signed URL/token directly to the browser** and/or **giving up immediately on the first transient error** instead of retrying. The reference platforms avoid both:

1. The browser NEVER sees the real CDN URL — it always requests `/proxy/pN/stream/:slug` (direct file) or `/proxy/pN/hls|seg` (HLS) from our own backend. The backend resolves the real URL server-side and streams the bytes through itself.
2. If the CDN rejects the cached URL (403/404 — token expired), the backend evicts the cache entry, re-resolves a fresh URL from the source site, and retries **once** automatically before failing. The user never sees an error for a routine token refresh.
3. Any proxy that talks to a flaky third-party CDN wraps the request in a retry helper (2–3 attempts, exponential backoff) that only retries on network errors (ECONNRESET/timeout), never on real HTTP 4xx from the CDN.

---

## ✅ MASTER CHECKLIST — Platform N

Lakukan SEMUA langkah ini tanpa terkecuali. Setiap item yang dilewati akan menyebabkan bug di production.

---

### STEP 1 — lib/scrapers/pN.js (backend module)

Buat `lib/scrapers/pN.js` yang export `{ router, caches }`.

- Route namespace baru: `/api/pN/...`, `/proxy/pN/...`
- Cache baru via `makeCache(maxSize, ttlMs)` — **tidak boleh reuse cache platform lain**
- `caches` array berisi semua cache instance — dipakai `server.js` untuk `/health/detail`
- Enforce host allowlist (`Set` of CDN hostnames) untuk proxy — reject domain lain dengan 400
- Scrape/resolve real CDN URL **server-side only** — jangan kirim URL CDN asli ke frontend

```js
// Template dasar:
const express = require('express');
const path    = require('path');
const { makeCache } = require('../cache');
const { apiError } = require('../proxy');

const router = express.Router();
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

const pNPostsCache = makeCache(200, 10 * 60 * 1000, 'pNPostsCache');
const pNVideoCache = makeCache(500, 4 * 60 * 60 * 1000, 'pNVideoCache');

// ... API routes ...

/* ── SPA routes — WAJIB, tanpa ini klik nav drawer → Platform 1 ── */
router.get('/pN',   (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'pN.html')));
router.get('/pN/*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'pN.html')));

module.exports = { router, caches: [pNPostsCache, pNVideoCache] };
```

⚠️ **SPA routes WAJIB ada di scraper ini** — bukan di server.js. Tanpa `router.get('/pN', ...)` dan `router.get('/pN/*', ...)`, semua URL `/pN` dan `/pN/watch/<token>` jatuh ke SPA fallback di server.js yang serve `index.html` (Platform 1). Bug ini sudah terjadi pada Platform 7 (SB) pertama kali.

---

### STEP 2 — server.js (4 lokasi wajib diupdate)

#### 2a. require + mount router
```js
const pN = require('./lib/scrapers/pN');
// ...
app.use(pN.router);
```

#### 2b. getCacheStats — tambah pN.caches ke array
```js
const allCaches = [
  ...p1.caches, ...rb.caches, ...yb.caches,
  ...bk.caches, ...tp.caches, ...rc.caches, ...sb.caches,
  ...pN.caches,   // ← TAMBAH INI
];
```

#### 2c. CSP script-src — tambah domain baru jika ada script/ad baru
```js
const scriptSrc = [
  "'self'", "'unsafe-inline'",
  'https://cdn.jsdelivr.net',
  // ... existing domains ...
  'https://cdn-domain-baru.com',   // ← TAMBAH jika platform butuh domain baru
];
```
CSP **tidak pakai wildcard `https:`** — setiap domain harus eksplisit.

#### 2d. Shortlink platform list — tambah 'pN'
```js
// Di route /api/s/:platform/:token:
if (!['rb', 'yb', 'bk', 'tp', 'rc', 'sb', 'pN'].includes(platform))
  return res.status(404).json({ error: 'not found' });
```

---

### STEP 3 — lib/monitor.js (2 lokasi wajib)

#### 3a. trackRequest — tambah event branches
Cari blok `if/else if` di fungsi `trackRequest`. Tambah sebelum blok `else` terakhir:
```js
else if (p.startsWith('/api/pN/video/'))   pushMonitorEvent('pN_video', { id: p.split('/')[4] || '?', ip, ua });
else if (p.startsWith('/api/pN/posts'))    pushMonitorEvent('pN_posts', { ip, ua });
```
Untuk platform TikTok-style yang pakai `/proxy/pN/stream/`:
```js
else if (p.startsWith('/proxy/pN/stream/')) pushMonitorEvent('pN_video', { id: p.split('/')[4] || '?', ip, ua });
else if (p.startsWith('/api/pN/posts'))     pushMonitorEvent('pN_posts', { ip, ua });
```

#### 3b. Monitor badge CSS — tambah warna badge di monitorDashboardHtml
Cari blok CSS badge (`.b-rb_video`, `.b-bk_video`, `.b-sb_video`, dsb) di `monitorDashboardHtml`. Tambah:
```css
.b-pN_video{background:#WARNA_BG;color:#WARNA_TEXT}
.b-pN_posts{background:#WARNA_BG;color:#WARNA_TEXT}
```
Pilih warna yang berbeda dari platform lain (lihat existing untuk referensi).

---

### STEP 4 — public/pN.html

Copy dari platform terdekat (bk.html/sb.html untuk listing biasa, rc.html untuk TikTok-style).

#### 4a. Wajib ada di setiap HTML platform baru:
- `<html lang="en">` — wajib English agar Google index untuk Tier 1 traffic
- `<body class="pN-page">` — class scoping CSS
- Topbar dengan `<img src="/logo.png">` + title "Vidorey N" (TIDAK menyebut nama web sumber)
- Nav drawer lengkap — **semua platform existing + platform baru** (lihat 4b)
- Slot iklan: display banner (320×50 fixed bawah topbar) + native sticky bottom + in-feed ad slide
- `<script src="/config.js">` — wajib ada sebelum JS platform
- `<script src="/smartlinks.js">` — wajib ada, di dalam `</body>`
- `<script src="/pN.js">` — JS platform sendiri

#### 4a-SEO. Meta tags SEO wajib (copy template ini):
```html
<title>Vidorey N - [English adult keyword title]</title>
<meta name="description" content="[English description, adult keywords, no registration angle]" />
<meta name="keywords" content="free porn, xxx videos, [platform-specific keywords]" />
<meta name="robots" content="index, follow" />
<link rel="canonical" href="https://vidorey.web.app/pN" />
<meta name="theme-color" content="#121212" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Vidorey" />
<meta property="og:title" content="[shorter version of title]" />
<meta property="og:description" content="[same as description]" />
<meta property="og:url" content="https://vidorey.web.app/pN" />
<meta property="og:image" content="https://vidorey.web.app/logo.png" />
<meta property="og:locale" content="en_US" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="[same as og:title]" />
<meta name="twitter:description" content="[same as og:description]" />
<meta name="twitter:image" content="https://vidorey.web.app/logo.png" />
```
**Jangan gunakan `lang="id"` atau `og:locale="id_ID"`** — itu membatasi traffic ke Indonesia (CPM rendah).

#### 4b. Nav drawer — ATURAN PENEMPATAN WAJIB

Update **SEMUA 7 HTML files** (index, rb, yb, bk, sb, tp, rc) + pN.html baru.

Format satu nav item:
```html
<a class="nav-plat-item" href="/pN">
  <div class="ps-avatar ps-avatar-pN"><img src="/logo.png" alt="Vidorey"></div>
  <div class="ps-info">
    <span class="ps-name">Vidorey N</span>
    <span class="ps-desc">Deskripsi singkat</span>
  </div>
</a>
```

Item aktif (hanya di `pN.html` sendiri):
```html
<a class="nav-plat-item active" href="/pN" aria-current="page">
```

**Penempatan berdasarkan tipe UI:**
- **Listing biasa** → sisipkan SEBELUM `<hr class="nav-section-divider">` (seksi atas, bersama P1–P4, P7)
- **TikTok-style** → sisipkan SETELAH `<div class="nav-drawer-label">Fitur Lain</div>` (seksi bawah, bersama P5–P6)

**Nama UI tidak boleh menyebut nama web sumber.** Gunakan format "Vidorey N" atau "Vidorey TikTok N".

#### 4c. Burger ID untuk TikTok-style platform
Platform dengan topbar custom (tp, rc) punya burger ID sendiri (`tpNavBurger`, `rcNavBurger`).
Platform listing biasa (rb, yb, bk, sb, platform baru listing) pakai `id="navBurger"` standar.

---

### STEP 5 — public/pN.js

Copy dari platform terdekat, ganti semua prefix (rb→pN, dsb).

Untuk platform listing (non-TikTok):
- `openPlayer(slug)` → `openPlayer(slug, opts)` pattern
- Shortlink token flow: `currentSlug` + `currentToken` state
- Deep-link: baca pathname SEBELUM `loadPosts()` (lihat §Watch view di bawah)
- `encodeSlug()`/`decodeSlug()` helpers (copy verbatim)

Untuk platform TikTok-style:
- IntersectionObserver threshold 0.75 play/pause
- `removeAttribute('src')` + `load()` saat slide keluar viewport
- `tryScrollToDeepLink()` dipanggil setelah batch pertama render
- `deepLinkHash` dibaca dari pathname SEBELUM reset URL

---

### STEP 6 — public/style.css

Tambah semua CSS baru di bawah blok platform terakhir. Scope semua rule ke `body.pN-page` agar tidak bocor ke platform lain.

```css
/* ─── Platform N ─────────────────────────────────── */
body.pN-page { overflow: hidden; } /* hanya untuk TikTok-style */

/* Topbar, feed, slide, cats-bar, dll. */
.pN-topbar { ... }
.pN-feed   { ... }
/* dsb. */
```

Untuk TikTok-style, perhatikan **stacking layer**:
```
topbar          fixed top:0       z-index: 120
display-banner  fixed top:52px    z-index: 119
cats-bar        fixed top:102px   z-index: 119   (jika ada)
feed            fixed top:150px   bottom:0        (atau top:102px jika tidak ada cats-bar)
slide height    calc(100dvh - 150px)              (sesuaikan)
```
Jika mengubah tinggi satu layer, **update SEMUA nilai top/height di bawahnya sekaligus**.

---

### STEP 7 — firebase.json (⚠️ WAJIB — penyebab "Platform N tampil Platform 1" di production)

Tambah dua baris rewrite untuk platform baru **sebelum** catch-all `"**"`:

```json
{ "source": "/pN",    "destination": "/pN.html" },
{ "source": "/pN/**", "destination": "/pN.html" },
```

Tanpa ini, semua URL `/pN/*` di Firebase Hosting akan di-serve sebagai `index.html` (Platform 1), bukan `pN.html`.

Setelah edit `firebase.json`, jalankan `bash deploy.sh` untuk deploy ke Firebase.

---

### STEP 8 — public/smartlinks.js

Tambah selector card/slide platform baru ke `CARD_SEL`:

```js
// Listing platform (grid card):
var CARD_SEL = '.video-card, .rb-card, .folder-card, .tp-slide, .rc-slide, .sb-card, .pN-card';
// TikTok-style:
var CARD_SEL = '.video-card, .rb-card, .folder-card, .tp-slide, .rc-slide, .sb-card, .pN-slide';
```

**Catatan:** Platform yang copy dari rb.html template akan punya class `.rb-card` otomatis — trigger card click sudah aktif. Tambah class spesifik (`.pN-card`) untuk explicitness.

---

### STEP 9 — Iklan (wajib identik dengan platform lain)

Setiap platform wajib punya semua slot iklan ini — identik kodenya, sama seperti platform lain:

| Slot | Posisi | Key/Script |
|---|---|---|
| Display banner 320×50 | Fixed bawah topbar (top:52px) | `d37e31d713d11b2ddde7d3efca199c9d` via `highperformanceformat.com` |
| Native sticky bottom | Fixed bottom | `761a1a8645cd2263043bfeb6f2e87eea` via `effectivecpmnetwork.com` |
| In-feed ad slide | Setiap 5 video (TikTok-style) | `d50b941ac6d9bd5749dcdb0b417bf348` via `highperformanceformat.com` |
| End slide ad | Slide terakhir | Same key sebagai in-feed |
| Popunder | End of `<body>` | `pl28418540.effectivecpmnetwork.com` |
| Social bar | End of `<body>` | `pl28427857.effectivecpmnetwork.com` |

Script popunder + social bar sudah ada di semua platform — copy langsung dari rc.html atau tp.html.

---

### STEP 10 — Update dokumentasi

Setelah platform selesai, update semua file dokumentasi ini:

#### sitemap.xml
Tambah `<url>` baru ke `public/sitemap.xml`:
```xml
<url>
  <loc>https://vidorey.web.app/pN</loc>
  <changefreq>daily</changefreq>
  <priority>0.8</priority>
</url>
```

#### replit.md
- Tabel platform: tambah baris Platform N
- Bagian scraper list di backend section: tambah `pN.js`
- "Tujuh Platform" → "Delapan Platform" (jumlah baru)
- Monitor events table: tambah `pN_video` / `pN_posts`
- Cara kerja Platform N: tambah section baru
- Nav drawer active items: tambah `pN.html → Vidorey N`
- Iklan section: tambah `pN.html` ke daftar file
- Sitemap: update jumlah URL

#### .agents/memory files yang wajib diupdate
- `MEMORY.md` — tambah entri baru `[Platform N Architecture](pN-architecture.md)`
- `vidorey-modular-refactor.md` — tambah `pN.js` ke scraper list, update jumlah platform
- `vidorey-nav-drawer.md` — tambah baris di tabel nama platform, update jumlah HTML files
- `vidorey-caching-strategy.md` — tambah cache baru Platform N ke tabel, update getCacheStats Order
- `vidorey-smartlinks.md` — update CARD_SEL, tambah HTML ke daftar halaman
- `vidorey-seo.md` — update jumlah halaman, tambah baris meta tags table
- `vidorey-csp-allowlist.md` — tambah domain ad baru jika ada

#### adding-scraping-platform/SKILL.md (file ini sendiri)
- Tambah Platform N ke tabel di atas
- Update "Vidorey currently has N platforms"
- Update CARD_SEL contoh di STEP 8
- Update jumlah HTML files di STEP 4b

---

### STEP 11 — Verify sebelum ship

```bash
# 1. Test backend endpoint
curl -s "http://localhost:5000/api/pN/posts" | jq '.posts | length'
curl -s "http://localhost:5000/api/pN/video/SAMPLE_SLUG" | jq '{title, token}'

# 2. Test proxy
curl -I "http://localhost:5000/proxy/pN/stream/SAMPLE_SLUG"

# 3. Test shortlink
TOKEN=$(curl -s "http://localhost:5000/api/pN/video/SAMPLE_SLUG" | jq -r '.token')
curl -s "http://localhost:5000/api/s/pN/$TOKEN" | jq '.slug'

# 4. Test SPA route — WAJIB 200 bukan fallback index.html
curl -I "http://localhost:5000/pN"
curl -I "http://localhost:5000/pN/watch/SAMPLE_TOKEN"
# Kedua harus return 200. Jika serve index.html → SPA route di scraper belum ditambah.

# 5. Test Firebase routing — paling penting!
curl -I "https://vidorey.web.app/pN"
# → Harus return pN.html, BUKAN index.html
```

Checklist manual:
- [ ] Video play end-to-end (dari listing → klik → player)
- [ ] Address bar tunjukkan `/pN/watch/<11-char-token>` setelah video load
- [ ] Share button copy URL pendek (token)
- [ ] Deep-link dari URL token (`/pN/watch/<token>`) buka video langsung
- [ ] Nav drawer buka/tutup dengan benar di mobile
- [ ] Platform ini muncul di nav drawer semua platform lain **di posisi yang benar** (listing → atas divider, TikTok → bawah "Fitur Lain")
- [ ] Klik platform baru dari nav drawer di platform lain → navigasi ke platform baru (bukan ke Platform 1)
- [ ] Monitor dashboard (`/monitor`) menampilkan event `pN_video` dan `pN_posts`
- [ ] Iklan muncul: display banner, native sticky, in-feed (scroll 5+ video), popunder
- [ ] Firebase: `/pN` serve `pN.html` (bukan `index.html`)
- [ ] Run code-review architect pass sebelum declare done

---

## Appendix: Watch view (listing platform)

Copy `rb.js`/`rb.html` line-for-line (adapting the player element):

- Markup: `.modal-panel-watch` > `.modal-body` > `.watch-info` (title + `#pNShareBtn` + description) + `.watch-related` (`#pNRelatedGrid` + `#pNRelatedPagination`), followed by `.watch-ad-slot`
- JS state: `let currentSlug = null; let currentToken = null;`
- `renderWatchDesc()`, `renderRelated()`/`renderRelatedPagination()` (8 items/page)
- `openPlayer(slug, opts)` accepting `opts.fromHistory`

### URL scheme — 11-char shortlink

**Helpers (copy verbatim):**
```js
function encodeSlug(s) {
  try {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch { return encodeURIComponent(s); }
}
function decodeSlug(t) {
  try {
    const pad = t.length % 4;
    const bin = atob((pad ? t + '='.repeat(4 - pad) : t).replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))) || null;
  } catch { return null; }
}
```

**openPlayer(slug):**
```js
currentSlug  = slug;
currentToken = null;
const data = await apiFetch(`/api/pN/video/${encodeURIComponent(slug)}`);
if (data.token) {
  currentToken = data.token;
  history.replaceState({ pNModal: true, pNSlug: slug }, '', `/pN/watch/${data.token}`);
}
```

**Deep-link on load** — baca pathname SEBELUM `loadPosts()`:
```js
const deepLinkMatch = location.pathname.match(/^\/pN\/watch\/([^/]+)\/?$/);
loadPosts(false); // ini replaceState('/pN')
if (deepLinkMatch) {
  const segment = deepLinkMatch[1];
  if (/^[a-z0-9]{11}$/.test(segment)) {
    apiFetch(`/api/s/pN/${segment}`)
      .then(d => { if (d?.slug) { modalHistoryPushed = false; openPlayer(d.slug); } })
      .catch(() => {});
  } else {
    const slug = decodeSlug(segment);
    if (slug) { modalHistoryPushed = false; openPlayer(slug); }
  }
}
```

**closeModal() + popstate back:**
```js
currentSlug  = null;
currentToken = null;
```

**Share button:**
```js
const shareUrl = `${location.origin}/pN/watch/${currentToken || encodeSlug(currentSlug)}`;
```

### Shortlink — wire token ke video endpoint
```js
const { registerSlug } = require('../shortlink');
// Di setiap res.json path handler (cache-hit DAN fresh-resolve):
res.json({ slug, title, thumb, description, related, streamUrl,
           token: registerSlug('pN', slug) });
```

### Related-video scraping
Setiap situs punya markup berbeda — **jangan copy selector blindly**. Selalu curl HTML asli dulu:
```bash
curl -s "https://source-site.com/video/SAMPLE" | grep -A5 "related\|similar"
```

### Ad slot di watch view
Satu slot `300×250` display banner di `.watch-ad-slot` (bawah related pagination).
Gunakan key `d50b941ac6d9bd5749dcdb0b417bf348` via `highperformanceformat.com`.
**Jangan** tambah native banner atau popunder di watch view (lihat §9).

---

## Appendix: No source ads rule

Platform baru wajib proxy video langsung — tidak boleh ada iframe/embed dari situs sumber di browser user.

**Cara cek feasibility:**
```bash
# Curl setiap lapisan chain dari server:
curl -sI "https://source-site.com/video/SAMPLE"
curl -sI "https://embed-host.com/e/HASH"
# Jika ada layer yang return 403 atau SPA < 2KB → TIDAK FEASIBLE
```

Jika chain tidak bisa di-resolve server-side → platform tidak boleh diimplementasikan (daripada terpaksa fallback ke iframe yang membawa iklan sumber).
