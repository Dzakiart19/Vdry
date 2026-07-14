---
name: Platform 6 SB Architecture
description: situsbokep.cc — WP HTML scrape → xvideos embedframe → HLS; selector pitfalls, CDN domains, thumbnail allowlist; kategori endpoint native WP.
---

# Platform 6 (SB) — situsbokep.cc

## Chain
`situsbokep.cc` (WP site) → `/view/[slug]` → `meta[itemprop="embedURL"]` → `x.fbplay.vip/embed/…xvideos.com/embedframe/[xv_id]` → `html5player.setVideoHLS('url')` → `*.xvideos-cdn.com` HLS

## Critical Selector Fixes (learned from debug)
- Article selector: **`article.thumb-block, article.loop-video`** (loop-video is the primary class)
- Anchor link: **`a[href*="/view/"]`** NOT `/watch/` (links are `/view/[slug]`)
- Anchor link is **absolute URL** (`https://situsbokep.cc/view/[slug]`) — regex must match `/view/([^/?#]+)`
- Thumbnail: **`img[data-src]`** (lazy loading), filter `loading.gif` and `data:image` placeholders
- Title: **`a[title]`** attribute (NOT from separate `<h2>` or `<p>`)
- Pagination: also absolute URLs `https://situsbokep.cc/page/N/` — grep all `a[href]` for `/page/(\d+)/`

## CDN Allowlist
- HLS segments: `*.xvideos-cdn.com` (confirmed `hls-cdn77.xvideos-cdn.com`)
- Also allow `*.xnxx-cdn.com` as fallback
- Thumbnail domains: `situsbokep.cc` (wp-content/uploads), `.imserverx1.online`, `.imserverx2.online`, `.lotnok.com`, `*.xvideos-cdn.com`

## Listing
- URL pattern: `https://situsbokep.cc/` (page 1), `https://situsbokep.cc/page/N/` (N>1)
- Search: `https://situsbokep.cc/?s=QUERY` or `https://situsbokep.cc/page/N/?s=QUERY`
- Category: `https://situsbokep.cc/bokep/[cat-slug]/page/N/`
- ~40 posts per page, ~1381 total pages, ~55k+ posts

## Token TTL
xvideos CDN tokens valid ~1 year (timestamp embedded in URL `,...,1783946866,...`). Self-healing is implemented but rarely needed.

## Cache Keys
- `sb_posts`: 3 min — listing per `page:cat:query`
- `sb_m3u8`: 8 hr — m3u8 URL per slug
- `sb_video`: 4 hr — full video payload per slug (incl. `_xvId` for self-healing)
- `sb_fresh`: 1 min — freshly resolved m3u8 per slug (anti-stampede)
- `sb_categories`: 1 hr — native `wp-json/wp/v2/categories` list, `/api/sb/categories` (added 2026-07-14)

**Why:** Token TTL is long so cache TTL can be generous. fresh cache prevents concurrent self-healing stampedes.

## Kategori (added 2026-07-14)
`sb` is WP-based so `wp-json/wp/v2/categories` works natively. Filtering already existed in `/api/sb/posts?cat=slug` (uses `${SB_BASE}/bokep/${cat}/page/${page}/` URL pattern) — only the categories-listing endpoint was missing and has been added.
