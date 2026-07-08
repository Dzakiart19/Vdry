# Panduan Deploy Vidorey ke Firebase

## Prasyarat (sekali saja)

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login ke akun Google
firebase login --no-localhost
```

## Langkah Deploy Frontend (Firebase Hosting)

### 1. Pastikan BACKEND_URL benar di `public/config.js`

Buka `public/config.js` dan pastikan `BACKEND_URL` mengarah ke URL Replit backend yang aktif:

```js
window.BACKEND_URL = 'https://vidorey--lturner686.replit.app';
```

> **Penting:** Kalau URL Replit berubah (misal setelah rename project), wajib update ini sebelum deploy. Kalau lupa, Firebase frontend tidak bisa konek ke backend.

### 2. Deploy ke Firebase Hosting

```bash
# Masuk ke folder project
cd path/ke/folder/vidorey

# Deploy hanya Firebase Hosting (bukan Replit backend)
firebase deploy --only hosting
```

### 3. Deploy Replit Backend (jika ada perubahan server.js)

Replit backend di-deploy terpisah lewat Replit UI:
- Buka Replit project → klik **Deploy** / **Publish**
- Backend URL: `https://vidorey--lturner686.replit.app`

---

## Struktur File yang Di-deploy ke Firebase

```
public/
  index.html     ← Platform 1 (/)
  app.js
  rb.html        ← Platform 2 (/rb)
  rb.js
  yb.html        ← Platform 3 (/yb)
  yb.js
  config.js      ← BACKEND_URL config
  style.css
  ...
```

## Catatan Penting

- `/monitor`, `/monitor/events`, `/health/detail` → **hanya ada di Replit backend**, tidak di Firebase
- Firebase hanya serve file statis — semua `/api/*` dan `/proxy/*` request harus ke Replit backend
- Saat testing dari `vidorey--lturner686.replit.app`, `config.js` otomatis override `BACKEND_URL` ke `''` (relatif) berdasarkan deteksi hostname `.replit.app` / `.replit.dev` / `localhost`
