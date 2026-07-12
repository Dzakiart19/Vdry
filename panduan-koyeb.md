# Panduan Deploy Vidorey ke Koyeb (Free Tier)

## Tentang Koyeb Free Tier

| Spec | Nilai |
|---|---|
| **vCPU** | 0.25 |
| **RAM** | 1 GB |
| **Storage** | 1 GB |
| **Harga** | **Gratis** (scale-to-zero) |
| **Billing** | Per-detik — hanya bayar saat ada traffic |
| **Sleep** | Otomatis tidur jika tidak ada request |
| **Domain** | `<app>-<org>.koyeb.app` (HTTPS otomatis) |

> **Scale-to-zero**: Instance mati otomatis saat tidak ada traffic (hemat biaya).
> Saat ada request masuk, instance bangun kembali dalam ~2-3 detik (cold start).

---

## Cara Deploy — Via GitHub (Direkomendasikan)

Ini cara termudah: Koyeb langsung pull dari repo GitHub dan auto-build menggunakan Dockerfile.

### Prasyarat
- Akun Koyeb: https://app.koyeb.com/auth/signup (gratis)
- Repo GitHub berisi project ini (public atau private)

### Langkah Deploy

1. **Login ke Koyeb** → https://app.koyeb.com

2. **Klik "Create Web Service"** di dashboard

3. **Pilih GitHub** sebagai deployment method

4. **Pilih repository** Vidorey kamu

5. **Konfigurasi service:**
   - **Branch:** `main`
   - **Builder:** `Dockerfile` (otomatis terdeteksi)
   - **Instance type:** `Free` (0.25 vCPU / 1 GB RAM — gratis!)
   - **Region:** Frankfurt (EU), Washington DC (US), atau Singapore (Asia)
   - **Port:** `8000` → HTTP

6. **Set Environment Variables** (tab "Environment variables"):

   | Key | Value | Keterangan |
   |---|---|---|
   | `SESSION_SECRET` | string random panjang | Wajib untuk keamanan session |
   | `MONITOR_KEY` | string random | Opsional — untuk akses `/monitor` |

   > **Cara generate nilai random:**
   > ```bash
   > node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   > ```

7. **Klik Deploy** — Koyeb akan build dari Dockerfile dan deploy otomatis

8. **URL live:** `https://vidorey-<orgmu>.koyeb.app`

### Auto-deploy
Setiap kali kamu push ke branch `main`, Koyeb otomatis rebuild dan redeploy.

---

## Cara Deploy — Via Docker Image (Alternatif)

Jika tidak pakai GitHub, bisa build manual dan push ke registry.

### Build & Push

```bash
# Build image
docker build -t ghcr.io/<username>/vidorey:latest .

# Push ke GitHub Container Registry (atau Docker Hub)
docker push ghcr.io/<username>/vidorey:latest
```

### Create Service di Koyeb

```bash
# Install Koyeb CLI
curl -fsSL https://raw.githubusercontent.com/koyeb/koyeb-cli/master/install.sh | bash

# Login
koyeb login

# Deploy
koyeb services create web \
  --app vidorey \
  --docker ghcr.io/<username>/vidorey:latest \
  --instance-type free \
  --regions fra \
  --port 8000:http \
  --env SESSION_SECRET=<nilai_secret> \
  --env MONITOR_KEY=<nilai_monitor_key>
```

---

## Arsitektur di Koyeb

Di Koyeb, **frontend dan backend jalan di server yang sama** (tidak terpisah seperti Replit + Firebase). Satu service Koyeb melayani:
- File statis (`public/`) → index.html, rb.html, dll
- API proxy → `/api/*`
- Stream proxy → `/proxy/*`
- Monitor → `/monitor`

Karena itu, **tidak perlu `config.js` pointing ke URL eksternal** — semua request sudah relatif ke server yang sama.

---

## Perbedaan Setup Replit vs Firebase vs Koyeb

| | Replit | Firebase + Replit | Koyeb |
|---|---|---|---|
| **Frontend** | server.js | Firebase Hosting | server.js |
| **Backend** | server.js | server.js (Replit) | server.js |
| **URL** | `*.replit.app` | `vidorey.web.app` | `*.koyeb.app` |
| **BACKEND_URL** | `''` (relatif) | URL Replit | `''` (relatif) |
| **Free tier** | ✅ | ✅ Firebase + Replit deploy | ✅ Scale-to-zero |

---

## Environment Variables yang Dipakai Server

| Variabel | Wajib | Default | Keterangan |
|---|---|---|---|
| `PORT` | ✅ | `5000` | Di-inject otomatis oleh Koyeb (`8000`) |
| `SESSION_SECRET` | ✅ | — | Keamanan session — set di Koyeb dashboard |
| `MONITOR_KEY` | ❌ | — | Kunci akses `/monitor` dashboard |

---

## Troubleshooting

### Cold Start Lambat (~2-3 detik)
Normal untuk free tier scale-to-zero. Upgrade ke instance berbayar jika perlu response instan.

### Port Error
Koyeb inject `PORT=8000` secara otomatis. server.js sudah handle ini:
```js
const PORT = process.env.PORT || 5000;
```

### CORS Error dari Domain Lain
Jika pakai custom domain atau ada frontend di host lain, tambahkan domain ke allowlist CORS di `server.js`.

### Health Check Gagal
Koyeb melakukan health check ke `/` setiap beberapa detik. Pastikan server merespons HTTP 200 di path tersebut.

---

## Update / Redeploy

- **Via GitHub:** cukup `git push` ke branch `main`
- **Via CLI:** `koyeb services redeploy vidorey/web`
- **Via Dashboard:** https://app.koyeb.com → pilih service → klik "Redeploy"
