---
name: Vidorey Caching Strategy
description: All in-memory caches: structure, TTLs, eviction, sentinel values
---

# Caching Strategy — server.js

## makeCache helper (generic)
All caches use makeCache(maxSize, defaultTtlMs) which returns {get, set, del, has}.
set() accepts optional 3rd arg ttlMs to override default TTL per-entry.
del(key) allows explicit eviction (used for stale CDN URL recovery).

## videoUrlCache — Platform 1 MP4 URLs
- Stores: {src, title, thumb} payload (full metadata, not just URL)
- TTL: 5 min | Max: 300 entries
- Set by: /api/video/:id after embed.php resolve
- Read by: /proxy/stream/:id (avoids double embed.php fetch)
- Eviction: /proxy/stream/:id calls resolveP1Mp4(evictFirst=true) if CDN returns 403/404

**Why:** embed.php was being called twice per stream play — once in /api/video/:id, once in /proxy/stream/:id. Also: CDN URLs expire, so evict-on-4xx + re-resolve prevents stuck stale entries.

## m3u8Cache — Platform 2 HLS URLs
- Stores: resolved m3u8 URL string (via makeCache, returned directly by .get())
- TTL: 5 min | Max: 500 entries
- Shim: m3u8CacheSet(slug, url) wraps m3u8Cache.set(slug, url) for backward compat

## postsCache — Platform 2 post listings
- Key: "page:cat:q"
- TTL: 3 min (normal), 30s (empty result or 404), 20s (_error sentinel)
- Sentinel values in cached object:
  - {_error: true} → cache check returns 502 (not served as data)
  - {_status: 404} → cache check returns 404 (not served as 200 empty)
- Empty pages cached at 30s to throttle upstream hammering
- Warning log when posts.length===0 AND upstream has <article> elements (true selector break, not empty page)

**Why:** Without short negative cache, repeated requests to failing/empty pages hammer upstream continuously with no throttle.
