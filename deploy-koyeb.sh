#!/bin/bash
# ══════════════════════════════════════════════════════════════
#   VIDOREY — Deploy ke Koyeb (Free Tier)
#   Jalankan: bash deploy-koyeb.sh
# ══════════════════════════════════════════════════════════════
set -e

echo "================================================"
echo "  VIDOREY — Deploy ke Koyeb"
echo "================================================"
echo ""

# ── Cek Koyeb CLI sudah ter-install ──────────────────────────
if ! command -v koyeb &>/dev/null; then
  echo "  ❌ Koyeb CLI belum ter-install."
  echo ""
  echo "  Install dulu:"
  echo "    curl -fsSL https://raw.githubusercontent.com/koyeb/koyeb-cli/master/install.sh | bash"
  echo "  atau:"
  echo "    npm install -g @koyeb/koyeb-cli"
  echo ""
  echo "  Lalu login:"
  echo "    koyeb login"
  echo ""
  exit 1
fi

# ── Cek sudah login ───────────────────────────────────────────
if ! koyeb whoami &>/dev/null; then
  echo "  ❌ Belum login ke Koyeb."
  echo "  Jalankan: koyeb login"
  exit 1
fi

echo "  ✅ Koyeb CLI terdeteksi."
echo ""

# ── Baca nama app dari argumen atau gunakan default ──────────
APP_NAME="${1:-vidorey}"
SERVICE_NAME="web"
REGION="${2:-fra}"   # fra = Frankfurt (EU), was = Washington DC (US), sin = Singapore

echo "  App Name   : $APP_NAME"
echo "  Service    : $SERVICE_NAME"
echo "  Region     : $REGION"
echo ""

# ── Cek apakah app sudah ada ─────────────────────────────────
APP_EXISTS=$(koyeb apps list --output json 2>/dev/null | node -e "
const d=require('fs').readFileSync('/dev/stdin','utf8');
try{
  const j=JSON.parse(d);
  const apps=Array.isArray(j)?j:(j.apps||[]);
  console.log(apps.some(a=>a.name==='$APP_NAME')?'yes':'no');
}catch{console.log('no');}
" 2>/dev/null || echo "no")

if [ "$APP_EXISTS" = "yes" ]; then
  echo "  ℹ️  App '$APP_NAME' sudah ada — update service yang ada."
  echo ""
  koyeb services redeploy "$APP_NAME/$SERVICE_NAME" || {
    echo ""
    echo "  ⚠️  Redeploy gagal. Coba manual di: https://app.koyeb.com"
  }
else
  echo "  🚀 Membuat app baru '$APP_NAME' dari Docker image..."
  echo ""
  echo "  CATATAN: Cara termudah deploy ke Koyeb adalah via GitHub."
  echo "  Buka panduan-koyeb.md untuk langkah lengkap."
  echo ""
  echo "  Atau, build & push Docker image dulu:"
  echo "    docker build -t <registry>/$APP_NAME ."
  echo "    docker push <registry>/$APP_NAME"
  echo "    koyeb services create $SERVICE_NAME \\"
  echo "      --app $APP_NAME \\"
  echo "      --docker <registry>/$APP_NAME \\"
  echo "      --instance-type free \\"
  echo "      --regions $REGION \\"
  echo "      --port 8000:http \\"
  echo "      --env SESSION_SECRET=\$SESSION_SECRET"
fi

echo ""
echo "================================================"
echo "  Selesai! Cek status di: https://app.koyeb.com"
echo "================================================"
