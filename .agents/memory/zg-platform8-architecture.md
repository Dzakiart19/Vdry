---
name: ZG Platform 8 Architecture
description: zoig.com (Vidorey 8) — amateur video site, direct MP4 proxy, signed token self-healing, X-Forwarded-For bypass.
---

## Platform ZG — zoig.com (Vidorey 8)

- **URL prefix**: `/zg`
- **UI name**: Vidorey 8
- **Slug**: numeric video ID (e.g., `14851439`)
- **Files**: `lib/scrapers/zg.js`, `public/zg.html`, `public/zg.js`

## Architecture

### Access bypass
- zoig.com blocks datacenter IPs via Apache — HTTP 403 without header
- **Fix**: `X-Forwarded-For: 98.139.180.149` (residential IP spoof) in axZg instance headers
- Apache trusts X-Forwarded-For blindly (server-side misconfiguration)

### Listing
- URL page 1: `https://www.zoig.com/amateur-videos1.html`
- URL page 2+: `https://www.zoig.com/amateur-videos/tr-week-{N}` (N=2,3…)
  - ⚠️ `amateur-videos{N}.html` (N>1) redirect ke halaman yang sama dengan page 1 — JANGAN dipakai
- Card selector: `a.thumbnailz[href*="/play/"]`; href adalah **full URL** (bukan path relative)
- Title: `title` attribute on `<a>`, fallback `alt` on `<img>`
- Thumbnail: `img.src` → `cdn-o9.zoig1.com/thumb/180x135/{hash}/{code}.jpg`
- No duration available in listing cards
- Total pages: parse dari `.browse_pagination a[href*="tr-week-"]`, ambil angka terbesar (biasanya ~17)

### Video page
- URL: `https://www.zoig.com/play/{id}`
- MP4: `<source src="https://zoigvids.zoigg.com/preview/{token}/{ts}/path.mp4" type="video/mp4">`
- **Token changes every request** (time-limited signed URL) → must self-heal
- Poster/thumbnail: `poster="..."` attribute (regex from raw HTML, CDN: `cdn-o9.zoig1.com/upd/video_new/...`)
- Duration: first `\b\d{1,2}:\d{2}\b` regex match in HTML
- Title: `<meta property="og:title">` or `<title>`, strip " - ZOIG.COM..." suffix
- Related: `ul.browse.related a.thumbnail[href*="/play/"]` → thumb 150x150, title from `title` attr

### CDN
- MP4: `zoigvids.zoigg.com` — Range OK (Accept-Ranges: bytes), HTTP 200 without Referer restriction
- Thumb: `cdn-o9.zoig1.com` — stable, no hotlink protection

### Self-healing stream proxy
- `zgVideoCache` TTL: 8 minutes (token expires before that → OK because stream proxy self-heals)
- On 403/404 from CDN: `resolveZgVideo(id, true)` evicts cache + re-scrapes `/play/{id}` for fresh token
- Pattern identical to xn.js / rb.js

### Caches
- `zg_posts`: 5 min, max 200
- `zg_video`: 8 min, max 300 (short TTL due to signed token)
- `zg_thumb`: 24 hr, max 500

## Why short video cache TTL?
The signed MP4 URL token changes each request to zoig.com/play/{id}. If cached for too long,
the stored token will be expired. The 8-min cache is a balance — avoids re-scraping on every
stream request while keeping self-heal infrequent. The stream proxy's evict+retry handles any
stale token transparently.
