---
name: Platform 2 Architecture (RB)
description: ruangbokep.ws proxy via HLS — video resolution, PackerJS, caching, self-healing CDN token
---

# Platform 2 (ruangbokep.ws) — Architecture

## Video Resolution Flow
1. GET `/api/rb/posts` → scrape HTML listing (`article.loop-video[data-main-thumb]`) untuk thumbnail + slug + title; pagination dari `.pagination ul li a`
2. GET `/api/rb/video/:slug`:
   - **Cache check first**: `rbVideoCache` (TTL 30 min, max 300) — hit returns <1ms with fresh token
   - Scrape ruangbokep.ws/{slug}/ untuk putarvid iframe embed URL
   - **m3u8Cache fast-path**: jika `m3u8Cache` punya URL valid untuk slug ini, skip putarvid fetch
   - `resolveRbVideoUrl(embedUrl)` → GET putarvid.com embed page → `unpackPacker()` → extract `.m3u8` URL
   - Cache successful response di `rbVideoCache` (tanpa token — token selalu fresh dari registerSlug)
   - Error sentinels cached singkat (404 → 60s, 502 → 20s) mencegah upstream hammering
3. `m3u8Cache` stores resolved URL (TTL 5 min, max 500)
4. Returns `/proxy/rb/hls/{slug}` — browser tidak pernah touch CDN langsung
5. Fallback: jika m3u8 extraction gagal, return embedUrl HANYA jika hostname = `putarvid.com` (strict allowlist)

**WHY rbVideoCache:** P2 butuh 2 network requests (ruangbokep.ws + putarvid.com) vs P4 yang hanya 1. Client timeout 15s bisa terjadi sebelum token di-set. Cache memastikan respons warm (<1ms) → token selalu ada.

## HLS Proxy Chain
- `/proxy/rb/hls/:slug` → fetch master.m3u8 → `rewriteM3u8()` rewrite semua URL ke `/proxy/rb/seg?url=&_s={slug}`
- `/proxy/rb/seg?url=` → sub-manifest (.m3u8): rewrite rekursif; segment (.ts/.aac/.key): `stream.pipeline()` binary
- CDN allowlist: `putarvid.com`, `*.putarvid.com`, `*.streamruby.net`, `*.b-cdn.net`, `*.bunnycdn.com`
- Semua HLS routes cek upstream status ≥ 200 < 300 sebelum kirim ke client

## PackerJS Decoder
- `unpackPacker(html)`: regex dianchor ke `}(` (closing brace IIFE body) — tanpa ini, `(` di dalam packed string bisa match dan gagal
- Returns null on mismatch → fallback ke embedUrl (dengan iklan, user tetap bisa nonton)
- Safe: pure string replacement, no eval()

## m3u8 Regex di resolveRbVideoUrl
```js
const m = decoded.match(/file:["'](https?:\/\/[^"']+\.m3u8[^"']*)/);
```
Support single- dan double-quote (beberapa versi putarvid berbeda).

## CORS (CDN segments)
- CDN has CORS `*`; semua `/proxy/rb/*` responses set `Access-Control-Allow-Origin: *`
- `axRb` pakai `keepAlive: false` — mencegah ECONNRESET dari WordPress menutup keep-alive socket

## Scraper Alert Pattern
- Warning log `[scraper-alert]` muncul ketika HTML listing punya `<article>` tapi 0 posts di-parse
- Membedakan genuine empty page dari broken selector

## Self-Healing CDN Tokens

putarvid/streamruby CDN token dikunci ke IP server yang me-resolve (`i=` param). Di autoscale (free tier), setiap request bisa ke instance berbeda dengan IP berbeda.

**Mekanisme:**
- Setiap URL segment/manifest diberi `&_s={slug}` (slug hint)
- Ketika `/proxy/rb/seg` dapat non-2xx (401/403/5xx): panggil `reresolveUrl(slug, targetUrl, forceNew=true)`
- `reresolveUrl` re-fetch master m3u8 fresh dari instance saat ini, cocokkan URL by **filename** (bukan by token), retry sekali
- `freshSessionCache` (TTL 20 detik) mencegah flood: banyak segment gagal berurutan hanya trigger 1 re-fetch

**`handleRbSeg(raw, slugHint, req, res, isRetry)`** adalah plain function (bukan route handler) agar bisa rekursi untuk one-shot retry. Selalu pass `req` eksplisit.

## CRITICAL: Force IPv4 (autoscale production fix)

**Symptom:** Di Replit **autoscale** deployment, SETIAP request manifest/segment di-reject CDN dengan 403, bahkan token yang baru di-resolve.

**Root cause:** Container autoscale punya dual-stack (IPv4+IPv6) egress. Request ke putarvid.com lewat IPv6 → putarvid bake alamat IP garbled/invalid ke token `i=` (terlihat seperti `i=0.2` bukan `i=35.234...`). CDN selalu reject.

**Fix:** `family: 4` di `https.Agent` pada semua axios instance yang talk ke putarvid/CDN (`axRb` dan `axSegment`).

**Diagnosis:** Kalau P2 video gagal di production tapi OK di dev, cek nilai `i=` di CDN URL. Nilai pendek/nonsensical (`0.2`) = IPv6 egress bug, bukan stale token. Jangan buang waktu tune self-healing — verifikasi `family: 4` masih ada.
