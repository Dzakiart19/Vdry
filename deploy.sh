#!/bin/bash
set -e

echo "================================================"
echo "  VIDOREY — Deploy to Firebase Hosting"
echo "================================================"

# ── Cek REPLIT_BACKEND_URL secret ────────────────
if [ -z "$REPLIT_BACKEND_URL" ]; then
  echo ""
  echo "  ❌ ERROR: Secret REPLIT_BACKEND_URL belum diset."
  echo ""
  echo "  Cara set:"
  echo "  1. Buka tab Secrets di Replit (kunci 🔑)"
  echo "  2. Tambah key: REPLIT_BACKEND_URL"
  echo "  3. Value: URL Replit backend kamu (contoh: https://vidorey.username.replit.app)"
  echo ""
  exit 1
fi

echo ""
echo "[1/3] Backend URL: $REPLIT_BACKEND_URL"

# ── Inject URL ke config.js (sementara) ──────────
CONFIG="public/config.js"
cp "$CONFIG" "${CONFIG}.bak"

# Pastikan config.js SELALU dikembalikan ke placeholder setelah script selesai,
# bahkan jika deploy gagal atau script di-interrupt (Ctrl+C).
# Tanpa trap ini, config.js bisa tertinggal berisi URL produksi jika deploy error.
restore_config() {
  if [ -f "${CONFIG}.bak" ]; then
    mv "${CONFIG}.bak" "$CONFIG"
    echo "      config.js dikembalikan ke placeholder."
  fi
}
trap restore_config EXIT

# Gunakan delimiter | agar karakter & di URL tidak diinterpretasikan oleh sed
# (& dalam replacement string sed = "string yang cocok" → menghasilkan URL ganda)
sed -i "s|__REPLIT_BACKEND_URL__|${REPLIT_BACKEND_URL}|g" "$CONFIG"
echo "[2/3] config.js sudah di-patch dengan URL backend."

# ── Deploy ke Firebase Hosting ────────────────────
echo "[3/3] Deploying ke Firebase Hosting..."
npx firebase-tools deploy --only hosting --project vidorey

echo ""
echo "================================================"
echo "  Deploy selesai!"
echo "  Live di: https://vidorey.web.app"
echo "  Backend: $REPLIT_BACKEND_URL"
echo "================================================"
