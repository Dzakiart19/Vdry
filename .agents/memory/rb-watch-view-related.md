---
name: RB (Platform 2) watch view + related videos + share
description: How Platform 2's YouTube/XNXX-style watch view (title+description+related grid+share) is scraped, rendered, and deep-linked, plus the history-modal gotchas to replicate carefully on P3/P4.
---

## Source data
ruangbokep.ws post detail pages (`https://ruangbokep.ws/<slug>/`) render their own
"Related videos" widget server-side, inside a `.under-video-block` container whose
`<h2 class="widget-title">` text is "Related videos". Items use the exact same
`article.loop-video[data-main-thumb]` markup as the homepage/category listing grid
(slug from href, title from `img.video-main-thumb[alt]`, thumb from
`data-main-thumb`/`data-lazy-src`, duration from `.duration` text).
Per-post description is available via `meta[property="og:description"]` (distinct
per post, not just a site-wide default).

**Why this matters:** don't assume other platforms (yb/bk) have the same widget
class name (`under-video-block`) or the same `article.loop-video` markup — check
each source site's actual post-page HTML before reusing this exact selector
strategy. Always scope the related-item selector to the specific related-widget
container (filtered by its heading text) rather than a bare global selector, and
dedupe by slug — a global `article.loop-video` selector can accidentally pick up
cards from unrelated sidebar widgets if the target site's markup includes more
than one such widget.

## Modal/history gotcha (must replicate on P3/P4)
The player modal's URL scheme is `/rb/watch/<token>` (an 11-char shortlink) pushed
via `history.pushState`/`replaceState` in `openModal()`/`openPlayer()` — the
address bar is a shareable, deep-linkable link that does NOT reveal the video title.
History state always stores the **raw slug** (not the token), so popstate/Forward
works without re-resolving the token.
Rules that keep Back/Forward consistent (`public/rb.js`):
- `openModal(slug)` is **idempotent**: no-op if the modal is already open (e.g.
  clicking a related-video card while the watch view is showing) — it only
  `replaceState`s the URL to the new slug, never pushes a second entry.
- `popstate` has three branches: (1) modal open + Back → close modal, replace
  URL back to `/rb`; (2) landed on a `{ rbModal, rbSlug }` state via Forward
  while modal is closed → reopen the modal for that slug via
  `openPlayer(slug, { fromHistory: true })`, which must skip re-touching history
  since the entry already exists; (3) otherwise restore listing/search state.
  Missing branch (2) was a real bug caught by review — Forward navigation left
  the URL saying `/rb/watch/<slug>` while the modal stayed closed.
- Server side: the SPA wildcard route (`router.get('/rb/*', ...)` in
  `lib/scrapers/rb.js`) already serves `rb.html` for `/rb/watch/<slug>` with no
  new backend route needed — confirm the equivalent wildcard exists for
  yb/bk before assuming this works there too.
- On init, capture `location.pathname` for the `/rb/watch/<segment>` deep-link
  match **before** calling the initial `loadPosts()` — `loadPosts()`
  synchronously calls `saveNav()` which does `history.replaceState(..., '/rb')`,
  which clobbers `location.pathname` if read afterward. Then check: if segment
  is exactly 11 alnum chars → token path (async resolve); else → `decodeSlug`
  legacy path. No try/catch needed on the token path — `decodeSlug` has its own
  try/catch internally.

## Share button + Short URL (11-char token)
Watch-info title row has a "Bagikan" button: `navigator.share()` on mobile,
fallback `navigator.clipboard.writeText()` + toast. Share URL is
`${origin}/rb/watch/<currentToken || encodeSlug(currentSlug)>` — always the
short 11-char token once the video has loaded, base64url fallback before that.

### Short token flow (all three platforms — rb/yb/bk)
URL in the address bar is a **short 11-char random token**, not the video slug.
The slug is never exposed in the URL bar or share link.

1. `encodeSlug(s)` / `decodeSlug(t)` — UTF-8-safe base64url helpers defined at
   the top of each platform's JS IIFE. Used as a temporary URL while the video
   info loads, and as a backward-compat fallback for old shared links.

2. `let currentToken = null;` — declared alongside `currentSlug`.

3. `openModal(slug)` pushes `/rb/watch/<encodeSlug(slug)>` immediately (so the
   address bar updates before the API call returns). State still stores raw slug:
   `history.pushState({ rbModal: true, rbSlug: slug }, '', url)`.

4. In `openPlayer(slug)`, reset `currentToken = null` at the top. After
   `apiFetch('/api/rb/video/:slug')` resolves:
   ```js
   if (data.token) {
     currentToken = data.token;
     history.replaceState({ rbModal: true, rbSlug: slug }, '', `/rb/watch/${data.token}`);
   }
   ```
   Server returns `token` because `registerSlug('rb', slug)` is called inside
   the scraper's video endpoint and included in the `res.json(...)` response.

5. `closeModal()` and the Back-while-open popstate branch both reset
   `currentToken = null` alongside `currentSlug = null`.

6. **Deep-link on load** — two cases:
   - Segment matches `/^[a-z0-9]{11}$/` → short token: call
     `apiFetch('/api/s/rb/<token>')` to resolve slug, then `openPlayer(slug)`.
   - Anything else → legacy: `decodeSlug(segment)` (base64url) → `openPlayer`.

7. **Server side**: `lib/shortlink.js` — `registerSlug(platform, slug)` returns
   idempotent 11-char token (same slug → same token until 48h TTL expires).
   `resolveToken(platform, token)` → slug. Route `/api/s/:platform/:token` in
   `server.js` does the lookup. No DB needed — pure in-memory cache.
   Token registry is lost on server restart; deep-links from before the restart
   fall through to a 404 response and the deep-link is silently ignored.

## P3 (yb) and P4 (bk) replication — actual markup found, confirms the warning above
Both were replicated successfully using the exact same modal/history/share JS
pattern (openModal idempotency, 3-branch popstate, pre-loadPosts deep-link
capture) — that part is copy-paste safe. The related-video **scraping selector**
differed per site as warned:
- **yb (yobokep.com)**: reuses `article.loop-video[data-main-thumb]` like rb, but
  the container heading text must be checked explicitly — code review initially
  flagged the first attempt as too permissive (accepted any `.under-video-block`
  even without a matching heading). Fix: require the block's direct
  `.widget-title` to contain "related video" (no fallback), and scope items to
  `> div > article.loop-video[data-main-thumb]` only.
- **bk (bokepking.cam)**: totally different markup —
  `.under-video-block > .videos-list > article[id^="post-"]`, no distinguishing
  heading (only one such block on the page, so container alone is sufficient
  scope). Thumbnail is lazy-loaded: the real URL is in `img[data-src]`, not
  `src` (which holds a placeholder). Title in `.title` span, duration in
  `.duration` div text (has an inline `style` attr but `.text()` only reads text
  nodes so it's unaffected). Description: multiple meta tags exist
  (`og:description`, `itemprop="description"`, `name="description"`) — prefer
  `og:description` first for consistency with rb/yb, other two as fallback.
**Lesson confirmed:** always curl the real post-page HTML per platform before
writing the related-selector; never assume the previous platform's exact class
names/heading text carry over.

## P1 (index.html) — Full-page watch view (berbeda dari P2/P3/P4)

P1 juga pakai `modal-fullpage` watch view yang sama (topbar Kembali, watch-layout,
watch-main, watch-related sidebar), tapi dengan perbedaan arsitektur yang penting:

- **Video**: MP4 via `/proxy/stream/:id` — native `<video>`, tanpa hls.js.
  Show loader → `loadedmetadata` event → tampilkan `p1VideoEl`.
- **Related**: diambil dari `currentData.videos` (data folder yang sudah ada di memori),
  bukan dari API/scraping. Filter excludes video yang sedang diputar.
  Tidak ada "per-video related endpoint" di backend P1.
- **URL**: `/watch/:id` (bukan `/rb/watch/<token>`). ID langsung, tidak ada shortlink token.
- **Deep-link**: server catch-all `app.get('*')` serve `index.html` → init check
  `location.pathname.match(/^\/watch\/([a-z0-9]+)$/)` → `openPlayer(vid, '', { fromHistory: true })`.
- **Idempotency + popstate**: sama — `_openModal(id)` no-op jika modal sudah terbuka
  (hanya replaceState URL), popstate 3-branch identik dengan P2.
- **Share**: URL `${origin}/watch/${currentVideoId}` — tidak pakai token.

Lihat `p1-crossorigin-video.md` untuk detail lengkap (HTML IDs, el object, player flow).
