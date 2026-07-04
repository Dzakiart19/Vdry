# Vidorey — Dual-Platform Video Browser

Web app untuk browse dan nonton video dari dua platform terpisah.

## Stack
- **Backend**: Node.js + Express (proxy + HTML scraper) — `server.js`
- **Frontend**: Vanilla JS SPA (no framework), dua halaman terpisah
- **Port**: 5000

## Dua Platform (Completely Isolated)

| Platform | URL | Source | HTML | JS |
|---|---|---|---|---|
| Platform 1 | `/` | xpvid.cc | `index.html` | `app.js` |
| Platform 2 | `/rb` | ruangbokep.ws | `rb.html` | `rb.js` |

Navigasi antar platform via tombol di kanan atas topbar.

## Cara Kerja — Platform 1 (xpvid.cc)
1. `/api/folder/:id` → scrape subfolder & video list dari xpvid.cc
2. `/api/video/:id` → ambil direct MP4 URL dari embed.php
3. `/proxy/stream/:id` → stream video dengan Range support & Referer header
4. `/proxy/thumb?url=` → proxy thumbnail dari i.xpvid.cc (allowlist only)

## Cara Kerja — Platform 2 (ruangbokep.ws)
1. `/api/rb/categories` → fetch kategori via WordPress REST API
2. `/api/rb/posts` → scrape listing video (support pagination & kategori)
3. `/api/rb/video/:slug` → resolve iframe embed URL (putarvid/streamruby)
4. `/proxy/rb/thumb?url=` → proxy thumbnail dari ruangbokep.ws & streamruby

## Deployment
- **Backend**: Replit (node server.js, port 5000)
- **Frontend**: Firebase Hosting (vidorey.web.app) — deploy via `bash deploy.sh`
- `public/config.js` — `window.BACKEND_URL` diisi otomatis oleh deploy.sh

## User Preferences
- Dark theme (Obsidian Archive design system)
- Bahasa Indonesia untuk UI
- Setiap platform harus terisolasi penuh — tidak boleh ada data/logic yang bocor antar platform
