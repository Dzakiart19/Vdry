# XPVid Browser

Web app untuk browse dan nonton video dari xpvid.cc / Vidoy platform.

## Stack
- **Backend**: Node.js + Express (proxy + HTML scraper)
- **Frontend**: Vanilla JS SPA (no framework)
- **Port**: 5000

## Cara Kerja
1. Backend scrape HTML folder/video dari xpvid.cc menggunakan cheerio
2. `/api/folder/:id` → parse subfolder & video list
3. `/api/video/:id` → ambil direct MP4 URL dari embed.php
4. `/proxy/stream/:id` → stream video dengan Referer header yang benar
5. `/proxy/thumb` → proxy thumbnail dari i.xpvid.cc

## User Preferences
- Dark theme
- Bahasa Indonesia untuk UI
