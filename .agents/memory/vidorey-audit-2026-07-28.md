---
name: Vidorey full audit findings (2026-07-28)
description: Known-broken upstream embed providers on P3 (yb) and P6/P7 (sb) discovered during a full-project audit; check before assuming these platforms are healthy.
---

## P3 (yobokep.com / yb.js) — playmogo.com provider unresolvable
yobokep.com started serving some posts via a third embed provider, `playmogo.com/e/{code}`
(previously only `bysezejataos.com` and `streamhls.to` were handled). `isEmbedUrl()` in
`fetchYbEmbedInfo` doesn't recognize it, so `embedUrl` comes back empty and the API returns
"Player tidak ditemukan di halaman ini". Sampled ~42% of recent posts hit this path.

**Investigated and found not easily fixable:** even with correct browser-like headers +
Referer, `playmogo.com/e/{code}` (Cloudflare-fronted) consistently returns "The resource you
are looking for has been removed or is temporarily unavailable" for every code tested (4/4).
This looks like bot/anti-scraping protection rather than a simple selector fix — a plain
axios/cheerio fetch cannot get past it. Would need real browser automation (Playwright/Puppeteer)
to confirm if it's fixable at all, which is a much bigger lift than the other providers.

**Why this matters:** don't assume "add playmogo to isEmbedUrl allowlist" is a quick fix —
verify the resource actually resolves before spending time wiring it into resolveYbVideoUrl().

## P6/P7 (situsbokep.cc / sb.js) — xvideos embed migrated to native fbplay.vip player
situsbokep.cc used to embed `xvideos.com/embedframe/{id}` (sometimes proxied through
`fbplay.vip/embed/https://www.xvideos.com/embedframe/{id}`). Newer posts now embed a
**native** fbplay.vip player instead: `db.fbplay.vip/embed/video/{hash}` — no xvideos.com
substring at all, so `extractXvId()`'s regex (`xvideos\.com\/embedframe\/`) never matches →
"Sumber video tidak didukung". Sampled ~83% of recent posts hit this path (only old
xvideos-backed posts still work).

**Investigated the native fbplay.vip player and found it unsafe to "just fix":**
- The embed HTML contains an inline `playlistUrl = 'https://zz.fbplay.vip/api/stream/{id}/playlist.m3u8'` that *is* fetchable without auth.
- But the manifest's actual media segment for at least one sampled video pointed to a
  `tiktokcdn.com` **ad creative image URL** disguised as a `.ts` segment — i.e. this provider
  appears to inject ad content into the stream, not just host real video.
- Other sampled fbplay.vip embeds returned `<title>Video Processing</title>` with no
  playlistUrl at all (video still transcoding / never finished).
- Given the no-source-ads rule (never let ad content flow to the client as if it were the
  video), wiring this provider in as-is would risk serving ads as "video playback" — needs
  explicit user sign-off before attempting, not a routine scraper patch.

**Why this matters:** if situsbokep.cc keeps migrating more posts to fbplay.vip, the whole P6/P7
platform degrades further over time; this is a source-side change, not a proxy/token bug.
