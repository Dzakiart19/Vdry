---
name: RB (Platform 2) watch view + related videos
description: How Platform 2's YouTube/XNXX-style watch view (title+description+related grid) is scraped and rendered, and history-modal gotcha to replicate carefully on P3/P4.
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
The existing player modal has a fragile pushState/replaceState mechanism to make
the browser Back button behave correctly (one `/rb#player` history entry per
modal session, replaced with a clean `/rb` on close — see `openModal`/`closeModal`
in `public/rb.js`). When adding an in-modal "related videos" grid where clicking a
related card re-invokes the same open-player function, **`openModal()` must be
idempotent** (no-op / no new `pushState` if the modal is already open), otherwise
every related-video click stacks a new history entry and breaks Back/Forward.
Apply the same idempotent-openModal fix when building the watch view for yb/bk.
