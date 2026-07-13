---
name: Vidorey modular refactor
description: How server.js was split into lib/ modules while preserving platform isolation and exact behavior parity. 7 platforms.
---

Vidorey's monolithic server.js (all platforms + monitor in one file) was split into:
- `lib/cache.js`, `lib/proxy.js` — generic stateless helpers only (no shared platform state).
- `lib/monitor.js` — monitor/health/SSE/CDN-alert logic, exposes `registerMonitorRoutes(app, { getCacheStats })` and `trackRequest` middleware.
- `lib/scrapers/{p1,rb,yb,bk,tp,rc,sb}.js` — one file per platform, each exports `{ router, caches }`; no cross-imports between platform files.
- `server.js` is now a thin composition root (7 platforms).

**Why:** user explicitly asked to de-duplicate/simplify server.js structure without merging scraper logic — platform isolation ("setiap platform harus terisolasi penuh") is a hard project rule from replit.md, so shared code was limited to genuinely generic helpers.

**How to apply:** when adding a Platform N, follow the p1/rb/yb/bk/tp/rc/sb.js pattern — own router + own caches array, no imports from sibling scraper files. `lib/scrapers/*.js` are two directories below project root, so static file paths need `path.join(__dirname, '..', '..', 'public', ...)`.

Saat menambah platform baru, wajib update semua lokasi ini:
1. `lib/scrapers/pN.js` — buat baru, export `{ router, caches }`
2. `server.js` — require + mount router + tambah caches ke health/detail + tambah platform ke shortlink allowlist
3. `lib/monitor.js` — tambah trackRequest branches (`pN_video`/`pN_posts`) + badge CSS di `monitorDashboardHtml`
4. `public/pN.html` + `public/pN.js` — UI baru
5. `public/style.css` — `.ps-avatar-pN` gradient + scoped `.pN-page` rules
6. **SEMUA 7 HTML files** (index, rb, yb, bk, sb, tp, rc) — tambah nav drawer item platform baru
7. `public/sitemap.xml` — tambah `<url>` baru
8. `firebase.json` — tambah dua rewrite `/pN` + `/pN/**` SEBELUM catch-all `**`
9. `public/smartlinks.js` — tambah card selector baru ke `CARD_SEL`

**SPA route WAJIB di scraper:** setiap `pN.js` harus punya `router.get('/pN', sendFile)` + `router.get('/pN/*', sendFile)`. Tanpa ini klik dari nav drawer selalu ke Platform 1. Bug ini sudah terjadi pada P7 (SB) — jangan ulangi.

**Nav drawer section rule:** listing platform → masuk seksi ATAS (sebelum `<hr class="nav-section-divider">`). TikTok-style → masuk seksi BAWAH (setelah label "Fitur Lain"). Lihat `vidorey-nav-drawer.md` untuk detail lengkap.

**Full platform checklist:** lihat `new-platform-checklist.md` — mencakup backend + frontend HTML + CSP + nav drawer section placement + SPA route + firebase.json + SEO (meta, GTM, H1, schema, sitemap) + verifikasi akhir.
