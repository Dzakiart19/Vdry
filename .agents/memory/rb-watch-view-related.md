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
The player modal's URL scheme is `/rb/watch/<slug>` (pushed/replaced via
`history.pushState`/`replaceState` in `openModal()`), not a static hash marker —
this makes the address bar itself a shareable, deep-linkable link to that video.
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
- On init, capture `location.pathname` for the `/rb/watch/<slug>` deep-link
  match **before** calling the initial `loadPosts()` — `loadPosts()`
  synchronously calls `saveNav()` which does `history.replaceState(..., '/rb')`,
  which clobbers `location.pathname` if read afterward. Guard
  `decodeURIComponent` with try/catch (malformed `%` sequences throw).

## Share button
Watch-info title row has a "Bagikan" button: uses `navigator.share()` when
available (mobile), falls back to `navigator.clipboard.writeText()` + toast.
Share URL is always `${origin}/rb/watch/<slug>`. Apply the same idempotent-modal
+ popstate-branch fixes above when building this for yb/bk, since the share
feature is what makes the URL-based scheme necessary in the first place.

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
