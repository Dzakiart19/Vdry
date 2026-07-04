#!/bin/bash
set -e

echo "================================================"
echo "  VIDOREY — Install Script"
echo "================================================"

# Node.js dependencies
echo ""
echo "[1/2] Installing Node.js dependencies..."
npm install
echo "      Done."

# Firebase Tools (global)
echo ""
echo "[2/2] Installing Firebase Tools (global)..."
npm install -g firebase-tools
echo "      Done."

echo ""
echo "================================================"
echo "  Semua dependencies berhasil diinstall!"
echo ""
echo "  Perintah tersedia:"
echo "  - node server.js       : Jalankan backend"
echo "  - firebase login       : Login Firebase"
echo "  - firebase deploy      : Deploy ke Firebase Hosting"
echo "================================================"
