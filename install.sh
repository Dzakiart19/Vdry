#!/bin/bash
set -e

echo "================================================"
echo "  VIDOREY — Install Script"
echo "================================================"

# Node.js dependencies
echo ""
echo "[1/3] Installing Node.js dependencies..."
npm install
echo "      Done."

# Firebase Tools (global)
echo ""
echo "[2/3] Installing Firebase Tools (global)..."
npm install -g firebase-tools
echo "      Done."

# Firebase Login
echo ""
echo "[3/3] Firebase Login"
read -r -p "      Login ke Firebase sekarang? (y/n): " answer
if [[ "$answer" =~ ^[Yy]$ ]]; then
  echo ""
  firebase login --no-localhost
else
  echo "      Skip. Jalankan 'firebase login --no-localhost' manual jika diperlukan."
fi

echo ""
echo "================================================"
echo "  Semua dependencies berhasil diinstall!"
echo ""
echo "  Perintah tersedia:"
echo "  - node server.js                  : Jalankan backend"
echo "  - firebase login --no-localhost   : Login Firebase"
echo "  - bash deploy.sh                  : Deploy ke Firebase Hosting"
echo "================================================"
