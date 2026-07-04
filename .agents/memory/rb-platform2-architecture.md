---
name: Platform 2 (RuangBokep) Architecture
description: How video resolution, HLS proxying, and scraping work for Platform 2 — avoids ads and CDN IP-locking.
---

# Platform 2 — RuangBokep Architecture

## Video Resolution Flow (ad-free, fully proxied)
1. Client clicks video card → `apiFetch('/api/rb/video/:slug')`
2. Server fetches `ruangbokep.ws/{slug}/` — extracts `meta[itemprop="embedURL"]` (putarvid.com URL)
3. `resolveRbVideoUrl()` fetches the putarvid embed page
4. `unpackPacker()` decodes the PackerJS obfuscation (SAFE — string replacements only, no eval)
5. Regex extracts the raw m3u8 URL from JWPlayer setup
6. m3u8 URL is validated against `isAllowedRbCdnUrl()` and cached in `m3u8Cache` (5-min TTL, max 500 entries)
7. Returns `{ m3u8Url: '/proxy/rb/hls/:slug' }` — browser never touches CDN directly

## HLS Proxy (critical — CDN is IP-locked / signed URLs)
- CDN `streamruby.net` refuses browser-origin requests (signed token + IP check)
- `/proxy/rb/hls/:slug` — fetches master manifest, rewrites ALL URLs to `/proxy/rb/seg?url=...`
- `/proxy/rb/seg?url=` — proxies sub-manifests (rewrites again) and raw TS segments
- Uses `axSegment` (maxRedirects: 0) for segments to prevent redirect-based allowlist bypass

## CDN Details
- Embed service: `putarvid.com` (strict allowlist: `hostname === 'putarvid.com' || endsWith('.putarvid.com')`)
- Stream CDN: `*.streamruby.net` — HLS m3u8 with signed tokens in query string
- Allowlist in `isAllowedRbCdnUrl()`: putarvid.com, *.putarvid.com, *.streamruby.net, *.b-cdn.net, *.bunnycdn.com

## Scraping ruangbokep.ws — Critical Header Requirement
- **Must NOT send `Accept-Encoding: br` (brotli)** — axios cannot reliably decompress brotli responses
  → garbled HTML → cheerio parse fails → returns 0 posts / empty categories
- Use `Accept-Encoding: gzip, deflate` only in `rbHeaders`
- Must send `Accept: text/html,...` — without Accept header, Cloudflare/nginx returns 500

## Pagination (site-specific selector)
- Site uses `.pagination ul li a` NOT `a.page-numbers` (WordPress default)
- Total page count: extract from "Last" button href: `/page/{N}/`
- Fallback: max numeric page number from the same selector
- Category pages: `/{cat-slug}/` (not `/category/{cat-slug}/`), paginated as `/{cat-slug}/page/{n}/`

## Article / Video Slug Format
- Slugs include WordPress post ID: `talent-jeje-kacamata-suka-colmek-318766`
- Link is in `<a href="https://ruangbokep.ws/{slug}/">` inside `<article class="loop-video">`
- Thumbnail: prefer `article[data-main-thumb]` attribute (most reliable, pre-loaded)
- Fallback: `img.video-main-thumb[data-lazy-src]` (lazy-load placeholder, has real URL)

## Client-side Player (rb.js)
- HLS.js from CDN: `cdn.jsdelivr.net/npm/hls.js@1`
- Session guard (`playerSession` counter) prevents stale async responses after modal closes
- `destroyHls()` cleans up instance on close/new open
- Thumbnail URL: must use `${API}/proxy/rb/thumb?url=...` (not relative) for Firebase split-hosting

**Why HLS proxy:** putarvid/streamruby CDN uses IP-signed tokens — the m3u8 URL resolved server-side only works from server IP; browser direct access gets 403/expired immediately.
**Why gzip-only:** axios v1.x brotli decompression is unreliable on Replit's Node.js — silently returns garbage.
