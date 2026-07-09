# Panduan Deploy Vidorey ke Firebase

## Prasyarat (sekali saja)

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login ke akun Google
firebase login --no-localhost
```

## Langkah Deploy Frontend (Firebase Hosting)

### 1. Pastikan Secret `REPLIT_BACKEND_URL` sudah diset

Buka **Secrets** di Replit (ikon kunci 🔑) dan pastikan secret ini ada:

| Key | Value |
|---|---|
| `REPLIT_BACKEND_URL` | URL Replit backend aktif, contoh: `https://vidorey--lturner686.replit.app` |

> **Penting:** Jangan edit `public/config.js` manual — file itu menyimpan placeholder `__REPLIT_BACKEND_URL__` di repo. `deploy.sh` akan otomatis inject URL dari secret ini saat deploy, lalu restore placeholder setelah selesai.
>
> Jika URL Replit berubah (setelah rename project), cukup update secret `REPLIT_BACKEND_URL` — tidak perlu edit file apapun.

### 2. Deploy ke Firebase Hosting

```bash
# Dari folder project di Replit terminal
bash deploy.sh
```

Script `deploy.sh` akan:
1. Baca URL dari secret `REPLIT_BACKEND_URL`
2. Inject URL ke `config.js` sementara
3. Deploy ke Firebase Hosting (`vidorey.web.app`)
4. Restore `config.js` ke placeholder otomatis

### 3. Deploy Replit Backend (jika ada perubahan server.js)

Replit backend di-deploy terpisah lewat Replit UI:
- Buka Replit project → klik **Deploy** / **Publish**
- Backend URL: `https://vidorey--lturner686.replit.app`

---

## Struktur File yang Di-deploy ke Firebase

```
public/
  index.html     ← Platform 1 — Vidorey 1 (/)
  app.js
  rb.html        ← Platform 2 — Vidorey 2 (/rb)
  rb.js
  yb.html        ← Platform 3 — Vidorey 3 (/yb)
  yb.js
  bk.html        ← Platform 4 — Vidorey 4 (/bk)
  bk.js
  tp.html        ← Platform 5 — Vidorey TikTok 1 (/tp)
  tp.js
  rc.html        ← Platform 6 — Vidorey TikTok 2 (/rc)
  rc.js
  config.js      ← BACKEND_URL config
  style.css
  smartlinks.js
  ...
```

## Catatan Penting

- `/monitor`, `/monitor/events`, `/health/detail` → **hanya ada di Replit backend**, tidak di Firebase
- Firebase hanya serve file statis — semua `/api/*` dan `/proxy/*` request harus ke Replit backend
- Saat testing dari `vidorey--lturner686.replit.app`, `config.js` otomatis override `BACKEND_URL` ke `''` (relatif) berdasarkan deteksi hostname `.replit.app` / `.replit.dev` / `localhost`
