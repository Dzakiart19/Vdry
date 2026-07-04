# Vidorey — Deploy ke Firebase Hosting

## Arsitektur

```
User
 ├── Firebase Hosting  →  index.html, style.css, app.js, config.js, logo.png
 └── Replit Backend    →  /api/*, /proxy/*, /health
```

| Komponen | Host | URL |
|---|---|---|
| Frontend | Firebase Hosting | https://vidorey.web.app |
| Backend | Replit Autoscale | https://vdry--dzeckbpf2oq61.replit.app |

---

## Setup Awal (Sekali Saja)

### 1. Install semua dependencies

```bash
bash install.sh
```

Script ini akan install:
- Node.js dependencies (`express`, `axios`, `cheerio`, `cors`)
- Firebase Tools (global)

### 2. Login ke Firebase

```bash
firebase login --no-localhost
```

Ikuti instruksi di terminal, buka link yang diberikan di browser.

---

## Deploy Frontend ke Firebase

Gunakan script yang sudah tersedia:

```bash
bash deploy.sh
```

Script ini otomatis:
1. Update `public/config.js` dengan backend URL Replit
2. Deploy semua file `public/` ke Firebase Hosting

### Jika backend URL Replit berubah

```bash
bash deploy.sh https://url-baru.replit.app
```

---

## Deploy Backend ke Replit

1. Di Replit, klik tombol **Publish**
2. Tunggu proses selesai
3. Jika URL berubah, jalankan ulang `bash deploy.sh https://url-baru.replit.app`

---

## File yang di-deploy ke Firebase Hosting

Hanya isi folder `public/`:

```
public/
├── index.html    — Halaman utama SPA
├── style.css     — Tampilan dark theme
├── app.js        — Logika frontend
├── config.js     — URL backend Replit (auto-update oleh deploy.sh)
└── logo.png      — Logo Vidorey
```

---

## Update Frontend

Setiap ada perubahan di `public/`:

```bash
bash deploy.sh
```

Setiap ada perubahan di `server.js` (backend) → cukup **Publish ulang di Replit**.

---

## Konfigurasi Project

| File | Isi |
|---|---|
| `.firebaserc` | Project ID: `vidorey` |
| `firebase.json` | Public dir: `public/`, rewrite ke `index.html` |
| `public/config.js` | `window.BACKEND_URL` — URL backend Replit |

---

## Troubleshooting

### CORS Error
Backend sudah dikonfigurasi untuk mengizinkan domain berikut:
- `*.web.app`
- `*.firebaseapp.com`
- `*.replit.dev`
- `*.replit.app`
- `localhost`

### Replit deployment gagal start
Pastikan build command sudah dikonfigurasi:
- **Build:** `npm install --production`
- **Run:** `node server.js`

### Health Check
```
https://vdry--dzeckbpf2oq61.replit.app/health
```
