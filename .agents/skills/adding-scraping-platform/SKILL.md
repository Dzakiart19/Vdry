---
name: adding-scraping-platform
description: Add a new scraping platform (Platform N) to Vidorey following the Platform 1 (xpvid.cc) direct-proxy pattern, so video streams never expose raw CDN tokens to the client and never show "stream expired" errors. Use when the user asks to add a new video source/platform, integrate a new site, or wants a new platform to behave reliably like Platform 1.
---

# Adding a New Scraping Platform to Vidorey

Vidorey has two platforms today: Platform 1 (`xpvid.cc`, direct MP4) and Platform 2
(`ruangbokep.ws`, HLS). Platform 1's video delivery pattern is the **reference
implementation** because it never suffers from "stream expired" errors — always copy
it for new platforms, not Platform 2's original (pre-fix) pattern.

## Why Platform 1's pattern is the standard

The root cause of "stream expired" bugs is **exposing a CDN's raw, time-limited
signed URL/token directly to the browser** and/or **giving up immediately on the
first transient error** instead of retrying. Platform 1 avoids both:

1. The browser NEVER sees the real CDN URL — it always requests
   `/proxy/stream/:id` from our own backend. The backend resolves the real URL
   server-side and streams the bytes through itself.
2. If the CDN rejects the cached URL (403/404 — token expired), the backend
   evicts the cache entry, re-resolves a fresh URL from the source site, and
   retries **once** automatically before failing. The user never sees an error
   for a routine token refresh.
3. Any proxy that talks to a flaky third-party CDN wraps the request in a retry
   helper (2–3 attempts, exponential backoff) that only retries on network
   errors (ECONNRESET/timeout), never on real HTTP 4xx from the CDN.

Platform 2 originally skipped steps 2 and 3 for its HLS proxy and its player had
no fatal-error recovery — a single transient network blip during real production
traffic (not visible during casual local testing) killed playback entirely.
Both were fixed after the fact — a new platform should ship with this built in
from day one instead of retrofitting it later.

## Checklist for Platform N

### 1. Full isolation (non-negotiable project rule)
Per `replit.md`: **every platform must be completely isolated** — no shared
state, cache, or logic that leaks between platforms.
- New route prefix, e.g. `/p3` (mirrors `/rb` for Platform 2).
- New static page: `public/p3.html`, own JS: `public/p3.js`. Do not import or
  reuse another platform's JS file — small utility duplication (fetch timeout,
  HTML escaping, toast, pagination) is the accepted tradeoff for isolation; copy
  the pattern, don't share the module.
- New backend route namespace: `/api/p3/...`, `/proxy/p3/...`. New dedicated
  in-memory caches via `makeCache()` — never reuse another platform's cache map.
- Add the platform to the topbar platform-switcher menu in `index.html` and
  `rb.html` (and the new `p3.html`) so users can navigate between all platforms.

### 2. Resolve the real media URL server-side only
- Scrape/resolve the actual CDN URL (MP4 or m3u8) inside an Express route
  handler using `cheerio`/`axios` — never send this URL to the browser.
- Cache the resolved URL with `makeCache(maxSize, ttlMs)`, TTL matched to how
  long the source site's token realistically stays valid (inspect the token's
  query params — e.g. `e=` duration/expiry seen on streamruby URLs — don't
  guess; verify with a real curl request through the backend, as done for
  Platform 2's `e=32400` token).

### 3. Client always calls your backend proxy, never the CDN
- Direct file (MP4-like): mirror `/proxy/stream/:id` — supports HTTP `Range`,
  sets `Referer`/`User-Agent` matching what the source CDN expects, streams via
  `stream.pipeline`.
- Segmented (HLS-like): mirror `/proxy/rb/hls/:slug` + `/proxy/rb/seg` —
  rewrite every URL in the manifest (including `URI="..."` attributes and
  sub-manifests) to point back at your own `/proxy/p3/seg?url=...`, so the
  browser only ever talks to your backend.
- Enforce a strict host allowlist (`Set` of hostnames or hostname-suffix check)
  for whatever CDN domain(s) the new platform's videos live on. Reject
  everything else with 400, same as `isAllowedRbCdnUrl` / `THUMB_HOSTS`.

### 4. Auto-recover from expired tokens — don't just error out
- **Backend**: wrap every CDN network call (manifest fetch, segment fetch,
  direct stream fetch) in a small retry helper (see `axSegmentGet` /
  `axRbGet` in `server.js`) — 2–3 retries with backoff, but only on network
  errors, never on real 4xx from the CDN (those need a fresh resolve, not a
  retry).
- **Backend, direct-file case**: on CDN 403/404, delete the cached URL,
  re-resolve once, retry the request — copy the eviction pattern used in
  `/proxy/stream/:id`.
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

### 6. Verify before shipping
- Curl the new `/proxy/pN/hls/:slug` (or `/proxy/pN/seg`) endpoint directly and
  inspect the CDN's signed URL params to confirm actual token TTL — don't
  assume "expired" means the token; it's usually a transient network/recovery
  gap (as it was for Platform 2).
- Restart the workflow and manually play a video end-to-end after adding the
  platform, on both an existing cached entry and a freshly resolved one.
