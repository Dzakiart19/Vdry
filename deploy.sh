#!/bin/bash
set -e

echo "================================================"
echo "  VIDOREY — Deploy to Firebase Hosting"
echo "================================================"

# Ambil Replit backend URL dari argumen atau gunakan default
BACKEND_URL="${1:-https://vdry--dzeckbpf2oq61.replit.app}"

echo ""
echo "[1/3] Menggunakan backend URL: $BACKEND_URL"

# Update config.js
echo "[2/3] Mengupdate public/config.js..."
cat > public/config.js << EOF
/* ═══════════════════════════════════════════
   VIDOREY — Runtime Config
═══════════════════════════════════════════ */
window.BACKEND_URL = '$BACKEND_URL';
EOF
echo "      Done."

# Deploy ke Firebase Hosting
echo "[3/3] Deploying ke Firebase Hosting..."
npx firebase-tools deploy --only hosting --project vidorey
echo "      Done."

echo ""
echo "================================================"
echo "  Deploy selesai!"
echo "  Live di: https://vidorey.web.app"
echo "================================================"
