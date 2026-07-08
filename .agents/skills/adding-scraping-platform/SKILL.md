---
name: adding-scraping-platform
description: Add a new scraping platform (Platform N) to Vidorey following the Platform 1 (xpvid.cc) direct-proxy / Platform 2-4's HLS-or-MP4 pattern, so video streams never expose raw CDN tokens to the client and never show "stream expired" errors. Use when the user asks to add a new video source/platform, integrate a new site, or wants a new platform to behave reliably like the existing ones.
---

# Adding a New Scraping Platform to Vidorey

Vidorey currently has **four** platforms, all completely isolated from each other:

| Platform | URL | Source | Delivery | Backend module | HTML | JS |
|---|---|---|---|---|---|---|
| Platform 1 | `/` | xpvid.cc | direct MP4 | `lib/scrapers/p1.js` | `index.html` | `app.js` |
| Platform 2 | `/rb` | ruangbokep.ws | HLS (m3u8) | `lib/scrapers/rb.js` | `rb.html` | `rb.js` |
| Platform 3 | `/yb` | yobokep.com | HLS (m3u8) | `lib/scrapers/yb.js` | `yb.html` | `yb.js` |
| Platform 4 | `/bk` | bokepking.cam | direct MP4 | `lib/scrapers/bk.js` | `bk.html` | `bk.js` |

Both delivery styles are proven reference implementations — copy whichever matches
the new source site instead of inventing a new pattern:
- **Direct MP4 sites** → copy Platform 4 (`lib/scrapers/bk.js` + `public/bk.html`/`bk.js`): simplest,
  no manifest rewriting needed.
- **HLS/m3u8 sites** → copy Platform 2 or 3 (`rb.js`/`yb.js`): manifest + segment
  proxy with self-healing CDN tokens.

`server.js` is a thin composition root — it only wires Helmet/CSP, CORS, rate
limiting, mounts each platform's router, and serves the SPA fallback. Shared,
stateless helpers live in `lib/cache.js` (`makeCache()` factory) and
`lib/proxy.js` (UA string, `apiError()`, axios instances, `resolveUrl()`,
`basenameNoQuery()`) — these are the **only** files a new platform module may
import from. Never import one scraper module from another.

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
  and highlight the active platform. Update all four (soon five) HTML files
  together so the drawer always lists every platform.
- Add the new router to `server.js`'s mount list and to the CSP `script-src`
  domain allowlist if the new source's embeds/ads need a new external domain
  (CSP does **not** use a `https:` wildcard — every domain must be explicit).

### 2. Resolve the real media URL server-side only
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
- JS: `currentSlug`, `renderWatchDesc()`, `renderRelated()`/
  `renderRelatedPage()`/`renderRelatedPagination()` (8 items/page,
  client-side), `openPlayer(slug, opts)` accepting `opts.fromHistory`.
- **History/URL**: `openModal(slug)` pushes/replaces `/pN/watch/<slug>` so the
  address bar is a shareable deep link — it must be **idempotent** (no-op push
  if the modal is already open, e.g. clicking a related card; just
  `replaceState` to the new slug). `popstate` needs **three branches**: (1)
  modal open + Back → close modal, replace URL back to `/pN`; (2) Forward to a
  `{ pNModal, pNSlug }` state while modal is closed → reopen via
  `openPlayer(slug, { fromHistory: true })` without touching history again;
  (3) otherwise restore listing/search state. Missing branch (2) is a real bug
  class caught in review before — don't skip it.
- **Deep-link on load**: capture `location.pathname` for the
  `/pN/watch/<slug>` match **before** calling the initial `loadPosts()` —
  `loadPosts()` calls `saveNav()` which does `history.replaceState(...,
  '/pN')` and clobbers `location.pathname` if read afterward. Guard
  `decodeURIComponent` with try/catch.
- Share button: `navigator.share()` when available, fallback
  `navigator.clipboard.writeText()` + toast. Share URL is always
  `${origin}/pN/watch/<slug>`.
- No new backend route is needed for `/pN/watch/:slug` — the existing SPA
  wildcard route (`router.get('/pN/*', ...)`) already serves `pN.html`;
  confirm the equivalent wildcard exists in your new module.
- **Related-video scraping selector is site-specific — do not copy blindly.**
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

### 8. Verify before shipping
- Curl the new `/proxy/pN/hls/:slug` (or `/proxy/pN/seg` / `/proxy/pN/stream`)
  endpoint directly and inspect the CDN's signed URL params to confirm actual
  token TTL — don't assume "expired" means the token; it's usually a
  transient network/recovery gap.
- Curl `/api/pN/video/:slug` and confirm `description`/`related` are populated
  correctly against a real post page.
- Restart the workflow and manually play a video end-to-end after adding the
  platform, on both an existing cached entry and a freshly resolved one.
- Curl `/pN/watch/:slug` to confirm the SPA wildcard route serves the page
  (200), and screenshot the watch view to sanity-check title/description/
  related grid/share button/ad slot render.
- Run a code-review (architect) subagent pass with `includeGitDiff: true`
  before considering the platform done — pay special attention to the
  related-video selector's scoping accuracy against the real site markup.
