# ── Vidorey — Koyeb Dockerfile ─────────────────────────────────────────
# Gunakan Node.js LTS slim image (ukuran kecil, cocok untuk free tier Koyeb)
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files dulu (layer caching — npm install hanya re-run jika
# package.json / package-lock.json berubah)
COPY package.json package-lock.json ./

# Install production dependencies saja (tidak perlu devDependencies)
RUN npm ci --omit=dev

# Copy seluruh source code
COPY . .

# PORT di-inject oleh Koyeb secara otomatis via environment variable.
# EXPOSE hanya dokumentasi — Koyeb tetap pakai nilai PORT dari env.
EXPOSE 8000

# Jalankan server
CMD ["node", "server.js"]
