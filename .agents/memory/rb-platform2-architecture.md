---
name: Platform 2 Architecture (RB)
description: ruangbokep.ws proxy via HLS — video resolution, caching, and proxy routing
---

# Platform 2 (ruangbokep.ws) — Architecture

## Video Resolution Flow
1. GET /api/rb/video/:slug → scrape ruangbokep.ws/{slug}/ for putarvid iframe
2. resolveRbVideoUrl(embedUrl) → GET putarvid.com embed → unpackPacker() → extract .m3u8 URL
3. m3u8Cache stores resolved URL (TTL 5 min, max 500)
4. Returns /proxy/rb/hls/{slug} — browser never touches CDN directly
5. Fallback: if m3u8 extraction fails, return embedUrl ONLY if hostname is putarvid.com (strict allowlist enforced server-side)

## HLS Proxy Chain
- /proxy/rb/hls/:slug → fetch master.m3u8 → rewriteM3u8() rewrites all URLs to /proxy/rb/seg?url=
- /proxy/rb/seg?url= → if sub-manifest (.m3u8): rewrite recursively; if segment (.ts/.aac/.key): pipe binary
- CDN allowlist: putarvid.com, *.putarvid.com, *.streamruby.net, *.b-cdn.net, *.bunnycdn.com
- Both HLS routes check upstream status ≥ 200 < 300 before sending content to client

## PackerJS Decoder
- unpackPacker(html): regex anchored to `}(` to decode Dean Edwards Packer v2 only
- Returns null on mismatch → fallback to embedUrl (with ads, user still sees video)
- Safe: pure string replacement, no eval()

## CORS (CDN segments)
- CDN has CORS *; all /proxy/rb/* responses set Access-Control-Allow-Origin: *
- axRb instance uses keepAlive:false — prevents ECONNRESET from WordPress closing keep-alive sockets

## Scraper Detection
- Warning log `[scraper-alert]` fires when upstream HTML has <article> elements but 0 posts parsed
- This distinguishes genuine empty pages from broken selectors

## Self-Healing CDN Tokens (autoscale instance-hop workaround)
- putarvid/streamruby CDN tokens are locked to the resolving server's egress IP (`i=` param). On autoscale (free tier, no VM/sticky-IP option), each HTTP request can land on a different instance with a different IP, so a token baked in by one instance can be rejected by the CDN when a later request (e.g. segment fetch) is served by another instance.
- Fix: every proxied m3u8/segment URL carries `&_s={slug}`. When `/proxy/rb/seg` gets a non-2xx (401/403/5xx) from the CDN, it re-resolves a **fresh** master m3u8 from the *current* instance, matches the failing URL by filename (not by query token) against the new master/sub-playlists, and retries once with the newly matched URL.
- `handleRbSeg(raw, slugHint, req, res, isRetry)` is a plain function (not a route handler) so it can recurse for the one-shot retry — call sites must always pass `req` explicitly (easy to forget since it's not an Express middleware signature).
- **Why:** avoids needing a VM/reserved-IP deployment just to keep CDN tokens valid across autoscale instances.
- Note: this alone did NOT fix the production 100%-failure case below — instance-hop token mismatch and the IPv6 egress bug are two separate, stackable causes of the same symptom (CDN 403 on stream).

## CRITICAL: Force IPv4 on all outbound axios calls to putarvid/streamruby
- Symptom: on Replit **autoscale** deployments (not dev, not necessarily VM), every single manifest/segment request gets rejected by the CDN with `403 Forbidden`, even on the very first attempt with a freshly-resolved token (so it's NOT the instance-hop issue above).
- Root cause: autoscale containers have dual-stack (IPv4+IPv6) egress. When the outbound request to putarvid.com went out over IPv6, putarvid's IP-detection logic embedded a garbled/invalid address into the CDN token's `i=` param (observed literally as `i=0.2`, vs. a real address like `i=35.234...` that works). The CDN then always rejects because the real requesting IP never matches that garbage value.
- Fix: force IPv4 by adding `family: 4` to the `https.Agent` used by any axios instance that talks to putarvid.com or the CDN (streamruby/b-cdn/bunnycdn) — i.e. `axRb` (embed page fetch) and `axSegment` (manifest/segment fetch) in `server.js`. After this, `i=` shows a valid public IPv4 prefix and streaming works on autoscale.
- **Why this matters for future debugging:** if RB/Platform 2 video breaks again specifically in production/autoscale (works in dev, fails deployed) with CDN 403s, check the `i=` param in the CDN URL first — a nonsensical short value like `0.2` is the signature of this exact IPv6 egress bug, not a caching/token-staleness problem. Don't waste time re-tuning the self-healing retry logic for this case; verify `family: 4` is still present on the relevant `https.Agent`s instead.
