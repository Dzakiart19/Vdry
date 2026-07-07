---
name: Platform 1 Cross-Origin Video Playback
description: How to correctly serve cross-origin video from Replit backend to Firebase frontend, and the DoodStream CDN allowlist fix.
---

# Platform 1 — Cross-Origin Video Playback

## Rule: NEVER use `crossorigin` attribute on `<video>`

The `<video>` element in `index.html` must NOT have a `crossorigin` attribute (not even `crossorigin="anonymous"`).

**Why:** `crossorigin="anonymous"` forces CORS mode on the video request. Even with correct `Access-Control-Allow-Origin` headers, Android Chrome blocks cross-origin video in CORS mode in certain conditions (observed on Android Chrome when page is served from a different origin, i.e. Firebase → Replit). Without the `crossorigin` attribute, the browser loads the video in no-cors / opaque mode — no CORS check at all — and it works everywhere.

**How to apply:** Keep `<video id="videoPlayer" controls playsinline preload="metadata">` with no `crossorigin` attr. The video src is set to `${API}/proxy/stream/:id` from app.js.

---

## Rule: Set video.src immediately, fetch title in background

```javascript
// CORRECT — video starts loading before title fetch completes
el.video.src = `${API}/proxy/stream/${id}`;
el.video.load();
el.video.play().catch(() => {});
fetchWithTimeout(`${API}/api/video/${id}`)
  .then(r => r.ok ? r.json() : Promise.reject())
  .then(data => { if (data?.title) el.title.textContent = data.title; })
  .catch(() => {});
```

**Why:** The `/api/video/:id` endpoint resolves embed.php which adds ~300–800ms latency. If video.src is set only after that fetch, the user waits before the video even starts loading. `/proxy/stream/:id` resolves the URL internally on first hit, so it's safe to point video.src directly.

---

## DoodStream CDN — `*.overfetch.video`

Videos uploaded to xpvid.cc via DoodStream use `meiva.overfetch.video` (and potentially other subdomains) as their CDN. The allowlist in `allowedStreamUrl()` checks:

```javascript
if (u.hostname.endsWith('.overfetch.video')) return true;
```

**Why:** Original STREAM_HOSTS only had `cache.overfetch.video`. DoodStream/Doodshare videos (named like "Cocopie Onlyfans 4 - DoodStream.mp4", "[Doodshare] Koleksi ...") fail with "Sumber video tidak ditemukan" until this wildcard subdomain check is present.

---

## Firebase ↔ Replit Deployment

- Firebase (`vidorey.web.app`) hosts the static `public/` files.
- Replit (`vidorey--lturner686.replit.app`) runs the backend.
- `public/config.js` hardcodes the Replit backend URL.
- `deploy.sh` deploys only Firebase frontend — Replit backend must be published separately via Replit UI.
- When testing from `vidorey--lturner686.replit.app` directly, `config.js` detects `.replit.app` hostname and overrides `BACKEND_URL` to `''` (relative), so no cross-origin issues.
