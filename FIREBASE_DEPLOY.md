# Vidorey — Deploy ke Firebase Hosting

## Arsitektur

```
User
 ├── Firebase Hosting  →  index.html, style.css, app.js, config.js
 └── Replit Backend    →  /api/*, /proxy/*, /health
```

---

## Langkah 1 — Deploy Replit Backend dulu

**Wajib dilakukan sebelum Firebase**, karena kamu perlu URL Replit production.

1. Di Replit, klik **Publish / Deploy**
2. Tunggu hingga selesai
3. Catat URL production-nya, contoh: `https://vidorey.username.replit.app`

---

## Langkah 2 — Setup Firebase Project

1. Buka [console.firebase.google.com](https://console.firebase.google.com)
2. Klik **Add project** → beri nama (misal: `vidorey`)
3. Setelah project dibuat, catat **Project ID** (contoh: `vidorey-abc12`)

---

## Langkah 3 — Update config di Replit

### Edit `public/config.js`

```js
window.BACKEND_URL = 'https://vidorey.username.replit.app'; // ← URL Replit kamu
```

### Edit `.firebaserc`

```json
{
  "projects": {
    "default": "vidorey-abc12"   // ← Project ID Firebase kamu
  }
}
```

---

## Langkah 4 — Install Firebase CLI & Deploy

Jalankan di terminal (laptop/PC kamu, bukan di Replit):

```bash
# Install Firebase CLI (sekali saja)
npm install -g firebase-tools

# Login ke akun Google
firebase login

# Masuk ke folder project (download dari Replit atau clone dari GitHub)
cd path/ke/folder/vidorey

# Deploy ke Firebase Hosting
firebase deploy --only hosting
```

Setelah selesai, Firebase akan kasih URL seperti:
```
Hosting URL: https://vidorey-abc12.web.app
```

---

## File yang diupload ke Firebase Hosting

Firebase hanya upload isi folder `public/`:
- `index.html`
- `style.css`
- `app.js`
- `config.js`  ← berisi URL backend Replit

---

## Cara Update Frontend

Setiap ada perubahan di `public/`:

```bash
firebase deploy --only hosting
```

Setiap ada perubahan di `server.js` (backend) → cukup redeploy di Replit.

---

## Troubleshooting CORS

Jika ada error CORS di browser, pastikan domain Firebase kamu sudah masuk allowlist.
Backend Replit sudah dikonfigurasi untuk mengizinkan:
- `*.web.app`
- `*.firebaseapp.com`
- `*.replit.dev`
- `*.replit.app`
- `localhost`

---

## Cronjob `/health`

URL untuk cronjob (pakai URL Replit, bukan Firebase):
```
https://vidorey.username.replit.app/health
```
