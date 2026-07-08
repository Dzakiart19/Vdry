---
name: Vidorey modular refactor
description: How server.js was split into lib/ modules while preserving platform isolation and exact behavior parity.
---

Vidorey's monolithic server.js (1923 lines, all 3 platforms + monitor in one file) was split into:
- `lib/cache.js`, `lib/proxy.js` — generic stateless helpers only (no shared platform state).
- `lib/monitor.js` — monitor/health/SSE/CDN-alert logic, exposes `registerMonitorRoutes(app, { getCacheStats })` and `trackRequest` middleware.
- `lib/scrapers/{p1,rb,yb,bk}.js` — one file per platform, each exports `{ router, caches }`; no cross-imports between platform files.
- `server.js` is now a thin composition root (~150 lines, 4 platforms).

**Why:** user explicitly asked to de-duplicate/simplify server.js structure without merging scraper logic — platform isolation ("setiap platform harus terisolasi penuh") is a hard project rule from replit.md, so shared code was limited to genuinely generic helpers.

**How to apply:** when adding a Platform N, follow the p1/rb/yb/bk.js pattern — own router + own caches array, no imports from sibling scraper files. `lib/scrapers/*.js` are two directories below project root, so static file paths need `path.join(__dirname, '..', '..', 'public', ...)`. The original server.js's `/health/detail` cache list intentionally omitted `ybFreshSessionCache` — this omission was preserved as-is (not a bug to fix silently). Also add P4 event tracking branches in `trackRequest` (monitor.js) for `bk_video`/`bk_posts`, and add CSS badge classes in `monitorDashboardHtml`.
