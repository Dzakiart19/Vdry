# ── Vidorey — Koyeb Dockerfile ─────────────────────────────────────────
# Gunakan Node.js LTS slim image (ukuran kecil, cocok untuk free tier Koyeb)
FROM node:20-slim

# Set working directory
WORKDIR /app

# Catatan: curl TIDAK di-install via apt-get — build Koyeb gagal saat
# apt-get (mirror Debian flaky) dan Koyeb terus menjalankan versi lama.
# Solusi: binary curl STATIS di-commit di lib/bin/curl (lihat lib/curlfetch.js
# resolver). Binary statis = zero system dependency, jalan di node:20-slim.

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
