---
name: Vidorey Web Access Guard
description: Middleware di server.js yang memblokir akses ke static files + SPA pages dari host non-dev (Koyeb). API routes tetap terbuka.
---

## Rule
Static HTML pages dan SPA routes diblokir di environment production (Koyeb) sehingga publik tidak bisa akses URL backend langsung. Hanya Firebase frontend (`vidorey.web.app`) yang serve HTML ke user. API/proxy/monitor tetap bisa diakses dari semua origin.

## Why
User ingin backend Koyeb hanya melayani API calls dari Firebase — bukan sebagai web server langsung. Keamanan layer tambahan: bahkan jika seseorang tahu URL Koyeb, mereka tidak bisa browse konten.

## How to apply
Middleware ditambahkan di `server.js` **sebelum** `express.static(...)`:

```js
const WEB_DEV_HOSTS = /\.(replit\.dev|replit\.app)$|^localhost$|^127\.0\.0\.1$|^0\.0\.0\.0$/;
app.use((req, res, next) => {
  const p = req.path;
  const isApiPath = p.startsWith('/api/')   ||
                    p.startsWith('/proxy/')  ||
                    p.startsWith('/monitor') ||
                    p.startsWith('/health')  ||
                    p.startsWith('/embed/');
  if (isApiPath) return next();
  if (!WEB_DEV_HOSTS.test(req.hostname)) {
    return res.status(403).send('<!doctype html>...<a href="https://vidorey.web.app">vidorey.web.app</a>...');
  }
  next();
});
```

## Host allowlist
| Host pattern | Allowed | Tujuan |
|---|---|---|
| `*.replit.dev` | ✅ | Replit dev server (dev URL yang berubah tiap session) |
| `*.replit.app` | ✅ | Replit deployment preview |
| `localhost` | ✅ | Lokal dev |
| `127.0.0.1` | ✅ | Replit internal preview iframe (wajib — Replit screenshot pakai ini) |
| `0.0.0.0` | ✅ | Server binding address |
| `*.koyeb.app` | ❌ 403 | Production Koyeb — redirect ke Firebase |
| Lainnya | ❌ 403 | Semua host lain diblokir |

## Paths yang TIDAK diblokir (isApiPath)
- `/api/*` — scraper endpoints (listing, video detail, dll.)
- `/proxy/*` — MP4/HLS stream proxy, thumbnail proxy
- `/monitor*` — dashboard monitoring (sudah dilindungi SESSION_SECRET sendiri)
- `/health*` — health check endpoint
- `/embed/*` — embed route P1 (butuh iframe dari Firebase)

## Tidak butuh env var tambahan
Detection berbasis `req.hostname` murni — tidak perlu `DISABLE_WEB=true` atau env var apapun di Koyeb. Host Koyeb (`*.koyeb.app`) secara otomatis diblokir.

## Catatan penting
- `127.0.0.1` WAJIB ada di allowlist — tanpa ini Replit internal preview (screenshot tool, preview pane) kena 403 karena screenshot diambil via `http://127.0.0.1:5000`.
- `express.static` dan SPA fallback route (`app.get('*', ...)`) harus tetap SETELAH middleware ini — urutan Express matters.
