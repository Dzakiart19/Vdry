#!/bin/bash
set -e

echo "================================================"
echo "  VIDOREY — Deploy to Firebase Hosting"
echo "================================================"

# ── Tentukan BACKEND_URL ──────────────────────────
# Prioritas: KOYEB_BACKEND_URL → REPLIT_BACKEND_URL → baca dari config.js
CONFIG="public/config.js"
if [ -n "$KOYEB_BACKEND_URL" ]; then
  BACKEND_URL="$KOYEB_BACKEND_URL"
  BACKEND_LABEL="Koyeb (env)"
elif [ -n "$REPLIT_BACKEND_URL" ]; then
  BACKEND_URL="$REPLIT_BACKEND_URL"
  BACKEND_LABEL="Replit (env)"
else
  # Fallback: ekstrak URL yang sudah ada di config.js
  # (berlaku jika config.js sudah di-patch atau URL sudah di-hardcode langsung)
  BACKEND_URL=$(grep -oP "(?<>: ')[^']*koyeb\.app|[^']*replit\.app" "$CONFIG" 2>/dev/null | head -1)
  # regex lebih portable:
  BACKEND_URL=$(grep -o "https://[a-zA-Z0-9._-]*\.\(koyeb\.app\|replit\.app\)" "$CONFIG" 2>/dev/null | head -1)
  if [ -n "$BACKEND_URL" ]; then
    BACKEND_LABEL="config.js (sudah terpatch)"
  else
    echo ""
    echo "  ❌ ERROR: Backend URL tidak ditemukan."
    echo ""
    echo "  Set salah satu env var berikut (bukan secret, nilai publik):"
    echo "    KOYEB_BACKEND_URL=https://<app>-<org>.koyeb.app"
    echo "    REPLIT_BACKEND_URL=https://vidorey.<username>.replit.app"
    echo ""
    echo "  Atau pastikan config.js sudah berisi URL backend yang benar."
    echo ""
    exit 1
  fi
fi

echo ""
echo "[1/3] Backend ($BACKEND_LABEL): $BACKEND_URL"

# ── Inject URL ke config.js (sementara, jika masih ada placeholder) ──
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