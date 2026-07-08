---
name: Vidorey Deploy Config (config.js + deploy.sh)
description: How BACKEND_URL is auto-detected at runtime and injected at Firebase deploy time via REPLIT_BACKEND_URL secret.
---

## The Rule
`public/config.js` keeps a placeholder `__REPLIT_BACKEND_URL__` in the repo. The actual production URL is never hardcoded in the file — it is injected by `deploy.sh` at deploy time, then restored.

## Why
- Firebase hosts static files; config.js cannot read env vars at runtime.
- Hardcoding the URL in the file risks committing a stale/wrong URL (happened once with `vidorey--lturner686.replit.app`).
- The placeholder system keeps the repo clean and makes URL changes a single-secret update.

## How to Apply

### Runtime auto-detect (config.js)
```js
(function () {
  var h = window.location.hostname;
  var isReplit =
    h === 'localhost' ||
    h.endsWith('.replit.dev') ||
    h.endsWith('.replit.app');
  window.BACKEND_URL = isReplit ? '' : '__REPLIT_BACKEND_URL__';
})();
```
- On Replit dev → `BACKEND_URL = ''` (relative URL, same-origin backend)
- On Firebase → `BACKEND_URL = '<injected URL>'`

### Deploy flow (deploy.sh)
1. Reads `$REPLIT_BACKEND_URL` env var (Replit Secret — set once)
2. `sed` replaces `__REPLIT_BACKEND_URL__` placeholder in config.js
3. Runs `firebase deploy --only hosting`
4. `mv config.js.bak config.js` restores placeholder

### If URL changes
Only update the **`REPLIT_BACKEND_URL` Replit Secret** — no file edits needed.
Do NOT manually edit config.js; the placeholder must stay intact for the next deploy.
