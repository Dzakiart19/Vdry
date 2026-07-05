#!/bin/bash
set -e

echo "================================================"
echo "  VIDOREY — Deploy to Firebase Hosting"
echo "================================================"

echo ""
echo "[1/2] Config.js sudah auto-detect (tidak perlu diubah)."
echo "      - vidorey.web.app → pakai Replit backend"
echo "      - *.replit.dev / localhost → pakai URL relatif"

# Deploy ke Firebase Hosting
echo "[2/2] Deploying ke Firebase Hosting..."
npx firebase-tools deploy --only hosting --project vidorey
echo "      Done."

echo ""
echo "================================================"
echo "  Deploy selesai!"
echo "  Live di: https://vidorey.web.app"
echo "================================================"
