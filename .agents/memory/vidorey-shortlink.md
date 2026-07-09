---
name: Vidorey shortlink registry
description: How Platform 2-4 generates short 11-char watch URLs — lib/shortlink.js token registry, client currentToken flow, encodeSlug/decodeSlug helpers, and deep-link resolution.
---

## Purpose
Video watch URLs for P2/P3/P4 use a short 11-char random token (`/rb/watch/m4k9zqr2xab`)
instead of the readable slug. This hides the video title from the address bar and share links.

## Server — lib/shortlink.js
```js
const { registerSlug } = require('../shortlink');
// In each platform's video endpoint:
res.json({ slug, title, ..., token: registerSlug('rb', slug) });
```
- `registerSlug(platform, slug)` → 11-char token from `[a-z0-9]`; idempotent (same slug → same token until TTL).
- `resolveToken(platform, token)` → slug, or `null` if expired/unknown.
- TTL: **48 hours**. Max: **20 000 slots**. Pure in-memory — tokens do NOT survive server restart.
- One cache entry per direction: `platform:slug:X` → token, `platform:token:Y` → slug.

## Server — /api/s/:platform/:token (server.js)
Route already in `server.js` (not inside any scraper). Validates platform ∈ {rb,yb,bk} and
token matches `/^[a-z0-9]{11}$/`, then calls `resolveToken`. Returns `{ slug }` or 404.
No new route needed when adding a new platform — just add the platform name to the allowlist
in that route and call `registerSlug` in the new scraper's video endpoint.

## Client — encodeSlug / decodeSlug helpers (per JS file)
Defined at the top of each platform's IIFE (rb.js, yb.js, bk.js):
```js
function encodeSlug(s) {
  // UTF-8-safe base64url — handles any Unicode character in slug
  try {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch { return encodeURIComponent(s); } // graceful fallback
}
function decodeSlug(t) {
  try {
    const pad = t.length % 4;
    const bin = atob((pad ? t + '='.repeat(4 - pad) : t).replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))) || null;
  } catch { return null; }
}
```
**Why UTF-8-safe instead of plain btoa:** `btoa` throws on non-ASCII characters. Even though
current slugs are ASCII-only, the TextEncoder approach is correct for any future site.

## Client — currentToken state & flow
```js
let currentSlug  = null;
let currentToken = null;
```

**openPlayer(slug):**
1. Reset `currentToken = null` at top.
2. Call `openModal(slug)` → pushes `/pN/watch/${encodeSlug(slug)}` to address bar (temporary, long URL).
3. After `apiFetch('/api/pN/video/:slug')` resolves:
   ```js
   if (data.token) {
     currentToken = data.token;
     history.replaceState({ pNModal: true, pNSlug: slug }, '', `/pN/watch/${data.token}`);
   }
   ```
4. Address bar now shows the short token URL. History state still carries raw slug.

**closeModal() and popstate back-while-open branch:**
```js
currentSlug  = null;
currentToken = null;
```

**Share button:**
```js
const shareUrl = `${location.origin}/pN/watch/${currentToken || encodeSlug(currentSlug)}`;
```

## Client — deep-link on load
```js
const deepLinkMatch = location.pathname.match(/^\/pN\/watch\/([^/]+)\/?$/);
// Capture BEFORE loadPosts() — loadPosts() calls saveNav() which replaceState('/pN')

if (deepLinkMatch) {
  const segment = deepLinkMatch[1];
  if (/^[a-z0-9]{11}$/.test(segment)) {
    // Short token → resolve server-side
    apiFetch(`/api/s/pN/${segment}`)
      .then(d => { if (d?.slug) { modalHistoryPushed = false; openPlayer(d.slug); } })
      .catch(() => {}); // token expired / server restart — silently ignore
  } else {
    // Legacy base64url-encoded slug (links shared before token system)
    const slug = decodeSlug(segment);
    if (slug) { modalHistoryPushed = false; openPlayer(slug); }
  }
}
```

## What does NOT need to change in server.js for a new platform
- The `/api/s/:platform/:token` route is already there — just add the new platform name
  to the `includes()` check in that route.
- `lib/shortlink.js` itself needs no changes.

## Expiry behavior
Token expires after 48h (or server restart). Deep-link to an expired token silently fails
(`.catch(() => {})`) — user lands on the listing page normally. This is acceptable because
share links are typically used within hours.
