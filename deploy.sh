#!/bin/bash
set -e

echo "================================================"
echo "  VIDOREY — Deploy to Firebase Hosting"
echo "================================================"

# ── Tentukan BACKEND_URL ──────────────────────────
# Prioritas: KOYEB_BACKEND_URL → REPLIT_BACKEND_URL
# Set salah satu di Secrets Replit sesuai backend yang dipakai.
if [ -n "$KOYEB_BACKEND_URL" ]; then
  BACKEND_URL="$KOYEB_BACKEND_URL"
  BACKEND_LABEL="Koyeb"
elif [ -n "$REPLIT_BACKEND_URL" ]; then
  BACKEND_URL="$REPLIT_BACKEND_URL"
  BACKEND_LABEL="Replit"
else
  echo ""
  echo "  ❌ ERROR: Secret backend URL belum diset."
  echo ""
  echo "  Set salah satu di tab Secrets Replit (🔑):"
  echo ""
  echo "  Jika backend di Koyeb:"
  echo "    Key  : KOYEB_BACKEND_URL"
  echo "    Value: https://<app>-<org>.koyeb.app"
  echo ""
  echo "  Jika backend di Replit:"
  echo "    Key  : REPLIT_BACKEND_URL"
  echo "    Value: https://vidorey.<username>.replit.app"
  echo ""
  exit 1
fi

echo ""
echo "[1/3] Backend ($BACKEND_LABEL): $BACKEND_URL"

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
sed -i "s|__REPLIT_BACKEND_URL__|${BACKEND_URL}|g" "$CONFIG"
echo "[2/3] config.js sudah di-patch dengan URL backend."

# ── Deploy ke Firebase Hosting ────────────────────
echo "[3/3] Deploying ke Firebase Hosting..."
npx firebase-tools deploy --only hosting --project vidorey

echo ""
echo "================================================"
echo "  Deploy selesai!"
echo "  Live di: https://vidorey.web.app"
echo "  Backend ($BACKEND_LABEL): $BACKEND_URL"
echo "================================================"
