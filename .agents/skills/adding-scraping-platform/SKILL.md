---
name: adding-scraping-platform
description: Add a new scraping platform (Platform N) to Vidorey following the Platform 1 (xpvid.cc) direct-proxy / Platform 2-4's HLS-or-MP4 pattern, so video streams never expose raw CDN tokens to the client and never show "stream expired" errors. Use when the user asks to add a new video source/platform, integrate a new site, or wants a new platform to behave reliably like the existing ones.
---

# Adding a New Scraping Platform to Vidorey

Vidorey currently has **six** platforms, all completely isolated from each other:

| Platform | URL | Source | Delivery | Backend module | HTML | JS | Nama UI |
|---|---|---|---|---|---|---|---|
| Platform 1 | `/` | xpvid.cc | direct MP4 | `lib/scrapers/p1.js` | `index.html` | `app.js` | Vidorey 1 |
| Platform 2 | `/rb` | ruangbokep.ws | HLS (m3u8) | `lib/scrapers/rb.js` | `rb.html` | `rb.js` | Vidorey 2 |
| Platform 3 | `/yb` | yobokep.com | HLS (m3u8) | `lib/scrapers/yb.js` | `yb.html` | `yb.js` | Vidorey 3 |
| Platform 4 | `/bk` | bokepking.cam | direct MP4 | `lib/scrapers/bk.js` | `bk.html` | `bk.js` | Vidorey 4 |
| Platform 5 | `/tp` | tik.porn | HLS (m3u8) | `lib/scrapers/tp.js` | `tp.html` | `tp.js` | Vidorey TikTok 1 |
| Platform 6 | `/rc` | api.reddclips.com | direct MP4 | `lib/scrapers/rc.js` | `rc.html` | `rc.js` | Vidorey TikTok 2 |

**Nama UI tidak menyebut nama web sumber** — ini aturan eksplisit dari user.

Both delivery styles are proven reference implementations — copy whichever matches
the new source site instead of inventing a new pattern:
- **Direct MP4 sites** → copy Platform 4 (`lib/scrapers/bk.js` + `public/bk.html`/`bk.js`): simplest,
  no manifest rewriting needed.
- **HLS/m3u8 sites** → copy Platform 2 or 3 (`rb.js`/`yb.js`): manifest + segment
  proxy with self-healing CDN tokens.

`server.js` is a thin composition root — it only wires Helmet/CSP, CORS, rate
limiting, mounts each platform's router, the shortlink resolver route, and serves
the SPA fallback. Shared, stateless helpers live in:
- `lib/cache.js` — `makeCache()` factory
- `lib/proxy.js` — UA string, `apiError()`, axios instances, `resolveUrl()`, `basenameNoQuery()`
- `lib/shortlink.js` — `registerSlug(platform, slug)` → 11-char token; `resolveToken(platform, token)` → slug

These are the **only** files a new platform module may import from. Never import
one scraper module from another.

## Why isolation + the retry/proxy pattern is the standard

The root cause of "stream expired" bugs is **exposing a CDN's raw, time-limited
signed URL/token directly to the browser** and/or **giving up immediately on the
first transient error** instead of retrying. The reference platforms avoid both:

1. The browser NEVER sees the real CDN URL — it always requests
   `/proxy/pN/stream/:slug` (direct file) or `/proxy/pN/hls|seg` (HLS) from our
   own backend. The backend resolves the real URL server-side and streams the
   bytes through itself.
2. If the CDN rejects the cached URL (403/404 — token expired), the backend
   evicts the cache entry, re-resolves a fresh URL from the source site, and
   retries **once** automatically before failing. The user never sees an error
   for a routine token refresh.
3. Any proxy that talks to a flaky third-party CDN wraps the request in a retry
   helper (2–3 attempts, exponential backoff) that only retries on network
   errors (ECONNRESET/timeout), never on real HTTP 4xx from the CDN.

## Checklist for Platform N

### 1. Full isolation (non-negotiable project rule)
Per `replit.md`: **every platform must be completely isolated** — no shared
state, cache, or logic that leaks between platforms.
- New route prefix, e.g. `/pN` (mirrors `/rb`, `/yb`, `/bk`).
- New static page: `public/pN.html`, own JS: `public/pN.js`. Do not import or
  reuse another platform's JS file — small utility duplication (fetch timeout,
  `escHtml`, toast, pagination) is the accepted tradeoff for isolation; copy
  the pattern, don't share the module.
- New backend module `lib/scrapers/pN.js` exporting `{ router, caches }` —
  `caches` is aggregated by `server.js` into `getCacheStats()` for
  `/health/detail`. New route namespace: `/api/pN/...`, `/proxy/pN/...`. New
  dedicated in-memory caches via `makeCache(maxSize, ttlMs)` — never reuse
  another platform's cache map.
- Add the platform to the **sidebar nav drawer** (not a dropdown — that pattern
  was removed) in every HTML file: `.nav-plat-item` entries inside
  `nav.nav-drawer` (id `navDrawer`), consistent avatar (`<img src="/logo.png">`)
  and highlight the active platform. Update all **six** HTML files
  (index, rb, yb, bk, tp, rc) together so the drawer always lists every platform.
- Add the new router to `server.js`'s mount list and to the CSP `script-src`
  domain allowlist if the new source's embeds/ads need a new external domain
  (CSP does **not** use a `https:` wildcard — every domain must be explicit).

### 2. WAJIB: Tidak boleh ada iklan dari web sumber yang muncul ke user
Ini adalah syarat mutlak — **bukan opsional**. Semua platform yang sudah ada
(P1–P6) bebas iklan dari web aslinya karena video diproxy sepenuhnya server-side.
Platform baru harus mengikuti standar yang sama:

- **Jangan pernah load halaman embed/iframe dari situs sumber di browser user.**
  Halaman embed (putarvid, filemoon, dood, dsb.) membawa script iklan milik
  mereka — kalau diload di browser user, iklan itu ikut muncul.
- **Jangan kirim URL embed ke frontend.** Resolve embed → raw stream (MP4/m3u8)
  di server, kirim hanya stream URL yang sudah dibersihkan.
- **Jika situs sumber menggunakan chain embed bertingkat** (situs → player
  aggregator → embed host → CDN), seluruh chain harus di-resolve server-side
  sampai didapat URL MP4/m3u8 langsung yang bisa diproxy. Jika salah satu
  lapisan chain memblokir server request dan tidak bisa di-resolve tanpa browser
  (contoh: React SPA tanpa API terbuka, atau CDN yang IP-block server), platform
  tersebut **tidak feasible** dan tidak boleh diimplementasikan — daripada
  terpaksa fallback ke iframe embed yang membawa iklan dari sumber.
- **Cara cek feasibility sebelum mulai build:** curl setiap lapisan chain dari
  server (bukan dari browser). Jika ada lapisan yang return 403, SPA kosong
  (< 2 KB HTML tanpa konten), atau butuh JS-rendering untuk dapat stream URL →
  platform tidak layak diimplementasikan saat ini.

### 3. Resolve the real media URL server-side only
- Scrape/resolve the actual CDN URL (MP4 or m3u8) inside an Express route
  handler using `cheerio`/`axios` — never send this URL to the browser.
- Cache the resolved URL with `makeCache(maxSize, ttlMs)`, TTL matched to how
  long the source site's token realistically stays valid (inspect the token's
  query params — don't guess; verify with a real curl request through the
  backend).
- While you're scraping the post/video page anyway, also extract `description`
  (usually `meta[property="og:description"]`, with `meta[name="description"]`
  and `meta[itemprop="description"]` as fallbacks — check which is most
  detailed per site) and `related` (an array of `{slug, title, thumb,
  duration}` for other videos on the same page) — see "Watch view" below.

### 3. Client always calls your backend proxy, never the CDN
- Direct file (MP4-like): mirror `/proxy/bk/stream/:slug` — supports HTTP
  `Range`, sets `Referer`/`User-Agent` matching what the source CDN expects,
  streams via `stream.pipeline`.
- Segmented (HLS-like): mirror `/proxy/rb/hls/:slug` + `/proxy/rb/seg` —
  rewrite every URL in the manifest (including `URI="..."` attributes and
  sub-manifests) to point back at your own `/proxy/pN/seg?url=...`, so the
  browser only ever talks to your backend.
- Enforce a strict host allowlist (`Set` of hostnames or hostname-suffix check)
  for whatever CDN domain(s) the new platform's videos/thumbnails live on.
  Reject everything else with 400, same as `isAllowedRbCdnUrl` / `THUMB_HOSTS`.

### 4. Auto-recover from expired tokens — don't just error out
- **Backend**: wrap every CDN network call (manifest fetch, segment fetch,
  direct stream fetch) in a small retry helper — 2–3 retries with backoff, but
  only on network errors, never on real 4xx from the CDN (those need a fresh
  resolve, not a retry).
- **Backend, direct-file case**: on CDN 403/404, delete the cached URL,
  re-resolve once, retry the request — copy the eviction pattern used in
  `/proxy/bk/stream/:slug`.
- **Frontend, HLS case**: if using hls.js, do NOT treat every fatal error as
  unrecoverable. Implement the standard recovery pattern — `NETWORK_ERROR` →
  `hls.startLoad()` retry (a few attempts with delay), `MEDIA_ERROR` →
  `hls.recoverMediaError()` retry — and only show a "playback failed" toast
  after retries are exhausted. See `playHls()` in `public/rb.js` for the
  reference implementation.

### 5. User-facing error messages
- Never surface raw `err.message`/stack traces to the user (toast/UI text).
  Always map to a short, friendly Indonesian message (e.g. "Gagal memuat
  video. Periksa koneksi internet atau coba lagi."). Log the real error with
  `console.error` server- and client-side for debugging.

### 6. Watch view (title + description + related videos + share)
Every platform's video click opens a scrollable modal watch view (**not**
full-screen — intentional), mirroring YouTube/XNXX. Copy `rb.js`/`rb.html`
line-for-line (adapting the `<video>`/`<iframe>` player element to whatever
the new platform needs):

- Markup: `.modal-panel-watch` > `.modal-body` > `.watch-info` (title +
  `#pNShareBtn` share button + description) + `.watch-related` (`#pNRelatedGrid`
  + `#pNRelatedPagination`), followed by `.watch-ad-slot` (see §7).
- JS state: `let currentSlug = null; let currentToken = null;` — both declared
  together. Also `renderWatchDesc()`, `renderRelated()`/`renderRelatedPage()`/
  `renderRelatedPagination()` (8 items/page, client-side), `openPlayer(slug, opts)`
  accepting `opts.fromHistory`.

#### URL scheme — 11-char shortlink (not slug in address bar)

Video watch URLs use a **short 11-char random token** (`/pN/watch/m4k9zqr2xab`)
that does not expose the video title. Full flow:

**Helpers (top of IIFE, copy verbatim — UTF-8-safe base64url):**
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

**openModal(slug)** — called immediately (before API response):
```js
const url = slug ? `/pN/watch/${encodeSlug(slug)}` : '/pN/watch';
// ... idempotent modal open ...
history.pushState({ pNModal: true, pNSlug: slug }, '', url);
```
State always stores the **raw slug** — not the token. This is what
`popstate` and Forward navigation use.

**openPlayer(slug)** — after API resolves:
```js
currentSlug  = slug;
currentToken = null; // reset at top

// ... openModal(slug) ... (pushes temp base64url URL)

const data = await apiFetch(`/api/pN/video/${encodeURIComponent(slug)}`);
if (data.token) {
  currentToken = data.token;
  history.replaceState({ pNModal: true, pNSlug: slug }, '', `/pN/watch/${data.token}`);
}
```

**closeModal() and popstate Back-while-open branch** — reset both:
```js
currentSlug  = null;
currentToken = null;
```

**Share button:**
```js
const shareUrl = `${location.origin}/pN/watch/${currentToken || encodeSlug(currentSlug)}`;
```

**Deep-link on load** — two paths, capture BEFORE `loadPosts()`:
```js
const deepLinkMatch = location.pathname.match(/^\/pN\/watch\/([^/]+)\/?$/);
loadPosts(false); // replaceState('/pN') happens here
if (deepLinkMatch) {
  const segment = deepLinkMatch[1];
  if (/^[a-z0-9]{11}$/.test(segment)) {
    // Short token → resolve slug server-side
    apiFetch(`/api/s/pN/${segment}`)
      .then(d => { if (d?.slug) { modalHistoryPushed = false; openPlayer(d.slug); } })
      .catch(() => {}); // expired / server restart — silently ignore
  } else {
    // Legacy: base64url-encoded slug (links shared before token system)
    const slug = decodeSlug(segment);
    if (slug) { modalHistoryPushed = false; openPlayer(slug); }
  }
}
```

**popstate** — three branches (unchanged logic; Forward reads `pNSlug` from state,
not from URL, so no token decode needed there):
1. Modal open + Back → close modal, `replaceState(null, '', '/pN')`.
2. Forward to `{ pNModal, pNSlug }` while modal is closed → `openPlayer(slug, { fromHistory: true })`.
3. Otherwise restore listing/search state.

**No new backend route for `/pN/watch/*`** — the existing SPA wildcard route
(`router.get('/pN/*', ...)`) already serves `pN.html`; confirm it exists in your module.

**Related-video scraping selector is site-specific — do not copy blindly.**
Every platform found a different real DOM structure (rb: `article.loop-video`
inside a `.under-video-block` matched by heading text; yb: same class names
but a stricter required heading match after a review caught a too-permissive
first attempt; bk: totally different `.under-video-block > .videos-list >
article[id]` markup with a lazy-loaded thumbnail in `img[data-src]` instead
of `src`, and no distinguishing heading at all). **Always curl the real
post-page HTML for the new source site and inspect it yourself** before
writing the selector — never assume the previous platform's class names or
heading text carry over. Scope tightly to the specific related-widget
container; a global/permissive selector risks picking up unrelated sidebar
cards.

### 7. Ad slot in the watch view
Add one small ad slot at the very bottom of `.watch-related`, after the
pagination controls, inside a `.watch-ad-slot` div — copy the exact
`atOptions` + `highperformanceformat.com` `invoke.js` snippet already used for
the listing page's 300×250 display ad. This pattern is **safe to duplicate**
on the same page (each instance re-declares `atOptions` immediately before its
own `invoke.js` call, and the script writes via `document.write` at its own
tag location — no shared/unique DOM `id` required).
- **Do NOT** reuse the native-banner ad (`.ad-native-slot`,
  `effectivecpmnetwork.com` native invoke) in the watch view — that ad's
  script targets a hardcoded `container-<key>` `id`, and a second instance of
  that same `id` on the page would break (only the first match renders).
- **Do NOT** add popunder/social-bar scripts to the watch view — those open
  new tabs or float over content, which defeats the "not too disruptive"
  requirement explicitly given for this placement. Those two are already
  loaded once per page at the end of `<body>`; leave them there.
- If the CSP `script-src` allowlist doesn't already include the new ad
  network's domain, add it explicitly in `server.js` (no wildcard).

### 7b. Shortlink — wire the token into the video endpoint

`lib/shortlink.js` and the `/api/s/:platform/:token` resolver already exist in
`server.js`. For a new platform you only need three things:

1. **Scraper** — require and call `registerSlug` in the video endpoint:
   ```js
   const { registerSlug } = require('../shortlink');
   // In /api/pN/video/:slug handler, before res.json:
   res.json({ slug, title, thumb, description, related, [streamKey]: ...,
              token: registerSlug('pN', slug) });
   ```
   Do this for every `res.json` path in that handler (cache-hit path AND
   fresh-resolve path), otherwise some responses won't carry the token.

2. **server.js** — add the new platform code to the `/api/s/:platform/:token`
   route's `includes()` check:
   ```js
   if (!['rb', 'yb', 'bk', 'tp', 'rc', 'pN'].includes(platform)) return res.status(404)...
   ```

3. **Client JS** — all the client-side token logic is covered in §6 above;
   copy it verbatim from `rb.js` substituting `rb`/`rbModal`/`rbSlug`/`rbPage`
   with `pN`/`pNModal`/`pNSlug`/`pNPage` etc.

Token lifetime: 48h in-memory. Deep-links silently degrade to listing page if
the server has restarted since the link was shared.

### 8. Verify before shipping
- Curl the new `/proxy/pN/hls/:slug` (or `/proxy/pN/seg` / `/proxy/pN/stream`)
  endpoint directly and inspect the CDN's signed URL params to confirm actual
  token TTL — don't assume "expired" means the token; it's usually a
  transient network/recovery gap.
- Curl `/api/pN/video/:slug` and confirm the JSON contains `description`,
  `related`, and `token` (11-char `[a-z0-9]` string).
- Curl `/api/s/pN/<token>` using the token from the step above — confirm it
  returns `{ "slug": "<original-slug>" }`.
- Restart the workflow and manually play a video end-to-end after adding the
  platform, on both an existing cached entry and a freshly resolved one.
- Verify the address bar shows `/pN/watch/<11-char-token>` (not the slug) after
  a video loads, and that the Share button copies the short URL.
- Open the short URL in a new tab/incognito to confirm deep-link via token works.
- Curl `/pN/watch/<token>` to confirm the SPA wildcard route serves the page
  (200), and screenshot the watch view to sanity-check title/description/
  related grid/share button/ad slot render.
- Run a code-review (architect) subagent pass with `includeGitDiff: true`
  before considering the platform done — pay special attention to the
  related-video selector's scoping accuracy against the real site markup.
