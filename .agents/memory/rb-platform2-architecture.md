---
name: Platform 2 (RuangBokep) Architecture
description: How video resolution and HLS playback work for Platform 2 — avoids ads from original embed service.
---

# Platform 2 — RuangBokep Architecture

## Video Resolution Flow (ad-free)
1. Client clicks video card → `/api/rb/video/:slug`
2. Server fetches `ruangbokep.ws/{slug}/` — extracts `meta[itemprop="embedURL"]` (putarvid.com URL)
3. `resolveRbVideoUrl()` fetches the putarvid embed page
4. `unpackPacker()` decodes the PackerJS obfuscation (SAFE — string replacements only, no eval of inner code)
5. Regex extracts the raw m3u8 URL from JWPlayer setup
6. Returns `{ m3u8Url }` to client — NO iframe, NO ads

## CDN Details
- Embed service: `putarvid.com` (strict allowlist: `hostname === 'putarvid.com' || endsWith('.putarvid.com')`)
- Stream CDN: `*.streamruby.net` — HLS m3u8 with `access-control-allow-origin: *`
- URLs are time-limited (signed tokens in query string, expire ~9h from issue)
- URL has unusual commas: `evsa12ge2w2o_,l,n,h,o,.urlset` — this is correct, commas are literal in the packed code after decode

## Client-side Player
- HLS.js from CDN: `cdn.jsdelivr.net/npm/hls.js@1`
- Uses `Hls.isSupported()` for Chrome/Firefox, native `<video>` for Safari
- Session guard (`playerSession` counter) prevents stale async responses from initiating playback after modal closes
- `destroyHls()` cleans up instance on close/new open

## Thumbnail Sources
- Thumbnails come from `ruangbokep.ws/wp-content/uploads/` (full resolution)
- Goes through `/proxy/rb/thumb?url=...` — allowlist includes `ruangbokep.ws`

**Why:** putarvid.com iframe embeds ads from external networks (alfalfaemployeeresource.com etc.). By decoding the packed JS we get the raw CDN URL and play it directly.
