# Panduan Deploy Vidorey ke Firebase

## Arsitektur

```
Browser → Firebase Hosting (frontend statis: HTML/JS/CSS)
              ↓ semua request /api/* dan /proxy/*
          Backend server (Koyeb ATAU Replit)
```

Firebase hanya serve file statis. Semua logika scraping & proxy tetap di server Node.js.

---

## Prasyarat (sekali saja)

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login ke akun Google
firebase login --no-localhost
```

## Langkah Deploy Frontend (Firebase Hosting)

### 1. Pastikan Secret backend URL sudah diset

Buka **Secrets** di Replit (ikon kunci 🔑) dan set **salah satu** secret berikut sesuai backend yang dipakai:

**Jika backend di Koyeb (rekomendasi):**

| Key | Value |
|---|---|
| `KOYEB_BACKEND_URL` | URL Koyeb app, contoh: `https://vidorey-myorg.koyeb.app` |

**Jika backend di Replit:**

| Key | Value |
|---|---|
| `REPLIT_BACKEND_URL` | URL Replit backend aktif, contoh: `https://vidorey--lturner686.replit.app` |

> **Prioritas:** `deploy.sh` cek `KOYEB_BACKEND_URL` dulu, baru `REPLIT_BACKEND_URL`.
> Cukup set salah satu — tidak perlu set keduanya.
>
> **Penting:** Jangan edit `public/config.js` manual — file itu menyimpan placeholder. `deploy.sh` otomatis inject URL dari secret ini saat deploy, lalu restore placeholder setelah selesai.

### 2. Deploy ke Firebase Hosting

```bash
# Dari folder project di Replit terminal
bash deploy.sh
```

Script `deploy.sh` akan:
1. Baca URL dari secret `KOYEB_BACKEND_URL` (atau `REPLIT_BACKEND_URL`)
2. Inject URL ke `config.js` sementara
3. Deploy ke Firebase Hosting (`vidorey.web.app`)
4. Restore `config.js` ke placeholder otomatis

### 3. Deploy Backend (jika ada perubahan server.js)

Backend di-deploy terpisah sesuai platform yang dipakai:

**Jika backend di Koyeb:**
- Push ke GitHub → Koyeb otomatis redeploy (git-driven)
- Atau manual: `koyeb services redeploy vidorey/web`

**Jika backend di Replit:**
- Buka Replit project → klik **Deploy** / **Publish**

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
  robots.txt     ← SEO: allow/disallow rules + sitemap reference
  sitemap.xml    ← SEO: 6 platform URLs, changefreq daily
  ...
```

## Catatan Penting

- `/monitor`, `/monitor/events`, `/health/detail` → **hanya ada di backend** (Koyeb/Replit), tidak di Firebase
- Firebase hanya serve file statis — semua `/api/*` dan `/proxy/*` request harus ke backend server
- Saat testing dari Replit preview atau Koyeb langsung, `config.js` otomatis set `BACKEND_URL = ''` (relatif) berdasarkan deteksi hostname `.replit.app`, `.replit.dev`, `.koyeb.app`, atau `localhost`
