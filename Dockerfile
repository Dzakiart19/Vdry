# ── Vidorey — Koyeb Dockerfile ─────────────────────────────────────────
# Gunakan Node.js LTS slim image (ukuran kecil, cocok untuk free tier Koyeb)
FROM node:20-slim

# Set working directory
WORKDIR /app

# curl dibutuhkan lib/curlfetch.js — fetch tik.porn (TP) memakai fingerprint
# TLS curl karena Cloudflare memblokir fingerprint Node (lihat lib/curlfetch.js)
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package files dulu (layer caching — npm install hanya re-run jika
# package.json / package-lock.json berubah)
COPY package.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy seluruh source code
COPY . .

# PORT di-inject oleh Koyeb secara otomatis via environment variable.
# EXPOSE hanya dokumentasi — Koyeb tetap pakai nilai PORT dari env.
EXPOSE 8000

# Jalankan server
CMD ["node", "server.js"]
