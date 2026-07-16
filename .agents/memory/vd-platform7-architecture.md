---
name: VD Platform 7 Architecture
description: videy.design scraping, direct MP4 proxy, HTML card structure quirk, no search/categories.
---

## Platform VD — videy.design (Vidorey 7)

**Code:** `vd` | **URL:** `/vd` | **UI name:** Vidorey 7

### Source site
- PHP server-rendered site (Cloudflare CDN)
- Listing: `GET /?page=N&sort=terbaru` → ~51 videos/page
- Watch: `GET /watch.php?id=N` → HTML parse for MP4/thumb/title/related
- **No search** — site has no search API or form parameter
- **No categories** — site has no category filter
- MP4 URL pattern: `https://videy.design/uploads/videos/vid_{ts}_{hash}.mp4`
- Thumb URL pattern: `https://videy.design/uploads/thumbnails/thumb_{ts}_{hash}.jpg`
- **No hotlink protection** — MP4/thumb accessible from any server without Referer
- URLs are permanent (no signed tokens, no TTL expiry) → no self-healing needed

### Critical card HTML structure quirk
The `<a href="watch.php?id=N">` wraps ONLY the thumbnail, NOT the title.
Title is in `.video-info > .video-title` which is a **sibling** of `<a>`, both inside `.video-card`.

```html
<div class="video-card">
    <a href="watch.php?id=4579">              ← wraps only thumbnail
        <div class="video-thumbnail">
            <img src="uploads/thumbnails/..." alt="Di dapur" loading="lazy">
        </div>
    </a>
    <div class="video-info">                  ← sibling, NOT inside <a>
        <div class="video-title">Di dapur</div>
    </div>
</div>
```

**Fix:** Use `$('.video-card')` as root selector. Then find `a[href*="watch.php?id="]` within it for ID/img, and `.video-title` within the card for title.

**Why:** `$('a[href*="watch.php?id="]').find('.video-title')` always returns empty because `.video-title` is outside the `<a>` tag.

### Watch page parsing
- MP4: `$('source[type="video/mp4"]').attr('src')` — relative URL, prepend VD_BASE
- Thumb: `$('video#videoPlayer').attr('poster')` — relative URL, prepend VD_BASE
- Title: `$('h1.video-title').text()`
- Related: `$('a.related-video-link[href*="watch.php?id="]')` → thumb from `.related-thumbnail` `style` background-image URL, title from `.related-title` text

### Pagination
- `totalPages = posts.length >= 20 ? page + 50 : page`  (site has no total page count in HTML)

### CDN allowlist
Only `videy.design` hostname — no secondary CDN domains observed.

### Stream proxy
- Range support: HTTP 206 confirmed working
- Self-healing evict: on 403/404 from CDN (unlikely since URLs are permanent)

### Files added/changed
Backend: `lib/scrapers/vd.js`
Frontend: `public/vd.html`, `public/vd.js`
Config: `server.js` (require+mount+cacheStats+shortlink), `lib/monitor.js` (trackRequest+badge CSS), `public/style.css` (ps-avatar-vd), `firebase.json`, `public/sitemap.xml`
Nav drawer: all 7 existing HTML files updated (index, rb, yb, bk, sb, xn, tp)
